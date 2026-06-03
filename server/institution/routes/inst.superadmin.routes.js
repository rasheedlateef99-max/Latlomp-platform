/* ============================================
   LATLOMP INSTITUTION — SUPER ADMIN ROUTES
   
   Protected by main platform adminOnly middleware.
============================================ */
const express   = require('express');
const router    = express.Router();
const School    = require('../models/School.model');
const { Subscription, SubscriptionPlan } = require('../models/Subscription.model');
const SchoolUser = require('../models/SchoolUser.model');
const { protect, adminOnly } = require('../../middleware/auth.middleware');

var guard = [protect, adminOnly];

/* ---- Platform analytics ---- */
router.get('/analytics', guard, async (req, res) => {
  try {
    var [
      totalSchools, activeSchools, trialSchools, expiredSchools, suspendedSchools
    ] = await Promise.all([
      School.countDocuments(),
      School.countDocuments({ status: 'active' }),
      School.countDocuments({ status: 'trial' }),
      School.countDocuments({ status: 'expired' }),
      School.countDocuments({ isSuspended: true })
    ]);

    /* Monthly revenue (this month) */
    var startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    var monthlyRevenue = await Subscription.aggregate([
      { $match: { status: 'active', paidAt: { $gte: startOfMonth }, isTrial: false } },
      { $group: { _id: null, total: { $sum: '$paidAmount' } } }
    ]);

    return res.status(200).json({
      success: true,
      stats: {
        totalSchools,
        activeSchools,
        trialSchools,
        expiredSchools,
        suspendedSchools,
        monthlyRevenue: monthlyRevenue[0] ? monthlyRevenue[0].total : 0
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- List all schools ---- */
router.get('/schools', guard, async (req, res) => {
  try {
    var { page, limit, status, search } = req.query;
    var filter = {};
    if (status) filter.status = status;
    if (search) filter.$or = [
      { name: new RegExp(search, 'i') },
      { email: new RegExp(search, 'i') }
    ];

    var pageNum  = parseInt(page)  || 1;
    var limitNum = parseInt(limit) || 20;
    var skip     = (pageNum - 1) * limitNum;

    var [schools, total] = await Promise.all([
      School.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      School.countDocuments(filter)
    ]);

    return res.status(200).json({
      success: true,
      schools,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Suspend / unsuspend school ---- */
router.post('/schools/:id/suspend', guard, async (req, res) => {
  try {
    var { reason, suspend } = req.body;
    var school = await School.findById(req.params.id);
    if (!school) return res.status(404).json({ success: false, message: 'School not found.' });

    school.isSuspended   = suspend !== false;
    school.suspendReason = reason || '';
    if (school.isSuspended) school.status = 'suspended';
    await school.save();

    return res.status(200).json({
      success: true,
      message: school.isSuspended ? 'School suspended.' : 'School reactivated.',
      school
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Manually activate subscription ---- */
router.post('/schools/:id/activate', guard, async (req, res) => {
  try {
    var { planCode, durationDays } = req.body;
    var school = await School.findById(req.params.id);
    if (!school) return res.status(404).json({ success: false, message: 'School not found.' });

    var days    = parseInt(durationDays) || 30;
    var endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    school.status             = 'active';
    school.subscriptionPlan   = planCode   || 'monthly';
    school.subscriptionExpiry = endDate;
    school.isSuspended        = false;
    school.suspendReason      = '';
    await school.save();

    await Subscription.create({
      schoolId:    school._id,
      plan:        planCode || 'monthly',
      planName:    'Admin Activation',
      amount:      0,
      startDate:   new Date(),
      endDate:     endDate,
      status:      'active',
      activatedBy: 'admin',
      paidAt:      new Date()
    });

    return res.status(200).json({ success: true, message: 'School activated for ' + days + ' days.', school });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Manage subscription plans ---- */
router.get('/plans', guard, async (req, res) => {
  try {
    var plans = await SubscriptionPlan.find({}).sort({ sortOrder: 1 });
    return res.status(200).json({ success: true, plans });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/plans', guard, async (req, res) => {
  try {
    var plan = await SubscriptionPlan.create({
      name:         req.body.name,
      code:         req.body.code,
      price:        parseInt(req.body.price),
      durationDays: parseInt(req.body.durationDays),
      maxTeachers:  parseInt(req.body.maxTeachers)  || 20,
      maxStudents:  parseInt(req.body.maxStudents)  || 500,
      features:     req.body.features || [],
      isActive:     req.body.isActive !== false,
      isPopular:    req.body.isPopular || false,
      sortOrder:    parseInt(req.body.sortOrder) || 0
    });
    return res.status(201).json({ success: true, message: 'Plan created.', plan });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/plans/:id', guard, async (req, res) => {
  try {
    var plan = await SubscriptionPlan.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
    return res.status(200).json({ success: true, message: 'Plan updated.', plan });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;