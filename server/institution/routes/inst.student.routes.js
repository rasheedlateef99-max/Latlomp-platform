/* ============================================
   LATLOMP INSTITUTION — STUDENT EXAM ROUTES
   
   No login required for exam access.
   Access is by exam code only.
   
   ✅ CBT UPGRADE CHANGES:
   - Activation window enforced on verify-code
     (scheduledStart / scheduledEnd)
   - shuffleOptions supported with per-session
     index mapping embedded in session token
     so correct answer lookup always uses
     the original DB index
============================================ */
const express        = require('express');
const router         = express.Router();
const School         = require('../models/School.model');
const SchoolExam     = require('../models/SchoolExam.model');
const SchoolQuestion = require('../models/SchoolQuestion.model');
const SchoolResult   = require('../models/SchoolResult.model');
const SchoolStudent  = require('../models/SchoolStudent.model');

/* ============================================
   Fisher-Yates shuffle (returns new array)
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
   Format a date for Nigerian users
============================================ */
function fmtDate(d) {
  try {
    return new Date(d).toLocaleString('en-NG', {
      timeZone:     'Africa/Lagos',
      day:          'numeric',
      month:        'short',
      year:         'numeric',
      hour:         '2-digit',
      minute:       '2-digit',
      hour12:       true
    });
  } catch (e) {
    return new Date(d).toString();
  }
}

/* ---- Verify access code and load exam ---- */
router.post('/verify-code', async (req, res) => {
  try {
    var { accessCode, studentName, admissionNo } = req.body;

    if (!accessCode || !studentName) {
      return res.status(400).json({ success: false, message: 'Access code and name are required.' });
    }

    var exam = await SchoolExam.findOne({
      accessCode: accessCode.trim().toUpperCase(),
      status:     'published'
    }).populate('schoolId', 'name logo status subscriptionExpiry isSuspended');

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found. Check the access code and try again.'
      });
    }

    /* ✅ Validate school subscription */
    var school = exam.schoolId;
    if (!school || school.isSuspended) {
      return res.status(403).json({ success: false, message: 'This school is currently unavailable.' });
    }

    if (school.subscriptionExpiry && new Date() > new Date(school.subscriptionExpiry)) {
      return res.status(403).json({ success: false, message: 'This school\'s subscription has expired.' });
    }

    /* ✅ NEW: Enforce activation window */
    var now = new Date();

    if (exam.scheduledStart && now < new Date(exam.scheduledStart)) {
      return res.status(403).json({
        success: false,
        message: 'This exam has not started yet. It opens at ' + fmtDate(exam.scheduledStart) + '.'
      });
    }

    if (exam.scheduledEnd && now > new Date(exam.scheduledEnd)) {
      return res.status(403).json({
        success: false,
        message: 'This exam access code expired at ' + fmtDate(exam.scheduledEnd) + '.'
      });
    }

    /* Check for duplicate submission */
    var existing = await SchoolResult.findOne({
      examId:      exam._id,
      studentName: studentName.trim()
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'You have already submitted this exam. Contact your teacher if this is a mistake.'
      });
    }

    /* Load questions — shuffle if required */
    var questions = await SchoolQuestion.find({ examId: exam._id, isActive: true })
      .select('-correctAnswer -explanation -modelAnswer -markScheme')
      .sort({ sortOrder: 1 });

    var questionsArr = questions.map(function(q) { return q.toObject(); });

    /* Shuffle question order */
    if (exam.shuffleQuestions) {
      questionsArr = shuffle(questionsArr);
    }

    /* ✅ FIXED: shuffleOptions with safe index mapping.
       For each question, if shuffleOptions is enabled we
       generate a shuffled ordering of the option indices.
       This mapping is stored in the session token so that
       when the student submits answer index 2, we can look
       up what the original index was before shuffling.
       The correct answer index in the DB never changes. */
    var optionMappings = {};

    if (exam.shuffleOptions) {
      questionsArr = questionsArr.map(function(q) {
        if (q.questionType !== 'objective' || !q.options || q.options.length < 2) {
          return q;
        }
        /* Build array of original indices [0, 1, 2, 3] and shuffle it */
        var originalIndices = q.options.map(function(_, i) { return i; });
        var shuffledIndices = shuffle(originalIndices);

        /* Reorder options according to the shuffle */
        var shuffledOptions = shuffledIndices.map(function(i) { return q.options[i]; });

        /* Store mapping: shuffledPosition → originalIndex */
        optionMappings[q._id.toString()] = shuffledIndices;

        return Object.assign({}, q, { options: shuffledOptions });
      });
    }

    /* Build session token — includes option mappings for safe grading */
    var sessionData = {
      examId:         exam._id,
      studentName:    studentName.trim(),
      admissionNo:    admissionNo || '',
      startTime:      Date.now(),
      duration:       exam.duration,
      optionMappings: optionMappings
    };

    return res.status(200).json({
      success:      true,
      sessionToken: Buffer.from(JSON.stringify(sessionData)).toString('base64'),
      exam: {
        _id:            exam._id,
        title:          exam.title,
        subject:        exam.subject,
        class:          exam.class,
        examYear:       exam.examYear,
        duration:       exam.duration,
        instructions:   exam.instructions,
        totalQuestions: questionsArr.length,
        examType:       exam.examType
      },
      school: {
        name: school.name,
        logo: school.logo
      },
      questions: questionsArr
    });

  } catch (err) {
    console.error('Verify code error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

/* ---- Submit exam ---- */
router.post('/submit', async (req, res) => {
  try {
    var { sessionToken, answers, timeTaken, wasAutoSubmit, tabSwitchCount } = req.body;

    if (!sessionToken || !answers) {
      return res.status(400).json({ success: false, message: 'Session and answers are required.' });
    }

    /* Decode session */
    var session;
    try {
      session = JSON.parse(Buffer.from(sessionToken, 'base64').toString());
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Invalid session.' });
    }

    /* Validate session time */
    var elapsed = (Date.now() - session.startTime) / 1000 / 60;
    if (elapsed > session.duration * 2) {
      return res.status(400).json({ success: false, message: 'Session has expired.' });
    }

    /* Prevent duplicate */
    var existing = await SchoolResult.findOne({
      examId:      session.examId,
      studentName: session.studentName
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Exam already submitted.' });
    }

    /* Load exam and questions WITH correct answers (server-side grading) */
    var exam      = await SchoolExam.findById(session.examId);
    var questions = await SchoolQuestion.find({ examId: session.examId, isActive: true });

    if (!exam || questions.length === 0) {
      return res.status(404).json({ success: false, message: 'Exam not found.' });
    }

    /* Grade answers */
    var objectiveScore  = 0;
    var objectiveTotal  = 0;
    var gradedAnswers   = [];
    var hasTheory       = false;

    /* ✅ Option mappings from session token for safe grading */
    var optionMappings = session.optionMappings || {};

    questions.forEach(function(q) {
      var qId        = q._id.toString();
      var userAnswer = answers[qId];

      if (q.questionType === 'objective' || q.questionType === 'true_false') {
        objectiveTotal += q.marks;

        /* ✅ If options were shuffled, map student's answer back to original index */
        var originalAnswer = userAnswer;
        if (typeof userAnswer === 'number' && optionMappings[qId]) {
          /* optionMappings[qId][shuffledPosition] = originalIndex
             So if student answered position 2, we look up what original index that was */
          originalAnswer = optionMappings[qId][userAnswer];
          if (originalAnswer === undefined) originalAnswer = userAnswer;
        }

        var isCorrect = (typeof originalAnswer === 'number') && (originalAnswer === q.correctAnswer);
        if (isCorrect) objectiveScore += q.marks;

        gradedAnswers.push({
          questionId:     q._id,
          questionType:   q.questionType,
          userAnswer:     userAnswer !== undefined ? userAnswer : null,
          correctAnswer:  q.correctAnswer,
          isCorrect:      isCorrect,
          marksAwarded:   isCorrect ? q.marks : 0,
          marksAvailable: q.marks
        });

      } else {
        /* Theory — store answer for teacher grading */
        hasTheory = true;
        gradedAnswers.push({
          questionId:     q._id,
          questionType:   q.questionType,
          userAnswer:     userAnswer || '',
          question:       q.question,
          correctAnswer:  null,
          isCorrect:      false,
          marksAwarded:   0,
          marksAvailable: q.marks
        });
      }
    });

    var totalMarks   = exam.totalMarks || questions.reduce(function(s, q) { return s + q.marks; }, 0);
    var scorePercent = objectiveTotal > 0
      ? Math.round((objectiveScore / objectiveTotal) * 100)
      : 0;
    var isPassed = scorePercent >= exam.passMark;

    /* Save result */
    var result = await SchoolResult.create({
      schoolId:       exam.schoolId,
      examId:         exam._id,
      studentName:    session.studentName,
      admissionNo:    session.admissionNo || '',
      score:          objectiveScore,
      totalMarks:     totalMarks,
      scorePercent:   scorePercent,
      passMark:       exam.passMark,
      isPassed:       isPassed,
      objectiveScore: objectiveScore,
      objectiveTotal: objectiveTotal,
      theoryMarked:   !hasTheory,
      timeTaken:      parseInt(timeTaken) || 0,
      wasAutoSubmit:  !!wasAutoSubmit,
      answers:        gradedAnswers,
      tabSwitchCount: parseInt(tabSwitchCount) || 0,
      flaggedForReview: (tabSwitchCount || 0) > 3,
      isReleased:     exam.showResultsAfter && !hasTheory
    });

    /* Update exam stats */
    await SchoolExam.findByIdAndUpdate(exam._id, {
      $inc: { totalAttempts: 1 },
      $max: { highestScore:  scorePercent },
      $min: { lowestScore:   scorePercent }
    });

    console.log('School exam submitted:', session.studentName, 'score:', scorePercent + '%');

    return res.status(200).json({
      success:  true,
      message:  hasTheory
        ? 'Exam submitted! Your results will be available after teacher marking.'
        : (isPassed ? '🎉 Well done! You passed.' : '📚 Submitted. Keep studying!'),
      result: {
        studentName:  session.studentName,
        score:        objectiveScore,
        scorePercent: scorePercent,
        isPassed:     isPassed,
        isReleased:   result.isReleased,
        hasTheory:    hasTheory,
        message:      hasTheory ? 'Results pending teacher review.' : null
      }
    });

  } catch (err) {
    console.error('Submit error:', err.message);
    return res.status(500).json({ success: false, message: 'Submission failed. Please try again.' });
  }
});

module.exports = router;