/* ============================================
   LATLOMP INSTITUTION — AUTH ROUTES

   POST /api/institution/auth/google
   GET  /api/institution/auth/me

   ✅ FOUNDATION FIX: Added returning user login path.
   Previously, any Google account without an active
   invite token that did not match a School.email
   would create a new ghost school. Now the route
   checks SchoolUser first, so all returning teachers,
   vice principals, and admins are correctly identified
   before any school creation is attempted.
============================================ */
const express          = require('express');
const router           = express.Router();
const { OAuth2Client } = require('google-auth-library');
const School           = require('../models/School.model');
const SchoolUser       = require('../models/SchoolUser.model');
const Invitation       = require('../models/Invitation.model');
const { signInstToken, instProtect } = require('../middleware/inst.auth');
const { logAudit }     = require('../../middleware/audit.middleware');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/* ============================================
   POST /api/institution/auth/google

   THREE FLOWS, checked in this order:
   1. INVITE TOKEN  — teacher accepting an invitation
   2. RETURNING USER — any existing SchoolUser logging
                       back in (teacher, admin, etc.)
   3. NEW SCHOOL    — first-time school registration
                       (only when no SchoolUser exists)
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
       FLOW 1 — TEACHER INVITE
       Only runs when an invite token is present in
       the request. This is the first-time activation
       path for invited teachers.
    ============================================ */
    if (inviteToken) {
      var invite = await Invitation.findOne({
        token:  inviteToken,
        status: 'pending'
      });

      if (!invite) {
        logAudit({
          req,
          action:  'institution.auth.teacher_invite.invalid',
          success: false,
          message: 'Invalid or expired invite token used by: ' + email
        });
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired invitation.'
        });
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
        return res.status(400).json({
          success: false,
          message: 'This invitation has expired. Please ask your school admin to send a new invitation.'
        });
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
          message: 'This invitation was sent to ' + invite.email + '. Please sign in with that Google account.'
        });
      }

      /* Create or update the teacher's SchoolUser record */
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
        school:     school ? {
          _id:  school._id,
          name: school.name,
          logo: school.logo
        } : null,
        redirectTo: '/institution/teacher/dashboard.html'
      });
    }

    /* ============================================
       FLOW 2 — RETURNING USER
       ✅ FOUNDATION FIX: This block is new.

       Before attempting any school lookup or creation,
       check whether this Google account already belongs
       to an existing SchoolUser in the system.

       This correctly handles:
       - Teachers logging in after their invite was
         accepted (on any device, any browser)
       - Vice principals returning after activation
       - School admins who already have a SchoolUser
         record (also caught here, slightly faster path)

       One email = one school. If the same person is
       a teacher at two schools, they would have two
       Google accounts — this system does not support
       multi-school membership per email.
    ============================================ */
    var existingUser = await SchoolUser.findOne({ email: email })
      .populate('schoolId');

    if (existingUser) {

      /* ---- Account deactivated — tell them clearly ---- */
      if (!existingUser.isActive) {
        logAudit({
          req,
          action:  'institution.auth.login.deactivated',
          resource:   'SchoolUser',
          resourceId: existingUser._id.toString(),
          success: false,
          message: 'Deactivated account login attempt: ' + email
        });
        return res.status(403).json({
          success: false,
          message: 'Your account has been deactivated. Please contact your school administrator to reactivate it.'
        });
      }

      /* ---- Update Google credentials on every login ---- */
      existingUser.googleId    = googleId;
      existingUser.avatar      = avatar;
      existingUser.lastLoginAt = new Date();
      await existingUser.save();

      var userSchool = existingUser.schoolId;
      var userSchoolId = userSchool && userSchool._id ? userSchool._id : userSchool;

      /* Ensure we have the full school object */
      if (!userSchool || typeof userSchool === 'string' || !userSchool.name) {
        userSchool = await School.findById(userSchoolId);
      }

      if (!userSchool) {
        /* School was deleted — very edge case */
        logAudit({
          req,
          action:  'institution.auth.login.orphaned_user',
          resource:   'SchoolUser',
          resourceId: existingUser._id.toString(),
          success: false,
          message: 'SchoolUser exists but school is missing: ' + email
        });
        return res.status(404).json({
          success: false,
          message: 'Your school account could not be found. Please contact support.'
        });
      }

      var returningToken = signInstToken(existingUser._id, userSchoolId);

      /* Determine correct redirect based on role */
      var redirectTo;
      if (existingUser.role === 'school_admin') {
        redirectTo = userSchool.onboardingDone
          ? '/institution/school/dashboard.html'
          : '/institution/onboarding.html';
      } else {
        redirectTo = '/institution/teacher/dashboard.html';
      }

      logAudit({
        req,
        action:     'institution.auth.login',
        resource:   'SchoolUser',
        resourceId: existingUser._id.toString(),
        success:    true,
        message:    'Returning user login: ' + email + ' (' + existingUser.role + ')'
      });

      return res.status(200).json({
        success:    true,
        message:    'Welcome back, ' + existingUser.name + '!',
        token:      returningToken,
        user: {
          _id:      existingUser._id,
          name:     existingUser.name,
          email:    existingUser.email,
          role:     existingUser.role,
          avatar:   existingUser.avatar,
          schoolId: userSchoolId
        },
        school:     userSchool,
        redirectTo: redirectTo
      });
    }

    /* ============================================
       FLOW 3 — SCHOOL ADMIN OR NEW REGISTRATION
       Only reached if NO SchoolUser exists with this
       email. This is now a much narrower path:
       - A genuine new school registration
       - OR an admin whose SchoolUser was accidentally
         deleted (handled below with auto-recreation)
    ============================================ */
    var existingSchool = await School.findOne({ email: email });

    if (existingSchool) {
      /* ---- Admin whose SchoolUser record is missing ---- */
      /* This is a recovery path for data integrity issues */
      var schoolUser = await SchoolUser.findOneAndUpdate(
        { schoolId: existingSchool._id, email: email },
        {
          $set: {
            googleId:    googleId,
            avatar:      avatar,
            lastLoginAt: new Date(),
            isVerified:  true,
            isActive:    true
          },
          $setOnInsert: {
            name:     name,
            role:     'school_admin',
            joinedAt: new Date()
          }
        },
        { upsert: true, new: true }
      );

      var adminToken = signInstToken(schoolUser._id, existingSchool._id);

      logAudit({
        req,
        action:     'institution.auth.login',
        resource:   'SchoolUser',
        resourceId: schoolUser._id.toString(),
        success:    true,
        message:    'School admin login (recovery): ' + email
      });

      return res.status(200).json({
        success:    true,
        message:    'Welcome back, ' + name + '!',
        token:      adminToken,
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
    }

    /* ---- Genuine new school registration ---- */
    var newSchool = await School.create({
      name:               name + "'s School",
      email:              email,
      ownerGoogleId:      googleId,
      ownerEmail:         email,
      status:             'trial',
      subscriptionPlan:   'trial',
      trialUsed:          true,
      trialStartDate:     new Date(),
      subscriptionExpiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    var newSchoolUser = await SchoolUser.create({
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

    var newToken = signInstToken(newSchoolUser._id, newSchool._id);

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
      token:      newToken,
      user: {
        _id:      newSchoolUser._id,
        name:     newSchoolUser.name,
        email:    newSchoolUser.email,
        role:     newSchoolUser.role,
        avatar:   newSchoolUser.avatar,
        schoolId: newSchool._id
      },
      school:     newSchool,
      redirectTo: '/institution/onboarding.html',
      isNew:      true
    });

  } catch (err) {
    console.error('[InstAuth] Google auth error:', err.message);
    logAudit({
      req,
      action:  'institution.auth.error',
      success: false,
      message: err.message
    });
    return res.status(500).json({
      success: false,
      message: 'Authentication failed. Please try again.'
    });
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