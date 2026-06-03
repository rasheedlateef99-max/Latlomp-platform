/* ============================================
   LATLOMP INSTITUTION — PAYSTACK WEBHOOK
   
   Endpoint: POST /api/institution/payment/webhook
   
   Must be registered BEFORE express.json() in
   server.js so the raw body is available for
   signature verification.
   
   Handles:
   - charge.success  → activate subscription
   - charge.failed   → mark subscription failed
============================================ */

const express      = require('express');
const router       = express.Router();
const crypto       = require('crypto');
const School       = require('../models/School.model');
const { Subscription, SubscriptionPlan } = require('../models/Subscription.model');
const emailService = require('../services/inst.email.service');

/* ============================================
   POST /api/institution/payment/webhook
   Receives raw body — DO NOT apply json parser
============================================ */
router.post('/webhook', async (req, res) => {
  try {
    /* Verify Paystack signature */
    var hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '')
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      console.warn('[Payment] Invalid Paystack signature — rejected.');
      return res.status(400).json({ status: false });
    }

    var event = req.body;
    console.log('[Payment] Webhook received:', event.event);

    /* ---- charge.success ---- */
    if (event.event === 'charge.success') {
      var data     = event.data;
      var meta     = data.metadata || {};
      var ref      = data.reference;
      var paid     = data.amount / 100;  /* kobo → naira */

      /* Only process institution subscriptions */
      if (meta.type !== 'institution_subscription') {
        return res.status(200).json({ status: true });
      }

      var schoolId  = meta.schoolId;
      var planCode  = meta.planCode;

      /* Find the pending subscription record */
      var sub = await Subscription.findOne({ paymentRef: ref, status: 'pending' });
      if (!sub) {
        console.warn('[Payment] No pending subscription found for ref:', ref);
        return res.status(200).json({ status: true });
      }

      /* Validate amount matches plan */
      var plan = await SubscriptionPlan.findOne({ code: planCode, isActive: true });
      if (!plan) {
        console.error('[Payment] Plan not found:', planCode);
        return res.status(200).json({ status: true });
      }

      if (paid < plan.price) {
        console.warn('[Payment] Underpayment detected:', paid, 'expected:', plan.price);
        sub.status = 'cancelled';
        sub.notes  = 'Underpayment: received ₦' + paid + ', expected ₦' + plan.price;
        await sub.save();
        return res.status(200).json({ status: true });
      }

      /* Activate subscription */
      var now     = new Date();
      var endDate = new Date(now.getTime() + plan.durationDays * 86400000);

      sub.status      = 'active';
      sub.paidAt      = now;
      sub.paidAmount  = paid;
      sub.startDate   = now;
      sub.endDate     = endDate;
      sub.paymentChannel = data.channel || '';
      await sub.save();

      /* Update school */
      var school = await School.findByIdAndUpdate(schoolId, {
        $set: {
          status:             'active',
          subscriptionPlan:   planCode,
          subscriptionExpiry: endDate,
          isSuspended:        false
        }
      }, { new: true });

      if (school) {
        /* Send confirmation email */
        try {
          await emailService.sendSubscriptionConfirmed({
            toEmail:    school.email,
            schoolName: school.name,
            planName:   plan.name,
            amount:     paid,
            expiryDate: endDate,
            reference:  ref
          });
        } catch (emailErr) {
          console.warn('[Payment] Confirmation email failed:', emailErr.message);
        }

        console.log('[Payment] Activated:', school.name, '→', planCode, 'until', endDate.toISOString().split('T')[0]);
      }
    }

    /* ---- charge.failed ---- */
    if (event.event === 'charge.failed') {
      var ref = event.data && event.data.reference;
      if (ref) {
        await Subscription.findOneAndUpdate(
          { paymentRef: ref, status: 'pending' },
          { $set: { status: 'cancelled', notes: 'Charge failed at ' + new Date().toISOString() } }
        );
      }
    }

    return res.status(200).json({ status: true });

  } catch (err) {
    console.error('[Payment] Webhook error:', err.message);
    return res.status(200).json({ status: true }); /* Always 200 to Paystack */
  }
});

/* ============================================
   GET /api/institution/payment/verify/:ref
   Manual verification fallback (called after
   Paystack redirect returns to dashboard)
============================================ */
router.get('/verify/:ref', async (req, res) => {
  try {
    var ref = req.params.ref;

    /* Check Paystack directly */
    var paystackRes = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(ref), {
      headers: { 'Authorization': 'Bearer ' + process.env.PAYSTACK_SECRET_KEY }
    });

    var paystackData = await paystackRes.json();

    if (!paystackData.status || paystackData.data.status !== 'success') {
      return res.status(400).json({ success: false, message: 'Payment not confirmed.' });
    }

    /* Check our sub record */
    var sub = await Subscription.findOne({ paymentRef: ref });
    if (!sub) return res.status(404).json({ success: false, message: 'Subscription record not found.' });

    return res.status(200).json({
      success:  true,
      status:   sub.status,
      plan:     sub.plan,
      planName: sub.planName,
      endDate:  sub.endDate
    });

  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;