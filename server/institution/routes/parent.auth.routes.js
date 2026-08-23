'use strict';
const express                = require('express');
const router                 = express.Router();
const { OAuth2Client }       = require('google-auth-library');
const SchoolParent           = require('../models/SchoolParent.model');
const SchoolStudent          = require('../models/SchoolStudent.model');
const SchoolParentInvitation = require('../models/SchoolParentInvitation.model');
const { signParentToken, parentProtect } = require('../middleware/parent.auth');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/* ============================================
   POST /api/institution/parent/auth/google

   Handles TWO flows with one endpoint:

   FLOW 1 — First-time (invite):
     Body: { credential, inviteToken }
     - Verify Google credential
     - Validate invitation (token, expiry, email match)
     - Create/find SchoolParent by email
     - Link only institution-approved students
     - Mark invitation accepted
     - Issue parent JWT

   FLOW 2 — Returning parent:
     Body: { credential }
     - Verify Google credential
     - Find existing SchoolParent by email
     - Issue parent JWT
     - If no account found → 404 (they need an invitation)
============================================ */
router.post('/google', async (req, res) => {
  try {
    var { credential, inviteToken } = req.body;

    if (!credential) {
      return res.status(400).json({
        success: false,
        message: 'Google credential is required.'
      });
    }

    /* Verify Google token */
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
       FLOW 1 — First-time via invitation
    ============================================ */
    if (inviteToken) {
      var invite = await SchoolParentInvitation.findOne({
        token:  inviteToken,
        status: 'pending'
      });

      if (!invite) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or already used invitation link. Please ask the institution for a new one.'
        });
      }

      if (new Date() > invite.expiresAt) {
        invite.status = 'expired';
        await invite.save();
        return res.status(400).json({
          success: false,
          message: 'This invitation has expired. Please ask the institution to send a new one.'
        });
      }

      /* Email must exactly match what institution specified */
      if (invite.parentEmail && invite.parentEmail !== email.toLowerCase()) {
        return res.status(403).json({
          success: false,
          message: 'This invitation was sent to ' + invite.parentEmail +
                   '. Please sign in with that Google account.'
        });
      }

      /* Create or update parent account */
      var parent = await SchoolParent.findOne({ email: email.toLowerCase() });
      if (!parent) {
        parent = new SchoolParent({
          name:     name || invite.parentName || '',
          email:    email.toLowerCase(),
          avatar:   avatar,
          googleId: googleId
        });
      } else {
        parent.googleId    = googleId;
        parent.avatar      = avatar;
        parent.lastLoginAt = new Date();
      }

      /* Link only institution-approved students — parent cannot choose */
      var newLinks = 0;
      for (var i = 0; i < invite.studentIds.length; i++) {
        var sid     = invite.studentIds[i];
        var already = parent.linkedStudents.some(function (ls) {
          return ls.studentId.toString() === sid.toString();
        });
        if (!already) {
          parent.linkedStudents.push({
            studentId:    sid,
            schoolId:     invite.schoolId,
            relationship: 'parent'
          });
          newLinks++;
        }
      }

      parent.lastLoginAt = new Date();
      await parent.save();

      invite.status     = 'accepted';
      invite.acceptedAt = new Date();
      await invite.save();

      var token = signParentToken(parent._id);

      return res.status(200).json({
        success:  true,
        message:  'Welcome! ' + newLinks + ' child(ren) linked to your account.',
        token,
        parent: {
          _id:            parent._id,
          name:           parent.name,
          email:          parent.email,
          avatar:         parent.avatar,
          linkedStudents: parent.linkedStudents
        },
        redirectTo: '/institution/parent/dashboard.html'
      });
    }

    /* ============================================
       FLOW 2 — Returning parent (no invite token)
    ============================================ */
    var returningParent = await SchoolParent.findOne({ email: email.toLowerCase() });

    if (!returningParent) {
      return res.status(404).json({
        success: false,
        message: 'No Parent Portal account found for this Google account. ' +
                 'Please use the invitation link sent by your institution.'
      });
    }

    if (!returningParent.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact the institution.'
      });
    }

    returningParent.googleId    = googleId;
    returningParent.avatar      = avatar;
    returningParent.lastLoginAt = new Date();
    await returningParent.save();

    var returningToken = signParentToken(returningParent._id);

    return res.status(200).json({
      success:  true,
      message:  'Welcome back, ' + returningParent.name + '!',
      token:    returningToken,
      parent: {
        _id:            returningParent._id,
        name:           returningParent.name,
        email:          returningParent.email,
        avatar:         returningParent.avatar,
        linkedStudents: returningParent.linkedStudents
      },
      redirectTo: '/institution/parent/dashboard.html'
    });

  } catch (err) {
    console.error('[ParentAuth] Google:', err.message);
    if (err.message && err.message.includes('Token used too late')) {
      return res.status(401).json({ success: false, message: 'Google sign-in expired. Please try again.' });
    }
    return res.status(500).json({ success: false, message: 'Authentication failed. Please try again.' });
  }
});

/* ============================================
   GET /api/institution/parent/auth/me
============================================ */
router.get('/me', parentProtect, async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      parent: {
        _id:            req.parent._id,
        name:           req.parent.name,
        email:          req.parent.email,
        avatar:         req.parent.avatar,
        linkedStudents: req.parent.linkedStudents
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/* ============================================
   GET /api/institution/parent/auth/invite-info/:token

   Called by login.html to pre-fill the page
   before the parent clicks Continue with Google.
============================================ */
router.get('/invite-info/:token', async (req, res) => {
  try {
    var invite = await SchoolParentInvitation.findOne({
      token:  req.params.token,
      status: 'pending'
    }).select('parentEmail parentName expiresAt schoolId studentIds');

    if (!invite) {
      return res.status(404).json({ success: false, message: 'Invalid or expired invitation.' });
    }
    if (new Date() > invite.expiresAt) {
      return res.status(400).json({ success: false, message: 'This invitation has expired.' });
    }

    var students = await SchoolStudent.find({ _id: { $in: invite.studentIds } })
      .select('name admissionNo class arm').lean();

    var School = require('../models/School.model');
    var school = await School.findById(invite.schoolId).select('name logo').lean();

    return res.status(200).json({
      success:     true,
      parentEmail: invite.parentEmail,
      parentName:  invite.parentName,
      childCount:  invite.studentIds.length,
      school:      school ? { name: school.name, logo: school.logo } : null,
      students:    students.map(function (s) {
        return { name: s.name, admissionNo: s.admissionNo, class: s.class, arm: s.arm };
      })
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;