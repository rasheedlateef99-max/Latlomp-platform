/* ============================================
   LATLOMP INSTITUTION — TEACHER ROUTES
============================================ */
const express        = require('express');
const router         = express.Router();
const SchoolExam     = require('../models/SchoolExam.model');
const SchoolQuestion = require('../models/SchoolQuestion.model');
const SchoolResult   = require('../models/SchoolResult.model');
const SchoolStudent  = require('../models/SchoolStudent.model');
const { instProtect, teacherOrAdmin } = require('../middleware/inst.auth');
const { requireActiveSubscription }   = require('../middleware/inst.tenant');

var guard = [instProtect, teacherOrAdmin, requireActiveSubscription];

/* Fisher-Yates */
function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* ---- Create exam ---- */
router.post('/exams', guard, async (req, res) => {
  try {
    var exam = await SchoolExam.create({
      schoolId:  req.schoolId,
      createdBy: req.schoolUser._id,
      title:     req.body.title,
      subject:   req.body.subject,
      class:     req.body.class     || '',
      term:      req.body.term      || '',
      session:   req.body.session   || '',
      examType:  req.body.examType  || 'objective',
      instructions: req.body.instructions || '',
      duration:  parseInt(req.body.duration) || 60,
      totalMarks:parseInt(req.body.totalMarks) || 100,
      passMark:  parseInt(req.body.passMark)   || 50,
      shuffleQuestions: req.body.shuffleQuestions !== false,
      showResultsAfter: req.body.showResultsAfter || false,
      scheduledStart:   req.body.scheduledStart   || null,
      scheduledEnd:     req.body.scheduledEnd     || null,
      status: 'draft'
    });

    return res.status(201).json({ success: true, message: 'Exam created.', exam });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Get teacher's exams ---- */
router.get('/exams', guard, async (req, res) => {
  try {
    var filter = { schoolId: req.schoolId };

    /* Teachers see only their own exams */
    if (req.schoolUser.role === 'teacher') {
      filter.createdBy = req.schoolUser._id;
    }

    var exams = await SchoolExam.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, exams });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Get single exam with questions ---- */
router.get('/exams/:id', guard, async (req, res) => {
  try {
    var exam = await SchoolExam.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });

    var questions = await SchoolQuestion.find({ examId: exam._id, isActive: true }).sort({ sortOrder: 1 });
    return res.status(200).json({ success: true, exam, questions, questionCount: questions.length });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Update exam ---- */
router.put('/exams/:id', guard, async (req, res) => {
  try {
    var exam = await SchoolExam.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });

    if (exam.status === 'active') {
      return res.status(400).json({ success: false, message: 'Cannot edit an exam that is currently active.' });
    }

    var fields = ['title','subject','class','term','session','instructions','duration',
                  'totalMarks','passMark','shuffleQuestions','showResultsAfter',
                  'scheduledStart','scheduledEnd'];
    fields.forEach(function(f) { if (req.body[f] !== undefined) exam[f] = req.body[f]; });

    await exam.save();
    return res.status(200).json({ success: true, message: 'Exam updated.', exam });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Publish exam ---- */
router.post('/exams/:id/publish', guard, async (req, res) => {
  try {
    var exam = await SchoolExam.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });

    var qCount = await SchoolQuestion.countDocuments({ examId: exam._id, isActive: true });
    if (qCount === 0) {
      return res.status(400).json({ success: false, message: 'Cannot publish exam with no questions. Add questions first.' });
    }

    exam.status         = 'published';
    exam.totalQuestions = qCount;
    await exam.save();

    return res.status(200).json({
      success:    true,
      message:    'Exam published! Share code: ' + exam.accessCode,
      accessCode: exam.accessCode,
      exam
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- End exam ---- */
router.post('/exams/:id/end', guard, async (req, res) => {
  try {
    var exam = await SchoolExam.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: { status: 'ended' } },
      { new: true }
    );
    return res.status(200).json({ success: true, message: 'Exam ended.', exam });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Add question ---- */
router.post('/exams/:id/questions', guard, async (req, res) => {
  try {
    var exam = await SchoolExam.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });

    var { questionType, question, options, correctAnswer, explanation,
          modelAnswer, markScheme, marks, difficulty, topic, imageUrl } = req.body;

    var q = await SchoolQuestion.create({
      schoolId:     req.schoolId,
      examId:       exam._id,
      questionType: questionType || 'objective',
      question:     question,
      options:      options      || [],
      correctAnswer:parseInt(correctAnswer) || 0,
      explanation:  explanation  || '',
      modelAnswer:  modelAnswer  || '',
      markScheme:   markScheme   || '',
      marks:        parseInt(marks) || 1,
      difficulty:   difficulty   || 'medium',
      topic:        topic        || '',
      imageUrl:     imageUrl     || ''
    });

    /* Update exam question count */
    var qCount = await SchoolQuestion.countDocuments({ examId: exam._id, isActive: true });
    await SchoolExam.findByIdAndUpdate(exam._id, { totalQuestions: qCount });

    return res.status(201).json({ success: true, message: 'Question added.', question: q });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Delete question ---- */
router.delete('/questions/:id', guard, async (req, res) => {
  try {
    var q = await SchoolQuestion.findOneAndDelete({ _id: req.params.id, schoolId: req.schoolId });
    if (q) {
      var qCount = await SchoolQuestion.countDocuments({ examId: q.examId, isActive: true });
      await SchoolExam.findByIdAndUpdate(q.examId, { totalQuestions: qCount });
    }
    return res.status(200).json({ success: true, message: 'Question deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Get exam results (teacher view) ---- */
router.get('/exams/:id/results', guard, async (req, res) => {
  try {
    var exam = await SchoolExam.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });

    var results = await SchoolResult.find({ examId: exam._id })
      .select('-answers')
      .sort({ scorePercent: -1 });

    /* Summary stats */
    var total   = results.length;
    var passed  = results.filter(function(r) { return r.isPassed; }).length;
    var avgScore = total > 0
      ? Math.round(results.reduce(function(sum, r) { return sum + r.scorePercent; }, 0) / total)
      : 0;

    return res.status(200).json({
      success: true,
      exam,
      results,
      summary: {
        total,
        passed,
        failed:      total - passed,
        passRate:    total > 0 ? Math.round((passed / total) * 100) : 0,
        averageScore: avgScore,
        highestScore: results[0] ? results[0].scorePercent : 0
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Grade theory questions ---- */
router.post('/results/:id/grade', guard, async (req, res) => {
  try {
    var result = await SchoolResult.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!result) return res.status(404).json({ success: false, message: 'Result not found.' });

    var { grades } = req.body;
    /* grades = [{ questionId, marksAwarded, teacherComment }] */

    if (!Array.isArray(grades)) {
      return res.status(400).json({ success: false, message: 'Grades array is required.' });
    }

    var theoryScore = 0;

    grades.forEach(function(g) {
      var answer = result.answers.find(function(a) {
        return a.questionId && a.questionId.toString() === g.questionId;
      });
      if (answer) {
        answer.marksAwarded   = Math.max(0, parseInt(g.marksAwarded) || 0);
        answer.teacherComment = g.teacherComment || '';
        theoryScore          += answer.marksAwarded;
      }
    });

    result.theoryScore  = theoryScore;
    result.theoryMarked = true;
    result.markedBy     = req.schoolUser._id;
    result.markedAt     = new Date();

    /* Recalculate total score */
    var totalScore    = result.objectiveScore + theoryScore;
    result.score      = totalScore;
    result.scorePercent = result.totalMarks > 0
      ? Math.round((totalScore / result.totalMarks) * 100)
      : 0;
    result.isPassed   = result.scorePercent >= result.passMark;

    await result.save();
    return res.status(200).json({ success: true, message: 'Theory marked.', result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});


/* ---- Grade a specific result by ID ---- */
router.post('/results/:id/grade', guard, async (req, res) => {
  try {
    const SchoolResult = require('../models/SchoolResult.model');
    var result = await SchoolResult.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!result) return res.status(404).json({ success: false, message: 'Result not found.' });

    var { grades } = req.body;
    if (!Array.isArray(grades))
      return res.status(400).json({ success: false, message: 'Grades array is required.' });

    var theoryScore = 0;

    grades.forEach(function(g) {
      var answer = result.answers.find(function(a) {
        return a.questionId && a.questionId.toString() === g.questionId;
      });
      if (answer) {
        answer.marksAwarded   = Math.max(0, parseInt(g.marksAwarded) || 0);
        answer.teacherComment = g.teacherComment || '';
        theoryScore          += answer.marksAwarded;
      }
    });

    result.theoryScore  = theoryScore;
    result.theoryMarked = true;
    result.markedBy     = req.schoolUser._id;
    result.markedAt     = new Date();

    var totalScore      = result.objectiveScore + theoryScore;
    result.score        = totalScore;
    result.scorePercent = result.totalMarks > 0
      ? Math.round((totalScore / result.totalMarks) * 100) : 0;
    result.isPassed     = result.scorePercent >= result.passMark;

    await result.save();
    return res.status(200).json({ success: true, message: 'Grades submitted.', result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;