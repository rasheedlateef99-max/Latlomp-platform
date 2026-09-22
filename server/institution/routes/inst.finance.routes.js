'use strict';
/* ============================================
   LATLOMP — INSTITUTION FINANCE ROUTES (E7B)

   Banking-style finance dashboard API.
   Aggregates from authoritative R1/R2 models.
   Never creates a duplicate financial ledger.
   Never bypasses payment providers.

   Guard conventions:
   readGuard   — any authorised staff (view)
   manageGuard — can manage student records
   seniorGuard — senior staff (approve, refunds)
   adminGuard  — school admin only (config, delete)
============================================ */
const express         = require('express');
const router          = express.Router();
const mongoose        = require('mongoose');
const School          = require('../models/School.model');
const financeService  = require('../services/finance.service');
const SchoolPaymentClaim = require('../models/SchoolPaymentClaim.model');
const SchoolPaymentAllocation = require('../models/SchoolPaymentAllocation.model');
const financePdf      = require('../services/finance.pdf.service');
const { generateClaimReceiptPDF } = financePdf;
const {
  instProtect, schoolAdminOnly,
  seniorStaffOrAdmin, canManageStudents, teacherOrAdmin
} = require('../middleware/inst.auth');
const { requireActiveSubscription } = require('../middleware/inst.tenant');

var adminGuard  = [instProtect, schoolAdminOnly,    requireActiveSubscription];
var seniorGuard = [instProtect, seniorStaffOrAdmin, requireActiveSubscription];
var manageGuard = [instProtect, canManageStudents,  requireActiveSubscription];
var readGuard   = [instProtect, teacherOrAdmin,     requireActiveSubscription];

/* ============================================
   P6 HELPERS
   Defined at module level so triggerP6Processing
   can call them. Not exported — used only here.
============================================ */

/* Atomic receipt number — mirrors the implementation in inst.fee.routes.js
   Uses the same SchoolCounter keyed 'rcpt:<schoolId>' so both staff-direct
   and claim-verified payments share a single sequence per school.          */
async function generateReceiptNumberForClaim(schoolId) {
  var SchoolCounter    = require('../models/SchoolCounter.model');
  var SchoolFeePayment = require('../models/SchoolFeePayment.model');
  var key = 'rcpt:' + schoolId.toString();

  /* Seed on first use — same logic as inst.fee.routes.js */
  var existing = await SchoolCounter.findOne({ _id: key }).lean();
  if (!existing) {
    var seed = await SchoolFeePayment.countDocuments({ schoolId: schoolId });
    await SchoolCounter.findOneAndUpdate(
      { _id: key },
      { $setOnInsert: { seq: seed } },
      { upsert: true }
    );
  }

  var counter = await SchoolCounter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { new: true }
  );

  var d    = new Date();
  var date = d.getFullYear().toString() +
             String(d.getMonth() + 1).padStart(2, '0') +
             String(d.getDate()).padStart(2, '0');
  return 'RCP-' + date + '-' + String(counter.seq).padStart(4, '0');
}

/* Recalculate a fee assignment's balance from all confirmed payments.
   Mirrors syncAssignmentBalance() in inst.fee.routes.js — kept local
   to avoid a cross-file dependency on a non-exported function.          */
async function syncAssignmentBalanceLocal(assignmentId) {
  try {
    var SchoolFeeAssignment = require('../models/SchoolFeeAssignment.model');
    var SchoolFeePayment    = require('../models/SchoolFeePayment.model');

    var assignment = await SchoolFeeAssignment.findById(assignmentId);
    if (!assignment) return;

    var payments  = await SchoolFeePayment.find({
      assignmentId: assignmentId,
      status:       'confirmed'
    });
    var totalPaid = payments.reduce(function(s, p) { return s + (p.amount || 0); }, 0);
    var netDue    = (assignment.amountDue || 0) - (assignment.discount || 0);
    var balance   = Math.max(0, netDue - totalPaid);

    var newStatus = assignment.status;
    if (totalPaid <= 0)   newStatus = 'pending';
    else if (balance > 0) newStatus = 'partial';
    else                  newStatus = 'paid';

    assignment.amountPaid = totalPaid;
    assignment.balance    = balance;
    assignment.status     = newStatus;
    if (newStatus === 'paid' && !assignment.paidAt) {
      assignment.paidAt = new Date();
    }
    await assignment.save();
  } catch(err) {
    console.error('[P6] syncAssignmentBalanceLocal failed:', err.message);
  }
}

/* ---- Parse period from query params ---- */
function parsePeriod(query) {
  return {
    type:    query.period || 'month',
    from:    query.from   || null,
    to:      query.to     || null,
    termId:  query.termId || null,
    session: query.session|| null
  };
}

/* ============================================
   GET /api/institution/finance/summary
   Dashboard summary statistics.
   Query: ?period=today|week|month|term|session|custom|all
          &from=&to=&termId=&session=
============================================ */
router.get('/summary', readGuard, async function(req, res) {
  try {
    var period  = parsePeriod(req.query);
    var summary = await financeService.getFinanceSummary(req.schoolId, period);
    return res.json({ success: true, summary });
  } catch(err) {
    console.error('[finance] GET /summary:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/finance/transactions
   Paginated transaction list.
   Query: ?status=&studentName=&ref=&from=&to=
          &minAmount=&maxAmount=&method=&termId=
          &studentId=&page=&limit=
============================================ */
router.get('/transactions', readGuard, async function(req, res) {
  try {
    var result = await financeService.getTransactions(
      req.schoolId, req.query,
      req.query.page, req.query.limit
    );
    return res.json({ success: true, ...result });
  } catch(err) {
    console.error('[finance] GET /transactions:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/finance/transactions/:id
   Full transaction detail with enrichment.
============================================ */
router.get('/transactions/:id', readGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid transaction ID.' });
    }

    var transaction = await financeService.getTransactionById(req.schoolId, req.params.id);
    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }

    return res.json({ success: true, transaction });
  } catch(err) {
    console.error('[finance] GET /transactions/:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/finance/transactions/:id/receipt
   Download PDF receipt for a payment.
============================================ */
router.get('/transactions/:id/receipt', readGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid transaction ID.' });
    }

    var transaction = await financeService.getTransactionById(req.schoolId, req.params.id);
    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }
    if (transaction.status !== 'confirmed') {
      return res.status(400).json({ success: false, message: 'Receipt only available for confirmed payments.' });
    }

    var school = await School.findById(req.schoolId)
      .select('name logo address phone primaryColor').lean();

    var pdfBuffer;
    try {
      pdfBuffer = await financePdf.generateReceiptPDF(transaction, school);
    } catch(pdfErr) {
      if (pdfErr.message.includes('pdfkit')) {
        return res.status(503).json({ success: false, message: 'PDF service unavailable. Run: npm install pdfkit' });
      }
      throw pdfErr;
    }

    var studentName = transaction.studentId ? transaction.studentId.name || '' : '';
    var filename    = 'Receipt_' + (transaction.receiptNumber || transaction._id) + '_' +
                      studentName.replace(/[^a-zA-Z0-9]/g, '_') + '.pdf';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.end(pdfBuffer);
  } catch(err) {
    console.error('[finance] GET /receipt:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/finance/outstanding
   Outstanding fee balances.
   Query: ?studentId=&termId=&studentName=&page=&limit=
============================================ */
router.get('/outstanding', readGuard, async function(req, res) {
  try {
    var result = await financeService.getOutstandingBalances(req.schoolId, req.query);
    return res.json({ success: true, ...result });
  } catch(err) {
    console.error('[finance] GET /outstanding:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/finance/analytics
   Charts data. Query: ?period=
============================================ */
router.get('/analytics', readGuard, async function(req, res) {
  try {
    var period    = parsePeriod(req.query);
    var analytics = await financeService.getAnalyticsTrends(req.schoolId, period);
    return res.json({ success: true, analytics });
  } catch(err) {
    console.error('[finance] GET /analytics:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/finance/reconciliation
   Cross-reference payments vs assignments.
   Query: ?studentId=&termId=&status=
============================================ */
router.get('/reconciliation', manageGuard, async function(req, res) {
  try {
    var SchoolFeeAssignment = require('../models/SchoolFeeAssignment.model');
    var SchoolFeePayment    = require('../models/SchoolFeePayment.model');
    var mongoose            = require('mongoose');

    var pageNum  = Math.max(1, parseInt(req.query.page)  || 1);
    var limitNum = Math.min(50, parseInt(req.query.limit) || 25);
    var skip     = (pageNum - 1) * limitNum;

    var filter   = { schoolId: req.schoolId };
    if (req.query.studentId) filter.studentId = req.query.studentId;
    if (req.query.termId)    filter.termId    = req.query.termId;
    if (req.query.status)    filter.status    = req.query.status;

    var [assignments, total] = await Promise.all([
      SchoolFeeAssignment.find(filter)
        .populate('studentId',    'name admissionNo class classId')
        .populate('feeStructureId','name category')
        .populate('termId',        'name session')
        .sort({ createdAt: -1 })
        .skip(skip).limit(limitNum)
        .lean(),
      SchoolFeeAssignment.countDocuments(filter)
    ]);

    /* Batch-load payments for these assignments */
    var assignmentIds = assignments.map(function(a) { return a._id; });
    var payments      = await SchoolFeePayment.find({
      schoolId:     req.schoolId,
      assignmentId: { $in: assignmentIds }
    }).select('assignmentId amount status method receiptNumber paystackRef recordedAt').lean();

    var paymentsByAssignment = {};
    payments.forEach(function(p) {
      var key = p.assignmentId.toString();
      if (!paymentsByAssignment[key]) paymentsByAssignment[key] = [];
      paymentsByAssignment[key].push(p);
    });

    var reconciled = assignments.map(function(a) {
      return Object.assign({}, a, {
        payments: paymentsByAssignment[a._id.toString()] || [],
        isFullyReconciled: a.status === 'paid',
        hasPaymentRecord:  !!(paymentsByAssignment[a._id.toString()] && paymentsByAssignment[a._id.toString()].length)
      });
    });

    /* Name search post-populate */
    if (req.query.studentName) {
      var rx = new RegExp(req.query.studentName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      reconciled = reconciled.filter(function(a) {
        return a.studentId && rx.test(a.studentId.name || '');
      });
    }

    return res.json({ success: true, assignments: reconciled, total, page: pageNum, pages: Math.ceil(total / limitNum) });
  } catch(err) {
    console.error('[finance] GET /reconciliation:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /api/institution/finance/statements/generate
   Generate statement for a period.
   Body: { period, format: 'pdf'|'excel' }
============================================ */
router.post('/statements/generate', seniorGuard, async function(req, res) {
  try {
    var period = req.body.period || { type: 'month' };
    var format = req.body.format || 'pdf';

    var school = await School.findById(req.schoolId)
      .select('name logo address phone primaryColor motto principalName').lean();

    var statementData = await financeService.assembleStatementData(req.schoolId, period, school);
    if (!statementData) {
      return res.status(404).json({ success: false, message: 'Financial data not available.' });
    }

    var filename = 'Statement_' + (statementData.statementRef || Date.now());

    if (format === 'excel') {
      var excelBuffer = financePdf.generateStatementExcel(statementData);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '.xlsx"');
      return res.end(excelBuffer);
    }

    /* Default: PDF */
    var pdfBuffer;
    try {
      pdfBuffer = await financePdf.generateStatementPDF(statementData);
    } catch(pdfErr) {
      if (pdfErr.message.includes('pdfkit')) {
        return res.status(503).json({ success: false, message: 'PDF service unavailable. Run: npm install pdfkit' });
      }
      throw pdfErr;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '.pdf"');
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.end(pdfBuffer);
  } catch(err) {
    console.error('[finance] POST /statements/generate:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   DONATION CAMPAIGNS
============================================ */

/* POST /api/institution/finance/donations/campaigns */
router.post('/donations/campaigns', seniorGuard, async function(req, res) {
  try {
    var Campaign = require('../models/SchoolDonationCampaign.model');
    var {
      title, description, category, targetAmount, currency,
      isPublic, startDate, endDate,
      paymentAccountId, allowManualClaim, minContribution,
      targetAudience, visibility, publishedOn
    } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, message: 'Campaign title is required.' });
    }

    /* Validate paymentAccountId belongs to this school if provided */
    if (paymentAccountId && mongoose.isValidObjectId(paymentAccountId)) {
      var SchoolManualPaymentAccount = require('../models/SchoolManualPaymentAccount.model');
      var campAcctCheck = await SchoolManualPaymentAccount.findOne({
        _id:      paymentAccountId,
        schoolId: req.schoolId    /* TENANT SCOPE */
      }).select('_id').lean();
      if (!campAcctCheck) {
        return res.status(400).json({ success: false, message: 'Payment account not found.' });
      }
    }

    var campaign = await Campaign.create({
      schoolId:         req.schoolId,
      title:            title.trim(),
      description:      (description || '').trim(),
      category:         category             || 'general',
      targetAmount:     targetAmount         || null,
      currency:         currency             || 'NGN',
      isPublic:         !!isPublic,
      startDate:        startDate ? new Date(startDate) : new Date(),
      endDate:          endDate   ? new Date(endDate)   : null,
      status:           'active',
      paymentAccountId: (paymentAccountId && mongoose.isValidObjectId(paymentAccountId))
                          ? paymentAccountId : null,
      allowManualClaim: allowManualClaim !== false && allowManualClaim !== 'false',
      minContribution:  parseFloat(minContribution) || 0,
      targetAudience:   Array.isArray(targetAudience) ? targetAudience : ['parent', 'alumni', 'student'],
      visibility:       visibility           || 'internal',
      publishedOn:      Array.isArray(publishedOn) ? publishedOn : [],
      createdBy:        req.schoolUser._id,
      createdByName:    req.schoolUser.name  || ''
    });

    return res.status(201).json({ success: true, message: 'Donation campaign created.', campaign });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/institution/finance/donations/campaigns */
router.get('/donations/campaigns', readGuard, async function(req, res) {
  try {
    var Campaign = require('../models/SchoolDonationCampaign.model');
    var filter   = { schoolId: req.schoolId };
    if (req.query.status)   filter.status   = req.query.status;
    if (req.query.category) filter.category = req.query.category;

    var campaigns = await Campaign.find(filter)
      .sort({ createdAt: -1 }).lean();

    return res.json({ success: true, campaigns, count: campaigns.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/finance/donations/campaigns/:id */
router.put('/donations/campaigns/:id', seniorGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid campaign ID.' });
    }
    var Campaign = require('../models/SchoolDonationCampaign.model');
    var allowed = [
      'title', 'description', 'category', 'targetAmount', 'isPublic', 'status', 'endDate',
      'paymentAccountId', 'allowManualClaim', 'minContribution',
      'targetAudience', 'visibility', 'publishedOn'
    ];

    /* Validate paymentAccountId if being updated */
    if (req.body.paymentAccountId && mongoose.isValidObjectId(req.body.paymentAccountId)) {
      var SchoolManualPaymentAccountUpd = require('../models/SchoolManualPaymentAccount.model');
      var campAcctUpd = await SchoolManualPaymentAccountUpd.findOne({
        _id:      req.body.paymentAccountId,
        schoolId: req.schoolId
      }).select('_id').lean();
      if (!campAcctUpd) {
        return res.status(400).json({ success: false, message: 'Payment account not found.' });
      }
    }
    var updates  = {};
    allowed.forEach(function(f) {
      if (req.body[f] !== undefined) { updates[f] = req.body[f]; }
    });

    if (updates.status === 'closed') {
      updates.closedBy = req.schoolUser._id;
      updates.closedAt = new Date();
    }

    var campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: updates },
      { new: true }
    );
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found.' });
    }

    return res.json({ success: true, campaign });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/institution/finance/donations */
router.get('/donations', manageGuard, async function(req, res) {
  try {
    var Donation = require('../models/SchoolDonation.model');
    var filter   = { schoolId: req.schoolId };
    if (req.query.campaignId)  filter.campaignId  = req.query.campaignId;
    if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;
    if (req.query.donorType)   filter.donorType   = req.query.donorType;

    var donations = await Donation.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    var totalConfirmed = donations
      .filter(function(d) { return d.paymentStatus === 'completed'; })
      .reduce(function(s, d) { return s + (d.amount || 0); }, 0);

    return res.json({ success: true, donations, count: donations.length, totalConfirmed });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/institution/finance/donations (record non-financial or manual donation) */
router.post('/donations', manageGuard, async function(req, res) {
  try {
    var Donation = require('../models/SchoolDonation.model');
    var { campaignId, donorName, donorEmail, donorType, amount, currency,
          message, isAnonymous } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'A valid amount is required.' });
    }

    var donation = await Donation.create({
      schoolId:       req.schoolId,
      campaignId:     campaignId || null,
      donorType:      donorType  || 'external',
      donorName:      (donorName  || '').trim(),
      donorEmail:     (donorEmail || '').trim().toLowerCase(),
      isAnonymous:    !!isAnonymous,
      amount:         parseFloat(amount),
      currency:       currency   || 'NGN',
      message:        (message   || '').trim(),
      paymentStatus:  'completed', /* manually recorded = assumed completed */
      status:         'confirmed',
      recordedBy:     req.schoolUser._id,
      recordedByName: req.schoolUser.name || ''
    });

    /* Update campaign running total */
    if (campaignId) {
      var Campaign = require('../models/SchoolDonationCampaign.model');
      await Campaign.findByIdAndUpdate(campaignId, {
        $inc: { totalCollected: parseFloat(amount), donationCount: 1 }
      });
    }

    return res.status(201).json({ success: true, message: 'Donation recorded.', donation });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   REFUNDS
============================================ */

/* GET /api/institution/finance/refunds */
router.get('/refunds', manageGuard, async function(req, res) {
  try {
    var Refund = require('../models/SchoolFeeRefund.model');
    var filter = { schoolId: req.schoolId };
    if (req.query.status)    filter.status    = req.query.status;
    if (req.query.studentId) filter.studentId = req.query.studentId;

    var refunds = await Refund.find(filter)
      .populate('studentId',  'name admissionNo class')
      .populate('paymentId',  'receiptNumber amount paystackRef')
      .sort({ requestedAt: -1 })
      .lean();

    return res.json({ success: true, refunds, count: refunds.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/institution/finance/refunds
   Initiate a refund request for a payment.
   Body: { paymentId, reason, amount?, refundMethod? }
*/
router.post('/refunds', seniorGuard, async function(req, res) {
  try {
    var Refund              = require('../models/SchoolFeeRefund.model');
    var SchoolFeePayment    = require('../models/SchoolFeePayment.model');

    var { paymentId, reason, amount, refundMethod } = req.body;
    if (!paymentId || !reason) {
      return res.status(400).json({ success: false, message: 'paymentId and reason are required.' });
    }
    if (!mongoose.isValidObjectId(paymentId)) {
      return res.status(400).json({ success: false, message: 'Invalid payment ID.' });
    }

    var payment = await SchoolFeePayment.findOne({
      _id:      paymentId,
      schoolId: req.schoolId,
      status:   'confirmed'
    }).lean();
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Confirmed payment not found.' });
    }

    /* Check no existing pending/processing refund for same payment */
    var existingRefund = await Refund.findOne({
      paymentId,
      status: { $in: ['pending','processing'] }
    }).lean();
    if (existingRefund) {
      return res.status(400).json({
        success: false,
        message: 'A refund request for this payment is already pending.'
      });
    }

    var refundAmount = amount ? parseFloat(amount) : payment.amount;
    if (refundAmount > payment.amount) {
      return res.status(400).json({ success: false, message: 'Refund amount cannot exceed original payment amount.' });
    }

    var refund = await Refund.create({
      schoolId:        req.schoolId,
      paymentId:       payment._id,
      assignmentId:    payment.assignmentId,
      studentId:       payment.studentId,
      amount:          refundAmount,
      currency:        payment.currency || 'NGN',
      reason:          reason.trim(),
      refundMethod:    refundMethod || 'original_method',
      status:          'pending',
      requestedBy:     req.schoolUser._id,
      requestedByName: req.schoolUser.name || '',
      requestedAt:     new Date()
    });

    return res.status(201).json({
      success: true,
      message: 'Refund request created. Use /refunds/:id/process to execute.',
      refundId: refund._id,
      status:  refund.status
    });
  } catch(err) {
    console.error('[finance] POST /refunds:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/finance/refunds/:id/process
   Process/approve a pending refund.
   Admin only. Records provider reference if available.
   Body: { providerRefundRef?, notes? }
*/
router.put('/refunds/:id/process', adminGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid refund ID.' });
    }

    var Refund              = require('../models/SchoolFeeRefund.model');
    var SchoolFeeAssignment = require('../models/SchoolFeeAssignment.model');

    var refund = await Refund.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!refund) {
      return res.status(404).json({ success: false, message: 'Refund request not found.' });
    }
    if (refund.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only pending refunds can be processed. Current status: ' + refund.status
      });
    }

    /* ✅ E7B AUDIT: Attempt provider refund if no manual ref supplied */
    var providerRefundRef = (req.body.providerRefundRef || '').trim();
    var providerResponse  = '';

    if (!providerRefundRef) {
      /* Attempt automatic Paystack refund */
      try {
        var SchoolFeePayment2   = require('../models/SchoolFeePayment.model');
        var originalPayment     = await SchoolFeePayment2.findById(refund.paymentId)
          .select('paystackRef externalRef schoolId').lean();
        var txnRef = originalPayment && (originalPayment.paystackRef || originalPayment.externalRef);

        if (txnRef) {
          var SchoolPaymentAccount2 = require('../models/SchoolPaymentAccount.model');
          var payAccount2 = await SchoolPaymentAccount2.findOne({
            schoolId: req.schoolId, status: 'active'
          }).lean();
          if (payAccount2) {
            var { getProvider: getP2 } = require('../providers/payment.provider');
            var provider2 = getP2(payAccount2.provider || 'paystack');
            if (typeof provider2.refundPayment === 'function') {
              /* Amount in kobo (refund.amount is in NGN major units) */
              var amountKobo = Math.round((refund.amount || 0) * 100);
              var refundResult = await provider2.refundPayment(txnRef, amountKobo);
              if (refundResult.success) {
                providerRefundRef = refundResult.refundRef;
                providerResponse  = refundResult.message;
              } else {
                providerResponse = 'Provider refund unsuccessful: ' + refundResult.message;
              }
            }
          }
        }
      } catch (provErr) {
        console.warn('[finance] Provider refund attempt failed (non-fatal):', provErr.message);
        providerResponse = 'Provider refund attempt failed: ' + provErr.message;
      }
    }

    refund.status            = 'processed';
    refund.processedBy       = req.schoolUser._id;
    refund.processedByName   = req.schoolUser.name || '';
    refund.processedAt       = new Date();
    refund.providerRefundRef = providerRefundRef;
    refund.providerResponse  = providerResponse;
    refund.notes             = (req.body.notes || '').trim();
    await refund.save();

    /* Rebalance the fee assignment */
    try {
      var assignment = await SchoolFeeAssignment.findById(refund.assignmentId);
      if (assignment) {
        assignment.amountPaid = Math.max(0, (assignment.amountPaid || 0) - refund.amount);
        assignment.balance    = Math.max(0, (assignment.balance    || 0) + refund.amount);
        if (assignment.amountPaid === 0) { assignment.status = 'pending'; }
        else if (assignment.balance > 0){ assignment.status = 'partial'; }
        await assignment.save();
      }
    } catch(assignErr) {
      console.warn('[finance] Refund: could not rebalance assignment:', assignErr.message);
    }

    return res.json({ success: true, message: 'Refund processed.', refund });
  } catch(err) {
    console.error('[finance] PUT /refunds/:id/process:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/finance/refunds/:id/cancel */
router.put('/refunds/:id/cancel', seniorGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid refund ID.' });
    }

    var Refund = require('../models/SchoolFeeRefund.model');
    var refund = await Refund.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId, status: 'pending' },
      { $set: { status: 'cancelled', notes: (req.body.reason || '').trim() } },
      { new: true }
    );
    if (!refund) {
      return res.status(404).json({ success: false, message: 'Pending refund not found.' });
    }

    return res.json({ success: true, message: 'Refund request cancelled.', refund });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   STUDENT FINANCE PROFILE
   GET /api/institution/finance/students/:studentId
============================================ */
router.get('/students/:studentId', manageGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.studentId)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }

    var SchoolStudent       = require('../models/SchoolStudent.model');
    var SchoolFeePayment    = require('../models/SchoolFeePayment.model');
    var SchoolFeeAssignment = require('../models/SchoolFeeAssignment.model');
    var SchoolFeeRefund     = require('../models/SchoolFeeRefund.model');

    var student = await SchoolStudent.findOne({
      _id: req.params.studentId, schoolId: req.schoolId
    }).select('name admissionNo class classId status passportPhotoUrl').lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    var [payments, assignments, refunds] = await Promise.all([
      SchoolFeePayment.find({ schoolId: req.schoolId, studentId: req.params.studentId })
        .populate('feeStructureId', 'name category')
        .populate('termId', 'name session')
        .sort({ recordedAt: -1 })
        .lean(),
      SchoolFeeAssignment.find({ schoolId: req.schoolId, studentId: req.params.studentId })
        .populate('feeStructureId', 'name category')
        .populate('termId', 'name session')
        .sort({ createdAt: -1 })
        .lean(),
      SchoolFeeRefund.find({ schoolId: req.schoolId, studentId: req.params.studentId })
        .select('amount status reason requestedAt processedAt')
        .lean()
    ]);

    var totalPaid   = payments.filter(function(p) { return p.status === 'confirmed'; })
                              .reduce(function(s, p) { return s + (p.amount || 0); }, 0);
    var totalOwing  = assignments.filter(function(a) { return ['pending','partial'].includes(a.status); })
                                 .reduce(function(s, a) { return s + (a.balance || 0); }, 0);
    var totalRefund = refunds.filter(function(r) { return r.status === 'processed'; })
                             .reduce(function(s, r) { return s + (r.amount || 0); }, 0);

    return res.json({
      success: true,
      student,
      summary: {
        totalPaid,
        totalOwing,
        totalRefunded: totalRefund,
        paymentCount:  payments.length
      },
      payments,
      assignments,
      refunds
    });
  } catch(err) {
    console.error('[finance] GET /students/:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   P3 — CAMPAIGN PAYMENT ACCOUNT RESOLUTION
   GET /api/institution/finance/donations/campaigns/:id/payment-account

   Server-side resolution for campaign payment instructions.
   Same tenant + relationship + active-status enforcement as
   the fee structure equivalent in inst.fee.routes.js.

   P9 HOOK: Used by alumni/parent/student portals to get payment
   instructions for a specific campaign contribution.
============================================ */
router.get('/donations/campaigns/:id/payment-account', readGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid campaign ID.' });
    }

    var CampaignModel = require('../models/SchoolDonationCampaign.model');
    var campaign = await CampaignModel.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId,            /* TENANT SCOPE + IDOR */
      status:   { $in: ['active', 'paused'] }
    }).select('paymentAccountId title currency minContribution').lean();

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found.' });
    }
    if (!campaign.paymentAccountId) {
      return res.status(404).json({
        success: false,
        message: 'No payment account has been linked to this campaign. Contact your school administrator.'
      });
    }

    /* Resolve account — must belong to same school AND be active */
    var SchoolManualPaymentAccount = require('../models/SchoolManualPaymentAccount.model');
    var account = await SchoolManualPaymentAccount.findOne({
      _id:      campaign.paymentAccountId,
      schoolId: req.schoolId,            /* Double tenant scope */
      isActive: true
    })
    .select('accountLabel bankName accountName accountNumber currency country instructions')
    .lean();

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'The linked payment account is currently unavailable. Contact your school administrator.'
      });
    }

    return res.json({
      success:         true,
      campaignTitle:   campaign.title,
      currency:        campaign.currency,
      minContribution: campaign.minContribution,
      account:         account
    });
  } catch(err) {
    console.error('[finance] GET /donations/campaigns/:id/payment-account:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   P4 — FINANCE VIEW OF PAYMENT CLAIMS

   Finance staff reads claims here to build the
   verification queue (P5 expands this into full
   verify/reject UI).

   GET /api/institution/finance/claims
   Paginated claim list. Finance read access.
   Includes populated payer, assignment,
   campaign, and payment account data.

   GET /api/institution/finance/claims/pending/count
   Count of awaiting_verification claims.
   Used by the finance dashboard badge.
   Separate lightweight endpoint — no heavy populate.
============================================ */

/* GET /api/institution/finance/claims/pending/count
   Must be declared BEFORE /claims/:id to avoid
   Express treating 'pending' as a dynamic param.
*/
router.get('/claims/pending/count', readGuard, async function(req, res) {
  try {
    var count = await SchoolPaymentClaim.countDocuments({
      schoolId: req.schoolId,          /* TENANT SCOPE */
      status:   'awaiting_verification'
    });
    return res.json({ success: true, count });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/institution/finance/claims */
router.get('/claims', readGuard, async function(req, res) {
  try {
    var page   = Math.max(1, parseInt(req.query.page)   || 1);
    var limit  = Math.min(50, parseInt(req.query.limit) || 20);
    var skip   = (page - 1) * limit;

    /* Default to pending for the verification queue */
    var filter = {
      schoolId: req.schoolId,          /* TENANT SCOPE */
      status:   req.query.status || 'awaiting_verification'
    };

    if (req.query.payerType && req.query.payerType !== '') {
      filter.payerType = req.query.payerType;
    }
    if (req.query.campaignId && mongoose.isValidObjectId(req.query.campaignId)) {
      filter.campaignId = req.query.campaignId;
    }
    if (req.query.from || req.query.to) {
      filter.paymentDate = {};
      if (req.query.from) filter.paymentDate.$gte = new Date(req.query.from);
      if (req.query.to)   filter.paymentDate.$lte = new Date(req.query.to);
    }

    var [claims, total, pendingCount] = await Promise.all([
      SchoolPaymentClaim.find(filter)
        .populate('feeStructureId',   'name category')
        .populate('campaignId',       'title category')
        .populate('studentId',        'name admissionNo class passportPhotoUrl')
        .populate('assignmentId',     'amountDue amountPaid balance status')
        .populate('paymentAccountId', 'accountLabel bankName currency')
        .populate('submittedBy',      'name email')
        .populate('resultPaymentId',  'receiptNumber amount status verifiedAt') /* P6 */
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      SchoolPaymentClaim.countDocuments(filter),
      SchoolPaymentClaim.countDocuments({
        schoolId: req.schoolId,        /* TENANT SCOPE */
        status:   'awaiting_verification'
      })
    ]);

    return res.json({
      success: true,
      claims,
      pendingCount,
      pagination: {
        page, limit, total,
        pages:   Math.ceil(total / limit),
        hasMore: skip + claims.length < total
      }
    });
  } catch(err) {
    console.error('[finance] GET /claims:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   P5 — FINANCE CLAIM VERIFICATION QUEUE

   Three decision routes. All require senior staff
   or admin — verification has financial consequences.

   Permission boundary:
     Verify:             seniorGuard (seniorStaffOrAdmin)
     Reject:             seniorGuard
     Request Correction: staffGuard (any authorised staff)

   IMMUTABILITY RULE:
     Once a claim is 'verified', its status must not
     be changed here. Financial voids/reversals follow
     a separate path (P6+) and are never achieved by
     editing the claim record directly.

   P6 HOOK:
     The verify route calls triggerP6Processing() which
     is a documented stub. P6 replaces the stub body
     with: create SchoolFeePayment, create allocations,
     syncAssignmentBalance(), update campaign totals.
     The hook ensures the route signature is stable
     across P5 and P6 — no structural changes needed
     when P6 lands.
============================================ */

/* ---- Fire-and-forget payer notification ---- */
function notifyClaimDecision(type, claim, school) {
  try {
    var emailSvc = require('../services/inst.email.service');
    /* sendClaimVerified() and sendClaimRejected() are added to
       inst.email.service.js in P10 when we inspect its signatures.
       Until then the calls silently no-op if the function is absent. */
    if (type === 'verified' && typeof emailSvc.sendClaimVerified === 'function') {
      emailSvc.sendClaimVerified({
        toEmail:    claim.payerEmail || '',
        payerName:  claim.payerName,
        amount:     claim.amount,
        currency:   claim.currency,
        reference:  claim.reference,
        schoolName: school.name || ''
      }).catch(function(e) {
        console.warn('[p5] sendClaimVerified non-fatal:', e.message);
      });
    }
    if (type === 'rejected' && typeof emailSvc.sendClaimRejected === 'function') {
      emailSvc.sendClaimRejected({
        toEmail:         claim.payerEmail || '',
        payerName:       claim.payerName,
        amount:          claim.amount,
        currency:        claim.currency,
        rejectionReason: claim.rejectionReason || '',
        schoolName:      school.name || ''
      }).catch(function(e) {
        console.warn('[p5] sendClaimRejected non-fatal:', e.message);
      });
    }
    if (type === 'needs_correction' && typeof emailSvc.sendClaimNeedsCorrection === 'function') {
      emailSvc.sendClaimNeedsCorrection({
        toEmail:         claim.payerEmail || '',
        payerName:       claim.payerName,
        correctionNote:  claim.correctionNote || '',
        schoolName:      school.name || ''
      }).catch(function(e) {
        console.warn('[p5] sendClaimNeedsCorrection non-fatal:', e.message);
      });
    }
  } catch(e) {
    /* email service unavailable — non-fatal */
    console.warn('[p5] notifyClaimDecision load failed (non-fatal):', e.message);
  }
}

/* ============================================
   P6 — AUTHORITATIVE TRANSACTION + ALLOCATION ENGINE

   Called immediately after a claim is verified.
   Creates one SchoolFeePayment (authoritative) and
   one SchoolPaymentAllocation linking it to its purpose.

   MULTI-STUDENT SPLITS (future P9):
   The standard P6 flow is 1 claim → 1 allocation.
   P9 will extend the finance UI to allow a finance officer
   to split one payment across multiple student obligations.
   The allocation model already supports this — P6 just
   does not expose the split UI yet.

   ERROR HANDLING:
   Failures are logged and the function returns null.
   The claim remains 'verified' — finance staff can
   investigate and manually record the payment if needed.
   The claim is never reverted to 'awaiting_verification'
   by an engine failure.
============================================ */
async function triggerP6Processing(claim, verifiedById, verifiedByName, schoolId) {
  try {
    var SchoolFeePayment          = require('../models/SchoolFeePayment.model');
    var SchoolPaymentAllocation   = require('../models/SchoolPaymentAllocation.model');
    var SchoolFeeAssignment       = require('../models/SchoolFeeAssignment.model');
    var SchoolDonationCampaign    = require('../models/SchoolDonationCampaign.model');

    /* ---- 1. Generate atomic, concurrency-safe receipt number ---- */
    var receiptNumber = await generateReceiptNumberForClaim(schoolId);

    /* ---- 2. Resolve termId from assignment (if applicable) ---- */
    var termId = null;
    if (claim.assignmentId) {
      var asgn = await SchoolFeeAssignment.findOne({
        _id:      claim.assignmentId,
        schoolId: schoolId              /* TENANT SCOPE */
      }).select('termId').lean();
      if (asgn) termId = asgn.termId || null;
    }

    /* ---- 3. Create the authoritative payment record ----
       method: 'bank_transfer' — the payer made an external bank transfer.
       amount: full claim amount — no platform fee on manual transfers.
       Status is immediately 'confirmed' because the finance officer
       has already verified receipt of funds before calling this.     */
    var payment = await SchoolFeePayment.create({
      schoolId:         schoolId,
      studentId:        claim.studentId        || null,
      assignmentId:     claim.assignmentId     || null,
      feeStructureId:   claim.feeStructureId   || null,
      termId:           termId,
      amount:           claim.amount,
      currency:         claim.currency         || 'NGN',
      method:           'bank_transfer',
      externalRef:      claim.reference        || '',
      receiptNumber,
      note:             claim.note             || '',
      status:           'confirmed',
      /* P6 provenance: who paid and how */
      claimId:          claim._id,
      payerId:          claim.payerId          || null,
      payerType:        claim.payerType        || '',
      payerName:        claim.payerName        || '',
      paymentAccountId: claim.paymentAccountId || null,
      /* P6 verification trail */
      verifiedBy:       verifiedById,
      verifiedAt:       new Date(),
      recordedBy:       verifiedById,
      recordedAt:       new Date()
    });

    /* ---- 4. Create allocation record(s) ---- */
    var allocationBase = {
      schoolId:  schoolId,
      paymentId: payment._id,
      claimId:   claim._id,
      amount:    claim.amount,
      currency:  claim.currency || 'NGN',
      note:      ''
    };

    if (claim.assignmentId) {
      /* ---- Fee assignment allocation ---- */
      await SchoolPaymentAllocation.create(Object.assign({}, allocationBase, {
        assignmentId:   claim.assignmentId,
        studentId:      claim.studentId      || null,
        feeStructureId: claim.feeStructureId || null,
        campaignId:     null
      }));

      /* ---- 5a. Recalculate assignment balance ---- */
      await syncAssignmentBalanceLocal(claim.assignmentId);

    } else if (claim.campaignId) {
      /* ---- Campaign contribution allocation ---- */
      await SchoolPaymentAllocation.create(Object.assign({}, allocationBase, {
        assignmentId:   null,
        studentId:      claim.studentId || null,
        feeStructureId: null,
        campaignId:     claim.campaignId
      }));

      /* ---- 5b. Update campaign running totals (atomic $inc) ---- */
      await SchoolDonationCampaign.findOneAndUpdate(
        { _id: claim.campaignId, schoolId: schoolId }, /* TENANT SCOPE */
        { $inc: { totalCollected: claim.amount, donationCount: 1 } }
      );
    }

    /* ---- 6. Link payment back to claim (resultPaymentId) ---- */
    await SchoolPaymentClaim.findByIdAndUpdate(claim._id, {
      $set: { resultPaymentId: payment._id }
    });

    return payment;

  } catch(err) {
    /* Non-fatal: claim remains 'verified', payment creation failed.
       Finance staff can record the payment manually as a fallback.  */
    console.error('[P6] triggerP6Processing failed:', err.message);
    return null;
  }
}

/* ============================================
   POST /api/institution/finance/claims/:id/verify

   Finance officer confirms money was received.
   Sets claim to 'verified'.
   Calls triggerP6Processing() (stub in P5, real in P6).
   Sends payer notification.
   Writes audit log.

   Guard: seniorGuard — financial verification is
   restricted to senior staff and above.

   Allowed source statuses:
     awaiting_verification → verified
     needs_correction      → verified
     (a corrected claim can be verified directly
      without requiring the payer to resubmit)
============================================ */
router.post('/claims/:id/verify', seniorGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid claim ID.' });
    }

    var claim = await SchoolPaymentClaim.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId      /* TENANT SCOPE + IDOR */
    });

    if (!claim) {
      return res.status(404).json({ success: false, message: 'Claim not found.' });
    }
    if (!['awaiting_verification', 'needs_correction'].includes(claim.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only claims awaiting verification can be verified. ' +
                 'Current status: ' + claim.status
      });
    }
    if (claim.resultPaymentId) {
      return res.status(400).json({
        success: false,
        message: 'This claim has already been processed into a verified payment.'
      });
    }

    /* Optional verification note from the finance officer */
    var verificationNote = (req.body.note || '').trim().substring(0, 300);

    /* Update claim status */
    claim.status          = 'verified';
    claim.reviewedBy      = req.schoolUser._id;
    claim.reviewedByName  = req.schoolUser.name || '';
    claim.reviewedAt      = new Date();
    /* Store the note on correctionNote field (repurposed as review note)
       P6 will add a dedicated verificationNote field if needed */
    if (verificationNote) claim.correctionNote = verificationNote;

    await claim.save();

    /* ---- P6: trigger transaction + allocation engine ---- */
    /* Returns null in P5. P6 replaces the stub with full payment creation. */
    var paymentResult = await triggerP6Processing(
      claim,
      req.schoolUser._id,
      req.schoolUser.name || '',
      req.schoolId
    );

    /* ---- Audit log ---- */
    logAudit({
      req,
      action:     'institution.payment_claim.verified',
      resource:   'SchoolPaymentClaim',
      resourceId: claim._id.toString(),
      success:    true,
      message:    'Payment claim verified.' +
                  ' payer=' + claim.payerName +
                  ' amount=' + claim.currency + ' ' + claim.amount +
                  (claim.reference ? ' ref=' + claim.reference : '') +
                  (paymentResult ? ' paymentId=' + paymentResult._id : ' [P6 pending]') +
                  ' by=' + (req.schoolUser.name || req.schoolUser.email || 'unknown')
    });

    /* ---- Notify payer — fire-and-forget ---- */
    var schoolDocV = await School.findById(req.schoolId)
      .select('name email').lean();
    if (schoolDocV) notifyClaimDecision('verified', claim, schoolDocV);

    return res.json({
      success: true,
      message: 'Payment claim verified.' +
               (paymentResult
                 ? ' Transaction created (receipt: ' + paymentResult.receiptNumber + ').'
                 : ' Transaction will be created when the payment engine is active (P6).'),
      claim:         claim,
      paymentResult: paymentResult || null
    });

  } catch(err) {
    console.error('[finance] POST /claims/:id/verify:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /api/institution/finance/claims/:id/reject

   Finance officer cannot confirm receipt of money.
   Requires a rejection reason — payer may need
   to investigate or resubmit.

   Guard: seniorGuard

   Allowed source statuses:
     awaiting_verification → rejected
     needs_correction      → rejected
============================================ */
router.post('/claims/:id/reject', seniorGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid claim ID.' });
    }

    var rejectionReason = (req.body.reason || req.body.rejectionReason || '').trim();
    if (!rejectionReason) {
      return res.status(400).json({
        success: false,
        message: 'A rejection reason is required. The payer will see this message.'
      });
    }
    if (rejectionReason.length > 500) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason must be 500 characters or fewer.'
      });
    }

    var claim = await SchoolPaymentClaim.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId      /* TENANT SCOPE + IDOR */
    });

    if (!claim) {
      return res.status(404).json({ success: false, message: 'Claim not found.' });
    }
    if (!['awaiting_verification', 'needs_correction'].includes(claim.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only claims awaiting verification can be rejected. ' +
                 'Current status: ' + claim.status
      });
    }
    if (claim.resultPaymentId) {
      return res.status(400).json({
        success: false,
        message: 'This claim has already been processed. Use the reversal workflow instead.'
      });
    }

    claim.status          = 'rejected';
    claim.rejectionReason = rejectionReason;
    claim.reviewedBy      = req.schoolUser._id;
    claim.reviewedByName  = req.schoolUser.name || '';
    claim.reviewedAt      = new Date();
    await claim.save();

    logAudit({
      req,
      action:     'institution.payment_claim.rejected',
      resource:   'SchoolPaymentClaim',
      resourceId: claim._id.toString(),
      success:    true,
      message:    'Payment claim rejected.' +
                  ' payer=' + claim.payerName +
                  ' amount=' + claim.currency + ' ' + claim.amount +
                  ' reason="' + rejectionReason.substring(0, 100) + '"' +
                  ' by=' + (req.schoolUser.name || req.schoolUser.email || 'unknown')
    });

    /* Notify payer — fire-and-forget */
    var schoolDocR = await School.findById(req.schoolId)
      .select('name email').lean();
    if (schoolDocR) notifyClaimDecision('rejected', claim, schoolDocR);

    return res.json({
      success: true,
      message: 'Claim rejected. The payer has been notified.',
      claim
    });

  } catch(err) {
    console.error('[finance] POST /claims/:id/reject:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /api/institution/finance/claims/:id/request-correction

   Finance officer found a problem with the claim
   details (wrong amount, wrong reference, etc.)
   and needs the payer to correct and resubmit.

   Guard: staffGuard — lower privilege than verify/reject
   because this does not commit a financial decision.

   Allowed source statuses:
     awaiting_verification → needs_correction
   (cannot request correction on an already-correcting claim)
============================================ */
router.post('/claims/:id/request-correction', readGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid claim ID.' });
    }

    var correctionNote = (req.body.note || req.body.correctionNote || '').trim();
    if (!correctionNote) {
      return res.status(400).json({
        success: false,
        message: 'A correction note is required so the payer knows what to fix.'
      });
    }
    if (correctionNote.length > 500) {
      return res.status(400).json({
        success: false,
        message: 'Correction note must be 500 characters or fewer.'
      });
    }

    var claim = await SchoolPaymentClaim.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId      /* TENANT SCOPE + IDOR */
    });

    if (!claim) {
      return res.status(404).json({ success: false, message: 'Claim not found.' });
    }
    if (claim.status !== 'awaiting_verification') {
      return res.status(400).json({
        success: false,
        message: 'Only claims awaiting verification can be sent back for correction. ' +
                 'Current status: ' + claim.status
      });
    }

    claim.status         = 'needs_correction';
    claim.correctionNote = correctionNote;
    claim.reviewedBy     = req.schoolUser._id;
    claim.reviewedByName = req.schoolUser.name || '';
    claim.reviewedAt     = new Date();
    await claim.save();

    logAudit({
      req,
      action:     'institution.payment_claim.correction_requested',
      resource:   'SchoolPaymentClaim',
      resourceId: claim._id.toString(),
      success:    true,
      message:    'Correction requested on claim.' +
                  ' payer=' + claim.payerName +
                  ' note="' + correctionNote.substring(0, 100) + '"' +
                  ' by=' + (req.schoolUser.name || req.schoolUser.email || 'unknown')
    });

    /* Notify payer — fire-and-forget */
    var schoolDocC = await School.findById(req.schoolId)
      .select('name email').lean();
    if (schoolDocC) notifyClaimDecision('needs_correction', claim, schoolDocC);

    return res.json({
      success: true,
      message: 'Correction requested. The payer has been notified to update their claim.',
      claim
    });

  } catch(err) {
    console.error('[finance] POST /claims/:id/request-correction:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   P8 — RECEIPT ROUTES

   GET /api/institution/finance/claims/:id/receipt
   Rich PDF receipt for claim-verified payments.
   Includes payer context, campaign info,
   allocation breakdown — all the P6 provenance
   that the existing /transactions/:id/receipt
   does not include.

   GET /api/institution/finance/receipts/search
   Paginated receipt search across SchoolFeePayment
   records. Supports receiptNumber, payer name,
   date range, method, status filters.
   Reuses getTransactions() from finance.service.js.
============================================ */

/* GET /api/institution/finance/claims/:id/receipt */
router.get('/claims/:id/receipt', readGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid claim ID.' });
    }

    /* Step 1: Load and tenant-scope the claim */
    var claim = await SchoolPaymentClaim.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId          /* TENANT SCOPE + IDOR */
    }).lean();

    if (!claim) {
      return res.status(404).json({ success: false, message: 'Claim not found.' });
    }
    if (claim.status !== 'verified' || !claim.resultPaymentId) {
      return res.status(400).json({
        success:  false,
        message:  'Receipt is only available for verified claims with a confirmed payment.'
      });
    }

    /* Step 2: Load the authoritative payment with full P6 provenance */
    var SchoolFeePaymentModel = require('../models/SchoolFeePayment.model');
    var payment = await SchoolFeePaymentModel.findOne({
      _id:      claim.resultPaymentId,
      schoolId: req.schoolId          /* TENANT SCOPE */
    })
    .populate('verifiedBy',       'name')
    .populate('paymentAccountId', 'accountLabel bankName accountName currency')
    .lean();

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment record not found.' });
    }

    /* Step 3: Load allocations for this payment */
    var SchoolPaymentAllocation = require('../models/SchoolPaymentAllocation.model');
    var allocations = await SchoolPaymentAllocation.find({
      paymentId: payment._id,
      schoolId:  req.schoolId         /* TENANT SCOPE */
    })
    .populate('studentId',      'name admissionNo class')
    .populate('feeStructureId', 'name category')
    .populate('campaignId',     'title category')
    .lean();

    /* Step 4: Load school branding */
    var school = await School.findById(req.schoolId)
      .select('name logo address phone email primaryColor').lean();

    /* Step 5: Generate PDF */
    var pdfBuffer;
    try {
      pdfBuffer = await generateClaimReceiptPDF(payment, allocations, school);
    } catch(pdfErr) {
      if (pdfErr.message && pdfErr.message.includes('pdfkit')) {
        return res.status(503).json({
          success: false,
          message: 'PDF service unavailable. Run: npm install pdfkit'
        });
      }
      throw pdfErr;
    }

    /* Step 6: Serve as downloadable PDF */
    var filename = 'Receipt_' + (payment.receiptNumber || payment._id) +
                   '_' + (payment.payerName || 'payer').replace(/[^a-zA-Z0-9]/g, '_') +
                   '.pdf';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.end(pdfBuffer);

  } catch(err) {
    console.error('[finance] GET /claims/:id/receipt:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/institution/finance/receipts/search
   Dedicated receipt search.
   Reuses financeService.getTransactions() with targeted filters.
   Supports: receiptNumber (partial match), payerName,
             dateFrom, dateTo, method, status.
   All results include their receiptNumber for download.
   TENANT SCOPED through financeService.
*/
router.get('/receipts/search', readGuard, async function(req, res) {
  try {
    var filters = {
      status:      req.query.status      || 'confirmed',
      method:      req.query.method      || '',
      studentName: req.query.payerName   || '',  /* reuse studentName filter as payer search */
      from:        req.query.from        || '',
      to:          req.query.to          || '',
      ref:         req.query.receiptNumber || req.query.ref || ''
    };

    /* Strip empties */
    Object.keys(filters).forEach(function(k) {
      if (!filters[k]) delete filters[k];
    });

    var result = await financeService.getTransactions(
      req.schoolId,
      filters,
      req.query.page  || 1,
      req.query.limit || 20
    );

    /* Add a pendingCount=0 so the badge logic doesn't break */
    return res.json({
      success:  true,
      receipts: result.transactions || [],
      total:    result.total        || 0,
      page:     result.page         || 1,
      pages:    result.pages        || 1
    });
  } catch(err) {
    console.error('[finance] GET /receipts/search:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;