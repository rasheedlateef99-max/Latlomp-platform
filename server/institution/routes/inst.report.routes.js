/* ============================================
   LATLOMP INSTITUTION — REPORT ROUTES
   ✅ PHASE I: Results + Reporting

   Endpoints:
   GET /api/institution/report/exam/:examId
     Full results + analytics for one exam.
     Auth: instProtect + teacherOrAdmin
     Returns: exam, results[], analytics{}

   Analytics computed server-side:
     total, passed, failed, passRate,
     avgScore, highestScore, lowestScore,
     avgTime, distribution[10], topPerformers[5]

   🐛 BUG FIX (crash fix):
   - Wrong: require('../middleware/inst.auth.middleware')
   - Fixed: require('../middleware/inst.auth')
   - Wrong: instTeacherAuth (export does not exist)
   - Fixed: instProtect + teacherOrAdmin (matches all
     other institution routes e.g. inst.teacher.routes.js)
   - Wrong: req.schoolUser.schoolId
   - Fixed: req.schoolId (set by instProtect middleware)
============================================ */

'use strict';

const express  = require('express');
const router   = express.Router();
const mongoose = require('mongoose');

const SchoolResult = require('../models/SchoolResult.model');
const SchoolExam   = require('../models/SchoolExam.model');
const School       = require('../models/School.model');

const { instProtect, teacherOrAdmin } = require('../middleware/inst.auth');
const { requireActiveSubscription }   = require('../middleware/inst.tenant');

var guard = [instProtect, teacherOrAdmin, requireActiveSubscription];

/* ============================================
   GET /exam/:examId
   Full report for a single exam.
   Includes all submissions + computed analytics.
============================================ */
router.get('/exam/:examId', guard, async function (req, res) {
  try {
    var examId   = req.params.examId;
    var schoolId = req.schoolId;

    if (!mongoose.isValidObjectId(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam ID.' });
    }

    /* ---- Verify exam belongs to this school ---- */
    var exam = await SchoolExam.findOne({ _id: examId, schoolId: schoolId }).lean();
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found or access denied.' });
    }

    /* ---- Load school name for PDF header ---- */
    var school = await School.findById(schoolId).select('name logo').lean();

    /* ---- Load all results for this exam ---- */
    var results = await SchoolResult.find({ examId: examId, schoolId: schoolId })
      .sort({ scorePercent: -1, createdAt: -1 })
      .lean();

    var total = results.length;

    /* ---- Compute analytics ---- */
    var passed       = 0;
    var scoreSum     = 0;
    var timeSum      = 0;
    var highestScore = 0;
    var lowestScore  = 100;
    var distribution = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    for (var i = 0; i < results.length; i++) {
      var r   = results[i];
      var pct = r.scorePercent || 0;

      if (r.isPassed) { passed++; }
      scoreSum += pct;
      timeSum  += (r.timeTaken || 0);

      if (pct > highestScore) { highestScore = pct; }
      if (pct < lowestScore)  { lowestScore  = pct; }

      var bucket = Math.min(9, Math.floor(pct / 10));
      distribution[bucket]++;
    }

    var avgScore = total > 0 ? Math.round(scoreSum / total)         : 0;
    var avgTime  = total > 0 ? Math.round(timeSum  / total)         : 0;
    var passRate = total > 0 ? Math.round((passed  / total) * 100)  : 0;

    if (total === 0) { lowestScore = 0; }

    /* ---- Top 5 performers ---- */
    var topPerformers = results.slice(0, 5).map(function (r) {
      return {
        studentName:  r.studentName  || '—',
        admissionNo:  r.admissionNo  || '—',
        scorePercent: r.scorePercent || 0,
        isPassed:     r.isPassed     || false,
        timeTaken:    r.timeTaken    || 0
      };
    });

    /* ---- Sanitise results for response ---- */
    var safeResults = results.map(function (r) {
      return {
        _id:              r._id,
        studentName:      r.studentName      || '—',
        admissionNo:      r.admissionNo      || '—',
        studentClass:     r.studentClass     || '—',
        score:            r.score            || 0,
        totalMarks:       r.totalMarks       || 0,
        scorePercent:     r.scorePercent     || 0,
        isPassed:         r.isPassed         || false,
        objectiveScore:   r.objectiveScore   || 0,
        objectiveTotal:   r.objectiveTotal   || 0,
        theoryScore:      r.theoryScore      || 0,
        theoryTotal:      r.theoryTotal      || 0,
        theoryMarked:     r.theoryMarked     || false,
        timeTaken:        r.timeTaken        || 0,
        wasAutoSubmit:    r.wasAutoSubmit     || false,
        tabSwitchCount:   r.tabSwitchCount   || 0,
        flaggedForReview: r.flaggedForReview  || false,
        isReleased:       r.isReleased        || false,
        createdAt:        r.createdAt
      };
    });

    return res.json({
      success:  true,
      school:   { name: (school && school.name) || '—', logo: (school && school.logo) || '' },
      exam:     exam,
      results:  safeResults,
      analytics: {
        total:         total,
        passed:        passed,
        failed:        total - passed,
        passRate:      passRate,
        avgScore:      avgScore,
        highestScore:  highestScore,
        lowestScore:   lowestScore,
        avgTime:       avgTime,
        distribution:  distribution,
        topPerformers: topPerformers
      }
    });

  } catch (err) {
    console.error('[inst.report] GET /exam/:examId error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to generate report.' });
  }
});

module.exports = router;