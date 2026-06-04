/* ============================================
   LATLOMP INSTITUTION — AUTH ROUTES

   POST /api/institution/auth/google
   GET  /api/institution/auth/me
============================================ */
const express      = require('express');
const router       = express.Router();
const { OAuth2Client } = require('google-auth-library');
const School       = require('../models/School.model');
const SchoolUser   = require('../models/SchoolUser.model');
const Invitation   = require('../models/Invitation.model');
const { signInstToken, instProtect } = require('../middleware/inst.auth');
const { logAudit } = require('../../middleware/audit.middleware');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/* ============================================
   POST /api/institution/auth/google
============================================ */
router.post('/google', async (req, res) => {
  try {
    var { credential, inviteToken } = req.body;

    if (!credential) {
      return res.status(400).json({ success: false, message: 'Google credential is required.' });
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
    var googleId = payload.sub;    /* Google's permanent unique ID for this user */

    /* ============================================
       TEACHER FLOW — via invitation token
    ============================================ */
    if (inviteToken) {
      var invite = await Invitation.findOne({ token: inviteToken, status: 'pending' });

      if (!invite) {
        logAudit({
          req,
          action:  'institution.auth.teacher_invite.invalid',
          success: false,
          message: 'Invalid or expired invite token used by: ' + email
        });
        return res.status(400).json({ success: false, message: 'Invalid or expired invitation.' });
      }

      if (new Date() > invite.expiresAt) {
        invite.status = 'expired';
        await invite.save();
        logAudit({
          req,
          action:  'institution.auth.teacher_invite.expired',
          success: false,
          message: 'Expired invite used by: ' + email
        });
        return res.status(400).json({ success: false, message: 'This invitation has expired.' });
      }

      if (invite.email && invite.email !== email) {
        logAudit({
          req,
          action:  'institution.auth.teacher_invite.email_mismatch',
          success: false,
          message: 'Invite email mismatch: expected ' + invite.email + ', got ' + email
        });
        return res.status(400).json({
          success: false,
          message: 'This invitation was sent to a different email address. Please use ' + invite.email
        });
      }

      /* Create or update teacher */
      var teacher = await SchoolUser.findOneAndUpdate(
        { schoolId: invite.schoolId, email: email },
        {
          $set: {
            name:        name || invite.name,
            avatar:      avatar,
            googleId:    googleId,
            role:        invite.role,
            subjects:    invite.subjects || [],
            classes:     invite.classes  || [],
            isVerified:  true,
            isActive:    true,
            invitedBy:   invite.invitedBy,
            invitedAt:   invite.createdAt,
            joinedAt:    new Date(),
            lastLoginAt: new Date()
          }
        },
        { upsert: true, new: true }
      );

      invite.status     = 'accepted';
      invite.acceptedAt = new Date();
      await invite.save();

      var school = await School.findById(invite.schoolId);
      var token  = signInstToken(teacher._id, invite.schoolId);

      logAudit({
        req,
        action:     'institution.auth.teacher_invite.accepted',
        resource:   'SchoolUser',
        resourceId: teacher._id.toString(),
        success:    true,
        message:    'Teacher accepted invite: ' + email + ' → school: ' + invite.schoolId
      });

      return res.status(200).json({
        success:    true,
        message:    'Welcome to ' + (school ? school.name : 'the school') + '!',
        token:      token,
        user: {
          _id:      teacher._id,
          name:     teacher.name,
          email:    teacher.email,
          role:     teacher.role,
          avatar:   teacher.avatar,
          schoolId: teacher.schoolId
        },
        school:     school ? { _id: school._id, name: school.name, logo: school.logo } : null,
        redirectTo: '/institution/teacher/dashboard.html'
      });
    }

    /* ============================================
       SCHOOL ADMIN FLOW — sign in or register
    ============================================ */
    var existingSchool = await School.findOne({ email: email });

    if (existingSchool) {
      /* ---- Returning school admin ---- */
      var schoolUser = await SchoolUser.findOneAndUpdate(
        { schoolId: existingSchool._id, email: email },
        { $set: { googleId: googleId, avatar: avatar, lastLoginAt: new Date() } },
        { new: true }
      );

      if (!schoolUser) {
        /* SchoolUser record missing — recreate it */
        schoolUser = await SchoolUser.create({
          schoolId:    existingSchool._id,
          name:        name,
          email:       email,
          avatar:      avatar,
          googleId:    googleId,
          role:        'school_admin',
          isVerified:  true,
          isActive:    true,
          joinedAt:    new Date(),
          lastLoginAt: new Date()
        });
      }

      var token = signInstToken(schoolUser._id, existingSchool._id);

      logAudit({
        req,
        action:     'institution.auth.login',
        resource:   'SchoolUser',
        resourceId: schoolUser._id.toString(),
        success:    true,
        message:    'School admin login: ' + email
      });

      return res.status(200).json({
        success:    true,
        message:    'Welcome back, ' + name + '!',
        token:      token,
        user: {
          _id:      schoolUser._id,
          name:     schoolUser.name,
          email:    schoolUser.email,
          role:     schoolUser.role,
          avatar:   schoolUser.avatar,
          schoolId: existingSchool._id
        },
        school:     existingSchool,
        redirectTo: existingSchool.onboardingDone
          ? '/institution/school/dashboard.html'
          : '/institution/onboarding.html'
      });

    } else {
      /* ---- New school registration ---- */
      /*
        ✅ FIX: Removed ownerId: req.body.platformUserId || null
        That was always null for Google institution sign-in because
        the frontend never sends platformUserId. null was rejected
        by the required:true validator on ownerId, causing:
        "School validation failed: ownerId: Path ownerId is required."

        Now we store ownerGoogleId and ownerEmail instead.
        ownerId is optional (default: null) so it no longer crashes.
        It can be linked to a main platform User later if needed.
      */
      var newSchool = await School.create({
        name:          name + "'s School",
        email:         email,
        ownerGoogleId: googleId,   /* ✅ permanent Google ID of the owner */
        ownerEmail:    email,      /* ✅ email for admin lookup */
        /* ownerId left as null (optional) — no main platform User needed */
        status:        'trial',
        subscriptionPlan:  'trial',
        trialUsed:         true,
        trialStartDate:    new Date(),
        subscriptionExpiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) /* 7 days */
      });

      var schoolUser = await SchoolUser.create({
        schoolId:    newSchool._id,
        name:        name,
        email:       email,
        avatar:      avatar,
        googleId:    googleId,
        role:        'school_admin',
        isVerified:  true,
        isActive:    true,
        joinedAt:    new Date(),
        lastLoginAt: new Date()
      });

      var token = signInstToken(schoolUser._id, newSchool._id);

      logAudit({
        req,
        action:     'institution.auth.register',
        resource:   'School',
        resourceId: newSchool._id.toString(),
        success:    true,
        message:    'New school admin registered: ' + email
      });

      return res.status(201).json({
        success:    true,
        message:    "Welcome! Let's set up your school.",
        token:      token,
        user: {
          _id:      schoolUser._id,
          name:     schoolUser.name,
          email:    schoolUser.email,
          role:     schoolUser.role,
          avatar:   schoolUser.avatar,
          schoolId: newSchool._id
        },
        school:     newSchool,
        redirectTo: '/institution/onboarding.html',
        isNew:      true
      });
    }

  } catch (err) {
    console.error('[InstAuth] Google auth error:', err.message);

    logAudit({
      req,
      action:  'institution.auth.login.failed',
      success: false,
      message: err.message
    });

    return res.status(500).json({ success: false, message: 'Authentication failed. Please try again.' });
  }
});

/* ============================================
   GET /api/institution/auth/me
============================================ */
router.get('/me', instProtect, async (req, res) => {
  try {
    var school = await School.findById(req.schoolId);

    return res.status(200).json({
      success: true,
      user: {
        _id:      req.schoolUser._id,
        name:     req.schoolUser.name,
        email:    req.schoolUser.email,
        role:     req.schoolUser.role,
        avatar:   req.schoolUser.avatar,
        schoolId: req.schoolId
      },
      school: school
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;