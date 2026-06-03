/* ============================================
   STUDENT EXAM ROUTES — With Activity Logging
   ============================================ */

const express           = require('express');
const router            = express.Router();
const TeacherExam       = require('../models/TeacherExam.model');
const TeacherQuestion   = require('../models/TeacherQuestion.model');
const StudentSubmission = require('../models/StudentSubmission.model');
const ActivityLog       = require('../models/ActivityLog.model');

/* ============================================
   POST /api/student-exam/access
   Student validates exam code and gets questions
   ============================================ */
router.post('/access', async (req, res) => {
  try {
    const { studentName, examCode } = req.body;

    // Validate inputs
    if (!studentName || !studentName.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please enter your name.'
      });
    }

    if (!examCode || !examCode.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please enter the exam code provided by your teacher.'
      });
    }

    // Find the exam by code
    const exam = await TeacherExam.findOne({
      examCode: examCode.toUpperCase().trim()
    });

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: `No exam found with code "${examCode.toUpperCase()}". Please check with your teacher.`
      });
    }

    if (!exam.isActive) {
      return res.status(403).json({
        success: false,
        message: 'This exam is not currently open. Please check with your teacher.'
      });
    }

    // Get questions WITHOUT correct answers
    const questions = await TeacherQuestion.find({ examId: exam._id })
      .sort({ orderNumber: 1 })
      .select('-correctAnswer -expectedAnswer');

    if (questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'This exam has no questions yet. Please inform your teacher.'
      });
    }

    // Log that a student accessed this exam
    // We use the teacher's ID as the userId since students have no account
    await ActivityLog.record({
      userId:    exam.teacherId,
      userName:  studentName.trim(),
      userEmail: '',
      userRole:  'student',
      action:    'student_exam_accessed',
      description: `Student "${studentName.trim()}" accessed exam "${exam.title}" [${exam.examCode}]`,
      metadata: {
        examId:      exam._id,
        examTitle:   exam.title,
        examCode:    exam.examCode,
        studentName: studentName.trim()
      }
    });

    console.log(`📖 Student "${studentName}" accessed exam: ${exam.title} [${exam.examCode}]`);

    return res.status(200).json({
      success: true,
      message: `Welcome ${studentName}! Your exam is ready.`,
      exam: {
        id:             exam._id,
        title:          exam.title,
        subject:        exam.subject,
        examType:       exam.examType,
        duration:       exam.duration,
        instructions:   exam.instructions,
        passMark:       exam.passMark,
        totalQuestions: questions.length
      },
      questions,
      // Session token (base64 encoded name + examId)
      session: Buffer.from(
        JSON.stringify({
          studentName: studentName.trim(),
          examId:      exam._id.toString(),
          teacherId:   exam.teacherId.toString()
        })
      ).toString('base64')
    });

  } catch (error) {
    console.error('Student access error:', error);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

/* ============================================
   POST /api/student-exam/submit
   Student submits answers — grade + save + LOG
   ============================================ */
router.post('/submit', async (req, res) => {
  try {
    const { session, answers, timeTaken, wasAutoSubmit } = req.body;

    if (!session) {
      return res.status(400).json({
        success: false,
        message: 'Invalid session. Please restart the exam.'
      });
    }

    // Decode session
    let sessionData;
    try {
      sessionData = JSON.parse(Buffer.from(session, 'base64').toString('utf8'));
    } catch {
      return res.status(400).json({
        success: false,
        message: 'Corrupted session. Please restart.'
      });
    }

    const { studentName, examId, teacherId } = sessionData;

    if (!studentName || !examId) {
      return res.status(400).json({ success: false, message: 'Invalid session data.' });
    }

    // Get the exam
    const exam = await TeacherExam.findById(examId);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found.' });
    }

    // Get ALL questions WITH correct answers (server-side grading)
    const questions = await TeacherQuestion.find({ examId })
      .sort({ orderNumber: 1 });

    if (questions.length === 0) {
      return res.status(400).json({ success: false, message: 'No questions found for this exam.' });
    }

    // ---- GRADE THE ANSWERS ----
    let objectiveCorrect = 0;
    let objectiveTotal   = 0;
    let theoryTotal      = 0;
    let hasPendingTheory = false;

    const gradedAnswers = questions.map(q => {
      const qId           = q._id.toString();
      const studentAnswer = answers ? answers[qId] : undefined;

      if (q.questionType === 'objective') {
        objectiveTotal++;
        const selectedIndex = studentAnswer !== undefined ? parseInt(studentAnswer) : null;
        const isCorrect     = selectedIndex === q.correctAnswer;
        if (isCorrect) objectiveCorrect++;

        return {
          questionId:    q._id,
          questionText:  q.questionText,
          questionType:  'objective',
          studentAnswer: selectedIndex,
          correctAnswer: q.correctAnswer,
          isCorrect,
          marksAwarded:  isCorrect ? q.marks : 0,
          totalMarks:    q.marks
        };
      } else {
        theoryTotal++;
        hasPendingTheory = true;

        return {
          questionId:    q._id,
          questionText:  q.questionText,
          questionType:  'theory',
          studentAnswer: studentAnswer || '',
          correctAnswer: null,
          isCorrect:     null,
          marksAwarded:  0,
          totalMarks:    q.marks
        };
      }
    });

    // Calculate score
    const scorePercent = objectiveTotal > 0
      ? Math.round((objectiveCorrect / objectiveTotal) * 100)
      : 0;
    const isPassed = scorePercent >= exam.passMark;

    // Save submission to database
    const submission = await StudentSubmission.create({
      studentName:    studentName.trim(),
      examId:         exam._id,
      examTitle:      exam.title,
      examSubject:    exam.subject,
      examCode:       exam.examCode,
      teacherId:      exam.teacherId,
      answers:        gradedAnswers,
      objectiveScore: objectiveCorrect,
      objectiveTotal,
      theoryTotal,
      scorePercent,
      isPassed,
      timeTaken:      timeTaken || 0,
      wasAutoSubmit:  wasAutoSubmit || false,
      status:         hasPendingTheory ? 'pending_theory' : 'submitted'
    });

    // Update exam attempt count
    await TeacherExam.findByIdAndUpdate(examId, { $inc: { totalAttempts: 1 } });

    // Log the submission — linked to the TEACHER's ID so admin sees it under their teacher
    await ActivityLog.record({
      userId:    exam.teacherId,
      userName:  studentName.trim(),
      userEmail: '',
      userRole:  'student',
      action:    'student_exam_submitted',
      description: `Student "${studentName.trim()}" submitted exam "${exam.title}" [${exam.examCode}] — Score: ${scorePercent}% (${isPassed ? 'PASSED' : 'FAILED'})`,
      metadata: {
        examId:      exam._id,
        examTitle:   exam.title,
        examCode:    exam.examCode,
        studentName: studentName.trim(),
        scorePercent,
        isPassed
      }
    });

    console.log(`✅ "${studentName}" submitted "${exam.title}": ${scorePercent}% — ${isPassed ? 'PASSED ✅' : 'FAILED ❌'}`);

    return res.status(201).json({
      success: true,
      message: isPassed
        ? `🎉 Well done ${studentName}! You passed!`
        : `📚 Keep practicing, ${studentName}. You can do better!`,
      result: {
        submissionId:   submission._id,
        studentName,
        examTitle:      exam.title,
        objectiveScore: objectiveCorrect,
        objectiveTotal,
        scorePercent,
        isPassed,
        passMark:       exam.passMark,
        timeTaken:      timeTaken || 0,
        hasTheory:      hasPendingTheory,
        gradedAnswers
      }
    });

  } catch (error) {
    console.error('Student submit error:', error);
    return res.status(500).json({ success: false, message: 'Error saving your submission. Please try again.' });
  }
});

module.exports = router;