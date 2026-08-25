'use strict';
const express                = require('express');
const router                 = express.Router();
const SchoolParent           = require('../models/SchoolParent.model');
const SchoolParentInvitation = require('../models/SchoolParentInvitation.model');
const SchoolStudent          = require('../models/SchoolStudent.model');
const SchoolResult           = require('../models/SchoolResult.model');
const School                 = require('../models/School.model');
const { parentProtect }      = require('../middleware/parent.auth');
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

module.exports = router;