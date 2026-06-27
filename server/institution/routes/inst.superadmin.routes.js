/* ============================================
   LATLOMP INSTITUTION — SUPER ADMIN ROUTES

   Mounted at TWO paths in server.js:
     /api/institution/superadmin  (existing)
     /api/admin                   (new — used by admin.html)

   Protected by main platform adminOnly middleware.

   ✅ COMPLETE: All 14 endpoints the admin
   dashboard frontend (admin.html) requires.

   ROUTE ORDER IS INTENTIONAL:
   Specific paths (/stats, /announcements) must
   come before parameterized paths (/:id) or
   Express will treat "stats" as a school ID.
============================================ */
const express      = require('express');
const router       = express.Router();
const School       = require('../models/School.model');
const SchoolUser   = require('../models/SchoolUser.model');
const SchoolExam   = require('../models/SchoolExam.model');
const SchoolResult = require('../models/SchoolResult.model');
const Announcement = require('../models/Announcement.model');
const { Subscription, SubscriptionPlan } = require('../models/Subscription.model');
const AuditLog     = require('../../models/AuditLog.model');
const { protect, adminOnly } = require('../../middleware/auth.middleware');

var guard = [protect, adminOnly];

/* ============================================
   1. GET /institutions/stats
   Platform-wide analytics for the dashboard
   header cards.
   ⚠ Must be before /institutions/:id
============================================ */
router.get('/institutions/stats', guard, async (req, res) => {
  try {
    var startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    var [total, active, trial, expired, suspended, revenue] = await Promise.all([
      School.countDocuments(),
      School.countDocuments({ status: 'active',   isSuspended: { $ne: true } }),
      School.countDocuments({ status: 'trial',    isSuspended: { $ne: true } }),
      School.countDocuments({ status: 'expired' }),
      School.countDocuments({ isSuspended: true }),
      Subscription.aggregate([
        {
          $match: {
            status:  'active',
            paidAt:  { $gte: startOfMonth },
            isTrial: false,
            amount:  { $gt: 0 }
          }
        },
        { $group: { _id: null, total: { $sum: '$paidAmount' } } }
      ])
    ]);

    return res.status(200).json({
      success: true,
      stats: {
        total,
        active,
        trial,
        expired,
        suspended,
        totalRevenue: revenue[0] ? revenue[0].total : 0
      }
    });
  } catch (err) {
    console.error('[SuperAdmin] Stats error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   2. GET /institutions/announcements
   List recent announcements sent to schools.
   ⚠ Must be before /institutions/:id
============================================ */
router.get('/institutions/announcements', guard, async (req, res) => {
  try {
    var limit = parseInt(req.query.limit) || 20;
    var announcements = await Announcement
      .find({})
      .populate('schoolId', 'name')
      .sort({ createdAt: -1 })
      .limit(limit);
    return res.status(200).json({ success: true, announcements });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   3. POST /institutions/announcements
   Send an announcement to one school or all.
   ⚠ Must be before /institutions/:id
============================================ */
router.post('/institutions/announcements', guard, async (req, res) => {
  try {
    var { schoolId, title, message, type } = req.body;
    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: 'Title and message are required.'
      });
    }
    if (schoolId) {
      var school = await School.findById(schoolId);
      if (!school) {
        return res.status(404).json({ success: false, message: 'School not found.' });
      }
    }
    var ann = await Announcement.create({
      schoolId: schoolId || null,
      title:    title.trim(),
      message:  message.trim(),
      type:     type || 'info',
      sentBy:   req.user._id
    });
    return res.status(201).json({
      success:      true,
      message:      'Announcement sent successfully.',
      announcement: ann
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   4. GET /institutions
   Paginated list of all schools with filters,
   search, teacher counts and days-left computed.
   Used by the schools table in admin.html.
============================================ */
router.get('/institutions', guard, async (req, res) => {
  try {
    var { page, limit, status, search } = req.query;
    var filter = {};

    if (status && status !== 'all') {
      if (status === 'suspended') {
        filter.isSuspended = true;
      } else {
        filter.status      = status;
        filter.isSuspended = { $ne: true };
      }
    }

    if (search && search.trim()) {
      filter.$or = [
        { name:  new RegExp(search.trim(), 'i') },
        { email: new RegExp(search.trim(), 'i') }
      ];
    }

    var pageNum  = parseInt(page)  || 1;
    var limitNum = parseInt(limit) || 15;
    var skip     = (pageNum - 1) * limitNum;

    var [schools, total] = await Promise.all([
      School.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      School.countDocuments(filter)
    ]);

    /* Teacher counts — one aggregate query, not N queries */
    var schoolIds     = schools.map(function(s) { return s._id; });
    var teacherCounts = await SchoolUser.aggregate([
      {
        $match: {
          schoolId: { $in: schoolIds },
          role:     { $ne: 'school_admin' },
          isActive: true
        }
      },
      { $group: { _id: '$schoolId', count: { $sum: 1 } } }
    ]);
    var tcMap = {};
    teacherCounts.forEach(function(tc) {
      tcMap[tc._id.toString()] = tc.count;
    });

    var now    = new Date();
    var result = schools.map(function(s) {
      var obj          = s.toJSON();
      obj.teacherCount = tcMap[s._id.toString()] || 0;
      obj.daysLeft     = s.subscriptionExpiry
        ? Math.max(0, Math.ceil((new Date(s.subscriptionExpiry) - now) / 86400000))
        : 0;
      return obj;
    });

    return res.status(200).json({
      success: true,
      schools: result,
      total:   total,
      pages:   Math.ceil(total / limitNum),
      page:    pageNum
    });
  } catch (err) {
    console.error('[SuperAdmin] List schools error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   5. GET /institutions/:id
   Full school detail for the detail modal:
   school record, teacher count, recent exams,
   total results.
============================================ */
router.get('/institutions/:id', guard, async (req, res) => {
  try {
    var school = await School.findById(req.params.id);
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found.' });
    }

    /* All stats in parallel */
    var [teacherCount, totalResults, recentExams] = await Promise.all([
      SchoolUser.countDocuments({
        schoolId: school._id,
        role:     { $ne: 'school_admin' },
        isActive: true
      }),
      SchoolResult.countDocuments({ schoolId: school._id }),
      SchoolExam.find({ schoolId: school._id })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('title')
    ]);

    /* Attempt counts for recent exams */
    var examIds      = recentExams.map(function(e) { return e._id; });
    var attemptAgg   = await SchoolResult.aggregate([
      { $match: { examId: { $in: examIds } } },
      { $group: { _id: '$examId', count: { $sum: 1 } } }
    ]);
    var acMap = {};
    attemptAgg.forEach(function(a) {
      acMap[a._id.toString()] = a.count;
    });

    return res.status(200).json({
      success:      true,
      school:       school,
      stats:        { teachers: teacherCount },
      totalResults: totalResults,
      recentExams:  recentExams.map(function(e) {
        return {
          title:         e.title,
          totalAttempts: acMap[e._id.toString()] || 0
        };
      })
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   6. PUT /institutions/:id/suspend
   Suspend a school. Blocks all access instantly.
   Body: { reason: string }
============================================ */
router.put('/institutions/:id/suspend', guard, async (req, res) => {
  try {
    var { reason } = req.body;
    var school = await School.findById(req.params.id);
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found.' });
    }
    school.isSuspended   = true;
    school.suspendReason = reason || '';
    school.status        = 'suspended';
    await school.save();

    return res.status(200).json({
      success: true,
      message: '"' + school.name + '" has been suspended.',
      school:  school
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   7. PUT /institutions/:id/activate
   Quick activate — used by the ✅ button in
   the schools table.
   - Clears suspension
   - If subscription is valid: just unsuspend
   - If expired or missing: adds 30 days
============================================ */
router.put('/institutions/:id/activate', guard, async (req, res) => {
  try {
    var school = await School.findById(req.params.id);
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found.' });
    }

    var now           = new Date();
    var hasValidSub   = school.subscriptionExpiry &&
                        new Date(school.subscriptionExpiry) > now;
    var message       = '';

    school.isSuspended   = false;
    school.suspendReason = '';

    if (hasValidSub) {
      /* Just unsuspend — subscription is still running */
      school.status = school.subscriptionPlan === 'trial' ? 'trial' : 'active';
      message = '"' + school.name + '" unsuspended. Subscription continues until ' +
                new Date(school.subscriptionExpiry).toDateString() + '.';
    } else {
      /* Expired or never subscribed — grant 30 days */
      var newExpiry = new Date(now.getTime() + 30 * 86400000);
      school.subscriptionExpiry = newExpiry;
      school.status             = 'active';
      message = '"' + school.name + '" activated for 30 days.';

      await Subscription.create({
        schoolId:    school._id,
        plan:        school.subscriptionPlan || 'monthly',
        planName:    'Admin Activation',
        amount:      0,
        startDate:   now,
        endDate:     newExpiry,
        status:      'active',
        activatedBy: 'admin',
        notes:       'Quick activated by admin',
        paidAt:      now
      });
    }

    await school.save();
    return res.status(200).json({ success: true, message: message, school: school });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   8. PUT /institutions/:id/subscription
   THE MAIN SUBSCRIPTION MANAGEMENT ENDPOINT.
   This is what the Subscription modal uses.

   Actions:
     add_days        — extend by N days
     grant_unlimited — 99-year access
     expire          — expire immediately
     set_plan        — change plan code only

   Body: { action, days?, plan?, note? }
============================================ */
router.put('/institutions/:id/subscription', guard, async (req, res) => {
  try {
    var { action, days, plan, note } = req.body;
    var school = await School.findById(req.params.id);
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found.' });
    }

    var now     = new Date();
    var message = '';

    if (action === 'add_days') {
      var daysToAdd = parseInt(days) || 30;
      if (daysToAdd < 1) {
        return res.status(400).json({ success: false, message: 'Days must be at least 1.' });
      }
      /* Extend from current expiry if still active, otherwise from today */
      var base     = school.subscriptionExpiry && new Date(school.subscriptionExpiry) > now
        ? new Date(school.subscriptionExpiry)
        : now;
      var newExpiry = new Date(base.getTime() + daysToAdd * 86400000);

      school.subscriptionExpiry = newExpiry;
      school.isSuspended        = false;
      school.suspendReason      = '';
      /* Keep 'trial' status if it was a trial, otherwise 'active' */
      school.status = (school.subscriptionPlan === 'trial' && school.status === 'trial')
        ? 'trial'
        : 'active';

      await Subscription.create({
        schoolId:    school._id,
        plan:        school.subscriptionPlan || 'monthly',
        planName:    'Admin Extension',
        amount:      0,
        startDate:   now,
        endDate:     newExpiry,
        status:      'active',
        activatedBy: 'admin',
        notes:       note || ('Admin added ' + daysToAdd + ' days'),
        paidAt:      now
      });

      message = 'Added ' + daysToAdd + ' day(s). New expiry: ' +
                newExpiry.toDateString() + '.';

    } else if (action === 'grant_unlimited') {
      /* 99 years — effectively permanent */
      var unlimitedExpiry = new Date(now.getTime() + 99 * 365 * 86400000);
      school.subscriptionExpiry = unlimitedExpiry;
      school.status             = 'active';
      school.subscriptionPlan   = plan || school.subscriptionPlan || 'annual';
      school.isSuspended        = false;
      school.suspendReason      = '';

      await Subscription.create({
        schoolId:    school._id,
        plan:        school.subscriptionPlan,
        planName:    'Unlimited Access',
        amount:      0,
        startDate:   now,
        endDate:     unlimitedExpiry,
        status:      'active',
        activatedBy: 'admin',
        notes:       note || 'Admin granted unlimited access',
        paidAt:      now
      });

      message = 'Unlimited access granted to "' + school.name + '".';

    } else if (action === 'expire') {
      school.subscriptionExpiry = now;
      school.status             = 'expired';
      message = '"' + school.name + '" subscription expired immediately.';

    } else if (action === 'set_plan') {
      if (!plan) {
        return res.status(400).json({ success: false, message: 'Plan code is required.' });
      }
      school.subscriptionPlan = plan;
      message = 'Plan changed to: ' + plan + '.';

    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Use: add_days, grant_unlimited, expire, or set_plan.'
      });
    }

    await school.save();

    return res.status(200).json({
      success: true,
      message: message,
      school:  school
    });
  } catch (err) {
    console.error('[SuperAdmin] Subscription update error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   9. DELETE /institutions/:id
   Permanently delete a school and its users.
   Frontend requires double confirmation before
   calling this endpoint.
   Subscriptions are cancelled, not deleted
   (payment history is preserved).
============================================ */
router.delete('/institutions/:id', guard, async (req, res) => {
  try {
    var school = await School.findById(req.params.id);
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found.' });
    }
    var schoolName = school.name;

    await Promise.all([
      School.findByIdAndDelete(req.params.id),
      SchoolUser.deleteMany({ schoolId: req.params.id }),
      /* Cancel subscriptions — preserve payment history */
      Subscription.updateMany(
        { schoolId: req.params.id },
        { $set: { status: 'cancelled', notes: 'School deleted by admin' } }
      )
    ]);

    console.log('[SuperAdmin] School deleted: ' + schoolName + ' (' + req.params.id + ')');

    return res.status(200).json({
      success: true,
      message: '"' + schoolName + '" has been permanently deleted.'
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   10. GET /subscription-plans
   List all subscription plans.
   Used by plan management table and all plan
   selector dropdowns in admin.html.
============================================ */
router.get('/subscription-plans', guard, async (req, res) => {
  try {
    var plans = await SubscriptionPlan.find({}).sort({ sortOrder: 1, price: 1 });
    return res.status(200).json({ success: true, plans });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   11. POST /subscription-plans
   Create a new subscription plan.
   Changes are immediately visible to all
   schools in their renewal pages.
============================================ */
router.post('/subscription-plans', guard, async (req, res) => {
  try {
    var { name, code, price, durationDays, maxTeachers,
          maxStudents, maxExams, features, isActive, isPopular, sortOrder } = req.body;

    if (!name || !code || price === undefined || !durationDays) {
      return res.status(400).json({
        success: false,
        message: 'Name, code, price, and durationDays are required.'
      });
    }

    /* Prevent duplicate codes */
    var existing = await SubscriptionPlan.findOne({ code: code.toLowerCase().trim() });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A plan with code "' + code + '" already exists.'
      });
    }

    var plan = await SubscriptionPlan.create({
      name:         name.trim(),
      code:         code.toLowerCase().trim(),
      price:        parseInt(price),
      durationDays: parseInt(durationDays),
      maxTeachers:  parseInt(maxTeachers)  || 20,
      maxStudents:  parseInt(maxStudents)  || 500,
      maxExams:     parseInt(maxExams)     !== undefined ? parseInt(maxExams) : -1,
      features:     features || [],
      isActive:     isActive !== false,
      isPopular:    isPopular || false,
      sortOrder:    parseInt(sortOrder) || 0
    });

    return res.status(201).json({
      success: true,
      message: 'Plan "' + plan.name + '" created.',
      plan:    plan
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   12. PUT /subscription-plans/:id/toggle
   Enable or disable a plan.
   Disabled plans are hidden from the school
   subscription center but existing subscribers
   are unaffected.
   ⚠ Must be defined BEFORE /:id to avoid
   Express treating "toggle" as a plan ID.
============================================ */
router.put('/subscription-plans/:id/toggle', guard, async (req, res) => {
  try {
    var plan = await SubscriptionPlan.findById(req.params.id);
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found.' });
    }
    plan.isActive = !plan.isActive;
    await plan.save();
    return res.status(200).json({
      success: true,
      message: 'Plan "' + plan.name + '" ' + (plan.isActive ? 'enabled' : 'disabled') + '.',
      plan:    plan
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   13. PUT /subscription-plans/:id
   Update any field of an existing plan.
   Price changes are immediately reflected on
   the school subscription center page.
============================================ */
router.put('/subscription-plans/:id', guard, async (req, res) => {
  try {
    var allowed = [
      'name', 'price', 'durationDays', 'maxTeachers',
      'maxStudents', 'maxExams', 'features', 'isActive',
      'isPopular', 'sortOrder'
    ];
    var updates = {};
    allowed.forEach(function(f) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    });

    var plan = await SubscriptionPlan.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true }
    );
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found.' });
    }
    return res.status(200).json({
      success: true,
      message: 'Plan "' + plan.name + '" updated.',
      plan:    plan
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   14. GET /institution-logs
   Recent audit log entries for institution
   events (auth, subscription, admin actions).
============================================ */
router.get('/institution-logs', guard, async (req, res) => {
  try {
    var limit = parseInt(req.query.limit) || 30;
    var logs  = await AuditLog
      .find({ action: /^institution\./i })
      .sort({ createdAt: -1 })
      .limit(limit);
    return res.status(200).json({ success: true, logs });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;