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
    enum:    ['tuition', 'levy', 'exam', 'development', 'transport', 'boarding', 'other'],
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

  /* ---- Status ---- */
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

schoolFeeStructureSchema.index({ schoolId: 1 });
schoolFeeStructureSchema.index({ schoolId: 1, termId: 1 });
schoolFeeStructureSchema.index({ schoolId: 1, isActive: 1 });

module.exports = mongoose.model('SchoolFeeStructure', schoolFeeStructureSchema);