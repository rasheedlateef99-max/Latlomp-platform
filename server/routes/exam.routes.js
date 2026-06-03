/* ============================================
   EXAM ROUTES — LatLomp Platform
   
   KEPT:  All student-facing routes
          All dept/subject/question CRUD
   
   REMOVED: Legacy admin exam create/update/delete
            (replaced by subject-based CBT system)
============================================ */

const express    = require('express');
const router     = express.Router();
const Exam       = require('../models/Exam.model');
const Question   = require('../models/Question.model');
const Result     = require('../models/Result.model');
const User       = require('../models/User.model');
const Department = require('../models/Department.model');
const Subject    = require('../models/Subject.model');
const { protect, adminOnly } = require('../middleware/auth.middleware');

function normalizeDifficulty(val) {
  var map = { 'easy':'Easy', 'Easy':'Easy', 'medium':'Medium', 'Medium':'Medium', 'hard':'Hard', 'Hard':'Hard', 'mixed':'Mixed', 'Mixed':'Mixed' };
  return map[val] || 'Mixed';
}

function shuffleArray(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

/* ============================================
   PUBLIC — Student routes
============================================ */

router.get('/', async (req, res) => {
  try {
    const exams = await Exam.find({ isActive: true }).select('-createdBy').sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: exams.length, exams });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching exams' });
  }
});

/* ⚠️ Must be before /:id */
router.get('/results/history', protect, async (req, res) => {
  try {
    const results = await Result.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(20);
    return res.status(200).json({ success: true, count: results.length, results });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching results' });
  }
});

/* ⚠️ Must be before /:id */
router.get('/results/:id', protect, async (req, res) => {
  try {
    const result = await Result.findById(req.params.id);
    if (!result) return res.status(404).json({ success: false, message: 'Result not found' });
    if (result.userId.toString() !== req.user.id)
      return res.status(403).json({ success: false, message: 'Access denied' });
    return res.status(200).json({ success: true, result });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching result' });
  }
});

/* ============================================
   ADMIN — Department CRUD
   ⚠️ All /admin/* before /:id
============================================ */

/* NEW — supports ?examCategory=jamb filter: */
router.get('/admin/departments', protect, adminOnly, async (req, res) => {
  try {
    var filter = {};
    if (req.query.examCategory) filter.examCategory = req.query.examCategory;

    const depts = await Department.find(filter).sort({ name: 1 });
    return res.status(200).json({ success: true, departments: depts });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/admin/departments', protect, adminOnly, async (req, res) => {
  try {
    var name     = (req.body.name         || '').trim();
    var category = (req.body.examCategory || '').trim();

    if (!name)     return res.status(400).json({ success: false, message: 'Department name is required.' });
    if (!category) return res.status(400).json({ success: false, message: 'Exam category is required.' });

    const dept = await Department.create({
      name:         name,
      examCategory: category,
      description:  (req.body.description || '').trim(),
      isActive:     req.body.isActive !== false,
      createdBy:    req.user.id
    });

    return res.status(201).json({ success: true, message: 'Department created.', department: dept });
  } catch (error) {
    if (error.code === 11000)
      return res.status(400).json({ success: false, message: 'A department with this name already exists in this category.' });
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/admin/departments/:id', protect, adminOnly, async (req, res) => {
  try {
    var updates = {};
    if (req.body.name        !== undefined) updates.name        = req.body.name.trim();
    if (req.body.description !== undefined) updates.description = req.body.description.trim();
    if (req.body.isActive    !== undefined) updates.isActive    = req.body.isActive !== false;
    const dept = await Department.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
    if (!dept) return res.status(404).json({ success: false, message: 'Department not found.' });
    return res.status(200).json({ success: true, message: 'Department updated.', department: dept });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/admin/departments/:id', protect, adminOnly, async (req, res) => {
  try {
    const subjectCount = await Subject.countDocuments({ department: req.params.id });
    if (subjectCount > 0)
      return res.status(400).json({ success: false, message: 'Cannot delete: ' + subjectCount + ' subjects belong to this department. Delete them first.' });
    await Department.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Department deleted.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* ============================================
   ADMIN — Subject CRUD
============================================ */

router.get('/admin/subjects', protect, adminOnly, async (req, res) => {
  try {
    var filter = {};
    if (req.query.department) filter.department = req.query.department;
    const subjects = await Subject.find(filter).populate('department', 'name').sort({ name: 1 });
    return res.status(200).json({ success: true, subjects });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/admin/subjects', protect, adminOnly, async (req, res) => {
  try {
    var name   = (req.body.name       || '').trim();
    var deptId = (req.body.department || '').trim();
    if (!name || !deptId)
      return res.status(400).json({ success: false, message: 'Subject name and department are required.' });

    const subject = await Subject.create({
      name:           name,
      department:     deptId,
      examCategories: Array.isArray(req.body.examCategories) ? req.body.examCategories : ['all'],
      timeLimit:      parseInt(req.body.timeLimit)    || 30,
      questionCount:  parseInt(req.body.questionCount) || 40,
      instructions:   (req.body.instructions || '').trim(),
      isActive:       req.body.isActive !== false,
      createdBy:      req.user.id
    });

    const populated = await Subject.findById(subject._id).populate('department', 'name');
    return res.status(201).json({ success: true, message: 'Subject created.', subject: populated });
  } catch (error) {
    if (error.code === 11000)
      return res.status(400).json({ success: false, message: 'This subject already exists in that department.' });
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/admin/subjects/:id', protect, adminOnly, async (req, res) => {
  try {
    var updates = {};
    if (req.body.name           !== undefined) updates.name           = req.body.name.trim();
    if (req.body.department     !== undefined) updates.department     = req.body.department;
    if (req.body.examCategories !== undefined) updates.examCategories = req.body.examCategories;
    if (req.body.timeLimit      !== undefined) updates.timeLimit      = parseInt(req.body.timeLimit);
    if (req.body.questionCount  !== undefined) updates.questionCount  = parseInt(req.body.questionCount);
    if (req.body.instructions   !== undefined) updates.instructions   = req.body.instructions.trim();
    if (req.body.isActive       !== undefined) updates.isActive       = req.body.isActive !== false;

    const subject = await Subject.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true }).populate('department', 'name');
    if (!subject) return res.status(404).json({ success: false, message: 'Subject not found.' });
    return res.status(200).json({ success: true, message: 'Subject updated.', subject });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/admin/subjects/:id', protect, adminOnly, async (req, res) => {
  try {
    const questionCount = await Question.countDocuments({ subjectId: req.params.id });
    if (questionCount > 0)
      return res.status(400).json({ success: false, message: questionCount + ' questions exist for this subject. Delete them first.' });
    await Subject.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Subject deleted.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* Subject questions */
router.get('/admin/subjects/:id/questions', protect, adminOnly, async (req, res) => {
  try {
    const questions = await Question.find({ subjectId: req.params.id }).sort({ createdAt: 1 });
    return res.status(200).json({ success: true, count: questions.length, questions });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/admin/subjects/:id/questions', protect, adminOnly, async (req, res) => {
  try {
    if (!req.body.question || !req.body.options || req.body.correctAnswer === undefined)
      return res.status(400).json({ success: false, message: 'Question, options, and correct answer are required.' });

    const subject = await Subject.findById(req.params.id);
    if (!subject) return res.status(404).json({ success: false, message: 'Subject not found.' });

    const question = await Question.create({
      subjectId:     req.params.id,
      examCategory:  req.body.examCategory || 'all',
      question:      req.body.question.trim(),
      options:       req.body.options,
      correctAnswer: parseInt(req.body.correctAnswer),
      explanation:   req.body.explanation || '',
      isActive:      true
    });

    await Subject.findByIdAndUpdate(req.params.id, { $inc: { totalQuestions: 1 } });

    return res.status(201).json({ success: true, message: 'Question added.', question });
  } catch (error) {
    console.error('Add question error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* Delete a question */
router.delete('/admin/questions/:id', protect, adminOnly, async (req, res) => {
  try {
    const question = await Question.findByIdAndDelete(req.params.id);
    if (question && question.subjectId)
      await Subject.findByIdAndUpdate(question.subjectId, { $inc: { totalQuestions: -1 } });
    return res.status(200).json({ success: true, message: 'Question deleted.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* ============================================
   PUBLIC — Department list (for student flow)
============================================ */
router.get('/departments', async (req, res) => {
  try {
    const departments = await Department.find({ isActive: true }).sort({ name: 1 });
    return res.status(200).json({ success: true, departments });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/subjects/by-department/:deptId', async (req, res) => {
  try {
    const subjects = await Subject.find({ department: req.params.deptId, isActive: true })
      .select('name timeLimit questionCount instructions examCategories')
      .sort({ name: 1 });
    return res.status(200).json({ success: true, subjects });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* ============================================
   STUDENT — Single exam + submit (legacy kept)
   ⚠️ Must be AFTER all /admin/* routes
============================================ */
router.get('/:id', async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });
    return res.status(200).json({ success: true, exam });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching exam' });
  }
});

router.get('/:id/questions', protect, async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });
    const questions = await Question.find({ examId: req.params.id, isActive: true }).select('-correctAnswer -explanation');
    const shuffled  = shuffleArray(questions.map(function(q) { return q.toObject(); }));
    return res.status(200).json({
      success: true,
      exam: { id: exam._id, title: exam.title, duration: exam.duration, instructions: exam.instructions, totalQuestions: shuffled.length },
      questions: shuffled
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching questions' });
  }
});

router.post('/:id/submit', protect, async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });

    const { answers, timeTaken, wasAutoSubmit } = req.body;
    if (!answers || typeof answers !== 'object')
      return res.status(400).json({ success: false, message: 'Please submit your answers' });

    const questions = await Question.find({ examId: req.params.id, isActive: true });
    let correctCount = 0;
    const gradedAnswers = questions.map(q => {
      const userAnswer = answers[q._id.toString()];
      const isCorrect  = userAnswer === q.correctAnswer;
      if (isCorrect) { correctCount++; Question.findByIdAndUpdate(q._id, { $inc: { timesAnswered:1, timesCorrect:1 } }).exec(); }
      else { Question.findByIdAndUpdate(q._id, { $inc: { timesAnswered:1 } }).exec(); }
      return { questionId:q._id, question:q.question, options:q.options, userAnswer:userAnswer!==undefined?userAnswer:null, correctAnswer:q.correctAnswer, isCorrect, explanation:q.explanation };
    });

    const totalQuestions = questions.length;
    const scorePercent   = totalQuestions > 0 ? Math.round((correctCount/totalQuestions)*100) : 0;
    const isPassed       = scorePercent >= exam.passMark;

    const result = await Result.create({
      userId:exam.createdBy||req.user.id, examId:exam._id, examTitle:exam.title,
      examType:exam.type, examSubject:exam.subject, score:correctCount, totalQuestions,
      scorePercent, passMark:exam.passMark, isPassed, timeTaken:timeTaken||0,
      timeAllowed:exam.duration, wasAutoSubmit:wasAutoSubmit||false, answers:gradedAnswers
    });

    await Exam.findByIdAndUpdate(exam._id, { $inc: { totalAttempts:1 } });

    const user = await User.findById(req.user.id);
    if (user && user.stats) {
      const newTotal = (user.stats.totalExamsTaken||0)+1;
      const newAvg   = Math.round((((user.stats.averageScore||0)*(user.stats.totalExamsTaken||0))+scorePercent)/newTotal);
      const newBest  = Math.max(user.stats.bestScore||0, scorePercent);
      await User.findByIdAndUpdate(req.user.id, { 'stats.totalExamsTaken':newTotal, 'stats.averageScore':newAvg, 'stats.bestScore':newBest });
    }

    return res.status(200).json({
      success:true, message:isPassed?'🎉 Congratulations! You passed!':'📚 Keep practicing!',
      result:{ id:result._id, score:correctCount, totalQuestions, scorePercent, isPassed, passMark:exam.passMark, timeTaken:timeTaken||0, gradedAnswers }
    });
  } catch (error) {
    console.error('Submit error:', error);
    return res.status(500).json({ success: false, message: 'Error submitting exam' });
  }
});

module.exports = router;