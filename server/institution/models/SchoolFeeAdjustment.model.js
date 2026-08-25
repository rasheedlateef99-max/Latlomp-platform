'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — FEE ADJUSTMENT
   Records every change to a student's fee obligation.
   Adjustments never touch confirmed payment records.
   Option C overpayment: status = 'overpaid',
   finance staff resolves manually. No auto-refund.
============================================ */
const schoolFeeAdjustmentSchema = new mongoose.Schema({
  schoolId:       { type: mongoose.Schema.Types.ObjectId, ref: 'School',              required: true },
  assignmentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolFeeAssignment', required: true },
  studentId:      { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolStudent',       required: true },
  feeStructureId: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolFeeStructure',  required: true },

  adjustmentType: {
    type:    String,
    enum:    ['discount', 'waiver', 'increase', 'reduce', 'cancel', 'reinstate', 'other'],
    required: true
  },

  /* ---- Amounts snapshot ---- */
  currency:               { type: String, default: 'NGN' },
  originalAmountDue:      { type: Number, required: true },
  adjustmentAmount:       { type: Number, required: true }, /* positive=increase, negative=reduce */
  newAmountDue:           { type: Number, required: true },
  amountPaidAtAdjustment: { type: Number, default: 0 },
  balanceAfterAdjustment: { type: Number, required: true },

  /* ---- Overpayment tracking (Option C) ---- */
  createdOverpayment: { type: Boolean, default: false },
  overpaymentAmount:  { type: Number,  default: 0 },

  /* ---- Mandatory reason ---- */
  reason: { type: String, required: true, trim: true },

  /* ---- Audit ---- */
  madeBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
  madeByName: { type: String, default: '' }
}, { timestamps: true });

schoolFeeAdjustmentSchema.index({ schoolId: 1 });
schoolFeeAdjustmentSchema.index({ schoolId: 1, studentId: 1 });
schoolFeeAdjustmentSchema.index({ assignmentId: 1 });
schoolFeeAdjustmentSchema.index({ schoolId: 1, createdAt: -1 });

module.exports = mongoose.model('SchoolFeeAdjustment', schoolFeeAdjustmentSchema);