/* ============================================
   LATLOMP INSTITUTION — PAPER EXAM ROUTES
   ✅ PHASE K.2: Paper Exam System (backend CRUD)

   Mirrors inst.teacher.routes.js auth pattern exactly:
     guard = [instProtect, teacherOrAdmin, requireActiveSubscription]

   This file is fully independent of inst.teacher.routes.js
   (CBT exams) and inst.student.routes.js (CBT student
   access). Nothing here touches those flows.

   PaperExam has no access code and no activation window —
   it is printed/exported, not accessed live by students.
============================================ */
'use strict';

const express        = require('express');
const router         = express.Router();
const PaperExam      = require('../models/PaperExam.model');
const PaperQuestion  = require('../models/PaperQuestion.model');

const { instProtect, teacherOrAdmin } = require('../middleware/inst.auth');
const { requireActiveSubscription }   = require('../middleware/inst.tenant');

var guard = [instProtect, teacherOrAdmin, requireActiveSubscription];

/* ============================================
   POST /exams
   Create a new paper exam (status: draft)
============================================ */
router.post('/exams', guard, async (req, res) => {
  try {
    var body = req.body || {};

    if (!body.title || !body.title.trim()) {
      return res.status(400).json({ success: false, message: 'Exam title is required.' });
    }
    if (!body.subject || !body.subject.trim()) {
      return res.status(400).json({ success: false, message: 'Subject is required.' });
    }

    var exam = await PaperExam.create({
      schoolId:      req.schoolId,
      createdBy:     req.schoolUser._id,
      title:         body.title.trim(),
      subject:       body.subject.trim(),
      class:         body.class         || '',
      term:          body.term          || '',
      session:       body.session       || '',
      examYear:      parseInt(body.examYear) || new Date().getFullYear(),
      classId:       body.classId       || null,
      subjectId:     body.subjectId     || null,
      termId:        body.termId        || null,
      paperType:     body.paperType     || 'mixed',
      instructions:  body.instructions  || '',
      duration:      parseInt(body.duration)   || 60,
      totalMarks:    parseInt(body.totalMarks) || 100,
      markingScheme: body.markingScheme || '',
      status:        'draft'
    });

    return res.status(201).json({ success: true, message: 'Paper exam created.', exam: exam });
  } catch (err) {
    console.error('[inst.paper] POST /exams:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /exams
   List paper exams (teacher sees own, admin sees all)
============================================ */
router.get('/exams', guard, async (req, res) => {
  try {
    var filter = { schoolId: req.schoolId };
    if (req.schoolUser.role === 'teacher') {
      filter.createdBy = req.schoolUser._id;
    }

    var exams = await PaperExam.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, exams: exams });
  } catch (err) {
    console.error('[inst.paper] GET /exams:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /exams/:id
   Single exam with all its questions
============================================ */
router.get('/exams/:id', guard, async (req, res) => {
  try {
    var exam = await PaperExam.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Paper exam not found.' });
    }

    var questions = await PaperQuestion.find({ examId: exam._id, isActive: true })
      .sort({ sortOrder: 1 });

    return res.status(200).json({
      success:       true,
      exam:          exam,
      questions:     questions,
      questionCount: questions.length
    });
  } catch (err) {
    console.error('[inst.paper] GET /exams/:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /exams/:id
   Update exam — blocked once finalized
============================================ */
router.put('/exams/:id', guard, async (req, res) => {
  try {
    var exam = await PaperExam.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Paper exam not found.' });
    }
    if (exam.status === 'finalized') {
      return res.status(400).json({ success: false, message: 'Cannot edit a finalized exam. Revert to draft first if changes are needed.' });
    }

    var fields = [
      'title', 'subject', 'class', 'term', 'session', 'examYear',
      'classId', 'subjectId', 'termId', 'paperType',
      'instructions', 'duration', 'totalMarks', 'markingScheme'
    ];
    fields.forEach(function (f) {
      if (req.body[f] !== undefined) { exam[f] = req.body[f]; }
    });

    await exam.save();
    return res.status(200).json({ success: true, message: 'Paper exam updated.', exam: exam });
  } catch (err) {
    console.error('[inst.paper] PUT /exams/:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /exams/:id/finalize
   Lock the exam — required before PDF export (K.4)
============================================ */
router.post('/exams/:id/finalize', guard, async (req, res) => {
  try {
    var exam = await PaperExam.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Paper exam not found.' });
    }

    var qCount = await PaperQuestion.countDocuments({ examId: exam._id, isActive: true });
    if (qCount === 0) {
      return res.status(400).json({ success: false, message: 'Cannot finalize an exam with no questions.' });
    }

    exam.status         = 'finalized';
    exam.totalQuestions = qCount;
    await exam.save();

    return res.status(200).json({ success: true, message: 'Paper exam finalized. It is now ready to export or print.', exam: exam });
  } catch (err) {
    console.error('[inst.paper] POST /exams/:id/finalize:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /exams/:id/revert-draft
   Unlock a finalized exam for further editing
============================================ */
router.post('/exams/:id/revert-draft', guard, async (req, res) => {
  try {
    var exam = await PaperExam.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: { status: 'draft' } },
      { new: true }
    );
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Paper exam not found.' });
    }
    return res.status(200).json({ success: true, message: 'Exam reverted to draft. You can edit it again.', exam: exam });
  } catch (err) {
    console.error('[inst.paper] POST /exams/:id/revert-draft:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   DELETE /exams/:id
   Only allowed while in draft status
============================================ */
router.delete('/exams/:id', guard, async (req, res) => {
  try {
    var exam = await PaperExam.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Paper exam not found.' });
    }
    if (exam.status === 'finalized') {
      return res.status(400).json({ success: false, message: 'Cannot delete a finalized exam. Archive it instead.' });
    }

    await PaperQuestion.deleteMany({ examId: exam._id });
    await PaperExam.findByIdAndDelete(exam._id);

    return res.status(200).json({ success: true, message: 'Paper exam deleted.' });
  } catch (err) {
    console.error('[inst.paper] DELETE /exams/:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /exams/:id/questions
   Add a question to a paper exam
============================================ */
router.post('/exams/:id/questions', guard, async (req, res) => {
  try {
    var exam = await PaperExam.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Paper exam not found.' });
    }
    if (exam.status === 'finalized') {
      return res.status(400).json({ success: false, message: 'Cannot add questions to a finalized exam. Revert to draft first.' });
    }

    var body = req.body || {};
    if (!body.question || !body.question.trim()) {
      return res.status(400).json({ success: false, message: 'Question text is required.' });
    }

    var safeTableHtml = '';
    if (body.tableHtml && typeof body.tableHtml === 'string') {
      safeTableHtml = body.tableHtml
        .replace(/<script[^>]*>.*?<\/script>/gi, '')
        .replace(/on\w+="[^"]*"/gi, '')
        .replace(/javascript:/gi, '');
    }

    var lastQuestion = await PaperQuestion.findOne({ examId: exam._id }).sort({ sortOrder: -1 });
    var nextSort     = lastQuestion ? (lastQuestion.sortOrder + 1) : 0;

    var q = await PaperQuestion.create({
      schoolId:        req.schoolId,
      examId:          exam._id,
      questionType:    body.questionType    || 'objective',
      question:        body.question.trim(),
      options:         body.options         || [],
      correctAnswer:   parseInt(body.correctAnswer) || 0,
      modelAnswer:      body.modelAnswer    || '',
      markScheme:       body.markScheme     || '',
      imageUrl:         body.imageUrl       || '',
      tableHtml:        safeTableHtml,
      marks:            parseInt(body.marks) || 1,
      difficulty:       body.difficulty     || 'medium',
      topic:            body.topic          || '',
      section:          body.section        || '',
      answerSpaceLines: parseInt(body.answerSpaceLines) || 4,
      sortOrder:        nextSort
    });

    var qCount = await PaperQuestion.countDocuments({ examId: exam._id, isActive: true });
    await PaperExam.findByIdAndUpdate(exam._id, { totalQuestions: qCount });

    return res.status(201).json({ success: true, message: 'Question added.', question: q });
  } catch (err) {
    console.error('[inst.paper] POST /exams/:id/questions:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /questions/:id
   Update a question
============================================ */
router.put('/questions/:id', guard, async (req, res) => {
  try {
    var allowed = [
      'questionType', 'question', 'options', 'correctAnswer',
      'modelAnswer', 'markScheme', 'imageUrl', 'tableHtml',
      'marks', 'difficulty', 'topic', 'section',
      'answerSpaceLines', 'sortOrder'
    ];
    var updates = {};
    allowed.forEach(function (f) {
      if (req.body[f] !== undefined) { updates[f] = req.body[f]; }
    });

    if (updates.tableHtml) {
      updates.tableHtml = updates.tableHtml
        .replace(/<script[^>]*>.*?<\/script>/gi, '')
        .replace(/on\w+="[^"]*"/gi, '')
        .replace(/javascript:/gi, '');
    }

    var q = await PaperQuestion.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: updates },
      { new: true }
    );
    if (!q) {
      return res.status(404).json({ success: false, message: 'Question not found.' });
    }

    return res.status(200).json({ success: true, message: 'Question updated.', question: q });
  } catch (err) {
    console.error('[inst.paper] PUT /questions/:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   DELETE /questions/:id
============================================ */
router.delete('/questions/:id', guard, async (req, res) => {
  try {
    var q = await PaperQuestion.findOneAndDelete({ _id: req.params.id, schoolId: req.schoolId });
    if (q) {
      var qCount = await PaperQuestion.countDocuments({ examId: q.examId, isActive: true });
      await PaperExam.findByIdAndUpdate(q.examId, { totalQuestions: qCount });
    }
    return res.status(200).json({ success: true, message: 'Question deleted.' });
  } catch (err) {
    console.error('[inst.paper] DELETE /questions/:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;