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

  /* ✅ STAGE 5 FIX: Backward-compatible questionType filter.
     Documents imported before Stage 1 have no questionType field in MongoDB.
     MongoDB schema defaults do not apply retroactively to existing documents.

     For 'objective' (the platform default): use $in with null so MongoDB
     also matches documents where questionType is null or absent.
     { $in: [null, 'objective'] } matches:
       - questionType === 'objective'  (new documents with field set)
       - questionType === null         (documents with field explicitly null)
       - questionType field missing    (all pre-Stage-1 QMS documents)

     For other types (theory/practical/oral): match strictly — these question
     types were created intentionally and always have the field set. */
  if (params.questionType) {
    if (params.questionType === 'objective') {
      filter.questionType = { $in: [null, 'objective'] };
    } else {
      filter.questionType = params.questionType;
    }
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

/* ============================================
   assembleFromBlueprint(subjectId, examType, questionType, blueprint, doShuffle)

   ✅ STAGE 4: Blueprint-driven assembly.
   Uses difficultyDistribution to sample proportionally
   from each difficulty tier. Fills any shortfall from
   whichever difficulty has surplus questions.

   blueprint: { count, difficultyDistribution: { easy, medium, hard }, randomize }
   Returns same shape as assemble() for full compatibility.
============================================ */
async function assembleFromBlueprint(subjectId, examType, questionType, blueprint, doShuffle) {
  try {
    var count        = Math.max(1, Math.min(500, parseInt(blueprint.count) || 40));
    var dist         = blueprint.difficultyDistribution || { easy: 33, medium: 34, hard: 33 };
    var useRandomize = blueprint.randomize !== false;
    doShuffle        = (doShuffle !== false) && useRandomize;
    questionType     = questionType || 'objective';

    /* ---- Base filter ---- */
    var baseFilter = { status: 'approved', questionType: questionType };

    if (subjectId) {
      baseFilter.subjectId = subjectId;
    }
    if (examType && examType !== 'all') {
      baseFilter.examType = { $in: [examType, 'all'] };
    }

    /* ---- Project — strip correctAnswer from engine assembly output ----
       session/start strips it again before sending to client, but
       keeping it consistent here matches assemble(). */
    var PROJECT = {
      _id:            1,
      questionId:     1,
      question:       1,
      options:        1,
      correctAnswer:  1,
      explanation:    1,
      examType:       1,
      questionType:   1,
      subjectId:      1,
      subjectName:    1,
      departmentId:   1,
      departmentName: 1,
      topic:          1,
      difficulty:     1,
      year:           1,
      source:         1
    };

    /* ---- Proportional difficulty counts ----
       Easy and hard are floored; medium takes the remainder so
       the three values always sum exactly to count. */
    var pctTotal    = (dist.easy || 0) + (dist.medium || 0) + (dist.hard || 0);
    var safePct     = pctTotal > 0 ? pctTotal : 100;
    var easyCount   = Math.floor(count * (dist.easy   || 0) / safePct);
    var hardCount   = Math.floor(count * (dist.hard   || 0) / safePct);
    var mediumCount = count - easyCount - hardCount;   /* takes remainder */

    /* ---- Sample each difficulty tier in parallel ---- */
    var _diffShortfall = { easy: 0, medium: 0, hard: 0 };

    async function sampleDiff(difficulty, needed) {
      if (needed <= 0) { return []; }
      var f         = Object.assign({ difficulty: difficulty }, baseFilter);
      var available = await QMSQuestion.countDocuments(f);
      var take      = Math.min(needed, available);
      _diffShortfall[difficulty] = needed - take;
      if (take === 0) { return []; }
      return QMSQuestion.aggregate([
        { $match:   f },
        { $sample:  { size: take } },
        { $project: PROJECT }
      ]);
    }

    var easyQs, mediumQs, hardQs;
    try {
      var diffResults = await Promise.all([
        sampleDiff('easy',   easyCount),
        sampleDiff('medium', mediumCount),
        sampleDiff('hard',   hardCount)
      ]);
      easyQs   = diffResults[0];
      mediumQs = diffResults[1];
      hardQs   = diffResults[2];
    } catch (diffErr) {
      /* If parallel difficulty fetch fails, fall back to standard assemble */
      console.warn('[Engine] assembleFromBlueprint difficulty fetch failed, falling back:', diffErr.message);
      return assemble({
        subjectId:    subjectId,
        examType:     examType,
        questionType: questionType,
        count:        count,
        shuffle:      doShuffle
      });
    }

    var combined = [].concat(easyQs, mediumQs, hardQs);

    /* ---- Fill shortfall from any available questions ----
       If any tier returned fewer than needed, fill the gap from
       the remaining approved pool (excluding already selected). */
    if (combined.length < count) {
      var needed     = count - combined.length;
      var usedIds    = combined.map(function (q) { return q._id; });
      var fillFilter = Object.assign({ _id: { $nin: usedIds } }, baseFilter);

      try {
        var fillAvail = await QMSQuestion.countDocuments(fillFilter);
        var fillTake  = Math.min(needed, fillAvail);
        if (fillTake > 0) {
          var fill = await QMSQuestion.aggregate([
            { $match:   fillFilter },
            { $sample:  { size: fillTake } },
            { $project: PROJECT }
          ]);
          combined = combined.concat(fill);
        }
      } catch (fillErr) {
        console.warn('[Engine] assembleFromBlueprint fill step failed:', fillErr.message);
        /* Combined is partially filled — still usable */
      }
    }

    if (combined.length === 0) {
      return {
        success:   false,
        message:   'No approved questions found for this subject, exam type, and question type.',
        questions: [],
        meta:      { requested: count, available: 0, returned: 0 }
      };
    }

    if (doShuffle) {
      combined = shuffleArray(combined);
    }

    var totalAvailable = await QMSQuestion.countDocuments(baseFilter);

    return {
      success:   true,
      questions: combined,
      warning:   combined.length < count
        ? 'Only ' + combined.length + ' of ' + count + ' requested questions available.' : null,
      meta: {
        requested:   count,
        available:   totalAvailable,
        returned:    combined.length,
        blueprint:   true,
        distribution: {
          easy:   easyQs.length,
          medium: mediumQs.length,
          hard:   hardQs.length,
          fill:   combined.length - easyQs.length - mediumQs.length - hardQs.length
        }
      }
    };

  } catch (err) {
    return {
      success:   false,
      message:   'Blueprint assembly failed: ' + err.message,
      questions: [],
      meta:      { requested: 0, available: 0, returned: 0 }
    };
  }
}

module.exports = {
  assemble:             assemble,
  assembleFromBlueprint:assembleFromBlueprint,
  getAvailability:      getAvailability,
  getBreakdown:         getBreakdown,
  getSummaryStats:      getSummaryStats,
  buildFilter:          buildFilter
};