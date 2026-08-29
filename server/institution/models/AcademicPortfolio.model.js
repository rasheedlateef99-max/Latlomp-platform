'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — ACADEMIC PORTFOLIO (E2)

   Lightweight identity anchor. One per student
   per school enrollment. Survives all lifecycle
   transitions: active → graduated → alumni.

   Does NOT store results, scores, attendance,
   payments, or class history. Those authoritative
   systems remain unchanged.

   Extension points for future phases:
   alumniProfileId → E6 Alumni Network
   transcriptRef   → E5 Transcript & Verification
============================================ */
const academicPortfolioSchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true
  },
  studentId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'SchoolStudent',
    required: true
  },

  /* ---- Lifecycle status ---- */
  portfolioStatus: {
    type:    String,
    enum:    ['active', 'graduated', 'alumni', 'transferred', 'archived', 'inactive'],
    default: 'active'
  },

  /* ---- Visibility controls per category ---- */
  visibility: {
    scores:       { type: Boolean, default: true  },
    attendance:   { type: Boolean, default: true  },
    achievements: { type: Boolean, default: true  },
    discipline:   { type: Boolean, default: false } /* confidential — never default-visible */
  },

  /* ---- Institution-defined metadata ---- */
  /* Arbitrary key-value pairs for institution-specific fields.
     Examples: scholarship flag, special programmes, etc. */
  metadata: {
    type: Map, of: mongoose.Schema.Types.Mixed, default: {}
  },

  /* ---- Cache invalidation timestamp ---- */
  /* Set to null when authoritative data changes (promotion, new score, etc.)
     Portfolio service uses this to decide whether to re-aggregate. */
  lastComputedAt: { type: Date, default: null },

  /* ---- E6 extension point (Alumni Network) ---- */
  alumniProfileId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'AlumniProfile',   /* created by E6 */
    default: null
  },

  /* ---- E5 extension point (Transcript) ---- */
  /* Reference to the last issued official transcript record */
  lastTranscriptRef: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'TranscriptRequest', /* created by E5 */
    default: null
  }
}, { timestamps: true });

/* One portfolio per student per school enrollment */
academicPortfolioSchema.index({ schoolId: 1, studentId: 1 }, { unique: true });
academicPortfolioSchema.index({ schoolId: 1, portfolioStatus: 1 });
academicPortfolioSchema.index({ studentId: 1 });

module.exports = mongoose.model('AcademicPortfolio', academicPortfolioSchema);