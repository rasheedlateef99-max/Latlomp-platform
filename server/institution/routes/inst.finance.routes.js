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
const financePdf      = require('../services/finance.pdf.service');
const {
  instProtect, schoolAdminOnly,
  seniorStaffOrAdmin, canManageStudents, teacherOrAdmin
} = require('../middleware/inst.auth');
const { requireActiveSubscription } = require('../middleware/inst.tenant');

var adminGuard  = [instProtect, schoolAdminOnly,    requireActiveSubscription];
var seniorGuard = [instProtect, seniorStaffOrAdmin, requireActiveSubscription];
var manageGuard = [instProtect, canManageStudents,  requireActiveSubscription];
var readGuard   = [instProtect, teacherOrAdmin,     requireActiveSubscription];

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
        .populate('feeStructureId',  'name category')
        .populate('campaignId',      'title category')
        .populate('studentId',       'name admissionNo class passportPhotoUrl')
        .populate('assignmentId',    'amountDue amountPaid balance status')
        .populate('paymentAccountId','accountLabel bankName currency')
        .populate('submittedBy',     'name email')
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

module.exports = router;