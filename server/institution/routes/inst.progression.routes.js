'use strict';
/* ============================================
   LATLOMP INSTITUTION — PROGRESSION ROUTES (E1A)

   READ-ONLY evaluation endpoints.
   Does NOT modify student records.
   Evaluation feeds Phase S — Phase S executes.

   Follows inst.student.mgmt.routes.js conventions.
============================================ */
const express       = require('express');
const router        = express.Router();
const mongoose      = require('mongoose');
const SchoolStudent = require('../models/SchoolStudent.model');
const AcademicTerm  = require('../models/AcademicTerm.model');
const {
  getEffectivePolicy,
  evaluateStudentProgression,
  evaluateCohort,
  checkPeriodReadiness
} = require('../services/promotion.service');
const { instProtect, canManageStudents, teacherOrAdmin } = require('../middleware/inst.auth');
const { requireActiveSubscription } = require('../middleware/inst.tenant');

var staffGuard  = [instProtect, teacherOrAdmin,   requireActiveSubscription];
var manageGuard = [instProtect, canManageStudents, requireActiveSubscription];

/* ============================================
   GET /api/institution/progression/readiness/:classId
   Query: ?termId=
   Returns period readiness status for a class.
   Any authorized staff can check readiness.
============================================ */
router.get('/readiness/:classId', staffGuard, async function (req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.classId)) {
      return res.status(400).json({ success: false, message: 'Invalid class ID.' });
    }
    var { termId } = req.query;
    if (!termId) {
      return res.status(400).json({ success: false, message: 'termId query parameter is required.' });
    }

    var term = await AcademicTerm.findOne({ _id: termId, schoolId: req.schoolId }).lean();
    if (!term) {
      return res.status(404).json({ success: false, message: 'Academic term not found.' });
    }

    var [readiness, policy] = await Promise.all([
      checkPeriodReadiness(req.schoolId, req.params.classId, termId),
      getEffectivePolicy(req.schoolId, req.params.classId)
    ]);

    return res.json({
      success:   true,
      classId:   req.params.classId,
      term:      { _id: term._id, name: term.name, session: term.session, term: term.term },
      readiness,
      policy: {
        checkAcademicPerformance: policy.checkAcademicPerformance,
        minScorePercent:          policy.minScorePercent,
        checkAttendance:          policy.checkAttendance,
        minAttendancePercent:     policy.minAttendancePercent,
        requireFeesClearance:     policy.requireFeesClearance,
        requireCoreSubjectPass:   policy.requireCoreSubjectPass || false,
        coreSubjectMinScore:      policy.coreSubjectMinScore    || 50,
        maxFailedSubjects:        policy.maxFailedSubjects      || null,
        policyVersion:            policy.policyVersion          || 0,
        isDefaultPolicy:          !!policy._isDefault
      }
    });
  } catch (err) {
    console.error('[inst.progression] GET /readiness:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/progression/student/:studentId
   Query: ?termId=
   Returns comprehensive E1A evaluation for one student.
   Includes full evidence and policy snapshot.
============================================ */
router.get('/student/:studentId', manageGuard, async function (req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.studentId)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }
    var { termId } = req.query;
    if (!termId) {
      return res.status(400).json({ success: false, message: 'termId query parameter is required.' });
    }
    if (!mongoose.isValidObjectId(termId)) {
      return res.status(400).json({ success: false, message: 'Invalid term ID.' });
    }

    var [student, term] = await Promise.all([
      SchoolStudent.findOne({ _id: req.params.studentId, schoolId: req.schoolId }).lean(),
      AcademicTerm.findOne({ _id: termId, schoolId: req.schoolId }).lean()
    ]);

    if (!student) { return res.status(404).json({ success: false, message: 'Student not found.' }); }
    if (!term)    { return res.status(404).json({ success: false, message: 'Academic term not found.' }); }

    var policy     = await getEffectivePolicy(req.schoolId, student.classId ? student.classId.toString() : null);
    var evaluation = await evaluateStudentProgression(student, policy, termId, req.schoolId);

    return res.json({
      success: true,
      student: {
        _id:        student._id,
        name:       student.name,
        admissionNo:student.admissionNo,
        class:      student.class,
        classId:    student.classId,
        status:     student.status
      },
      term: { _id: term._id, name: term.name, session: term.session, term: term.term },
      evaluation
    });
  } catch (err) {
    console.error('[inst.progression] GET /student/:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/progression/class/:classId
   Query: ?termId=
   Returns cohort evaluation for all students
   in a class (optimized bulk — one DB call per
   data source, not per student).
============================================ */
router.get('/class/:classId', manageGuard, async function (req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.classId)) {
      return res.status(400).json({ success: false, message: 'Invalid class ID.' });
    }
    var { termId } = req.query;
    if (!termId) {
      return res.status(400).json({ success: false, message: 'termId query parameter is required.' });
    }
    if (!mongoose.isValidObjectId(termId)) {
      return res.status(400).json({ success: false, message: 'Invalid term ID.' });
    }

    var term = await AcademicTerm.findOne({ _id: termId, schoolId: req.schoolId }).lean();
    if (!term) { return res.status(404).json({ success: false, message: 'Academic term not found.' }); }

    var cohort = await evaluateCohort(req.params.classId, termId, req.schoolId);

    return res.json({
      success: true,
      term:    { _id: term._id, name: term.name, session: term.session, term: term.term },
      classId: req.params.classId,
      students: cohort.students,
      summary:  cohort.summary,
      readiness:cohort.readiness,
      policyUsed: {
        isDefaultPolicy:          !!cohort.policy._isDefault,
        policyVersion:            cohort.policy.policyVersion || 0,
        checkAcademicPerformance: cohort.policy.checkAcademicPerformance,
        minScorePercent:          cohort.policy.minScorePercent,
        checkAttendance:          cohort.policy.checkAttendance,
        requireFeesClearance:     cohort.policy.requireFeesClearance,
        requireCoreSubjectPass:   cohort.policy.requireCoreSubjectPass || false
      }
    });
  } catch (err) {
    console.error('[inst.progression] GET /class/:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;