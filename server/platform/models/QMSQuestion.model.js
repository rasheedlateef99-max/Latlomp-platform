/* ============================================
   LATLOMP PLATFORM — QMS QUESTION MODEL

   Stores questions imported through the Question
   Management System. Separate from the existing
   Question model (which the CBT system uses directly).

   The Question Engine (Phase 3) bridges this collection
   to the existing CBT system.

   FIELD COMPATIBILITY with Question.model.js:
     options       → [String]  (same)
     correctAnswer → Number    (same — index into options)
     examCategory  → same enum values
     subjectId     → ObjectId ref 'Subject' (same ref)

   QUESTION ID FORMAT: JAMB-MAT-00000001
   Permanent. Never changes. Never reused.
============================================ */
'use strict';

const mongoose = require('mongoose');

/* ---- Version snapshot (stored on every edit) ---- */
const versionSchema = new mongoose.Schema({
  question:      { type: String },
  options:       { type: [String] },
  correctAnswer: { type: Number },
  explanation:   { type: String, default: '' },
  /* ✅ STEP 2: Track model answer changes in version history */
  modelAnswer:   { type: String, default: '' },
  editedBy:      { type: String, default: 'system' },
  reason:        { type: String, default: '' }
}, { timestamps: true });

const qmsQuestionSchema = new mongoose.Schema(
  {
    /* ---- Permanent unique identifier ---- */
    questionId: {
      type:     String,
      unique:   true,
      index:    true,
      trim:     true
    },

    /* ---- Exam classification ---- */
    /* ✅ STAGE 6: Enum replaced by dynamic ExamType collection.
       Any valid ExamType.key is accepted.
       Validation is done at the import/create route level. */
    examType: {
      type:      String,
      required:  true,
      index:     true,
      lowercase: true,
      trim:      true
    },

    /* ---- Question type for multi-modal examination support ----
       ✅ STAGE 1: All existing questions default to 'objective'.
       Fully backward compatible — the engine already filters by subjectId
       and examType; questionType is an additive filter only.
       Stage 4 will use this to separate objective and theory question pools. */
    questionType: {
      type:    String,
      enum:    ['objective', 'theory', 'practical', 'oral'],
      default: 'objective',
      index:   true
    },

    /* ---- Links to existing CBT structure ---- */
    subjectId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Subject',
      default: null,
      index:   true
    },
    departmentId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Department',
      default: null,
      index:   true
    },

    /* ---- Denormalized display names ---- */
    subjectName:    { type: String, default: '', trim: true },
    departmentName: { type: String, default: '', trim: true },

    /* ---- Core question data (compatible with Question.model.js) ---- */
    question:      { type: String, required: true, trim: true },
    options: {
      type:    [String],
      default: [],
      /* ✅ STEP 2: Validator removed from model — route enforces minimum
         2 options for objective questions before any DB write occurs.
         Theory questions (no options) now pass model validation.
         All existing objective questions are unaffected. */
      validate: {
        validator: function () { return true; },
        message:   'At least 2 options are required'
      }
    },
    correctAnswer: {
      type:    Number,
      default: null
      /* ✅ STEP 2: Not required. Theory questions have no correct answer
         index — they use modelAnswer instead. Route validates the range
         for objective questions before saving. Null stored for theory.
         Existing objective questions with correctAnswer: 0 are unaffected
         (0 is a number, not null). */
    },
    explanation:   { type: String, default: '', trim: true },
    /* ✅ STEP 2: Reference / model answer for theory questions.
       Stores the expected answer or marking guide.
       Not visible to students — admin/marker facing only.
       Objective questions leave this empty string. */
    modelAnswer:   { type: String, default: '', trim: true },
    /* ✅ STEP 2: Marks allocated to this question.
       Extracted by the parser from "Marks: N" lines in paste import.
       Stored for future per-question marking support.
       Default 1 — all existing documents are valid without migration. */
    marks: { type: Number, default: 1, min: 0 },

    /* ---- Metadata tags ---- */
    topic:      { type: String, default: '', trim: true },
    subtopic:   { type: String, default: '', trim: true },
    difficulty: {
      type:    String,
      enum:    ['easy', 'medium', 'hard', 'mixed'],
      default: 'medium'
    },
    year:     { type: Number, default: null },
    source:   { type: String, default: '', trim: true },
    keywords: { type: [String], default: [] },

    /* ---- Lifecycle ---- */
    status: {
      type:    String,
      enum:    ['draft', 'pending_review', 'approved', 'archived', 'deleted'],
      default: 'approved',
      index:   true
    },

    /* ---- Version history ---- */
    versions: { type: [versionSchema], default: [] },

    /* ---- Import tracking ---- */
    importJobId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'ImportJob',
      default: null
    },

    /* ---- Audit ---- */
    createdBy:  { type: String, default: 'system' },
    approvedBy: { type: String, default: 'system' },
    approvedAt: { type: Date,   default: Date.now }
  },
  { timestamps: true }
);

/* ---- Indexes for Question Engine queries (Phase 3) ---- */
qmsQuestionSchema.index({ examType: 1, subjectId: 1,    questionType: 1, status: 1 });
qmsQuestionSchema.index({ examType: 1, departmentId: 1, status: 1 });
qmsQuestionSchema.index({ subjectId: 1, questionType: 1, status: 1 });
qmsQuestionSchema.index({ status: 1,   createdAt: -1 });

module.exports = mongoose.model('QMSQuestion', qmsQuestionSchema);