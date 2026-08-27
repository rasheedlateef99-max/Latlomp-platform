'use strict';
/* ============================================
   LATLOMP INSTITUTION — PROMOTION SERVICE

   Eligibility evaluation and academic transition
   logic. Consumed by inst.promotion.routes.js.

   Does NOT modify student records — that happens
   in the routes (execute step).
   Does NOT modify results, attendance, or payments.
   Only READS from authoritative systems.
============================================ */

const SchoolResult = require('../models/SchoolResult.model');

/* Graceful attendance model loader */
function getAttendanceModel() {
  var attempts = ['../models/SchoolAttendance.model', '../models/Attendance.model'];
  for (var i = 0; i < attempts.length; i++) {
    try { return require(attempts[i]); } catch (e) { /* next */ }
  }
  return null;
}

/* ============================================
   getEffectivePolicy(schoolId, classId)
   Returns the applicable promotion policy.
   Priority: class-specific > school-wide > defaults
============================================ */
async function getEffectivePolicy(schoolId, classId) {
  var PromotionPolicy = require('../models/PromotionPolicy.model');

  /* Try class-specific override first */
  if (classId) {
    var classPolicy = await PromotionPolicy.findOne({
      schoolId: schoolId, classId: classId, isActive: true
    }).lean();
    if (classPolicy) { return classPolicy; }
  }

  /* Fall back to school-wide policy */
  var schoolPolicy = await PromotionPolicy.findOne({
    schoolId: schoolId, classId: null, isActive: true
  }).lean();
  if (schoolPolicy) { return schoolPolicy; }

  /* Safe defaults — no policy configured yet */
  return {
    checkAcademicPerformance: true,
    minScorePercent:          50,
    checkAttendance:          false,
    minAttendancePercent:     0,
    requireFeesClearance:     false,
    allowOverride:            true,
    _isDefault:               true
  };
}

/* ============================================
   findNextClass(currentClassId, schoolId)
   Returns the next class by sortOrder, or null
   if the student is at the highest active level.
   null = graduation candidate (admin still decides).
============================================ */
async function findNextClass(currentClassId, schoolId) {
  if (!currentClassId) { return null; }
  var SchoolClass = require('../models/Class.model');
  var current = await SchoolClass.findOne({ _id: currentClassId, schoolId: schoolId }).lean();
  if (!current) { return null; }

  /* Find next active class strictly above current sortOrder */
  var next = await SchoolClass.findOne({
    schoolId:  schoolId,
    isActive:  true,
    sortOrder: { $gt: current.sortOrder }
  }).sort({ sortOrder: 1 }).lean();

  return next; /* null → graduation candidate */
}

/* ============================================
   evaluateStudentEligibility(student, policy, sourceTermId)
   Reads results/attendance/fees for the term.
   Returns evaluation object — does NOT modify student.
============================================ */
async function evaluateStudentEligibility(student, policy, sourceTermId) {
  var result = {
    eligibilityStatus: 'eligible',
    failedCriteria:    [],
    academicScore:     null,
    attendanceRate:    null,
    feesCleared:       null,
    recommendation:    'promote'
  };

  /* ---- Academic performance ---- */
  if (policy.checkAcademicPerformance && policy.minScorePercent > 0) {
    try {
      var results = await SchoolResult.find({
        schoolId:  student.schoolId,
        studentId: student._id,
        termId:    sourceTermId
      }).select('scorePercent').lean();

      if (results.length > 0) {
        var sum = results.reduce(function (s, r) { return s + (r.scorePercent || 0); }, 0);
        result.academicScore = Math.round((sum / results.length) * 100) / 100;

        if (result.academicScore < policy.minScorePercent) {
          result.failedCriteria.push('academic_performance');
          result.eligibilityStatus = 'not_eligible';
          result.recommendation    = 'repeat';
        }
      }
      /* No results found → cannot evaluate → no penalty */
    } catch (e) { /* Results model unavailable — skip */ }
  }

  /* ---- Attendance ---- */
  if (policy.checkAttendance && policy.minAttendancePercent > 0) {
    var Attendance = getAttendanceModel();
    if (Attendance) {
      try {
        var attendanceFilter = {
          schoolId:  student.schoolId,
          studentId: student._id
        };
        var records = await Attendance.find(attendanceFilter).lean();
        if (records.length > 0) {
          var present = records.filter(function (r) { return r.status === 'present'; }).length;
          result.attendanceRate = Math.round((present / records.length) * 10000) / 100;

          if (result.attendanceRate < policy.minAttendancePercent) {
            result.failedCriteria.push('attendance');
            if (result.eligibilityStatus === 'eligible') {
              result.eligibilityStatus = 'attendance_hold';
            }
            if (result.recommendation === 'promote') {
              result.recommendation = 'review';
            }
          }
        }
      } catch (e) { /* Attendance model unavailable — skip */ }
    }
  }

  /* ---- Financial clearance ---- */
  if (policy.requireFeesClearance) {
    try {
      var SchoolFeeAssignment = require('../models/SchoolFeeAssignment.model');
      var pendingCount = await SchoolFeeAssignment.countDocuments({
        schoolId:  student.schoolId,
        studentId: student._id,
        termId:    sourceTermId,
        status:    { $in: ['pending', 'partial'] }
      });
      result.feesCleared = pendingCount === 0;
      if (!result.feesCleared) {
        result.failedCriteria.push('financial_clearance');
        if (result.eligibilityStatus === 'eligible') {
          result.eligibilityStatus = 'financial_hold';
        }
      }
    } catch (e) { result.feesCleared = null; }
  }

  /* Multiple failures → requires_review */
  if (result.failedCriteria.length > 1) {
    result.eligibilityStatus = 'requires_review';
    result.recommendation    = 'review';
  }

  return result;
}

module.exports = { getEffectivePolicy, findNextClass, evaluateStudentEligibility };