/* ============================================
   LATLOMP INSTITUTION — SCHOOL SUBJECT MODEL

   Represents a subject taught within a school.
   Subjects can be assigned to specific classes
   or marked as school-wide.

   FUTURE INTEGRATION:
   - Score Entry (Phase L): subjectId on SchoolScore
   - Report Cards (Phase M): per-subject rows
   - Timetable (Phase N): subjectId on each slot
   - Phase A structure routes already reference this
============================================ */
'use strict';

const mongoose = require('mongoose');

const schoolSubjectSchema = new mongoose.Schema(
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
      /* e.g. "Mathematics", "English Language", "Physics" */
    },

    code: {
      type:    String,
      default: '',
      trim:    true
      /* e.g. "MTH", "ENG", "PHY" */
    },

    /* ---- Type ---- */
    isCore: {
      type:    Boolean,
      default: true
      /* true = compulsory, false = elective/optional */
    },

    /* ---- Class assignment
       Empty array means the subject applies to all
       classes in the school. If populated, only the
       listed classes offer this subject.
    ---- */
    classIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref:  'SchoolClass'
    }],

    /* ---- Status ---- */
    isActive: {
      type:    Boolean,
      default: true
    },

    sortOrder: {
      type:    Number,
      default: 0
    }
  },
  { timestamps: true }
);

schoolSubjectSchema.index({ schoolId: 1 });
schoolSubjectSchema.index({ schoolId: 1, name: 1 });
schoolSubjectSchema.index({ schoolId: 1, isActive: 1 });
schoolSubjectSchema.index(
  { schoolId: 1, name: 1 },
  { unique: true }
);

module.exports = mongoose.model('SchoolSubject', schoolSubjectSchema);