/* ============================================
   LATLOMP INSTITUTION — STUDENT PORTAL ROUTES
   ✅ PHASE P: Student Authenticated Portal

   Mounted at: /api/institution/student-portal

   STUDENT AUTH:
   Uses the same JWT_SECRET as inst.auth.js but
   a different payload shape:
     Institution tokens: { schoolUserId, schoolId }
     Student tokens:     { studentId, schoolId, role:'student' }
   instProtect rejects student tokens (no schoolUserId).
   studentProtect rejects institution tokens (role check).

   ENDPOINTS:
   POST /portal/login                          — no auth
   GET  /portal/me                             — studentProtect
   GET  /portal/terms                          — studentProtect
   GET  /portal/scores                         — studentProtect
   GET  /portal/report-card                    — studentProtect
   GET  /portal/timetable                      — studentProtect
   GET  /portal/attendance                     — studentProtect
   PUT  /portal/admin/students/:id/set-pin     — adminGuard

   All student endpoints check school subscription inline
   because instProtect (and requireActiveSubscription) is
   not used for student routes.
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

/* Confirmed require paths from inst.structure.routes.js */
const SchoolClass         = require('../models/Class.model');

const { instProtect, schoolAdminOnly } = require('../middleware/inst.auth');
const { requireActiveSubscription }    = require('../middleware/inst.tenant');

var adminGuard = [instProtect, schoolAdminOnly, requireActiveSubscription];

/* ============================================
   STUDENT JWT HELPERS
   Mirrors signInstToken from inst.auth.js but
   uses studentId and role:'student' payload.
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

    /* Reject any token that is not explicitly a student token */
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

/* ============================================
   SUBSCRIPTION CHECK (inline — student routes
   do not go through instProtect so the
   requireActiveSubscription middleware cannot
   extract req.schoolUser.schoolId as normal)
============================================ */
async function subscriptionActive(schoolId) {
  var school = await School.findById(schoolId);
  return school && school.isSubscriptionActive;
}

/* ============================================
   POST /portal/login
   No auth required.
   Body: { schoolSlug, admissionNo OR studentCode, pin }
   Returns: student JWT + profile + school branding
============================================ */
router.post('/portal/login', async function (req, res) {
  try {
    var body         = req.body || {};
    var schoolSlug   = body.schoolSlug;
    var admissionNo  = body.admissionNo  ? String(body.admissionNo).trim()  : '';
    var studentCode  = body.studentCode  ? String(body.studentCode).trim()  : '';
    var pin          = body.pin          ? String(body.pin).trim()          : '';

    if (!schoolSlug) {
      return res.status(400).json({ success: false, message: 'School identifier is required.' });
    }
    if (!admissionNo && !studentCode) {
      return res.status(400).json({ success: false, message: 'Admission number or student ID is required.' });
    }
    if (!pin) {
      return res.status(400).json({ success: false, message: 'PIN is required.' });
    }

    /* Find school by slug */
    var school = await School.findOne({ slug: schoolSlug.trim() });
    if (!school) {
      return res.status(404).json({
        success: false,
        message: 'School not found. Please check your login link.'
      });
    }

    /* Check subscription */
    if (!school.isSubscriptionActive) {
      return res.status(403).json({
        success: false,
        message: 'Your school subscription is not active. Contact your school administrator.'
      });
    }

    /* Find active student by admissionNo or studentId */
    var studentQuery = { schoolId: school._id, status: 'active' };
    if (admissionNo) {
      studentQuery.admissionNo = admissionNo;
    } else {
      studentQuery.studentId = studentCode;
    }

    var student = await SchoolStudent.findOne(studentQuery)
      .populate('classId', 'name');
    if (!student) {
      return res.status(401).json({
        success: false,
        message: 'Student not found or account is inactive. Check your details or contact your school.'
      });
    }

    /* PIN check */
    if (!student.pinCode) {
      return res.status(401).json({
        success: false,
        message: 'No PIN has been set for this account. Please contact your school administrator.'
      });
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
   GET /portal/me
   Returns student profile + school branding.
   Used on every portal page load.
============================================ */
router.get('/portal/me', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }

    var [student, school] = await Promise.all([
      SchoolStudent.findOne({ _id: req.studentId, schoolId: req.schoolId })
        .populate('classId', 'name')
        .lean(),
      School.findById(req.schoolId)
        .select('name logo primaryColor address state attendanceMode')
        .lean()
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
   GET /portal/terms
   All terms for this school.
   Used by portal term selector.
============================================ */
router.get('/portal/terms', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }
    var terms = await AcademicTerm.find({ schoolId: req.schoolId, isActive: true })
      .sort({ session: -1, term: 1 })
      .select('name session term isCurrent')
      .lean();
    return res.json({ success: true, terms: terms });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /portal/scores
   Returns released subject scores for this student.
   A score is visible ONLY when its ScoreSubmission
   is both approved AND releasedToStudents === true.
   Query param: ?termId=xxx (defaults to current term)
============================================ */
router.get('/portal/scores', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }

    var student = await SchoolStudent.findOne({
      _id: req.studentId, schoolId: req.schoolId
    }).select('classId').lean();

    if (!student || !student.classId) {
      return res.status(404).json({ success: false, message: 'Student class not found.' });
    }

    /* Resolve termId */
    var termId = req.query.termId || null;
    if (!termId) {
      var currentTerm = await AcademicTerm.findOne({
        schoolId: req.schoolId, isCurrent: true
      }).lean();
      if (currentTerm) { termId = currentTerm._id; }
    }

    /* Find which subjects have been RELEASED for this class/term */
    var subFilter = {
      schoolId:           req.schoolId,
      classId:            student.classId,
      status:             'approved',
      releasedToStudents: true
    };
    if (termId) { subFilter.termId = termId; }

    var releasedSubs = await ScoreSubmission.find(subFilter)
      .select('subjectId')
      .lean();

    if (releasedSubs.length === 0) {
      return res.json({
        success: true,
        termId:  termId,
        scores:  [],
        message: 'No scores have been released yet.'
      });
    }

    var releasedSubjectIds = releasedSubs.map(function (s) {
      return s.subjectId;
    });

    /* Fetch scores only for released subjects */
    var scoreFilter = {
      schoolId:  req.schoolId,
      studentId: req.studentId,
      subjectId: { $in: releasedSubjectIds }
    };
    if (termId) { scoreFilter.termId = termId; }

    var scores = await SchoolScore.find(scoreFilter)
      .populate('subjectId', 'name code')
      .populate('termId',    'name session')
      .sort({ 'subjectId.name': 1 })
      .lean();

    return res.json({
      success: true,
      termId:  termId,
      scores:  scores.map(function (s) {
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
   GET /portal/report-card
   Returns report card meta (settings) if released.
   The portal frontend fetches score details
   separately via /portal/scores.
   Query param: ?termId=xxx (defaults to current term)
============================================ */
router.get('/portal/report-card', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }

    var student = await SchoolStudent.findOne({
      _id: req.studentId, schoolId: req.schoolId
    }).select('classId name admissionNo studentId gender dateOfBirth').lean();

    if (!student || !student.classId) {
      return res.status(404).json({ success: false, message: 'Student or class not found.' });
    }

    var termId = req.query.termId || null;
    if (!termId) {
      var currentTerm = await AcademicTerm.findOne({
        schoolId: req.schoolId, isCurrent: true
      }).lean();
      if (currentTerm) { termId = currentTerm._id; }
    }
    if (!termId) {
      return res.json({ success: true, released: false, message: 'No current term found.' });
    }

    var term = await AcademicTerm.findById(termId).select('name session term').lean();

    /* Check ReportCardSettings release flag */
    var settings = await ReportCardSettings.findOne({
      schoolId: req.schoolId,
      classId:  student.classId,
      termId:   termId
    }).lean();

    if (!settings || !settings.isReleased) {
      return res.json({
        success:  true,
        released: false,
        message:  'Your report card has not been released yet. Please check back later.'
      });
    }

    /* Get teacher comment for this student */
    var teacherComment = '';
    if (settings.studentComments) {
      var sid = req.studentId.toString();
      teacherComment = (typeof settings.studentComments.get === 'function')
        ? (settings.studentComments.get(sid) || '')
        : (settings.studentComments[sid]     || '');
    }

    return res.json({
      success:          true,
      released:         true,
      term:             term,
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
   GET /portal/timetable
   Returns the student's class timetable.
   Always visible — no release gate needed.
============================================ */
router.get('/portal/timetable', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }

    var student = await SchoolStudent.findOne({
      _id: req.studentId, schoolId: req.schoolId
    }).select('classId').lean();

    if (!student || !student.classId) {
      return res.status(404).json({ success: false, message: 'Student class not found.' });
    }

    var [slots, school] = await Promise.all([
      TimetableSlot.find({
        schoolId: req.schoolId,
        classId:  student.classId,
        isActive: true
      })
        .populate('subjectId', 'name code')
        .populate('teacherId', 'name')
        .sort({ period: 1 })
        .lean(),
      School.findById(req.schoolId)
        .select('timetablePeriods')
        .lean()
    ]);

    var periods = (school && school.timetablePeriods && school.timetablePeriods.length > 0)
      ? school.timetablePeriods
      : [];

    var grouped = {
      monday:[], tuesday:[], wednesday:[], thursday:[], friday:[], saturday:[]
    };
    slots.forEach(function (slot) {
      if (grouped[slot.day]) {
        grouped[slot.day].push({
          period:      slot.period,
          subjectName: (slot.subjectId && slot.subjectId.name) || slot.subjectName || '',
          teacherName: (slot.teacherId && slot.teacherId.name) || slot.teacherName || '',
          room:        slot.room      || '',
          color:       slot.color     || '',
          isBreak:     slot.isBreak   || false,
          startTime:   slot.startTime || '',
          endTime:     slot.endTime   || ''
        });
      }
    });

    return res.json({
      success: true,
      periods: periods,
      grouped: grouped,
      total:   slots.length
    });
  } catch (err) {
    console.error('[student.portal] GET /timetable:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /portal/attendance
   Returns the student's own attendance summary.
   Query param: ?termId=xxx
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
        {
          $group: {
            _id:          null,
            presentCount: { $sum: { $cond: [{ $in: ['$status', ['present','late']] }, 1, 0] } },
            absentCount:  { $sum: { $cond: [{ $eq:  ['$status', 'absent']           }, 1, 0] } },
            lateCount:    { $sum: { $cond: [{ $eq:  ['$status', 'late']             }, 1, 0] } },
            excusedCount: { $sum: { $cond: [{ $eq:  ['$status', 'excused']          }, 1, 0] } },
            total:        { $sum: 1 }
          }
        }
      ]),
      AttendanceRecord.find(filter)
        .sort({ date: -1, period: 1 })
        .limit(30)
        .lean()
    ]);

    var t   = totalsAgg.length > 0 ? totalsAgg[0] : {
      presentCount: 0, absentCount: 0, lateCount: 0, excusedCount: 0, total: 0
    };
    var pct = t.total > 0 ? Math.round((t.presentCount / t.total) * 100) : 0;

    return res.json({
      success: true,
      totals: {
        presentCount: t.presentCount,
        absentCount:  t.absentCount,
        lateCount:    t.lateCount,
        excusedCount: t.excusedCount,
        total:        t.total,
        percentage:   pct
      },
      records: records.map(function (r) {
        return {
          date:   r.date,
          period: r.period || null,
          status: r.status,
          notes:  r.notes || ''
        };
      })
    });
  } catch (err) {
    console.error('[student.portal] GET /attendance:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /portal/admin/students/:studentId/set-pin
   School admin sets a PIN for a student.
   PIN is hashed with bcrypt before storage.
   Body: { pin: '1234' }
   Constraint: PIN must be 4–8 characters.
============================================ */
router.put('/portal/admin/students/:studentId/set-pin', adminGuard, async function (req, res) {
  try {
    var pin = req.body && req.body.pin ? String(req.body.pin).trim() : '';
    if (!pin) {
      return res.status(400).json({ success: false, message: 'PIN is required.' });
    }
    if (pin.length < 4 || pin.length > 8) {
      return res.status(400).json({ success: false, message: 'PIN must be 4 to 8 characters.' });
    }

    var student = await SchoolStudent.findOne({
      _id:      req.params.studentId,
      schoolId: req.schoolId
    });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
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