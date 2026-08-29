'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — PORTFOLIO ENTRY (E2)

   Single polymorphic model for all portfolio
   additions that have no existing authoritative
   home: awards, achievements, skills, milestones,
   and disciplinary references.

   IMPORTANT: This model stores NEW information
   only. It never duplicates result, score,
   attendance, or payment records.

   entryType:
     award          — formal institutional award
     achievement    — academic/extracurricular
     skill          — certified skill record
     milestone      — academic milestone
     discipline_ref — reference only (isConfidential:true)
============================================ */
const portfolioEntrySchema = new mongoose.Schema({
  schoolId:    { type: mongoose.Schema.Types.ObjectId, ref: 'School',          required: true },
  studentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolStudent',   required: true },
  portfolioId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicPortfolio', required: true },

  entryType: {
    type:     String,
    enum:     ['award', 'achievement', 'skill', 'milestone', 'discipline_ref'],
    required: true
  },

  /* ---- Content ---- */
  title:       { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  date:        { type: Date,   default: null },
  evidence:    { type: String, default: '' }, /* URL or description of evidence */

  /* ---- Academic context (optional) ---- */
  termId:      { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicTerm', default: null },
  academicYear:{ type: String, default: '' },

  /* ---- Attribution ---- */
  issuedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  issuedByName: { type: String, default: '' }, /* snapshot for audit */

  /* ---- Access control ---- */
  /* discipline_ref entries must always have isConfidential: true.
     Other types may be marked confidential at admin discretion. */
  isConfidential: { type: Boolean, default: false },

  /* ---- Status ---- */
  status: {
    type:    String,
    enum:    ['active', 'revoked'],
    default: 'active'
  },
  revokedReason: { type: String, default: '' },
  revokedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  revokedAt:     { type: Date, default: null }
}, { timestamps: true });

portfolioEntrySchema.index({ schoolId: 1, studentId: 1 });
portfolioEntrySchema.index({ portfolioId: 1 });
portfolioEntrySchema.index({ schoolId: 1, entryType: 1 });
portfolioEntrySchema.index({ schoolId: 1, studentId: 1, entryType: 1 });

module.exports = mongoose.model('PortfolioEntry', portfolioEntrySchema);