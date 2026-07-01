/* ============================================
   LATLOMP INSTITUTION — ATTENDANCE MODEL
   ✅ PHASE O: Unified Attendance System

   ONE model serves BOTH attendance modes:

   DAILY MODE  (school.attendanceMode = 'daily'):
     period field = null
     One record per student per class per day.
     Unique index naturally enforces this because
     (schoolId, classId, studentId, date, null)
     is a unique combination.

   PERIOD MODE (school.attendanceMode = 'period'):
     period field = 1, 2, 3 ... (matches the
     period numbers used in Timetable.model.js)
     One record per student per class per period
     per day.
     Unique index enforces this because
     (schoolId, classId, studentId, date, 1) and
     (schoolId, classId, studentId, date, 2) are
     treated as separate unique combinations.

   DATE STORAGE:
     All dates stored as midnight UTC, normalized
     server-side before every save. This prevents
     timezone drift from creating duplicate records
     when teachers in different UTC offsets mark
     attendance for the same calendar day.

   COMPATIBILITY:
     A school switching from daily → period (or
     back) does NOT invalidate historical records.
     Old daily records have period=null; new period
     records have period=number. Both coexist in
     the same collection without conflict.
     Percentage calculation uses count-based math
     that is mode-agnostic.
============================================ */
'use strict';

const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
  {
    /* ---- Tenant isolation ---- */
    schoolId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'School',
      required: true
    },

    /* ---- Which class ---- */
    classId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'SchoolClass',
      required: true
    },

    /* ---- Which student ---- */
    studentId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'SchoolStudent',
      required: true
    },

    /* ---- Term context (optional but recommended) ---- */
    termId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'AcademicTerm',
      default: null
    },

    /* ---- Date: stored as midnight UTC always ---- */
    date: {
      type:     Date,
      required: true
    },

    /* ---- Period: null = daily mode,
            1-20  = period mode
       Matches Timetable.model.js period numbering.
    ---- */
    period: {
      type:    Number,
      default: null,
      min:     1,
      max:     20
    },

    /* ---- Subject (period mode only, denormalized) ---- */
    subjectId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'SchoolSubject',
      default: null
    },
    subjectName: { type: String, default: '' },

    /* ---- Status ---- */
    status: {
      type:     String,
      enum:     ['present', 'absent', 'late', 'excused'],
      required: true
    },

    /* ---- Who marked it ---- */
    markedBy: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'SchoolUser',
      required: true
    },
    markedAt: { type: Date, default: Date.now },

    notes: { type: String, default: '' }
  },
  { timestamps: true }
);

/* ============================================
   INDEXES
============================================ */

/*
   Primary uniqueness:
   Daily mode:  (schoolId, classId, studentId, date, null)
                → unique per student per day
   Period mode: (schoolId, classId, studentId, date, 1..N)
                → unique per student per period per day
   Same index definition, correct behavior for both modes.
*/
attendanceSchema.index(
  { schoolId: 1, classId: 1, studentId: 1, date: 1, period: 1 },
  { unique: true }
);

/* Fast class attendance lookup by date */
attendanceSchema.index({ schoolId: 1, classId: 1, date: 1 });

/* Fast student history lookup (newest first) */
attendanceSchema.index({ schoolId: 1, studentId: 1, date: -1 });

/* Term-scoped reporting */
attendanceSchema.index({ schoolId: 1, termId: 1 });

module.exports = mongoose.model('AttendanceRecord', attendanceSchema);