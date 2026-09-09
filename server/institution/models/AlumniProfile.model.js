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

   ✅ E8F ADDITION:
   showOnWebsite — school-controlled flag.
   Orthogonal to directoryVisibility (alumni-owned).
   Both conditions required for public website display:
     directoryVisibility === 'public' AND showOnWebsite === true
   School staff toggle showOnWebsite only.
   School staff NEVER modify directoryVisibility — that
   belongs to the alumni through the E6 alumni portal.
============================================ */
const alumniProfileSchema = new mongoose.Schema({
  schoolId:    { type: mongoose.Schema.Types.ObjectId, ref: 'School',            required: true },
  studentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolStudent',     required: true },
  portfolioId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicPortfolio', required: true },

  /* ---- Alumni-owned display info ---- */
  displayName: { type: String, default: '', trim: true },
  bio:         { type: String, default: '', maxlength: 500 },
  location: {
    city:    { type: String, default: '' },
    country: { type: String, default: '' }
  },

  /* ---- Professional (alumni-owned) ---- */
  profession:   { type: String, default: '' },
  industry:     { type: String, default: '' },
  organisation: { type: String, default: '' },
  skills:       [String],

  /* ---- Mentorship preferences ---- */
  mentorshipAvailable: { type: Boolean, default: false },
  mentorshipAreas:     [String],
  maxMentees:          { type: Number, default: 2, min: 1 },

  /* ---- Privacy & visibility (ALUMNI-OWNED — never modified by school) ---- */
  directoryVisibility: {
    type:    String,
    enum:    ['private', 'alumni_only', 'public'],
    default: 'alumni_only'
  },
  contactPreferences: {
    showEmail: { type: Boolean, default: false },
    showPhone: { type: Boolean, default: false }
  },

  /* ---- Graduation snapshots (captured once at graduation) ---- */
  alumniSince:       { type: Date,   default: null },
  graduationSession: { type: String, default: '' },
  lastClassName:     { type: String, default: '' },

  /* ---- Alumni lifecycle ---- */
  status: {
    type:    String,
    enum:    ['active', 'inactive', 'archived', 'deceased'],
    default: 'active'
  },
  lastActiveAt: { type: Date, default: null },

  /* ---- E8F: School website display control ----
     School staff toggle this — alumni identity unchanged.
     directoryVisibility remains exclusively alumni-owned.
     Public website queries: directoryVisibility='public'
     AND showOnWebsite=true AND status='active'. */
  showOnWebsite: { type: Boolean, default: false },

  /* ---- Audit ---- */
  activatedAt:        { type: Date, default: Date.now },
  activatedBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  deactivatedAt:      { type: Date, default: null },
  deactivatedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  deactivationReason: { type: String, default: '' }

}, { timestamps: true });

/* ---- E6 indexes (unchanged) ---- */
alumniProfileSchema.index({ schoolId: 1, studentId: 1 }, { unique: true });
alumniProfileSchema.index({ schoolId: 1, status: 1 });
alumniProfileSchema.index({ schoolId: 1, directoryVisibility: 1, status: 1 });
alumniProfileSchema.index({ schoolId: 1, mentorshipAvailable: 1, status: 1 });
alumniProfileSchema.index({ schoolId: 1, industry: 1 });
alumniProfileSchema.index({ studentId: 1 });

/* ---- E8F index: public website alumni queries ---- */
alumniProfileSchema.index({ schoolId: 1, directoryVisibility: 1, showOnWebsite: 1, status: 1 });

module.exports = mongoose.model('AlumniProfile', alumniProfileSchema);