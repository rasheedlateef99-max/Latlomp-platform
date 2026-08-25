'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — FEE ASSIGNMENT MODEL

   Records which student owes which fee.
   Created in bulk (assign to whole class) or
   individually (assign to one student).

   Status lifecycle:
     pending  → student has been assigned this fee
     partial  → some payment made, balance remains
     paid     → fully settled
     waived   → fee waived by admin (with reason)
     cancelled→ assignment cancelled/removed
============================================ */
const schoolFeeAssignmentSchema = new mongoose.Schema({
  schoolId:       { type: mongoose.Schema.Types.ObjectId, ref: 'School',           required: true },
  studentId:      { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolStudent',    required: true },
  feeStructureId: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolFeeStructure', required: true },
  termId:         { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicTerm',     default: null },
  classId:        { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolClass',      default: null },

  /* ---- Amounts ---- */
  amountDue:     { type: Number, required: true, min: 0 },
  discount:      { type: Number, default: 0, min: 0 },      /* flat amount waived */
  amountPaid:    { type: Number, default: 0, min: 0 },
  balance: {
    type: Number,
    default: function() { return this.amountDue - this.discount; }
  },

  /* ---- Dates ---- */
  dueDate:    { type: Date, default: null },
  paidAt:     { type: Date, default: null },  /* when fully settled */

  /* ---- Status ---- */
  status: {
    type:    String,
    enum:    ['pending', 'partial', 'paid', 'waived', 'cancelled'],
    default: 'pending'
  },

  /* ---- Waiver ---- */
  waivedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  waivedReason: { type: String, default: '' },

  /* ---- Audit ---- */
  assignedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null }
}, { timestamps: true });

schoolFeeAssignmentSchema.index({ schoolId: 1 });
schoolFeeAssignmentSchema.index({ schoolId: 1, studentId: 1 });
schoolFeeAssignmentSchema.index({ schoolId: 1, termId: 1 });
schoolFeeAssignmentSchema.index({ schoolId: 1, status: 1 });
schoolFeeAssignmentSchema.index({ schoolId: 1, studentId: 1, feeStructureId: 1 },
  { unique: true, sparse: true });  /* prevent duplicate assignments */

module.exports = mongoose.model('SchoolFeeAssignment', schoolFeeAssignmentSchema);