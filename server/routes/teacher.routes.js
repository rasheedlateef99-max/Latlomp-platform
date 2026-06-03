/* ============================================
   TEACHER ROUTES — Multi-Teacher Update
   ============================================
   
   Changes from previous version:
   - Activity logging added to all routes
   - Teacher data isolation already worked
     (teacherId filter was already in place)
   - No functional changes — just logging added
   ============================================ */

const express           = require('express');
const router            = express.Router();
const TeacherExam       = require('../models/TeacherExam.model');
const TeacherQuestion   = require('../models/TeacherQuestion.model');
const StudentSubmission = require('../models/StudentSubmission.model');
const ActivityLog       = require('../models/ActivityLog.model');
const { protect }       = require('../middleware/auth.middleware');

/* ============================================
   TEACHER GUARD MIDDLEWARE
   Only teachers and admins can use these routes
   ============================================ */
const teacherOnly = (req, res, next) => {
  if (req.user.role === 'teacher' || req.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Access denied. Teacher account required.'
  });
};

// Apply both middlewares to ALL routes
router.use(protect);
router.use(teacherOnly);

/* ============================================
   GET /api/teacher/dashboard
   ============================================ */
router.get('/dashboard', async (req, res) => {
  try {
    const teacherId = req.user.id;

    const [totalExams, totalSubmissions, recentExams] = await Promise.all([
      TeacherExam.countDocuments({ teacherId }),
      StudentSubmission.countDocuments({ teacherId }),
      TeacherExam.find({ teacherId })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('title subject examCode isActive totalAttempts createdAt')
    ]);

    return res.status(200).json({
      success: true,
      dashboard: {
        totalExams,
        totalSubmissions,
        recentExams
      }
    });

  } catch (error) {
    console.error('Teacher dashboard error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/* ============================================
   GET /api/teacher/exams
   Get all exams for THIS teacher only
   ============================================ */
router.get('/exams', async (req, res) => {
  try {
    // teacherId filter ensures each teacher only sees their own exams
    const exams = await TeacherExam.find({ teacherId: req.user.id })
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: exams.length,
      exams
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching exams' });
  }
});

/* ============================================
   POST /api/teacher/exams
   Create a new exam + LOG the action
   ============================================ */
router.post('/exams', async (req, res) => {
  try {
    const {
      title, subject, examType,
      duration, examCode, instructions, passMark
    } = req.body;

    // Validate required fields
    if (!title || !subject || !examType || !duration || !examCode) {
      return res.status(400).json({
        success: false,
        message: 'Please fill in all required fields: title, subject, exam type, duration, and exam code.'
      });
    }

    // Check exam code is unique across ALL teachers
    const existing = await TeacherExam.findOne({
      examCode: examCode.toUpperCase().trim()
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Exam code "${examCode.toUpperCase()}" is already taken by another teacher. Please choose a different code.`
      });
    }

    // Create the exam
    const exam = await TeacherExam.create({
      teacherId:    req.user.id,
      title,
      subject,
      examType,
      duration:     parseInt(duration),
      examCode:     examCode.toUpperCase().trim(),
      instructions: instructions || 'Read all questions carefully.',
      passMark:     parseInt(passMark) || 50,
      isActive:     true
    });

    // Log this action for admin to see
    await ActivityLog.record({
      userId:      req.user.id,
      userName:    req.user.name || 'Teacher',
      userEmail:   req.user.email || '',
      userRole:    'teacher',
      action:      'teacher_exam_created',
      description: `Teacher created new exam: "${exam.title}" with code [${exam.examCode}]`,
      metadata: {
        examId:    exam._id,
        examTitle: exam.title,
        examCode:  exam.examCode
      }
    });

    console.log(`✅ Teacher ${req.user.id} created exam: ${exam.title} [${exam.examCode}]`);

    return res.status(201).json({
      success: true,
      message: `Exam created! Students can access it using code: ${exam.examCode}`,
      exam
    });

  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({ success: false, message: messages.join(', ') });
    }
    console.error('Create exam error:', error);
    return res.status(500).json({ success: false, message: 'Error creating exam' });
  }
});

/* ============================================
   PUT /api/teacher/exams/:id
   Update an exam + LOG the action
   ============================================ */
router.put('/exams/:id', async (req, res) => {
  try {
    // Verify ownership — teacher can only edit THEIR OWN exam
    const exam = await TeacherExam.findOne({
      _id: req.params.id,
      teacherId: req.user.id
    });

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found or you do not have permission to edit it.'
      });
    }

    // If exam code is being changed, check it is not already taken
    if (req.body.examCode && req.body.examCode.toUpperCase() !== exam.examCode) {
      const taken = await TeacherExam.findOne({
        examCode: req.body.examCode.toUpperCase().trim(),
        _id: { $ne: exam._id }
      });

      if (taken) {
        return res.status(409).json({
          success: false,
          message: `Exam code "${req.body.examCode.toUpperCase()}" is already taken.`
        });
      }

      req.body.examCode = req.body.examCode.toUpperCase().trim();
    }

    const updated = await TeacherExam.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    // Log the update
    await ActivityLog.record({
      userId:      req.user.id,
      userName:    req.user.name || 'Teacher',
      userEmail:   req.user.email || '',
      userRole:    'teacher',
      action:      'teacher_exam_updated',
      description: `Teacher updated exam: "${updated.title}" [${updated.examCode}]`,
      metadata: {
        examId:    updated._id,
        examTitle: updated.title,
        examCode:  updated.examCode
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Exam updated successfully.',
      exam: updated
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error updating exam' });
  }
});

/* ============================================
   DELETE /api/teacher/exams/:id
   Delete an exam + its questions + submissions + LOG
   ============================================ */
router.delete('/exams/:id', async (req, res) => {
  try {
    // Verify ownership
    const exam = await TeacherExam.findOne({
      _id: req.params.id,
      teacherId: req.user.id
    });

    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found.' });
    }

    // Delete everything related to this exam
    await TeacherExam.findByIdAndDelete(req.params.id);
    const qDel = await TeacherQuestion.deleteMany({ examId: req.params.id });
    const sDel = await StudentSubmission.deleteMany({ examId: req.params.id });

    // Log the deletion
    await ActivityLog.record({
      userId:      req.user.id,
      userName:    req.user.name || 'Teacher',
      userEmail:   req.user.email || '',
      userRole:    'teacher',
      action:      'teacher_exam_deleted',
      description: `Teacher deleted exam: "${exam.title}" [${exam.examCode}] — also removed ${qDel.deletedCount} questions and ${sDel.deletedCount} submissions`,
      metadata: {
        examTitle: exam.title,
        examCode:  exam.examCode
      }
    });

    return res.status(200).json({
      success: true,
      message: `Exam "${exam.title}" deleted along with ${qDel.deletedCount} questions and ${sDel.deletedCount} submissions.`
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error deleting exam' });
  }
});

/* ============================================
   GET /api/teacher/exams/:id/questions
   ============================================ */
router.get('/exams/:id/questions', async (req, res) => {
  try {
    // Verify ownership
    const exam = await TeacherExam.findOne({
      _id: req.params.id,
      teacherId: req.user.id
    });

    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found.' });
    }

    const questions = await TeacherQuestion.find({ examId: req.params.id })
      .sort({ orderNumber: 1, createdAt: 1 });

    return res.status(200).json({
      success: true,
      count: questions.length,
      questions
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching questions' });
  }
});

/* ============================================
   POST /api/teacher/exams/:id/questions
   Add a question + LOG it
   ============================================ */
router.post('/exams/:id/questions', async (req, res) => {
  try {
    // Verify ownership
    const exam = await TeacherExam.findOne({
      _id: req.params.id,
      teacherId: req.user.id
    });

    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found.' });
    }

    const {
      questionType, questionText, options,
      correctAnswer, expectedAnswer, marks
    } = req.body;

    // Validate
    if (!questionType || !questionText) {
      return res.status(400).json({
        success: false,
        message: 'Question type and question text are required.'
      });
    }

    if (questionType === 'objective') {
      if (!options || options.length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Objective questions need at least 2 options.'
        });
      }
      if (correctAnswer === undefined || correctAnswer === null) {
        return res.status(400).json({
          success: false,
          message: 'Please select the correct answer.'
        });
      }
    }

    // Get order number
    const questionCount = await TeacherQuestion.countDocuments({ examId: req.params.id });

    const question = await TeacherQuestion.create({
      examId:         req.params.id,
      questionType,
      questionText:   questionText.trim(),
      options:        questionType === 'objective' ? options.map(o => o.trim()) : [],
      correctAnswer:  questionType === 'objective' ? parseInt(correctAnswer) : null,
      expectedAnswer: questionType === 'theory'    ? (expectedAnswer || '') : '',
      marks:          parseInt(marks) || 1,
      orderNumber:    questionCount + 1
    });

    // Log the question addition
    await ActivityLog.record({
      userId:      req.user.id,
      userName:    req.user.name || 'Teacher',
      userEmail:   req.user.email || '',
      userRole:    'teacher',
      action:      'teacher_question_added',
      description: `Teacher added a ${questionType} question to exam "${exam.title}" [${exam.examCode}]`,
      metadata: {
        examId:    exam._id,
        examTitle: exam.title,
        examCode:  exam.examCode
      }
    });

    return res.status(201).json({
      success: true,
      message: 'Question added successfully!',
      question
    });

  } catch (error) {
    console.error('Add question error:', error);
    return res.status(500).json({ success: false, message: 'Error adding question' });
  }
});

/* ============================================
   PUT /api/teacher/questions/:id
   ============================================ */
router.put('/questions/:id', async (req, res) => {
  try {
    const question = await TeacherQuestion.findById(req.params.id).populate('examId');

    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found.' });
    }

    // Verify the teacher owns the exam this question belongs to
    if (question.examId.teacherId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const updated = await TeacherQuestion.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Question updated.',
      question: updated
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error updating question' });
  }
});

/* ============================================
   DELETE /api/teacher/questions/:id
   Delete a question + LOG it
   ============================================ */
router.delete('/questions/:id', async (req, res) => {
  try {
    const question = await TeacherQuestion.findById(req.params.id).populate('examId');

    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found.' });
    }

    if (question.examId.teacherId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    await TeacherQuestion.findByIdAndDelete(req.params.id);

    // Log the deletion
    await ActivityLog.record({
      userId:      req.user.id,
      userName:    req.user.name || 'Teacher',
      userEmail:   req.user.email || '',
      userRole:    'teacher',
      action:      'teacher_question_deleted',
      description: `Teacher deleted a question from exam "${question.examId.title}"`,
      metadata: {
        examId:    question.examId._id,
        examTitle: question.examId.title
      }
    });

    return res.status(200).json({ success: true, message: 'Question deleted.' });

  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error deleting question' });
  }
});

/* ============================================
   GET /api/teacher/exams/:id/submissions
   View students who took THIS teacher's exam
   ============================================ */
router.get('/exams/:id/submissions', async (req, res) => {
  try {
    // Verify ownership — teacher can only see submissions for their own exams
    const exam = await TeacherExam.findOne({
      _id: req.params.id,
      teacherId: req.user.id
    });

    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found.' });
    }

    const submissions = await StudentSubmission.find({ examId: req.params.id })
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      examTitle: exam.title,
      examCode:  exam.examCode,
      count:     submissions.length,
      submissions
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching submissions' });
  }
});

module.exports = router;