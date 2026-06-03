/* ============================================
   LATLOMP INSTITUTION — STUDENT EXAM ROUTES
   
   No login required for exam access.
   Access is by exam code only.
============================================ */
const express        = require('express');
const router         = express.Router();
const School         = require('../models/School.model');
const SchoolExam     = require('../models/SchoolExam.model');
const SchoolQuestion = require('../models/SchoolQuestion.model');
const SchoolResult   = require('../models/SchoolResult.model');
const SchoolStudent  = require('../models/SchoolStudent.model');

function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
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

    /* Validate school subscription */
    var school = exam.schoolId;
    if (!school || school.isSuspended) {
      return res.status(403).json({ success: false, message: 'This school is currently unavailable.' });
    }

    if (school.subscriptionExpiry && new Date() > new Date(school.subscriptionExpiry)) {
      return res.status(403).json({ success: false, message: 'This school\'s subscription has expired.' });
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

    /* Load questions — shuffle if required, never send correctAnswer */
    var questions = await SchoolQuestion.find({ examId: exam._id, isActive: true })
      .select('-correctAnswer -explanation -modelAnswer -markScheme')
      .sort({ sortOrder: 1 });

    var questionsToSend = exam.shuffleQuestions ? shuffle(questions.map(function(q) { return q.toObject(); })) : questions.map(function(q) { return q.toObject(); });

    return res.status(200).json({
      success:    true,
      sessionToken: Buffer.from(JSON.stringify({
        examId:      exam._id,
        studentName: studentName.trim(),
        admissionNo: admissionNo || '',
        startTime:   Date.now(),
        duration:    exam.duration
      })).toString('base64'),
      exam: {
        _id:          exam._id,
        title:        exam.title,
        subject:      exam.subject,
        class:        exam.class,
        duration:     exam.duration,
        instructions: exam.instructions,
        totalQuestions: questionsToSend.length,
        examType:     exam.examType
      },
      school: {
        name: school.name,
        logo: school.logo
      },
      questions: questionsToSend
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

    /* Validate session time — prevent submission after 2x duration */
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

    /* Load exam and questions WITH answers */
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

    questions.forEach(function(q) {
      var qId        = q._id.toString();
      var userAnswer = answers[qId];

      if (q.questionType === 'objective' || q.questionType === 'true_false') {
        objectiveTotal += q.marks;
        var isCorrect = (typeof userAnswer === 'number') && (userAnswer === q.correctAnswer);
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
          correctAnswer:  null,
          isCorrect:      false,
          marksAwarded:   0,
          marksAvailable: q.marks
        });
      }
    });

    var totalMarks    = exam.totalMarks || questions.reduce(function(s, q) { return s + q.marks; }, 0);
    var scorePercent  = objectiveTotal > 0
      ? Math.round((objectiveScore / objectiveTotal) * 100)
      : 0;
    var isPassed      = scorePercent >= exam.passMark;

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
      theoryMarked:   !hasTheory,  /* auto-marked if no theory */
      timeTaken:      parseInt(timeTaken) || 0,
      wasAutoSubmit:  !!wasAutoSubmit,
      answers:        gradedAnswers,
      tabSwitchCount: parseInt(tabSwitchCount) || 0,
      flaggedForReview: (tabSwitchCount || 0) > 3,
      isReleased:     exam.showResultsAfter && !hasTheory
    });

    /* Update exam stats */
    await SchoolExam.findByIdAndUpdate(exam._id, {
      $inc:  { totalAttempts: 1 },
      $max:  { highestScore:  scorePercent },
      $min:  { lowestScore:   scorePercent }
    });

    console.log('School exam submitted:', session.studentName, 'score:', scorePercent + '%');

    return res.status(200).json({
      success:      true,
      message:      hasTheory
        ? 'Exam submitted! Your results will be available after teacher marking.'
        : (isPassed ? '🎉 Well done! You passed.' : '📚 Submitted. Keep studying!'),
      result: {
        studentName:   session.studentName,
        score:         objectiveScore,
        scorePercent:  scorePercent,
        isPassed:      isPassed,
        isReleased:    result.isReleased,
        hasTheory:     hasTheory,
        message:       hasTheory ? 'Results pending teacher review.' : null
      }
    });

  } catch (err) {
    console.error('Submit error:', err.message);
    return res.status(500).json({ success: false, message: 'Submission failed. Please try again.' });
  }
});

module.exports = router;