/* ============================================
   STUDENT EXAM ROUTES — Main Platform
   
   ✅ CBT UPGRADE CHANGES:
   - Activation window enforced on /access
     (activatesAt / expiresAt)
   Activity logging preserved from previous version.
============================================ */
const express           = require('express');
const router            = express.Router();
const TeacherExam       = require('../models/TeacherExam.model');
const TeacherQuestion   = require('../models/TeacherQuestion.model');
const StudentSubmission = require('../models/StudentSubmission.model');
const ActivityLog       = require('../models/ActivityLog.model');

function fmtDate(d) {
  try {
    return new Date(d).toLocaleString('en-NG', {
      timeZone: 'Africa/Lagos',
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true
    });
  } catch (e) { return new Date(d).toString(); }
}

/* ---- /access ---- */
router.post('/access', async (req, res) => {
  try {
    var { studentName, examCode } = req.body;

    if (!studentName || !studentName.trim()) {
      return res.status(400).json({ success: false, message: 'Please enter your name.' });
    }
    if (!examCode || !examCode.trim()) {
      return res.status(400).json({ success: false, message: 'Please enter the exam code provided by your teacher.' });
    }

    var exam = await TeacherExam.findOne({ examCode: examCode.toUpperCase().trim() });

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'No exam found with code "' + examCode.toUpperCase() + '". Please check with your teacher.'
      });
    }

    if (!exam.isActive) {
      return res.status(403).json({ success: false, message: 'This exam is not currently open. Please check with your teacher.' });
    }

    /* ✅ NEW: Enforce activation window */
    var now = new Date();

    if (exam.activatesAt && now < new Date(exam.activatesAt)) {
      return res.status(403).json({
        success: false,
        message: 'This exam has not started yet. It opens at ' + fmtDate(exam.activatesAt) + '.'
      });
    }

    if (exam.expiresAt && now > new Date(exam.expiresAt)) {
      return res.status(403).json({
        success: false,
        message: 'This exam access code expired at ' + fmtDate(exam.expiresAt) + '.'
      });
    }

    var questions = await TeacherQuestion.find({ examId: exam._id })
      .sort({ orderNumber: 1 })
      .select('-correctAnswer -expectedAnswer');

    if (questions.length === 0) {
      return res.status(400).json({ success: false, message: 'This exam has no questions yet. Please inform your teacher.' });
    }

    await ActivityLog.record({
      userId: exam.teacherId, userName: studentName.trim(), userEmail: '', userRole: 'student',
      action: 'student_exam_accessed',
      description: 'Student "' + studentName.trim() + '" accessed exam "' + exam.title + '" [' + exam.examCode + ']',
      metadata: { examId: exam._id, examTitle: exam.title, examCode: exam.examCode, studentName: studentName.trim() }
    });

    return res.status(200).json({
      success:  true,
      message:  'Welcome ' + studentName + '! Your exam is ready.',
      exam: {
        id:             exam._id,
        title:          exam.title,
        subject:        exam.subject,
        examType:       exam.examType,
        duration:       exam.duration,
        examYear:       exam.examYear,
        instructions:   exam.instructions,
        passMark:       exam.passMark,
        totalQuestions: questions.length
      },
      questions,
      session: Buffer.from(JSON.stringify({
        studentName: studentName.trim(),
        examId:      exam._id.toString(),
        teacherId:   exam.teacherId.toString()
      })).toString('base64')
    });

  } catch (error) {
    console.error('Student access error:', error);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

/* ---- /submit ---- */
router.post('/submit', async (req, res) => {
  try {
    var { session, answers, timeTaken, wasAutoSubmit } = req.body;

    if (!session) {
      return res.status(400).json({ success: false, message: 'Invalid session. Please restart the exam.' });
    }

    var sessionData;
    try {
      sessionData = JSON.parse(Buffer.from(session, 'base64').toString('utf8'));
    } catch {
      return res.status(400).json({ success: false, message: 'Corrupted session. Please restart.' });
    }

    var { studentName, examId, teacherId } = sessionData;
    if (!studentName || !examId) return res.status(400).json({ success: false, message: 'Invalid session data.' });

    var exam = await TeacherExam.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });

    var questions = await TeacherQuestion.find({ examId }).sort({ orderNumber: 1 });
    if (questions.length === 0) return res.status(400).json({ success: false, message: 'No questions found for this exam.' });

    var objectiveCorrect = 0;
    var objectiveTotal   = 0;
    var theoryTotal      = 0;
    var hasPendingTheory = false;

    var gradedAnswers = questions.map(function(q) {
      var qId           = q._id.toString();
      var studentAnswer = answers ? answers[qId] : undefined;

      if (q.questionType === 'objective') {
        objectiveTotal++;
        var selectedIndex = studentAnswer !== undefined ? parseInt(studentAnswer) : null;
        var isCorrect     = selectedIndex === q.correctAnswer;
        if (isCorrect) objectiveCorrect++;
        return {
          questionId: q._id, questionText: q.questionText, questionType: 'objective',
          studentAnswer: selectedIndex, correctAnswer: q.correctAnswer,
          isCorrect, marksAwarded: isCorrect ? q.marks : 0, totalMarks: q.marks
        };
      } else {
        theoryTotal++;
        hasPendingTheory = true;
        return {
          questionId: q._id, questionText: q.questionText, questionType: 'theory',
          studentAnswer: studentAnswer || '', correctAnswer: null, isCorrect: null,
          marksAwarded: 0, totalMarks: q.marks
        };
      }
    });

    var scorePercent = objectiveTotal > 0 ? Math.round((objectiveCorrect / objectiveTotal) * 100) : 0;
    var isPassed     = scorePercent >= exam.passMark;

    var submission = await StudentSubmission.create({
      studentName: studentName.trim(), examId: exam._id, examTitle: exam.title,
      examSubject: exam.subject, examCode: exam.examCode, teacherId: exam.teacherId,
      answers: gradedAnswers, objectiveScore: objectiveCorrect, objectiveTotal, theoryTotal,
      scorePercent, isPassed, timeTaken: timeTaken || 0, wasAutoSubmit: wasAutoSubmit || false,
      status: hasPendingTheory ? 'pending_theory' : 'submitted'
    });

    await TeacherExam.findByIdAndUpdate(examId, { $inc: { totalAttempts: 1 } });

    await ActivityLog.record({
      userId: exam.teacherId, userName: studentName.trim(), userEmail: '', userRole: 'student',
      action: 'student_exam_submitted',
      description: 'Student "' + studentName.trim() + '" submitted exam "' + exam.title + '" — Score: ' + scorePercent + '% (' + (isPassed ? 'PASSED' : 'FAILED') + ')',
      metadata: { examId: exam._id, examTitle: exam.title, examCode: exam.examCode, studentName: studentName.trim(), scorePercent, isPassed }
    });

    return res.status(201).json({
      success: true,
      message: isPassed ? '🎉 Well done ' + studentName + '! You passed!' : '📚 Keep practicing, ' + studentName + '.',
      result: {
        submissionId:   submission._id,
        studentName, examTitle: exam.title,
        objectiveScore: objectiveCorrect, objectiveTotal,
        scorePercent, isPassed, passMark: exam.passMark,
        timeTaken: timeTaken || 0, hasTheory: hasPendingTheory, gradedAnswers
      }
    });

  } catch (error) {
    console.error('Student submit error:', error);
    return res.status(500).json({ success: false, message: 'Error saving your submission. Please try again.' });
  }
});

module.exports = router;