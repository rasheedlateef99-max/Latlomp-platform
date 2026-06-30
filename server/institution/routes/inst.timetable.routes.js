/* ============================================
   LATLOMP INSTITUTION — TIMETABLE ROUTES
   ✅ PHASE N: Timetable System
   ✅ STAGE 3: Added public endpoint for the
      no-login class timetable page.

   Mounted at: /api/institution/timetable

   ROUTE ORDER IS INTENTIONAL:
   Named paths (/class/:id, /teacher/:id,
   /summary, /periods, /public/:slug/:classId,
   /class/:id/clear) must be defined BEFORE the
   generic /:id route.

   ENDPOINTS:
   GET  /public/:slug/:classId  Public class timetable (NO AUTH)
   GET  /class/:classId         Class timetable (auth)
   GET  /teacher/:teacherId     Teacher schedule (auth)
   GET  /summary                All classes summary (admin)
   GET  /periods                School period config (auth)
   POST /periods                Save period config (admin)
   POST /                       Create slot (admin)
   PUT  /:id                    Update slot (admin)
   DELETE /class/:classId/clear Clear all slots for class (admin)
   DELETE /:id                  Delete one slot (admin)

   GUARDS:
   readGuard  — teacherOrAdmin + subscription
   adminGuard — schoolAdminOnly + subscription
   public route — no guard, validated by school slug
============================================ */
'use strict';

const express        = require('express');
const router         = express.Router();
const TimetableSlot  = require('../models/Timetable.model');
const SchoolUser     = require('../models/SchoolUser.model');
const School         = require('../models/School.model');
const SchoolClass    = require('../models/Class.model');

const { instProtect, schoolAdminOnly, teacherOrAdmin } = require('../middleware/inst.auth');
const { requireActiveSubscription }                    = require('../middleware/inst.tenant');

var readGuard  = [instProtect, teacherOrAdmin,  requireActiveSubscription];
var adminGuard = [instProtect, schoolAdminOnly, requireActiveSubscription];

/* ============================================
   HELPERS
============================================ */

var DAY_ORDER = { monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };

function buildSlotPayload(body) {
  var payload = {};
  if (body.day        !== undefined) payload.day        = String(body.day).toLowerCase().trim();
  if (body.period     !== undefined) payload.period      = parseInt(body.period);
  if (body.startTime  !== undefined) payload.startTime   = String(body.startTime  || '').trim();
  if (body.endTime    !== undefined) payload.endTime     = String(body.endTime    || '').trim();
  if (body.subjectId  !== undefined) payload.subjectId   = body.subjectId  || null;
  if (body.subjectName!== undefined) payload.subjectName = String(body.subjectName || '').trim();
  if (body.teacherId  !== undefined) payload.teacherId   = body.teacherId  || null;
  if (body.teacherName!== undefined) payload.teacherName = String(body.teacherName || '').trim();
  if (body.room       !== undefined) payload.room        = String(body.room       || '').trim();
  if (body.color      !== undefined) payload.color       = String(body.color      || '').trim();
  if (body.notes      !== undefined) payload.notes       = String(body.notes      || '').trim();
  if (body.isBreak    !== undefined) payload.isBreak     = !!body.isBreak;
  if (body.termId     !== undefined) payload.termId      = body.termId || null;
  return payload;
}

async function checkTeacherConflict(schoolId, teacherId, day, period, excludeSlotId) {
  if (!teacherId) { return null; }
  var query = { schoolId: schoolId, teacherId: teacherId, day: day, period: period };
  if (excludeSlotId) { query._id = { $ne: excludeSlotId }; }
  var conflict = await TimetableSlot.findOne(query).populate('classId', 'name').lean();
  return conflict || null;
}

function getDefaultPeriods() {
  return [
    { period: 1,  label: 'Period 1',  startTime: '08:00', endTime: '08:45' },
    { period: 2,  label: 'Period 2',  startTime: '08:45', endTime: '09:30' },
    { period: 3,  label: 'Period 3',  startTime: '09:30', endTime: '10:15' },
    { period: 4,  label: 'Break',     startTime: '10:15', endTime: '10:30', isBreak: true },
    { period: 5,  label: 'Period 4',  startTime: '10:30', endTime: '11:15' },
    { period: 6,  label: 'Period 5',  startTime: '11:15', endTime: '12:00' },
    { period: 7,  label: 'Lunch',     startTime: '12:00', endTime: '13:00', isBreak: true },
    { period: 8,  label: 'Period 6',  startTime: '13:00', endTime: '13:45' },
    { period: 9,  label: 'Period 7',  startTime: '13:45', endTime: '14:30' },
    { period: 10, label: 'Period 8',  startTime: '14:30', endTime: '15:15' }
  ];
}

/* ============================================
   ✅ STAGE 3: GET /public/:slug/:classId
   NO AUTH. Used by the public class timetable
   page (no login required).
   Resolves school by slug first — this is the
   same slug mechanism used for Phase E branded
   access links. Only non-sensitive fields are
   returned (subject, teacher name, room, time).
   ⚠ Must be before /class/:classId and /:id
============================================ */
router.get('/public/:slug/:classId', async function (req, res) {
  try {
    var slug    = req.params.slug;
    var classId = req.params.classId;

    var school = await School.findOne({ slug: slug }).select('_id name logo primaryColor').lean();
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found.' });
    }

    var cls = await SchoolClass.findOne({ _id: classId, schoolId: school._id }).select('name').lean();
    if (!cls) {
      return res.status(404).json({ success: false, message: 'Class not found.' });
    }

    var slots = await TimetableSlot.find({
      schoolId: school._id,
      classId:  classId,
      isActive: true
    })
      .populate('subjectId', 'name code')
      .populate('teacherId', 'name')
      .sort({ period: 1 })
      .lean();

    var periods = (await School.findById(school._id).select('timetablePeriods').lean());
    var periodList = (periods && periods.timetablePeriods && periods.timetablePeriods.length > 0)
      ? periods.timetablePeriods
      : getDefaultPeriods();

    var grouped = { monday:[], tuesday:[], wednesday:[], thursday:[], friday:[], saturday:[] };
    slots.forEach(function (slot) {
      if (grouped[slot.day]) {
        grouped[slot.day].push({
          period:      slot.period,
          subjectName: (slot.subjectId && slot.subjectId.name) || slot.subjectName || '',
          teacherName: (slot.teacherId && slot.teacherId.name) || slot.teacherName || '',
          room:        slot.room || '',
          color:       slot.color || '',
          isBreak:     slot.isBreak || false
        });
      }
    });

    return res.json({
      success:  true,
      school:   { name: school.name, logo: school.logo, primaryColor: school.primaryColor },
      class:    { name: cls.name },
      periods:  periodList,
      grouped:  grouped,
      total:    slots.length
    });
  } catch (err) {
    console.error('[timetable] GET /public:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load timetable.' });
  }
});

/* ============================================
   1. GET /class/:classId  (authenticated)
============================================ */
router.get('/class/:classId', readGuard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var classId  = req.params.classId;

    var slots = await TimetableSlot.find({
      schoolId: schoolId,
      classId:  classId,
      isActive: true
    })
      .populate('subjectId', 'name code color')
      .populate('teacherId', 'name')
      .sort({ period: 1 })
      .lean();

    var grouped = { monday:[], tuesday:[], wednesday:[], thursday:[], friday:[], saturday:[] };
    slots.forEach(function (slot) {
      if (grouped[slot.day]) { grouped[slot.day].push(slot); }
    });

    return res.json({ success: true, slots: slots, grouped: grouped, total: slots.length });
  } catch (err) {
    console.error('[timetable] GET /class:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   2. GET /teacher/:teacherId
============================================ */
router.get('/teacher/:teacherId', readGuard, async function (req, res) {
  try {
    var schoolId  = req.schoolId;
    var teacherId = req.params.teacherId;

    var slots = await TimetableSlot.find({
      schoolId:  schoolId,
      teacherId: teacherId,
      isActive:  true
    })
      .populate('classId',  'name category')
      .populate('subjectId', 'name code')
      .sort({ period: 1 })
      .lean();

    slots.sort(function (a, b) {
      var dayDiff = (DAY_ORDER[a.day] || 0) - (DAY_ORDER[b.day] || 0);
      return dayDiff !== 0 ? dayDiff : (a.period - b.period);
    });

    var grouped = { monday:[], tuesday:[], wednesday:[], thursday:[], friday:[], saturday:[] };
    slots.forEach(function (slot) {
      if (grouped[slot.day]) { grouped[slot.day].push(slot); }
    });

    return res.json({ success: true, slots: slots, grouped: grouped, total: slots.length });
  } catch (err) {
    console.error('[timetable] GET /teacher:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   3. GET /summary
============================================ */
router.get('/summary', adminGuard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var agg = await TimetableSlot.aggregate([
      { $match: { schoolId: schoolId, isActive: true } },
      {
        $group: {
          _id:        '$classId',
          slotCount:  { $sum: 1 },
          hasTeacher: { $sum: { $cond: [{ $ifNull: ['$teacherId', false] }, 1, 0] } }
        }
      }
    ]);
    return res.json({ success: true, summary: agg });
  } catch (err) {
    console.error('[timetable] GET /summary:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   4. GET /periods
============================================ */
router.get('/periods', readGuard, async function (req, res) {
  try {
    var school = await School.findById(req.schoolId).select('timetablePeriods').lean();
    var periods = (school && school.timetablePeriods && school.timetablePeriods.length > 0)
      ? school.timetablePeriods
      : getDefaultPeriods();
    return res.json({ success: true, periods: periods });
  } catch (err) {
    console.error('[timetable] GET /periods:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   5. POST /periods
============================================ */
router.post('/periods', adminGuard, async function (req, res) {
  try {
    var periods = req.body.periods;
    if (!Array.isArray(periods) || periods.length === 0) {
      return res.status(400).json({ success: false, message: 'periods array is required.' });
    }
    await School.findByIdAndUpdate(req.schoolId, { $set: { timetablePeriods: periods } });
    return res.json({ success: true, message: 'Period times saved.', periods: periods });
  } catch (err) {
    console.error('[timetable] POST /periods:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   6. DELETE /class/:classId/clear
============================================ */
router.delete('/class/:classId/clear', adminGuard, async function (req, res) {
  try {
    var result = await TimetableSlot.deleteMany({ schoolId: req.schoolId, classId: req.params.classId });
    return res.json({
      success: true,
      message: result.deletedCount + ' slot' + (result.deletedCount !== 1 ? 's' : '') + ' cleared.',
      deleted: result.deletedCount
    });
  } catch (err) {
    console.error('[timetable] DELETE /clear:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   7. POST /
============================================ */
router.post('/', adminGuard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var body     = req.body || {};

    if (!body.classId) { return res.status(400).json({ success: false, message: 'classId is required.' }); }
    if (!body.day)     { return res.status(400).json({ success: false, message: 'day is required.' }); }
    if (!body.period)  { return res.status(400).json({ success: false, message: 'period is required.' }); }

    var day    = String(body.day).toLowerCase().trim();
    var period = parseInt(body.period);

    if (!DAY_ORDER[day]) {
      return res.status(400).json({ success: false, message: 'Invalid day.' });
    }

    if (body.teacherId) {
      var conflict = await checkTeacherConflict(schoolId, body.teacherId, day, period, null);
      if (conflict) {
        var conflictClass = conflict.classId ? conflict.classId.name : 'another class';
        return res.status(409).json({
          success:  false,
          code:     'TEACHER_CONFLICT',
          message:  'This teacher already has ' + conflict.subjectName + ' with ' + conflictClass + ' at this time. Please choose a different period or teacher.',
          conflict: { day: conflict.day, period: conflict.period, className: conflictClass, subjectName: conflict.subjectName }
        });
      }
    }

    var payload      = buildSlotPayload(body);
    payload.schoolId = schoolId;
    payload.classId  = body.classId;

    var slot = await TimetableSlot.create(payload);
    await slot.populate('classId',   'name');
    await slot.populate('subjectId', 'name code');
    await slot.populate('teacherId', 'name');

    return res.status(201).json({ success: true, message: 'Slot created.', slot: slot });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false, code: 'SLOT_EXISTS',
        message: 'This class already has a subject scheduled at that day and period. Edit the existing slot instead.'
      });
    }
    console.error('[timetable] POST /:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   8. PUT /:id
============================================ */
router.put('/:id', adminGuard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var slotId   = req.params.id;
    var body     = req.body || {};

    var existing = await TimetableSlot.findOne({ _id: slotId, schoolId: schoolId });
    if (!existing) { return res.status(404).json({ success: false, message: 'Slot not found.' }); }

    var finalDay     = body.day    ? String(body.day).toLowerCase().trim() : existing.day;
    var finalPeriod  = body.period ? parseInt(body.period)                 : existing.period;
    var finalTeacher = body.teacherId !== undefined ? body.teacherId : existing.teacherId;

    if (body.day && !DAY_ORDER[finalDay]) {
      return res.status(400).json({ success: false, message: 'Invalid day.' });
    }

    if (finalTeacher) {
      var conflict = await checkTeacherConflict(schoolId, finalTeacher, finalDay, finalPeriod, slotId);
      if (conflict) {
        var conflictClass = conflict.classId ? conflict.classId.name : 'another class';
        return res.status(409).json({
          success:  false,
          code:     'TEACHER_CONFLICT',
          message:  'This teacher already has ' + conflict.subjectName + ' with ' + conflictClass + ' at this time.',
          conflict: { day: conflict.day, period: conflict.period, className: conflictClass, subjectName: conflict.subjectName }
        });
      }
    }

    var updates = buildSlotPayload(body);
    Object.assign(existing, updates);
    await existing.save();

    await existing.populate('classId',   'name');
    await existing.populate('subjectId', 'name code');
    await existing.populate('teacherId', 'name');

    return res.json({ success: true, message: 'Slot updated.', slot: existing });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, code: 'SLOT_EXISTS', message: 'Another slot already exists at that day and period for this class.' });
    }
    console.error('[timetable] PUT /:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   9. DELETE /:id
============================================ */
router.delete('/:id', adminGuard, async function (req, res) {
  try {
    var slot = await TimetableSlot.findOneAndDelete({ _id: req.params.id, schoolId: req.schoolId });
    if (!slot) { return res.status(404).json({ success: false, message: 'Slot not found.' }); }
    return res.json({ success: true, message: 'Slot deleted.' });
  } catch (err) {
    console.error('[timetable] DELETE /:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;