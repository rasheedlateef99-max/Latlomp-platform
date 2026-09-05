/* ============================================
   LATLOMP INSTITUTION — SCHOOL DEPARTMENT MODEL

   Represents a department within polytechnics,
   universities, or colleges of education.
   NOT used for primary/secondary schools.

   Named 'SchoolDepartment' (not 'Department') to
   avoid collision with the main platform's CBT
   Department model — established naming rule from
   Phase A architecture decisions.

   ✅ E8B ADDITION:
   websiteDescription, websiteImageUrl,
   showOnWebsite, websiteDisplayOrder
   are website-only presentation fields.
   All existing academic/operational fields
   and E7A functionality are completely unchanged.
============================================ */
'use strict';

const mongoose = require('mongoose');

const schoolDepartmentSchema = new mongoose.Schema(
  {
    /* ---- Tenant isolation ---- */
    schoolId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'School',
      required: true
    },

    /* ---- Identity ---- */
    name: {
      type:     String,
      required: true,
      trim:     true
    },

    code: {
      type:    String,
      default: '',
      trim:    true
    },

    /* ---- Faculty (for universities) ---- */
    faculty: {
      type:    String,
      default: ''
    },

    /* ---- Description (internal/academic) ---- */
    description: {
      type:    String,
      default: ''
    },

    /* ---- Head of Department ---- */
    hodId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'SchoolUser',
      default: null
    },

    /* ---- Status ---- */
    isActive: {
      type:    Boolean,
      default: true
    },

    /* ---- E8B: Website presentation fields ----
       Orthogonal to academic/operational data.
       showOnWebsite = explicit opt-in for public website.
       websiteDescription = public-facing text (may differ
       from internal description).
       Do NOT modify academic fields here. */
    websiteDescription:  { type: String,  default: '' },
    websiteImageUrl:     { type: String,  default: '' },
    showOnWebsite:       { type: Boolean, default: false },
    websiteDisplayOrder: { type: Number,  default: 0 }
  },
  { timestamps: true }
);

/* ---- E7A indexes (unchanged) ---- */
schoolDepartmentSchema.index({ schoolId: 1 });
schoolDepartmentSchema.index({ schoolId: 1, name: 1 });
schoolDepartmentSchema.index(
  { schoolId: 1, name: 1 },
  { unique: true }
);

/* ---- E8B index: public website queries ---- */
schoolDepartmentSchema.index({ schoolId: 1, showOnWebsite: 1, websiteDisplayOrder: 1 });

module.exports = mongoose.model('SchoolDepartment', schoolDepartmentSchema);