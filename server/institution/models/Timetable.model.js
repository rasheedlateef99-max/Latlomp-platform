/* ============================================
   LATLOMP INSTITUTION — TIMETABLE MODEL
   ✅ PHASE N: Timetable System

   One record per class × day × period.
   The unique compound index enforces that no
   class can have two subjects in the same period
   on the same day.

   Teacher conflict detection is handled in the
   routes layer (not enforced by a unique index
   because the same teacher being in two places
   is a query-time check, not a document constraint).

   isBreak = true means the slot is a break or
   lunch period — no subject or teacher needed.
============================================ */
'use strict';

const mongoose = require('mongoose');

const timetableSlotSchema = new mongoose.Schema(
  {
    /* ---- Tenant isolation ---- */
    schoolId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'School',
      required: true
    },

    /* ---- What class is this slot for ---- */
    classId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'SchoolClass',
      required: true
    },

    /* ---- Optional term context ---- */
    termId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'AcademicTerm',
      default: null
    },

    /* ---- When: day of the week ---- */
    day: {
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
      required: true
    },

    /* ---- When: period number (1 = first period) ---- */
    period: {
      type:     Number,
      required: true,
      min:      1,
      max:      20
    },

    /* ---- When: human-readable times (optional) ---- */
    startTime: { type: String, default: '' },  /* e.g. "08:00" */
    endTime:   { type: String, default: '' },  /* e.g. "08:45" */

    /* ---- What: subject ---- */
    subjectId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'SchoolSubject',
      default: null
    },
    /* Denormalized for fast read without populate */
    subjectName: { type: String, default: '' },

    /* ---- Who: teacher ---- */
    teacherId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'SchoolUser',
      default: null
    },
    /* Denormalized for fast read without populate */
    teacherName: { type: String, default: '' },

    /* ---- Where: room ---- */
    room: { type: String, default: '' },

    /* ---- Visual ---- */
    color: { type: String, default: '' },
    /* e.g. "#6c63ff" — set per subject for colour-coded grid */

    /* ---- Meta ---- */
    notes:   { type: String, default: '' },
    isBreak: { type: Boolean, default: false },
    /* isBreak = true → lunch/break slot, no subject/teacher required */

    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

/* ---- Indexes ---- */

/* Primary constraint: one slot per class per day per period */
timetableSlotSchema.index(
  { schoolId: 1, classId: 1, day: 1, period: 1 },
  { unique: true }
);

/* Fast class timetable lookup */
timetableSlotSchema.index({ schoolId: 1, classId: 1 });

/* Fast teacher schedule lookup */
timetableSlotSchema.index({ schoolId: 1, teacherId: 1 });

/* Term-scoped queries */
timetableSlotSchema.index({ schoolId: 1, termId: 1 });

module.exports = mongoose.model('TimetableSlot', timetableSlotSchema);