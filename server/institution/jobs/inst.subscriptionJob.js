/* ============================================
   LATLOMP INSTITUTION — SUBSCRIPTION CRON JOB
   
   Runs every hour.
   Expires schools whose subscription has ended.
   
   To use: call startSubscriptionJobs() from server.js
============================================ */
const School       = require('../models/School.model');
const Subscription = require('../models/Subscription.model').Subscription;

async function expireSubscriptions() {
  try {
    var now     = new Date();
    var expired = await School.find({
      status:             { $in: ['active', 'trial'] },
      subscriptionExpiry: { $lt: now },
      isSuspended:        false
    });

    if (expired.length === 0) return;

    var ids = expired.map(function(s) { return s._id; });

    await School.updateMany(
      { _id: { $in: ids } },
      { $set: { status: 'expired' } }
    );

    await Subscription.updateMany(
      { schoolId: { $in: ids }, status: 'active' },
      { $set: { status: 'expired' } }
    );

    console.log('[SubscriptionJob] Expired ' + expired.length + ' school(s) at ' + now.toISOString());

  } catch (err) {
    console.error('[SubscriptionJob] Error:', err.message);
  }
}

function startSubscriptionJobs() {
  /* Run immediately */
  expireSubscriptions();

  /* Then every hour */
  setInterval(expireSubscriptions, 60 * 60 * 1000);

  console.log('✅ Subscription expiry job started (runs every 1 hour)');
}

module.exports = { startSubscriptionJobs, expireSubscriptions };