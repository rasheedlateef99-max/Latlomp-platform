/* ============================================
   LATLOMP INSTITUTION — PAYSTACK PAYMENT ROUTES

   POST /api/institution/payment/webhook
   GET  /api/institution/payment/verify/:ref
============================================ */
const express      = require('express');
const router       = express.Router();
const crypto       = require('crypto');
const School       = require('../models/School.model');
const { Subscription, SubscriptionPlan } = require('../models/Subscription.model');
const emailService = require('../services/inst.email.service');

/* ============================================
   POST /api/institution/payment/webhook

   ✅ FIX: req.body is a raw Buffer because server.js
   registers express.raw() for this route BEFORE
   express.json(). This is required for HMAC verification.

   WRONG (old):  crypto.update(JSON.stringify(req.body))
     → JSON.stringify(Buffer) produces {"type":"Buffer","data":[...]}
     → HMAC never matches Paystack signature → all webhooks rejected

   CORRECT (now): crypto.update(req.body)
     → req.body is the raw Buffer → HMAC matches correctly
============================================ */
router.post('/webhook', async (req, res) => {
  try {
    /* ✅ FIXED: use raw Buffer directly, not JSON.stringify */
    var hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '')
      .update(req.body)
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      console.warn('[InstPayment] Invalid Paystack signature — rejected.');
      return res.status(400).json({ status: false });
    }

    /* Parse the raw buffer into JSON after signature is verified */
    var event;
    try {
      event = JSON.parse(req.body.toString());
    } catch (parseErr) {
      console.error('[InstPayment] Failed to parse webhook body:', parseErr.message);
      return res.status(400).json({ status: false });
    }

    console.log('[InstPayment] Webhook received:', event.event);

    /* ---- charge.success ---- */
    if (event.event === 'charge.success') {
      var data = event.data;
      var meta = data.metadata || {};
      var ref  = data.reference;
      var paid = data.amount / 100;   /* kobo → naira */

      /* Only process institution subscriptions */
      if (meta.type !== 'institution_subscription') {
        return res.status(200).json({ status: true });
      }

      var schoolId = meta.schoolId;
      var planCode = meta.planCode;

      /* Find the pending subscription record */
      var sub = await Subscription.findOne({ paymentRef: ref, status: 'pending' });
      if (!sub) {
        console.warn('[InstPayment] No pending subscription for ref:', ref);
        return res.status(200).json({ status: true });
      }

      /* Validate amount matches plan */
      var plan = await SubscriptionPlan.findOne({ code: planCode, isActive: true });
      if (!plan) {
        console.error('[InstPayment] Plan not found:', planCode);
        return res.status(200).json({ status: true });
      }

      if (paid < plan.price) {
        console.warn('[InstPayment] Underpayment:', paid, 'expected:', plan.price);
        sub.status = 'cancelled';
        sub.notes  = 'Underpayment: received ₦' + paid + ', expected ₦' + plan.price;
        await sub.save();
        return res.status(200).json({ status: true });
      }

      /* Activate subscription */
      var now     = new Date();
      var endDate = new Date(now.getTime() + plan.durationDays * 86400000);

      sub.status         = 'active';
      sub.paidAt         = now;
      sub.paidAmount     = paid;
      sub.startDate      = now;
      sub.endDate        = endDate;
      sub.paymentChannel = data.channel || '';
      await sub.save();

      /* Update school record */
      var school = await School.findByIdAndUpdate(schoolId, {
        $set: {
          status:             'active',
          subscriptionPlan:   planCode,
          subscriptionExpiry: endDate,
          isSuspended:        false
        }
      }, { new: true });

      if (school) {
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
          console.warn('[InstPayment] Confirmation email failed:', emailErr.message);
        }
        console.log('[InstPayment] Activated:', school.name, '→', planCode, 'until', endDate.toISOString().split('T')[0]);
      }
    }

    /* ---- charge.failed ---- */
    if (event.event === 'charge.failed') {
      var failRef = event.data && event.data.reference;
      if (failRef) {
        await Subscription.findOneAndUpdate(
          { paymentRef: failRef, status: 'pending' },
          { $set: { status: 'cancelled', notes: 'Charge failed at ' + new Date().toISOString() } }
        );
        console.warn('[InstPayment] Charge failed for ref:', failRef);
      }
    }

    return res.status(200).json({ status: true });

  } catch (err) {
    console.error('[InstPayment] Webhook error:', err.message);
    return res.status(200).json({ status: true }); /* Always 200 to Paystack */
  }
});

/* ============================================
   GET /api/institution/payment/verify/:ref

   Called by the dashboard when Paystack redirects
   back after payment with ?payment=success&ref=...
   Confirms the subscription was activated correctly.
============================================ */
router.get('/verify/:ref', async (req, res) => {
  try {
    var ref = req.params.ref;

    /* Verify directly with Paystack */
    var paystackRes = await fetch(
      'https://api.paystack.co/transaction/verify/' + encodeURIComponent(ref),
      { headers: { 'Authorization': 'Bearer ' + process.env.PAYSTACK_SECRET_KEY } }
    );

    var paystackData = await paystackRes.json();

    if (!paystackData.status || paystackData.data.status !== 'success') {
      return res.status(400).json({ success: false, message: 'Payment not confirmed by Paystack.' });
    }

    /* Check our subscription record */
    var sub = await Subscription.findOne({ paymentRef: ref });
    if (!sub) {
      return res.status(404).json({ success: false, message: 'Subscription record not found.' });
    }

    /* If webhook already activated it, just return current status */
    return res.status(200).json({
      success:  true,
      status:   sub.status,
      plan:     sub.plan,
      planName: sub.planName,
      endDate:  sub.endDate,
      message:  sub.status === 'active'
        ? 'Subscription is active.'
        : 'Payment received. Activation in progress.'
    });

  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;