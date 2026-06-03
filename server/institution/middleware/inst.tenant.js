/* ============================================
   LATLOMP INSTITUTION — TENANT MIDDLEWARE
   
   Validates subscription is active before
   allowing access to school features.
============================================ */
const School = require('../models/School.model');

async function requireActiveSubscription(req, res, next) {
  try {
    var schoolId = req.schoolId;
    if (!schoolId) {
      return res.status(403).json({ success: false, message: 'School context missing.' });
    }

    var school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found.' });
    }

    if (school.isSuspended) {
      return res.status(403).json({
        success:     false,
        message:     'Your school has been suspended. Contact support.',
        code:        'SCHOOL_SUSPENDED',
        suspendReason: school.suspendReason
      });
    }

    if (!school.isSubscriptionActive) {
      return res.status(403).json({
        success:  false,
        message:  'Your school subscription has expired. Please renew to continue.',
        code:     'SUBSCRIPTION_EXPIRED',
        expiry:   school.subscriptionExpiry
      });
    }

    req.school = school;
    next();

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

module.exports = { requireActiveSubscription };