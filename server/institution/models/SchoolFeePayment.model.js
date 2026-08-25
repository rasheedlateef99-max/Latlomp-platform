'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — FEE PAYMENT MODEL

   Records an actual payment event.
   One assignment can have multiple partial
   payments. Total amountPaid on the assignment
   is always the sum of its payment records.

   Payment methods:
     cash          — paid at the school counter
     bank_transfer — bank deposit / USSD transfer
     paystack      — online via Paystack inline
     cheque        — physical cheque
     other         — any other method
============================================ */
const schoolFeePaymentSchema = new mongoose.Schema({
  schoolId:       { type: mongoose.Schema.Types.ObjectId, ref: 'School',              required: true },
  studentId:      { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolStudent',       required: true },
  assignmentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolFeeAssignment', required: true },
  feeStructureId: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolFeeStructure',  required: true },
  termId:         { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicTerm',        default: null },

  /* ---- Amount ---- */
  amount: { type: Number, required: true, min: 1 },

  /* ---- Method ---- */
  method: {
    type:    String,
    enum:    ['cash', 'bank_transfer', 'paystack', 'cheque', 'other'],
    default: 'cash'
  },

  /* ---- Reference ---- */
  /* For bank_transfer: bank teller/deposit reference.
     For paystack: Paystack transaction reference.
     For cash: optional receipt number. */
  externalRef:   { type: String, default: '' },
  paystackRef:   { type: String, default: '' },

  /* ---- Receipt ---- */
  receiptNumber: { type: String, default: '' },  /* auto-generated */

  /* ---- Notes ---- */
  note: { type: String, default: '' },

  /* ---- Status ---- */
  status: {
    type:    String,
    enum:    ['pending', 'confirmed', 'reversed'],
    default: 'confirmed'  /* manual payments are immediately confirmed */
  },

  /* ---- Currency ---- */
  currency: { type: String, default: 'NGN' },

  /* ---- R2: Online payment breakdown (null for manual payments) ---- */
  totalCharged:      { type: Number, default: null }, /* amount parent actually paid */
  platformFeePercent:{ type: Number, default: null }, /* snapshot of LatLomp rate */
  platformFeeAmount: { type: Number, default: null }, /* LatLomp's share */
  providerFeeAmount: { type: Number, default: null }, /* what Paystack/provider kept */

  /* ---- Attempt tracking ---- */
  /* A payment attempt is NOT the same as a confirmed payment.
     Only status='confirmed' records affect assignment balance. */
  attemptRef: { type: String, default: '' }, /* reference from provider init */

  /* ---- Audit ---- */
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  recordedAt: { type: Date, default: Date.now }
}, { timestamps: true });

schoolFeePaymentSchema.index({ schoolId: 1 });
schoolFeePaymentSchema.index({ schoolId: 1, studentId: 1 });
schoolFeePaymentSchema.index({ schoolId: 1, termId: 1 });
schoolFeePaymentSchema.index({ schoolId: 1, assignmentId: 1 });
schoolFeePaymentSchema.index({ paystackRef: 1 }, { sparse: true });
schoolFeePaymentSchema.index({ receiptNumber: 1 }, { sparse: true });

module.exports = mongoose.model('SchoolFeePayment', schoolFeePaymentSchema);