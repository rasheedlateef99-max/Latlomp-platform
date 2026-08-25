'use strict';
const express             = require('express');
const router              = express.Router();
const mongoose            = require('mongoose');
const SchoolFeeStructure  = require('../models/SchoolFeeStructure.model');
const SchoolFeeAssignment = require('../models/SchoolFeeAssignment.model');
const SchoolFeePayment    = require('../models/SchoolFeePayment.model');
const SchoolStudent       = require('../models/SchoolStudent.model');
const SchoolClass         = require('../models/Class.model');
const AcademicTerm        = require('../models/AcademicTerm.model');
const School              = require('../models/School.model');
const {
  instProtect,
  schoolAdminOnly,
  teacherOrAdmin,
  canManageStudents
} = require('../middleware/inst.auth');
const { requireActiveSubscription } = require('../middleware/inst.tenant');

var adminGuard = [instProtect, schoolAdminOnly, requireActiveSubscription];
var staffGuard = [instProtect, teacherOrAdmin,  requireActiveSubscription];

/* ============================================
   RECEIPT NUMBER GENERATOR
   Format: SCH-YYYYMMDD-NNNN
============================================ */
async function generateReceiptNumber(schoolId) {
  var today = new Date();
  var date  = today.getFullYear().toString() +
              String(today.getMonth() + 1).padStart(2, '0') +
              String(today.getDate()).padStart(2, '0');
  var count = await SchoolFeePayment.countDocuments({ schoolId: schoolId });
  return 'RCP-' + date + '-' + String(count + 1).padStart(4, '0');
}

/* ============================================
   HELPER: recalculate assignment balance
   Called after every payment record.
============================================ */
async function syncAssignmentBalance(assignmentId) {
  var assignment = await SchoolFeeAssignment.findById(assignmentId);
  if (!assignment) { return; }

  var payments = await SchoolFeePayment.find({
    assignmentId: assignmentId,
    status:       'confirmed'
  });
  var totalPaid = payments.reduce(function (sum, p) { return sum + p.amount; }, 0);
  var netDue    = assignment.amountDue - (assignment.discount || 0);
  var balance   = Math.max(0, netDue - totalPaid);

  var newStatus = assignment.status;
  if (totalPaid <= 0)           { newStatus = 'pending'; }
  else if (balance > 0)         { newStatus = 'partial'; }
  else                          { newStatus = 'paid'; }

  assignment.amountPaid = totalPaid;
  assignment.balance    = balance;
  assignment.status     = newStatus;
  if (newStatus === 'paid' && !assignment.paidAt) {
    assignment.paidAt = new Date();
  }
  await assignment.save();
}

/* ============================================
   R1 — FEE STRUCTURES
   Admin creates fee types (School Fees, etc.)
============================================ */

/* GET /api/institution/fee/structures */
router.get('/structures', staffGuard, async (req, res) => {
  try {
    var { termId, active } = req.query;
    var filter = { schoolId: req.schoolId };
    if (termId) filter.termId = termId;
    if (active !== undefined) filter.isActive = active !== 'false';

    var structures = await SchoolFeeStructure.find(filter)
      .populate('termId',   'name session term')
      .populate('classIds', 'name category')
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, count: structures.length, structures });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/institution/fee/structures */
router.post('/structures', adminGuard, async (req, res) => {
  try {
    var { name, description, category, amount, termId, classIds, dueDate } = req.body;

    if (!name)   { return res.status(400).json({ success: false, message: 'Fee name is required.' }); }
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'A valid amount is required.' });
    }

    var structure = await SchoolFeeStructure.create({
      schoolId:    req.schoolId,
      name:        name.trim(),
      description: (description || '').trim(),
      category:    category || 'tuition',
      amount:      parseFloat(amount),
      termId:      termId   || null,
      classIds:    Array.isArray(classIds) ? classIds : [],
      dueDate:     dueDate  || null
    });

    return res.status(201).json({
      success:   true,
      message:   'Fee structure "' + structure.name + '" created.',
      structure
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/fee/structures/:id */
router.put('/structures/:id', adminGuard, async (req, res) => {
  try {
    var allowed = ['name', 'description', 'category', 'amount', 'termId', 'classIds', 'dueDate', 'isActive'];
    var updates = {};
    allowed.forEach(function (f) {
      if (req.body[f] !== undefined) { updates[f] = req.body[f]; }
    });

    var structure = await SchoolFeeStructure.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: updates },
      { new: true }
    );
    if (!structure) {
      return res.status(404).json({ success: false, message: 'Fee structure not found.' });
    }
    return res.status(200).json({ success: true, message: 'Fee structure updated.', structure });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* DELETE /api/institution/fee/structures/:id */
router.delete('/structures/:id', adminGuard, async (req, res) => {
  try {
    /* Block deletion if assignments exist */
    var assignmentCount = await SchoolFeeAssignment.countDocuments({
      feeStructureId: req.params.id,
      schoolId:       req.schoolId
    });
    if (assignmentCount > 0) {
      return res.status(400).json({
        success: false,
        message: assignmentCount + ' student(s) are assigned to this fee. ' +
                 'Delete assignments first or mark the fee as inactive.'
      });
    }

    var structure = await SchoolFeeStructure.findOneAndDelete({
      _id: req.params.id, schoolId: req.schoolId
    });
    if (!structure) {
      return res.status(404).json({ success: false, message: 'Fee structure not found.' });
    }
    return res.status(200).json({ success: true, message: '"' + structure.name + '" deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   R2 — FEE ASSIGNMENTS
   Assign fees to students (bulk by class or individual)
============================================ */

/* GET /api/institution/fee/assignments */
router.get('/assignments', staffGuard, async (req, res) => {
  try {
    var { studentId, classId, termId, status, page = 1, limit = 50 } = req.query;
    var filter = { schoolId: req.schoolId };
    if (studentId) filter.studentId      = studentId;
    if (classId)   filter.classId        = classId;
    if (termId)    filter.termId         = termId;
    if (status)    filter.status         = status;

    var skip  = (parseInt(page) - 1) * parseInt(limit);
    var total = await SchoolFeeAssignment.countDocuments(filter);

    var assignments = await SchoolFeeAssignment.find(filter)
      .populate('studentId',      'name admissionNo class arm')
      .populate('feeStructureId', 'name category amount')
      .populate('termId',         'name session term')
      .populate('classId',        'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    return res.status(200).json({ success: true, total, page: parseInt(page), assignments });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/institution/fee/assignments/bulk
   Assign a fee structure to all students in a class
   Body: { feeStructureId, classId, termId?, discount? }
*/
router.post('/assignments/bulk', adminGuard, async (req, res) => {
  try {
    var { feeStructureId, classId, termId, discount, dueDate } = req.body;

    if (!feeStructureId) {
      return res.status(400).json({ success: false, message: 'Fee structure is required.' });
    }
    if (!classId) {
      return res.status(400).json({ success: false, message: 'Class is required for bulk assignment.' });
    }

    var structure = await SchoolFeeStructure.findOne({
      _id: feeStructureId, schoolId: req.schoolId
    });
    if (!structure) {
      return res.status(404).json({ success: false, message: 'Fee structure not found.' });
    }

    /* Load all active students in this class */
    var students = await SchoolStudent.find({
      schoolId: req.schoolId,
      classId:  classId,
      isActive: true
    }).select('_id');

    if (!students.length) {
      return res.status(400).json({
        success: false,
        message: 'No active students found in this class.'
      });
    }

    var discountAmount = parseFloat(discount) || 0;
    var amountDue      = structure.amount;
    var netAmount      = Math.max(0, amountDue - discountAmount);

    /* Bulk insert — skip duplicates */
    var created  = 0;
    var skipped  = 0;
    var errors   = 0;

    for (var i = 0; i < students.length; i++) {
      var sid = students[i]._id;
      try {
        var existing = await SchoolFeeAssignment.findOne({
          schoolId:       req.schoolId,
          studentId:      sid,
          feeStructureId: feeStructureId
        });
        if (existing) { skipped++; continue; }

        await SchoolFeeAssignment.create({
          schoolId:       req.schoolId,
          studentId:      sid,
          feeStructureId: feeStructureId,
          termId:         termId   || structure.termId || null,
          classId:        classId,
          amountDue:      amountDue,
          discount:       discountAmount,
          balance:        netAmount,
          dueDate:        dueDate  || structure.dueDate || null,
          assignedBy:     req.schoolUser._id
        });
        created++;
      } catch (e) {
        errors++;
      }
    }

    return res.status(201).json({
      success: true,
      message: created + ' assignment(s) created. ' + skipped + ' skipped (already assigned). ' +
               (errors > 0 ? errors + ' error(s).' : ''),
      created, skipped, errors,
      total: students.length
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/institution/fee/assignments
   Assign fee to a single student
*/
router.post('/assignments', adminGuard, async (req, res) => {
  try {
    var { feeStructureId, studentId, termId, discount, dueDate } = req.body;

    if (!feeStructureId || !studentId) {
      return res.status(400).json({
        success: false,
        message: 'Fee structure and student are required.'
      });
    }

    var structure = await SchoolFeeStructure.findOne({
      _id: feeStructureId, schoolId: req.schoolId
    });
    if (!structure) {
      return res.status(404).json({ success: false, message: 'Fee structure not found.' });
    }

    var student = await SchoolStudent.findOne({
      _id: studentId, schoolId: req.schoolId
    });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    /* Prevent duplicate */
    var existing = await SchoolFeeAssignment.findOne({
      schoolId: req.schoolId, studentId, feeStructureId
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: student.name + ' is already assigned to "' + structure.name + '".'
      });
    }

    var discountAmount = parseFloat(discount) || 0;
    var amountDue      = structure.amount;
    var netAmount      = Math.max(0, amountDue - discountAmount);

    var assignment = await SchoolFeeAssignment.create({
      schoolId:       req.schoolId,
      studentId,
      feeStructureId,
      termId:         termId   || structure.termId || null,
      classId:        student.classId || null,
      amountDue,
      discount:       discountAmount,
      balance:        netAmount,
      dueDate:        dueDate  || structure.dueDate || null,
      assignedBy:     req.schoolUser._id
    });

    return res.status(201).json({
      success:    true,
      message:    '"' + structure.name + '" assigned to ' + student.name + '.',
      assignment
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/fee/assignments/:id/waive */
router.put('/assignments/:id/waive', adminGuard, async (req, res) => {
  try {
    var { reason } = req.body;
    var assignment = await SchoolFeeAssignment.findOne({
      _id: req.params.id, schoolId: req.schoolId
    });
    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Assignment not found.' });
    }

    assignment.status       = 'waived';
    assignment.waivedBy     = req.schoolUser._id;
    assignment.waivedReason = reason || 'Waived by admin';
    await assignment.save();

    return res.status(200).json({ success: true, message: 'Fee waived.', assignment });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* DELETE /api/institution/fee/assignments/:id */
router.delete('/assignments/:id', adminGuard, async (req, res) => {
  try {
    var paymentCount = await SchoolFeePayment.countDocuments({
      assignmentId: req.params.id, status: 'confirmed'
    });
    if (paymentCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete: ' + paymentCount + ' payment(s) exist for this assignment.'
      });
    }

    await SchoolFeeAssignment.findOneAndDelete({
      _id: req.params.id, schoolId: req.schoolId
    });
    return res.status(200).json({ success: true, message: 'Assignment deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   R3 — MANUAL PAYMENT RECORDING
   Cash, bank transfer, cheque
============================================ */

/* GET /api/institution/fee/payments */
router.get('/payments', staffGuard, async (req, res) => {
  try {
    var { studentId, termId, method, status, page = 1, limit = 50 } = req.query;
    var filter = { schoolId: req.schoolId };
    if (studentId) filter.studentId = studentId;
    if (termId)    filter.termId    = termId;
    if (method)    filter.method    = method;
    if (status)    filter.status    = status;

    var skip  = (parseInt(page) - 1) * parseInt(limit);
    var total = await SchoolFeePayment.countDocuments(filter);

    var payments = await SchoolFeePayment.find(filter)
      .populate('studentId',      'name admissionNo class arm')
      .populate('feeStructureId', 'name category')
      .populate('termId',         'name session')
      .populate('recordedBy',     'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    return res.status(200).json({ success: true, total, page: parseInt(page), payments });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/institution/fee/payments
   Record a manual payment (cash / bank_transfer / cheque)
*/
router.post('/payments', staffGuard, async (req, res) => {
  try {
    var { assignmentId, amount, method, externalRef, note } = req.body;

    if (!assignmentId || !amount) {
      return res.status(400).json({ success: false, message: 'Assignment and amount are required.' });
    }
    if (parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than zero.' });
    }

    var assignment = await SchoolFeeAssignment.findOne({
      _id: assignmentId, schoolId: req.schoolId
    }).populate('feeStructureId');

    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Assignment not found.' });
    }
    if (['paid', 'waived', 'cancelled'].includes(assignment.status)) {
      return res.status(400).json({
        success: false,
        message: 'This fee is already ' + assignment.status + '.'
      });
    }

    var receiptNumber = await generateReceiptNumber(req.schoolId);

    var payment = await SchoolFeePayment.create({
      schoolId:       req.schoolId,
      studentId:      assignment.studentId,
      assignmentId:   assignment._id,
      feeStructureId: assignment.feeStructureId._id || assignment.feeStructureId,
      termId:         assignment.termId,
      amount:         parseFloat(amount),
      method:         method || 'cash',
      externalRef:    (externalRef || '').trim(),
      receiptNumber,
      note:           (note || '').trim(),
      status:         'confirmed',
      recordedBy:     req.schoolUser._id,
      recordedAt:     new Date()
    });

    /* Recalculate balance on the assignment */
    await syncAssignmentBalance(assignment._id);
    var updatedAssignment = await SchoolFeeAssignment.findById(assignment._id);

    return res.status(201).json({
      success:         true,
      message:         'Payment of ₦' + parseFloat(amount).toLocaleString() + ' recorded.',
      payment,
      receiptNumber,
      assignmentStatus: updatedAssignment.status,
      balance:          updatedAssignment.balance
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/fee/payments/:id/reverse
   Reverse a confirmed payment (admin only)
*/
router.put('/payments/:id/reverse', adminGuard, async (req, res) => {
  try {
    var { reason } = req.body;
    var payment = await SchoolFeePayment.findOne({
      _id: req.params.id, schoolId: req.schoolId
    });
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found.' });
    }
    if (payment.status === 'reversed') {
      return res.status(400).json({ success: false, message: 'Payment already reversed.' });
    }

    payment.status = 'reversed';
    payment.note   = (payment.note ? payment.note + ' | ' : '') + 'Reversed: ' + (reason || 'Admin action');
    await payment.save();

    await syncAssignmentBalance(payment.assignmentId);

    return res.status(200).json({ success: true, message: 'Payment reversed.', payment });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   R4 — PAYSTACK ONLINE PAYMENT
   School uses their own Paystack keys.
   Keys stored per-school in FeeConfig (simple
   approach — no new model, stored in query param
   validated against School settings).
============================================ */

/* GET /api/institution/fee/paystack-config
   Returns school's Paystack public key (safe to expose).
   School must configure PAYSTACK_PUBLIC_KEY in their settings.
*/
router.get('/paystack-config', staffGuard, async (req, res) => {
  try {
    var school = await School.findById(req.schoolId)
      .select('name email').lean();

    /* School Paystack keys stored as env or in future as school.paystackPublicKey
       For Phase R: support school-level Paystack via env prefix SCHOOL_{ID}_PAYSTACK
       or fall back to platform key with metadata routing. */
    var publicKey = process.env['SCHOOL_' + req.schoolId + '_PAYSTACK_PUBLIC_KEY']
                 || process.env.PAYSTACK_PUBLIC_KEY
                 || '';

    if (!publicKey) {
      return res.status(200).json({
        success:       true,
        configured:    false,
        message:       'Paystack not configured for this school. Contact LatLomp support.',
        publicKey:     ''
      });
    }

    return res.status(200).json({
      success:     true,
      configured:  true,
      publicKey,
      schoolEmail: school.email,
      schoolName:  school.name
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/institution/fee/payments/verify-paystack
   After Paystack inline payment completes on frontend,
   verify with Paystack and record the payment.
   Body: { assignmentId, paystackRef, amount }
*/
router.post('/payments/verify-paystack', staffGuard, async (req, res) => {
  try {
    var { assignmentId, paystackRef, amount } = req.body;

    if (!assignmentId || !paystackRef) {
      return res.status(400).json({ success: false, message: 'Assignment and Paystack reference are required.' });
    }

    /* Prevent duplicate Paystack reference */
    var duplicate = await SchoolFeePayment.findOne({ paystackRef });
    if (duplicate) {
      return res.status(400).json({ success: false, message: 'This Paystack transaction has already been recorded.' });
    }

    /* Verify with Paystack */
    var secretKey = process.env['SCHOOL_' + req.schoolId + '_PAYSTACK_SECRET_KEY']
                 || process.env.PAYSTACK_SECRET_KEY;

    if (!secretKey) {
      return res.status(400).json({ success: false, message: 'Paystack not configured for this school.' });
    }

    var verifyRes = await fetch(
      'https://api.paystack.co/transaction/verify/' + encodeURIComponent(paystackRef),
      { headers: { 'Authorization': 'Bearer ' + secretKey } }
    );
    var verifyData = await verifyRes.json();

    if (!verifyData.status || verifyData.data.status !== 'success') {
      return res.status(400).json({
        success: false,
        message: 'Payment not confirmed by Paystack. Status: ' +
                 (verifyData.data && verifyData.data.status || 'unknown')
      });
    }

    var verifiedAmount = verifyData.data.amount / 100; /* kobo → naira */

    var assignment = await SchoolFeeAssignment.findOne({
      _id: assignmentId, schoolId: req.schoolId
    });
    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Assignment not found.' });
    }

    var receiptNumber = await generateReceiptNumber(req.schoolId);

    var payment = await SchoolFeePayment.create({
      schoolId:       req.schoolId,
      studentId:      assignment.studentId,
      assignmentId:   assignment._id,
      feeStructureId: assignment.feeStructureId,
      termId:         assignment.termId,
      amount:         verifiedAmount,
      method:         'paystack',
      paystackRef,
      externalRef:    paystackRef,
      receiptNumber,
      status:         'confirmed',
      recordedBy:     req.schoolUser._id,
      recordedAt:     new Date()
    });

    await syncAssignmentBalance(assignment._id);
    var updatedAssignment = await SchoolFeeAssignment.findById(assignment._id);

    return res.status(201).json({
      success:          true,
      message:          '₦' + verifiedAmount.toLocaleString() + ' payment verified and recorded.',
      payment,
      receiptNumber,
      assignmentStatus: updatedAssignment.status,
      balance:          updatedAssignment.balance
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   R5 — RECEIPT
   GET /api/institution/fee/payments/:id/receipt
============================================ */
router.get('/payments/:id/receipt', staffGuard, async (req, res) => {
  try {
    var payment = await SchoolFeePayment.findOne({
      _id: req.params.id, schoolId: req.schoolId
    })
    .populate('studentId',      'name admissionNo class arm studentId')
    .populate('feeStructureId', 'name category amount')
    .populate('termId',         'name session term')
    .populate('recordedBy',     'name email')
    .lean();

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found.' });
    }

    var school = await School.findById(req.schoolId)
      .select('name logo address phone email primaryColor').lean();

    var assignment = await SchoolFeeAssignment.findById(payment.assignmentId)
      .select('amountDue balance discount status').lean();

    return res.status(200).json({
      success: true,
      receipt: {
        receiptNumber: payment.receiptNumber,
        payment,
        school,
        assignment,
        issuedAt:      payment.recordedAt || payment.createdAt
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   R6 — OUTSTANDING BALANCES
   GET /api/institution/fee/outstanding
============================================ */
router.get('/outstanding', staffGuard, async (req, res) => {
  try {
    var { classId, termId, page = 1, limit = 50 } = req.query;
    var filter = {
      schoolId: req.schoolId,
      status:   { $in: ['pending', 'partial'] }
    };
    if (classId) filter.classId = classId;
    if (termId)  filter.termId  = termId;

    var skip  = (parseInt(page) - 1) * parseInt(limit);
    var total = await SchoolFeeAssignment.countDocuments(filter);

    var outstanding = await SchoolFeeAssignment.find(filter)
      .populate('studentId',      'name admissionNo class arm')
      .populate('feeStructureId', 'name category')
      .populate('termId',         'name session')
      .populate('classId',        'name')
      .sort({ balance: -1, dueDate: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    /* Aggregate totals */
    var aggFilter = { schoolId: req.schoolId, status: { $in: ['pending', 'partial'] } };
    if (classId) aggFilter.classId = new mongoose.Types.ObjectId(classId);
    if (termId)  aggFilter.termId  = new mongoose.Types.ObjectId(termId);

    var totals = await SchoolFeeAssignment.aggregate([
      { $match: aggFilter },
      { $group: {
          _id:          null,
          totalBalance: { $sum: '$balance' },
          totalDue:     { $sum: '$amountDue' },
          count:        { $sum: 1 }
      }}
    ]);

    var summary = totals[0] || { totalBalance: 0, totalDue: 0, count: 0 };

    return res.status(200).json({
      success:    true,
      total,
      page:       parseInt(page),
      outstanding,
      summary: {
        totalOutstanding: summary.totalBalance,
        totalCharged:     summary.totalDue,
        studentsOwing:    summary.count
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   R7 — STUDENT FEE HISTORY
   GET /api/institution/fee/students/:studentId/history
============================================ */
router.get('/students/:studentId/history', staffGuard, async (req, res) => {
  try {
    var student = await SchoolStudent.findOne({
      _id: req.params.studentId, schoolId: req.schoolId
    }).select('name admissionNo class arm studentId');

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    var assignments = await SchoolFeeAssignment.find({
      schoolId:  req.schoolId,
      studentId: req.params.studentId
    })
    .populate('feeStructureId', 'name category amount')
    .populate('termId',         'name session')
    .sort({ createdAt: -1 });

    var payments = await SchoolFeePayment.find({
      schoolId:  req.schoolId,
      studentId: req.params.studentId,
      status:    'confirmed'
    })
    .populate('feeStructureId', 'name')
    .populate('termId',         'name session')
    .sort({ createdAt: -1 });

    /* Compute summary */
    var totalCharged   = assignments.reduce(function (s, a) { return s + a.amountDue; }, 0);
    var totalPaid      = payments.reduce(function (s, p)    { return s + p.amount; }, 0);
    var totalOutstanding = assignments
      .filter(function (a) { return ['pending','partial'].includes(a.status); })
      .reduce(function (s, a) { return s + a.balance; }, 0);

    return res.status(200).json({
      success: true,
      student,
      summary: { totalCharged, totalPaid, totalOutstanding },
      assignments,
      payments
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   R8 — FEE REPORTS
   GET /api/institution/fee/reports/summary
============================================ */
router.get('/reports/summary', staffGuard, async (req, res) => {
  try {
    var { termId, classId } = req.query;
    var matchFilter = { schoolId: new mongoose.Types.ObjectId(req.schoolId) };
    if (termId)  matchFilter.termId  = new mongoose.Types.ObjectId(termId);
    if (classId) matchFilter.classId = new mongoose.Types.ObjectId(classId);

    /* Collection summary */
    var [assignmentAgg, paymentAgg, byMethod, byStatus, byClass] = await Promise.all([
      /* Total charged and outstanding */
      SchoolFeeAssignment.aggregate([
        { $match: matchFilter },
        { $group: {
            _id:          null,
            totalCharged: { $sum: '$amountDue' },
            totalPaid:    { $sum: '$amountPaid' },
            totalBalance: { $sum: '$balance' },
            count:        { $sum: 1 }
        }}
      ]),

      /* Total confirmed payments */
      SchoolFeePayment.aggregate([
        { $match: Object.assign({}, matchFilter, { status: 'confirmed' }) },
        { $group: {
            _id:         null,
            totalAmount: { $sum: '$amount' },
            count:       { $sum: 1 }
        }}
      ]),

      /* Breakdown by payment method */
      SchoolFeePayment.aggregate([
        { $match: Object.assign({}, matchFilter, { status: 'confirmed' }) },
        { $group: {
            _id:    '$method',
            amount: { $sum: '$amount' },
            count:  { $sum: 1 }
        }},
        { $sort: { amount: -1 } }
      ]),

      /* Breakdown by assignment status */
      SchoolFeeAssignment.aggregate([
        { $match: matchFilter },
        { $group: {
            _id:          '$status',
            count:        { $sum: 1 },
            totalBalance: { $sum: '$balance' }
        }}
      ]),

      /* Breakdown by class */
      SchoolFeeAssignment.aggregate([
        { $match: matchFilter },
        { $group: {
            _id:          '$classId',
            totalCharged: { $sum: '$amountDue' },
            totalPaid:    { $sum: '$amountPaid' },
            outstanding:  { $sum: '$balance' },
            count:        { $sum: 1 }
        }},
        { $sort: { totalCharged: -1 } },
        { $limit: 20 }
      ])
    ]);

    var agg = assignmentAgg[0] || { totalCharged: 0, totalPaid: 0, totalBalance: 0, count: 0 };
    var pay = paymentAgg[0]    || { totalAmount: 0, count: 0 };

    return res.status(200).json({
      success: true,
      report: {
        summary: {
          totalStudentsAssigned: agg.count,
          totalCharged:          agg.totalCharged,
          totalCollected:        pay.totalAmount,
          totalOutstanding:      agg.totalBalance,
          collectionRate:        agg.totalCharged > 0
            ? Math.round((pay.totalAmount / agg.totalCharged) * 100)
            : 0,
          paymentCount:          pay.count
        },
        byMethod,
        byStatus,
        byClass
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/institution/fee/reports/collection
   Detailed collection list — who paid what and when
*/
router.get('/reports/collection', staffGuard, async (req, res) => {
  try {
    var { termId, classId, method, dateFrom, dateTo, page = 1, limit = 50 } = req.query;
    var filter = { schoolId: req.schoolId, status: 'confirmed' };
    if (termId)  filter.termId  = termId;
    if (method)  filter.method  = method;
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo)   filter.createdAt.$lte = new Date(new Date(dateTo).setHours(23,59,59));
    }

    var skip  = (parseInt(page) - 1) * parseInt(limit);
    var total = await SchoolFeePayment.countDocuments(filter);

    var payments = await SchoolFeePayment.find(filter)
      .populate('studentId',      'name admissionNo class arm')
      .populate('feeStructureId', 'name')
      .populate('termId',         'name session')
      .populate('recordedBy',     'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    var totalAgg = await SchoolFeePayment.aggregate([
      { $match: Object.assign({}, filter, {
          schoolId: new mongoose.Types.ObjectId(req.schoolId)
      })},
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    var totalCollected = totalAgg[0] ? totalAgg[0].total : 0;

    return res.status(200).json({
      success: true,
      total,
      page:    parseInt(page),
      totalCollected,
      payments
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PARENT PORTAL — Read-only fee access
   GET /api/institution/fee/parent/:studentId
   Called by parent.routes.js (separate auth)
   Exported as a handler function for reuse.
============================================ */
router.get('/student/:studentId/summary', staffGuard, async (req, res) => {
  try {
    /* This endpoint is also used by parent portal internally */
    var { termId } = req.query;
    var filter = { schoolId: req.schoolId, studentId: req.params.studentId };
    if (termId) filter.termId = termId;

    var assignments = await SchoolFeeAssignment.find(filter)
      .populate('feeStructureId', 'name category amount')
      .populate('termId',         'name session')
      .lean();

    var payments = await SchoolFeePayment.find(
      Object.assign({}, filter, { status: 'confirmed' })
    ).select('amount method receiptNumber recordedAt createdAt').lean();

    var totalCharged     = assignments.reduce(function (s, a) { return s + a.amountDue; }, 0);
    var totalPaid        = payments.reduce(function (s, p)    { return s + p.amount; }, 0);
    var totalOutstanding = assignments
      .filter(function (a) { return ['pending','partial'].includes(a.status); })
      .reduce(function (s, a) { return s + a.balance; }, 0);

    return res.status(200).json({
      success: true,
      summary: { totalCharged, totalPaid, totalOutstanding },
      assignments,
      payments
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;