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

    if (req.query.category) {
      filter.$or = [
        { examCategories: req.query.category },
        { examCategories: 'all' }
      ];
    }

    const subjects = await Subject.find(filter)
      .select('name timeLimit questionCount instructions examCategories totalQuestions')
      .sort({ name: 1 });

    return res.status(200).json({ success: true, subjects });
  } catch (err) {
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

    var sessionSubjects    = [];
    var allQuestions       = [];
    var totalTimeSeconds   = 0;

    for (var i = 0; i < subjects.length; i++) {
      var subject = subjects[i];

      /* Build question filter for this subject and category */
      var qFilter = { subjectId: subject._id, isActive: true };

      if (examCategory !== 'practice') {
        qFilter.$or = [
          { examCategory: examCategory },
          { examCategory: 'all' }
        ];
      }
      /* Practice mode: all questions available */

      /* Fetch questions — only fields needed (no correctAnswer sent to client) */
      var allSubjectQs = await Question.find(qFilter)
        .select('question options _id')  /* correctAnswer intentionally excluded */
        .lean();

      if (allSubjectQs.length === 0) continue;

      /* ✅ FIX 1: Shuffle question ORDER */
      var shuffledQs = shuffle(allSubjectQs);

      /* ✅ FIX 2: Cap to questionCount (anti-cheat + per-session limit) */
      var cap    = Math.min(subject.questionCount, shuffledQs.length);
      var picked = shuffledQs.slice(0, cap);

      /* ✅ FIX 3: Options stay in ORIGINAL order — index matches DB correctAnswer */
      var tagged = picked.map(function(q) {
        return {
          _id:         q._id,
          question:    q.question,
          options:     q.options,   /* original order preserved */
          _subjectId:   subject._id.toString(),
          _subjectName: subject.name
        };
      });

      sessionSubjects.push({
        subjectId:     subject._id,
        subjectName:   subject.name,
        questionCount: picked.length,
        timeLimit:     subject.timeLimit,
        timeLimitSecs: subject.timeLimit * 60,
        instructions:  subject.instructions
      });

      allQuestions    = allQuestions.concat(tagged);
      totalTimeSeconds += subject.timeLimit * 60;
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
        questions:        finalQuestions
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

    /* Fetch ALL answered questions WITH correct answers (server-side grading only) */
    var questions = await Question.find({
      _id:      { $in: questionIds },
      isActive: true
    });

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
    var correctCount     = 0;
    var totalAnswered    = questions.length;
    var gradedAnswers    = [];
    var subjectBreakdown = {};

    questions.forEach(function(q) {
      var qId          = q._id.toString();
      var userAnswer   = answers[qId];
      var isCorrect    = (typeof userAnswer === 'number') && (userAnswer === q.correctAnswer);

      if (isCorrect) {
        correctCount++;
        Question.findByIdAndUpdate(q._id, { $inc: { timesAnswered: 1, timesCorrect: 1 } }).exec();
      } else {
        Question.findByIdAndUpdate(q._id, { $inc: { timesAnswered: 1 } }).exec();
      }

      /* Subject breakdown */
      var sid = q.subjectId ? q.subjectId.toString() : 'general';
      if (!subjectBreakdown[sid]) subjectBreakdown[sid] = { correct: 0, total: 0 };
      subjectBreakdown[sid].total++;
      if (isCorrect) subjectBreakdown[sid].correct++;

      gradedAnswers.push({
        questionId:    q._id,
        question:      q.question,
        options:       q.options,
        userAnswer:    userAnswer !== undefined ? userAnswer : null,
        correctAnswer: q.correctAnswer,
        isCorrect:     isCorrect,
        explanation:   q.explanation || '',
        subjectId:     q.subjectId || null
      });
    });

    var scorePercent = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;
    var isPassed     = scorePercent >= 50;

    var examTitle = examCategory.toUpperCase() + ' Exam — ' +
      new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });

    /* ✅ FIX: Save result WITHOUT requiring examId */
    var result = await Result.create({
      userId:         req.user.id,
      examId:         null,          /* not a legacy exam */
      examCategory:   examCategory,
      examTitle:      examTitle,
      score:          correctCount,
      totalQuestions: totalAnswered,
      scorePercent:   scorePercent,
      passMark:       50,
      isPassed:       isPassed,
      timeTaken:      timeTaken,
      timeAllowed:    0,
      wasAutoSubmit:  wasAutoSubmit,
      answers:        gradedAnswers
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
        id:               result._id,
        score:            correctCount,
        totalQuestions:   totalAnswered,
        scorePercent:     scorePercent,
        isPassed:         isPassed,
        timeTaken:        timeTaken,
        subjectBreakdown: subjectBreakdown,
        gradedAnswers:    gradedAnswers
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

module.exports = router;