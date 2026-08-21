/* ============================================
   LATLOMP PLATFORM — CBT SESSION ROUTES
   
   FIXES IN THIS VERSION:
   1. Options NOT shuffled (submission bug fix)
      — user's answer index matches DB correctAnswer
   2. Question ORDER shuffled (anti-cheat)
   3. Questions capped to subject.questionCount
   4. Result saved with examCategory (no examId needed)
   5. Category-aware department and subject filtering
============================================ */

const express    = require('express');
const router     = express.Router();
const Department = require('../models/Department.model');
const Subject    = require('../models/Subject.model');
const Question   = require('../models/Question.model');
const Result     = require('../models/Result.model');
const User       = require('../models/User.model');
const { protect } = require('../middleware/auth.middleware');

/* ============================================
   ✅ PHASE 4: QMS Integration — lazy-loaded.
   Prevents circular dependency. Falls back
   safely if QMS models are not yet deployed.
   Students are never affected by QMS errors.
============================================ */
var _QMSQuestion = null;
var _qmsEngine   = null;

function getQMSQuestion() {
  if (!_QMSQuestion) {
    try { _QMSQuestion = require('../platform/models/QMSQuestion.model'); }
    catch (e) { /* QMS not available — legacy fallback active */ }
  }
  return _QMSQuestion;
}

function getQMSEngine() {
  if (!_qmsEngine) {
    try { _qmsEngine = require('../platform/services/question.engine'); }
    catch (e) { /* engine not available */ }
  }
  return _qmsEngine;
}

/* ✅ STAGE 4: ExaminationBlueprint lazy-loader.
   Blueprint configures count, duration, passMark and
   difficulty distribution for each subject + examType. */
var _ExamBlueprint = null;
function getExaminationBlueprint() {
  if (!_ExamBlueprint) {
    try { _ExamBlueprint = require('../platform/models/ExaminationBlueprint.model'); }
    catch (e) { /* blueprint model not available — use subject defaults */ }
  }
  return _ExamBlueprint;
}

/* ✅ ECE PHASE 5: ECEConfig lazy-loader */
var _ECEConfig = null;
function getECEConfig() {
  if (!_ECEConfig) {
    try { _ECEConfig = require('../ece/models/ECEConfig.model'); }
    catch (e) { /* ECEConfig not available — rules engine inactive */ }
  }
  return _ECEConfig;
}

/* Load CBT rules from ECEConfig.
   Always returns safe defaults — never throws.
   Called in both session/start and session/submit. */
async function loadCBTRules() {
  var defaults = {
    negative_marking:    false,
    negative_mark_value: 0.25,
    attempts_limit:      false,
    attempts_allowed:    1,
    shuffle_options:     false,
    review_allowed:      false
  };
  var ECECfgModel = getECEConfig();
  if (!ECECfgModel) { return defaults; }
  try {
    var cfg = await ECECfgModel.findOne({ scope: 'cbt', scopeId: null })
      .select('capabilities enabled').lean();
    if (!cfg || !cfg.enabled || !cfg.capabilities || !cfg.capabilities.rules) {
      return defaults;
    }
    var r = cfg.capabilities.rules;
    return {
      negative_marking:    !!r.negative_marking,
      negative_mark_value: typeof r.negative_mark_value === 'number' ? r.negative_mark_value : 0.25,
      attempts_limit:      !!r.attempts_limit,
      attempts_allowed:    typeof r.attempts_allowed === 'number' && r.attempts_allowed >= 1
                             ? Math.floor(r.attempts_allowed) : 1,
      shuffle_options:     !!r.shuffle_options,
      review_allowed:      !!r.review_allowed
    };
  } catch (e) {
    console.warn('[CBT] ECE rules config load failed:', e.message);
    return defaults;
  }
}

/* ============================================
   Fisher-Yates shuffle — question ORDER only
   Options are NOT shuffled to preserve answer
   index correctness on submission.
============================================ */
function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* ============================================
   GET /api/cbt/departments
   Public — filtered by examCategory
============================================ */
router.get('/departments', async (req, res) => {
  try {
    var filter = { isActive: true };
    if (req.query.category) filter.examCategory = req.query.category;

    const depts = await Department.find(filter).sort({ name: 1 });
    return res.status(200).json({ success: true, departments: depts });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load departments.' });
  }
});

/* ============================================
   GET /api/cbt/departments/:id/subjects
   Public — filtered by examCategory
============================================ */
router.get('/departments/:id/subjects', async (req, res) => {
  try {
    var filter = { department: req.params.id, isActive: true };
    var examCategory = req.query.category || null;

    if (examCategory) {
      filter.$or = [
        { examCategories: examCategory },
        { examCategories: 'all' }
      ];
    }

    const subjects = await Subject.find(filter)
      .select('name timeLimit questionCount instructions examCategories')
      .sort({ name: 1 });

    /* ✅ STAGE 5 FIX: Enrich each subject with its ExaminationBlueprint
       configuration before sending to the student.

       SECURITY PRINCIPLE:
         Students see examination configuration (blueprint.count, blueprint.duration).
         Students never see the Question Pool size.
         Pool size is admin-only information.

       FALLBACK CHAIN (when no blueprint is configured):
         count    → subject.questionCount (default 40)
         duration → subject.timeLimit (default 30)
         passMark → 50

       This means a subject with no blueprint still shows correct
       examination parameters to the student. */

    var enrichedSubjects = subjects.map(function (s) { return s.toObject(); });

    try {
      var ExamBP = require('../platform/models/ExaminationBlueprint.model');
      var questionType = 'objective'; /* student-facing always objective for now */

      /* Fetch all blueprints for these subjects in one query */
      var subjectIds = enrichedSubjects.map(function (s) { return s._id; });
      var blueprints = await ExamBP.find({
        subjectId:    { $in: subjectIds },
        questionType: questionType
      }).select('subjectId examType count duration passMark').lean();

      /* Build lookup: subjectId → best blueprint for this examCategory */
      var bpMap = {};
      blueprints.forEach(function (bp) {
        var sid = bp.subjectId.toString();
        /* Prefer exam-specific blueprint over 'all' */
        if (!bpMap[sid]) {
          bpMap[sid] = bp;
        } else if (examCategory && bp.examType === examCategory) {
          bpMap[sid] = bp;
        }
      });

      /* Attach blueprint values to each subject */
      enrichedSubjects = enrichedSubjects.map(function (s) {
        var bp = bpMap[s._id.toString()];
        return {
          _id:          s._id,
          name:         s.name,
          instructions: s.instructions,
          examCategories: s.examCategories,
          /* Blueprint values when available, subject defaults otherwise */
         questionCount:     bp ? bp.count    : s.questionCount,
          timeLimit:         bp ? bp.duration : s.timeLimit,
          passMark:          bp ? bp.passMark : 50,
          blueprintSet:      !!bp,
          /* ✅ FINAL STEP: Component settings for cbt-start.html */
          objectiveEnabled:  s.objectiveEnabled !== false,
          theoryEnabled:     !!s.theoryEnabled,
          objectiveCount:    s.objectiveCount  || s.questionCount,
          theoryCount:       s.theoryCount     || 5
        };
      });
    } catch (bpErr) {
      /* Blueprint enrichment failure must never break the student exam list.
         Fall back to raw subject values. */
      console.warn('[CBT] Blueprint enrichment failed:', bpErr.message);
      enrichedSubjects = enrichedSubjects.map(function (s) {
        return {
          _id:           s._id,
          name:          s.name,
          instructions:  s.instructions,
          examCategories:s.examCategories,
          questionCount: s.questionCount,
          timeLimit:     s.timeLimit,
          passMark:      50,
          blueprintSet:  false
        };
      });
    }

    return res.status(200).json({ success: true, subjects: enrichedSubjects });
  } catch (err) {
    console.error('[CBT] GET /departments/:id/subjects:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load subjects.' });
  }
});

/* ============================================
   POST /api/cbt/session/start — Protected
   
   CRITICAL FIX:
   - Questions shuffled (order randomized)
   - Options NOT shuffled (preserves correctAnswer index)
   - Questions capped to subject.questionCount
============================================ */
router.post('/session/start', protect, async (req, res) => {
  try {
    var examCategory = req.body.examCategory || 'practice';
    var subjectIds   = req.body.subjectIds;

    if (!Array.isArray(subjectIds) || subjectIds.length === 0)
      return res.status(400).json({ success: false, message: 'Please select at least one subject.' });

    var subjects = await Subject.find({ _id: { $in: subjectIds }, isActive: true });

    if (subjects.length === 0)
      return res.status(400).json({ success: false, message: 'No valid subjects found.' });

    /* ✅ ECE PHASE 5: Load rules config once before the subject loop */
    var _rules = await loadCBTRules();

    /* ✅ ECE PHASE 5: Attempts limit check */
    if (_rules.attempts_limit) {
      try {
        var attemptCount = await Result.countDocuments({
          userId:       req.user.id,
          examCategory: examCategory
        });
        if (attemptCount >= _rules.attempts_allowed) {
          return res.status(403).json({
            success:          false,
            attemptsExceeded: true,
            message:          'You have reached the maximum number of attempts (' +
                              _rules.attempts_allowed + ') for ' +
                              examCategory.toUpperCase() + ' exams. ' +
                              'Please contact your administrator.'
          });
        }
      } catch (attErr) {
        /* Non-critical — allow exam to proceed if check fails */
        console.warn('[CBT] Attempts limit check failed:', attErr.message);
      }
    }

    var sessionSubjects    = [];
    var allQuestions       = [];
    var totalTimeSeconds   = 0;
    /* ✅ FINAL STEP: 'both' mode — assembles objective + theory in one session.
       Components metadata tells exam.html which tabs to render. */
    var isBothMode     = (questionType === 'both');
    var componentsMeta = {};   /* populated when isBothMode = true */

    for (var i = 0; i < subjects.length; i++) {
      var subject = subjects[i];

     /* ✅ STAGE 4: Blueprint-driven QMS-only assembly.
         Legacy Question.find() fallback is removed.
         ExaminationBlueprint drives count, duration, passMark
         and difficulty distribution when configured.
         Subject defaults are used when no blueprint exists.
         If QMS returns no questions, the subject is skipped.       */

      var allSubjectQs     = [];
      var questionType     = req.body.questionType || 'objective';
      var blueprintUsed    = null;
      var assemblyCount    = subject.questionCount;  /* subject default */
      var assemblyTime     = subject.timeLimit;       /* subject default */
      var assemblyPassMark = 50;                      /* platform default */
      var diffDistribution = null;

      /* ---- 1. Load ExaminationBlueprint ---- */
      var ExamBP = getExaminationBlueprint();
      if (ExamBP) {
        try {
          /* Look for exam-specific blueprint (e.g. Biology + JAMB + objective) */
          var bp = await ExamBP.findOne({
            subjectId:    subject._id,
            questionType: questionType,
            examType:     examCategory
          }).lean();

          /* Fall back to 'all' blueprint if no exam-specific one exists */
          if (!bp) {
            bp = await ExamBP.findOne({
              subjectId:    subject._id,
              questionType: questionType,
              examType:     'all'
            }).lean();
          }

          if (bp) {
            blueprintUsed    = bp;
            assemblyCount    = bp.count    || subject.questionCount;
            assemblyTime     = bp.duration || subject.timeLimit;
            assemblyPassMark = bp.passMark !== undefined ? bp.passMark : 50;

            /* Only use difficulty distribution when percentages sum to ~100% */
            var dd  = bp.difficultyDistribution;
            var sum = dd ? ((dd.easy || 0) + (dd.medium || 0) + (dd.hard || 0)) : 0;
            if (dd && sum >= 95 && sum <= 105) {
              diffDistribution = dd;
            }
          }
        } catch (bpErr) {
          /* Blueprint lookup failure must never break a student's exam */
          console.warn('[CBT] Blueprint lookup failed for subject', subject._id, ':', bpErr.message);
        }
      }

     /* ---- 2. Assemble from Question Engine ---- */
      var qmsEng = getQMSEngine();

      /* ✅ FINAL FIX: 'both' mode — first assembly is ALWAYS 'objective'.
         Theory is assembled separately in the isBothMode block below.
         Passing 'both' to the QMS engine caused it to return 0 questions
         which is why all 13 questions showed as Objective: the engine
         silently failed and a fallback path assembled objective questions
         using the wrong count (subject.questionCount = 40, not 10).

         Per-component counts:
           Objective → subject.objectiveCount (admin-configured, e.g. 10)
           Theory    → subject.theoryCount    (admin-configured, e.g. 3)
         Both fall back to legacy questionCount / blueprint if not set. */
      var _firstAssemblyType  = isBothMode ? 'objective' : questionType;
      var _firstAssemblyCount = isBothMode
        ? (subject.objectiveCount || assemblyCount)
        : assemblyCount;

      if (qmsEng) {
        try {
          var engResult;
if (diffDistribution) {
            /* Blueprint with difficulty distribution → weighted assembly */
            engResult = await qmsEng.assembleFromBlueprint(
              subject._id.toString(),
              examCategory,
              /* ✅ FINAL FIX: Use corrected type ('objective' not 'both') */
              _firstAssemblyType,
              {
                /* ✅ FINAL FIX: Use per-component count */
                count:                  _firstAssemblyCount,
                difficultyDistribution: diffDistribution,
                randomize:              blueprintUsed ? blueprintUsed.randomize : true
              },
              true
            );
          } else {
            /* Standard random assembly — per-component count */
            engResult = await qmsEng.assemble({
              subjectId:    subject._id.toString(),
              examType:     examCategory,
              /* ✅ FINAL FIX: 'objective' not 'both' — engine doesn't know 'both' */
              questionType: _firstAssemblyType,
              /* ✅ FINAL FIX: objectiveCount (10) not questionCount (40) */
              count:        _firstAssemblyCount,
              shuffle:      true
            });
          }

          if (engResult.success && engResult.questions.length > 0) {
            /* Strip correctAnswer — never sent to client.
               ✅ ECE PHASE 5: When shuffle_options is enabled, shuffle each
               question's options and compute the new correct answer index.
               _correctAnswerIdx is stored in client sessionStorage (not
               rendered in the UI) so session/submit can grade correctly. */
            allSubjectQs = engResult.questions.map(function (q) {
              /* ✅ STEP 2: (q.options || []) — theory questions have no options.
                 .slice() on undefined would throw; default to [] prevents that. */
              var opts = (q.options || []).slice();
              var qObj = {
                _id:          q._id,
                question:     q.question,
                options:      opts,
                questionType: q.questionType || 'objective'  /* ✅ STEP 2: pass type to client */
              };

              if (_rules.shuffle_options && opts.length > 1) {
                /* Fisher-Yates shuffle on index array */
                var idx = opts.map(function (_, i) { return i; });
                for (var si = idx.length - 1; si > 0; si--) {
                  var sj   = Math.floor(Math.random() * (si + 1));
                  var stmp = idx[si]; idx[si] = idx[sj]; idx[sj] = stmp;
                }
                qObj.options = idx.map(function (i) { return opts[i]; });
                /* New position of correct answer in shuffled order */
                qObj._correctAnswerIdx = idx.indexOf(q.correctAnswer);
              }

              return qObj;
            });
            if (engResult.warning) {
              console.warn('[CBT Stage4] Subject', subject.name, '—', engResult.warning);
            }
          } else {
            console.warn('[CBT Stage4] No questions returned for subject "' + subject.name + '"',
              'examType:', examCategory, 'questionType:', questionType,
              '— subject skipped.',
              engResult.message || '');
          }

        } catch (engErr) {
          console.error('[CBT Stage4] Engine error for subject "' + subject.name + '":', engErr.message);
        }
      } else {
        console.error('[CBT Stage4] Question Engine not available — subject "' + subject.name + '" skipped.');
      }

     
     /* ✅ DEFINITIVE FIX: Theory assembly MUST happen BEFORE the
         continue check. Previous patches placed it after, so
         theorySubjectQs was always [] when checked → continue
         fired → subject skipped → "No questions found" error.

         Order:
           1. Objective assembled above (allSubjectQs)
           2. Theory assembled here (theorySubjectQs)
           3. THEN check if both empty → only skip if truly no questions
      */

      /* ---- STEP 2: Assemble theory questions (both mode) ---- */
      var theorySubjectQs = [];
      if (isBothMode && qmsEng) {
        try {
          var thBP = null;
          var ExamBP2 = getExaminationBlueprint();
          if (ExamBP2) {
            thBP = await ExamBP2.findOne({
              subjectId: subject._id, questionType: 'theory', examType: examCategory
            }).lean();
            if (!thBP) {
              thBP = await ExamBP2.findOne({
                subjectId: subject._id, questionType: 'theory', examType: 'all'
              }).lean();
            }
          }

          var thCount = (subject.theoryCount > 0 ? subject.theoryCount : null)
                      || (thBP ? thBP.count : null)
                      || 5;

          var thResult = await qmsEng.assemble({
            subjectId:    subject._id.toString(),
            examType:     examCategory,
            questionType: 'theory',
            count:        thCount,
            shuffle:      true
          });

          if (thResult.success && thResult.questions.length > 0) {
            theorySubjectQs = thResult.questions.map(function(q) {
              return {
                _id:          q._id,
                question:     q.question,
                options:      [],
                questionType: 'theory',
                _subjectId:   subject._id.toString(),
                _subjectName: subject.name
              };
            });
          }
        } catch (thErr) {
          console.warn('[CBT] both-mode theory assembly failed:', thErr.message);
        }
      }

      /* ---- STEP 3: Skip subject only if BOTH types returned nothing ---- */
      if (allSubjectQs.length === 0 && theorySubjectQs.length === 0) {
        console.warn('[CBT] No questions for subject "' + subject.name + '" — skipped.');
        continue;
      }

      /* Shuffle question ORDER (anti-cheat) */
      var shuffledQs = shuffle(allSubjectQs);

      /* ✅ FINAL FIX: Cap uses per-component count.
         In 'both' mode: _firstAssemblyCount = objectiveCount (e.g. 10).
         In single mode: _firstAssemblyCount = assemblyCount (blueprint or questionCount). */
      var cap    = Math.min(_firstAssemblyCount, shuffledQs.length);
      var picked = shuffledQs.slice(0, cap);

      /* Options stay in ORIGINAL order — index matches DB correctAnswer */
      /* ✅ STEP 2: questionType included so exam.js renderQuestion()
         can switch between MCQ options and theory textarea. */
      var tagged = picked.map(function (q) {
        return {
          _id:          q._id,
          question:     q.question,
          options:      q.options || [],
          questionType: q.questionType || 'objective',
          _subjectId:   subject._id.toString(),
          _subjectName: subject.name
        };
      });

      /* ✅ FINAL STEP: Append theory questions for 'both' mode */
      var theoryPicked = theorySubjectQs;
      if (theoryPicked.length > 0) {
        tagged = tagged.concat(theoryPicked);
        /* Track component metadata for exam.html tabs */
        if (!componentsMeta.objective) { componentsMeta.objective = 0; }
        if (!componentsMeta.theory)    { componentsMeta.theory    = 0; }
        componentsMeta.objective += picked.length;
        componentsMeta.theory    += theoryPicked.length;
        /* Add theory time (30 mins per theory component by default) */
        totalTimeSeconds += 30 * 60;
      }

      /* ✅ STAGE 4: Session subject includes blueprint values when available */
      sessionSubjects.push({
        subjectId:     subject._id,
        subjectName:   subject.name,
        questionCount: picked.length,
        timeLimit:     assemblyTime,
        timeLimitSecs: assemblyTime * 60,
        instructions:  blueprintUsed
          ? (blueprintUsed.instructions || subject.instructions)
          : subject.instructions,
        passMark:      assemblyPassMark,
        blueprintUsed: !!blueprintUsed
      });

      allQuestions     = allQuestions.concat(tagged);
      totalTimeSeconds += assemblyTime * 60;
    }

    if (allQuestions.length === 0)
      return res.status(400).json({
        success: false,
        message: 'No questions found for the selected subjects and exam category. Ask your admin to add questions first.'
      });

    /* Final shuffle of the combined question list across subjects */
    var finalQuestions = shuffle(allQuestions);

    return res.status(200).json({
      success: true,
      session: {
        examCategory:     examCategory,
        subjects:         sessionSubjects,
        totalQuestions:   finalQuestions.length,
        totalTimeSeconds: totalTimeSeconds,
        questions:        finalQuestions,
        /* ✅ FINAL STEP: Component metadata for exam.html tab bar.
           Empty when single-type session. */
        components:       Object.keys(componentsMeta).length > 0
          ? componentsMeta
          : null,
        /* ✅ ECE PHASE 5: Rules config for client display and result page */
        rules: {
          negativeMarking:   _rules.negative_marking,
          negativeMarkValue: _rules.negative_mark_value,
          shuffleOptions:    _rules.shuffle_options,
          reviewAllowed:     _rules.review_allowed
        }
      }
    });

  } catch (err) {
    console.error('CBT session start error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to start exam session.' });
  }
});

/* ============================================
   POST /api/cbt/session/submit — Protected
   
   CRITICAL FIX:
   - Options were NOT shuffled, so user's answer
     index matches original DB correctAnswer index
   - Results saved without requiring examId
   - Prevents duplicate submission via _submitted flag
   - Full per-subject breakdown saved
============================================ */
router.post('/session/submit', protect, async (req, res) => {
  try {
    var examCategory  = req.body.examCategory || 'practice';
    var subjectIds    = req.body.subjectIds   || [];
    var answers       = req.body.answers      || {};
    var timeTaken     = parseInt(req.body.timeTaken) || 0;
    var wasAutoSubmit = !!req.body.wasAutoSubmit;

    if (!answers || typeof answers !== 'object')
      return res.status(400).json({ success: false, message: 'Answers are required.' });

    var questionIds = Object.keys(answers);

    if (questionIds.length === 0)
      return res.status(400).json({ success: false, message: 'No answers received.' });

    /* ✅ PHASE 4: Fetch questions from legacy model first.
       Any IDs not found in legacy are looked up in QMSQuestion.
       Both models have compatible grading fields:
         question, options, correctAnswer, explanation, subjectId.
       This handles mixed sessions (some legacy, some QMS) correctly. */
    var questions = await Question.find({
      _id:      { $in: questionIds },
      isActive: true
    });

    var QMSQModel = getQMSQuestion();
    if (QMSQModel && questions.length < questionIds.length) {
      /* Find which IDs were not in the legacy collection */
      var foundLegacy = {};
      questions.forEach(function (q) { foundLegacy[q._id.toString()] = true; });
      var missingIds  = questionIds.filter(function (id) { return !foundLegacy[id]; });

      if (missingIds.length > 0) {
        try {
          var qmsFound = await QMSQModel.find({
            _id:    { $in: missingIds },
            status: 'approved'
          }).lean();
          if (qmsFound.length > 0) {
            questions = questions.concat(qmsFound);
          }
        } catch (qmsErr) {
          /* Log but don't fail — grade what we have from legacy */
          console.warn('[CBT] QMS question lookup on submit failed:', qmsErr.message);
        }
      }
    }

    if (questions.length === 0)
      return res.status(400).json({ success: false, message: 'Could not find the exam questions. Please try again.' });

    /* ============================================
       GRADE ANSWERS
       
       user sent: answers[questionId] = optionIndex
       (index into the original options array
        because options were NOT shuffled)
       
       DB has: question.correctAnswer = originalIndex
       
       ✅ Direct comparison now works correctly
    ============================================ */
   /* ✅ ECE PHASE 5: Option mappings for shuffle_options + rules for negative marking */
    var optionMappings = req.body.optionMappings || {};
    var submitRules    = await loadCBTRules();

    var correctCount   = 0;
    var wrongCount     = 0;
    var objectiveTotal = 0;   /* ✅ STEP 2: objective questions only */
    var theoryTotal    = 0;   /* ✅ STEP 2: theory questions — pending manual review */
    var totalAnswered  = questions.length;   /* total Q count preserved for Result record */
    var gradedAnswers  = [];
    var subjectBreakdown = {};

    questions.forEach(function (q) {
      var qId        = q._id.toString();
      var userAnswer = answers[qId];

      /* ✅ STEP 2: Theory questions cannot be auto-graded.
         Store the student's text answer and mark as pending review.
         They do NOT contribute to correctCount, wrongCount, or scorePercent.
         Backward compat: legacy Question docs have no questionType field
         (undefined) → isTheory is false → treated as objective. ✅ */
      var isTheory = (q.questionType === 'theory');

      if (isTheory) {
        theoryTotal++;

        var tSid = q.subjectId ? q.subjectId.toString() : 'general';
        if (!subjectBreakdown[tSid]) {
          subjectBreakdown[tSid] = { correct: 0, total: 0, theoryTotal: 0 };
        }
        subjectBreakdown[tSid].total++;
        subjectBreakdown[tSid].theoryTotal =
          (subjectBreakdown[tSid].theoryTotal || 0) + 1;

        gradedAnswers.push({
          questionId:    q._id,
          question:      q.question,
          options:       [],
          userAnswer:    (userAnswer !== undefined && userAnswer !== null)
                           ? String(userAnswer) : null,
          correctAnswer: 0,
          isCorrect:     false,       /* pending review — never auto-graded */
          explanation:   q.explanation || q.modelAnswer || '',
          subjectId:     q.subjectId || null,
          questionType:  'theory'
        });
        return;   /* skip objective grading for this question */
      }

      /* ── Objective question grading (unchanged logic) ── */
      objectiveTotal++;

      /* ✅ ECE PHASE 5: Use remapped correct answer index when shuffle_options active */
      var correctIdx = q.correctAnswer;
      if (typeof optionMappings[qId] === 'number') {
        correctIdx = optionMappings[qId];
      }

      var isCorrect = (typeof userAnswer === 'number') && (userAnswer === correctIdx);

      if (isCorrect) {
        correctCount++;
        Question.findByIdAndUpdate(q._id, { $inc: { timesAnswered: 1, timesCorrect: 1 } }).exec();
      } else {
        /* Only count answered-wrong (not skipped) for negative marking */
        if (typeof userAnswer === 'number') { wrongCount++; }
        Question.findByIdAndUpdate(q._id, { $inc: { timesAnswered: 1 } }).exec();
      }

      var sid = q.subjectId ? q.subjectId.toString() : 'general';
      if (!subjectBreakdown[sid]) { subjectBreakdown[sid] = { correct: 0, total: 0 }; }
      subjectBreakdown[sid].total++;
      if (isCorrect) { subjectBreakdown[sid].correct++; }

      gradedAnswers.push({
        questionId:    q._id,
        question:      q.question,
        options:       q.options,
        userAnswer:    userAnswer !== undefined ? userAnswer : null,
        correctAnswer: correctIdx,   /* remapped index when shuffle active */
        isCorrect:     isCorrect,
        explanation:   q.explanation || '',
        subjectId:     q.subjectId || null,
        questionType:  'objective'
      });
    });

    /* ✅ ECE PHASE 5: Negative marking — objective questions only */
    var negativeMarksDeducted = 0;
    var rawScore              = correctCount;
    var adjustedScore         = correctCount;

    if (submitRules.negative_marking && wrongCount > 0) {
      var deduction         = wrongCount * submitRules.negative_mark_value;
      negativeMarksDeducted = Math.round(deduction * 100) / 100;
      adjustedScore         = Math.max(0, correctCount - negativeMarksDeducted);
    }

    /* ✅ STEP 2: Score calculated from objective questions only.
       Theory questions are pending manual review and cannot affect auto-score.
       If session has ONLY theory questions, score = 0 until teacher marks. */
    var scorePercent = objectiveTotal > 0
      ? Math.max(0, Math.round((adjustedScore / objectiveTotal) * 100))
      : 0;
    var isPassed = objectiveTotal > 0 ? (scorePercent >= 50) : false;

    var examTitle = examCategory.toUpperCase() + ' Exam — ' +
      new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });

    /* ✅ FIX: Save result WITHOUT requiring examId */
    var result = await Result.create({
      userId:                req.user.id,
      examId:                null,
      examCategory:          examCategory,
      examTitle:             examTitle,
      score:                 correctCount,          /* correct count — never adjusted */
      totalQuestions:        totalAnswered,
      scorePercent:          scorePercent,          /* adjusted for negative marking */
      passMark:              50,
      isPassed:              isPassed,
      timeTaken:             timeTaken,
      timeAllowed:           0,
      wasAutoSubmit:         wasAutoSubmit,
      answers:               gradedAnswers,
      rawScore:              rawScore,
      negativeMarksDeducted: negativeMarksDeducted
    });

    /* Update user lifetime stats */
    try {
      var user = await User.findById(req.user.id);
      if (user && user.stats) {
        var prevTotal = user.stats.totalExamsTaken || 0;
        var newTotal  = prevTotal + 1;
        var newAvg    = Math.round(((user.stats.averageScore || 0) * prevTotal + scorePercent) / newTotal);
        var newBest   = Math.max(user.stats.bestScore || 0, scorePercent);
        await User.findByIdAndUpdate(req.user.id, {
          'stats.totalExamsTaken': newTotal,
          'stats.averageScore':    newAvg,
          'stats.bestScore':       newBest
        });
      }
    } catch (statsErr) {
      /* Stats update failure should not fail the whole submission */
      console.warn('Stats update failed:', statsErr.message);
    }

    console.log('CBT submitted — user:', req.user.id, 'score:', scorePercent + '%', isPassed ? 'PASSED' : 'FAILED');

    return res.status(200).json({
      success:  true,
      message:  isPassed ? '🎉 Congratulations! You passed!' : '📚 Keep practicing!',
      result: {
        id:                    result._id,
        score:                 correctCount,
        totalQuestions:        totalAnswered,
        objectiveTotal:        objectiveTotal,    /* ✅ STEP 2 */
        theoryTotal:           theoryTotal,        /* ✅ STEP 2 */
        hasTheoryPending:      theoryTotal > 0,    /* ✅ STEP 2 */
        scorePercent:          scorePercent,
        isPassed:              isPassed,
        timeTaken:             timeTaken,
        subjectBreakdown:      subjectBreakdown,
        gradedAnswers:         gradedAnswers,
        /* ✅ ECE PHASE 5: Negative marking transparency */
        rawScore:              rawScore,
        negativeMarksDeducted: negativeMarksDeducted
      }
    });

  } catch (err) {
    console.error('CBT submit error:', err.message, err.stack);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit exam. Please try again.'
    });
  }
});

/* ============================================
   POST /api/cbt/subject-components
   Public — no auth required.

   Given selected subjectIds + examCategory,
   returns which question-type components have
   both a blueprint AND approved questions in
   the QMS pool.

   Objective always falls back to legacy Question
   model if QMS has nothing.

   Body:    { examCategory: string, subjectIds: [] }
   Returns: { success, components: { objective: bool, theory: bool } }

   Called by cbt-start.html after subject selection
   to determine whether a component selector should
   be shown to the student.
============================================ */
router.post('/subject-components', async (req, res) => {
  /* Safe default — objective always available */
  var components = { objective: true, theory: false };

  try {
    var examCategory = ((req.body.examCategory || 'practice') + '').toLowerCase().trim();
    var rawIds       = Array.isArray(req.body.subjectIds) ? req.body.subjectIds : [];

    if (rawIds.length === 0) {
      return res.json({ success: true, components: components });
    }

    /* Convert to ObjectId — aggregate ignores plain strings */
    var mongoose2 = require('mongoose');
    var objectIds = rawIds.map(function (id) {
      try { return new mongoose2.Types.ObjectId(id.toString()); }
      catch (e) { return null; }
    }).filter(Boolean);

    var ExamBP    = getExaminationBlueprint();
    var QMSQModel = getQMSQuestion();

    /* QMSQModel is required for question counting.
       ExamBP is no longer required for component detection. */
    if (!QMSQModel) {
      return res.json({ success: true, components: components });
    }

    /* ✅ FINAL STEP: Check Subject-level ON/OFF settings FIRST.
       These are the admin's explicit component controls.
       Blueprint/pool checks only run for components that are enabled. */
    try {
      var subjectDocs = await Subject.find({ _id: { $in: objectIds } })
        .select('objectiveEnabled theoryEnabled')
        .lean();

      /* Objective is enabled only if ALL selected subjects have it enabled
         (or the field is absent — default is true). */
      var objEnabled = subjectDocs.every(function(s) {
        return s.objectiveEnabled !== false;
      });
      /* Theory is enabled only if ALL selected subjects have it enabled. */
      var thEnabled = subjectDocs.length > 0 && subjectDocs.every(function(s) {
        return s.theoryEnabled === true;
      });

      if (!objEnabled) { components.objective = false; }
      if (!thEnabled)  { components.theory    = false; }
    } catch (subjErr) {
      /* Non-critical — fall through to blueprint check */
      console.warn('[CBT] subject-components Subject settings check failed:', subjErr.message);
    }

   /* ✅ FINAL FIX: Component availability = Subject settings + QMS questions.
       Blueprint is NOT required. Blueprint controls count/duration only.

       Previous requirement: blueprint must exist → always blocked theory
       because most subjects have no theory blueprint configured.

       New requirement: Subject.theoryEnabled = true + approved QMS questions. */

    /* OBJECTIVE: verify questions exist (QMS or legacy fallback) */
    if (components.objective) {
      var objQCount = await QMSQModel.countDocuments({
        subjectId:    { $in: objectIds },
        examType:     { $in: [examCategory, 'all'] },
        questionType: { $in: [null, 'objective'] },
        status:       'approved'
      });
      if (objQCount === 0) {
        /* Fallback: legacy Question model */
        try {
          var LegacyQ   = require('../models/Question.model');
          var legFilter = { isActive: true, subjectId: { $in: objectIds } };
          if (examCategory !== 'practice') {
            legFilter.$or = [{ examCategory: examCategory }, { examCategory: 'all' }];
          }
          var legCount = await LegacyQ.countDocuments(legFilter);
          if (legCount === 0) { components.objective = false; }
        } catch (legErr) { /* keep objective:true as safe default */ }
      }
    }

    /* THEORY: Subject.theoryEnabled must be true AND questions must exist */
    try {
      var subjRows = await Subject.find({ _id: { $in: objectIds } })
        .select('theoryEnabled').lean();

      var allTheoryOn = subjRows.length > 0 && subjRows.every(function(s) {
        return s.theoryEnabled === true;
      });

      if (allTheoryOn) {
        var thQCount = await QMSQModel.countDocuments({
          subjectId:    { $in: objectIds },
          examType:     { $in: [examCategory, 'all'] },
          questionType: 'theory',
          status:       'approved'
        });
        if (thQCount > 0) { components.theory = true; }
        /* thQCount === 0: theory ON but no questions → keep false, don't crash */
      }
    } catch (thErr) {
      console.warn('[CBT] theory component check failed:', thErr.message);
      /* components.theory stays false — safe default */
    }

    /* --- THEORY: only if Subject.theoryEnabled AND questions exist --- */
    /* components.theory starts false. Subject settings check above sets it
       to false if theoryEnabled is false. We only need to handle the case
       where theoryEnabled IS true — check if questions actually exist. */
    if (!components.theory) {
      /* Theory was blocked by Subject settings (theoryEnabled:false).
         Nothing more to check — keep false. */
    } else {
      /* theoryEnabled is true on all selected subjects — verify questions */
      var theoryQCount = await QMSQModel.countDocuments({
        subjectId:    { $in: objectIds },
        examType:     { $in: [examCategory, 'all'] },
        questionType: 'theory',
        status:       'approved'
      });
      if (theoryQCount === 0) {
        /* Theory enabled in Subject settings but no questions imported yet */
        components.theory = false;
      }
      /* else: theoryQCount > 0 → components.theory stays true from Subject check */
    }

    /* Re-read theoryEnabled from subjects to set initial theory flag
       (Subject settings check above only sets false, never true) */
    try {
      var subjForTheory = await Subject.find({ _id: { $in: objectIds } })
        .select('theoryEnabled').lean();
      var allTheoryEnabled = subjForTheory.length > 0 && subjForTheory.every(function(s) {
        return s.theoryEnabled === true;
      });

      if (allTheoryEnabled) {
        /* Check QMS for theory questions */
        var tCount = await QMSQModel.countDocuments({
          subjectId:    { $in: objectIds },
          examType:     { $in: [examCategory, 'all'] },
          questionType: 'theory',
          status:       'approved'
        });
        if (tCount > 0) { components.theory = true; }
      }
    } catch (thErr) {
      console.warn('[CBT] theory component check failed:', thErr.message);
    }

    /* Objective fallback: check legacy Question model */
    if (!components.objective) {
      try {
        var LegacyQ  = require('../models/Question.model');
        var legFilter = { isActive: true, subjectId: { $in: objectIds } };
        if (examCategory !== 'practice') {
          legFilter.$or = [
            { examCategory: examCategory },
            { examCategory: 'all' }
          ];
        }
        var legCount = await LegacyQ.countDocuments(legFilter);
        if (legCount > 0) { components.objective = true; }
      } catch (legErr) { /* Legacy model unavailable */ }
    }

    /* Safety: never return all false */
    if (!Object.values(components).some(Boolean)) {
      components.objective = true;
    }

    return res.json({ success: true, components: components });

  } catch (err) {
    console.error('[CBT] /subject-components error:', err.message);
    /* Never break exam flow — return safe default */
    return res.json({ success: true, components: { objective: true, theory: false } });
  }
});

module.exports = router;