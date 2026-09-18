'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP — SCHOOL DONATION CAMPAIGN (E7B)

   School-created campaigns for community support.
   Financial transactions go through R2 provider.
   This model owns campaign domain data only.
============================================ */
const schoolDonationCampaignSchema = new mongoose.Schema({
  schoolId:    { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  title:       { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  category: {
    type:    String,
    enum:    ['building','scholarship','equipment','library','sports','general',
              'bursary','anniversary','fundraising','development','event','programme','other'],
    default: 'general'
  },
  targetAmount: { type: Number, default: null },
  currency:     { type: String, default: 'NGN' },
  status: {
    type:    String,
    enum:    ['active','paused','closed','cancelled'],
    default: 'active'
  },
  isPublic:     { type: Boolean, default: false }, /* visible on school website */
  startDate:    { type: Date, default: Date.now },
  endDate:      { type: Date, default: null },

  /* Running totals — updated on each confirmed donation */
  totalCollected: { type: Number, default: 0 },
  donationCount:  { type: Number, default: 0 },
/* ---- P3: Extended config ---- */
  /* ObjectId reference only — bank details never copied here.
     Resolved server-side via GET /finance/donations/campaigns/:id/payment-account.
     P6 deletion-protection hook guards this reference. */
  paymentAccountId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolManualPaymentAccount',
    default: null
  },
  allowManualClaim: { type: Boolean, default: true },   /* enable bank-transfer claim path (P4) */
  minContribution:  { type: Number, default: 0, min: 0 },
  targetAudience: {
    type:    [String],
    enum:    ['student', 'parent', 'alumni', 'staff', 'all'],
    default: ['parent', 'alumni', 'student']
  },
  visibility: {
    type:    String,
    enum:    ['internal', 'portal', 'website', 'community'],
    default: 'internal'
  },
  publishedOn: { type: [String], default: [] },
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
  createdByName: { type: String, default: '' },
  closedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  closedAt:      { type: Date, default: null }
}, { timestamps: true });

schoolDonationCampaignSchema.index({ schoolId: 1, status: 1 });
schoolDonationCampaignSchema.index({ schoolId: 1, category: 1 });
schoolDonationCampaignSchema.index({ schoolId: 1, isPublic: 1, status: 1 });

module.exports = mongoose.model('SchoolDonationCampaign', schoolDonationCampaignSchema);