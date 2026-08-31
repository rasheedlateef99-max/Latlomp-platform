'use strict';
const express                = require('express');
const router                 = express.Router();
const SchoolParent           = require('../models/SchoolParent.model');
const SchoolParentInvitation = require('../models/SchoolParentInvitation.model');
const SchoolStudent          = require('../models/SchoolStudent.model');
const SchoolResult           = require('../models/SchoolResult.model');
const School                 = require('../models/School.model');
const { parentProtect }      = require('../middleware/parent.auth');
const mongoose               = require('mongoose');
const {
  instProtect,
  getEffectiveRoles,
  canManageStudents
} = require('../middleware/inst.auth');

/* ============================================
   RBAC HELPER
   Uses the existing getEffectiveRoles() from
   inst.auth.js — no new role system created.
   
   Roles permitted to invite parents are the same
   roles permitted to manage student records:
     school_admin, principal, vice_principal, dean,
     hod, department_admin, class_teacher
   This is canManageStudents from inst.auth.js.
============================================ */
function canInviteParents(req, res, next) {
  /* Delegates entirely to the existing canManageStudents
     middleware — same role set, same logic. */
  return canManageStudents(req, res, next);
}

/* ============================================
   HELPER: verify parent is linked to student
============================================ */
function isLinkedTo(parent, studentId) {
  return parent.linkedStudents.some(function (ls) {
    return ls.studentId.toString() === studentId.toString();
  });
}

/* ============================================
   INSTITUTION STAFF ROUTES
   All below require institution JWT (instProtect)
   + canInviteParents role check.
============================================ */

/* ============================================
   POST /api/institution/parent/invite
   
   Institution-authorized staff invites a parent.
   Staff selects which student(s) the parent
   is linked to — parent cannot self-select.
   
   Body: {
     parentEmail:  string (required)
     parentName:   string (optional)
     studentIds:   ObjectId[] (required, min 1)
     expiryHours:  number (optional, default 168 = 7 days)
   }
============================================ */
router.post('/invite', instProtect, canInviteParents, async (req, res) => {
  try {
    var { parentEmail, parentName, studentIds, expiryHours } = req.body;

    if (!parentEmail) {
      return res.status(400).json({ success: false, message: 'Parent email is required.' });
    }
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one student must be linked to the invitation.'
      });
    }

    /* Verify all students belong to this school — data isolation */
    var students = await SchoolStudent.find({
      _id:      { $in: studentIds },
      schoolId: req.schoolId
    }).select('name admissionNo class');

    if (students.length !== studentIds.length) {
      return res.status(400).json({
        success: false,
        message: 'One or more students were not found in your institution.'
      });
    }

    /* Cancel any existing pending invitation for same email + school */
    await SchoolParentInvitation.updateMany(
      { schoolId: req.schoolId, parentEmail: parentEmail.toLowerCase().trim(), status: 'pending' },
      { $set: { status: 'cancelled' } }
    );

    /* Create invitation — schoolId is taken from the authenticated staff's token,
       not from request body. Parent cannot influence which school they're linked to. */
    var expiryMs  = (expiryHours || 168) * 60 * 60 * 1000;
    var expiresAt = new Date(Date.now() + expiryMs);

    var invite = await SchoolParentInvitation.create({
      schoolId:    req.schoolId,
      invitedBy:   req.schoolUser._id,
      parentEmail: parentEmail.toLowerCase().trim(),
      parentName:  parentName || '',
      studentIds:  studentIds,
      expiresAt:   expiresAt
    });

    /* Build registration link for the institution to share with the parent */
    var baseUrl = process.env.APP_URL || 'https://latlompsystem.up.railway.app';
    var link    = baseUrl + '/institution/parent/login.html?invite=' + invite.token;

    return res.status(201).json({
      success:   true,
      message:   'Invitation created. Share the link with the parent.',
      inviteLink: link,
      token:     invite.token,
      expiresAt: invite.expiresAt,
      linkedStudents: students.map(function (s) {
        return { name: s.name, admissionNo: s.admissionNo, class: s.class };
      })
    });
  } catch (err) {
    console.error('[Parent] invite:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to create invitation.' });
  }
});

/* ============================================
   GET /api/institution/parent/invite/list
   
   List all parent invitations for this school.
   Institution staff only.
============================================ */
router.get('/invite/list', instProtect, canInviteParents, async (req, res) => {
  try {
    var invites = await SchoolParentInvitation.find({ schoolId: req.schoolId })
      .populate('studentIds', 'name admissionNo class')
      .populate('invitedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.status(200).json({ success: true, count: invites.length, invitations: invites });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load invitations.' });
  }
});

/* ============================================
   DELETE /api/institution/parent/invite/:id
   
   Cancel a pending invitation.
   Institution staff only.
============================================ */
router.delete('/invite/:id', instProtect, canInviteParents, async (req, res) => {
  try {
    var invite = await SchoolParentInvitation.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId
    });
    if (!invite) {
      return res.status(404).json({ success: false, message: 'Invitation not found.' });
    }
    invite.status = 'cancelled';
    await invite.save();
    return res.status(200).json({ success: true, message: 'Invitation cancelled.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to cancel invitation.' });
  }
});

/* ============================================
   PARENT ROUTES
   All below require parent JWT (parentProtect).
============================================ */
router.use(parentProtect);

/* ============================================
   Q3: All linked children + summary info
   GET /api/institution/parent/children
   
   Only returns students the institution explicitly
   linked via invitation. Parent cannot add more.
============================================ */
router.get('/children', async (req, res) => {
  try {
    if (req.parent.linkedStudents.length === 0) {
      return res.status(200).json({ success: true, children: [] });
    }

    var studentIds = req.parent.linkedStudents.map(function (ls) { return ls.studentId; });
    var students   = await SchoolStudent.find({ _id: { $in: studentIds } })
      .select('name admissionNo class arm studentId passportPhotoUrl status schoolId averageScore totalExamsTaken')
      .lean();

    var schoolIds = [...new Set(
      req.parent.linkedStudents.map(function (ls) { return ls.schoolId.toString(); })
    )];
    var schools   = await School.find({ _id: { $in: schoolIds } }).select('name logo').lean();
    var schoolMap = {};
    schools.forEach(function (s) { schoolMap[s._id.toString()] = s; });

    var children = students.map(function (st) {
      var link   = req.parent.linkedStudents.find(function (ls) {
        return ls.studentId.toString() === st._id.toString();
      });
      var school = link ? schoolMap[link.schoolId.toString()] : null;
      return {
        _id:              st._id,
        name:             st.name,
        admissionNo:      st.admissionNo,
        class:            st.class,
        arm:              st.arm,
        studentId:        st.studentId,
        passportPhotoUrl: st.passportPhotoUrl,
        status:           st.status,
        averageScore:     st.averageScore,
        totalExamsTaken:  st.totalExamsTaken,
        relationship:     link ? link.relationship : 'parent',
        school:           school
          ? { _id: school._id, name: school.name, logo: school.logo }
          : null
      };
    });

    return res.status(200).json({ success: true, children });
  } catch (err) {
    console.error('[Parent] children:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load children.' });
  }
});

/* ============================================
   Q4: Released results for a child
   GET /api/institution/parent/children/:studentId/results
   
   schoolId isolation: student must be in parent's
   linkedStudents (which was set by institution staff).
============================================ */
router.get('/children/:studentId/results', async (req, res) => {
  try {
    if (!isLinkedTo(req.parent, req.params.studentId)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    var results = await SchoolResult.find({
      studentId:  req.params.studentId,
      isReleased: true
    })
    .select('studentName studentClass score totalMarks scorePercent isPassed passMark ' +
            'objectiveScore objectiveTotal theoryScore theoryTotal theoryMarked ' +
            'timeTaken wasAutoSubmit createdAt releasedAt')
    .populate('examId', 'title subject examType')
    .sort({ createdAt: -1 })
    .lean();

    return res.status(200).json({ success: true, count: results.length, results });
  } catch (err) {
    console.error('[Parent] results:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load results.' });
  }
});

/* ============================================
   Q5: Attendance for a child
   GET /api/institution/parent/children/:studentId/attendance
============================================ */
router.get('/children/:studentId/attendance', async (req, res) => {
  try {
    if (!isLinkedTo(req.parent, req.params.studentId)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    var Attendance = null;
    try { Attendance = require('../models/Attendance.model'); } catch (e) {}
    if (!Attendance) {
      try { Attendance = require('../models/SchoolAttendance.model'); } catch (e) {}
    }

    if (!Attendance) {
      return res.status(200).json({
        success: true, records: [],
        message: 'Attendance module not yet active.'
      });
    }

    var records = await Attendance.find({ studentId: req.params.studentId })
      .sort({ date: -1 }).limit(90).lean();

    var present = records.filter(function (r) { return r.status === 'present'; }).length;
    var absent  = records.filter(function (r) { return r.status === 'absent'; }).length;

    return res.status(200).json({
      success: true,
      summary: {
        total: records.length, present, absent,
        rate: records.length > 0 ? Math.round((present / records.length) * 100) : 0
      },
      records
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load attendance.' });
  }
});

/* ============================================
   Q6: Timetable for a child's class
   GET /api/institution/parent/children/:studentId/timetable
============================================ */
router.get('/children/:studentId/timetable', async (req, res) => {
  try {
    if (!isLinkedTo(req.parent, req.params.studentId)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    var student = await SchoolStudent.findById(req.params.studentId)
      .select('classId class arm').lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    var Timetable = null;
    try { Timetable = require('../models/Timetable.model'); }         catch (e) {}
    if (!Timetable) {
      try { Timetable = require('../models/SchoolTimetable.model'); } catch (e) {}
    }

    if (!Timetable) {
      return res.status(200).json({
        success: true, slots: [],
        message: 'Timetable module not yet active.'
      });
    }

    var filter = student.classId ? { classId: student.classId } : {};
    var slots  = await Timetable.find(filter).sort({ day: 1, startTime: 1 }).lean();

    return res.status(200).json({
      success: true,
      class:   student.class + (student.arm ? ' ' + student.arm : ''),
      slots
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load timetable.' });
  }
});

/* ============================================
   R7 (Parent view): Fee summary for a child
   GET /api/institution/parent/children/:studentId/fees
============================================ */
router.get('/children/:studentId/fees', async (req, res) => {
  try {
    if (!isLinkedTo(req.parent, req.params.studentId)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    var SchoolFeeAssignment = null;
    var SchoolFeePayment    = null;
    try {
      SchoolFeeAssignment = require('../models/SchoolFeeAssignment.model');
      SchoolFeePayment    = require('../models/SchoolFeePayment.model');
    } catch (e) {}

    if (!SchoolFeeAssignment) {
      return res.status(200).json({
        success: true, assignments: [], payments: [],
        summary: { totalCharged: 0, totalPaid: 0, totalOutstanding: 0 }
      });
    }

    /* Get schoolId from the parent's link for this student */
    var link = req.parent.linkedStudents.find(function (ls) {
      return ls.studentId.toString() === req.params.studentId;
    });
    if (!link) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    var assignments = await SchoolFeeAssignment.find({
      schoolId:  link.schoolId,
      studentId: req.params.studentId
    })
    .populate('feeStructureId', 'name category amount')
    .populate('termId',         'name session')
    .lean();

    var payments = await SchoolFeePayment.find({
      schoolId:  link.schoolId,
      studentId: req.params.studentId,
      status:    'confirmed'
    }).select('amount method receiptNumber recordedAt createdAt').lean();

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
    return res.status(500).json({ success: false, message: 'Failed to load fee information.' });
  }
});

/* ============================================
   R2: Fee payment breakdown (preview before paying)
   GET /api/institution/parent/children/:studentId/fees/breakdown
   Query: ?assignmentId=xxx
============================================ */
router.get('/children/:studentId/fees/breakdown', async (req, res) => {
  try {
    if (!isLinkedTo(req.parent, req.params.studentId)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    if (!req.query.assignmentId) {
      return res.status(400).json({ success: false, message: 'assignmentId query parameter is required.' });
    }

    var SchoolFeeAssignment  = require('../models/SchoolFeeAssignment.model');
    var SchoolFeeStructure   = require('../models/SchoolFeeStructure.model');
    var SchoolPaymentAccount = require('../models/SchoolPaymentAccount.model');
    var { calculateFeeBreakdown } = require('../config/fee.config');

    /* Get student's schoolId from parent link */
    var link = req.parent.linkedStudents.find(function (ls) {
      return ls.studentId.toString() === req.params.studentId;
    });
    if (!link) return res.status(403).json({ success: false, message: 'Access denied.' });

    var assignment = await SchoolFeeAssignment.findOne({
      _id:      req.query.assignmentId,
      schoolId: link.schoolId,
      studentId: req.params.studentId
    }).populate('feeStructureId', 'name category currency').lean();

    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Fee assignment not found.' });
    }
    if (['paid', 'waived', 'cancelled'].includes(assignment.status)) {
      return res.status(400).json({ success: false, message: 'This fee is already ' + assignment.status + '.' });
    }
    if (assignment.balance <= 0) {
      return res.status(400).json({ success: false, message: 'This fee has no outstanding balance.' });
    }

    /* Check school has active payment account */
    var payAccount = await SchoolPaymentAccount.findOne({
      schoolId: link.schoolId, status: 'active', onlinePaymentsEnabled: true
    }).lean();
    if (!payAccount) {
      return res.status(400).json({
        success: false,
        message: 'Online payments are not available for this institution. Please pay at the school.',
        onlineAvailable: false
      });
    }

    var currency   = assignment.currency || payAccount.currency || 'NGN';
    var breakdown  = await calculateFeeBreakdown(assignment.balance, currency);

    return res.status(200).json({
      success: true,
      onlineAvailable: true,
      breakdown: {
        feeName:           assignment.feeStructureId ? assignment.feeStructureId.name : 'Fee',
        currency,
        schoolFeeAmount:   breakdown.schoolFeeAmount,
        platformFeePercent:breakdown.platformFeePercent,
        platformFeeAmount: breakdown.platformFeeAmount,
        totalCharged:      breakdown.totalCharged,
        providerFeeNote:   breakdown.providerFeeNote,
        assignmentId:      assignment._id,
        assignmentStatus:  assignment.status
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   R2: Initialize online payment
   POST /api/institution/parent/children/:studentId/fees/pay/initialize
   Body: { assignmentId }
============================================ */
router.post('/children/:studentId/fees/pay/initialize', async (req, res) => {
  try {
    if (!isLinkedTo(req.parent, req.params.studentId)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    var { assignmentId } = req.body;
    if (!assignmentId) {
      return res.status(400).json({ success: false, message: 'assignmentId is required.' });
    }

    var SchoolFeeAssignment  = require('../models/SchoolFeeAssignment.model');
    var SchoolPaymentAccount = require('../models/SchoolPaymentAccount.model');
    var PlatformConfig       = require('../models/PlatformConfig.model');
    var { getProvider }      = require('../providers/payment.provider');
    var { calculateFeeBreakdown } = require('../config/fee.config');

    /* Get trusted schoolId from parent link — never from request body */
    var link = req.parent.linkedStudents.find(function (ls) {
      return ls.studentId.toString() === req.params.studentId;
    });
    if (!link) return res.status(403).json({ success: false, message: 'Access denied.' });

    /* Validate assignment belongs to student + school */
    var assignment = await SchoolFeeAssignment.findOne({
      _id:       assignmentId,
      schoolId:  link.schoolId,
      studentId: req.params.studentId
    });
    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Fee assignment not found.' });
    }
    if (['paid', 'waived', 'cancelled'].includes(assignment.status)) {
      return res.status(400).json({ success: false, message: 'This fee is already ' + assignment.status + '.' });
    }
    if (assignment.balance <= 0) {
      return res.status(400).json({ success: false, message: 'No outstanding balance.' });
    }

    /* Verify online payments are enabled */
    var payAccount = await SchoolPaymentAccount.findOne({
      schoolId: link.schoolId, status: 'active', onlinePaymentsEnabled: true
    }).lean();
    if (!payAccount) {
      return res.status(400).json({
        success: false,
        message: 'Online payments are not configured for this institution.'
      });
    }

    /* Check platform master switch */
    var onlineEnabled = await PlatformConfig.getValue('online_payments_enabled', true);
    if (!onlineEnabled) {
      return res.status(503).json({ success: false, message: 'Online payments are temporarily unavailable.' });
    }

    var currency   = assignment.currency || payAccount.currency || 'NGN';
    var breakdown  = await calculateFeeBreakdown(assignment.balance, currency);

    /* Generate unique reference */
    var reference  = 'FEE-' + link.schoolId.toString().slice(-6).toUpperCase() +
                     '-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    var appUrl     = (process.env.APP_URL || 'https://latlompsystem.up.railway.app').replace(/\/$/, '');
    var callbackUrl = appUrl + '/institution/parent/dashboard.html?feeRef=' + reference;

    /* Call provider */
    var provider = getProvider(payAccount.provider || 'paystack');
    var initResult = await provider.initializePayment({
      email:              req.parent.email,
      schoolFeeAmount:    breakdown.schoolFeeAmount,
      platformFeeAmount:  breakdown.platformFeeAmount,
      currency,
      subaccountCode:     payAccount.providerAccountCode,
      reference,
      callbackUrl,
      metadata: {
        parentId:       req.parent._id.toString(),
        studentId:      req.params.studentId,
        assignmentId:   assignmentId,
        schoolId:       link.schoolId.toString(),
        feeStructureId: assignment.feeStructureId ? assignment.feeStructureId.toString() : '',
        termId:         assignment.termId ? assignment.termId.toString() : ''
      }
    });

    return res.status(200).json({
      success:           true,
      reference:         initResult.reference,
      authorizationUrl:  initResult.authorizationUrl,
      accessCode:        initResult.accessCode,
      breakdown: {
        currency,
        schoolFeeAmount:   breakdown.schoolFeeAmount,
        platformFeePercent:breakdown.platformFeePercent,
        platformFeeAmount: breakdown.platformFeeAmount,
        totalCharged:      breakdown.totalCharged
      }
    });
  } catch (err) {
    console.error('[ParentFeeInit] error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   R2: Verify online payment (browser return path)
   POST /api/institution/parent/children/:studentId/fees/pay/verify
   Body: { reference }
   Idempotent: safe to call multiple times.
============================================ */
router.post('/children/:studentId/fees/pay/verify', async (req, res) => {
  try {
    if (!isLinkedTo(req.parent, req.params.studentId)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    var { reference } = req.body;
    if (!reference) {
      return res.status(400).json({ success: false, message: 'Payment reference is required.' });
    }

    var SchoolFeePayment    = require('../models/SchoolFeePayment.model');
    var SchoolFeeAssignment = require('../models/SchoolFeeAssignment.model');
    var SchoolPaymentAccount= require('../models/SchoolPaymentAccount.model');
    var PlatformConfig      = require('../models/PlatformConfig.model');
    var { getProvider }     = require('../providers/payment.provider');

    /* Idempotency check */
    var existing = await SchoolFeePayment.findOne({ paystackRef: reference, status: 'confirmed' });
    if (existing) {
      return res.status(200).json({
        success:       true,
        alreadyRecorded: true,
        receiptNumber: existing.receiptNumber,
        amount:        existing.amount,
        currency:      existing.currency,
        message:       'Payment already recorded.'
      });
    }

    /* Get trusted schoolId from parent link */
    var link = req.parent.linkedStudents.find(function (ls) {
      return ls.studentId.toString() === req.params.studentId;
    });
    if (!link) return res.status(403).json({ success: false, message: 'Access denied.' });

    /* Get payment account */
    var payAccount = await SchoolPaymentAccount.findOne({
      schoolId: link.schoolId, status: 'active'
    }).lean();
    if (!payAccount) {
      return res.status(400).json({ success: false, message: 'School payment account not configured.' });
    }

    /* Verify with provider */
    var provider   = getProvider(payAccount.provider || 'paystack');
    var result     = await provider.verifyPayment(reference);

    if (result.status !== 'success') {
      return res.status(400).json({
        success: false,
        message: 'Payment was not completed. Status: ' + result.status
      });
    }

    /* Extract assignmentId from provider metadata */
    var assignmentId = result.metadata && result.metadata.assignmentId;
    if (!assignmentId) {
      return res.status(400).json({ success: false, message: 'Payment metadata missing. Contact support.' });
    }

    /* Validate assignment is for this student + school */
    var assignment = await SchoolFeeAssignment.findOne({
      _id:       assignmentId,
      schoolId:  link.schoolId,
      studentId: req.params.studentId
    });
    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Assignment not found for this payment.' });
    }

    /* Snapshot platform fee percent */
    var platformFeePercent = await PlatformConfig.getValue('platform_fee_percent', 0.5);

    /* Generate receipt number */
    var receiptCount  = await SchoolFeePayment.countDocuments({ schoolId: link.schoolId });
    var receiptNumber = 'RCP-' + new Date().toISOString().slice(0,10).replace(/-/g,'') +
                        '-' + String(receiptCount + 1).padStart(4, '0');

    /* Create payment record */
    var payment = await SchoolFeePayment.create({
      schoolId:          link.schoolId,
      studentId:         req.params.studentId,
      assignmentId:      assignment._id,
      feeStructureId:    assignment.feeStructureId,
      termId:            assignment.termId,
      amount:            result.schoolFeeAmount,
      currency:          result.currency,
      method:            'paystack',
      paystackRef:       reference,
      externalRef:       reference,
      receiptNumber,
      status:            'confirmed',
      totalCharged:      result.totalCharged,
      platformFeePercent,
      platformFeeAmount: result.platformFeeAmount,
      providerFeeAmount: result.providerFeeAmount,
      recordedAt:        result.paidAt || new Date()
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

    return res.status(200).json({
      success:       true,
      message:       '₦' + result.schoolFeeAmount.toLocaleString() + ' payment confirmed.',
      receiptNumber,
      payment: {
        amount:            result.schoolFeeAmount,
        currency:          result.currency,
        totalCharged:      result.totalCharged,
        platformFeeAmount: result.platformFeeAmount,
        providerFeeAmount: result.providerFeeAmount,
        receiptNumber,
        paidAt:            result.paidAt
      },
      updatedBalance: balance,
      assignmentStatus: newStatus
    });
  } catch (err) {
    console.error('[ParentFeeVerify] error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   Q7: Notifications for parent
   GET /api/institution/parent/notifications
============================================ */
router.get('/notifications', async (req, res) => {
  try {
    var schoolIds = [...new Set(
      req.parent.linkedStudents.map(function (ls) { return ls.schoolId.toString(); })
    )];
    if (schoolIds.length === 0) {
      return res.status(200).json({ success: true, notifications: [] });
    }

    var Announcement = null;
    try { Announcement = require('../models/Announcement.model'); } catch (e) {}

    if (!Announcement) {
      return res.status(200).json({ success: true, notifications: [] });
    }

    var notes = await Announcement.find({
      $or: [
        { schoolId: { $in: schoolIds } },
        { schoolId: null }
      ]
    }).sort({ createdAt: -1 }).limit(30).lean();

    return res.status(200).json({ success: true, count: notes.length, notifications: notes });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load notifications.' });
  }
});

/* ============================================
   ✅ E7: GET /children/:studentId/timeline
   Academic timeline via E4 (released only, non-confidential).
   No new timeline engine — reuses timeline.service.js directly.
============================================ */
router.get('/children/:studentId/timeline', async function(req, res) {
  try {
    if (!isLinkedTo(req.parent, req.params.studentId)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    /* Get schoolId from link — never from request body */
    var link = req.parent.linkedStudents.find(function(ls) {
      return ls.studentId.toString() === req.params.studentId;
    });
    if (!link) { return res.status(403).json({ success: false, message: 'Access denied.' }); }

    var timelineService = require('../services/timeline.service');
    var result = await timelineService.getTimeline(
      req.params.studentId,
      link.schoolId.toString(),
      {
        includeConfidential: false, /* D1: never show confidential to parents */
        includeAdmin:        false,
        releasedResultsOnly: true,
        filterType:          req.query.type    || null,
        filterSession:       req.query.session || null
      }
    );

    if (!result) {
      return res.status(404).json({ success: false, message: 'Timeline not found.' });
    }

    return res.json({ success: true, ...result });
  } catch(err) {
    console.error('[Parent] GET /timeline:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E7: GET /children/:studentId/portfolio
   Academic portfolio via E2 (non-confidential, released scores).
============================================ */
router.get('/children/:studentId/portfolio', async function(req, res) {
  try {
    if (!isLinkedTo(req.parent, req.params.studentId)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    var link = req.parent.linkedStudents.find(function(ls) {
      return ls.studentId.toString() === req.params.studentId;
    });
    if (!link) { return res.status(403).json({ success: false, message: 'Access denied.' }); }

    var portfolioService = require('../services/portfolio.service');
    var data = await portfolioService.getPortfolioData(
      req.params.studentId,
      link.schoolId.toString(),
      {
        releasedScoresOnly:  true,  /* only released scores */
        includeConfidential: false  /* D1: never show confidential to parents */
      }
    );

    if (!data) {
      return res.status(404).json({ success: false, message: 'Portfolio not found.' });
    }

    return res.json({ success: true, data });
  } catch(err) {
    console.error('[Parent] GET /portfolio:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E7: GET /children/:studentId/progression
   Progression history filtered from E4 timeline.
   Only promotion/graduation/repetition events.
============================================ */
router.get('/children/:studentId/progression', async function(req, res) {
  try {
    if (!isLinkedTo(req.parent, req.params.studentId)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    var link = req.parent.linkedStudents.find(function(ls) {
      return ls.studentId.toString() === req.params.studentId;
    });
    if (!link) { return res.status(403).json({ success: false, message: 'Access denied.' }); }

    var timelineService = require('../services/timeline.service');
    var result = await timelineService.getTimeline(
      req.params.studentId,
      link.schoolId.toString(),
      {
        includeConfidential: false,
        includeAdmin:        false,
        releasedResultsOnly: true
      }
    );

    if (!result) {
      return res.status(404).json({ success: false, message: 'Progression data not found.' });
    }

    /* Filter to progression-relevant events only */
    var progressionTypes = ['promotion','repetition','graduation','transfer','enrollment'];
    var progressionEvents = result.timeline.filter(function(ev) {
      return progressionTypes.includes(ev.type);
    });

    return res.json({
      success:    true,
      student:    result.student,
      lifecycle:  result.lifecycle,
      progression:progressionEvents,
      count:      progressionEvents.length
    });
  } catch(err) {
    console.error('[Parent] GET /progression:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E7: GET /children/:studentId/homework
   Homework for child's class. D4: scoped by classId.
   Query: ?termId=&status=
============================================ */
router.get('/children/:studentId/homework', async function(req, res) {
  try {
    if (!isLinkedTo(req.parent, req.params.studentId)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    var link = req.parent.linkedStudents.find(function(ls) {
      return ls.studentId.toString() === req.params.studentId;
    });
    if (!link) { return res.status(403).json({ success: false, message: 'Access denied.' }); }

    /* Get student's classId (needed for homework scope) */
    var student = await SchoolStudent.findOne({
      _id:      req.params.studentId,
      schoolId: link.schoolId
    }).select('classId class').lean();

    if (!student || !student.classId) {
      return res.json({ success: true, homework: [], message: 'No class assigned.' });
    }

    var SchoolHomework = require('../models/SchoolHomework.model');

    /* MANDATORY: scope by classId — never by schoolId alone (Security Rule 5) */
    var filter = {
      schoolId: link.schoolId,
      classId:  student.classId,
      status:   'active'
    };
    if (req.query.termId) filter.termId = req.query.termId;
    if (req.query.status) filter.status = req.query.status; /* allow viewing cancelled too */

    var homework = await SchoolHomework.find(filter)
      .sort({ dueDate: 1 })
      .lean();

    return res.json({
      success:   true,
      className: student.class || '',
      homework,
      count:     homework.length
    });
  } catch(err) {
    console.error('[Parent] GET /homework:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E7: GET /children/:studentId/alerts
   Computed alerts via parent.alert.service.js.
   4 parallel queries. No stored alert model.
============================================ */
router.get('/children/:studentId/alerts', async function(req, res) {
  try {
    if (!isLinkedTo(req.parent, req.params.studentId)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    var link = req.parent.linkedStudents.find(function(ls) {
      return ls.studentId.toString() === req.params.studentId;
    });
    if (!link) { return res.status(403).json({ success: false, message: 'Access denied.' }); }

    var alertService = require('../services/parent.alert.service');
    var alerts = await alertService.getAlertsForChild(
      req.params.studentId,
      link.schoolId.toString()
    );

    return res.json({ success: true, alerts, count: alerts.length });
  } catch(err) {
    console.error('[Parent] GET /alerts:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E7: GET /children/:studentId/messages
   Parent-side message threads for a specific child.
============================================ */
router.get('/children/:studentId/messages', async function(req, res) {
  try {
    if (!isLinkedTo(req.parent, req.params.studentId)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    var SchoolMessage = require('../models/SchoolMessage.model');
    var messages = await SchoolMessage.find({
      parentId:  req.parent._id,
      studentId: req.params.studentId
    })
    .sort({ lastMessageAt: -1 })
    .lean();

    return res.json({ success: true, messages, count: messages.length });
  } catch(err) {
    console.error('[Parent] GET /messages:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E7: POST /children/:studentId/messages
   Parent sends a new message or replies to thread.
   Body: { body, subject? }
============================================ */
router.post('/children/:studentId/messages', async function(req, res) {
  try {
    if (!isLinkedTo(req.parent, req.params.studentId)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    var { body, subject } = req.body;
    if (!body || !body.trim()) {
      return res.status(400).json({ success: false, message: 'Message body is required.' });
    }

    var link = req.parent.linkedStudents.find(function(ls) {
      return ls.studentId.toString() === req.params.studentId;
    });
    if (!link) { return res.status(403).json({ success: false, message: 'Access denied.' }); }

    var SchoolMessage = require('../models/SchoolMessage.model');

    /* Find existing open thread or create new */
    var existing = await SchoolMessage.findOne({
      schoolId:  link.schoolId,
      studentId: req.params.studentId,
      parentId:  req.parent._id,
      status:    'open'
    });

    if (existing) {
      existing.thread.push({
        senderId:   req.parent._id,
        senderType: 'parent',
        senderName: req.parent.name || '',
        body:       body.trim(),
        sentAt:     new Date()
      });
      existing.lastMessageAt = new Date();
      existing.lastMessageBy = 'parent';
      await existing.save();
      return res.json({ success: true, message: 'Message sent.', messageId: existing._id });
    }

    /* New thread */
    var newMessage = await SchoolMessage.create({
      schoolId:     link.schoolId,
      studentId:    req.params.studentId,
      parentId:     req.parent._id,
      subject:      (subject || '').trim(),
      initiatedBy:  'parent',
      status:       'open',
      lastMessageAt:new Date(),
      lastMessageBy:'parent',
      thread: [{
        senderId:   req.parent._id,
        senderType: 'parent',
        senderName: req.parent.name || '',
        body:       body.trim(),
        sentAt:     new Date()
      }]
    });

    return res.status(201).json({
      success:   true,
      message:   'Message sent. A teacher will respond shortly.',
      messageId: newMessage._id
    });
  } catch(err) {
    console.error('[Parent] POST /messages:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E7: PUT /messages/:messageId/read
   Parent marks a message thread as read.
   Only marks teacher messages as read.
============================================ */
router.put('/messages/:messageId/read', async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.messageId)) {
      return res.status(400).json({ success: false, message: 'Invalid message ID.' });
    }

    var SchoolMessage = require('../models/SchoolMessage.model');
    var msg = await SchoolMessage.findOne({
      _id:      req.params.messageId,
      parentId: req.parent._id /* parent can only mark their own threads */
    });
    if (!msg) {
      return res.status(404).json({ success: false, message: 'Message not found.' });
    }

    /* Mark all unread teacher messages as read now */
    var now = new Date();
    var updated = false;
    msg.thread.forEach(function(entry) {
      if (entry.senderType === 'teacher' && !entry.readAt) {
        entry.readAt = now;
        updated = true;
      }
    });

    if (updated) { await msg.save(); }

    return res.json({ success: true, message: 'Thread marked as read.' });
  } catch(err) {
    console.error('[Parent] PUT /messages/read:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E7: GET /announcements
   Parent-facing school announcements.
   Replaces the old GET /notifications behaviour
   (which found no model — kept untouched for
   backward compatibility).
   Returns for ALL schools the parent has children in.
============================================ */
router.get('/announcements', async function(req, res) {
  try {
    /* Get all schoolIds from parent's linked students */
    var schoolIds = [...new Set(
      req.parent.linkedStudents.map(function(ls) { return ls.schoolId.toString(); })
    )];

    if (!schoolIds.length) {
      return res.json({ success: true, announcements: [], count: 0 });
    }

    var SchoolAnnouncement = require('../models/SchoolAnnouncement.model');
    var now                = new Date();

    var announcements = await SchoolAnnouncement.find({
      schoolId:       { $in: schoolIds },
      status:         'published',
      targetAudience: { $in: ['parents','all'] },
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: now } }
      ]
    })
    .sort({ priority: -1, publishedAt: -1 })
    .lean();

    return res.json({ success: true, announcements, count: announcements.length });
  } catch(err) {
    console.error('[Parent] GET /announcements:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E7: GET /events
   Parent-facing school events.
   Returns upcoming events for all schools the parent
   has children in. D3: SchoolEvent only — not AlumniEvent.
============================================ */
router.get('/events', async function(req, res) {
  try {
    var schoolIds = [...new Set(
      req.parent.linkedStudents.map(function(ls) { return ls.schoolId.toString(); })
    )];

    if (!schoolIds.length) {
      return res.json({ success: true, events: [], count: 0 });
    }

    var SchoolEvent = require('../models/SchoolEvent.model');
    var now         = new Date();

    var events = await SchoolEvent.find({
      schoolId:   { $in: schoolIds },
      status:     'published',
      visibility: { $in: ['parents','all'] },
      date:       { $gte: now }
    })
    .select('-registrations') /* don't expose other registrants to parents */
    .sort({ date: 1 })
    .lean();

    /* Attach own registration status */
    var SchoolEventWithRegs = require('../models/SchoolEvent.model');
    var myRegistrations = await SchoolEventWithRegs.find({
      _id:      { $in: events.map(function(ev) { return ev._id; }) },
      'registrations.parentId': req.parent._id
    }).select('_id registrations').lean();

    var myRegMap = {};
    myRegistrations.forEach(function(ev) {
      var myReg = ev.registrations && ev.registrations.find(function(r) {
        return r.parentId && r.parentId.toString() === req.parent._id.toString();
      });
      if (myReg) { myRegMap[ev._id.toString()] = myReg.status; }
    });

    var result = events.map(function(ev) {
      return Object.assign({}, ev, {
        myRegistrationStatus: myRegMap[ev._id.toString()] || null
      });
    });

    return res.json({ success: true, events: result, count: result.length });
  } catch(err) {
    console.error('[Parent] GET /events:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E7: POST /events/:eventId/register
   Parent registers for a school event.
============================================ */
router.post('/events/:eventId/register', async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.eventId)) {
      return res.status(400).json({ success: false, message: 'Invalid event ID.' });
    }

    /* Verify event belongs to a school the parent is linked to */
    var parentSchoolIds = req.parent.linkedStudents.map(function(ls) {
      return ls.schoolId.toString();
    });

    var SchoolEvent = require('../models/SchoolEvent.model');
    var event = await SchoolEvent.findOne({
      _id:        req.params.eventId,
      schoolId:   { $in: parentSchoolIds },
      status:     'published',
      visibility: { $in: ['parents','all'] }
    });
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }
    if (new Date(event.date) < new Date()) {
      return res.status(400).json({ success: false, message: 'This event has already passed.' });
    }

    /* Check existing registration */
    var alreadyRegistered = event.registrations && event.registrations.find(function(r) {
      return r.parentId && r.parentId.toString() === req.parent._id.toString() &&
             r.status === 'registered';
    });
    if (alreadyRegistered) {
      return res.status(400).json({ success: false, message: 'Already registered.' });
    }

    var activeCount = event.registrations
      ? event.registrations.filter(function(r) { return r.status === 'registered'; }).length
      : 0;
    var regStatus = (event.capacity && activeCount >= event.capacity) ? 'waitlisted' : 'registered';

    var studentId = req.body.studentId;
    /* Verify the student (if provided) is linked to this parent */
    if (studentId && !isLinkedTo(req.parent, studentId)) {
      return res.status(403).json({ success: false, message: 'Student not linked to your account.' });
    }

    event.registrations.push({
      parentId:     req.parent._id,
      parentName:   req.parent.name || '',
      studentId:    studentId || null,
      registeredAt: new Date(),
      status:       regStatus
    });
    await event.save();

    return res.json({
      success: true,
      message: regStatus === 'waitlisted' ? 'Added to waitlist.' : 'Registered successfully.',
      status:  regStatus
    });
  } catch(err) {
    console.error('[Parent] POST /events/register:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;