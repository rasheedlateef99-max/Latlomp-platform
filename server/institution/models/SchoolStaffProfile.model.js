'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — SCHOOL STAFF PROFILE (E8B)

   Website-ONLY public presentation layer for staff.

   SchoolUser.model.js remains the AUTHORITATIVE
   identity for authentication and RBAC.
   This model stores ONLY what appears on the
   public school website — nothing private.

   staffUserId → FK to SchoolUser (never duplicated).
   One profile per staff member per school.

   Public website queries:
     showOnWebsite === true, sorted by displayOrder.
   Private fields from SchoolUser are NEVER exposed.
============================================ */
const schoolStaffProfileSchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true
  },

  /* FK to SchoolUser — identity not duplicated */
  staffUserId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'SchoolUser',
    required: true
  },

  /* ---- Website-only public fields ---- */
  publicTitle:    { type: String, default: '' },  /* "Head of Mathematics" */
  publicBio:      { type: String, default: '' },  /* public biography */
  publicPhotoUrl: { type: String, default: '' },  /* public portrait URL */
  publicPhotoMediaId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolWebsiteMedia',
    default: null
  },

  /* Subjects to display publicly (display names only) */
  publicSubjects: { type: [String], default: [] },

  /* ---- Display grouping ---- */
  category: {
    type:    String,
    enum:    ['leadership', 'teaching', 'support'],
    default: 'teaching'
  },

  /* ---- Visibility control ---- */
  showOnWebsite: { type: Boolean, default: false },
  displayOrder:  { type: Number,  default: 0 },

  /* ---- Audit ---- */
  updatedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  updatedByName: { type: String, default: '' }

}, { timestamps: true });

schoolStaffProfileSchema.index({ schoolId: 1, showOnWebsite: 1, displayOrder: 1 });
schoolStaffProfileSchema.index({ schoolId: 1, category: 1, showOnWebsite: 1 });
schoolStaffProfileSchema.index({ staffUserId: 1, schoolId: 1 }, { unique: true });

module.exports = mongoose.model('SchoolStaffProfile', schoolStaffProfileSchema);