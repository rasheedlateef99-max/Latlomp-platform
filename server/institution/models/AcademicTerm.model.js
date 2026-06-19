/* ============================================
   LATLOMP INSTITUTION — ACADEMIC TERM MODEL

   Represents one academic term/semester within
   a school. Used to group exams, scores, and
   results by time period.

   FUTURE INTEGRATION:
   - Score Entry (Phase L): termId on SchoolScore
   - Report Cards (Phase M): term context
   - Promotions (Phase S): end-of-term trigger
   - Phase A structure routes already reference this
============================================ */
'use strict';

const mongoose = require('mongoose');

const academicTermSchema = new mongoose.Schema(
  {
    /* ---- Tenant isolation ---- */
    schoolId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'School',
      required: true
    },

    /* ---- Identity ---- */
    name: {
      type:     String,
      required: true,
      trim:     true
      /* e.g. "First Term", "Second Semester", "Session 1" */
    },

    /* ---- Term code — machine-readable type ---- */
    term: {
      type: String,
      enum: ['first', 'second', 'third', 'semester_1', 'semester_2'],
      default: 'first'
    },

    /* ---- Academic session ---- */
    session: {
      type:    String,
      default: ''
      /* e.g. "2024/2025" */
    },

    /* ---- Dates (optional) ---- */
    startDate: { type: Date, default: null },
    endDate:   { type: Date, default: null },

    /* ---- Current term flag ---- */
    isCurrent: {
      type:    Boolean,
      default: false
      /* Only one term per school should be current at a time.
         Enforced in inst.structure.routes.js set-current endpoint */
    },

    /* ---- Status ---- */
    isActive: {
      type:    Boolean,
      default: true
    }
  },
  { timestamps: true }
);

academicTermSchema.index({ schoolId: 1 });
academicTermSchema.index({ schoolId: 1, isCurrent: 1 });
academicTermSchema.index({ schoolId: 1, session: 1 });

module.exports = mongoose.model('AcademicTerm', academicTermSchema);