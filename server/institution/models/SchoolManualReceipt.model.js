'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP — SCHOOL MANUAL RECEIPT MODEL

   Stores receipts issued manually by school staff
   for payments received outside the LatLomp Finance
   verification workflow.

   IMPORTANT: This is a receipt document only.
   It does NOT create a SchoolFeePayment, trigger
   fee allocation, or affect progress calculations.
   It is an operational tool for schools to issue
   professional receipts for payments already received.

   Official Finance receipts are tied to verified
   SchoolFeePayment records (separate system).

   schoolId:  always from JWT (instProtect) — never from body.
   receiptNumber: from SchoolCounter 'mrpt:<schoolId>' — atomic.
============================================ */
const schoolManualReceiptSchema = new mongoose.Schema({

  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true,
    index:    true
  },

  /* ── Receipt identity ── */
  receiptNumber: {
    type:     String,
    required: true
    /* Format: MR-YYYYMMDD-XXXX, generated server-side from SchoolCounter */
  },

  status: {
    type:    String,
    enum:    ['issued', 'voided'],
    default: 'issued',
    index:   true
  },

  /* ── Payer / Customer ── */
  payerName: {
    type:     String,
    required: true,
    trim:     true
  },

  payerPhone: { type: String, default: '', trim: true },
  payerEmail: { type: String, default: '', trim: true, lowercase: true },

  /* ── Student (optional — not every receipt is school-fee related) ── */
  studentName: { type: String, default: '', trim: true },
  studentClass:{ type: String, default: '', trim: true },
  admissionNo: { type: String, default: '', trim: true },

  /* ── Payment details ── */
  description: {
    type:     String,
    required: true,
    trim:     true,
    maxlength: 500
    /* What was paid for, e.g. "First Term School Fees 2026/2027" */
  },

  amount: {
    type:     Number,
    required: true,
    min:      0.01
  },

  currency: {
    type:     String,
    required: true,
    trim:     true,
    uppercase: true
    /* Standard ISO code: NGN, USD, GBP, EUR, GHS, KES, etc. */
  },

  paymentMethod: {
    type:    String,
    enum:    ['cash', 'bank_transfer', 'cheque', 'pos', 'mobile_money', 'ussd', 'other'],
    default: 'cash'
  },

  paymentDate: {
    type:    Date,
    required: true
    /* When the payment was received by the school, not when receipt was issued */
  },

  reference: {
    type:    String,
    default: '',
    trim:    true
    /* Teller number, transaction reference, cheque number, etc. */
  },

  notes: {
    type:      String,
    default:   '',
    trim:      true,
    maxlength: 500
  },

  /* ── Staff who issued the receipt ── */
  issuedBy: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolUser',
    default: null
    /* The authenticated user who created this record */
  },

  issuedByName: {
    type:    String,
    default: '',
    trim:    true
    /* Free-text name shown on the receipt (may differ from login name) */
  },

  issuedAt: {
    type:    Date,
    default: Date.now
  },

  /* ── Void trail ── */
  voidedAt: { type: Date, default: null },

  voidedBy: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolUser',
    default: null
  },

  voidedByName: { type: String, default: '' },
  voidReason:   { type: String, default: '', trim: true }

}, { timestamps: true });

/* ── Indexes ── */
schoolManualReceiptSchema.index({ schoolId: 1, createdAt: -1 });
schoolManualReceiptSchema.index({ schoolId: 1, receiptNumber: 1 }, { unique: true });
schoolManualReceiptSchema.index({ schoolId: 1, status: 1, createdAt: -1 });
schoolManualReceiptSchema.index({ schoolId: 1, payerName: 'text', studentName: 'text' });

module.exports = mongoose.model('SchoolManualReceipt', schoolManualReceiptSchema);