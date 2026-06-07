/* ============================================
   LATLOMP PLATFORM — ADMIN ROUTES
============================================ */
const express      = require('express');
const router       = express.Router();
const User         = require('../models/User.model');
const Exam         = require('../models/Exam.model');
const Question     = require('../models/Question.model');
const Result       = require('../models/Result.model');
const Product      = require('../models/Product.model');
const { protect, adminOnly } = require('../middleware/auth.middleware');

/* Institution models */
const School       = require('../institution/models/School.model');
const SchoolUser   = require('../institution/models/SchoolUser.model');
const SchoolExam   = require('../institution/models/SchoolExam.model');
const SchoolResult = require('../institution/models/SchoolResult.model');
const { SubscriptionPlan, Subscription } = require('../institution/models/Subscription.model');
const Announcement = require('../institution/models/Announcement.model');

router.use(protect);
router.use(adminOnly);

const handleError = (res, error, msg = 'Server error') => {
  console.error('Admin route error:', error.message);
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
============================================ */
router.get('/stats', async (req, res) => {
  try {
    const [totalUsers, totalStudents, totalAdmins, totalExams, totalQuestions,
           totalResults, totalProducts, recentUsers, recentResults, passCount] = await Promise.all([
      User.countDocuments({}), User.countDocuments({ role: 'student' }),
      User.countDocuments({ role: 'admin' }), Exam.countDocuments({}),
      Question.countDocuments({}), Result.countDocuments({}), Product.countDocuments({}),
      User.find({}).sort({ createdAt: -1 }).limit(5).select('name email role createdAt'),
      Result.find({}).sort({ createdAt: -1 }).limit(5)
        .populate('userId', 'name email').select('examTitle scorePercent isPassed createdAt userId'),
      Result.countDocuments({ isPassed: true })
    ]);
    const passRate     = totalResults > 0 ? Math.round((passCount / totalResults) * 100) : 0;
    const avgResult    = await Result.aggregate([{ $group: { _id: null, avgScore: { $avg: '$scorePercent' } } }]);
    const averageScore = avgResult.length > 0 ? Math.round(avgResult[0].avgScore) : 0;
    return res.status(200).json({
      success: true,
      stats: {
        users:    { total: totalUsers, students: totalStudents, admins: totalAdmins },
        exams:    { total: totalExams, questions: totalQuestions },
        results:  { total: totalResults, passRate, averageScore },
        products: { total: totalProducts }
      },
      recentUsers, recentResults
    });
  } catch (error) { return handleError(res, error, 'Error fetching stats'); }
});

/* ============================================
   USER MANAGEMENT
============================================ */
router.get('/users', async (req, res) => {
  try {
    const { search, role, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (role && role !== 'all') filter.role = role;
    if (search) { filter.$or = [{ name: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }]; }
    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const total = await User.countDocuments(filter);
    const users = await User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
    return res.status(200).json({
      success: true, total, page: parseInt(page), pages: Math.ceil(total/parseInt(limit)),
      users: users.map(u => u.toSafeObject())
    });
  } catch (error) { return handleError(res, error, 'Error fetching users'); }
});

router.put('/users/:id', async (req, res) => {
  try {
    const { role, isActive } = req.body;
    if (req.params.id === req.user.id && isActive === false) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own account' });
    }
    const updates = {};
    if (role !== undefined)     updates.role     = role;
    if (isActive !== undefined) updates.isActive = isActive;
    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    return res.status(200).json({ success: true, message: 'User updated successfully', user: user.toSafeObject() });
  } catch (error) { return handleError(res, error, 'Error updating user'); }
});

router.delete('/users/:id', async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own admin account' });
    }
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await Result.deleteMany({ userId: req.params.id });
    return res.status(200).json({ success: true, message: `User "${user.name}" deleted successfully` });
  } catch (error) { return handleError(res, error, 'Error deleting user'); }
});

/* ============================================
   EXAM MANAGEMENT
============================================ */
router.get('/exams', async (req, res) => {
  try {
    const exams = await Exam.find({}).sort({ createdAt: -1 }).populate('createdBy', 'name');
    return res.status(200).json({ success: true, count: exams.length, exams });
  } catch (error) { return handleError(res, error, 'Error fetching exams'); }
});

router.post('/exams', async (req, res) => {
  try {
    const exam = await Exam.create({ ...req.body, createdBy: req.user.id });
    return res.status(201).json({ success: true, message: 'Exam created successfully!', exam });
  } catch (error) { return handleError(res, error, 'Error creating exam'); }
});

router.put('/exams/:id', async (req, res) => {
  try {
    const exam = await Exam.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });
    return res.status(200).json({ success: true, message: 'Exam updated successfully', exam });
  } catch (error) { return handleError(res, error, 'Error updating exam'); }
});

router.delete('/exams/:id', async (req, res) => {
  try {
    const exam = await Exam.findByIdAndDelete(req.params.id);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });
    const deletedQuestions = await Question.deleteMany({ examId: req.params.id });
    const deletedResults   = await Result.deleteMany({ examId: req.params.id });
    return res.status(200).json({
      success: true,
      message: `Exam "${exam.title}" deleted. Removed ${deletedQuestions.deletedCount} questions and ${deletedResults.deletedCount} results.`
    });
  } catch (error) { return handleError(res, error, 'Error deleting exam'); }
});

/* ============================================
   QUESTION MANAGEMENT
============================================ */
router.get('/questions', async (req, res) => {
  try {
    const { examId } = req.query;
    const questions  = await Question.find(examId ? { examId } : {}).populate('examId', 'title type').sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: questions.length, questions });
  } catch (error) { return handleError(res, error, 'Error fetching questions'); }
});

router.post('/questions', async (req, res) => {
  try {
    const question = await Question.create(req.body);
    const count    = await Question.countDocuments({ examId: question.examId });
    await Exam.findByIdAndUpdate(question.examId, { totalQuestions: count });
    return res.status(201).json({ success: true, message: 'Question added successfully!', question });
  } catch (error) { return handleError(res, error, 'Error creating question'); }
});

router.post('/questions/bulk', async (req, res) => {
  try {
    const { questions } = req.body;
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide an array of questions' });
    }
    const invalid = questions.findIndex(q => !q.question || !q.options || q.options.length !== 4 || q.correctAnswer === undefined);
    if (invalid !== -1) return res.status(400).json({ success: false, message: `Question ${invalid + 1} is invalid.` });
    const created = await Question.insertMany(questions);
    if (questions[0].examId) {
      const count = await Question.countDocuments({ examId: questions[0].examId });
      await Exam.findByIdAndUpdate(questions[0].examId, { totalQuestions: count });
    }
    return res.status(201).json({ success: true, message: `${created.length} questions added!`, count: created.length });
  } catch (error) { return handleError(res, error, 'Error bulk creating questions'); }
});

router.put('/questions/:id', async (req, res) => {
  try {
    const question = await Question.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!question) return res.status(404).json({ success: false, message: 'Question not found' });
    return res.status(200).json({ success: true, message: 'Question updated successfully', question });
  } catch (error) { return handleError(res, error, 'Error updating question'); }
});

router.delete('/questions/:id', async (req, res) => {
  try {
    const question = await Question.findByIdAndDelete(req.params.id);
    if (!question) return res.status(404).json({ success: false, message: 'Question not found' });
    const count = await Question.countDocuments({ examId: question.examId });
    await Exam.findByIdAndUpdate(question.examId, { totalQuestions: count });
    return res.status(200).json({ success: true, message: 'Question deleted successfully' });
  } catch (error) { return handleError(res, error, 'Error deleting question'); }
});

/* ============================================
   RESULTS
============================================ */
router.get('/results', async (req, res) => {
  try {
    const { page = 1, limit = 25, examId } = req.query;
    const filter = examId ? { examId } : {};
    const skip   = (parseInt(page) - 1) * parseInt(limit);
    const total  = await Result.countDocuments(filter);
    const results = await Result.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit))
      .populate('userId', 'name email').select('-answers');
    return res.status(200).json({ success: true, total, page: parseInt(page), pages: Math.ceil(total/parseInt(limit)), results });
  } catch (error) { return handleError(res, error, 'Error fetching results'); }
});

/* ============================================
   PRODUCT MANAGEMENT
============================================ */
router.get('/products', async (req, res) => {
  try {
    const products = await Product.find({}).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: products.length, products });
  } catch (error) { return handleError(res, error, 'Error fetching products'); }
});

router.post('/products', async (req, res) => {
  try {
    const product = await Product.create({ ...req.body, createdBy: req.user.id });
    return res.status(201).json({ success: true, message: 'Product created successfully!', product });
  } catch (error) { return handleError(res, error, 'Error creating product'); }
});

router.put('/products/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    return res.status(200).json({ success: true, message: 'Product updated!', product });
  } catch (error) { return handleError(res, error, 'Error updating product'); }
});

router.delete('/products/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    return res.status(200).json({ success: true, message: `Product "${product.name}" deleted successfully` });
  } catch (error) { return handleError(res, error, 'Error deleting product'); }
});

/* ============================================
   TEACHER EXAMS & SUBMISSIONS (existing)
============================================ */
router.get('/teacher-exams', async (req, res) => {
  try {
    const TeacherExam = require('../models/TeacherExam.model');
    const exams = await TeacherExam.find({}).sort({ createdAt: -1 }).populate('teacherId', 'name email');
    return res.status(200).json({ success: true, count: exams.length, exams });
  } catch (error) { return handleError(res, error, 'Error fetching teacher exams'); }
});

router.get('/submissions', async (req, res) => {
  try {
    const StudentSubmission = require('../models/StudentSubmission.model');
    const { page = 1, limit = 25 } = req.query;
    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const total = await StudentSubmission.countDocuments({});
    const submissions = await StudentSubmission.find({}).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit))
      .populate('teacherId', 'name email').select('-answers');
    return res.status(200).json({ success: true, total, page: parseInt(page), pages: Math.ceil(total/parseInt(limit)), submissions });
  } catch (error) { return handleError(res, error, 'Error fetching submissions'); }
});

router.get('/extended-stats', async (req, res) => {
  try {
    const TeacherExam       = require('../models/TeacherExam.model');
    const TeacherQuestion   = require('../models/TeacherQuestion.model');
    const StudentSubmission = require('../models/StudentSubmission.model');
    const [totalTeacherExams, totalTeacherQuestions, totalStudentSubmissions, recentSubmissions] = await Promise.all([
      TeacherExam.countDocuments({}), TeacherQuestion.countDocuments({}),
      StudentSubmission.countDocuments({}),
      StudentSubmission.find({}).sort({ createdAt: -1 }).limit(5)
        .populate('teacherId', 'name').select('studentName examTitle scorePercent isPassed createdAt teacherId')
    ]);
    return res.status(200).json({ success: true, teacherSystem: { totalTeacherExams, totalTeacherQuestions, totalStudentSubmissions }, recentSubmissions });
  } catch (error) { return handleError(res, error, 'Error fetching extended stats'); }
});

router.get('/teachers', async (req, res) => {
  try {
    const TeacherExam       = require('../models/TeacherExam.model');
    const StudentSubmission = require('../models/StudentSubmission.model');
    const teachers          = await User.find({ role: 'teacher' }).sort({ createdAt: -1 });
    const teachersWithStats = await Promise.all(teachers.map(async (teacher) => {
      const [examCount, submissionCount, recentExams] = await Promise.all([
        TeacherExam.countDocuments({ teacherId: teacher._id }),
        StudentSubmission.countDocuments({ teacherId: teacher._id }),
        TeacherExam.find({ teacherId: teacher._id }).sort({ createdAt: -1 }).limit(3)
          .select('title examCode examType totalAttempts isActive createdAt')
      ]);
      return { ...teacher.toSafeObject(), examCount, submissionCount, recentExams };
    }));
    return res.status(200).json({ success: true, count: teachersWithStats.length, teachers: teachersWithStats });
  } catch (error) { return handleError(res, error, 'Error fetching teachers'); }
});

router.get('/teachers/:id/data', async (req, res) => {
  try {
    const TeacherExam       = require('../models/TeacherExam.model');
    const TeacherQuestion   = require('../models/TeacherQuestion.model');
    const StudentSubmission = require('../models/StudentSubmission.model');
    const teacher = await User.findOne({ _id: req.params.id, role: 'teacher' });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found.' });
    const exams = await TeacherExam.find({ teacherId: req.params.id }).sort({ createdAt: -1 });
    const examsWithData = await Promise.all(exams.map(async (exam) => {
      const [questions, submissions] = await Promise.all([
        TeacherQuestion.find({ examId: exam._id }).sort({ orderNumber: 1 }),
        StudentSubmission.find({ examId: exam._id }).sort({ createdAt: -1 }).select('-answers')
      ]);
      return { ...exam.toObject(), questionCount: questions.length, questions, submissionCount: submissions.length, submissions };
    }));
    return res.status(200).json({ success: true, teacher: teacher.toSafeObject(), totalExams: exams.length, exams: examsWithData });
  } catch (error) { return handleError(res, error, 'Error fetching teacher data'); }
});

router.delete('/teachers/:id', async (req, res) => {
  try {
    const TeacherExam       = require('../models/TeacherExam.model');
    const TeacherQuestion   = require('../models/TeacherQuestion.model');
    const StudentSubmission = require('../models/StudentSubmission.model');
    const ActivityLog       = require('../models/ActivityLog.model');
    const teacher = await User.findOne({ _id: req.params.id, role: 'teacher' });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found.' });
    const exams   = await TeacherExam.find({ teacherId: req.params.id }).select('_id');
    const examIds = exams.map(e => e._id);
    const qDel = await TeacherQuestion.deleteMany({ examId: { $in: examIds } });
    const sDel = await StudentSubmission.deleteMany({ teacherId: req.params.id });
    const eDel = await TeacherExam.deleteMany({ teacherId: req.params.id });
    const lDel = await ActivityLog.deleteMany({ userId: req.params.id });
    await User.findByIdAndDelete(req.params.id);
    await ActivityLog.record({
      userId: req.user.id, userName: req.user.name || 'Admin', userEmail: req.user.email || '',
      userRole: 'admin', action: 'admin_deleted_teacher',
      description: `Admin deleted teacher: "${teacher.name}" — ${eDel.deletedCount} exams, ${qDel.deletedCount} questions, ${sDel.deletedCount} submissions`
    });
    return res.status(200).json({ success: true, message: `Teacher "${teacher.name}" and all data deleted.`, deleted: { exams: eDel.deletedCount, questions: qDel.deletedCount, submissions: sDel.deletedCount, logs: lDel.deletedCount } });
  } catch (error) { return handleError(res, error, 'Error deleting teacher'); }
});

router.get('/activity-log', async (req, res) => {
  try {
    const ActivityLog = require('../models/ActivityLog.model');
    const { role, action, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (role)   filter.userRole = role;
    if (action) filter.action   = action;
    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const total = await ActivityLog.countDocuments(filter);
    const logs  = await ActivityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
    return res.status(200).json({ success: true, total, page: parseInt(page), pages: Math.ceil(total/parseInt(limit)), logs });
  } catch (error) { return handleError(res, error, 'Error fetching activity log'); }
});

/* ============================================
   INSTITUTION MANAGEMENT

   ✅ FIX: Route ordering corrected.
   BEFORE this fix: POST/GET /institutions/announcements
   came AFTER /institutions/:id — Express matched
   "announcements" as an :id, threw CastError on
   School.findById("announcements") → 400 response
   → every admin institution API showed "Failed to load."

   CORRECT ORDER: static paths FIRST, parameterized AFTER
============================================ */

/* ---- Overview stats ---- */
router.get('/institutions/stats', async (req, res) => {
  try {
    var [total, active, trial, suspended, expired, totalSubs] = await Promise.all([
      School.countDocuments({}),
      School.countDocuments({ status: 'active',   isSuspended: false }),
      School.countDocuments({ status: 'trial',    isSuspended: false }),
      School.countDocuments({ isSuspended: true }),
      School.countDocuments({ status: 'expired' }),
      Subscription.aggregate([
        { $match: { status: 'active', isTrial: { $ne: true } } },
        { $group: { _id: null, total: { $sum: '$paidAmount' } } }
      ])
    ]);
    var totalRevenue  = totalSubs.length > 0 ? totalSubs[0].total : 0;
    var recentSchools = await School.find({}).sort({ createdAt: -1 }).limit(5)
      .select('name email status subscriptionPlan subscriptionExpiry createdAt');
    return res.status(200).json({
      success: true,
      stats: { total, active, trial, suspended, expired, totalRevenue },
      recentSchools
    });
  } catch (error) { return handleError(res, error, 'Error fetching institution stats'); }
});

/* ✅ FIX: Announcements routes placed BEFORE /:id routes */
router.post('/institutions/announcements', async (req, res) => {
  try {
    var { schoolId, title, message, type } = req.body;
    if (!title || !message) {
      return res.status(400).json({ success: false, message: 'Title and message are required.' });
    }
    var targetSchools = [];
    if (schoolId) {
      var school = await School.findById(schoolId).select('name email');
      if (!school) return res.status(404).json({ success: false, message: 'Institution not found.' });
      targetSchools = [school];
    } else {
      targetSchools = await School.find({}).select('name email');
    }
    await Promise.all(targetSchools.map(function(school) {
      return Announcement.create({
        schoolId: schoolId || null,
        title, message, type: type || 'info',
        sentBy: req.user.email || 'admin'
      });
    }));
    return res.status(201).json({
      success: true,
      message: 'Announcement sent to ' + targetSchools.length + ' institution' + (targetSchools.length !== 1 ? 's' : '') + '.',
      sent: targetSchools.length
    });
  } catch (error) { return handleError(res, error, 'Error sending announcement'); }
});

router.get('/institutions/announcements', async (req, res) => {
  try {
    var { page = 1, limit = 20 } = req.query;
    var skip  = (parseInt(page) - 1) * parseInt(limit);
    var total = await Announcement.countDocuments({});
    var announcements = await Announcement.find({})
      .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit))
      .populate('schoolId', 'name email');
    return res.status(200).json({ success: true, total, announcements });
  } catch (error) { return handleError(res, error, 'Error fetching announcements'); }
});

/* ✅ FIX: Audit logs also placed before /:id to avoid conflicts */
router.get('/institution-logs', async (req, res) => {
  try {
    const AuditLog = require('../models/AuditLog.model');
    var { page = 1, limit = 30, schoolId } = req.query;
    var filter = { actorType: 'school_user' };
    if (schoolId) filter.schoolId = schoolId;
    var skip  = (parseInt(page) - 1) * parseInt(limit);
    var total = await AuditLog.countDocuments(filter);
    var logs  = await AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
    return res.status(200).json({ success: true, total, page: parseInt(page), pages: Math.ceil(total/parseInt(limit)), logs });
  } catch (error) { return handleError(res, error, 'Error fetching institution audit logs'); }
});

/* ---- List all institutions ---- */
router.get('/institutions', async (req, res) => {
  try {
    var { search, status, page = 1, limit = 20 } = req.query;
    var filter = {};
    if (status && status !== 'all') {
      if (status === 'suspended') { filter.isSuspended = true; }
      else { filter.status = status; filter.isSuspended = false; }
    }
    if (search) {
      filter.$or = [
        { name:       { $regex: search, $options: 'i' } },
        { email:      { $regex: search, $options: 'i' } },
        { ownerEmail: { $regex: search, $options: 'i' } }
      ];
    }
    var skip    = (parseInt(page) - 1) * parseInt(limit);
    var total   = await School.countDocuments(filter);
    var schools = await School.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit))
      .select('name email status subscriptionPlan subscriptionExpiry isSuspended trialUsed ownerEmail createdAt logo');

    var schoolsWithStats = await Promise.all(schools.map(async function(school) {
      var [teacherCount, examCount] = await Promise.all([
        SchoolUser.countDocuments({ schoolId: school._id, role: { $in: ['teacher','vice_principal'] }, isActive: true }),
        SchoolExam.countDocuments({ schoolId: school._id })
      ]);
      var daysLeft = 0;
      if (school.subscriptionExpiry) {
        daysLeft = Math.max(0, Math.ceil((new Date(school.subscriptionExpiry) - new Date()) / 86400000));
      }
      return { ...school.toObject(), teacherCount, examCount, daysLeft };
    }));

    return res.status(200).json({
      success: true, total,
      page: parseInt(page), pages: Math.ceil(total/parseInt(limit)),
      schools: schoolsWithStats
    });
  } catch (error) { return handleError(res, error, 'Error fetching institutions'); }
});

/* ---- Get single institution ---- */
router.get('/institutions/:id', async (req, res) => {
  try {
    var school = await School.findById(req.params.id);
    if (!school) return res.status(404).json({ success: false, message: 'Institution not found.' });

    var [teachers, exams, results, subscriptions, announcements] = await Promise.all([
      SchoolUser.find({ schoolId: school._id }).select('-googleId').sort({ role: 1, name: 1 }),
      SchoolExam.find({ schoolId: school._id }).sort({ createdAt: -1 }).limit(10)
        .select('title subject status totalAttempts createdAt'),
      SchoolResult.countDocuments({ schoolId: school._id }),
      Subscription.find({ schoolId: school._id }).sort({ createdAt: -1 }).limit(10),
      Announcement.find({ $or: [{ schoolId: school._id }, { schoolId: null }] }).sort({ createdAt: -1 }).limit(5)
    ]);

    var daysLeft = 0;
    if (school.subscriptionExpiry) {
      daysLeft = Math.max(0, Math.ceil((new Date(school.subscriptionExpiry) - new Date()) / 86400000));
    }
    return res.status(200).json({
      success: true, school, daysLeft,
      teachers, recentExams: exams, totalResults: results,
      subscriptions, announcements,
      stats: { teachers: teachers.filter(function(t) { return t.isActive; }).length, exams: exams.length, results }
    });
  } catch (error) { return handleError(res, error, 'Error fetching institution detail'); }
});

/* ---- Suspend institution ---- */
router.put('/institutions/:id/suspend', async (req, res) => {
  try {
    var { reason } = req.body;
    var school = await School.findByIdAndUpdate(req.params.id,
      { $set: { isSuspended: true, suspendReason: reason || 'Suspended by admin', status: 'suspended' } },
      { new: true }
    );
    if (!school) return res.status(404).json({ success: false, message: 'Institution not found.' });
    return res.status(200).json({ success: true, message: school.name + ' has been suspended.', school });
  } catch (error) { return handleError(res, error, 'Error suspending institution'); }
});

/* ---- Activate institution ---- */
router.put('/institutions/:id/activate', async (req, res) => {
  try {
    var school = await School.findById(req.params.id);
    if (!school) return res.status(404).json({ success: false, message: 'Institution not found.' });
    var newStatus = 'active';
    if (school.subscriptionExpiry && new Date(school.subscriptionExpiry) < new Date()) newStatus = 'expired';
    else if (school.subscriptionPlan === 'trial') newStatus = 'trial';
    var updated = await School.findByIdAndUpdate(req.params.id,
      { $set: { isSuspended: false, suspendReason: '', status: newStatus } },
      { new: true }
    );
    return res.status(200).json({ success: true, message: updated.name + ' has been activated.', school: updated });
  } catch (error) { return handleError(res, error, 'Error activating institution'); }
});

/* ---- Delete institution and all data ---- */
router.delete('/institutions/:id', async (req, res) => {
  try {
    var school = await School.findById(req.params.id);
    if (!school) return res.status(404).json({ success: false, message: 'Institution not found.' });
    var name = school.name;
    await Promise.all([
      SchoolUser.deleteMany({ schoolId: req.params.id }),
      SchoolExam.deleteMany({ schoolId: req.params.id }),
      SchoolResult.deleteMany({ schoolId: req.params.id }),
      Subscription.deleteMany({ schoolId: req.params.id }),
      Announcement.deleteMany({ schoolId: req.params.id })
    ]);
    await School.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: name + ' and all its data have been permanently deleted.' });
  } catch (error) { return handleError(res, error, 'Error deleting institution'); }
});

/* ---- Manage subscription ---- */
router.put('/institutions/:id/subscription', async (req, res) => {
  try {
    var { action, days, plan, note } = req.body;
    var school = await School.findById(req.params.id);
    if (!school) return res.status(404).json({ success: false, message: 'Institution not found.' });
    var now = new Date(); var message = '';

    if (action === 'add_days') {
      var daysToAdd = parseInt(days) || 7;
      var base = (school.subscriptionExpiry && school.subscriptionExpiry > now)
        ? new Date(school.subscriptionExpiry) : now;
      school.subscriptionExpiry = new Date(base.getTime() + daysToAdd * 86400000);
      school.status = 'active'; school.isSuspended = false;
      message = daysToAdd + ' days added. New expiry: ' + school.subscriptionExpiry.toDateString();
      await Subscription.create({
        schoolId: school._id, plan: school.subscriptionPlan || 'admin_grant',
        planName: 'Admin Grant (+' + daysToAdd + ' days)', amount: 0,
        startDate: now, endDate: school.subscriptionExpiry,
        status: 'active', activatedBy: 'admin', paidAt: now, paidAmount: 0,
        notes: note || 'Added by admin'
      });
    } else if (action === 'expire') {
      school.subscriptionExpiry = new Date(now.getTime() - 1000);
      school.status = 'expired';
      message = school.name + '\'s subscription has been manually expired.';
    } else if (action === 'grant_unlimited') {
      school.subscriptionExpiry = new Date('2099-12-31');
      school.status = 'active'; school.isSuspended = false;
      if (plan) school.subscriptionPlan = plan;
      message = 'Unlimited access granted until 2099.';
      await Subscription.create({
        schoolId: school._id, plan: 'unlimited', planName: 'Unlimited (Admin Grant)',
        amount: 0, startDate: now, endDate: school.subscriptionExpiry,
        status: 'active', activatedBy: 'admin', paidAt: now, paidAmount: 0,
        notes: note || 'Unlimited access granted by admin'
      });
    } else if (action === 'set_plan') {
      if (plan) { school.subscriptionPlan = plan; message = 'Plan updated to ' + plan + '.'; }
    } else {
      return res.status(400).json({ success: false, message: 'Invalid action.' });
    }

    await school.save();
    return res.status(200).json({ success: true, message, school, subscriptionExpiry: school.subscriptionExpiry, status: school.status });
  } catch (error) { return handleError(res, error, 'Error managing subscription'); }
});

/* ============================================
   SUBSCRIPTION PLAN MANAGEMENT
============================================ */
router.get('/subscription-plans', async (req, res) => {
  try {
    var plans = await SubscriptionPlan.find({}).sort({ sortOrder: 1 });
    return res.status(200).json({ success: true, plans });
  } catch (error) { return handleError(res, error, 'Error fetching plans'); }
});

router.post('/subscription-plans', async (req, res) => {
  try {
    var { name, code, price, durationDays, maxTeachers, maxStudents, maxExams, features, isPopular, sortOrder } = req.body;
    if (!name || !code || price === undefined || !durationDays) {
      return res.status(400).json({ success: false, message: 'name, code, price, and durationDays are required.' });
    }
    var existing = await SubscriptionPlan.findOne({ code: code.toLowerCase() });
    if (existing) return res.status(400).json({ success: false, message: 'Plan code already exists.' });
    var plan = await SubscriptionPlan.create({
      name, code: code.toLowerCase().trim(), price: Number(price),
      durationDays: Number(durationDays),
      maxTeachers: maxTeachers !== undefined ? Number(maxTeachers) : 20,
      maxStudents: maxStudents !== undefined ? Number(maxStudents) : 500,
      maxExams:    maxExams    !== undefined ? Number(maxExams)    : -1,
      features: Array.isArray(features) ? features : [],
      isPopular: isPopular || false, sortOrder: sortOrder || 0, isActive: true
    });
    return res.status(201).json({ success: true, message: 'Plan created successfully.', plan });
  } catch (error) { return handleError(res, error, 'Error creating plan'); }
});

router.put('/subscription-plans/:id', async (req, res) => {
  try {
    var allowed = ['name','price','durationDays','maxTeachers','maxStudents','maxExams','features','isPopular','sortOrder','isActive'];
    var updates = {};
    allowed.forEach(function(field) { if (req.body[field] !== undefined) updates[field] = req.body[field]; });
    var plan = await SubscriptionPlan.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true });
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found.' });
    return res.status(200).json({ success: true, message: 'Plan updated. Changes apply immediately platform-wide.', plan });
  } catch (error) { return handleError(res, error, 'Error updating plan'); }
});

router.put('/subscription-plans/:id/toggle', async (req, res) => {
  try {
    var plan = await SubscriptionPlan.findById(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found.' });
    plan.isActive = !plan.isActive;
    await plan.save();
    return res.status(200).json({ success: true, message: plan.name + ' is now ' + (plan.isActive ? 'enabled' : 'disabled') + '.', plan });
  } catch (error) { return handleError(res, error, 'Error toggling plan'); }
});

router.delete('/subscription-plans/:id', async (req, res) => {
  try {
    var plan = await SubscriptionPlan.findByIdAndDelete(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found.' });
    return res.status(200).json({ success: true, message: 'Plan "' + plan.name + '" deleted.' });
  } catch (error) { return handleError(res, error, 'Error deleting plan'); }
});

module.exports = router;