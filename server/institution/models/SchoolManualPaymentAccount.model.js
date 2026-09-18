'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP — SCHOOL MANUAL PAYMENT ACCOUNT (P2)

   School-configured bank/payment details.
   NO Paystack. NO provider verification.
   School manually enters their own bank details.
   LatLomp stores and displays them securely.

   KEY ARCHITECTURAL DECISIONS:
   - No unique: true on schoolId — one school may
     have multiple accounts (NGN, USD, dev fund, etc.)
   - No provider fields — this is pure display data
   - schoolId ALWAYS from authenticated JWT (instProtect)
   - Account number is intentionally shared information
     (shown to payers so they can make transfers)
   - Separate from SchoolPaymentAccount (Paystack model)
     which is NOT modified

   P9 hook: portals consume active accounts via
   GET /api/institution/fee/manual-accounts/active
============================================ */
const schoolManualPaymentAccountSchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true
    /* NOTE: NO unique: true — multiple accounts per school are valid */
  },

  /* ---- Identity ---- */
  accountLabel: {
    type:     String,
    required: true,
    trim:     true
    /* e.g. "Main NGN Account", "Development Fund", "USD Account" */
  },
  accountType: {
    type:    String,
    enum:    ['main', 'development', 'foreign', 'event', 'operational', 'other'],
    default: 'main'
  },

  /* ---- Bank details (all manually entered by school admin) ---- */
  bankName: {
    type:     String,
    required: true,
    trim:     true
  },
  accountName: {
    type:     String,
    required: true,
    trim:     true
    /* The name as it appears on the bank account */
  },
  accountNumber: {
    type:     String,
    required: true,
    trim:     true
    /* Shown in full to authenticated payers — it is payment-instruction data */
  },

  /* ---- Location and currency ---- */
  country: {
    type:    String,
    default: 'NG',
    trim:    true
    /* ISO 3166-1 alpha-2 country code */
  },
  currency: {
    type:      String,
    default:   'NGN',
    trim:      true,
    uppercase: true
    /* ISO 4217 currency code */
  },

  /* ---- Instructions for payers ---- */
  instructions: {
    type:    String,
    default: '',
    trim:    true
    /* e.g. "Use student's full name as the payment reference" */
  },

  /* ---- Display control ---- */
  isActive:     { type: Boolean, default: true  },
  displayOrder: { type: Number,  default: 0     },
  /* isActive: false = account removed from payer display immediately */

  /* ---- Audit ---- */
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  createdByName: { type: String, default: '' },
  updatedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  updatedByName: { type: String, default: '' }

}, { timestamps: true, versionKey: false });

/* ---- Indexes ---- */
schoolManualPaymentAccountSchema.index({ schoolId: 1, isActive: 1 });
schoolManualPaymentAccountSchema.index({ schoolId: 1, displayOrder: 1, createdAt: -1 });
schoolManualPaymentAccountSchema.index({ schoolId: 1, currency: 1, isActive: 1 });

module.exports = mongoose.model('SchoolManualPaymentAccount', schoolManualPaymentAccountSchema);