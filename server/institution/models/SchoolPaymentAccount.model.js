'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — SCHOOL PAYMENT ACCOUNT
   Provider-extensible. No secret keys stored.
   Paystack subaccount model: school provides
   bank account → Paystack creates subaccount →
   we store the subaccount_code only.

   STATUS FLOW:
   not_connected → pending_verification → active
   active → suspended
   pending_verification → failed
============================================ */
const schoolPaymentAccountSchema = new mongoose.Schema({
  schoolId: {
    type: mongoose.Schema.Types.ObjectId, ref: 'School',
    required: true, unique: true
  },

  /* ---- Provider ---- */
  provider: {
    type: String,
    enum: ['paystack', 'flutterwave', 'stripe', 'opay', 'palmpay', 'other'],
    default: 'paystack'
  },

  /* ---- Provider identifiers (no secret keys) ---- */
  providerAccountId:   { type: String, default: '' }, /* Paystack: numeric subaccount id */
  providerAccountCode: { type: String, default: '' }, /* Paystack: ACCT_xxxx */

  /* ---- Settlement bank (for display + verification) ---- */
  settlementBankCode:      { type: String, default: '' },
  settlementBankName:      { type: String, default: '' },
  settlementAccountNumber: { type: String, default: '' },
  settlementAccountName:   { type: String, default: '' }, /* verified by provider */

  /* ---- Currency ---- */
  currency: { type: String, default: 'NGN' },

  /* ---- Business info sent to provider ---- */
  businessName:        { type: String, default: '' },
  businessDescription: { type: String, default: '' },

  /* ---- Status ---- */
  status: {
    type:    String,
    enum:    ['not_connected', 'pending_verification', 'active', 'suspended', 'failed'],
    default: 'not_connected'
  },
  statusReason:          { type: String, default: '' },
  onlinePaymentsEnabled: { type: Boolean, default: false }, /* school-level toggle */

  /* ---- Audit ---- */
  verifiedAt:  { type: Date, default: null },
  connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  suspendedAt: { type: Date, default: null }
}, { timestamps: true });

schoolPaymentAccountSchema.index({ schoolId: 1 }, { unique: true });
schoolPaymentAccountSchema.index({ provider: 1, status: 1 });

module.exports = mongoose.model('SchoolPaymentAccount', schoolPaymentAccountSchema);