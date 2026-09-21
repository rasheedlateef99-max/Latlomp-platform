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
  /* P6: studentId, assignmentId, feeStructureId are optional for
     campaign / donation payments where no student is involved.
     Existing records already have valid values — this is a safe change. */
  studentId:      { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolStudent',       default: null },
  assignmentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolFeeAssignment', default: null },
  feeStructureId: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolFeeStructure',  default: null },
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
  recordedAt: { type: Date, default: Date.now },

  /* ---- P6: Claim-based payment provenance ----
     Set when this payment was created from a verified SchoolPaymentClaim.
     Null for staff-direct payments (cash/bank recorded without a claim).
     paymentAccountId: ObjectId reference only — bank details never copied. */
  claimId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolPaymentClaim',
    default: null
  },
  payerId: {
    type:    mongoose.Schema.Types.ObjectId,
    default: null
    /* Flexible ref: SchoolParent._id | SchoolStudent._id |
                     AlumniProfile._id | SchoolUser._id | null (external) */
  },
  payerType:        { type: String, default: '' },
  payerName:        { type: String, default: '' },
  paymentAccountId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolManualPaymentAccount',
    default: null
  },
  verifiedBy: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolUser',
    default: null
  },
  verifiedAt: { type: Date, default: null }
}, { timestamps: true });

schoolFeePaymentSchema.index({ schoolId: 1 });
schoolFeePaymentSchema.index({ schoolId: 1, studentId: 1 });
schoolFeePaymentSchema.index({ schoolId: 1, termId: 1 });
schoolFeePaymentSchema.index({ schoolId: 1, assignmentId: 1 });
schoolFeePaymentSchema.index({ paystackRef: 1 }, { sparse: true });
schoolFeePaymentSchema.index({ receiptNumber: 1 }, { sparse: true });

/* ✅ E7B AUDIT: Performance indexes for finance dashboard queries */
/* Only add if not already present */
if (!schoolFeePaymentSchema.indexes().some(function(idx) {
  return idx[0] && idx[0].recordedAt;
})) {
  schoolFeePaymentSchema.index({ schoolId: 1, status: 1, recordedAt: -1 });
  schoolFeePaymentSchema.index({ schoolId: 1, termId: 1, status: 1 });
  schoolFeePaymentSchema.index({ schoolId: 1, recordedAt: -1 });
}
module.exports = mongoose.model('SchoolFeePayment', schoolFeePaymentSchema);