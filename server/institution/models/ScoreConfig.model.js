/* ============================================
   LATLOMP INSTITUTION — SCORE CONFIG MODEL
   ✅ PHASE L.1: Score Entry System (configurable)

   Lets each school define its OWN score structure:
   which components exist (First Test, Assignment,
   Practical, Exam, etc.), how many marks each is
   worth, and what grade boundaries apply.

   Every school gets a sensible default config
   auto-created on first use — 10/10/10/10/60 split
   with the standard Nigerian secondary grade scale.
   Schools that never touch this stay on the default
   forever. Schools that want control get it via
   Phase L.6's admin UI.

   ARCHITECTURE NOTE:
   One school can theoretically have multiple configs
   (e.g. a different split for senior vs junior
   classes in future), but for L.1–L.7 we ship ONE
   active config per school (isDefault: true), kept
   simple and safe. Multi-config-per-class-category
   is a clean future extension — the schema already
   supports it (just create more configs and reference
   by configId), but the UI in L.5/L.6 will only
   manage the single default for now.
============================================ */
'use strict';

const mongoose = require('mongoose');

/* ---- One score component (e.g. "First Test") ---- */
const scoreComponentSchema = new mongoose.Schema({
  key: {
    type:     String,
    required: true,
    trim:     true
    /* Machine-readable identifier, e.g. "firstTest".
       Used as the key in SchoolScore's scores map. */
  },
  label: {
    type:     String,
    required: true,
    trim:     true
    /* Human-readable, e.g. "First Test", "Continuous Assessment" */
  },
  maxScore: {
    type:     Number,
    required: true,
    min:      1
    /* Maximum marks obtainable for this component */
  },
  sortOrder: {
    type:    Number,
    default: 0
    /* Display order in score entry table and report card */
  }
}, { _id: false });

/* ---- One grade boundary (e.g. "A1: 75-100, Excellent") ---- */
const gradeBoundarySchema = new mongoose.Schema({
  grade: {
    type:     String,
    required: true,
    trim:     true
    /* e.g. "A1", "B2", "F9" — or any school-chosen label */
  },
  remark: {
    type:     String,
    required: true,
    trim:     true
    /* e.g. "Excellent", "Good", "Fail" */
  },
  minScore: {
    type:     Number,
    required: true
    /* Inclusive lower bound, as a PERCENTAGE (0-100) */
  },
  maxScore: {
    type:     Number,
    required: true
    /* Inclusive upper bound, as a PERCENTAGE (0-100) */
  }
}, { _id: false });

const scoreConfigSchema = new mongoose.Schema(
  {
    /* ---- Tenant isolation ---- */
    schoolId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'School',
      required: true
    },

    /* ---- Identity ---- */
    name: {
      type:    String,
      default: 'Default Score Structure',
      trim:    true
    },

    /* ---- The active config flag.
       Exactly one config per school should have this
       true at any time — enforced in application logic
       (getOrCreateDefault + future L.6 "set active"
       endpoint), not a hard DB constraint, to keep room
       for future multi-config support without a schema
       change. ---- */
    isDefault: {
      type:    Boolean,
      default: true
    },

    isActive: {
      type:    Boolean,
      default: true
    },

    /* ---- Score components ---- */
    components: {
      type:    [scoreComponentSchema],
      default: []
      /* Sum of all maxScore values does NOT need to
         equal 100 — calculation in L.3 normalizes to
         a percentage using the sum of maxScores as the
         denominator. This means a school can use any
         split (e.g. 20/20/20/20/20, or just 30/70) and
         grading still works correctly. */
    },

    /* ---- Grade boundaries (percentage-based) ---- */
    gradeBoundaries: {
      type:    [gradeBoundarySchema],
      default: []
    },

    createdBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'SchoolUser',
      default: null
    }
  },
  { timestamps: true }
);

scoreConfigSchema.index({ schoolId: 1 });
scoreConfigSchema.index({ schoolId: 1, isDefault: 1, isActive: 1 });

/* ============================================
   ✅ DEFAULT COMPONENTS
   10/10/10/10/60 = 100. Matches the standard
   Nigerian secondary school CA + Exam structure
   confirmed for this platform.
============================================ */
scoreConfigSchema.statics.getDefaultComponents = function () {
  return [
    { key: 'firstTest',   label: 'First Test',   maxScore: 10, sortOrder: 1 },
    { key: 'secondTest',  label: 'Second Test',  maxScore: 10, sortOrder: 2 },
    { key: 'assignment',  label: 'Assignment',   maxScore: 10, sortOrder: 3 },
    { key: 'practical',   label: 'Practical',    maxScore: 10, sortOrder: 4 },
    { key: 'examination', label: 'Examination',  maxScore: 60, sortOrder: 5 }
  ];
};

/* ============================================
   ✅ DEFAULT GRADE BOUNDARIES
   Standard Nigerian secondary 9-point scale.
   All boundaries are PERCENTAGES (0-100), so this
   works regardless of how a school splits its
   components — calculation always normalizes to %
   before grading.
============================================ */
scoreConfigSchema.statics.getDefaultGradeBoundaries = function () {
  return [
    { grade: 'A1', remark: 'Excellent',   minScore: 75, maxScore: 100 },
    { grade: 'B2', remark: 'Very Good',   minScore: 70, maxScore: 74  },
    { grade: 'B3', remark: 'Good',        minScore: 65, maxScore: 69  },
    { grade: 'C4', remark: 'Credit',      minScore: 60, maxScore: 64  },
    { grade: 'C5', remark: 'Credit',      minScore: 55, maxScore: 59  },
    { grade: 'C6', remark: 'Credit',      minScore: 50, maxScore: 54  },
    { grade: 'D7', remark: 'Pass',        minScore: 45, maxScore: 49  },
    { grade: 'E8', remark: 'Pass',        minScore: 40, maxScore: 44  },
    { grade: 'F9', remark: 'Fail',        minScore: 0,  maxScore: 39  }
  ];
};

/* ============================================
   ✅ GET OR CREATE — the safety net.
   Called by L.3's score routes before any
   calculation. Guarantees every school always has
   a usable config without requiring manual setup.
============================================ */
scoreConfigSchema.statics.getOrCreateDefault = async function (schoolId, createdBy) {
  var existing = await this.findOne({
    schoolId:  schoolId,
    isDefault: true,
    isActive:  true
  });

  if (existing) { return existing; }

  return this.create({
    schoolId:        schoolId,
    name:            'Default Score Structure',
    isDefault:       true,
    isActive:        true,
    components:      this.getDefaultComponents(),
    gradeBoundaries: this.getDefaultGradeBoundaries(),
    createdBy:       createdBy || null
  });
};

/* ============================================
   ✅ GRADE LOOKUP HELPER
   Given a config's gradeBoundaries and a computed
   percentage score, returns {grade, remark}.
   Used by L.3 so the calculation logic stays in
   one place rather than duplicated across routes.
============================================ */
scoreConfigSchema.statics.resolveGrade = function (gradeBoundaries, percentScore) {
  var boundaries = gradeBoundaries && gradeBoundaries.length
    ? gradeBoundaries
    : this.getDefaultGradeBoundaries();

  for (var i = 0; i < boundaries.length; i++) {
    var b = boundaries[i];
    if (percentScore >= b.minScore && percentScore <= b.maxScore) {
      return { grade: b.grade, remark: b.remark };
    }
  }

  /* Fallback if percentage falls outside all defined
     ranges (e.g. a school deletes a boundary by mistake) */
  return { grade: '—', remark: 'Ungraded' };
};

module.exports = mongoose.model('ScoreConfig', scoreConfigSchema);