/* ============================================
   TEACHER ROUTES — Main Platform
   
   ✅ CBT UPGRADE CHANGES:
   - examYear handled in create/update
   - activatesAt/expiresAt handled in create/update
   
   ✅ BUG FIX: Exam code permanent reservation
   - Uniqueness check now only blocks ACTIVE exams
   - Codes from ended/deactivated exams are reusable
   
   Activity logging preserved from previous version.
============================================ */
const express           = require('express');
const router            = express.Router();
const TeacherExam       = require('../models/TeacherExam.model');
const TeacherQuestion   = require('../models/TeacherQuestion.model');
const StudentSubmission = require('../models/StudentSubmission.model');
const ActivityLog       = require('../models/ActivityLog.model');
const { protect }       = require('../middleware/auth.middleware');

const teacherOnly = (req, res, next) => {
  if (req.user.role === 'teacher' || req.user.role === 'admin') return next();
  return res.status(403).json({ success: false, message: 'Access denied. Teacher account required.' });
};

router.use(protect);
router.use(teacherOnly);

/* ---- Dashboard ---- */
router.get('/dashboard', async (req, res) => {
  try {
    var teacherId = req.user.id;
    var [totalExams, totalSubmissions, recentExams] = await Promise.all([
      TeacherExam.countDocuments({ teacherId }),
      StudentSubmission.countDocuments({ teacherId }),
      TeacherExam.find({ teacherId })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('title subject examCode isActive totalAttempts examYear createdAt')
    ]);
    return res.status(200).json({ success: true, dashboard: { totalExams, totalSubmissions, recentExams } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/* ---- Get all exams ---- */
router.get('/exams', async (req, res) => {
  try {
    var exams = await TeacherExam.find({ teacherId: req.user.id }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: exams.length, exams });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching exams' });
  }
});

/* ---- Create exam ---- */
router.post('/exams', async (req, res) => {
  try {
    var { title, subject, examType, duration, examCode, instructions, passMark,
          examYear, activatesAt, expiresAt, shuffleQuestions, shuffleOptions } = req.body;

    if (!title || !subject || !examType || !duration || !examCode) {
      return res.status(400).json({
        success: false,
        message: 'Please fill in all required fields: title, subject, exam type, duration, and exam code.'
      });
    }

    /* ✅ FIX: Only block if an ACTIVE exam uses this code.
       Ended or deactivated exams free up their code for reuse. */
    var existing = await TeacherExam.findOne({
      examCode: examCode.toUpperCase().trim(),
      isActive: true
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Exam code "' + examCode.toUpperCase() + '" is currently in use by an active exam. Please choose a different code, or deactivate the other exam first.'
      });
    }

    var exam = await TeacherExam.create({
      teacherId:        req.user.id,
      title,
      subject,
      examType,
      duration:         parseInt(duration),
      examCode:         examCode.toUpperCase().trim(),
      instructions:     instructions || 'Read all questions carefully.',
      passMark:         parseInt(passMark) || 50,
      isActive:         true,
      /* ✅ NEW fields */
      examYear:         parseInt(examYear) || new Date().getFullYear(),
      activatesAt:      activatesAt ? new Date(activatesAt) : null,
      expiresAt:        expiresAt   ? new Date(expiresAt)   : null,
      shuffleQuestions: shuffleQuestions === true || shuffleQuestions === 'true',
      shuffleOptions:   shuffleOptions   === true || shuffleOptions   === 'true'
    });

    await ActivityLog.record({
      userId:      req.user.id,
      userName:    req.user.name  || 'Teacher',
      userEmail:   req.user.email || '',
      userRole:    'teacher',
      action:      'teacher_exam_created',
      description: 'Teacher created new exam: "' + exam.title + '" with code [' + exam.examCode + ']',
      metadata:    { examId: exam._id, examTitle: exam.title, examCode: exam.examCode }
    });

    return res.status(201).json({
      success: true,
      message: 'Exam created! Students can access it using code: ' + exam.examCode,
      exam
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: Object.values(error.errors).map(function(e) { return e.message; }).join(', ') });
    }
    return res.status(500).json({ success: false, message: 'Error creating exam' });
  }
});

/* ---- Update exam ---- */
router.put('/exams/:id', async (req, res) => {
  try {
    var exam = await TeacherExam.findOne({ _id: req.params.id, teacherId: req.user.id });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found or access denied.' });

    if (req.body.examCode && req.body.examCode.toUpperCase() !== exam.examCode) {
      /* ✅ FIX: Same fix for updates — only block active exams */
      var taken = await TeacherExam.findOne({
        examCode: req.body.examCode.toUpperCase().trim(),
        _id:      { $ne: exam._id },
        isActive: true
      });
      if (taken) {
        return res.status(409).json({ success: false, message: 'Exam code "' + req.body.examCode.toUpperCase() + '" is currently in use by an active exam.' });
      }
      req.body.examCode = req.body.examCode.toUpperCase().trim();
    }

    /* ✅ Handle new fields in update */
    if (req.body.examYear        !== undefined) req.body.examYear        = parseInt(req.body.examYear) || new Date().getFullYear();
    if (req.body.activatesAt     !== undefined) req.body.activatesAt     = req.body.activatesAt     ? new Date(req.body.activatesAt)     : null;
    if (req.body.expiresAt       !== undefined) req.body.expiresAt       = req.body.expiresAt       ? new Date(req.body.expiresAt)       : null;
    if (req.body.shuffleQuestions !== undefined) req.body.shuffleQuestions = req.body.shuffleQuestions === true || req.body.shuffleQuestions === 'true';
    if (req.body.shuffleOptions   !== undefined) req.body.shuffleOptions   = req.body.shuffleOptions   === true || req.body.shuffleOptions   === 'true';

    var updated = await TeacherExam.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });

    await ActivityLog.record({
      userId:      req.user.id,
      userName:    req.user.name  || 'Teacher',
      userEmail:   req.user.email || '',
      userRole:    'teacher',
      action:      'teacher_exam_updated',
      description: 'Teacher updated exam: "' + updated.title + '" [' + updated.examCode + ']',
      metadata:    { examId: updated._id, examTitle: updated.title, examCode: updated.examCode }
    });

    return res.status(200).json({ success: true, message: 'Exam updated.', exam: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error updating exam' });
  }
});

/* ---- Delete exam ---- */
router.delete('/exams/:id', async (req, res) => {
  try {
    var exam = await TeacherExam.findOne({ _id: req.params.id, teacherId: req.user.id });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });

    await TeacherExam.findByIdAndDelete(req.params.id);
    var qDel = await TeacherQuestion.deleteMany({ examId: req.params.id });
    var sDel = await StudentSubmission.deleteMany({ examId: req.params.id });

    await ActivityLog.record({
      userId:      req.user.id,
      userName:    req.user.name  || 'Teacher',
      userEmail:   req.user.email || '',
      userRole:    'teacher',
      action:      'teacher_exam_deleted',
      description: 'Teacher deleted exam: "' + exam.title + '" [' + exam.examCode + '] — removed ' + qDel.deletedCount + ' questions and ' + sDel.deletedCount + ' submissions',
      metadata:    { examTitle: exam.title, examCode: exam.examCode }
    });

    return res.status(200).json({ success: true, message: 'Exam "' + exam.title + '" deleted.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error deleting exam' });
  }
});

/* ---- Get questions for exam ---- */
router.get('/exams/:id/questions', async (req, res) => {
  try {
    var exam = await TeacherExam.findOne({ _id: req.params.id, teacherId: req.user.id });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });
    var questions = await TeacherQuestion.find({ examId: req.params.id }).sort({ orderNumber: 1, createdAt: 1 });
    return res.status(200).json({ success: true, count: questions.length, questions });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching questions' });
  }
});

/* ---- Add question ---- */
router.post('/exams/:id/questions', async (req, res) => {
  try {
    var exam = await TeacherExam.findOne({ _id: req.params.id, teacherId: req.user.id });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });

    var { questionType, questionText, options, correctAnswer, expectedAnswer, marks } = req.body;
    if (!questionType || !questionText) {
      return res.status(400).json({ success: false, message: 'Question type and text are required.' });
    }
    if (questionType === 'objective') {
      if (!options || options.length < 2) return res.status(400).json({ success: false, message: 'At least 2 options required.' });
      if (correctAnswer === undefined || correctAnswer === null) return res.status(400).json({ success: false, message: 'Please select the correct answer.' });
    }

    var questionCount = await TeacherQuestion.countDocuments({ examId: req.params.id });
    var question = await TeacherQuestion.create({
      examId:         req.params.id,
      questionType,
      questionText:   questionText.trim(),
      options:        questionType === 'objective' ? options.map(function(o) { return o.trim(); }) : [],
      correctAnswer:  questionType === 'objective' ? parseInt(correctAnswer) : null,
      expectedAnswer: questionType === 'theory'    ? (expectedAnswer || '') : '',
      marks:          parseInt(marks) || 1,
      orderNumber:    questionCount + 1
    });

    await ActivityLog.record({
      userId:      req.user.id,
      userName:    req.user.name  || 'Teacher',
      userEmail:   req.user.email || '',
      userRole:    'teacher',
      action:      'teacher_question_added',
      description: 'Teacher added a ' + questionType + ' question to exam "' + exam.title + '"',
      metadata:    { examId: exam._id, examTitle: exam.title, examCode: exam.examCode }
    });

    return res.status(201).json({ success: true, message: 'Question added.', question });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error adding question' });
  }
});

/* ---- Update question ---- */
router.put('/questions/:id', async (req, res) => {
  try {
    var question = await TeacherQuestion.findById(req.params.id).populate('examId');
    if (!question) return res.status(404).json({ success: false, message: 'Question not found.' });
    if (question.examId.teacherId.toString() !== req.user.id) return res.status(403).json({ success: false, message: 'Access denied.' });
    var updated = await TeacherQuestion.findByIdAndUpdate(req.params.id, req.body, { new: true });
    return res.status(200).json({ success: true, message: 'Question updated.', question: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error updating question' });
  }
});

/* ---- Delete question ---- */
router.delete('/questions/:id', async (req, res) => {
  try {
    var question = await TeacherQuestion.findById(req.params.id).populate('examId');
    if (!question) return res.status(404).json({ success: false, message: 'Question not found.' });
    if (question.examId.teacherId.toString() !== req.user.id) return res.status(403).json({ success: false, message: 'Access denied.' });
    await TeacherQuestion.findByIdAndDelete(req.params.id);
    await ActivityLog.record({
      userId:      req.user.id,
      userName:    req.user.name  || 'Teacher',
      userEmail:   req.user.email || '',
      userRole:    'teacher',
      action:      'teacher_question_deleted',
      description: 'Teacher deleted a question from exam "' + question.examId.title + '"',
      metadata:    { examId: question.examId._id, examTitle: question.examId.title }
    });
    return res.status(200).json({ success: true, message: 'Question deleted.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error deleting question' });
  }
});

/* ---- Get submissions for exam ---- */
router.get('/exams/:id/submissions', async (req, res) => {
  try {
    var exam = await TeacherExam.findOne({ _id: req.params.id, teacherId: req.user.id });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });
    var submissions = await StudentSubmission.find({ examId: req.params.id }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, examTitle: exam.title, examCode: exam.examCode, count: submissions.length, submissions });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching submissions' });
  }
});

module.exports = router;