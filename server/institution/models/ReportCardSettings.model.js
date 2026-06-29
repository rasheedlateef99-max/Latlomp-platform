/* ============================================
   LATLOMP INSTITUTION — REPORT CARD SETTINGS

   ✅ PHASE M: One record per class/term.
   Stores the configurable content that does not
   belong on School, AcademicTerm, or SchoolScore:

     - Principal's comment (same for all students
       in this class/term)
     - Next term resumption date
     - Release flag (admin controls visibility)
     - Per-student class teacher comments (Map
       keyed by studentId.toString())

   studentComments uses a Map so a single student's
   comment can be updated with $set without
   rewriting the whole array.
============================================ */
'use strict';
const mongoose = require('mongoose');

const reportCardSettingsSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School',       required: true },
    classId:  { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolClass',  required: true },
    termId:   { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicTerm', required: true },

    /* ---- Content ---- */
    principalComment: { type: String, default: 'Keep it up!' },
    resumptionDate:   { type: Date,   default: null },

    /* ---- Per-student class teacher comments
       Key:   studentId.toString()
       Value: comment string
    ---- */
    studentComments: { type: Map, of: String, default: {} },

    /* ---- Release control ---- */
    isReleased: { type: Boolean, default: false },
    releasedAt: { type: Date,   default: null },
    releasedBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'SchoolUser',
      default: null
    }
  },
  { timestamps: true }
);

/* One settings record per class/term per school */
reportCardSettingsSchema.index(
  { schoolId: 1, classId: 1, termId: 1 },
  { unique: true }
);

module.exports = mongoose.model('ReportCardSettings', reportCardSettingsSchema);