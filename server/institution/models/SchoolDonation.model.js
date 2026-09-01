'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP — SCHOOL DONATION (E7B)

   Individual donation records.
   paymentRef references R2 Paystack transaction.
   Does NOT duplicate payment transaction data.

   donorType:
     alumni   → AlumniProfile._id in donorId
     parent   → SchoolParent._id in donorId
     staff    → SchoolUser._id in donorId
     external → no platform identity
============================================ */
const schoolDonationSchema = new mongoose.Schema({
  schoolId:   { type: mongoose.Schema.Types.ObjectId, ref: 'School',                 required: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolDonationCampaign', default: null },

  donorType: {
    type:    String,
    enum:    ['alumni','parent','staff','student','external'],
    default: 'external'
  },
  donorId:    { type: mongoose.Schema.Types.ObjectId, default: null }, /* flexible ref */
  donorName:  { type: String, default: '' },
  donorEmail: { type: String, default: '' },
  isAnonymous:{ type: Boolean, default: false },

  amount:   { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'NGN' },

  /* R2 payment reference — never stores transaction details */
  paymentRef:    { type: String, default: null },
  paymentStatus: {
    type:    String,
    enum:    ['pending','completed','failed','refunded'],
    default: 'pending'
  },

  message: { type: String, default: '', maxlength: 500 },
  status:  { type: String, enum: ['pending','confirmed','cancelled'], default: 'pending' },

  acknowledgedAt:     { type: Date, default: null },
  acknowledgedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  acknowledgedByName: { type: String, default: '' },

  recordedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  recordedByName: { type: String, default: '' }
}, { timestamps: true });

schoolDonationSchema.index({ schoolId: 1, campaignId: 1 });
schoolDonationSchema.index({ schoolId: 1, donorType: 1, status: 1 });
schoolDonationSchema.index({ schoolId: 1, status: 1, paymentStatus: 1 });
schoolDonationSchema.index({ paymentRef: 1 }, { sparse: true });

module.exports = mongoose.model('SchoolDonation', schoolDonationSchema);