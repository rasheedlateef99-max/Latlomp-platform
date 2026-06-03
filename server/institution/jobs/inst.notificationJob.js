/* ============================================
   LATLOMP INSTITUTION — NOTIFICATION + EXPIRY JOB
   
   Runs on a schedule:
   - Every hour:  expire overdue subscriptions
   - Every day:   send expiry warning emails
                  (3 days out and 1 day out)
============================================ */

const School       = require('../models/School.model');
const { Subscription } = require('../models/Subscription.model');
const emailService = require('../services/inst.email.service');

var APP_URL = process.env.APP_URL || 'https://latlompsystem.up.railway.app';

/* ============================================
   EXPIRE OVERDUE SUBSCRIPTIONS
   Runs every hour
============================================ */
async function expireSubscriptions() {
  try {
    var now = new Date();

    var expired = await School.find({
      status:             { $in: ['active', 'trial'] },
      subscriptionExpiry: { $lt: now },
      isSuspended:        false
    }).select('_id name email status');

    if (expired.length === 0) return;

    var ids = expired.map(function(s) { return s._id; });

    await School.updateMany({ _id: { $in: ids } }, { $set: { status: 'expired' } });

    await Subscription.updateMany(
      { schoolId: { $in: ids }, status: 'active' },
      { $set:     { status: 'expired' } }
    );

    /* Send expiry notification emails */
    for (var i = 0; i < expired.length; i++) {
      var school = expired[i];
      try {
        await emailService.sendSubscriptionExpired({
          toEmail:    school.email,
          schoolName: school.name,
          renewUrl:   APP_URL + '/institution/school/dashboard.html'
        });
      } catch (e) {
        console.warn('[NotifJob] Expiry email failed for:', school.name, e.message);
      }
    }

    console.log('[NotifJob] Expired ' + expired.length + ' school(s) at ' + now.toISOString().split('T')[0]);

  } catch (err) {
    console.error('[NotifJob] expireSubscriptions error:', err.message);
  }
}

/* ============================================
   SEND EXPIRY WARNING EMAILS
   Runs once per day at 08:00
   Sends to schools with 3 days left and 1 day left
============================================ */
async function sendExpiryWarnings() {
  try {
    var now = new Date();

    /* 3-day window */
    var in3Start = new Date(now); in3Start.setDate(in3Start.getDate() + 2); in3Start.setHours(0,0,0,0);
    var in3End   = new Date(now); in3End.setDate(in3End.getDate() + 3);     in3End.setHours(23,59,59,999);

    /* 1-day window */
    var in1Start = new Date(now); in1Start.setHours(0,0,0,0);
    var in1End   = new Date(now); in1End.setDate(in1End.getDate() + 1); in1End.setHours(23,59,59,999);

    var schools3Day = await School.find({
      status:             { $in: ['active', 'trial'] },
      subscriptionExpiry: { $gte: in3Start, $lte: in3End }
    }).select('name email subscriptionExpiry');

    var schools1Day = await School.find({
      status:             { $in: ['active', 'trial'] },
      subscriptionExpiry: { $gte: in1Start, $lte: in1End }
    }).select('name email subscriptionExpiry');

    /* Send 3-day warnings */
    for (var i = 0; i < schools3Day.length; i++) {
      var s = schools3Day[i];
      var daysLeft = Math.ceil((new Date(s.subscriptionExpiry) - now) / 86400000);
      try {
        await emailService.sendExpiryWarning({
          toEmail:    s.email,
          schoolName: s.name,
          daysLeft:   daysLeft,
          expiryDate: s.subscriptionExpiry,
          renewUrl:   APP_URL + '/institution/school/dashboard.html'
        });
        console.log('[NotifJob] 3-day warning sent to:', s.name);
      } catch (e) {
        console.warn('[NotifJob] 3-day warning failed:', s.name, e.message);
      }
    }

    /* Send 1-day warnings */
    for (var j = 0; j < schools1Day.length; j++) {
      var s = schools1Day[j];
      try {
        await emailService.sendExpiryWarning({
          toEmail:    s.email,
          schoolName: s.name,
          daysLeft:   1,
          expiryDate: s.subscriptionExpiry,
          renewUrl:   APP_URL + '/institution/school/dashboard.html'
        });
        console.log('[NotifJob] 1-day warning sent to:', s.name);
      } catch (e) {
        console.warn('[NotifJob] 1-day warning failed:', s.name, e.message);
      }
    }

  } catch (err) {
    console.error('[NotifJob] sendExpiryWarnings error:', err.message);
  }
}

/* ============================================
   SCHEDULER
   Uses setInterval — no external deps needed.
   For production with many schools consider
   node-cron or Bull queue instead.
============================================ */
function startSubscriptionJobs() {
  /* Run immediately on startup */
  expireSubscriptions();

  /* Expire check — every hour */
  setInterval(expireSubscriptions, 60 * 60 * 1000);

  /* Warning emails — once every 24 hours */
  setInterval(sendExpiryWarnings, 24 * 60 * 60 * 1000);

  /* Also run warnings once at startup (after 30s delay) */
  setTimeout(sendExpiryWarnings, 30 * 1000);

  console.log('✅ Institution subscription + notification jobs started');
}

module.exports = { startSubscriptionJobs, expireSubscriptions, sendExpiryWarnings };