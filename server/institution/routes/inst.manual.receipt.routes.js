'use strict';
/* ============================================
   LATLOMP — MANUAL RECEIPT ROUTES

   Allows authorised school staff to issue
   professional receipts for payments received
   outside the LatLomp Finance workflow.

   ARCHITECTURE:
   - Does NOT create SchoolFeePayment records
   - Does NOT trigger fee allocation or progress
   - schoolId ALWAYS from req.schoolId (JWT)
   - Receipt numbers from SchoolCounter 'mrpt:<schoolId>'
   - PDF via generateManualReceiptPDF()

   All routes: instProtect + requireActiveSubscription
   Void route: additionally requires senior role
============================================ */
const express              = require('express');
const router               = express.Router();
const mongoose             = require('mongoose');
const SchoolManualReceipt  = require('../models/SchoolManualReceipt.model');
const SchoolCounter        = require('../models/SchoolCounter.model');
const School               = require('../models/School.model');
const {
  instProtect,
  getEffectiveRoles
}                          = require('../middleware/inst.auth');
const { requireActiveSubscription } = require('../middleware/inst.tenant');

var guard = [instProtect, requireActiveSubscription];

/* Roles that can void a receipt */
var VOID_ROLES = ['school_admin', 'principal', 'vice_principal', 'bursar'];

function canVoid(schoolUser) {
  var roles = getEffectiveRoles(schoolUser);
  return roles.some(function(r) { return VOID_ROLES.includes(r); });
}

/* ── Receipt number generator ── */
async function nextReceiptNumber(schoolId) {
  var counter = await SchoolCounter.findOneAndUpdate(
    { _id: 'mrpt:' + schoolId.toString() },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  var seq   = String(counter.seq).padStart(4, '0');
  var today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return 'MR-' + today + '-' + seq;
}

/* ============================================
   POST /api/institution/manual-receipts
   Create a manual receipt and generate receipt number.
============================================ */
router.post('/', guard, async function(req, res) {
  try {
    var body = req.body || {};
    var {
      payerName, payerPhone, payerEmail,
      studentName, studentClass, admissionNo,
      description, amount, currency,
      paymentMethod, paymentDate, reference,
      notes, issuedByName
    } = body;

    /* ── Required field validation ── */
    if (!payerName || !payerName.trim()) {
      return res.status(400).json({ success: false, message: 'Payer name is required.' });
    }
    if (!description || !description.trim()) {
      return res.status(400).json({ success: false, message: 'Payment description is required.' });
    }
    var parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: false, message: 'A valid amount greater than zero is required.' });
    }
    if (!currency || !currency.trim()) {
      return res.status(400).json({ success: false, message: 'Currency is required.' });
    }
    if (!paymentDate) {
      return res.status(400).json({ success: false, message: 'Payment date is required.' });
    }

    var VALID_METHODS = ['cash','bank_transfer','cheque','pos','mobile_money','ussd','other'];
    var method        = VALID_METHODS.includes(paymentMethod) ? paymentMethod : 'cash';

    /* ── Generate receipt number (atomic, school-scoped) ── */
    var receiptNumber = await nextReceiptNumber(req.schoolId);

    /* ── Create receipt ── */
    var receipt = await SchoolManualReceipt.create({
      schoolId:      req.schoolId,           /* from JWT — never from body */
      receiptNumber,
      status:        'issued',
      payerName:     payerName.trim(),
      payerPhone:    (payerPhone    || '').trim(),
      payerEmail:    (payerEmail    || '').trim().toLowerCase(),
      studentName:   (studentName   || '').trim(),
      studentClass:  (studentClass  || '').trim(),
      admissionNo:   (admissionNo   || '').trim(),
      description:   description.trim(),
      amount:        parsedAmount,
      currency:      currency.trim().toUpperCase(),
      paymentMethod: method,
      paymentDate:   new Date(paymentDate),
      reference:     (reference     || '').trim(),
      notes:         (notes         || '').trim().substring(0, 500),
      issuedBy:      req.schoolUser._id,     /* authenticated staff member */
      issuedByName:  (issuedByName  || req.schoolUser.name || '').trim(),
      issuedAt:      new Date()
    });

    return res.status(201).json({
      success:       true,
      message:       'Receipt ' + receiptNumber + ' issued successfully.',
      receiptNumber,
      receiptId:     receipt._id
    });

  } catch(err) {
    console.error('[ManualReceipt] POST /:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/manual-receipts
   List receipts for this school (paginated).
   Query: ?page=1&limit=25&status=issued&search=
============================================ */
router.get('/', guard, async function(req, res) {
  try {
    var page   = Math.max(1, parseInt(req.query.page)  || 1);
    var limit  = Math.min(50, parseInt(req.query.limit) || 25);
    var skip   = (page - 1) * limit;
    var filter = { schoolId: req.schoolId };

    if (req.query.status && ['issued','voided'].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    if (req.query.search && req.query.search.trim()) {
      var q = req.query.search.trim();
      filter.$or = [
        { payerName:    { $regex: q, $options: 'i' } },
        { studentName:  { $regex: q, $options: 'i' } },
        { receiptNumber:{ $regex: q, $options: 'i' } },
        { description:  { $regex: q, $options: 'i' } }
      ];
    }

    var [receipts, total] = await Promise.all([
      SchoolManualReceipt.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      SchoolManualReceipt.countDocuments(filter)
    ]);

    return res.json({
      success: true,
      receipts,
      total,
      page,
      pages: Math.ceil(total / limit)
    });

  } catch(err) {
    console.error('[ManualReceipt] GET /:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/manual-receipts/:id
   Get single receipt.
============================================ */
router.get('/:id', guard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid receipt ID.' });
    }
    var receipt = await SchoolManualReceipt.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId           /* tenant isolation */
    }).lean();

    if (!receipt) {
      return res.status(404).json({ success: false, message: 'Receipt not found.' });
    }
    return res.json({ success: true, receipt });

  } catch(err) {
    console.error('[ManualReceipt] GET /:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/manual-receipts/:id/pdf
   Generate and stream the receipt PDF.
============================================ */
router.get('/:id/pdf', guard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid receipt ID.' });
    }

    var receipt = await SchoolManualReceipt.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId           /* tenant isolation */
    }).lean();

    if (!receipt) {
      return res.status(404).json({ success: false, message: 'Receipt not found.' });
    }
    if (receipt.status === 'voided') {
      return res.status(400).json({
        success: false,
        message: 'This receipt has been voided and cannot be downloaded.'
      });
    }

    var school = await School.findById(req.schoolId)
      .select('name logo primaryColor address phone receiptName receiptColor receiptLogoBase64').lean();

    var { generateManualReceiptPDF } = require('../services/finance.pdf.service');
    var pdfBuffer = await generateManualReceiptPDF(receipt, school);

    var filename = 'Receipt-' + receipt.receiptNumber + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.end(pdfBuffer);

  } catch(err) {
    console.error('[ManualReceipt] GET /:id/pdf:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /api/institution/manual-receipts/:id/void
   Void a receipt (senior staff only).
   Body: { reason }
============================================ */
router.put('/:id/void', guard, async function(req, res) {
  try {
    /* Role check: only bursar/admin/principal can void */
    if (!canVoid(req.schoolUser)) {
      return res.status(403).json({
        success: false,
        message: 'Only a Bursar, Principal, Vice Principal, or School Admin can void a receipt.'
      });
    }

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid receipt ID.' });
    }

    var reason = (req.body && req.body.reason || '').trim();
    if (!reason) {
      return res.status(400).json({ success: false, message: 'A reason for voiding is required.' });
    }

    var receipt = await SchoolManualReceipt.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId           /* tenant isolation */
    });

    if (!receipt) {
      return res.status(404).json({ success: false, message: 'Receipt not found.' });
    }
    if (receipt.status === 'voided') {
      return res.status(400).json({ success: false, message: 'This receipt is already voided.' });
    }

    receipt.status       = 'voided';
    receipt.voidedAt     = new Date();
    receipt.voidedBy     = req.schoolUser._id;
    receipt.voidedByName = req.schoolUser.name || '';
    receipt.voidReason   = reason;
    await receipt.save();

    return res.json({
      success: true,
      message: 'Receipt ' + receipt.receiptNumber + ' has been voided.'
    });

  } catch(err) {
    console.error('[ManualReceipt] PUT /:id/void:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;