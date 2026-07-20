/* ============================================
   LATLOMP INSTITUTION — SCHOOL ADMIN ROUTES

   ✅ PHASE B: expiryDuration on invitations
   ✅ PHASE E: Slug management
     GET  /school/by-slug/:slug  — public
     PUT  /school/slug           — admin only

   ✅ RESTRUCTURE STAGE 5:
   1. invite-teacher: stores new delegation fields
      (assignedClassId, assignedDepartmentId,
       additionalRoles) on the Invitation record
      so FLOW 1 in inst.auth.routes.js can copy them
      to SchoolUser when the staff member accepts.
   2. GET /teachers: expanded to return ALL non-admin
      staff (was: only teacher + vice_principal).
      Includes new fields: classId, departmentId,
      additionalRoles.
   3. DELETE/deactivate/reactivate: expanded role filter
      to match all non-admin roles.
   4. NEW: GET /my-role-context — returns role-specific
      scope context for dashboard initialization.
      class_teacher → their assigned class + student count
      hod/dept_admin → their department + student count
      admin → school-wide student count
============================================ */
'use strict';

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

/* ✅ STAGE 5: All non-admin staff roles.
   Used by staff list, deactivate, and delete endpoints. */
var ALL_NON_ADMIN_ROLES = [
  'teacher', 'vice_principal', 'bursar',
  'class_teacher', 'subject_teacher',
  'lecturer', 'instructor',
  'hod', 'dean', 'department_admin', 'principal'
];

/* ============================================
   ✅ PHASE E — PUBLIC SLUG RESOLVER
   GET /api/institution/school/by-slug/:slug
   No auth required.
============================================ */
router.get('/by-slug/:slug', async (req, res) => {
  try {
    var slug = (req.params.slug || '').toLowerCase().trim();
    if (!slug) return res.status(400).json({ success: false, message: 'Slug is required.' });

    var school = await School.findOne({ slug })
      .select('name slug logo motto type primaryColor secondaryColor status isSuspended');

    if (!school) {
      return res.status(404).json({
        success: false,
        message: 'No school found with this link. The link may have changed or expired.'
      });
    }
    if (school.isSuspended) {
      return res.status(403).json({
        success: false,
        message: 'This school account is currently suspended. Please contact the school administrator.'
      });
    }

    return res.status(200).json({
      success: true,
      school: {
        name:           school.name,
        slug:           school.slug,
        logo:           school.logo           || '',
        motto:          school.motto          || '',
        type:           school.type           || 'secondary',
        primaryColor:   school.primaryColor   || '#6c63ff',
        secondaryColor: school.secondaryColor || '#43e97b',
        status:         school.status
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ PHASE E — UPDATE SLUG
   PUT /api/institution/school/slug
============================================ */
router.put('/slug', instProtect, schoolAdminOnly, async (req, res) => {
  try {
    var newSlug = (req.body.slug || '').toLowerCase().trim();
    if (!newSlug) return res.status(400).json({ success: false, message: 'Slug is required.' });
    if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(newSlug)) {
      return res.status(400).json({
        success: false,
        message: 'Slug must be 3–50 characters, using only lowercase letters, numbers, and hyphens. Cannot start or end with a hyphen.'
      });
    }

    var school = await School.findById(req.schoolId);
    if (!school) return res.status(404).json({ success: false, message: 'School not found.' });

    if (school.slug === newSlug) {
      return res.status(200).json({ success: true, message: 'This is already your current link.', slug: school.slug });
    }

    if (school.slugUpdatedAt) {
      var daysSinceChange = Math.floor((Date.now() - new Date(school.slugUpdatedAt).getTime()) / 86400000);
      if (daysSinceChange < 30) {
        var daysLeft = 30 - daysSinceChange;
        return res.status(429).json({
          success: false,
          message: 'You can only change your school link once every 30 days. You can change it again in ' + daysLeft + ' day' + (daysLeft !== 1 ? 's' : '') + '.'
        });
      }
    }

    var existing = await School.findOne({ slug: newSlug, _id: { $ne: req.schoolId } });
    if (existing) {
      return res.status(409).json({ success: false, message: '"' + newSlug + '" is already taken. Please choose a different link.' });
    }

    var oldSlug = school.slug;
    school.slug          = newSlug;
    school.slugUpdatedAt = new Date();
    await school.save();

    return res.status(200).json({ success: true, message: 'Your school link has been updated successfully.', slug: school.slug, oldSlug: oldSlug });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'This link is already taken. Please choose a different one.' });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /api/institution/school/onboarding
============================================ */
router.post('/onboarding', instProtect, async (req, res) => {
  try {
    var school = await School.findById(req.schoolId);
    if (!school) return res.status(404).json({ success: false, message: 'School not found.' });

    var allowed = ['name','phone','address','state','country','type',
                   'principalName','totalStudents','primaryColor','secondaryColor','motto','website'];
    allowed.forEach(function(field) { if (req.body[field] !== undefined) school[field] = req.body[field]; });
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
        plan:        'trial', planName: 'Free Trial', amount: 0,
        startDate:   new Date(), endDate: school.subscriptionExpiry,
        status:      'active', isTrial: true,
        activatedBy: 'system', paidAt: new Date(), paidAmount: 0
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
    } catch (emailErr) { console.warn('[Onboarding] Welcome email failed:', emailErr.message); }

    return res.status(200).json({
      success: true, message: 'School setup complete! Your 7-day free trial has started.',
      school, redirectTo: '/institution/school/dashboard.html'
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
      SchoolUser.countDocuments({ schoolId, role: { $in: ALL_NON_ADMIN_ROLES }, isActive: true }),
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
      daysLeft = Math.max(0, Math.ceil((new Date(school.subscriptionExpiry) - new Date()) / 86400000));
    }
    return res.status(200).json({
      success: true,
      stats: {
        teachers: teacherCount, exams: examCount, results: resultCount,
        pendingInvites: inviteCount, daysLeft,
        subscriptionPlan:   school.subscriptionPlan,
        subscriptionExpiry: school.subscriptionExpiry
      },
      recentExams, school
    });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* ============================================
   GET /api/institution/school/analytics
============================================ */
router.get('/analytics', instProtect, schoolAdminOnly, requireActiveSubscription, async (req, res) => {
  try {
    var schoolId = req.schoolId;
    var [exams, allResults] = await Promise.all([
      SchoolExam.find({ schoolId }).select('_id title subject class status totalAttempts createdAt').lean(),
      SchoolResult.find({ schoolId }).select('examId scorePercent isPassed theoryMarked studentName createdAt').lean()
    ]);
    var totalExams       = exams.length;
    var totalSubmissions = allResults.length;
    var passed           = allResults.filter(function(r) { return r.isPassed; }).length;
    var passRate         = totalSubmissions > 0 ? Math.round((passed / totalSubmissions) * 100) : 0;
    var scores           = allResults.map(function(r) { return r.scorePercent || 0; });
    var avgScore         = scores.length > 0 ? Math.round(scores.reduce(function(a,b){return a+b;},0)/scores.length) : 0;
    var highestScore     = scores.length > 0 ? Math.max.apply(null, scores) : 0;
    var lowestScore      = scores.length > 0 ? Math.min.apply(null, scores) : 0;
    var needsGrading     = allResults.filter(function(r) { return !r.theoryMarked; }).length;
    var examMap = {};
    exams.forEach(function(e) { examMap[e._id.toString()] = e; });
    var examStats = exams.map(function(exam) {
      var eResults = allResults.filter(function(r) { return r.examId && r.examId.toString() === exam._id.toString(); });
      var ePassed  = eResults.filter(function(r) { return r.isPassed; }).length;
      var eScores  = eResults.map(function(r) { return r.scorePercent || 0; });
      var eAvg     = eScores.length > 0 ? Math.round(eScores.reduce(function(a,b){return a+b;},0)/eScores.length) : 0;
      return { _id: exam._id, title: exam.title, subject: exam.subject, class: exam.class, status: exam.status,
               attempts: eResults.length, passed: ePassed,
               passRate: eResults.length > 0 ? Math.round((ePassed/eResults.length)*100) : 0, avgScore: eAvg };
    });
    var subjectMap = {};
    allResults.forEach(function(r) {
      var exam = examMap[r.examId ? r.examId.toString() : ''];
      if (!exam) return;
      var subj = exam.subject || 'Unknown';
      if (!subjectMap[subj]) subjectMap[subj] = { subject: subj, attempts: 0, passed: 0, totalScore: 0 };
      subjectMap[subj].attempts++;
      if (r.isPassed) subjectMap[subj].passed++;
      subjectMap[subj].totalScore += (r.scorePercent || 0);
    });
    var subjectStats = Object.keys(subjectMap).map(function(k) {
      var s = subjectMap[k];
      return { subject: s.subject, attempts: s.attempts, passed: s.passed,
               passRate: s.attempts > 0 ? Math.round((s.passed/s.attempts)*100) : 0,
               avgScore: s.attempts > 0 ? Math.round(s.totalScore/s.attempts) : 0 };
    });
    var thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    var timelineMap   = {};
    allResults.filter(function(r) { return new Date(r.createdAt) >= thirtyDaysAgo; })
      .forEach(function(r) {
        var day = new Date(r.createdAt).toISOString().split('T')[0];
        if (!timelineMap[day]) timelineMap[day] = { date: day, submissions: 0, passed: 0 };
        timelineMap[day].submissions++;
        if (r.isPassed) timelineMap[day].passed++;
      });
    var timeline = Object.values(timelineMap).sort(function(a,b){ return a.date.localeCompare(b.date); });
    return res.status(200).json({
      success: true,
      overview: { totalExams, totalSubmissions, avgScore, highestScore, lowestScore,
                  passed, failed: totalSubmissions - passed, passRate, needsGrading },
      examStats, subjectStats, timeline
    });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* ============================================
   GET /api/institution/school/plans — public
============================================ */
router.get('/plans', async (req, res) => {
  try {
    var plans = await SubscriptionPlan.find({ isActive: true }).sort({ sortOrder: 1 });
    return res.status(200).json({ success: true, plans });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
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
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.PAYSTACK_SECRET_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: school.email, amount: plan.price * 100, reference, callback_url: callbackUrl,
        metadata: { schoolId: school._id.toString(), planCode, planName: plan.name, schoolName: school.name, type: 'institution_subscription' }
      })
    });
    var paystackData = await paystackRes.json();
    if (!paystackData.status) return res.status(400).json({ success: false, message: 'Payment initialization failed.' });
    await Subscription.create({
      schoolId: school._id, plan: planCode, planName: plan.name, amount: plan.price,
      startDate: new Date(), endDate: new Date(Date.now() + plan.durationDays * 86400000),
      status: 'pending', paymentRef: reference
    });
    return res.status(200).json({ success: true, paymentUrl: paystackData.data.authorization_url, reference, amount: plan.price, plan });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* ============================================
   POST /api/institution/school/invite-teacher
   ✅ PHASE B: expiryDuration support
   ✅ STAGE 5: stores assignedClassId,
   assignedDepartmentId, additionalRoles on the
   Invitation so FLOW 1 can copy them to SchoolUser
   when the staff member accepts the invitation.
============================================ */
router.post('/invite-teacher', instProtect, schoolAdminOnly, requireActiveSubscription, async (req, res) => {
  try {
    var {
      email, name, role, subjects, classes, message, expiryDuration,
      /* ✅ STAGE 5: new delegation fields */
      assignedClassId, assignedDeptId, additionalRoles
    } = req.body;

    if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });

    var validDurations = ['5min', '10min', '30min', '1hr', '24hr', '7days'];
    var chosenDuration = validDurations.indexOf(expiryDuration) !== -1 ? expiryDuration : '7days';

    var existing = await SchoolUser.findOne({ schoolId: req.schoolId, email: email.toLowerCase() });
    if (existing) return res.status(400).json({ success: false, message: 'This person is already a member of your school.' });

    await Invitation.updateMany(
      { schoolId: req.schoolId, email: email.toLowerCase(), status: 'pending' },
      { $set: { status: 'cancelled' } }
    );

    /* ✅ STAGE 5: validate additionalRoles */
    var safeAdditionalRoles = Array.isArray(additionalRoles)
      ? additionalRoles.filter(function(r) { return ALL_NON_ADMIN_ROLES.includes(r); })
      : [];

    var invite = await Invitation.create({
      schoolId:             req.schoolId,
      invitedBy:            req.schoolUser._id,
      email:                email.toLowerCase(),
      name:                 name    || '',
      role:                 role    || 'teacher',
      subjects:             Array.isArray(subjects) ? subjects : (subjects ? subjects.split(',').map(function(s){return s.trim();}) : []),
      classes:              Array.isArray(classes)  ? classes  : (classes  ? classes.split(',').map(function(s){return s.trim();})  : []),
      message:              message || '',
      expiryDuration:       chosenDuration,
      /* ✅ STAGE 5: delegation fields */
      assignedClassId:      assignedClassId || null,
      assignedDepartmentId: assignedDeptId  || null,
      additionalRoles:      safeAdditionalRoles
    });

    var school      = req.school;
    var inviteUrl   = (process.env.APP_URL || 'https://latlompsystem.up.railway.app') + '/institution/index.html?invite=' + invite.token;
    var expiryLabel = Invitation.getExpiryLabel(chosenDuration);

    try {
      await emailService.sendTeacherInvite({
        toEmail: email.toLowerCase(), toName: name || '',
        schoolName: school.name, inviterName: req.schoolUser.name,
        role: role || 'teacher', inviteUrl, expiresAt: invite.expiresAt, expiryLabel
      });
    } catch (emailErr) { console.warn('[InviteTeacher] Email failed:', emailErr.message); }

    return res.status(201).json({
      success: true,
      message: 'Invitation sent to ' + email + '. It expires in ' + expiryLabel + '.',
      invite: {
        _id: invite._id, email: invite.email, name: invite.name, role: invite.role,
        token: invite.token, inviteUrl, expiresAt: invite.expiresAt,
        expiryDuration: invite.expiryDuration, expiryLabel,
        assignedClassId:      invite.assignedClassId      || null,
        assignedDepartmentId: invite.assignedDepartmentId || null,
        additionalRoles:      invite.additionalRoles      || []
      }
    });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* ============================================
   GET /api/institution/school/teachers
   ✅ STAGE 5: expanded to return ALL non-admin
   staff, not just teacher + vice_principal.
   Also returns classId, departmentId,
   additionalRoles for the new delegation model.
============================================ */
router.get('/teachers', instProtect, schoolAdminOnly, requireActiveSubscription, async (req, res) => {
  try {
    var teachers = await SchoolUser.find({
      schoolId: req.schoolId,
      role:     { $in: ALL_NON_ADMIN_ROLES }
    })
      .select('-googleId')
      .sort({ name: 1 });

    var pendingInvites = await Invitation.find({ schoolId: req.schoolId, status: 'pending' }).sort({ createdAt: -1 });
    var invitesWithLabels = pendingInvites.map(function(inv) {
      var obj = inv.toObject();
      obj.expiryLabel  = Invitation.getExpiryLabel(inv.expiryDuration);
      obj.isExpiredNow = new Date(inv.expiresAt) < new Date();
      return obj;
    });

    return res.status(200).json({ success: true, teachers, pendingInvites: invitesWithLabels });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* ============================================
   DELETE /api/institution/school/teachers/:id
   ✅ STAGE 5: expanded role filter.
============================================ */
router.delete('/teachers/:id', instProtect, schoolAdminOnly, requireActiveSubscription, async (req, res) => {
  try {
    var teacher = await SchoolUser.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId,
      role:     { $in: ALL_NON_ADMIN_ROLES }
    });
    if (!teacher) return res.status(404).json({ success: false, message: 'Staff member not found in your school.' });
    await Invitation.updateMany({ schoolId: req.schoolId, email: teacher.email, status: 'pending' }, { $set: { status: 'cancelled' } });
    await SchoolUser.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: teacher.name + ' has been permanently removed from your school.' });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* ============================================
   PUT /api/institution/school/teachers/:id/deactivate
   ✅ STAGE 5: expanded role filter.
============================================ */
router.put('/teachers/:id/deactivate', instProtect, schoolAdminOnly, requireActiveSubscription, async (req, res) => {
  try {
    var teacher = await SchoolUser.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId, role: { $in: ALL_NON_ADMIN_ROLES } },
      { $set: { isActive: false } },
      { new: true }
    ).select('-googleId');
    if (!teacher) return res.status(404).json({ success: false, message: 'Staff member not found in your school.' });
    return res.status(200).json({ success: true, message: teacher.name + "'s account has been deactivated.", teacher });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* ============================================
   PUT /api/institution/school/teachers/:id/reactivate
   ✅ STAGE 5: expanded role filter.
============================================ */
router.put('/teachers/:id/reactivate', instProtect, schoolAdminOnly, requireActiveSubscription, async (req, res) => {
  try {
    var teacher = await SchoolUser.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId, role: { $in: ALL_NON_ADMIN_ROLES } },
      { $set: { isActive: true } },
      { new: true }
    ).select('-googleId');
    if (!teacher) return res.status(404).json({ success: false, message: 'Staff member not found in your school.' });
    return res.status(200).json({ success: true, message: teacher.name + "'s account has been reactivated.", teacher });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* ============================================
   ✅ NEW STAGE 5: GET /api/institution/school/my-role-context
   Returns role-specific scope data for the
   dashboard on first load. Every role gets back
   what they "own" so the frontend can initialize
   the correct view without extra calls.

   class_teacher:     { assignedClass, studentCount }
   hod/dept_admin:    { assignedDepartment, studentCount }
   admin/senior staff:{ studentCount (institution-wide) }
============================================ */
router.get('/my-role-context', instProtect, requireActiveSubscription, async function (req, res) {
  try {
    var user           = req.schoolUser;
    var schoolId       = req.schoolId;
    var effectiveRoles = [user.role].concat(Array.isArray(user.additionalRoles) ? user.additionalRoles : []);

    /* Lazy-load models (avoids circular require issues) */
    var SchoolStudent = require('../models/SchoolStudent.model');

    var context = {
      role:            user.role,
      additionalRoles: user.additionalRoles || [],
      effectiveRoles:  effectiveRoles,
      studentCount:    0
    };

    var seniorRoles = ['school_admin', 'principal', 'vice_principal', 'dean'];
    var isSenior    = effectiveRoles.some(function (r) { return seniorRoles.includes(r); });

    if (isSenior) {
      /* Admin/senior staff: institution-wide count */
      context.studentCount = await SchoolStudent.countDocuments({ schoolId: schoolId, status: 'active' });
    } else if (effectiveRoles.includes('class_teacher') && user.classId) {
      /* Class teacher: their assigned class */
      try {
        var SchoolClass = require('../models/Class.model');
        var cls = await SchoolClass.findOne({ _id: user.classId, schoolId: schoolId })
          .select('name category sortOrder').lean();
        if (cls) {
          context.assignedClass = { _id: cls._id, name: cls.name, category: cls.category || '' };
          context.studentCount  = await SchoolStudent.countDocuments({
            schoolId: schoolId, classId: user.classId, status: 'active'
          });
        }
      } catch (e) { console.warn('[my-role-context] Class lookup failed:', e.message); }
    } else if (
      effectiveRoles.some(function (r) { return ['hod', 'department_admin'].includes(r); }) &&
      user.departmentId
    ) {
      /* HOD / Department Admin: their assigned department */
      try {
        var Department = require('../models/Department.model');
        var dept = await Department.findOne({ _id: user.departmentId, schoolId: schoolId })
          .select('name code').lean();
        if (dept) {
          context.assignedDepartment = { _id: dept._id, name: dept.name, code: dept.code || '' };
          context.studentCount       = await SchoolStudent.countDocuments({
            schoolId: schoolId, departmentId: user.departmentId, status: 'active'
          });
        }
      } catch (e) { console.warn('[my-role-context] Department lookup failed:', e.message); }
    } else {
      /* Other teaching roles: no scope — just their name/role */
      context.studentCount = 0;
    }

    return res.json({ success: true, context: context });
  } catch (err) {
    console.error('[inst.school] GET /my-role-context:', err.message);
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
      SchoolResult.find(filter).populate('examId', 'title subject class examType')
        .sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      SchoolResult.countDocuments(filter)
    ]);
    return res.status(200).json({
      success: true, results,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total/limitNum) }
    });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
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
      count: updated.modifiedCount
    });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
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
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;