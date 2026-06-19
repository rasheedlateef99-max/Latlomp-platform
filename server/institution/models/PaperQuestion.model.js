/* ============================================
   LATLOMP INSTITUTION — PAPER QUESTION MODEL
   ✅ PHASE K.1: Paper Exam System (backend layer)

   Represents a single question within a PaperExam.
   Structurally similar to SchoolQuestion (CBT) but
   adds a 'section' field for grouping on the printed
   paper (e.g. "Section A — Objective", "Section B —
   Theory") and 'answerSpaceLines' to control how much
   blank writing space appears under theory questions
   on the exported PDF.

   correctAnswer / modelAnswer / markScheme are stored
   for the teacher's own marking key — they are NEVER
   included in the student-facing PDF export (K.4
   strips these fields before rendering the paper).
============================================ */
'use strict';

const mongoose = require('mongoose');

const paperQuestionSchema = new mongoose.Schema(
  {
    /* ---- Tenant isolation ---- */
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School',     required: true },
    examId:   { type: mongoose.Schema.Types.ObjectId, ref: 'PaperExam',  required: true },

    /* ---- Type ---- */
    questionType: {
      type:    String,
      enum:    ['objective', 'theory', 'fill_in_blank', 'true_false'],
      default: 'objective'
    },

    /* ---- Content ---- */
    question: { type: String, required: true },

    /* Objective / true-false / fill-in-blank options */
    options: { type: [String], default: [] },

    /* Index into options[] — teacher's marking key only.
       Never rendered in the printed student paper. */
    correctAnswer: { type: Number, default: 0 },

    /* Theory marking reference — teacher's own notes only */
    modelAnswer: { type: String, default: '' },
    markScheme:  { type: String, default: '' },

    /* ---- Rich content (same pattern as SchoolQuestion Phase G) ---- */
    imageUrl:  { type: String, default: '' },
    tableHtml: { type: String, default: '' },

    /* ---- Marks + metadata ---- */
    marks:      { type: Number, default: 1 },
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
    topic:      { type: String, default: '' },

    /* ---- Print layout control ---- */
    section: {
      type:    String,
      default: ''
      /* e.g. "Section A", "Section B — Theory" */
    },

    /* How many blank lines to print under a theory question
       for the student to write their answer. */
    answerSpaceLines: {
      type:    Number,
      default: 4
    },

    sortOrder: { type: Number, default: 0 },
    isActive:  { type: Boolean, default: true }
  },
  { timestamps: true }
);

paperQuestionSchema.index({ schoolId: 1, examId: 1 });
paperQuestionSchema.index({ examId: 1, sortOrder: 1 });

module.exports = mongoose.model('PaperQuestion', paperQuestionSchema);