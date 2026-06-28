/* ============================================
   LATLOMP INSTITUTION — SCORE SUBMISSION MODEL
   ✅ PHASE L.7: Approval Workflow

   One record per class/subject/term combination.
   Tracks the full lifecycle:
     teacher saves → submits → admin reviews
     → approve (lock) or reject (return to teacher)
     → admin releases to students (visibility)

   The record is upserted on resubmission so
   there is always at most one submission per
   class/subject/term per school.
============================================ */
'use strict';
const mongoose = require('mongoose');

const scoreSubmissionSchema = new mongoose.Schema(
  {
    schoolId:  { type: mongoose.Schema.Types.ObjectId, ref: 'School',       required: true },
    classId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolClass',  required: true },
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolSubject', required: true },
    termId:    { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicTerm', required: true },

    academicYear: { type: String, default: '' },
    scoreCount:   { type: Number, default: 0 },

    /* ---- Submission ---- */
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
    submittedAt: { type: Date, default: Date.now },

    status: {
      type:    String,
      enum:    ['pending', 'approved', 'rejected'],
      default: 'pending'
    },

    /* ---- Approval ---- */
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
    approvedAt: { type: Date, default: null },

    /* ---- Rejection ---- */
    rejectedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
    rejectedAt:      { type: Date, default: null },
    rejectionReason: { type: String, default: '' },

    /* ---- Visibility ---- */
    releasedToStudents: { type: Boolean, default: false },
    releasedAt:         { type: Date, default: null },
    releasedBy:         { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },

    notes: { type: String, default: '' }
  },
  { timestamps: true }
);

/* One submission per class/subject/term per school */
scoreSubmissionSchema.index(
  { schoolId: 1, classId: 1, subjectId: 1, termId: 1 },
  { unique: true }
);
scoreSubmissionSchema.index({ schoolId: 1, status: 1 });
scoreSubmissionSchema.index({ submittedBy: 1 });

module.exports = mongoose.model('ScoreSubmission', scoreSubmissionSchema);