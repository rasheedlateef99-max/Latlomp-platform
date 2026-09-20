'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP — SCHOOL PAYMENT CLAIM (P4)

   A Payment Claim is a payer's notification
   that they have transferred money to the school.
   It is NOT a verified transaction.

   Status lifecycle:
     awaiting_verification
       → verified   (P5: finance staff confirms money received)
       → rejected   (P5: finance staff cannot confirm)
       → needs_correction (P5: info is wrong or incomplete)
       → cancelled  (payer or staff withdraws the claim)

   On VERIFIED (P6):
     → resultPaymentId is set
     → SchoolFeePayment is created (authoritative transaction)
     → SchoolPaymentAllocation(s) created
     → syncAssignmentBalance() fires per allocation

   IMPORTANT FIELD RULES:
   schoolId:        ALWAYS from req.schoolId (JWT) — never from body
   paymentAccountId: ObjectId reference ONLY — bank details are
                    never copied into this document (Correction 1)
   payerId:         Flexible ObjectId — meaning depends on payerType:
                      parent → SchoolParent._id
                      student → SchoolStudent._id
                      alumni  → AlumniProfile._id
                      staff   → SchoolUser._id
                      external/organisation → null (no platform identity)

   TENANT ISOLATION:
   Every query on this model MUST include { schoolId: req.schoolId }.
============================================ */
const schoolPaymentClaimSchema = new mongoose.Schema({

  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true
  },

  /* ---- What is being paid for ----
     At least one of assignmentId / campaignId should be set.
     Both may be null for general contributions.
     Constraint is enforced in the route, not the model.     */
  assignmentId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolFeeAssignment',
    default: null
  },
  feeStructureId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolFeeStructure',
    default: null
    /* Denormalised from assignmentId at claim creation time
       for faster reporting — never updated after creation. */
  },
  campaignId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolDonationCampaign',
    default: null
  },
  /* Which student this payment benefits (if applicable).
     May differ from payerId (a parent paying for their child). */
  studentId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolStudent',
    default: null
  },

  /* ---- Payer identity ---- */
  payerType: {
    type:     String,
    enum:     ['parent', 'student', 'alumni', 'staff', 'external', 'organisation'],
    required: true
  },
  payerId: {
    type:    mongoose.Schema.Types.ObjectId,
    default: null
    /* Flexible ref — null for external/organisation payers */
  },
  payerName:  { type: String, required: true, trim: true },
  payerEmail: { type: String, default: '',    trim: true, lowercase: true },
  payerPhone: { type: String, default: '' },

  /* ---- Payment details ---- */
  amount:   { type: Number, required: true, min: 0.01 },
  currency: { type: String, default: 'NGN', uppercase: true, trim: true },

  /* ObjectId reference to the school's configured payment account.
     Only the reference is stored — bank details are never copied here.
     (P3 Correction 1 / P6 deletion protection hook applies.) */
  paymentAccountId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolManualPaymentAccount',
    default: null
  },

  /* Bank teller / transfer reference number from the payer's receipt */
  reference:   { type: String, default: '', trim: true },

  /* Date the payer made the bank transfer (claimed by payer) */
  paymentDate: { type: Date, required: true },

  /* Optional URL to uploaded evidence (screenshot, photo, etc.)
     In P9: replaced/extended with proper media upload.
     In P4: accepts any URL string the payer provides. */
  evidenceUrl: { type: String, default: '' },

  note: { type: String, default: '', trim: true, maxlength: 500 },

  /* ---- Status ---- */
  status: {
    type:    String,
    enum:    ['awaiting_verification', 'verified', 'rejected', 'needs_correction', 'cancelled'],
    default: 'awaiting_verification'
  },

  /* ---- Review fields (populated in P5) ---- */
  rejectionReason: { type: String, default: '' },
  correctionNote:  { type: String, default: '' },
  reviewedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  reviewedByName:  { type: String, default: '' },
  reviewedAt:      { type: Date, default: null },

  /* ---- Result (populated in P6 after verification) ---- */
  resultPaymentId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolFeePayment',
    default: null
    /* Once set, this claim has been converted to an authoritative
       verified transaction. The claim record is kept for audit. */
  },

  /* ---- Who submitted ---- */
  submittedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  submittedByName: { type: String, default: '' },
  /* How the claim was created — used for audit context.
     P9 will set portal-specific values. */
  submittedVia: {
    type:    String,
    enum:    ['staff', 'parent_portal', 'student_portal', 'alumni_portal'],
    default: 'staff'
  }

}, { timestamps: true, versionKey: false });

/* ---- Indexes ---- */
/* Verification queue: pending claims newest first */
schoolPaymentClaimSchema.index({ schoolId: 1, status: 1, createdAt: -1 });

/* Payer history */
schoolPaymentClaimSchema.index({ schoolId: 1, payerId: 1, payerType: 1, createdAt: -1 });

/* Assignment claims (progress calculation reference) */
schoolPaymentClaimSchema.index({ schoolId: 1, assignmentId: 1, status: 1 });

/* Campaign claims */
schoolPaymentClaimSchema.index({ schoolId: 1, campaignId: 1, status: 1 });

/* Student payment history */
schoolPaymentClaimSchema.index({ schoolId: 1, studentId: 1, status: 1, createdAt: -1 });

/* Reference lookup (for duplicate detection warning) */
schoolPaymentClaimSchema.index({ schoolId: 1, reference: 1, paymentAccountId: 1 });

module.exports = mongoose.model('SchoolPaymentClaim', schoolPaymentClaimSchema);