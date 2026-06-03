/* ============================================
   LATLOMP PLATFORM — ADMIN ROUTES
   ============================================
   All routes here require:
   1. Valid JWT token (logged in)
   2. role === 'admin'

   Routes:
   GET  /api/admin/stats          → Platform overview stats
   GET  /api/admin/users          → All users with search
   PUT  /api/admin/users/:id      → Update user (activate/deactivate/role)
   DELETE /api/admin/users/:id    → Delete user

   GET  /api/admin/exams          → All exams
   POST /api/admin/exams          → Create new exam
   PUT  /api/admin/exams/:id      → Update exam
   DELETE /api/admin/exams/:id    → Delete exam

   GET  /api/admin/questions      → All questions (filter by exam)
   POST /api/admin/questions      → Add one question
   POST /api/admin/questions/bulk → Bulk add questions (CSV)
   PUT  /api/admin/questions/:id  → Update question
   DELETE /api/admin/questions/:id → Delete question

   GET  /api/admin/results        → All results across all users
   GET  /api/admin/products       → All products
   POST /api/admin/products       → Add product
   PUT  /api/admin/products/:id   → Update product
   DELETE /api/admin/products/:id → Delete product
   ============================================ */

const express  = require('express');
const router   = express.Router();
const User     = require('../models/User.model');
const Exam     = require('../models/Exam.model');
const Question = require('../models/Question.model');
const Result   = require('../models/Result.model');
const Product  = require('../models/Product.model');
const { protect, adminOnly } = require('../middleware/auth.middleware');

// All admin routes are protected — apply both middlewares to every route
router.use(protect);
router.use(adminOnly);

/* ============================================
   HELPER: Standard error response
   ============================================ */
const handleError = (res, error, msg = 'Server error') => {
  console.error(`Admin route error: ${error.message}`);
  if (error.name === 'ValidationError') {
    const messages = Object.values(error.errors).map(e => e.message);
    return res.status(400).json({ success: false, message: messages.join(', ') });
  }
  if (error.name === 'CastError') {
    return res.status(400).json({ success: false, message: 'Invalid ID format' });
  }
  return res.status(500).json({ success: false, message: msg });
};

/* ============================================
   PLATFORM STATISTICS
   GET /api/admin/stats
   Returns overview numbers for the dashboard
   ============================================ */
router.get('/stats', async (req, res) => {
  try {
    // Run all database count queries in parallel for speed
    const [
      totalUsers,
      totalStudents,
      totalAdmins,
      totalExams,
      totalQuestions,
      totalResults,
      totalProducts,
      recentUsers,
      recentResults,
      passCount
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ role: 'student' }),
      User.countDocuments({ role: 'admin' }),
      Exam.countDocuments({}),
      Question.countDocuments({}),
      Result.countDocuments({}),
      Product.countDocuments({}),
      // Last 5 registered users
      User.find({}).sort({ createdAt: -1 }).limit(5).select('name email role createdAt'),
      // Last 5 exam attempts
      Result.find({}).sort({ createdAt: -1 }).limit(5)
        .populate('userId', 'name email')
        .select('examTitle scorePercent isPassed createdAt userId'),
      // How many results are passes
      Result.countDocuments({ isPassed: true })
    ]);

    // Calculate pass rate
    const passRate = totalResults > 0
      ? Math.round((passCount / totalResults) * 100)
      : 0;

    // Calculate average score across all results
    const avgResult = await Result.aggregate([
      { $group: { _id: null, avgScore: { $avg: '$scorePercent' } } }
    ]);
    const averageScore = avgResult.length > 0
      ? Math.round(avgResult[0].avgScore)
      : 0;

    return res.status(200).json({
      success: true,
      stats: {
        users: {
          total: totalUsers,
          students: totalStudents,
          admins: totalAdmins
        },
        exams: {
          total: totalExams,
          questions: totalQuestions
        },
        results: {
          total: totalResults,
          passRate,
          averageScore
        },
        products: {
          total: totalProducts
        }
      },
      recentUsers,
      recentResults
    });

  } catch (error) {
    return handleError(res, error, 'Error fetching stats');
  }
});

/* ============================================
   USER MANAGEMENT
   ============================================ */

// GET all users with optional search
router.get('/users', async (req, res) => {
  try {
    const { search, role, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (role && role !== 'all') filter.role = role;
    if (search) {
      filter.$or = [
        { name:  { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    return res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      users: users.map(u => u.toSafeObject())
    });
  } catch (error) {
    return handleError(res, error, 'Error fetching users');
  }
});

// UPDATE user (role, isActive)
router.put('/users/:id', async (req, res) => {
  try {
    const { role, isActive } = req.body;

    // Prevent admin from deactivating themselves
    if (req.params.id === req.user.id && isActive === false) {
      return res.status(400).json({
        success: false,
        message: 'You cannot deactivate your own account'
      });
    }

    const updates = {};
    if (role     !== undefined) updates.role     = role;
    if (isActive !== undefined) updates.isActive = isActive;

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'User updated successfully',
      user: user.toSafeObject()
    });
  } catch (error) {
    return handleError(res, error, 'Error updating user');
  }
});

// DELETE user
router.delete('/users/:id', async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own admin account'
      });
    }

    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Also delete their results
    await Result.deleteMany({ userId: req.params.id });

    return res.status(200).json({
      success: true,
      message: `User "${user.name}" deleted successfully`
    });
  } catch (error) {
    return handleError(res, error, 'Error deleting user');
  }
});

/* ============================================
   EXAM MANAGEMENT
   ============================================ */

// GET all exams
router.get('/exams', async (req, res) => {
  try {
    const exams = await Exam.find({})
      .sort({ createdAt: -1 })
      .populate('createdBy', 'name');

    return res.status(200).json({
      success: true,
      count: exams.length,
      exams
    });
  } catch (error) {
    return handleError(res, error, 'Error fetching exams');
  }
});

// CREATE exam
router.post('/exams', async (req, res) => {
  try {
    const exam = await Exam.create({
      ...req.body,
      createdBy: req.user.id
    });

    return res.status(201).json({
      success: true,
      message: 'Exam created successfully!',
      exam
    });
  } catch (error) {
    return handleError(res, error, 'Error creating exam');
  }
});

// UPDATE exam
router.put('/exams/:id', async (req, res) => {
  try {
    const exam = await Exam.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Exam updated successfully',
      exam
    });
  } catch (error) {
    return handleError(res, error, 'Error updating exam');
  }
});

// DELETE exam (also deletes all questions and results for that exam)
router.delete('/exams/:id', async (req, res) => {
  try {
    const exam = await Exam.findByIdAndDelete(req.params.id);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    // Clean up related data
    const deletedQuestions = await Question.deleteMany({ examId: req.params.id });
    const deletedResults   = await Result.deleteMany({ examId: req.params.id });

    return res.status(200).json({
      success: true,
      message: `Exam "${exam.title}" deleted. Also removed ${deletedQuestions.deletedCount} questions and ${deletedResults.deletedCount} results.`
    });
  } catch (error) {
    return handleError(res, error, 'Error deleting exam');
  }
});

/* ============================================
   QUESTION MANAGEMENT
   ============================================ */

// GET questions — filter by examId
router.get('/questions', async (req, res) => {
  try {
    const { examId } = req.query;
    const filter = examId ? { examId } : {};

    const questions = await Question.find(filter)
      .populate('examId', 'title type')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: questions.length,
      questions
    });
  } catch (error) {
    return handleError(res, error, 'Error fetching questions');
  }
});

// CREATE one question
router.post('/questions', async (req, res) => {
  try {
    const question = await Question.create(req.body);

    // Update exam's question count
    const count = await Question.countDocuments({ examId: question.examId });
    await Exam.findByIdAndUpdate(question.examId, { totalQuestions: count });

    return res.status(201).json({
      success: true,
      message: 'Question added successfully!',
      question
    });
  } catch (error) {
    return handleError(res, error, 'Error creating question');
  }
});

// BULK CREATE questions
router.post('/questions/bulk', async (req, res) => {
  try {
    const { questions } = req.body;

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an array of questions'
      });
    }

    // Validate each question has required fields
    const invalid = questions.findIndex(
      q => !q.question || !q.options || q.options.length !== 4 || q.correctAnswer === undefined
    );

    if (invalid !== -1) {
      return res.status(400).json({
        success: false,
        message: `Question ${invalid + 1} is invalid. Each question needs: question, 4 options, and correctAnswer (0-3).`
      });
    }

    const created = await Question.insertMany(questions);

    // Update the exam's question count
    if (questions[0].examId) {
      const count = await Question.countDocuments({ examId: questions[0].examId });
      await Exam.findByIdAndUpdate(questions[0].examId, { totalQuestions: count });
    }

    return res.status(201).json({
      success: true,
      message: `${created.length} questions added successfully!`,
      count: created.length
    });
  } catch (error) {
    return handleError(res, error, 'Error bulk creating questions');
  }
});

// UPDATE question
router.put('/questions/:id', async (req, res) => {
  try {
    const question = await Question.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Question updated successfully',
      question
    });
  } catch (error) {
    return handleError(res, error, 'Error updating question');
  }
});

// DELETE question
router.delete('/questions/:id', async (req, res) => {
  try {
    const question = await Question.findByIdAndDelete(req.params.id);
    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found' });
    }

    // Update exam's question count
    const count = await Question.countDocuments({ examId: question.examId });
    await Exam.findByIdAndUpdate(question.examId, { totalQuestions: count });

    return res.status(200).json({
      success: true,
      message: 'Question deleted successfully'
    });
  } catch (error) {
    return handleError(res, error, 'Error deleting question');
  }
});

/* ============================================
   RESULTS OVERVIEW
   ============================================ */

// GET all results across all users
router.get('/results', async (req, res) => {
  try {
    const { page = 1, limit = 25, examId } = req.query;
    const filter = examId ? { examId } : {};
    const skip   = (parseInt(page) - 1) * parseInt(limit);
    const total  = await Result.countDocuments(filter);

    const results = await Result.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('userId', 'name email')
      .select('-answers'); // Don't send full answer data in list view

    return res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      results
    });
  } catch (error) {
    return handleError(res, error, 'Error fetching results');
  }
});

/* ============================================
   PRODUCT MANAGEMENT
   ============================================ */

// GET all products
router.get('/products', async (req, res) => {
  try {
    const products = await Product.find({}).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: products.length, products });
  } catch (error) {
    return handleError(res, error, 'Error fetching products');
  }
});

// CREATE product
router.post('/products', async (req, res) => {
  try {
    const product = await Product.create({ ...req.body, createdBy: req.user.id });
    return res.status(201).json({
      success: true,
      message: 'Product created successfully!',
      product
    });
  } catch (error) {
    return handleError(res, error, 'Error creating product');
  }
});

// UPDATE product
router.put('/products/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    return res.status(200).json({ success: true, message: 'Product updated!', product });
  } catch (error) {
    return handleError(res, error, 'Error updating product');
  }
});

// DELETE product
router.delete('/products/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    return res.status(200).json({
      success: true,
      message: `Product "${product.name}" deleted successfully`
    });
  } catch (error) {
    return handleError(res, error, 'Error deleting product');
  }
});

/* ============================================
   TEACHER EXAMS — Admin View
   GET /api/admin/teacher-exams
   Admin can see ALL teacher-created exams
   ============================================ */
router.get('/teacher-exams', async (req, res) => {
  try {
    // We require these models here to avoid
    // circular dependency issues
    const TeacherExam = require('../models/TeacherExam.model');
    const User        = require('../models/User.model');

    const exams = await TeacherExam.find({})
      .sort({ createdAt: -1 })
      .populate('teacherId', 'name email'); // show teacher name

    return res.status(200).json({
      success: true,
      count: exams.length,
      exams
    });

  } catch (error) {
    return handleError(res, error, 'Error fetching teacher exams');
  }
});

/* ============================================
   STUDENT SUBMISSIONS — Admin View
   GET /api/admin/submissions
   Admin can see ALL student submissions
   ============================================ */
router.get('/submissions', async (req, res) => {
  try {
    const StudentSubmission = require('../models/StudentSubmission.model');
    const { page = 1, limit = 25 } = req.query;
    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const total = await StudentSubmission.countDocuments({});

    const submissions = await StudentSubmission.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('teacherId', 'name email')
      .select('-answers'); // don't send full answer data in list view

    return res.status(200).json({
      success: true,
      total,
      page:  parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      submissions
    });

  } catch (error) {
    return handleError(res, error, 'Error fetching submissions');
  }
});

/* ============================================
   EXTENDED STATS — Admin Overview
   GET /api/admin/stats (already exists)
   We need to UPDATE the existing stats route
   to include teacher + student counts.

   Actually we add a NEW separate endpoint
   so we don't break the existing one:
   GET /api/admin/extended-stats
   ============================================ */
router.get('/extended-stats', async (req, res) => {
  try {
    const TeacherExam       = require('../models/TeacherExam.model');
    const TeacherQuestion   = require('../models/TeacherQuestion.model');
    const StudentSubmission = require('../models/StudentSubmission.model');

    const [
      totalTeacherExams,
      totalTeacherQuestions,
      totalStudentSubmissions,
      recentSubmissions
    ] = await Promise.all([
      TeacherExam.countDocuments({}),
      TeacherQuestion.countDocuments({}),
      StudentSubmission.countDocuments({}),
      StudentSubmission.find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('teacherId', 'name')
        .select('studentName examTitle scorePercent isPassed createdAt teacherId')
    ]);

    return res.status(200).json({
      success: true,
      teacherSystem: {
        totalTeacherExams,
        totalTeacherQuestions,
        totalStudentSubmissions
      },
      recentSubmissions
    });

  } catch (error) {
    return handleError(res, error, 'Error fetching extended stats');
  }
});

/* ============================================
   TEACHER MANAGEMENT — Full Admin Control
   ============================================ */

/* ============================================
   GET /api/admin/teachers
   Get ALL teachers with their stats
   ============================================ */
router.get('/teachers', async (req, res) => {
  try {
    const TeacherExam       = require('../models/TeacherExam.model');
    const StudentSubmission = require('../models/StudentSubmission.model');

    // Get all teacher accounts
    const teachers = await User.find({ role: 'teacher' })
      .sort({ createdAt: -1 });

    // For each teacher, get their exam count and submission count
    const teachersWithStats = await Promise.all(
      teachers.map(async (teacher) => {
        const [examCount, submissionCount, recentExams] = await Promise.all([
          TeacherExam.countDocuments({ teacherId: teacher._id }),
          StudentSubmission.countDocuments({ teacherId: teacher._id }),
          TeacherExam.find({ teacherId: teacher._id })
            .sort({ createdAt: -1 })
            .limit(3)
            .select('title examCode examType totalAttempts isActive createdAt')
        ]);

        return {
          ...teacher.toSafeObject(),
          examCount,
          submissionCount,
          recentExams
        };
      })
    );

    return res.status(200).json({
      success: true,
      count: teachersWithStats.length,
      teachers: teachersWithStats
    });

  } catch (error) {
    return handleError(res, error, 'Error fetching teachers');
  }
});

/* ============================================
   GET /api/admin/teachers/:id/data
   Get ONE teacher's complete data:
   - Their profile
   - All their exams
   - All questions for each exam
   - All student submissions
   This is the "grouped view" the admin needs
   ============================================ */
router.get('/teachers/:id/data', async (req, res) => {
  try {
    const TeacherExam       = require('../models/TeacherExam.model');
    const TeacherQuestion   = require('../models/TeacherQuestion.model');
    const StudentSubmission = require('../models/StudentSubmission.model');

    // Get the teacher's profile
    const teacher = await User.findOne({
      _id: req.params.id,
      role: 'teacher'
    });

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found.' });
    }

    // Get all their exams
    const exams = await TeacherExam.find({ teacherId: req.params.id })
      .sort({ createdAt: -1 });

    // For each exam, get its questions and submissions
    const examsWithData = await Promise.all(
      exams.map(async (exam) => {
        const [questions, submissions] = await Promise.all([
          TeacherQuestion.find({ examId: exam._id })
            .sort({ orderNumber: 1 }),
          StudentSubmission.find({ examId: exam._id })
            .sort({ createdAt: -1 })
            .select('-answers') // exclude full answer data in list view
        ]);

        return {
          ...exam.toObject(),
          questionCount: questions.length,
          questions,
          submissionCount: submissions.length,
          submissions
        };
      })
    );

    return res.status(200).json({
      success: true,
      teacher: teacher.toSafeObject(),
      totalExams: exams.length,
      exams: examsWithData
    });

  } catch (error) {
    return handleError(res, error, 'Error fetching teacher data');
  }
});

/* ============================================
   DELETE /api/admin/teachers/:id
   Delete a teacher AND all their data:
   - Their exams
   - Their questions
   - Their student submissions
   - Their activity logs
   - Their user account
   ============================================ */
router.delete('/teachers/:id', async (req, res) => {
  try {
    const TeacherExam       = require('../models/TeacherExam.model');
    const TeacherQuestion   = require('../models/TeacherQuestion.model');
    const StudentSubmission = require('../models/StudentSubmission.model');
    const ActivityLog       = require('../models/ActivityLog.model');

    // Find the teacher
    const teacher = await User.findOne({
      _id: req.params.id,
      role: 'teacher'
    });

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found.' });
    }

    // Get all their exam IDs first (so we can delete questions)
    const exams = await TeacherExam.find({ teacherId: req.params.id }).select('_id');
    const examIds = exams.map(e => e._id);

    // Delete everything in order
    const qDel = await TeacherQuestion.deleteMany({ examId: { $in: examIds } });
    const sDel = await StudentSubmission.deleteMany({ teacherId: req.params.id });
    const eDel = await TeacherExam.deleteMany({ teacherId: req.params.id });
    const lDel = await ActivityLog.deleteMany({ userId: req.params.id });
    await User.findByIdAndDelete(req.params.id);

    // Log this admin action
    await ActivityLog.record({
      userId:      req.user.id,
      userName:    req.user.name || 'Admin',
      userEmail:   req.user.email || '',
      userRole:    'admin',
      action:      'admin_deleted_teacher',
      description: `Admin deleted teacher account: "${teacher.name}" (${teacher.email}) — removed ${eDel.deletedCount} exams, ${qDel.deletedCount} questions, ${sDel.deletedCount} submissions`
    });

    return res.status(200).json({
      success: true,
      message: `Teacher "${teacher.name}" and all their data deleted successfully.`,
      deleted: {
        exams:       eDel.deletedCount,
        questions:   qDel.deletedCount,
        submissions: sDel.deletedCount,
        logs:        lDel.deletedCount
      }
    });

  } catch (error) {
    return handleError(res, error, 'Error deleting teacher');
  }
});

/* ============================================
   GET /api/admin/activity-log
   View the full activity log
   Filter options:
   - ?role=teacher  (only teacher actions)
   - ?role=student  (only student submissions)
   - ?action=teacher_exam_created
   - ?page=1&limit=30
   ============================================ */
router.get('/activity-log', async (req, res) => {
  try {
    const ActivityLog = require('../models/ActivityLog.model');
    const {
      role,
      action,
      page  = 1,
      limit = 30
    } = req.query;

    // Build filter
    const filter = {};
    if (role)   filter.userRole = role;
    if (action) filter.action   = action;

    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const total = await ActivityLog.countDocuments(filter);

    const logs = await ActivityLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    return res.status(200).json({
      success: true,
      total,
      page:  parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      logs
    });

  } catch (error) {
    return handleError(res, error, 'Error fetching activity log');
  }
});

module.exports = router;