/* ============================================
   LATLOMP PLATFORM — PLATFORM STAFF AUTH ROUTES

   POST /api/platform-auth/google
     FLOW 1: Accept invitation (inviteToken present)
     FLOW 2: Returning staff member sign-in

   GET  /api/platform-auth/me
     Return current platform staff profile.

   GET  /api/platform-auth/invite-info?token=TOKEN
     Public endpoint — returns invitation summary
     so the accept page can show role before sign-in.
     Never exposes sensitive fields.

   COLLISION SAFETY:
     These routes are mounted at /api/platform-auth.
     Existing routes at /api/auth, /api/institution/auth,
     and /api/institution/student-portal are completely
     separate and untouched.
============================================ */
'use strict';

const express            = require('express');
const router             = express.Router();
const { OAuth2Client }   = require('google-auth-library');

const PlatformStaff      = require('../models/PlatformStaff.model');
const PlatformInvitation = require('../models/PlatformInvitation.model');
const {
  signPlatformToken,
  platformStaffProtect
} = require('../middleware/platform.auth');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/* ============================================
   GET /api/platform-auth/invite-info?token=TOKEN
   Public — no auth required.
   Returns just enough info to render the accept page.
============================================ */
router.get('/invite-info', async function (req, res) {
  try {
    var token = (req.query.token || '').trim();
    if (!token) {
      return res.status(400).json({ success: false, message: 'Token is required.' });
    }

    var invite = await PlatformInvitation.findOne({ token: token, status: 'pending' });
    if (!invite) {
      return res.status(404).json({
        success: false,
        message: 'This invitation link is invalid or has already been used.'
      });
    }

    if (new Date() > invite.expiresAt) {
      invite.status = 'expired';
      await invite.save();
      return res.status(400).json({
        success: false,
        message: 'This invitation has expired. Please ask the platform administrator to send a new one.'
      });
    }

    return res.status(200).json({
      success:    true,
      invitation: {
        email:        invite.email,
        name:         invite.name,
        platformRole: invite.platformRole,
        roleLabel:    PlatformInvitation.getRoleLabel(invite.platformRole),
        expiresAt:    invite.expiresAt
      }
    });
  } catch (err) {
    console.error('[PlatformAuth] GET /invite-info:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/* ============================================
   POST /api/platform-auth/google

   FLOW 1 — INVITE ACCEPTANCE (inviteToken present):
     Recipient clicked invitation link.
     Verifies Google identity against invited email.
     Creates PlatformStaff record.
     Marks invitation as accepted.
     Returns platform staff JWT.

   FLOW 2 — RETURNING STAFF MEMBER:
     No invite token — just a Google sign-in.
     Finds existing PlatformStaff by email.
     Updates last login + login history.
     Returns platform staff JWT.
============================================ */
router.post('/google', async function (req, res) {
  try {
    var body        = req.body || {};
    var credential  = body.credential;
    var inviteToken = body.inviteToken || null;

    if (!credential) {
      return res.status(400).json({ success: false, message: 'Google credential is required.' });
    }

    /* ---- Verify Google token ---- */
    var ticket = await googleClient.verifyIdToken({
      idToken:  credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    var payload  = ticket.getPayload();
    var email    = payload.email;
    var name     = payload.name    || '';
    var avatar   = payload.picture || '';
    var googleId = payload.sub;

    /* ============================================
       FLOW 1 — INVITATION ACCEPTANCE
    ============================================ */
    if (inviteToken) {
      var invite = await PlatformInvitation.findOne({
        token:  inviteToken,
        status: 'pending'
      });

      if (!invite) {
        return res.status(400).json({
          success: false,
          message: 'This invitation is invalid or has already been used.'
        });
      }

      if (new Date() > invite.expiresAt) {
        invite.status = 'expired';
        await invite.save();
        return res.status(400).json({
          success: false,
          message: 'This invitation has expired. Please ask the platform administrator to send a new one.'
        });
      }

      if (invite.email && invite.email !== email) {
        return res.status(400).json({
          success: false,
          message: 'This invitation was sent to ' + invite.email +
                   '. Please sign in with that Google account.'
        });
      }

      /* Check for duplicate account */
      var dup = await PlatformStaff.findOne({ email: email });
      if (dup) {
        return res.status(400).json({
          success: false,
          message: 'A platform staff account already exists for this email. Please sign in directly.'
        });
      }

      /* Create the staff record */
      var ip = req.ip || '';
      var ua = (req.headers && req.headers['user-agent']) || '';

      var staff = await PlatformStaff.create({
        name:         name || invite.name || 'Platform Staff',
        email:        email,
        avatar:       avatar,
        googleId:     googleId,
        platformRole: invite.platformRole,
        status:       'active',
        isActive:     true,
        invitedBy:    invite.invitedBy || 'root',
        invitedAt:    invite.createdAt,
        joinedAt:     new Date(),
        lastLoginAt:  new Date(),
        loginHistory: [{ ip: ip, userAgent: ua, at: new Date() }]
      });

      invite.status     = 'accepted';
      invite.acceptedAt = new Date();
      invite.acceptedBy = staff._id;
      await invite.save();

      var token = signPlatformToken(staff._id, staff.platformRole);

      return res.status(201).json({
        success:    true,
        message:    'Welcome to LatLomp Platform Administration, ' + staff.name + '!',
        token:      token,
        staff: {
          _id:          staff._id,
          name:         staff.name,
          email:        staff.email,
          platformRole: staff.platformRole,
          roleLabel:    PlatformInvitation.getRoleLabel(staff.platformRole),
          avatar:       staff.avatar
        },
        redirectTo: '/platform/dashboard.html'
      });
    }

    /* ============================================
       FLOW 2 — RETURNING STAFF MEMBER
    ============================================ */
    var returningStaff = await PlatformStaff.findOne({ email: email });

    if (returningStaff) {
      if (returningStaff.status !== 'active' || !returningStaff.isActive) {
        return res.status(403).json({
          success: false,
          message: 'Your account has been suspended. Please contact the platform administrator.'
        });
      }

      /* Update Google credentials + login history */
      returningStaff.googleId    = googleId;
      returningStaff.avatar      = avatar;
      returningStaff.lastLoginAt = new Date();

      var ipR = req.ip || '';
      var uaR = (req.headers && req.headers['user-agent']) || '';

      /* Keep max 10 login history entries (newest first) */
      returningStaff.loginHistory = [{ ip: ipR, userAgent: uaR, at: new Date() }]
        .concat((returningStaff.loginHistory || []).slice(0, 9));

      await returningStaff.save();

      var returningToken = signPlatformToken(returningStaff._id, returningStaff.platformRole);

      return res.status(200).json({
        success:    true,
        message:    'Welcome back, ' + returningStaff.name + '!',
        token:      returningToken,
        staff: {
          _id:          returningStaff._id,
          name:         returningStaff.name,
          email:        returningStaff.email,
          platformRole: returningStaff.platformRole,
          roleLabel:    PlatformInvitation.getRoleLabel(returningStaff.platformRole),
          avatar:       returningStaff.avatar
        },
        redirectTo: '/platform/dashboard.html'
      });
    }

    /* No platform staff account found */
    return res.status(401).json({
      success: false,
      message: 'No platform administration account found for this Google account. ' +
               'If you received an invitation, please use the invitation link you were sent.'
    });

  } catch (err) {
    console.error('[PlatformAuth] POST /google:', err.message);
    return res.status(500).json({ success: false, message: 'Authentication failed. Please try again.' });
  }
});

/* ============================================
   GET /api/platform-auth/me
   Returns current platform staff profile.
   Protected by platformStaffProtect.
============================================ */
router.get('/me', platformStaffProtect, async function (req, res) {
  try {
    return res.status(200).json({
      success: true,
      staff: {
        _id:          req.platformStaff._id,
        name:         req.platformStaff.name,
        email:        req.platformStaff.email,
        platformRole: req.platformStaff.platformRole,
        roleLabel:    PlatformInvitation.getRoleLabel(req.platformStaff.platformRole),
        avatar:       req.platformStaff.avatar,
        lastLoginAt:  req.platformStaff.lastLoginAt,
        joinedAt:     req.platformStaff.joinedAt
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;