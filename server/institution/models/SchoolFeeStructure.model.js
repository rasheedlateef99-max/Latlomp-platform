'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — FEE STRUCTURE MODEL

   Defines a fee type that a school charges.
   Examples: School Fees, PTA Levy, Development
   Fund, Lab Fee, Exam Fee, etc.

   A fee structure can be:
   - School-wide (classIds empty = applies to all)
   - Class-specific (classIds = [JSS1, JSS2, ...])
   - Term-specific (termId set)
   - Session-wide (termId null)
============================================ */
const schoolFeeStructureSchema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },

  /* ---- Identity ---- */
  name:        { type: String, required: true, trim: true }, /* e.g. "School Fees", "PTA Levy" */
  description: { type: String, default: '' },
  category: {
    type:    String,
    enum:    ['tuition', 'levy', 'exam', 'development', 'transport', 'boarding',
              'registration', 'admission', 'graduation', 'competition',
              'uniform', 'books', 'activity', 'programme', 'other'],
    default: 'tuition'
  },

  /* ---- Amount ---- */
  amount: { type: Number, required: true, min: 0 },

  /* ---- Scope ---- */
  /* Which term this fee applies to. null = all terms. */
  termId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicTerm', default: null },

  /* Which classes this fee applies to. empty = all classes. */
  classIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SchoolClass' }],

  /* ---- Due date ---- */
  dueDate: { type: Date, default: null },

  /* ---- Currency (ISO code) ---- */
  currency: { type: String, default: 'NGN' },

  /* ---- P3: Flexible amount ---- */
  /* isFlexible:true → amount = 0; minAmount/maxAmount define the acceptable range.
     Assignment engine uses amount for fixed fees.
     For flexible items the payer declares their own amount (≥ minAmount). */
  isFlexible: { type: Boolean, default: false },
  minAmount:  { type: Number, default: 0, min: 0 },
  maxAmount:  { type: Number, default: null },   /* null = no upper cap */

  /* ---- P3: Audience & access ---- */
  targetAudience: {
    type:    [String],
    enum:    ['student', 'parent', 'alumni', 'staff', 'all'],
    default: ['student', 'parent']
  },

  /* ---- P3: Linked payment account ----
     ObjectId reference only — bank details are never copied here.
     Resolved server-side via GET /fee/structures/:id/payment-account.
     P6 deletion-protection hook guards this reference. */
  paymentAccountId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolManualPaymentAccount',
    default: null
  },

  allowPartial: { type: Boolean, default: true },

  /* ---- P3: Visibility & publication ---- */
  visibility: {
    type:    String,
    enum:    ['internal', 'portal', 'website', 'community'],
    default: 'portal'
  },
  /* publishedOn controls explicit website / community publication (P9) */
  publishedOn: { type: [String], default: [] },

  /* ---- Status ---- */
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

schoolFeeStructureSchema.index({ schoolId: 1 });
schoolFeeStructureSchema.index({ schoolId: 1, termId: 1 });
schoolFeeStructureSchema.index({ schoolId: 1, isActive: 1 });

module.exports = mongoose.model('SchoolFeeStructure', schoolFeeStructureSchema);