'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP — SCHOOL FEE REFUND (E7B)

   Refund records linked to original payments.
   Original SchoolFeePayment is NEVER modified.
   Separate record preserves audit trail.
   On processing: SchoolFeeAssignment rebalanced.
============================================ */
const schoolFeeRefundSchema = new mongoose.Schema({
  schoolId:    { type: mongoose.Schema.Types.ObjectId, ref: 'School',          required: true },
  paymentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolFeePayment', required: true },
  assignmentId:{ type: mongoose.Schema.Types.ObjectId, ref: 'SchoolFeeAssignment', required: true },
  studentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolStudent',    required: true },

  amount:          { type: Number, required: true, min: 0.01 },
  currency:        { type: String, default: 'NGN' },
  reason:          { type: String, required: true, trim: true },
  refundMethod:    { type: String, enum: ['original_method','bank_transfer','cash','credit'], default: 'original_method' },

  status: {
    type:    String,
    enum:    ['pending','processing','processed','failed','cancelled'],
    default: 'pending'
  },

  providerRefundRef: { type: String, default: '' }, /* Paystack refund ref */
  providerResponse:  { type: String, default: '' }, /* Provider message */
  failureReason:     { type: String, default: '' },
  notes:             { type: String, default: '' },

  requestedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
  requestedByName: { type: String, default: '' },
  requestedAt:     { type: Date, default: Date.now },

  processedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  processedByName: { type: String, default: '' },
  processedAt:     { type: Date, default: null }
}, { timestamps: true });

schoolFeeRefundSchema.index({ schoolId: 1, studentId: 1 });
schoolFeeRefundSchema.index({ schoolId: 1, status: 1 });
schoolFeeRefundSchema.index({ paymentId: 1 });
schoolFeeRefundSchema.index({ schoolId: 1, requestedAt: -1 });

module.exports = mongoose.model('SchoolFeeRefund', schoolFeeRefundSchema);