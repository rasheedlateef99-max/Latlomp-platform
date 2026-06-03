/* ============================================
   LATLOMP INSTITUTION — ANALYTICS ROUTES
   
   All queries are scoped to req.schoolId
   for tenant isolation.
   
   GET /api/institution/analytics/overview
   GET /api/institution/analytics/exams
   GET /api/institution/analytics/exam/:id
   GET /api/institution/analytics/subjects
   GET /api/institution/analytics/students
   GET /api/institution/analytics/timeline
============================================ */

const express      = require('express');
const router       = express.Router();
const SchoolExam   = require('../models/SchoolExam.model');
const SchoolResult = require('../models/SchoolResult.model');
const SchoolUser   = require('../models/SchoolUser.model');
const { instProtect, schoolAdminOnly, teacherOrAdmin } = require('../middleware/inst.auth');
const { requireActiveSubscription } = require('../middleware/inst.tenant');

var guard = [instProtect, teacherOrAdmin, requireActiveSubscription];

/* ============================================
   GET /api/institution/analytics/overview
   Summary stats for dashboard top cards
============================================ */
router.get('/overview', guard, async (req, res) => {
  try {
    var schoolId = req.schoolId;

    var [
      totalExams,
      totalResults,
      publishedExams,
      endedExams
    ] = await Promise.all([
      SchoolExam.countDocuments({ schoolId }),
      SchoolResult.countDocuments({ schoolId }),
      SchoolExam.countDocuments({ schoolId, status: 'published' }),
      SchoolExam.countDocuments({ schoolId, status: 'ended' })
    ]);

    /* Aggregate pass/fail + average score */
    var scoreAgg = await SchoolResult.aggregate([
      { $match: { schoolId: schoolId } },
      {
        $group: {
          _id:          null,
          totalResults: { $sum: 1 },
          passCount:    { $sum: { $cond: ['$isPassed', 1, 0] } },
          avgScore:     { $avg: '$scorePercent' },
          highScore:    { $max: '$scorePercent' },
          lowScore:     { $min: '$scorePercent' }
        }
      }
    ]);

    var agg       = scoreAgg[0] || {};
    var passRate  = agg.totalResults > 0
      ? Math.round((agg.passCount / agg.totalResults) * 100)
      : 0;

    /* Ungraded theory submissions */
    var pendingGrading = await SchoolResult.countDocuments({
      schoolId,
      theoryMarked: false,
      $expr: { $gt: [{ $size: '$answers' }, 0] }
    });

    return res.status(200).json({
      success: true,
      overview: {
        totalExams,
        totalResults,
        publishedExams,
        endedExams,
        passRate,
        avgScore:      Math.round(agg.avgScore  || 0),
        highScore:     agg.highScore   || 0,
        lowScore:      agg.lowScore    || 0,
        passCount:     agg.passCount   || 0,
        failCount:     (agg.totalResults || 0) - (agg.passCount || 0),
        pendingGrading
      }
    });

  } catch (err) {
    console.error('[Analytics] overview error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/analytics/exams
   All exams with result stats
============================================ */
router.get('/exams', guard, async (req, res) => {
  try {
    var schoolId = req.schoolId;

    /* Scope to teacher's exams if teacher role */
    var examFilter = { schoolId };
    if (req.schoolUser.role === 'teacher') {
      examFilter.createdBy = req.schoolUser._id;
    }

    var exams = await SchoolExam.find(examFilter)
      .select('title subject class examType status totalAttempts accessCode createdAt duration passMark')
      .sort({ createdAt: -1 })
      .lean();

    if (exams.length === 0) {
      return res.status(200).json({ success: true, exams: [] });
    }

    var examIds = exams.map(function(e) { return e._id; });

    /* Aggregate per-exam stats */
    var statAgg = await SchoolResult.aggregate([
      { $match: { schoolId: schoolId, examId: { $in: examIds } } },
      {
        $group: {
          _id:       '$examId',
          total:     { $sum: 1 },
          passed:    { $sum: { $cond: ['$isPassed', 1, 0] } },
          avgScore:  { $avg: '$scorePercent' },
          highScore: { $max: '$scorePercent' },
          lowScore:  { $min: '$scorePercent' }
        }
      }
    ]);

    /* Map stats by examId */
    var statsMap = {};
    statAgg.forEach(function(s) {
      statsMap[s._id.toString()] = s;
    });

    var enriched = exams.map(function(e) {
      var s = statsMap[e._id.toString()] || {};
      return Object.assign({}, e, {
        stats: {
          total:     s.total     || 0,
          passed:    s.passed    || 0,
          failed:    (s.total || 0) - (s.passed || 0),
          passRate:  s.total ? Math.round((s.passed / s.total) * 100) : 0,
          avgScore:  Math.round(s.avgScore  || 0),
          highScore: s.highScore || 0,
          lowScore:  s.lowScore  || 0
        }
      });
    });

    return res.status(200).json({ success: true, exams: enriched });

  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/analytics/exam/:id
   Detailed breakdown for one exam:
   - score distribution (bins)
   - top 10 / bottom 10 students
   - per-question correct rate
============================================ */
router.get('/exam/:id', guard, async (req, res) => {
  try {
    var schoolId = req.schoolId;
    var examId   = req.params.id;

    var exam = await SchoolExam.findOne({ _id: examId, schoolId })
      .select('title subject class examType duration passMark totalQuestions');
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });

    var results = await SchoolResult.find({ examId, schoolId })
      .select('studentName scorePercent isPassed score totalMarks timeTaken createdAt answers')
      .sort({ scorePercent: -1 })
      .lean();

    if (results.length === 0) {
      return res.status(200).json({
        success: true,
        exam:    exam,
        results: [],
        distribution: [],
        top10:    [],
        bottom10: [],
        questionStats: []
      });
    }

    /* Score distribution — 10 bins: 0-9, 10-19 ... 90-100 */
    var bins = Array(10).fill(0);
    results.forEach(function(r) {
      var bin = Math.min(9, Math.floor((r.scorePercent || 0) / 10));
      bins[bin]++;
    });

    var distribution = bins.map(function(count, i) {
      return {
        range: (i * 10) + '–' + (i === 9 ? '100' : (i * 10 + 9)),
        count: count
      };
    });

    /* Top 10 and bottom 10 */
    var top10    = results.slice(0, 10).map(function(r) {
      return { name: r.studentName, score: r.scorePercent, passed: r.isPassed };
    });
    var bottom10 = results.slice(-10).reverse().map(function(r) {
      return { name: r.studentName, score: r.scorePercent, passed: r.isPassed };
    });

    /* Per-question correct rate */
    var qStats = {};
    results.forEach(function(r) {
      (r.answers || []).forEach(function(a) {
        if (!a.questionId) return;
        var qId = a.questionId.toString();
        if (!qStats[qId]) qStats[qId] = { correct: 0, total: 0 };
        qStats[qId].total++;
        if (a.isCorrect) qStats[qId].correct++;
      });
    });

    var questionStats = Object.keys(qStats).map(function(qId, i) {
      var s = qStats[qId];
      return {
        index:        i + 1,
        questionId:   qId,
        correctCount: s.correct,
        totalCount:   s.total,
        correctRate:  s.total ? Math.round((s.correct / s.total) * 100) : 0
      };
    }).sort(function(a, b) { return a.index - b.index; });

    return res.status(200).json({
      success: true,
      exam,
      summary: {
        total:     results.length,
        passed:    results.filter(function(r) { return r.isPassed; }).length,
        avgScore:  Math.round(results.reduce(function(s,r) { return s + r.scorePercent; }, 0) / results.length),
        highScore: results[0].scorePercent,
        lowScore:  results[results.length - 1].scorePercent
      },
      distribution,
      top10,
      bottom10,
      questionStats
    });

  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/analytics/subjects
   Performance grouped by exam subject
============================================ */
router.get('/subjects', guard, async (req, res) => {
  try {
    var schoolId = req.schoolId;

    var subjectAgg = await SchoolResult.aggregate([
      { $match: { schoolId: schoolId } },
      {
        $lookup: {
          from:         'schoolexams',
          localField:   'examId',
          foreignField: '_id',
          as:           'exam'
        }
      },
      { $unwind: { path: '$exam', preserveNullAndEmpty: false } },
      {
        $group: {
          _id:       '$exam.subject',
          total:     { $sum: 1 },
          passed:    { $sum: { $cond: ['$isPassed', 1, 0] } },
          avgScore:  { $avg: '$scorePercent' },
          highScore: { $max: '$scorePercent' },
          lowScore:  { $min: '$scorePercent' }
        }
      },
      { $sort: { total: -1 } }
    ]);

    var subjects = subjectAgg.map(function(s) {
      return {
        subject:   s._id || 'Unknown',
        total:     s.total,
        passed:    s.passed,
        failed:    s.total - s.passed,
        passRate:  s.total ? Math.round((s.passed / s.total) * 100) : 0,
        avgScore:  Math.round(s.avgScore  || 0),
        highScore: s.highScore || 0,
        lowScore:  s.lowScore  || 0
      };
    });

    return res.status(200).json({ success: true, subjects });

  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/analytics/students
   Top performers across all exams
============================================ */
router.get('/students', guard, async (req, res) => {
  try {
    var schoolId = req.schoolId;
    var limit    = parseInt(req.query.limit) || 20;

    var studentAgg = await SchoolResult.aggregate([
      { $match: { schoolId: schoolId } },
      {
        $group: {
          _id:         '$studentName',
          totalExams:  { $sum: 1 },
          passed:      { $sum: { $cond: ['$isPassed', 1, 0] } },
          avgScore:    { $avg: '$scorePercent' },
          bestScore:   { $max: '$scorePercent' },
          admissionNo: { $first: '$admissionNo' }
        }
      },
      { $sort: { avgScore: -1 } },
      { $limit: limit }
    ]);

    var students = studentAgg.map(function(s) {
      return {
        name:        s._id,
        admissionNo: s.admissionNo || '—',
        totalExams:  s.totalExams,
        passed:      s.passed,
        passRate:    s.totalExams ? Math.round((s.passed / s.totalExams) * 100) : 0,
        avgScore:    Math.round(s.avgScore || 0),
        bestScore:   s.bestScore || 0
      };
    });

    return res.status(200).json({ success: true, students });

  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/analytics/timeline
   Exam activity over past 8 weeks
============================================ */
router.get('/timeline', guard, async (req, res) => {
  try {
    var schoolId  = req.schoolId;
    var weeksBack = 8;
    var startDate = new Date();
    startDate.setDate(startDate.getDate() - (weeksBack * 7));

    var weekly = await SchoolResult.aggregate([
      {
        $match: {
          schoolId:  schoolId,
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            year: { $year:        '$createdAt' },
            week: { $isoWeek:     '$createdAt' }
          },
          submissions: { $sum: 1 },
          passed:      { $sum: { $cond: ['$isPassed', 1, 0] } },
          avgScore:    { $avg: '$scorePercent' }
        }
      },
      { $sort: { '_id.year': 1, '_id.week': 1 } }
    ]);

    /* Normalise to week labels */
    var timeline = weekly.map(function(w) {
      return {
        label:       'W' + w._id.week + '/' + w._id.year,
        submissions: w.submissions,
        passed:      w.passed,
        avgScore:    Math.round(w.avgScore || 0)
      };
    });

    return res.status(200).json({ success: true, timeline });

  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;