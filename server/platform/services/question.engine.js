/* ============================================
   LATLOMP PLATFORM — QUESTION ENGINE
   QMS Phase 3

   The Question Engine never stores questions.
   It only retrieves them from the Question Bank.

   RESPONSIBILITIES:
     assemble()         — random selection for CBT
     getAvailability()  — count matching questions
     getBreakdown()     — count grouped by subject
     buildFilter()      — reusable filter builder

   DESIGN PRINCIPLE:
     The existing CBT system (cbt.routes.js) uses
     the Question model directly. Phase 4 will replace
     those calls with engine.assemble() calls.
     Phase 3 only exposes the engine via admin API.

   COMPATIBILITY:
     Questions returned by assemble() have the same
     field shape as existing Question documents:
       question, options, correctAnswer, explanation
     Phase 4 integration requires zero schema changes.
============================================ */
'use strict';

var QMSQuestion = require('../models/QMSQuestion.model');

/* ---- Fisher-Yates shuffle ---- */
function shuffleArray(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* ============================================
   buildFilter(params)
   Builds a MongoDB filter from engine params.
   Always restricts to status: 'approved'.

   Params:
     examType     {string}  'jamb'|'waec'|'neco'|'post-utme'|'practice'|'all'
     subjectId    {string}  ObjectId — specific subject
     departmentId {string}  ObjectId — all subjects in dept
     difficulty   {string}  'easy'|'medium'|'hard'
     topic        {string}  partial match
     year         {number}  exact year
     keywords     {string}  partial match on keywords array
============================================ */
function buildFilter(params) {
  var filter = { status: 'approved' };

 if (params.examType && params.examType !== 'all') {
    /* ✅ PHASE 4: Match legacy CBT behavior — questions tagged 'all' are
       available for every exam type, just like examCategory:'all' in the
       existing Question model. Without this, questions imported with
       examType:'all' would not appear in any specific exam type query. */
    filter.examType = { $in: [params.examType, 'all'] };
  }

  /* subjectId takes priority over departmentId */
  if (params.subjectId) {
    filter.subjectId = params.subjectId;
  } else if (params.departmentId) {
    filter.departmentId = params.departmentId;
  }

  if (params.difficulty) {
    filter.difficulty = params.difficulty;
  }

  if (params.topic) {
    filter.topic = { $regex: params.topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  }

  if (params.year) {
    filter.year = parseInt(params.year);
  }

  if (params.keywords) {
    filter.keywords = { $in: [new RegExp(params.keywords, 'i')] };
  }

  return filter;
}

/* ============================================
   getAvailability(params)
   Returns how many approved questions match
   the given criteria. Used by admin UI to
   validate before assembling an exam.

   Returns: { available, filter }
============================================ */
async function getAvailability(params) {
  try {
    var filter    = buildFilter(params);
    var available = await QMSQuestion.countDocuments(filter);
    return { success: true, available: available, filter: filter };
  } catch (err) {
    return { success: false, available: 0, message: err.message };
  }
}

/* ============================================
   assemble(params)
   Core engine function. Randomly selects N
   approved questions matching the criteria.

   Uses MongoDB $sample for true random selection,
   then Fisher-Yates for additional shuffling.

   Params:
     ...buildFilter params...
     count    {number} how many questions to return (default 40)
     shuffle  {boolean} additional client-side shuffle (default true)

   Returns:
     { success, questions[], warning, meta: { requested, available, returned } }
============================================ */
async function assemble(params) {
  try {
    var filter    = buildFilter(params);
    var count     = Math.max(1, Math.min(500, parseInt(params.count) || 40));
    var doShuffle = params.shuffle !== false;

    var available = await QMSQuestion.countDocuments(filter);

    if (available === 0) {
      return {
        success:   false,
        message:   'No approved questions found for the specified criteria. ' +
                   'Verify that questions have been imported and approved for this exam type and subject.',
        questions: [],
        meta: { requested: count, available: 0, returned: 0 }
      };
    }

    var returning = Math.min(count, available);
    var warning   = null;

    if (available < count) {
      warning = 'Only ' + available + ' question' + (available !== 1 ? 's' : '') +
                ' available (requested ' + count + '). All available questions returned.';
    }

    /* $sample for true random selection from MongoDB */
    var questions = await QMSQuestion.aggregate([
      { $match: filter },
      { $sample: { size: returning } },
      {
        $project: {
          _id:            1,
          questionId:     1,
          question:       1,
          options:        1,
          correctAnswer:  1,
          explanation:    1,
          examType:       1,
          subjectId:      1,
          subjectName:    1,
          departmentId:   1,
          departmentName: 1,
          topic:          1,
          difficulty:     1,
          year:           1,
          source:         1
        }
      }
    ]);

    /* Additional Fisher-Yates for extra randomness beyond $sample */
    if (doShuffle) {
      questions = shuffleArray(questions);
    }

    return {
      success:   true,
      questions: questions,
      warning:   warning,
      meta: {
        requested: count,
        available: available,
        returned:  questions.length
      }
    };

  } catch (err) {
    return {
      success:   false,
      message:   'Engine assembly failed: ' + err.message,
      questions: [],
      meta:      { requested: 0, available: 0, returned: 0 }
    };
  }
}

/* ============================================
   getBreakdown(examType)
   Returns question counts grouped by exam type
   and subject. Used by admin to see what is
   available before building an exam.

   Returns: breakdown[] — each entry has:
     examType, subjectId, subjectName,
     departmentName, count
============================================ */
async function getBreakdown(examType) {
  try {
    var matchFilter = { status: 'approved' };
    if (examType && examType !== 'all') {
      matchFilter.examType = examType;
    }

    var results = await QMSQuestion.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: {
            examType:       '$examType',
            subjectId:      '$subjectId',
            subjectName:    '$subjectName',
            departmentName: '$departmentName',
            departmentId:   '$departmentId'
          },
          count:     { $sum: 1 },
          byEasy:    { $sum: { $cond: [{ $eq: ['$difficulty', 'easy']   }, 1, 0] } },
          byMedium:  { $sum: { $cond: [{ $eq: ['$difficulty', 'medium'] }, 1, 0] } },
          byHard:    { $sum: { $cond: [{ $eq: ['$difficulty', 'hard']   }, 1, 0] } },
          latestYear:{ $max: '$year' }
        }
      },
      { $sort: { '_id.examType': 1, 'count': -1 } }
    ]);

    return {
      success:   true,
      breakdown: results.map(function (r) {
        return {
          examType:       r._id.examType,
          subjectId:      r._id.subjectId,
          subjectName:    r._id.subjectName    || '(Unassigned)',
          departmentName: r._id.departmentName || '—',
          count:          r.count,
          byDifficulty:   { easy: r.byEasy, medium: r.byMedium, hard: r.byHard },
          latestYear:     r.latestYear
        };
      })
    };

  } catch (err) {
    return { success: false, breakdown: [], message: err.message };
  }
}

/* ============================================
   getSummaryStats()
   Top-level stats for the engine overview card.
============================================ */
async function getSummaryStats() {
  try {
    var [approved, byExam, byDiff] = await Promise.all([
      QMSQuestion.countDocuments({ status: 'approved' }),

      QMSQuestion.aggregate([
        { $match: { status: 'approved' } },
        { $group: { _id: '$examType', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),

      QMSQuestion.aggregate([
        { $match: { status: 'approved' } },
        { $group: { _id: '$difficulty', count: { $sum: 1 } } }
      ])
    ]);

    var examMap = {};
    byExam.forEach(function (e) { examMap[e._id] = e.count; });

    var diffMap = {};
    byDiff.forEach(function (d) { diffMap[d._id] = d.count; });

    return {
      success:      true,
      totalApproved: approved,
      byExamType:   examMap,
      byDifficulty: diffMap
    };
  } catch (err) {
    return { success: false, totalApproved: 0, byExamType: {}, byDifficulty: {} };
  }
}

module.exports = {
  assemble:       assemble,
  getAvailability: getAvailability,
  getBreakdown:   getBreakdown,
  getSummaryStats: getSummaryStats,
  buildFilter:    buildFilter
};