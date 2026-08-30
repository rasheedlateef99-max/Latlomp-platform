'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — ALUMNI PROFILE (E6)

   Extension of AcademicPortfolio.
   References SchoolStudent + AcademicPortfolio.
   Does NOT duplicate: grades, class history,
   results, attendance, transcripts, promotion data.

   AcademicPortfolio.alumniProfileId ← points here.
   Snapshot fields (alumniSince, lastClassName)
   are performance snapshots captured at graduation.
   They are NEVER updated from authoritative sources.
============================================ */
const alumniProfileSchema = new mongoose.Schema({
  schoolId:    { type: mongoose.Schema.Types.ObjectId, ref: 'School',           required: true },
  studentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolStudent',    required: true },
  portfolioId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicPortfolio', required: true },

  /* ---- Alumni-owned display info ---- */
  displayName: { type: String, default: '', trim: true }, /* preferred public name */
  bio:         { type: String, default: '', maxlength: 500 },
  location:    {
    city:    { type: String, default: '' },
    country: { type: String, default: '' }
  },

  /* ---- Professional (alumni-owned) ---- */
  profession:  { type: String, default: '' },
  industry:    { type: String, default: '' },
  organisation:{ type: String, default: '' },
  skills:      [String], /* lightweight — separate from PortfolioEntry.skills */

  /* ---- Mentorship preferences ---- */
  mentorshipAvailable: { type: Boolean, default: false },
  mentorshipAreas:     [String],
  maxMentees:          { type: Number, default: 2, min: 1 },

  /* ---- Privacy & visibility ---- */
  directoryVisibility: {
    type:    String,
    enum:    ['private', 'alumni_only', 'public'],
    default: 'alumni_only' /* C4: default confirmed */
  },
  contactPreferences: {
    showEmail: { type: Boolean, default: false },
    showPhone: { type: Boolean, default: false }
  },

  /* ---- Graduation snapshots (captured once at graduation) ---- */
  alumniSince:       { type: Date,   default: null },
  graduationSession: { type: String, default: '' }, /* e.g. "2024/2025" */
  lastClassName:     { type: String, default: '' }, /* display-only snapshot */

  /* ---- Alumni lifecycle ---- */
  status: {
    type:    String,
    enum:    ['active', 'inactive', 'archived', 'deceased'],
    default: 'active'
  },
  lastActiveAt:      { type: Date, default: null },

  /* ---- Audit ---- */
  activatedAt:       { type: Date, default: Date.now },
  activatedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  deactivatedAt:     { type: Date, default: null },
  deactivatedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  deactivationReason:{ type: String, default: '' }
}, { timestamps: true });

alumniProfileSchema.index({ schoolId: 1, studentId: 1 }, { unique: true });
alumniProfileSchema.index({ schoolId: 1, status: 1 });
alumniProfileSchema.index({ schoolId: 1, directoryVisibility: 1, status: 1 });
alumniProfileSchema.index({ schoolId: 1, mentorshipAvailable: 1, status: 1 });
alumniProfileSchema.index({ schoolId: 1, industry: 1 });
alumniProfileSchema.index({ studentId: 1 });

module.exports = mongoose.model('AlumniProfile', alumniProfileSchema);