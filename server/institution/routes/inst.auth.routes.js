/* ============================================
   LATLOMP INSTITUTION — AUTH ROUTES

   POST /api/institution/auth/google
   GET  /api/institution/auth/me

   ✅ FOUNDATION FIX: Added returning user login path.

   ✅ RESTRUCTURE STAGE 5:
   FLOW 1 (invite acceptance) now copies the three
   new delegation fields from the Invitation record
   to the SchoolUser record when a staff member
   accepts their invitation for the first time:
     invite.assignedClassId      → user.classId
     invite.assignedDepartmentId → user.departmentId
     invite.additionalRoles      → user.additionalRoles
   All response user objects now include
   additionalRoles so the frontend can compute
   effective roles and render the correct dashboard.
============================================ */
'use strict';

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
============================================ */
router.post('/google', async (req, res) => {
  try {
    var { credential, inviteToken } = req.body;

    if (!credential) {
      return res.status(400).json({ success: false, message: 'Google credential is required.' });
    }

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
       FLOW 1 — TEACHER / STAFF INVITE ACCEPTANCE
       ✅ STAGE 5: copies delegation fields from
       Invitation to SchoolUser on first login.
    ============================================ */
    if (inviteToken) {
      var invite = await Invitation.findOne({ token: inviteToken, status: 'pending' });

      if (!invite) {
        logAudit({ req, action: 'institution.auth.teacher_invite.invalid', success: false, message: 'Invalid or expired invite token used by: ' + email });
        return res.status(400).json({ success: false, message: 'Invalid or expired invitation.' });
      }

      if (new Date() > invite.expiresAt) {
        invite.status = 'expired';
        await invite.save();
        logAudit({ req, action: 'institution.auth.teacher_invite.expired', success: false, message: 'Expired invite used by: ' + email });
        return res.status(400).json({ success: false, message: 'This invitation has expired. Please ask your school admin to send a new invitation.' });
      }

      if (invite.email && invite.email !== email) {
        logAudit({ req, action: 'institution.auth.teacher_invite.email_mismatch', success: false, message: 'Invite email mismatch: expected ' + invite.email + ', got ' + email });
        return res.status(400).json({ success: false, message: 'This invitation was sent to ' + invite.email + '. Please sign in with that Google account.' });
      }

      /* Create or update the staff member's SchoolUser record.
         ✅ STAGE 5: classId, departmentId, additionalRoles
         are now copied from the Invitation to SchoolUser
         so the delegation model takes effect immediately
         on first login. */
      var teacher = await SchoolUser.findOneAndUpdate(
        { schoolId: invite.schoolId, email: email },
        {
          $set: {
            name:            name || invite.name,
            avatar:          avatar,
            googleId:        googleId,
            role:            invite.role,
            subjects:        invite.subjects        || [],
            classes:         invite.classes         || [],
            /* ✅ STAGE 5: delegation fields */
            classId:         invite.assignedClassId       || null,
            departmentId:    invite.assignedDepartmentId  || null,
            additionalRoles: invite.additionalRoles       || [],
            isVerified:      true,
            isActive:        true,
            invitedBy:       invite.invitedBy,
            invitedAt:       invite.createdAt,
            joinedAt:        new Date(),
            lastLoginAt:     new Date()
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
        action: 'institution.auth.teacher_invite.accepted', resource: 'SchoolUser',
        resourceId: teacher._id.toString(), success: true,
        message: 'Staff accepted invite: ' + email + ' → school: ' + invite.schoolId
      });

      return res.status(200).json({
        success: true,
        message: 'Welcome to ' + (school ? school.name : 'the school') + '!',
        token:   token,
        user: {
          _id:             teacher._id,
          name:            teacher.name,
          email:           teacher.email,
          role:            teacher.role,
          /* ✅ STAGE 5: included in response */
          additionalRoles: teacher.additionalRoles || [],
          avatar:          teacher.avatar,
          schoolId:        teacher.schoolId
        },
        school:     school ? { _id: school._id, name: school.name, logo: school.logo } : null,
        redirectTo: '/institution/teacher/dashboard.html'
      });
    }

    /* ============================================
       FLOW 2 — RETURNING USER
       ✅ FOUNDATION FIX: checks SchoolUser first.
       ✅ STAGE 5: additionalRoles included in response.
    ============================================ */
    var existingUser = await SchoolUser.findOne({ email: email }).populate('schoolId');

    if (existingUser) {
      if (!existingUser.isActive) {
        logAudit({
          req, action: 'institution.auth.login.deactivated',
          resource: 'SchoolUser', resourceId: existingUser._id.toString(),
          success: false, message: 'Deactivated account login attempt: ' + email
        });
        return res.status(403).json({
          success: false,
          message: 'Your account has been deactivated. Please contact your school administrator to reactivate it.'
        });
      }

      existingUser.googleId    = googleId;
      existingUser.avatar      = avatar;
      existingUser.lastLoginAt = new Date();
      await existingUser.save();

      var userSchool   = existingUser.schoolId;
      var userSchoolId = userSchool && userSchool._id ? userSchool._id : userSchool;

      if (!userSchool || typeof userSchool === 'string' || !userSchool.name) {
        userSchool = await School.findById(userSchoolId);
      }

      if (!userSchool) {
        logAudit({
          req, action: 'institution.auth.login.orphaned_user',
          resource: 'SchoolUser', resourceId: existingUser._id.toString(),
          success: false, message: 'SchoolUser exists but school is missing: ' + email
        });
        return res.status(404).json({ success: false, message: 'Your school account could not be found. Please contact support.' });
      }

      var returningToken = signInstToken(existingUser._id, userSchoolId);

      var redirectTo;
      if (existingUser.role === 'school_admin') {
        redirectTo = userSchool.onboardingDone
          ? '/institution/school/dashboard.html'
          : '/institution/onboarding.html';
      } else {
        redirectTo = '/institution/teacher/dashboard.html';
      }

      logAudit({
        req, action: 'institution.auth.login',
        resource: 'SchoolUser', resourceId: existingUser._id.toString(),
        success: true, message: 'Returning user login: ' + email + ' (' + existingUser.role + ')'
      });

      return res.status(200).json({
        success: true,
        message: 'Welcome back, ' + existingUser.name + '!',
        token:   returningToken,
        user: {
          _id:             existingUser._id,
          name:            existingUser.name,
          email:           existingUser.email,
          role:            existingUser.role,
          /* ✅ STAGE 5: included in response */
          additionalRoles: existingUser.additionalRoles || [],
          avatar:          existingUser.avatar,
          schoolId:        userSchoolId
        },
        school:     userSchool,
        redirectTo: redirectTo
      });
    }

    /* ============================================
       FLOW 3 — NEW SCHOOL OR ADMIN RECOVERY
    ============================================ */
    var existingSchool = await School.findOne({ email: email });

    if (existingSchool) {
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
        req, action: 'institution.auth.login',
        resource: 'SchoolUser', resourceId: schoolUser._id.toString(),
        success: true, message: 'School admin login (recovery): ' + email
      });

      return res.status(200).json({
        success: true, message: 'Welcome back, ' + name + '!',
        token:   adminToken,
        user: {
          _id:             schoolUser._id,
          name:            schoolUser.name,
          email:           schoolUser.email,
          role:            schoolUser.role,
          additionalRoles: schoolUser.additionalRoles || [],
          avatar:          schoolUser.avatar,
          schoolId:        existingSchool._id
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
      req, action: 'institution.auth.register',
      resource: 'School', resourceId: newSchool._id.toString(),
      success: true, message: 'New school admin registered: ' + email
    });

    return res.status(201).json({
      success: true, message: "Welcome! Let's set up your school.",
      token:   newToken,
      user: {
        _id:             newSchoolUser._id,
        name:            newSchoolUser.name,
        email:           newSchoolUser.email,
        role:            newSchoolUser.role,
        additionalRoles: [],
        avatar:          newSchoolUser.avatar,
        schoolId:        newSchool._id
      },
      school:     newSchool,
      redirectTo: '/institution/onboarding.html',
      isNew:      true
    });

  } catch (err) {
    console.error('[InstAuth] Google auth error:', err.message);
    logAudit({ req, action: 'institution.auth.error', success: false, message: err.message });
    return res.status(500).json({ success: false, message: 'Authentication failed. Please try again.' });
  }
});

/* ============================================
   GET /api/institution/auth/me
   ✅ STAGE 5: additionalRoles included in response.
============================================ */
router.get('/me', instProtect, async (req, res) => {
  try {
    var school = await School.findById(req.schoolId);
    return res.status(200).json({
      success: true,
      user: {
        _id:             req.schoolUser._id,
        name:            req.schoolUser.name,
        email:           req.schoolUser.email,
        role:            req.schoolUser.role,
        /* ✅ STAGE 5: included in response */
        additionalRoles: req.schoolUser.additionalRoles || [],
        avatar:          req.schoolUser.avatar,
        schoolId:        req.schoolId
      },
      school: school
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;