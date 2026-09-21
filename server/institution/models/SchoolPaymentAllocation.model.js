'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP — SCHOOL PAYMENT ALLOCATION (P6)

   An allocation links an authoritative payment
   record (SchoolFeePayment) to what it paid for:
   either a student fee obligation (assignmentId)
   or a campaign contribution (campaignId).

   ONE PAYMENT → ONE OR MORE ALLOCATIONS.

   Standard P6 flow (1-to-1):
     Claim verified → one SchoolFeePayment created
     → one SchoolPaymentAllocation created

   Future P9 flow (1-to-many):
     Parent pays ₦50,000 for two children →
     Finance officer splits into two allocations:
       Allocation 1: Ahmed  ₦30,000 → assignmentId A
       Allocation 2: Fatima ₦20,000 → assignmentId B

   PROGRESS CALCULATION (P7):
     For any assignment:
       totalAllocated = SUM(allocation.amount WHERE assignmentId = X)
       progress% = (totalAllocated / assignment.netObligation) × 100

   IMMUTABILITY:
     Allocations are never edited. Financial adjustments
     use SchoolFeeAdjustment (existing model). Reversals
     create new SchoolFeePayment records with reversed amounts.

   TENANT ISOLATION:
     Every query MUST include { schoolId: req.schoolId }.
============================================ */
const schoolPaymentAllocationSchema = new mongoose.Schema({

  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true
  },

  /* ---- Source payment (authoritative transaction) ---- */
  paymentId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'SchoolFeePayment',
    required: true
  },

  /* ---- Source claim (if claim-driven; null for staff-direct) ---- */
  claimId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolPaymentClaim',
    default: null
  },

  /* ---- What this allocation paid for ----
     Exactly one of (assignmentId, campaignId) should be set
     for the standard 1-to-1 flow. In multi-split scenarios
     each allocation covers one purpose.                     */
  assignmentId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolFeeAssignment',
    default: null
  },
  feeStructureId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolFeeStructure',
    default: null
    /* Denormalised from assignmentId at creation time.
       Never updated after creation.                    */
  },
  campaignId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolDonationCampaign',
    default: null
  },

  /* ---- Who benefited ----
     Set when this allocation applies to a student's obligation. */
  studentId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolStudent',
    default: null
  },

  /* ---- Amount ---- */
  amount:   { type: Number, required: true, min: 0.01 },
  currency: { type: String, default: 'NGN', uppercase: true, trim: true },

  /* ---- Optional note from finance officer ---- */
  note: { type: String, default: '', trim: true, maxlength: 300 }

}, { timestamps: true, versionKey: false });

/* ---- Indexes ---- */
/* Progress calculation: all allocations for an assignment */
schoolPaymentAllocationSchema.index({ schoolId: 1, assignmentId: 1 });

/* Student payment history across all their assignments */
schoolPaymentAllocationSchema.index({ schoolId: 1, studentId: 1 });

/* Campaign totals — supplement to SchoolDonationCampaign.totalCollected */
schoolPaymentAllocationSchema.index({ schoolId: 1, campaignId: 1 });

/* Payment → allocations (one payment can have many) */
schoolPaymentAllocationSchema.index({ paymentId: 1 });

/* Reporting: date range + school */
schoolPaymentAllocationSchema.index({ schoolId: 1, createdAt: -1 });

module.exports = mongoose.model('SchoolPaymentAllocation', schoolPaymentAllocationSchema);