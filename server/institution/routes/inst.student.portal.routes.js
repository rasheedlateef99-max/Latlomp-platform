/* ============================================
   LATLOMP INSTITUTION — STUDENT PORTAL ROUTES
   ✅ PHASE P: Student Authenticated Portal

   ✅ RESTRUCTURE STAGE 4:
   Set-pin endpoint now allows class_teacher and
   department_admin to set PINs for students in
   their own class/department.

   CHANGED:
     PUT /portal/admin/students/:id/set-pin
       was: adminGuard (schoolAdminOnly)
       now: manageGuard (canManageStudents) +
            scope check inside handler

   ALL OTHER ENDPOINTS UNCHANGED:
     All student-facing endpoints use studentProtect.
     studentProtect is defined in this file and is
     completely separate from institution JWT guards.
     No student endpoint changes in this stage.
============================================ */
'use strict';

const express             = require('express');
const router              = express.Router();
const jwt                 = require('jsonwebtoken');
const bcrypt              = require('bcryptjs');

const School              = require('../models/School.model');
const SchoolStudent       = require('../models/SchoolStudent.model');
const SchoolScore         = require('../models/SchoolScore.model');
const ScoreSubmission     = require('../models/ScoreSubmission.model');
const ReportCardSettings  = require('../models/ReportCardSettings.model');
const TimetableSlot       = require('../models/Timetable.model');
const AttendanceRecord    = require('../models/Attendance.model');
const AcademicTerm        = require('../models/AcademicTerm.model');
const SchoolClass         = require('../models/Class.model');

const {
  instProtect,
  schoolAdminOnly,
  canManageStudents,      /* ✅ STAGE 4 */
  verifyStudentScope,     /* ✅ STAGE 4 */
  getEffectiveRoles       /* ✅ STAGE 4 */
} = require('../middleware/inst.auth');
const { requireActiveSubscription } = require('../middleware/inst.tenant');

/* ✅ STAGE 4: manageGuard replaces adminGuard on set-pin */
var manageGuard = [instProtect, canManageStudents,  requireActiveSubscription];

/* Kept for reference (no longer used in this file after Stage 4) */
/* var adminGuard = [instProtect, schoolAdminOnly, requireActiveSubscription]; */

/* Senior roles — unrestricted scope */
var SENIOR_ROLES = ['school_admin', 'principal', 'vice_principal', 'dean'];

function isUnrestricted(schoolUser) {
  var roles = getEffectiveRoles(schoolUser);
  return roles.some(function (r) { return SENIOR_ROLES.includes(r); });
}

/* ============================================
   STUDENT JWT HELPERS (unchanged from Phase P)
============================================ */
function signStudentToken(studentId, schoolId) {
  return jwt.sign(
    {
      studentId: studentId.toString(),
      schoolId:  schoolId.toString(),
      role:      'student'
    },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function studentProtect(req, res, next) {
  try {
    var authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Not authenticated. Please log in.' });
    }
    var token   = authHeader.split(' ')[1];
    var decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.studentId || decoded.role !== 'student') {
      return res.status(401).json({ success: false, message: 'Invalid token type.' });
    }
    req.studentId = decoded.studentId;
    req.schoolId  = decoded.schoolId;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired session. Please log in again.'
    });
  }
}

async function subscriptionActive(schoolId) {
  var school = await School.findById(schoolId);
  return school && school.isSubscriptionActive;
}

/* ============================================
   POST /portal/login (unchanged)
============================================ */
router.post('/portal/login', async function (req, res) {
  try {
    var body        = req.body || {};
    var schoolSlug  = body.schoolSlug;
    var admissionNo = body.admissionNo ? String(body.admissionNo).trim() : '';
    var studentCode = body.studentCode ? String(body.studentCode).trim() : '';
    var pin         = body.pin         ? String(body.pin).trim()         : '';

    if (!schoolSlug) {
      return res.status(400).json({ success: false, message: 'School identifier is required.' });
    }
    if (!admissionNo && !studentCode) {
      return res.status(400).json({ success: false, message: 'Admission number or student ID is required.' });
    }
    if (!pin) {
      return res.status(400).json({ success: false, message: 'PIN is required.' });
    }

    var school = await School.findOne({ slug: schoolSlug.trim() });
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found. Please check your login link.' });
    }
    if (!school.isSubscriptionActive) {
      return res.status(403).json({ success: false, message: 'Your school subscription is not active. Contact your school administrator.' });
    }

    var studentQuery = { schoolId: school._id, status: 'active' };
    if (admissionNo) { studentQuery.admissionNo = admissionNo; }
    else             { studentQuery.studentId   = studentCode; }

    var student = await SchoolStudent.findOne(studentQuery).populate('classId', 'name');
    if (!student) {
      return res.status(401).json({ success: false, message: 'Student not found or account is inactive. Check your details or contact your school.' });
    }
    if (!student.pinCode) {
      return res.status(401).json({ success: false, message: 'No PIN has been set for this account. Please contact your school administrator.' });
    }

    var pinMatch = await bcrypt.compare(pin, student.pinCode);
    if (!pinMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect PIN. Please try again.' });
    }

    var token = signStudentToken(student._id, school._id);

    return res.status(200).json({
      success: true,
      message: 'Welcome, ' + student.name + '!',
      token:   token,
      student: {
        _id:             student._id,
        name:            student.name,
        admissionNo:     student.admissionNo      || '',
        studentCode:     student.studentId        || '',
        gender:          student.gender           || '',
        passportPhotoUrl:student.passportPhotoUrl || '',
        className:       student.classId ? student.classId.name : '',
        classId:         student.classId ? student.classId._id  : null
      },
      school: {
        _id:          school._id,
        name:         school.name,
        logo:         school.logo         || '',
        primaryColor: school.primaryColor || '#6c63ff'
      }
    });
  } catch (err) {
    console.error('[student.portal] POST /login:', err.message);
    return res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
  }
});

/* ============================================
   GET /portal/me (unchanged)
============================================ */
router.get('/portal/me', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }
    var [student, school] = await Promise.all([
      SchoolStudent.findOne({ _id: req.studentId, schoolId: req.schoolId })
        .populate('classId', 'name').lean(),
      School.findById(req.schoolId)
        .select('name logo primaryColor address state attendanceMode').lean()
    ]);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }
    return res.json({
      success: true,
      student: {
        _id:             student._id,
        name:            student.name,
        admissionNo:     student.admissionNo      || '',
        studentCode:     student.studentId        || '',
        gender:          student.gender           || '',
        dateOfBirth:     student.dateOfBirth      || null,
        passportPhotoUrl:student.passportPhotoUrl || '',
        parentName:      student.parentName       || '',
        parentPhone:     student.parentPhone      || '',
        className:       student.classId ? student.classId.name : '',
        classId:         student.classId ? student.classId._id  : null
      },
      school: school
    });
  } catch (err) {
    console.error('[student.portal] GET /me:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /portal/terms (unchanged)
============================================ */
router.get('/portal/terms', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }
    var terms = await AcademicTerm.find({ schoolId: req.schoolId, isActive: true })
      .sort({ session: -1, term: 1 })
      .select('name session term isCurrent').lean();
    return res.json({ success: true, terms: terms });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /portal/scores (unchanged)
============================================ */
router.get('/portal/scores', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }
    var student = await SchoolStudent.findOne({ _id: req.studentId, schoolId: req.schoolId })
      .select('classId').lean();
    if (!student || !student.classId) {
      return res.status(404).json({ success: false, message: 'Student class not found.' });
    }

    var termId = req.query.termId || null;
    if (!termId) {
      var currentTerm = await AcademicTerm.findOne({ schoolId: req.schoolId, isCurrent: true }).lean();
      if (currentTerm) { termId = currentTerm._id; }
    }

    var subFilter = {
      schoolId: req.schoolId, classId: student.classId,
      status: 'approved', releasedToStudents: true
    };
    if (termId) { subFilter.termId = termId; }

    var releasedSubs = await ScoreSubmission.find(subFilter).select('subjectId').lean();
    if (releasedSubs.length === 0) {
      return res.json({ success: true, termId: termId, scores: [], message: 'No scores have been released yet.' });
    }

    var releasedSubjectIds = releasedSubs.map(function (s) { return s.subjectId; });
    var scoreFilter = { schoolId: req.schoolId, studentId: req.studentId, subjectId: { $in: releasedSubjectIds } };
    if (termId) { scoreFilter.termId = termId; }

    var scores = await SchoolScore.find(scoreFilter)
      .populate('subjectId', 'name code').populate('termId', 'name session')
      .sort({ 'subjectId.name': 1 }).lean();

    return res.json({
      success: true, termId: termId,
      scores: scores.map(function (s) {
        return {
          _id:          s._id,
          subjectName:  (s.subjectId && s.subjectId.name) || '',
          subjectCode:  (s.subjectId && s.subjectId.code) || '',
          term:         s.termId ? s.termId.name + ' — ' + s.termId.session : '',
          scores:       s.scores || {},
          total:        s.total        || 0,
          maxPossible:  s.maxPossible  || 0,
          percentage:   s.percentage   || 0,
          grade:        s.grade        || '—',
          remark:       s.remark       || '—',
          position:     s.position     || null,
          positionOutOf:s.positionOutOf || null
        };
      })
    });
  } catch (err) {
    console.error('[student.portal] GET /scores:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /portal/report-card (unchanged)
============================================ */
router.get('/portal/report-card', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }
    var student = await SchoolStudent.findOne({ _id: req.studentId, schoolId: req.schoolId })
      .select('classId name admissionNo studentId gender dateOfBirth').lean();
    if (!student || !student.classId) {
      return res.status(404).json({ success: false, message: 'Student or class not found.' });
    }

    var termId = req.query.termId || null;
    if (!termId) {
      var currentTerm = await AcademicTerm.findOne({ schoolId: req.schoolId, isCurrent: true }).lean();
      if (currentTerm) { termId = currentTerm._id; }
    }
    if (!termId) {
      return res.json({ success: true, released: false, message: 'No current term found.' });
    }

    var term     = await AcademicTerm.findById(termId).select('name session term').lean();
    var settings = await ReportCardSettings.findOne({
      schoolId: req.schoolId, classId: student.classId, termId: termId
    }).lean();

    if (!settings || !settings.isReleased) {
      return res.json({ success: true, released: false, message: 'Your report card has not been released yet. Please check back later.' });
    }

    var teacherComment = '';
    if (settings.studentComments) {
      var sid = req.studentId.toString();
      teacherComment = (typeof settings.studentComments.get === 'function')
        ? (settings.studentComments.get(sid) || '')
        : (settings.studentComments[sid]     || '');
    }

    return res.json({
      success: true, released: true, term: term,
      principalComment: settings.principalComment || '',
      resumptionDate:   settings.resumptionDate   || null,
      teacherComment:   teacherComment,
      classId:          student.classId,
      termId:           termId
    });
  } catch (err) {
    console.error('[student.portal] GET /report-card:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /portal/timetable (unchanged)
============================================ */
router.get('/portal/timetable', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }
    var student = await SchoolStudent.findOne({ _id: req.studentId, schoolId: req.schoolId })
      .select('classId').lean();
    if (!student || !student.classId) {
      return res.status(404).json({ success: false, message: 'Student class not found.' });
    }
    var [slots, school] = await Promise.all([
      TimetableSlot.find({ schoolId: req.schoolId, classId: student.classId, isActive: true })
        .populate('subjectId', 'name code').populate('teacherId', 'name').sort({ period: 1 }).lean(),
      School.findById(req.schoolId).select('timetablePeriods').lean()
    ]);
    var periods = (school && school.timetablePeriods && school.timetablePeriods.length > 0)
      ? school.timetablePeriods : [];
    var grouped = { monday:[], tuesday:[], wednesday:[], thursday:[], friday:[], saturday:[] };
    slots.forEach(function (slot) {
      if (grouped[slot.day]) {
        grouped[slot.day].push({
          period:      slot.period,
          subjectName: (slot.subjectId && slot.subjectId.name) || slot.subjectName || '',
          teacherName: (slot.teacherId && slot.teacherId.name) || slot.teacherName || '',
          room:        slot.room || '', color: slot.color || '',
          isBreak:     slot.isBreak || false,
          startTime:   slot.startTime || '', endTime: slot.endTime || ''
        });
      }
    });
    return res.json({ success: true, periods: periods, grouped: grouped, total: slots.length });
  } catch (err) {
    console.error('[student.portal] GET /timetable:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /portal/attendance (unchanged)
============================================ */
router.get('/portal/attendance', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }
    var filter = { schoolId: req.schoolId, studentId: req.studentId };
    if (req.query.termId) { filter.termId = req.query.termId; }

    var [totalsAgg, records] = await Promise.all([
      AttendanceRecord.aggregate([
        { $match: filter },
        { $group: {
          _id: null,
          presentCount: { $sum: { $cond: [{ $in: ['$status', ['present','late']] }, 1, 0] } },
          absentCount:  { $sum: { $cond: [{ $eq:  ['$status', 'absent']          }, 1, 0] } },
          lateCount:    { $sum: { $cond: [{ $eq:  ['$status', 'late']            }, 1, 0] } },
          excusedCount: { $sum: { $cond: [{ $eq:  ['$status', 'excused']         }, 1, 0] } },
          total:        { $sum: 1 }
        }}
      ]),
      AttendanceRecord.find(filter).sort({ date: -1, period: 1 }).limit(30).lean()
    ]);
    var t   = totalsAgg.length > 0 ? totalsAgg[0]
      : { presentCount: 0, absentCount: 0, lateCount: 0, excusedCount: 0, total: 0 };
    var pct = t.total > 0 ? Math.round((t.presentCount / t.total) * 100) : 0;
    return res.json({
      success: true,
      totals: { presentCount: t.presentCount, absentCount: t.absentCount,
                lateCount: t.lateCount, excusedCount: t.excusedCount,
                total: t.total, percentage: pct },
      records: records.map(function (r) {
        return { date: r.date, period: r.period || null, status: r.status, notes: r.notes || '' };
      })
    });
  } catch (err) {
    console.error('[student.portal] GET /attendance:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /portal/admin/students/:studentId/set-pin
   ✅ STAGE 4: manageGuard + scope check.
   class_teacher can now set PINs for students
   in their own class. All other management roles
   can set PINs within their scope.
   Admin and senior staff retain full access.
============================================ */
router.put('/portal/admin/students/:studentId/set-pin', manageGuard, async function (req, res) {
  try {
    var pin = req.body && req.body.pin ? String(req.body.pin).trim() : '';
    if (!pin) {
      return res.status(400).json({ success: false, message: 'PIN is required.' });
    }
    if (pin.length < 4 || pin.length > 8) {
      return res.status(400).json({ success: false, message: 'PIN must be 4 to 8 characters.' });
    }

    var student = await SchoolStudent.findOne({
      _id: req.params.studentId, schoolId: req.schoolId
    });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    /* ✅ STAGE 4: scope check — class_teacher can only set PINs for their class */
    if (!isUnrestricted(req.schoolUser)) {
      var scopeErr = verifyStudentScope(
        req.schoolUser,
        student.classId      ? student.classId.toString()      : null,
        student.departmentId ? student.departmentId.toString() : null
      );
      if (scopeErr) {
        return res.status(403).json({ success: false, message: scopeErr });
      }
    }

    var hashed      = await bcrypt.hash(pin, 10);
    student.pinCode = hashed;
    await student.save();

    return res.json({
      success: true,
      message: 'PIN set successfully for ' + student.name + '.'
    });
  } catch (err) {
    console.error('[student.portal] PUT /set-pin:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;