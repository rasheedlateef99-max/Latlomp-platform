'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — ALUMNI CONTRIBUTION (E6)

   References R2 payment infrastructure for
   financial contributions. Never duplicates
   payment transaction details.

   For financial: paymentRef → Paystack reference.
   For non-financial: amount=null, paymentRef=null.
============================================ */
const alumniContributionSchema = new mongoose.Schema({
  schoolId:       { type: mongoose.Schema.Types.ObjectId, ref: 'School',       required: true },
  alumniProfileId:{ type: mongoose.Schema.Types.ObjectId, ref: 'AlumniProfile', required: true },
  studentId:      { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolStudent', required: true },

  contributionType: {
    type:     String,
    enum:     ['donation','sponsorship','volunteering','speaking','programme_support'],
    required: true
  },

  /* ---- Financial (null for non-financial types) ---- */
  amount:    { type: Number, default: null },
  currency:  { type: String, default: 'NGN' },

  /* R2 payment reference (Paystack ref) — never stores transaction details */
  paymentRef:    { type: String, default: null },
  paymentStatus: {
    type:    String,
    enum:    ['pending','completed','failed','refunded'],
    default: 'pending'
  },

  /* ---- All contribution types ---- */
  campaign:    { type: String, default: '' },
  description: { type: String, default: '', maxlength: 500 },
  status:      { type: String, enum: ['pending','confirmed','cancelled'], default: 'pending' },

  /* ---- Acknowledgement ---- */
  acknowledgedAt:     { type: Date, default: null },
  acknowledgedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  acknowledgedByName: { type: String, default: '' }
}, { timestamps: true });

alumniContributionSchema.index({ schoolId: 1, alumniProfileId: 1 });
alumniContributionSchema.index({ schoolId: 1, contributionType: 1 });
alumniContributionSchema.index({ schoolId: 1, status: 1 });
alumniContributionSchema.index({ paymentRef: 1 }, { sparse: true });

module.exports = mongoose.model('AlumniContribution', alumniContributionSchema);