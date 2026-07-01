/* ============================================
   LATLOMP INSTITUTION — ATTENDANCE ROUTES
   ✅ PHASE O: Unified Attendance System

   Mounted at: /api/institution/attendance

   CONFIRMED MODEL REQUIRE PATHS
   (from inst.structure.routes.js — Stage 4 lesson):
     Classes:  '../models/Class.model'   → 'SchoolClass'
     Subjects: '../models/Subject.model' → 'SchoolSubject'

   ENDPOINTS:
   GET  /settings               — get mode + config
   PATCH /settings              — update attendance mode
   POST /mark                   — bulk mark for a class/date(/period)
   GET  /class/:classId/date/:date — attendance roster for a day
   PUT  /record/:id             — edit one record (fix mistake)
   GET  /class/:classId/summary — class summary for a term
   GET  /student/:studentId/summary — student % + history
   GET  /class/:classId/dates   — list of marked dates for history nav

   GUARDS:
   guard      — teacherOrAdmin + subscription
   adminGuard — schoolAdminOnly + subscription
============================================ */
'use strict';

const express          = require('express');
const router           = express.Router();
const AttendanceRecord = require('../models/Attendance.model');
const School           = require('../models/School.model');
const SchoolStudent    = require('../models/SchoolStudent.model');
const SchoolClass      = require('../models/Class.model');          /* CONFIRMED */
const SchoolSubject    = require('../models/Subject.model');         /* CONFIRMED */
const AcademicTerm     = require('../models/AcademicTerm.model');
const TimetableSlot    = require('../models/Timetable.model');

const { instProtect, schoolAdminOnly, teacherOrAdmin } = require('../middleware/inst.auth');
const { requireActiveSubscription }                    = require('../middleware/inst.tenant');

var guard      = [instProtect, teacherOrAdmin,  requireActiveSubscription];
var adminGuard = [instProtect, schoolAdminOnly, requireActiveSubscription];

/* ============================================
   HELPERS
============================================ */

/* Normalize any date string to midnight UTC.
   This prevents timezone drift from causing
   duplicate-record errors when the same calendar
   day is expressed differently by different clients. */
function normalizeDate(dateStr) {
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) { return null; }
  return new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate()
  ));
}

/* Get day-of-week string (monday, tuesday…) from a Date object */
function getDayOfWeek(date) {
  var days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  return days[new Date(date).getUTCDay()];
}

/* Mode-agnostic percentage: present+late over total */
function calcPercent(presentCount, totalCount) {
  if (!totalCount || totalCount === 0) { return 0; }
  return Math.round((presentCount / totalCount) * 100);
}

/* ============================================
   GET /settings
   Returns this school's current attendance mode
   and any threshold configuration.
   Used by teacher page on load to decide which
   UI branch to render.
============================================ */
router.get('/settings', guard, async function (req, res) {
  try {
    var school = await School.findById(req.schoolId)
      .select('attendanceMode settings.timezone')
      .lean();
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found.' });
    }
    return res.json({
      success:        true,
      attendanceMode: school.attendanceMode || 'daily',
      timezone:       (school.settings && school.settings.timezone) || 'Africa/Lagos'
    });
  } catch (err) {
    console.error('[attendance] GET /settings:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PATCH /settings
   Admin updates the school's attendance mode.
   Body: { attendanceMode: 'daily' | 'period' }

   Changing mode does NOT affect historical records.
   Old records with period=null stay valid.
   New records will carry the new mode's period value.
============================================ */
router.patch('/settings', adminGuard, async function (req, res) {
  try {
    var mode = req.body.attendanceMode;
    if (!mode || !['daily', 'period'].includes(mode)) {
      return res.status(400).json({
        success: false,
        message: 'attendanceMode must be "daily" or "period".'
      });
    }

    var school = await School.findByIdAndUpdate(
      req.schoolId,
      { $set: { attendanceMode: mode } },
      { new: true }
    ).select('attendanceMode');

    return res.json({
      success:        true,
      message:        'Attendance mode updated to "' + mode + '".',
      attendanceMode: school.attendanceMode
    });
  } catch (err) {
    console.error('[attendance] PATCH /settings:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /mark
   Bulk mark attendance for one class on one date.

   DAILY MODE body:
   {
     classId:  ObjectId,
     date:     "2026-07-01",
     termId:   ObjectId (optional),
     records:  [
       { studentId: ObjectId, status: "present", notes: "" },
       ...
     ]
   }

   PERIOD MODE body:
   {
     classId:    ObjectId,
     date:       "2026-07-01",
     period:     1,             ← required in period mode
     subjectId:  ObjectId,      ← optional, auto-looked-up from timetable
     termId:     ObjectId (optional),
     records:    [
       { studentId: ObjectId, status: "present", notes: "" },
       ...
     ]
   }

   Uses upsert so re-marking (e.g. fixing a mistake)
   UPDATES existing records rather than duplicating.
============================================ */
router.post('/mark', guard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var body     = req.body || {};

    /* ---- Required fields ---- */
    if (!body.classId) {
      return res.status(400).json({ success: false, message: 'classId is required.' });
    }
    if (!body.date) {
      return res.status(400).json({ success: false, message: 'date is required.' });
    }
    if (!Array.isArray(body.records) || body.records.length === 0) {
      return res.status(400).json({ success: false, message: 'records array is required.' });
    }

    /* ---- Normalize date to midnight UTC ---- */
    var normDate = normalizeDate(body.date);
    if (!normDate) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    /* ---- Verify class belongs to this school ---- */
    var cls = await SchoolClass.findOne({ _id: body.classId, schoolId: schoolId }).select('_id').lean();
    if (!cls) {
      return res.status(404).json({ success: false, message: 'Class not found in your school.' });
    }

    /* ---- Get school's attendance mode ---- */
    var school = await School.findById(schoolId).select('attendanceMode').lean();
    var mode   = (school && school.attendanceMode) || 'daily';

    /* ---- Period mode: validate period is provided ---- */
    var period = null;
    if (mode === 'period') {
      if (!body.period) {
        return res.status(400).json({
          success: false,
          message: 'This school uses period-based attendance. period is required.'
        });
      }
      period = parseInt(body.period);
      if (isNaN(period) || period < 1 || period > 20) {
        return res.status(400).json({ success: false, message: 'period must be a number between 1 and 20.' });
      }
    }

    /* ---- Period mode: auto-lookup subject from timetable ---- */
    var subjectId   = body.subjectId   || null;
    var subjectName = body.subjectName || '';

    if (mode === 'period' && period && !subjectId) {
      var day = getDayOfWeek(normDate);
      var tSlot = await TimetableSlot.findOne({
        schoolId:  schoolId,
        classId:   body.classId,
        day:       day,
        period:    period,
        isActive:  true
      }).populate('subjectId', 'name').lean();

      if (tSlot && tSlot.subjectId) {
        subjectId   = tSlot.subjectId._id;
        subjectName = tSlot.subjectId.name || '';
      }
    }

    /* ---- Bulk upsert ---- */
    var now     = new Date();
    var saved   = 0;
    var failed  = 0;
    var errors  = [];
    var validStatuses = ['present', 'absent', 'late', 'excused'];

    for (var i = 0; i < body.records.length; i++) {
      var record = body.records[i] || {};

      if (!record.studentId) {
        failed++;
        errors.push('Row ' + (i + 1) + ': missing studentId.');
        continue;
      }
      if (!validStatuses.includes(record.status)) {
        failed++;
        errors.push('Row ' + (i + 1) + ': invalid status "' + record.status + '". Use: present, absent, late, excused.');
        continue;
      }

      /* Verify student belongs to this school */
      var student = await SchoolStudent.findOne({
        _id:      record.studentId,
        schoolId: schoolId
      }).select('_id').lean();

      if (!student) {
        failed++;
        errors.push('Row ' + (i + 1) + ': student not found in this school.');
        continue;
      }

      try {
        await AttendanceRecord.findOneAndUpdate(
          {
            schoolId:  schoolId,
            classId:   body.classId,
            studentId: record.studentId,
            date:      normDate,
            period:    period   /* null for daily, number for period mode */
          },
          {
            $set: {
              status:      record.status,
              termId:      body.termId || null,
              subjectId:   subjectId,
              subjectName: subjectName,
              markedBy:    req.schoolUser._id,
              markedAt:    now,
              notes:       String(record.notes || '').trim()
            },
            $setOnInsert: {
              schoolId:  schoolId,
              classId:   body.classId,
              studentId: record.studentId,
              date:      normDate,
              period:    period
            }
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        saved++;
      } catch (e) {
        failed++;
        errors.push('Row ' + (i + 1) + ': ' + e.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: saved + ' record' + (saved !== 1 ? 's' : '') + ' saved, ' + failed + ' failed.',
      saved:   saved,
      failed:  failed,
      errors:  errors.slice(0, 20),
      date:    normDate,
      mode:    mode,
      period:  period
    });
  } catch (err) {
    console.error('[attendance] POST /mark:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /class/:classId/date/:date
   Get the attendance roster for a class on a
   specific date. Returns all students in the
   class with their attendance status (or null
   if not yet marked).

   DAILY MODE:  returns one row per student.
   PERIOD MODE: accepts optional ?period=N query
                param. Returns rows for that period.
                If no period given, returns all
                periods that were marked on that date.
============================================ */
router.get('/class/:classId/date/:date', guard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var classId  = req.params.classId;

    var normDate = normalizeDate(req.params.date);
    if (!normDate) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    var school = await School.findById(schoolId).select('attendanceMode').lean();
    var mode   = (school && school.attendanceMode) || 'daily';

    /* ---- All active students in this class ---- */
    var students = await SchoolStudent.find({
      schoolId: schoolId,
      classId:  classId,
      status:   'active'
    })
      .select('name admissionNo studentId')
      .sort({ name: 1 })
      .lean();

    /* ---- Existing attendance records for this day ---- */
    var query = { schoolId: schoolId, classId: classId, date: normDate };
    var periodFilter = req.query.period ? parseInt(req.query.period) : undefined;
    if (mode === 'period' && periodFilter) {
      query.period = periodFilter;
    } else if (mode === 'daily') {
      query.period = null;
    }

    var records = await AttendanceRecord.find(query)
      .populate('subjectId', 'name')
      .lean();

    /* Map by studentId (+ period for period mode) for O(1) lookup */
    var recordMap = {};
    records.forEach(function (r) {
      var key = r.studentId.toString() + '_' + (r.period || 'null');
      recordMap[key] = r;
    });

    /* ---- Build roster ---- */
    var roster = students.map(function (st) {
      var key    = st._id.toString() + '_' + (periodFilter || 'null');
      var record = recordMap[key] || null;
      return {
        studentId:   st._id,
        name:        st.name,
        admissionNo: st.admissionNo || '',
        studentCode: st.studentId   || '',
        status:      record ? record.status  : null,
        notes:       record ? record.notes   : '',
        recordId:    record ? record._id     : null,
        markedAt:    record ? record.markedAt : null
      };
    });

    /* ---- In period mode, also return timetable context ---- */
    var timetableContext = null;
    if (mode === 'period' && periodFilter) {
      var day   = getDayOfWeek(normDate);
      var tSlot = await TimetableSlot.findOne({
        schoolId: schoolId,
        classId:  classId,
        day:      day,
        period:   periodFilter,
        isActive: true
      })
        .populate('subjectId', 'name')
        .populate('teacherId', 'name')
        .lean();
      if (tSlot) {
        timetableContext = {
          subjectName: (tSlot.subjectId && tSlot.subjectId.name) || tSlot.subjectName || '',
          teacherName: (tSlot.teacherId && tSlot.teacherId.name) || tSlot.teacherName || '',
          room:        tSlot.room || ''
        };
      }
    }

    /* ---- In period mode with no period filter,
       return available periods for this class on this weekday ---- */
    var availablePeriods = null;
    if (mode === 'period' && !periodFilter) {
      var day2 = getDayOfWeek(normDate);
      var daySlots = await TimetableSlot.find({
        schoolId: schoolId,
        classId:  classId,
        day:      day2,
        isActive: true,
        isBreak:  false
      })
        .populate('subjectId', 'name')
        .sort({ period: 1 })
        .lean();

      availablePeriods = daySlots.map(function (s) {
        return {
          period:      s.period,
          subjectName: (s.subjectId && s.subjectId.name) || s.subjectName || '',
          startTime:   s.startTime || '',
          endTime:     s.endTime   || '',
          isMarked:    records.some(function (r) { return r.period === s.period; })
        };
      });
    }

    var isFullyMarked = roster.every(function (r) { return r.status !== null; });

    return res.json({
      success:          true,
      mode:             mode,
      date:             normDate,
      period:           periodFilter || null,
      roster:           roster,
      totalStudents:    students.length,
      isFullyMarked:    isFullyMarked,
      timetableContext: timetableContext,
      availablePeriods: availablePeriods
    });
  } catch (err) {
    console.error('[attendance] GET /class/date:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /record/:id
   Update a single existing attendance record.
   Used by teachers to fix a mistake after marking.
   Body: { status, notes }
============================================ */
router.put('/record/:id', guard, async function (req, res) {
  try {
    var validStatuses = ['present', 'absent', 'late', 'excused'];
    var record = await AttendanceRecord.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId
    });

    if (!record) {
      return res.status(404).json({ success: false, message: 'Attendance record not found.' });
    }

    if (req.body.status !== undefined) {
      if (!validStatuses.includes(req.body.status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status. Use: present, absent, late, excused.'
        });
      }
      record.status = req.body.status;
    }
    if (req.body.notes !== undefined) {
      record.notes = String(req.body.notes || '').trim();
    }
    record.markedBy = req.schoolUser._id;
    record.markedAt = new Date();

    await record.save();

    return res.json({ success: true, message: 'Attendance record updated.', record: record });
  } catch (err) {
    console.error('[attendance] PUT /record/:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /class/:classId/summary
   Class-wide attendance summary for a term.
   Returns per-student present count, total count,
   and percentage. Mode-agnostic — percentage math
   works the same for both daily and period records.

   Query params:
     termId    — filter by term (recommended)
     startDate — custom date range start
     endDate   — custom date range end
============================================ */
router.get('/class/:classId/summary', guard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var classId  = req.params.classId;

    /* Build date range filter */
    var filter = { schoolId: schoolId, classId: classId };
    if (req.query.termId)    { filter.termId = req.query.termId; }
    if (req.query.startDate) {
      filter.date = filter.date || {};
      filter.date.$gte = normalizeDate(req.query.startDate);
    }
    if (req.query.endDate) {
      filter.date = filter.date || {};
      filter.date.$lte = normalizeDate(req.query.endDate);
    }

    /* Total marked sessions (distinct date/period combinations for this class) */
    var pipeline = [
      { $match: filter },
      {
        $group: {
          _id: { date: '$date', period: '$period' }
        }
      },
      { $count: 'totalSessions' }
    ];
    var sessionsAgg = await AttendanceRecord.aggregate(pipeline);
    var totalSessions = sessionsAgg.length > 0 ? sessionsAgg[0].totalSessions : 0;

    /* Per-student summary */
    var studentAgg = await AttendanceRecord.aggregate([
      { $match: filter },
      {
        $group: {
          _id:          '$studentId',
          presentCount: { $sum: { $cond: [{ $in: ['$status', ['present', 'late']] }, 1, 0] } },
          absentCount:  { $sum: { $cond: [{ $eq:  ['$status', 'absent']           }, 1, 0] } },
          lateCount:    { $sum: { $cond: [{ $eq:  ['$status', 'late']             }, 1, 0] } },
          excusedCount: { $sum: { $cond: [{ $eq:  ['$status', 'excused']          }, 1, 0] } },
          totalMarked:  { $sum: 1 }
        }
      }
    ]);

    /* Get student names */
    var studentIds = studentAgg.map(function (s) { return s._id; });
    var students   = await SchoolStudent.find({
      _id:      { $in: studentIds },
      schoolId: schoolId
    }).select('name admissionNo studentId').lean();

    var nameMap = {};
    students.forEach(function (s) { nameMap[s._id.toString()] = s; });

    var summary = studentAgg.map(function (s) {
      var info = nameMap[s._id.toString()] || {};
      return {
        studentId:    s._id,
        name:         info.name        || 'Unknown',
        admissionNo:  info.admissionNo || '',
        studentCode:  info.studentId   || '',
        presentCount: s.presentCount,
        absentCount:  s.absentCount,
        lateCount:    s.lateCount,
        excusedCount: s.excusedCount,
        totalMarked:  s.totalMarked,
        totalSessions: totalSessions,
        percentage:   calcPercent(s.presentCount, totalSessions)
      };
    });

    /* Sort by name */
    summary.sort(function (a, b) { return a.name.localeCompare(b.name); });

    return res.json({
      success:       true,
      totalSessions: totalSessions,
      studentCount:  summary.length,
      summary:       summary
    });
  } catch (err) {
    console.error('[attendance] GET /class/summary:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /student/:studentId/summary
   Full attendance history + summary for ONE student.
   Mode-agnostic percentage calculation.
   Used by admin reports, parent portal (Phase Q).

   Query params:
     termId    — filter by term
     startDate — date range
     endDate   — date range
============================================ */
router.get('/student/:studentId/summary', guard, async function (req, res) {
  try {
    var schoolId  = req.schoolId;
    var studentId = req.params.studentId;

    var student = await SchoolStudent.findOne({
      _id: studentId, schoolId: schoolId
    }).select('name admissionNo studentId classId').lean();

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    var filter = { schoolId: schoolId, studentId: studentId };
    if (req.query.termId)    { filter.termId = req.query.termId; }
    if (req.query.startDate) {
      filter.date = filter.date || {};
      filter.date.$gte = normalizeDate(req.query.startDate);
    }
    if (req.query.endDate) {
      filter.date = filter.date || {};
      filter.date.$lte = normalizeDate(req.query.endDate);
    }

    /* Recent records (last 60) */
    var records = await AttendanceRecord.find(filter)
      .populate('subjectId', 'name')
      .populate('classId',   'name')
      .sort({ date: -1, period: 1 })
      .limit(60)
      .lean();

    /* Totals */
    var totalsAgg = await AttendanceRecord.aggregate([
      { $match: filter },
      {
        $group: {
          _id:          null,
          presentCount: { $sum: { $cond: [{ $in: ['$status', ['present','late']] }, 1, 0] } },
          absentCount:  { $sum: { $cond: [{ $eq:  ['$status', 'absent']          }, 1, 0] } },
          lateCount:    { $sum: { $cond: [{ $eq:  ['$status', 'late']            }, 1, 0] } },
          excusedCount: { $sum: { $cond: [{ $eq:  ['$status', 'excused']         }, 1, 0] } },
          total:        { $sum: 1 }
        }
      }
    ]);

    var totals = totalsAgg.length > 0 ? totalsAgg[0] : {
      presentCount: 0, absentCount: 0,
      lateCount: 0, excusedCount: 0, total: 0
    };

    return res.json({
      success: true,
      student: {
        _id:         student._id,
        name:        student.name,
        admissionNo: student.admissionNo || '',
        studentCode: student.studentId   || '',
        classId:     student.classId
      },
      totals: {
        presentCount: totals.presentCount,
        absentCount:  totals.absentCount,
        lateCount:    totals.lateCount,
        excusedCount: totals.excusedCount,
        total:        totals.total,
        percentage:   calcPercent(totals.presentCount, totals.total)
      },
      records: records.map(function (r) {
        return {
          _id:         r._id,
          date:        r.date,
          period:      r.period,
          subjectName: (r.subjectId && r.subjectId.name) || r.subjectName || '',
          className:   (r.classId   && r.classId.name)   || '',
          status:      r.status,
          notes:       r.notes || '',
          markedAt:    r.markedAt
        };
      })
    });
  } catch (err) {
    console.error('[attendance] GET /student/summary:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /class/:classId/dates
   Returns all distinct dates (and periods in
   period mode) that have been marked for this
   class. Used by the teacher UI to show a
   "history" calendar — which days have been
   marked so the teacher can review or edit.

   Query params: termId (optional filter)
============================================ */
router.get('/class/:classId/dates', guard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var classId  = req.params.classId;

    var filter = { schoolId: schoolId, classId: classId };
    if (req.query.termId) { filter.termId = req.query.termId; }

    var school = await School.findById(schoolId).select('attendanceMode').lean();
    var mode   = (school && school.attendanceMode) || 'daily';

    var agg = await AttendanceRecord.aggregate([
      { $match: filter },
      {
        $group: {
          _id:          { date: '$date', period: '$period' },
          studentCount: { $sum: 1 },
          presentCount: { $sum: { $cond: [{ $in: ['$status', ['present','late']] }, 1, 0] } }
        }
      },
      { $sort: { '_id.date': -1, '_id.period': 1 } },
      { $limit: 90 }
    ]);

    var dates = agg.map(function (a) {
      return {
        date:         a._id.date,
        period:       a._id.period,
        studentCount: a.studentCount,
        presentCount: a.presentCount
      };
    });

    return res.json({ success: true, mode: mode, dates: dates });
  } catch (err) {
    console.error('[attendance] GET /class/dates:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;