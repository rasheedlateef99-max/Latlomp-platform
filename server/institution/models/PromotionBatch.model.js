'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — PROMOTION BATCH

   One batch = one class × one source term.
   Processes all students in that class.
   Supports individual overrides within bulk ops.
   Idempotent: duplicate execution is rejected.

   STATUS FLOW:
   draft → evaluating → reviewed → executing
         → completed | partial | rolled_back
   draft → cancelled
============================================ */

const studentDecisionSchema = new mongoose.Schema({
  studentId:    { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolStudent', required: true },
  /* Snapshots at evaluation time */
  studentName:       { type: String, default: '' },
  studentAdmissionNo:{ type: String, default: '' },
  currentClassId:    { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolClass', default: null },
  currentClassName:  { type: String, default: '' },

  /* ---- Eligibility (set by evaluate step) ---- */
  eligibilityStatus: {
    type: String,
    enum: ['eligible', 'not_eligible', 'requires_review',
           'financial_hold', 'attendance_hold', 'graduation_candidate'],
    default: 'requires_review'
  },
  failedCriteria:  [String],
  academicScore:   { type: Number, default: null }, /* null = not evaluated */
  attendanceRate:  { type: Number, default: null },
  feesCleared:     { type: Boolean, default: null },
  recommendation: {
    type: String,
    enum: ['promote', 'repeat', 'graduate', 'review'],
    default: 'review'
  },

  /* ---- Admin decision (set by decide step) ---- */
  finalDecision: {
    type: String,
    enum: ['promote', 'repeat', 'graduate', 'transfer_out', 'pending'],
    default: 'pending'
  },
  targetClassId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolClass', default: null },
  targetClassName: { type: String, default: '' },

  /* ---- Override ---- */
  overridden:       { type: Boolean, default: false },
  overrideReason:   { type: String,  default: '' },
  overriddenBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  overriddenByName: { type: String,  default: '' },
  overriddenAt:     { type: Date,    default: null },

  /* ---- Pre-execution snapshot (rollback support) ---- */
  preExecutionClassId:    { type: mongoose.Schema.Types.ObjectId, default: null },
  preExecutionClassName:  { type: String, default: '' },
  preExecutionStatus:     { type: String, default: 'active' },
  /* Timestamp of the classHistory entry added during execute.
     Used to identify the entry for rollback without deleting it. */
  executionHistoryTimestamp: { type: Date, default: null },

  /* ---- Execution result ---- */
  executionStatus: {
    type: String,
    enum: ['pending', 'success', 'failed', 'skipped', 'rolled_back'],
    default: 'pending'
  },
  executionError: { type: String, default: '' }
}, { _id: false });

const promotionBatchSchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true
  },
  /* Human-readable batch identifier */
  batchRef: { type: String, required: true, unique: true },

  /* ---- Source academic period (AcademicTerm._id) ---- */
  sourceTermId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'AcademicTerm',
    required: true
  },
  /* Snapshot strings for audit readability */
  sourceTermSnapshot: {
    name:    { type: String, default: '' },
    session: { type: String, default: '' },
    term:    { type: String, default: '' }
  },

  /* ---- Target academic period (set at review; required for execute) ---- */
  targetTermId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'AcademicTerm',
    default: null
  },
  targetTermSnapshot: {
    name:    { type: String, default: '' },
    session: { type: String, default: '' },
    term:    { type: String, default: '' }
  },

  /* ---- Source class ---- */
  sourceClassId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'SchoolClass',
    required: true
  },
  sourceClassSnapshot: {
    name:     { type: String, default: '' },
    category: { type: String, default: '' }
  },

  /* ---- Status ---- */
  status: {
    type: String,
    enum: ['draft', 'evaluating', 'reviewed', 'executing',
           'completed', 'partial', 'rolled_back', 'cancelled'],
    default: 'draft'
  },

  /* ---- Students (one entry per student in source class) ---- */
  students: [studentDecisionSchema],

  /* ---- Summary (computed at execution) ---- */
  summary: {
    total:       { type: Number, default: 0 },
    evaluated:   { type: Number, default: 0 },
    promoted:    { type: Number, default: 0 },
    repeated:    { type: Number, default: 0 },
    graduated:   { type: Number, default: 0 },
    transferred: { type: Number, default: 0 },
    failed:      { type: Number, default: 0 },
    skipped:     { type: Number, default: 0 },
    overrides:   { type: Number, default: 0 }
  },

  /* ---- Audit ---- */
  createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
  createdByName:    { type: String, default: '' },
  executedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  executedByName:   { type: String, default: '' },
  executedAt:       { type: Date, default: null },
  rollbackedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  rollbackedByName: { type: String, default: '' },
  rollbackedAt:     { type: Date, default: null },
  rollbackReason:   { type: String, default: '' },

  notes: { type: String, default: '' }
}, { timestamps: true });

promotionBatchSchema.index({ schoolId: 1 });
promotionBatchSchema.index({ schoolId: 1, status: 1 });
promotionBatchSchema.index({ schoolId: 1, sourceClassId: 1, sourceTermId: 1 });
promotionBatchSchema.index({ batchRef: 1 }, { unique: true });

module.exports = mongoose.model('PromotionBatch', promotionBatchSchema);