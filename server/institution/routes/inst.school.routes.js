/* ============================================
   LATLOMP INSTITUTION — SCHOOL ADMIN ROUTES
============================================ */
const express      = require('express');
const router       = express.Router();
const School       = require('../models/School.model');
const SchoolUser   = require('../models/SchoolUser.model');
const SchoolExam   = require('../models/SchoolExam.model');
const SchoolResult = require('../models/SchoolResult.model');
const Invitation   = require('../models/Invitation.model');
const { SubscriptionPlan, Subscription } = require('../models/Subscription.model');
const { instProtect, schoolAdminOnly }   = require('../middleware/inst.auth');
const { requireActiveSubscription }      = require('../middleware/inst.tenant');
const emailService = require('../services/inst.email.service');

/* ============================================
   POST /api/institution/school/onboarding
============================================ */
router.post('/onboarding', instProtect, async (req, res) => {
  try {
    var school = await School.findById(req.schoolId);
    if (!school) return res.status(404).json({ success: false, message: 'School not found.' });

    var allowed = [
      'name', 'phone', 'address', 'state', 'country', 'type',
      'principalName', 'totalStudents', 'primaryColor', 'secondaryColor',
      'motto', 'website'
    ];
    allowed.forEach(function(field) {
      if (req.body[field] !== undefined) school[field] = req.body[field];
    });
    if (req.body.logo) school.logo = req.body.logo;
    school.onboardingDone = true;

    if (!school.trialUsed) {
      school.status             = 'trial';
      school.subscriptionPlan   = 'trial';
      school.trialUsed          = true;
      school.trialStartDate     = new Date();
      school.subscriptionExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await Subscription.create({
        schoolId:    school._id,
        plan:        'trial',
        planName:    'Free Trial',
        amount:      0,
        startDate:   new Date(),
        endDate:     school.subscriptionExpiry,
        status:      'active',
        isTrial:     true,
        activatedBy: 'system',
        paidAt:      new Date(),
        paidAmount:  0
      });
    }
    await school.save();

    try {
      await emailService.sendSchoolWelcome({
        toEmail:       school.email,
        schoolName:    school.name,
        principalName: req.body.principalName || req.schoolUser.name,
        trialExpiry:   school.subscriptionExpiry,
        dashboardUrl:  (process.env.APP_URL || '') + '/institution/school/dashboard.html'
      });
    } catch (emailErr) {
      console.warn('[Onboarding] Welcome email failed:', emailErr.message);
    }

    return res.status(200).json({
      success:    true,
      message:    'School setup complete! Your 7-day free trial has started.',
      school:     school,
      redirectTo: '/institution/school/dashboard.html'
    });
  } catch (err) {
    console.error('[Onboarding] Error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/school/dashboard
============================================ */
router.get('/dashboard', instProtect, requireActiveSubscription, async (req, res) => {
  try {
    var schoolId = req.schoolId;
    var [teacherCount, examCount, resultCount, inviteCount] = await Promise.all([
      SchoolUser.countDocuments({ schoolId, role: { $in: ['teacher','vice_principal'] }, isActive: true }),
      SchoolExam.countDocuments({ schoolId }),
      SchoolResult.countDocuments({ schoolId }),
      Invitation.countDocuments({ schoolId, status: 'pending' })
    ]);
    var recentExams = await SchoolExam.find({ schoolId })
      .sort({ createdAt: -1 }).limit(5)
      .select('title subject status createdAt totalAttempts accessCode');
    var school   = req.school;
    var daysLeft = 0;
    if (school.subscriptionExpiry) {
      daysLeft = Math.max(0, Math.ceil(
        (new Date(school.subscriptionExpiry) - new Date()) / (1000 * 60 * 60 * 24)
      ));
    }
    return res.status(200).json({
      success: true,
      stats: {
        teachers:           teacherCount,
        exams:              examCount,
        results:            resultCount,
        pendingInvites:     inviteCount,
        daysLeft:           daysLeft,
        subscriptionPlan:   school.subscriptionPlan,
        subscriptionExpiry: school.subscriptionExpiry
      },
      recentExams: recentExams,
      school:      school
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/school/plans
   Public — no auth required
============================================ */
router.get('/plans', async (req, res) => {
  try {
    var plans = await SubscriptionPlan.find({ isActive: true }).sort({ sortOrder: 1 });
    return res.status(200).json({ success: true, plans });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /api/institution/school/subscribe
============================================ */
router.post('/subscribe', instProtect, async (req, res) => {
  try {
    var { planCode } = req.body;
    var school = await School.findById(req.schoolId);
    var plan   = await SubscriptionPlan.findOne({ code: planCode, isActive: true });
    if (!school) return res.status(404).json({ success: false, message: 'School not found.' });
    if (!plan)   return res.status(400).json({ success: false, message: 'Plan not found.' });

    var reference   = 'INST-' + school._id + '-' + Date.now();
    var callbackUrl = (process.env.APP_URL || 'https://latlompsystem.up.railway.app') +
      '/institution/school/dashboard.html?payment=success&ref=' + reference;

    var paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method:  'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.PAYSTACK_SECRET_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email:        school.email,
        amount:       plan.price * 100,
        reference:    reference,
        callback_url: callbackUrl,
        metadata: {
          schoolId:   school._id.toString(),
          planCode:   planCode,
          planName:   plan.name,
          schoolName: school.name,
          type:       'institution_subscription'
        }
      })
    });
    var paystackData = await paystackRes.json();
    if (!paystackData.status) {
      return res.status(400).json({ success: false, message: 'Payment initialization failed.' });
    }

    await Subscription.create({
      schoolId:   school._id,
      plan:       planCode,
      planName:   plan.name,
      amount:     plan.price,
      startDate:  new Date(),
      endDate:    new Date(Date.now() + plan.durationDays * 24 * 60 * 60 * 1000),
      status:     'pending',
      paymentRef: reference
    });

    return res.status(200).json({
      success:    true,
      paymentUrl: paystackData.data.authorization_url,
      reference:  reference,
      amount:     plan.price,
      plan:       plan
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /api/institution/school/invite-teacher
============================================ */
router.post('/invite-teacher', instProtect, schoolAdminOnly, requireActiveSubscription, async (req, res) => {
  try {
    var { email, name, role, subjects, classes, message } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });

    var existing = await SchoolUser.findOne({ schoolId: req.schoolId, email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'This person is already a member of your school.' });
    }

    await Invitation.updateMany(
      { schoolId: req.schoolId, email: email.toLowerCase(), status: 'pending' },
      { $set: { status: 'cancelled' } }
    );

    var invite = await Invitation.create({
      schoolId:  req.schoolId,
      invitedBy: req.schoolUser._id,
      email:     email.toLowerCase(),
      name:      name    || '',
      role:      role    || 'teacher',
      subjects:  Array.isArray(subjects) ? subjects : (subjects ? subjects.split(',').map(function(s){return s.trim();}) : []),
      classes:   Array.isArray(classes)  ? classes  : (classes  ? classes.split(',').map(function(s){return s.trim();}) : []),
      message:   message || ''
    });

    var school    = req.school;
    var inviteUrl = (process.env.APP_URL || 'https://latlompsystem.up.railway.app') +
      '/institution/index.html?invite=' + invite.token;

    try {
      await emailService.sendTeacherInvite({
        toEmail:     email.toLowerCase(),
        toName:      name    || '',
        schoolName:  school.name,
        inviterName: req.schoolUser.name,
        role:        role    || 'teacher',
        inviteUrl:   inviteUrl,
        expiresAt:   invite.expiresAt
      });
    } catch (emailErr) {
      console.warn('[InviteTeacher] Email failed:', emailErr.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Invitation sent to ' + email,
      invite: {
        _id:       invite._id,
        email:     invite.email,
        name:      invite.name,
        role:      invite.role,
        token:     invite.token,
        inviteUrl: inviteUrl,
        expiresAt: invite.expiresAt
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/school/teachers
============================================ */
router.get('/teachers', instProtect, schoolAdminOnly, requireActiveSubscription, async (req, res) => {
  try {
    var teachers = await SchoolUser.find({
      schoolId: req.schoolId,
      role:     { $in: ['teacher', 'vice_principal'] }
    }).select('-googleId').sort({ name: 1 });

    var pendingInvites = await Invitation.find({
      schoolId: req.schoolId,
      status:   'pending'
    }).sort({ createdAt: -1 });

    return res.status(200).json({ success: true, teachers, pendingInvites });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   DELETE /api/institution/school/teachers/:id
   Permanently remove a teacher from the school.
   Their login immediately stops working.
============================================ */
router.delete('/teachers/:id', instProtect, schoolAdminOnly, requireActiveSubscription, async (req, res) => {
  try {
    var teacher = await SchoolUser.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId,
      role:     { $in: ['teacher', 'vice_principal'] }
    });

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found in your school.' });
    }

    /* Cancel any pending invites for this email */
    await Invitation.updateMany(
      { schoolId: req.schoolId, email: teacher.email, status: 'pending' },
      { $set: { status: 'cancelled' } }
    );

    await SchoolUser.findByIdAndDelete(req.params.id);

    return res.status(200).json({
      success: true,
      message: teacher.name + ' has been permanently removed from your school.'
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /api/institution/school/teachers/:id/deactivate
   Blocks teacher login immediately.
   instProtect middleware checks isActive on every
   request, so this takes effect instantly.
============================================ */
router.put('/teachers/:id/deactivate', instProtect, schoolAdminOnly, requireActiveSubscription, async (req, res) => {
  try {
    var teacher = await SchoolUser.findOneAndUpdate(
      {
        _id:      req.params.id,
        schoolId: req.schoolId,
        role:     { $in: ['teacher', 'vice_principal'] }
      },
      { $set: { isActive: false } },
      { new: true }
    ).select('-googleId');

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found in your school.' });
    }

    return res.status(200).json({
      success: true,
      message: teacher.name + '\'s account has been deactivated. They can no longer log in.',
      teacher: teacher
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /api/institution/school/teachers/:id/reactivate
   Restores teacher login access immediately.
============================================ */
router.put('/teachers/:id/reactivate', instProtect, schoolAdminOnly, requireActiveSubscription, async (req, res) => {
  try {
    var teacher = await SchoolUser.findOneAndUpdate(
      {
        _id:      req.params.id,
        schoolId: req.schoolId,
        role:     { $in: ['teacher', 'vice_principal'] }
      },
      { $set: { isActive: true } },
      { new: true }
    ).select('-googleId');

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found in your school.' });
    }

    return res.status(200).json({
      success: true,
      message: teacher.name + '\'s account has been reactivated. They can now log in.',
      teacher: teacher
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/school/results
============================================ */
router.get('/results', instProtect, schoolAdminOnly, requireActiveSubscription, async (req, res) => {
  try {
    var { examId, page, limit } = req.query;
    var filter   = { schoolId: req.schoolId };
    if (examId) filter.examId = examId;
    var pageNum  = parseInt(page)  || 1;
    var limitNum = parseInt(limit) || 30;
    var skip     = (pageNum - 1) * limitNum;
    var [results, total] = await Promise.all([
      SchoolResult.find(filter)
        .populate('examId', 'title subject class examType')
        .sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      SchoolResult.countDocuments(filter)
    ]);
    return res.status(200).json({
      success: true,
      results,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /api/institution/school/results/release
============================================ */
router.post('/results/release', instProtect, schoolAdminOnly, requireActiveSubscription, async (req, res) => {
  try {
    var { examId } = req.body;
    if (!examId) return res.status(400).json({ success: false, message: 'examId is required.' });
    var updated = await SchoolResult.updateMany(
      { schoolId: req.schoolId, examId },
      { $set: { isReleased: true, releasedAt: new Date(), releasedBy: req.schoolUser._id } }
    );
    return res.status(200).json({
      success: true,
      message: updated.modifiedCount + ' result' + (updated.modifiedCount !== 1 ? 's' : '') + ' released.',
      count:   updated.modifiedCount
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /api/institution/school/profile
============================================ */
router.put('/profile', instProtect, schoolAdminOnly, async (req, res) => {
  try {
    var school = await School.findById(req.schoolId);
    if (!school) return res.status(404).json({ success: false, message: 'School not found.' });
    var allowed = ['name','phone','address','state','country','type','principalName','motto','website','logo','primaryColor','secondaryColor'];
    allowed.forEach(function(field) { if (req.body[field] !== undefined) school[field] = req.body[field]; });
    if (req.body.settings && typeof req.body.settings === 'object') {
      Object.keys(req.body.settings).forEach(function(key) { school.settings[key] = req.body.settings[key]; });
    }
    await school.save();
    return res.status(200).json({ success: true, message: 'Profile updated.', school });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;