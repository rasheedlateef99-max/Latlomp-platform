'use strict';
/* ============================================
   LATLOMP INSTITUTION — PROMOTION SERVICE (E1A)

   Enhanced for E1A finalization:
   ✅ checkPeriodReadiness()  — ScoreSubmission status
   ✅ getStudentScores()      — SchoolScore (approved)
   ✅ evaluateRequiredSubjects() — via subjectId ObjectId
   ✅ evaluateStudentProgression() — comprehensive + evidence
   ✅ evaluateCohort()        — optimized bulk evaluation
   ✅ policySnapshot          — policy audit traceability
   ✅ Missing data ≠ failure  — safe incomplete states

   Score source: SchoolScore (teacher-entered)
   NOT SchoolResult (CBT exam records)
   Readiness: ScoreSubmission.status = 'approved'

   Backward compatible: Phase S batch evaluation
   calls evaluateStudentEligibility() which wraps
   evaluateStudentProgression() automatically.
============================================ */

/* ---- Graceful model loaders ---- */
function getAttendanceModel() {
  var tries = ['../models/SchoolAttendance.model', '../models/Attendance.model'];
  for (var i = 0; i < tries.length; i++) {
    try { return require(tries[i]); } catch (e) {}
  }
  return null;
}
function getSchoolScoreModel() {
  try { return require('../models/SchoolScore.model'); } catch (e) { return null; }
}
function getScoreSubmissionModel() {
  try { return require('../models/ScoreSubmission.model'); } catch (e) { return null; }
}

/* ============================================
   checkPeriodReadiness(schoolId, classId, termId)

   READY:         ≥1 approved submission, 0 pending
   NOT_READY:     pending submissions exist
   INCOMPLETE:    no submissions at all
   ALL_REJECTED:  submissions exist but none approved
   DATA_UNAVAILABLE: model inaccessible
============================================ */
async function checkPeriodReadiness(schoolId, classId, termId) {
  var ScoreSubmission = getScoreSubmissionModel();
  if (!ScoreSubmission) {
    return {
      ready:  null,
      status: 'data_unavailable',
      detail: 'Score submission model not available on this installation.'
    };
  }
  try {
    var submissions = await ScoreSubmission.find({
      schoolId: schoolId, classId: classId, termId: termId
    }).select('status').lean();

    if (!submissions.length) {
      return {
        ready:  false,
        status: 'no_submissions',
        detail: 'No score submissions found for this class and term. Scores may not have been entered yet.'
      };
    }

    var pending  = submissions.filter(function(s) { return s.status === 'pending';  }).length;
    var approved = submissions.filter(function(s) { return s.status === 'approved'; }).length;
    var rejected = submissions.filter(function(s) { return s.status === 'rejected'; }).length;

    if (pending > 0) {
      return {
        ready:         false,
        status:        'pending_approval',
        pendingCount:  pending,
        approvedCount: approved,
        detail:        pending + ' score submission(s) pending approval. Evaluation should wait until all scores are reviewed.'
      };
    }
    if (approved > 0) {
      return {
        ready:         true,
        status:        'approved',
        approvedCount: approved,
        rejectedCount: rejected,
        detail:        approved + ' submission(s) approved. Period is ready for progression evaluation.'
      };
    }
    return {
      ready:  false,
      status: 'all_rejected',
      detail: 'All submissions are rejected. No approved academic data available for evaluation.'
    };
  } catch (e) {
    return { ready: null, status: 'data_unavailable', detail: 'Cannot check submission status: ' + e.message };
  }
}

/* ============================================
   getStudentScores(studentId, schoolId, termId)
   Returns SchoolScore records with populated
   subjectId for isCore evaluation.
============================================ */
async function getStudentScores(studentId, schoolId, termId) {
  var SchoolScore = getSchoolScoreModel();
  if (!SchoolScore) { return { scores: [], available: false }; }
  try {
    var scores = await SchoolScore.find({
      schoolId: schoolId, studentId: studentId, termId: termId
    }).populate('subjectId', 'name code isCore').lean();
    return { scores, available: true };
  } catch (e) {
    return { scores: [], available: false };
  }
}

/* ============================================
   evaluateRequiredSubjects(studentScores, policy)

   Uses subjectId.isCore — ObjectId reference,
   NOT string matching. Clean and reliable.
   Missing data returns null (not failure).
============================================ */
function evaluateRequiredSubjects(studentScores, policy) {
  if (!policy.requireCoreSubjectPass) {
    return { evaluated: false, passed: true, failedCoreSubjects: [], coreSubjectCount: 0 };
  }
  if (!studentScores.length) {
    return {
      evaluated: false, passed: null, failedCoreSubjects: [], coreSubjectCount: 0,
      detail: 'No score records to evaluate core subjects.'
    };
  }

  var coreScores = studentScores.filter(function(s) {
    return s.subjectId && s.subjectId.isCore === true;
  });
  if (!coreScores.length) {
    return {
      evaluated: false, passed: null, failedCoreSubjects: [], coreSubjectCount: 0,
      detail: 'No core subject records found. Configure isCore on subjects first.'
    };
  }

  var threshold  = policy.coreSubjectMinScore || 50;
  var failedCore = coreScores.filter(function(s) { return (s.percentage || 0) < threshold; });

  return {
    evaluated:        true,
    passed:           failedCore.length === 0,
    coreSubjectCount: coreScores.length,
    passedCoreCount:  coreScores.length - failedCore.length,
    failedCoreSubjects: failedCore.map(function(s) {
      return {
        subject:   s.subjectId ? (s.subjectId.name || 'Unknown') : 'Unknown',
        code:      s.subjectId ? (s.subjectId.code || '') : '',
        score:     s.percentage || 0,
        threshold
      };
    }),
    detail: failedCore.length === 0
      ? 'All ' + coreScores.length + ' core subject(s) passed.'
      : failedCore.length + ' of ' + coreScores.length + ' core subject(s) below threshold.'
  };
}

/* ============================================
   evaluateMaxFailedSubjects(studentScores, policy)
============================================ */
function evaluateMaxFailedSubjects(studentScores, policy) {
  if (policy.maxFailedSubjects === null || policy.maxFailedSubjects === undefined) {
    return { evaluated: false, passed: true };
  }
  if (!studentScores.length) {
    return { evaluated: false, passed: null, detail: 'No score records available.' };
  }
  var threshold   = policy.minScorePercent || 50;
  var failedCount = studentScores.filter(function(s) { return (s.percentage || 0) < threshold; }).length;
  var maxAllowed  = policy.maxFailedSubjects;
  return {
    evaluated:   true,
    passed:      failedCount <= maxAllowed,
    failedCount,
    maxAllowed,
    detail: failedCount <= maxAllowed
      ? failedCount + ' subject(s) failed (max allowed: ' + maxAllowed + ')'
      : failedCount + ' failed, exceeds limit of ' + maxAllowed
  };
}

/* ============================================
   getEffectivePolicy(schoolId, classId)
   Priority: class-specific > school-wide > defaults
============================================ */
async function getEffectivePolicy(schoolId, classId) {
  var PromotionPolicy = require('../models/PromotionPolicy.model');
  if (classId) {
    var classPolicy = await PromotionPolicy.findOne({
      schoolId: schoolId, classId: classId, isActive: true
    }).lean();
    if (classPolicy) { return classPolicy; }
  }
  var schoolPolicy = await PromotionPolicy.findOne({
    schoolId: schoolId, classId: null, isActive: true
  }).lean();
  if (schoolPolicy) { return schoolPolicy; }

  return {
    checkAcademicPerformance: true, minScorePercent:        50,
    checkAttendance:          false, minAttendancePercent:   0,
    requireFeesClearance:     false,
    requireCoreSubjectPass:   false, coreSubjectMinScore:    50,
    maxFailedSubjects:        null,
    allowOverride:            true,  policyVersion:          0,
    _isDefault:               true
  };
}

/* ============================================
   findNextClass(currentClassId, schoolId)
   sortOrder-based — no hard-coded class names.
   Returns null = student is at final level.
============================================ */
async function findNextClass(currentClassId, schoolId) {
  if (!currentClassId) { return null; }
  var SchoolClass = require('../models/Class.model');
  var current     = await SchoolClass.findOne({ _id: currentClassId, schoolId: schoolId }).lean();
  if (!current) { return null; }
  return SchoolClass.findOne({
    schoolId:  schoolId,
    isActive:  true,
    sortOrder: { $gt: current.sortOrder }
  }).sort({ sortOrder: 1 }).lean();
}

/* ============================================
   evaluateStudentProgression(student, policy, sourceTermId, schoolId)

   Comprehensive E1A evaluation.
   Backward compatible — returns all original fields.
   Adds: evidence{}, policySnapshot{}.

   CRITICAL: Missing data ≠ failure.
   PASS / FAIL / INCOMPLETE / NOT_REQUIRED / UNAVAILABLE
============================================ */
async function evaluateStudentProgression(student, policy, sourceTermId, schoolId) {
  var studentSchoolId = student.schoolId || schoolId;

  var result = {
    /* Backward-compatible (Phase S uses these) */
    eligibilityStatus: 'eligible',
    failedCriteria:    [],
    academicScore:     null,
    attendanceRate:    null,
    feesCleared:       null,
    recommendation:    'promote',
    /* E1A additions */
    evidence:          {},
    policySnapshot:    {}
  };

  /* ---- 1. PERIOD READINESS ---- */
  var readiness = await checkPeriodReadiness(studentSchoolId, student.classId, sourceTermId);
  result.evidence.periodReadiness = readiness;

  if (readiness.ready === false && readiness.status === 'pending_approval') {
    result.eligibilityStatus = 'requires_review';
    result.recommendation    = 'review';
    result.failedCriteria.push('period_not_ready');
  }

  /* ---- 2. ACADEMIC PERFORMANCE (from SchoolScore) ---- */
  if (policy.checkAcademicPerformance && policy.minScorePercent > 0) {
    var scoreResult = await getStudentScores(student._id, studentSchoolId, sourceTermId);

    if (!scoreResult.available || !scoreResult.scores.length) {
      /* Missing data — safe incomplete state, NOT automatic failure */
      result.evidence.academic = {
        status:        readiness.ready === null ? 'unavailable' : 'incomplete',
        overallScore:  null,
        threshold:     policy.minScorePercent,
        subjectCount:  0,
        failedSubjectCount: 0,
        coreSubjectEvaluation: { evaluated: false, passed: null },
        detail: readiness.ready === null
          ? 'Score data unavailable.'
          : 'No approved score records found for this student and term.'
      };
      if (result.eligibilityStatus === 'eligible') {
        result.eligibilityStatus = 'requires_review';
        result.recommendation    = 'review';
        result.failedCriteria.push('academic_data_missing');
      }
    } else {
      var scores       = scoreResult.scores;
      var sum          = scores.reduce(function(s, r) { return s + (r.percentage || 0); }, 0);
      var overallScore = Math.round((sum / scores.length) * 100) / 100;
      result.academicScore = overallScore;

      var academicPassed  = overallScore >= policy.minScorePercent;
      var failedSubjects  = scores.filter(function(s) { return (s.percentage || 0) < policy.minScorePercent; });
      var coreEval        = evaluateRequiredSubjects(scores, policy);
      var maxFailEval     = evaluateMaxFailedSubjects(scores, policy);

      result.evidence.academic = {
        status:           academicPassed ? 'pass' : 'fail',
        overallScore,
        threshold:        policy.minScorePercent,
        subjectCount:     scores.length,
        failedSubjectCount: failedSubjects.length,
        coreSubjectEvaluation:       coreEval,
        maxFailedSubjectsEvaluation: maxFailEval,
        detail: academicPassed
          ? 'Overall ' + overallScore + '% meets threshold of ' + policy.minScorePercent + '%'
          : 'Overall ' + overallScore + '% below threshold of ' + policy.minScorePercent + '%'
      };

      if (!academicPassed) {
        result.failedCriteria.push('academic_performance');
        result.eligibilityStatus = 'not_eligible';
        result.recommendation    = 'repeat';
      }
      if (coreEval.evaluated && coreEval.passed === false) {
        result.failedCriteria.push('core_subject_failure');
        if (result.eligibilityStatus === 'eligible') {
          result.eligibilityStatus = 'not_eligible';
          result.recommendation    = 'repeat';
        }
      }
      if (maxFailEval.evaluated && !maxFailEval.passed) {
        result.failedCriteria.push('too_many_failed_subjects');
        if (result.eligibilityStatus === 'eligible') {
          result.eligibilityStatus = 'not_eligible';
          result.recommendation    = 'repeat';
        }
      }
    }
  } else {
    result.evidence.academic = { status: 'not_evaluated', detail: 'Academic check not required by policy.' };
  }

  /* ---- 3. ATTENDANCE ---- */
  if (policy.checkAttendance && policy.minAttendancePercent > 0) {
    var Attendance = getAttendanceModel();
    if (!Attendance) {
      result.evidence.attendance = {
        status: 'unavailable', rate: null, threshold: policy.minAttendancePercent,
        dataAvailable: false, detail: 'Attendance model not available.'
      };
    } else {
      try {
        var records = await Attendance.find({
          schoolId: studentSchoolId, studentId: student._id
        }).lean();

        if (!records.length) {
          /* Missing data — not automatic failure */
          result.evidence.attendance = {
            status: 'incomplete', rate: null, threshold: policy.minAttendancePercent,
            dataAvailable: true, detail: 'No attendance records found. Cannot evaluate.'
          };
          if (result.eligibilityStatus === 'eligible') {
            result.eligibilityStatus = 'requires_review';
            result.recommendation    = 'review';
            result.failedCriteria.push('attendance_data_missing');
          }
        } else {
          var present = records.filter(function(r) { return r.status === 'present'; }).length;
          result.attendanceRate = Math.round((present / records.length) * 10000) / 100;
          var attPassed = result.attendanceRate >= policy.minAttendancePercent;

          result.evidence.attendance = {
            status: attPassed ? 'pass' : 'fail',
            rate:   result.attendanceRate, threshold: policy.minAttendancePercent,
            totalRecords: records.length, presentCount: present,
            dataAvailable: true,
            detail: attPassed
              ? 'Attendance ' + result.attendanceRate + '% meets threshold.'
              : 'Attendance ' + result.attendanceRate + '% below threshold of ' + policy.minAttendancePercent + '%'
          };
          if (!attPassed) {
            result.failedCriteria.push('attendance');
            if (result.eligibilityStatus === 'eligible') {
              result.eligibilityStatus = 'attendance_hold';
            }
            if (result.recommendation === 'promote') { result.recommendation = 'review'; }
          }
        }
      } catch (e) {
        result.evidence.attendance = {
          status: 'unavailable', rate: null, threshold: policy.minAttendancePercent,
          dataAvailable: false, detail: 'Attendance check failed: ' + e.message
        };
      }
    }
  } else {
    result.evidence.attendance = {
      status: 'not_required', rate: null, threshold: policy.minAttendancePercent || 0,
      dataAvailable: false, detail: 'Attendance not required by institution policy.'
    };
  }

  /* ---- 4. FINANCIAL CLEARANCE ---- */
  if (policy.requireFeesClearance) {
    try {
      var SchoolFeeAssignment = require('../models/SchoolFeeAssignment.model');
      var pendingFees = await SchoolFeeAssignment.countDocuments({
        schoolId: studentSchoolId, studentId: student._id, termId: sourceTermId,
        status: { $in: ['pending', 'partial'] }
      });
      result.feesCleared = pendingFees === 0;
      result.evidence.financial = {
        status: result.feesCleared ? 'cleared' : 'pending',
        cleared: result.feesCleared, pendingCount: pendingFees,
        detail: result.feesCleared
          ? 'No outstanding fees for this term.'
          : pendingFees + ' fee assignment(s) pending payment.'
      };
      if (!result.feesCleared) {
        result.failedCriteria.push('financial_clearance');
        if (result.eligibilityStatus === 'eligible') {
          result.eligibilityStatus = 'financial_hold';
        }
      }
    } catch (e) {
      result.feesCleared = null;
      result.evidence.financial = {
        status: 'unavailable', cleared: null, pendingCount: null,
        detail: 'Financial clearance check failed: ' + e.message
      };
    }
  } else {
    result.feesCleared = null;
    result.evidence.financial = {
      status: 'not_required', cleared: null, pendingCount: null,
      detail: 'Financial clearance not required by institution policy.'
    };
  }

  /* ---- 5. NEXT CLASS / GRADUATION CANDIDATE ---- */
  var nextClass = await findNextClass(student.classId, studentSchoolId);
  result.evidence.nextClass = {
    exists:       !!nextClass,
    classId:      nextClass ? nextClass._id   : null,
    className:    nextClass ? nextClass.name  : '',
    isFinalLevel: !nextClass,
    detail:       nextClass
      ? 'Next configured level: ' + nextClass.name
      : 'No higher configured level exists — graduation candidate.'
  };

  /* Multiple failures → requires_review */
  if (result.failedCriteria.length > 1) {
    result.eligibilityStatus = 'requires_review';
    result.recommendation    = 'review';
  }

  /* Graduation candidate (eligible + no next class) */
  if (result.eligibilityStatus === 'eligible' && !nextClass) {
    result.eligibilityStatus = 'graduation_candidate';
    result.recommendation    = 'graduate';
  }

  /* ---- 6. POLICY SNAPSHOT (audit traceability) ---- */
  result.policySnapshot = {
    policyId:                 policy._id  || null,
    policyVersion:            policy.policyVersion || 0,
    checkAcademicPerformance: policy.checkAcademicPerformance,
    minScorePercent:          policy.minScorePercent,
    checkAttendance:          policy.checkAttendance,
    minAttendancePercent:     policy.minAttendancePercent,
    requireFeesClearance:     policy.requireFeesClearance,
    requireCoreSubjectPass:   policy.requireCoreSubjectPass   || false,
    coreSubjectMinScore:      policy.coreSubjectMinScore      || 50,
    maxFailedSubjects:        policy.maxFailedSubjects        || null,
    allowOverride:            policy.allowOverride,
    isDefaultPolicy:          !!policy._isDefault,
    evaluatedAt:              new Date()
  };

  return result;
}

/* ============================================
   evaluateStudentEligibility (backward-compatible wrapper)
   Phase S calls this. Automatically gets E1A enhancements.
============================================ */
async function evaluateStudentEligibility(student, policy, sourceTermId) {
  return evaluateStudentProgression(student, policy, sourceTermId, student.schoolId);
}

/* ============================================
   evaluateCohort(classId, sourceTermId, schoolId)
   Optimized bulk evaluation — caches policy,
   nextClass, and bulk-loads scores for performance.
============================================ */
async function evaluateCohort(classId, sourceTermId, schoolId) {
  var SchoolStudent = require('../models/SchoolStudent.model');
  var SchoolScore   = getSchoolScoreModel();

  var students = await SchoolStudent.find({
    schoolId: schoolId, classId: classId, status: 'active'
  }).lean();

  if (!students.length) {
    return {
      students:  [],
      summary:   { total: 0, eligible: 0, notEligible: 0, graduationCandidates: 0, requiresReview: 0, holds: 0 },
      readiness: { ready: false, detail: 'No active students in this class.' },
      policy:    await getEffectivePolicy(schoolId, classId)
    };
  }

  /* Cache expensive lookups */
  var policy    = await getEffectivePolicy(schoolId, classId);
  var readiness = await checkPeriodReadiness(schoolId, classId, sourceTermId);
  var nextClass = await findNextClass(classId, schoolId);

  /* Bulk-load all scores for the class (one DB query instead of N) */
  var allScoresByStudent = {};
  if (SchoolScore) {
    try {
      var classScores = await SchoolScore.find({
        schoolId: schoolId, classId: classId, termId: sourceTermId
      }).populate('subjectId', 'name code isCore').lean();
      classScores.forEach(function(s) {
        var sid = s.studentId.toString();
        if (!allScoresByStudent[sid]) { allScoresByStudent[sid] = []; }
        allScoresByStudent[sid].push(s);
      });
    } catch (e) { /* SchoolScore unavailable — evaluations will use incomplete state */ }
  }

  var evaluations = [];
  var summary = {
    total: students.length, eligible: 0, notEligible: 0,
    graduationCandidates: 0, requiresReview: 0, holds: 0, overrides: 0
  };

  for (var i = 0; i < students.length; i++) {
    var student   = students[i];
    var sid       = student._id.toString();
    var scores    = allScoresByStudent[sid] || [];

    var sr = {
      studentId:    student._id,
      studentName:  student.name,
      admissionNo:  student.admissionNo || '',
      currentClassId:   student.classId,
      currentClassName: student.class || '',
      eligibilityStatus: 'eligible',
      failedCriteria:    [],
      academicScore:     null,
      recommendation:    'promote',
      nextClass: nextClass ? { classId: nextClass._id, className: nextClass.name } : null,
      isFinalLevel: !nextClass,
      policySnapshot: {
        policyVersion: policy.policyVersion || 0,
        isDefaultPolicy: !!policy._isDefault,
        evaluatedAt: new Date()
      }
    };

    /* Period readiness */
    if (readiness.ready === false && readiness.status === 'pending_approval') {
      sr.eligibilityStatus = 'requires_review';
      sr.recommendation    = 'review';
      sr.failedCriteria.push('period_not_ready');
    }

    /* Academic (uses pre-loaded scores) */
    if (policy.checkAcademicPerformance && policy.minScorePercent > 0) {
      if (!scores.length) {
        if (sr.eligibilityStatus === 'eligible') {
          sr.eligibilityStatus = 'requires_review';
          sr.recommendation    = 'review';
          sr.failedCriteria.push('academic_data_missing');
        }
      } else {
        var sum   = scores.reduce(function(s, r) { return s + (r.percentage || 0); }, 0);
        sr.academicScore = Math.round((sum / scores.length) * 100) / 100;
        if (sr.academicScore < policy.minScorePercent) {
          sr.failedCriteria.push('academic_performance');
          sr.eligibilityStatus = 'not_eligible';
          sr.recommendation    = 'repeat';
        }
        if (policy.requireCoreSubjectPass) {
          var ce = evaluateRequiredSubjects(scores, policy);
          if (ce.evaluated && ce.passed === false) {
            sr.failedCriteria.push('core_subject_failure');
            if (sr.eligibilityStatus === 'eligible') {
              sr.eligibilityStatus = 'not_eligible'; sr.recommendation = 'repeat';
            }
          }
        }
        if (policy.maxFailedSubjects !== null && policy.maxFailedSubjects !== undefined) {
          var mfe = evaluateMaxFailedSubjects(scores, policy);
          if (mfe.evaluated && !mfe.passed) {
            sr.failedCriteria.push('too_many_failed_subjects');
            if (sr.eligibilityStatus === 'eligible') {
              sr.eligibilityStatus = 'not_eligible'; sr.recommendation = 'repeat';
            }
          }
        }
      }
    }

    /* Financial (per-student query — cannot bulk-load easily) */
    if (policy.requireFeesClearance) {
      try {
        var SchoolFeeAssignment = require('../models/SchoolFeeAssignment.model');
        var pendingCount = await SchoolFeeAssignment.countDocuments({
          schoolId: schoolId, studentId: student._id, termId: sourceTermId,
          status: { $in: ['pending', 'partial'] }
        });
        if (pendingCount > 0) {
          sr.failedCriteria.push('financial_clearance');
          if (sr.eligibilityStatus === 'eligible') {
            sr.eligibilityStatus = 'financial_hold';
          }
        }
      } catch (e) { /* financial check unavailable */ }
    }

    /* Multiple failures */
    if (sr.failedCriteria.length > 1) {
      sr.eligibilityStatus = 'requires_review';
      sr.recommendation    = 'review';
    }

    /* Graduation candidate */
    if (sr.eligibilityStatus === 'eligible' && !nextClass) {
      sr.eligibilityStatus = 'graduation_candidate';
      sr.recommendation    = 'graduate';
    }

    /* Summary counts */
    switch (sr.eligibilityStatus) {
      case 'eligible':             summary.eligible++;             break;
      case 'not_eligible':         summary.notEligible++;          break;
      case 'graduation_candidate': summary.graduationCandidates++; break;
      case 'requires_review':      summary.requiresReview++;       break;
      default:                     summary.holds++;
    }

    evaluations.push(sr);
  }

  return { students: evaluations, summary, readiness, policy };
}

module.exports = {
  getEffectivePolicy,
  findNextClass,
  evaluateStudentEligibility,     /* backward-compatible — Phase S */
  evaluateStudentProgression,     /* E1A comprehensive evaluation */
  evaluateCohort,                 /* E1A cohort evaluation */
  checkPeriodReadiness,           /* E1A readiness check */
  evaluateRequiredSubjects        /* E1A required subjects */
};