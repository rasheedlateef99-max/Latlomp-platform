'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — PROMOTION POLICY

   One school-wide policy (classId: null) plus
   optional per-class overrides (classId set).
   Phase S reads class-specific first, falls back
   to school-wide, then to safe defaults.

   Does not hard-code any academic structure.
   All thresholds are institution-configurable.
============================================ */
const promotionPolicySchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true
  },
  /* null = school-wide. Set = class-specific override */
  classId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolClass',
    default: null
  },

  /* ---- Academic performance ---- */
  checkAcademicPerformance: { type: Boolean, default: true  },
  minScorePercent:          { type: Number,  default: 50, min: 0, max: 100 },

  /* ---- Attendance ---- */
  checkAttendance:        { type: Boolean, default: false },
  minAttendancePercent:   { type: Number,  default: 0, min: 0, max: 100 },

  /* ---- Financial clearance ---- */
  requireFeesClearance: { type: Boolean, default: false },

  /* ---- Administrative override permission ---- */
  allowOverride: { type: Boolean, default: true },

  /* ---- ✅ E1A: Required subject rules ---- */
  /* True: student must pass all core (isCore=true) subjects */
  requireCoreSubjectPass: { type: Boolean, default: false },
  coreSubjectMinScore:    { type: Number,  default: 50, min: 0, max: 100 },
  /* null = no limit. Number = max subjects allowed to fail */
  maxFailedSubjects:      { type: Number,  default: null },
  /* Incremented on every save — stored in evaluation policySnapshot for audit */
  policyVersion:          { type: Number,  default: 1 },

  isActive: { type: Boolean, default: true }
}, { timestamps: true });

promotionPolicySchema.index({ schoolId: 1 });
/* Allow finding class-specific or school-wide in one query */
promotionPolicySchema.index({ schoolId: 1, classId: 1 });

promotionPolicySchema.pre('findOneAndUpdate', function() {
  var update = this.getUpdate();
  if (update && update.$set) {
    update.$inc = update.$inc || {};
    update.$inc.policyVersion = 1;
  }
});

module.exports = mongoose.model('PromotionPolicy', promotionPolicySchema);