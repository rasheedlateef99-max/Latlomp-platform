/* ============================================
   LATLOMP INSTITUTION — PAPER EXAM MODEL
   ✅ PHASE K.1: Paper Exam System (backend layer)

   Represents a physical/printed examination.
   Parallel to SchoolExam (CBT) but with different
   fields suited to paper-based exams — no access
   code, no live activation window, no shuffle.

   Students answer on physical paper. Teacher marks
   manually and enters scores via SchoolScore
   (Phase L) — NOT via this model.

   This model exists purely to:
   1. Hold question paper metadata
   2. Group PaperQuestion documents
   3. Power the branded PDF question paper export (K.4)

   Multi-school isolation: every query MUST include
   schoolId, same pattern as SchoolExam.
============================================ */
'use strict';

const mongoose = require('mongoose');

const paperExamSchema = new mongoose.Schema(
  {
    /* ---- Tenant isolation ---- */
    schoolId:  { type: mongoose.Schema.Types.ObjectId, ref: 'School',     required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },

    /* ---- Identity (mirrors SchoolExam naming) ---- */
    title:   { type: String, required: true, trim: true },
    subject: { type: String, required: true },
    class:   { type: String, default: '' },
    term:    { type: String, enum: ['first', 'second', 'third', ''], default: '' },
    session: { type: String, default: '' },

    examYear: {
      type:    Number,
      default: function () { return new Date().getFullYear(); }
    },

    /* ---- Phase A structure refs (optional) ---- */
    classId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolClass',   default: null },
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolSubject', default: null },
    termId:    { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicTerm',  default: null },

    /* ---- Paper-specific type ---- */
    paperType: {
      type:    String,
      enum:    ['objective', 'theory', 'mixed'],
      default: 'mixed'
    },

    /* ---- Exam details (no access code — this is printed, not CBT) ---- */
    instructions: { type: String, default: '' },
    duration:     { type: Number, default: 60 },   /* minutes — shown on printed paper */
    totalMarks:   { type: Number, default: 100 },

    /* ---- Marking reference (teacher's own notes, never printed for students) ---- */
    markingScheme: { type: String, default: '' },

    /* ---- Print tracking ---- */
    printCount:   { type: Number, default: 0 },
    lastPrintedAt: { type: Date, default: null },

    /* ---- Lifecycle ----
       draft     — still being built, can edit freely
       finalized — locked for printing/PDF export
       archived  — no longer in active use
    ---- */
    status: {
      type:    String,
      enum:    ['draft', 'finalized', 'archived'],
      default: 'draft'
    },

    /* ---- Stats (filled in later phases) ---- */
    totalQuestions: { type: Number, default: 0 }
  },
  { timestamps: true }
);

paperExamSchema.index({ schoolId: 1, status: 1 });
paperExamSchema.index({ schoolId: 1, classId: 1 });
paperExamSchema.index({ schoolId: 1, subjectId: 1 });
paperExamSchema.index({ schoolId: 1, termId: 1 });
paperExamSchema.index({ schoolId: 1, createdBy: 1 });

module.exports = mongoose.model('PaperExam', paperExamSchema);