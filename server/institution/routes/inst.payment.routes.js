/* ============================================
   LATLOMP INSTITUTION — PAYSTACK PAYMENT ROUTES

   POST /api/institution/payment/webhook
   GET  /api/institution/payment/verify/:ref

   ✅ FOUNDATION FIX: req.body is a raw Buffer
   because server.js registers express.raw() for
   this route BEFORE express.json().

   ✅ STAGE 3: Full audit logging added for all
   payment events. Every webhook receipt,
   activation, failure, and edge case is now
   written to AuditLog and visible in the
   admin dashboard → Institutions → Audit Logs.
============================================ */
const express      = require('express');
const router       = express.Router();
const crypto       = require('crypto');
const School       = require('../models/School.model');
const { Subscription, SubscriptionPlan } = require('../models/Subscription.model');
const emailService = require('../services/inst.email.service');
const { logAudit } = require('../../middleware/audit.middleware');

/* ============================================
   POST /api/institution/payment/webhook

   Paystack calls this URL after every charge.
   We verify the HMAC signature first, then
   process the event type.

   IMPORTANT: req.body is a raw Buffer here,
   not parsed JSON. server.js applies
   express.raw() to this path before express.json().
============================================ */
router.post('/webhook', async (req, res) => {
  try {

    /* ---- Step 1: Verify Paystack HMAC signature ---- */
    var hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '')
      .update(req.body)
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      /* ✅ STAGE 3: Log rejected webhooks — could indicate
         a misconfigured secret key or a spoofing attempt */
      logAudit({
        req,
        action:  'institution.payment.webhook.signature_failed',
        success: false,
        message: 'Paystack webhook rejected — HMAC signature mismatch. ' +
                 'Check PAYSTACK_SECRET_KEY environment variable.'
      });
      console.warn('[InstPayment] Invalid Paystack signature — rejected.');
      return res.status(400).json({ status: false });
    }

    /* ---- Step 2: Parse the raw buffer into JSON ---- */
    var event;
    try {
      event = JSON.parse(req.body.toString());
    } catch (parseErr) {
      /* ✅ STAGE 3: Log unparseable bodies */
      logAudit({
        req,
        action:  'institution.payment.webhook.parse_failed',
        success: false,
        message: 'Webhook body could not be parsed as JSON: ' + parseErr.message
      });
      console.error('[InstPayment] Failed to parse webhook body:', parseErr.message);
      return res.status(400).json({ status: false });
    }

    /* ✅ STAGE 3: Log every webhook receipt so we have
       a full history even for event types we do not act on */
    logAudit({
      req,
      action:  'institution.payment.webhook.received',
      success: true,
      message: 'Webhook received: ' + event.event +
               (event.data && event.data.reference
                 ? ' | ref: ' + event.data.reference
                 : '')
    });

    console.log('[InstPayment] Webhook received:', event.event);

    /* ============================================
       CHARGE SUCCESS
    ============================================ */
    if (event.event === 'charge.success') {
      var data = event.data;
      var meta = data.metadata || {};
      var ref  = data.reference;
      var paid = data.amount / 100;   /* kobo → naira */

      /* ---- Route to the correct handler by payment type ---- */
     if (meta.type === 'institution_fee_payment') {
        /* ✅ R2: School fee payment webhook */
        await handleFeePaymentWebhook(event.data, meta, ref, paid, req);
        return res.status(200).json({ status: true });
      }

      if (meta.type === 'alumni_contribution') {
        /* ✅ E6: Alumni contribution payment webhook */
        await handleAlumniContributionWebhook(event.data, meta, ref, req);
        return res.status(200).json({ status: true });
      }

      if (meta.type !== 'institution_subscription') {
        logAudit({
          req,
          action:  'institution.payment.webhook.skipped',
          success: true,
          message: 'charge.success skipped — type is not institution_subscription.' +
                   ' type=' + (meta.type || 'none') + ' ref=' + ref
        });
        return res.status(200).json({ status: true });
      }

      var schoolId = meta.schoolId;
      var planCode = meta.planCode;

      /* ---- Find pending subscription record ---- */
      var sub = await Subscription.findOne({ paymentRef: ref, status: 'pending' });

      if (!sub) {
        /* ✅ STAGE 3: Log duplicate or orphaned webhooks.
           This fires when Paystack sends the same webhook
           twice (common) and the second call finds no
           pending record because the first already activated it. */
        logAudit({
          req,
          action:  'institution.payment.webhook.duplicate_or_orphan',
          success: true,
          message: 'No pending subscription found for ref: ' + ref +
                   ' (already processed or never created). schoolId=' + schoolId
        });
        console.warn('[InstPayment] No pending subscription for ref:', ref);
        return res.status(200).json({ status: true });
      }

      /* ---- Validate plan exists ---- */
      var plan = await SubscriptionPlan.findOne({ code: planCode, isActive: true });

      if (!plan) {
        /* ✅ STAGE 3: Log missing plan — actionable alert for admin */
        logAudit({
          req,
          action:  'institution.payment.webhook.plan_not_found',
          success: false,
          message: 'charge.success received but plan not found.' +
                   ' planCode=' + planCode + ' ref=' + ref +
                   ' schoolId=' + schoolId +
                   ' — subscription NOT activated. Admin action required.'
        });
        console.error('[InstPayment] Plan not found:', planCode);
        return res.status(200).json({ status: true });
      }

      /* ---- Validate amount — reject underpayment ---- */
      if (paid < plan.price) {
        sub.status = 'cancelled';
        sub.notes  = 'Underpayment: received ₦' + paid + ', expected ₦' + plan.price;
        await sub.save();

        /* ✅ STAGE 3: Log underpayment — needs manual review */
        logAudit({
          req,
          action:  'institution.payment.webhook.underpayment',
          success: false,
          message: 'Underpayment detected. ref=' + ref +
                   ' paid=₦' + paid + ' expected=₦' + plan.price +
                   ' planCode=' + planCode + ' schoolId=' + schoolId +
                   ' — subscription cancelled.'
        });
        console.warn('[InstPayment] Underpayment:', paid, 'expected:', plan.price);
        return res.status(200).json({ status: true });
      }

      /* ---- Activate subscription ---- */
      var now     = new Date();
      var endDate = new Date(now.getTime() + plan.durationDays * 86400000);

      sub.status         = 'active';
      sub.paidAt         = now;
      sub.paidAmount     = paid;
      sub.startDate      = now;
      sub.endDate        = endDate;
      sub.paymentChannel = data.channel || '';
      await sub.save();

      /* ---- Update school record ---- */
      var school = await School.findByIdAndUpdate(schoolId, {
        $set: {
          status:             'active',
          subscriptionPlan:   planCode,
          subscriptionExpiry: endDate,
          isSuspended:        false,
          suspendReason:      ''
        }
      }, { new: true });

      if (school) {
        /* ✅ STAGE 3: Log successful activation — the most important log entry */
        logAudit({
          req,
          action:     'institution.payment.subscription.activated',
          resource:   'School',
          resourceId: schoolId,
          success:    true,
          message:    'Subscription activated via Paystack webhook.' +
                      ' school=' + school.name +
                      ' plan=' + planCode +
                      ' amount=₦' + paid +
                      ' expiry=' + endDate.toISOString().split('T')[0] +
                      ' ref=' + ref +
                      ' channel=' + (data.channel || 'unknown')
        });

        console.log(
          '[InstPayment] Activated:',
          school.name, '→', planCode,
          'until', endDate.toISOString().split('T')[0]
        );

        /* ---- Send confirmation email (non-blocking) ---- */
        try {
          await emailService.sendSubscriptionConfirmed({
            toEmail:    school.email,
            schoolName: school.name,
            planName:   plan.name,
            amount:     paid,
            expiryDate: endDate,
            reference:  ref
          });

          /* ✅ STAGE 3: Log successful email */
          logAudit({
            req,
            action:     'institution.payment.email.sent',
            resource:   'School',
            resourceId: schoolId,
            success:    true,
            message:    'Subscription confirmation email sent to ' + school.email
          });
        } catch (emailErr) {
          /* ✅ STAGE 3: Log email failure separately — payment still succeeded */
          logAudit({
            req,
            action:     'institution.payment.email.failed',
            resource:   'School',
            resourceId: schoolId,
            success:    false,
            message:    'Subscription activated but confirmation email failed.' +
                        ' email=' + school.email +
                        ' error=' + emailErr.message
          });
          console.warn('[InstPayment] Confirmation email failed:', emailErr.message);
        }
      } else {
        /* ✅ STAGE 3: Log case where school was deleted between
           payment init and webhook receipt — very rare edge case */
        logAudit({
          req,
          action:  'institution.payment.webhook.school_not_found',
          success: false,
          message: 'charge.success processed but school not found for update.' +
                   ' schoolId=' + schoolId + ' ref=' + ref +
                   ' — subscription record activated but school record missing.'
        });
      }
    }

    /* ============================================
       CHARGE FAILED
    ============================================ */
    if (event.event === 'charge.failed') {
      var failRef  = event.data && event.data.reference;
      var failMeta = (event.data && event.data.metadata) || {};

      if (failRef) {
        var failedSub = await Subscription.findOneAndUpdate(
          { paymentRef: failRef, status: 'pending' },
          {
            $set: {
              status: 'cancelled',
              notes:  'Charge failed at ' + new Date().toISOString() +
                      (event.data.gateway_response
                        ? ' — ' + event.data.gateway_response
                        : '')
            }
          }
        );

        /* ✅ STAGE 3: Log payment failure with as much detail as possible */
        logAudit({
          req,
          action:  'institution.payment.charge.failed',
          success: false,
          message: 'Paystack charge.failed event received.' +
                   ' ref=' + failRef +
                   ' schoolId=' + (failMeta.schoolId || 'unknown') +
                   ' planCode=' + (failMeta.planCode || 'unknown') +
                   ' gateway_response=' + (event.data.gateway_response || 'none') +
                   (failedSub ? ' — pending subscription cancelled.' : ' — no pending subscription found.')
        });

        console.warn('[InstPayment] Charge failed for ref:', failRef);
      } else {
        /* ✅ STAGE 3: Log failed charge with no reference */
        logAudit({
          req,
          action:  'institution.payment.charge.failed',
          success: false,
          message: 'charge.failed event received with no reference. Cannot identify transaction.'
        });
      }
    }

    return res.status(200).json({ status: true });

  } catch (err) {
    /* ✅ STAGE 3: Log unexpected errors in the webhook handler */
    logAudit({
      req,
      action:  'institution.payment.webhook.error',
      success: false,
      message: 'Unexpected error in payment webhook handler: ' + err.message
    });
    console.error('[InstPayment] Webhook error:', err.message);
    /* Always return 200 to Paystack so it does not keep retrying */
    return res.status(200).json({ status: true });
  }
});

/* ============================================
   GET /api/institution/payment/verify/:ref

   Called by the Subscription Center page when
   Paystack redirects back after payment with
   ?payment=success&ref=...

   Verifies directly with Paystack server-side
   before returning status to the frontend.
   Frontend never activates subscription on its
   own — it only reads what this endpoint returns.
============================================ */
router.get('/verify/:ref', async (req, res) => {
  try {
    var ref = req.params.ref;

    /* ✅ STAGE 3: Log every verify attempt */
    logAudit({
      req,
      action:  'institution.payment.verify.attempt',
      success: true,
      message: 'Payment verify requested for ref: ' + ref
    });

    /* ---- Verify directly with Paystack ---- */
    var paystackRes = await fetch(
      'https://api.paystack.co/transaction/verify/' + encodeURIComponent(ref),
      {
        headers: {
          'Authorization': 'Bearer ' + process.env.PAYSTACK_SECRET_KEY
        }
      }
    );

    var paystackData = await paystackRes.json();

    if (!paystackData.status || paystackData.data.status !== 'success') {
      /* ✅ STAGE 3: Log Paystack rejection */
      logAudit({
        req,
        action:  'institution.payment.verify.not_confirmed',
        success: false,
        message: 'Paystack did not confirm payment.' +
                 ' ref=' + ref +
                 ' paystack_status=' + (paystackData.data && paystackData.data.status
                   ? paystackData.data.status : 'unknown')
      });
      return res.status(400).json({
        success: false,
        message: 'Payment not confirmed by Paystack.'
      });
    }

    /* ---- Check our subscription record ---- */
    var sub = await Subscription.findOne({ paymentRef: ref });

    if (!sub) {
      /* ✅ STAGE 3: Log missing subscription record after Paystack confirmed */
      logAudit({
        req,
        action:  'institution.payment.verify.record_missing',
        success: false,
        message: 'Paystack confirmed payment but no subscription record found.' +
                 ' ref=' + ref +
                 ' — webhook may not have fired yet or subscription was deleted.'
      });
      return res.status(404).json({
        success: false,
        message: 'Subscription record not found.'
      });
    }

    /* ✅ STAGE 3: Log successful verify */
    logAudit({
      req,
      action:     'institution.payment.verify.success',
      resource:   'Subscription',
      resourceId: sub._id.toString(),
      success:    true,
      message:    'Payment verified successfully.' +
                  ' ref=' + ref +
                  ' status=' + sub.status +
                  ' plan=' + sub.plan
    });

    /* If webhook already activated it, return current status.
       If status is still pending, webhook has not fired yet —
       the frontend polls this endpoint every 3 seconds. */
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
    /* ✅ STAGE 3: Log verify endpoint errors */
    logAudit({
      req,
      action:  'institution.payment.verify.error',
      success: false,
      message: 'Error in payment verify endpoint: ' + err.message +
               ' ref=' + req.params.ref
    });
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ R2: Fee payment webhook handler
   Idempotent — safe to call multiple times.
   Same end-state whether called via webhook
   or via /parent/fees/pay/verify endpoint.
============================================ */
async function handleAlumniContributionWebhook(data, meta, ref, req) {
  try {
    var AlumniContribution = require('../models/AlumniContribution.model');
    var existing = await AlumniContribution.findOne({
      paymentRef: ref, paymentStatus: 'completed'
    });
    if (existing) { return; /* idempotent */ }

    var totalKobo    = data.amount || 0;
    var platformKobo = data.transaction_charge || 0;
    var schoolKobo   = totalKobo - platformKobo;

    await AlumniContribution.findOneAndUpdate(
      { paymentRef: ref },
      {
        $set: {
          paymentStatus: 'completed',
          status:        'confirmed',
          amount:        schoolKobo / 100
        }
      }
    );
    logAudit({ req, action: 'alumni.contribution.webhook.processed', success: true,
      message: 'Alumni contribution confirmed via webhook. ref=' + ref });
  } catch (err) {
    logAudit({ req, action: 'alumni.contribution.webhook.error', success: false,
      message: 'Error: ' + err.message + ' ref=' + ref });
    console.error('[E6/ContribWebhook]', err.message);
  }
}

async function handleFeePaymentWebhook(data, meta, ref, paid, req) {
  try {
    var SchoolFeePayment    = null;
    var SchoolFeeAssignment = null;
    try {
      SchoolFeePayment    = require('../models/SchoolFeePayment.model');
      SchoolFeeAssignment = require('../models/SchoolFeeAssignment.model');
    } catch (e) { console.error('[FeeWebhook] Model load failed:', e.message); return; }

    /* Idempotency: skip if already processed */
    var existing = await SchoolFeePayment.findOne({ paystackRef: ref, status: 'confirmed' });
    if (existing) {
      logAudit({ req, action: 'institution.fee.webhook.duplicate', success: true,
        message: 'Fee payment already recorded for ref: ' + ref });
      return;
    }

    var assignmentId = meta.assignmentId;
    if (!assignmentId) {
      logAudit({ req, action: 'institution.fee.webhook.no_assignment', success: false,
        message: 'Fee webhook missing assignmentId. ref=' + ref });
      return;
    }

    var assignment = await SchoolFeeAssignment.findById(assignmentId);
    if (!assignment) {
      logAudit({ req, action: 'institution.fee.webhook.assignment_not_found', success: false,
        message: 'Assignment not found. assignmentId=' + assignmentId + ' ref=' + ref });
      return;
    }

    /* Generate receipt number */
    var receiptCount  = await SchoolFeePayment.countDocuments({ schoolId: assignment.schoolId });
    var receiptNumber = 'RCP-' + new Date().toISOString().slice(0,10).replace(/-/g,'') +
                        '-' + String(receiptCount + 1).padStart(4, '0');

    /* Extract amounts from Paystack data */
    var totalChargedKobo    = data.amount                 || 0;
    var platformFeeKobo     = data.transaction_charge     || 0;
    var schoolFeeKobo       = totalChargedKobo - platformFeeKobo;
    var providerFeeKobo     = data.fees                   || 0;

    /* Fetch platform fee percent used */
    var PlatformConfig = require('../models/PlatformConfig.model');
    var platformFeePercent = await PlatformConfig.getValue('platform_fee_percent', 0.5);

    /* Create confirmed payment record */
    await SchoolFeePayment.create({
      schoolId:          assignment.schoolId,
      studentId:         assignment.studentId,
      assignmentId:      assignment._id,
      feeStructureId:    assignment.feeStructureId,
      termId:            assignment.termId,
      amount:            schoolFeeKobo / 100,          /* school's portion */
      currency:          data.currency || assignment.currency || 'NGN',
      method:            'paystack',
      paystackRef:       ref,
      externalRef:       ref,
      receiptNumber,
      status:            'confirmed',
      totalCharged:      totalChargedKobo / 100,
      platformFeePercent,
      platformFeeAmount: platformFeeKobo / 100,
      providerFeeAmount: providerFeeKobo / 100,
      recordedAt:        new Date()
    });

    /* Sync assignment balance */
    var payments  = await SchoolFeePayment.find({ assignmentId: assignment._id, status: 'confirmed' });
    var totalPaid = payments.reduce(function (s, p) { return s + p.amount; }, 0);
    var netDue    = assignment.amountDue - (assignment.discount || 0);
    var balance   = Math.max(0, netDue - totalPaid);
    var newStatus = totalPaid <= 0 ? 'pending'
                  : balance  >  0 ? 'partial'
                  :                  'paid';

    await SchoolFeeAssignment.findByIdAndUpdate(assignment._id, {
      $set: { amountPaid: totalPaid, balance, status: newStatus,
              paidAt: newStatus === 'paid' ? new Date() : null }
    });

    logAudit({ req, action: 'institution.fee.webhook.processed', success: true,
      message: 'Fee payment recorded via webhook. ref=' + ref +
               ' amount=' + (schoolFeeKobo/100) + ' student=' + assignment.studentId });

  } catch (err) {
    logAudit({ req, action: 'institution.fee.webhook.error', success: false,
      message: 'Fee webhook error: ' + err.message + ' ref=' + ref });
    console.error('[FeeWebhook] Error:', err.message);
  }
}

module.exports = router;