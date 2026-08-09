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

/* ✅ ECE PHASE 6 QIE — Institution Paper question import */
var multer     = require('multer');
var qieUpload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
var qieHelpers = require('../../platform/utils/qie.helpers');

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

/* ============================================
   ECE PHASE 6 — QIE ROUTES (INSTITUTION PAPER)
   Target model: PaperQuestion

   POST /exams/:id/questions/import/preview
   POST /exams/:id/questions/import/confirm
   GET  /exams/:id/questions/export
   GET  /questions/import-template
============================================ */

router.post(
  '/exams/:id/questions/import/preview',
  guard,
  qieUpload.single('file'),
  async (req, res) => {
    try {
      var exam = await PaperExam.findOne({ _id: req.params.id, schoolId: req.schoolId });
      if (!exam) { return res.status(404).json({ success: false, message: 'Paper exam not found.' }); }

      var rawQuestions = [];

      if (req.file) {
        var parseResult = await qieHelpers.parseFileBuffer(req.file.buffer, req.file.originalname);
        if (!parseResult.valid.length && parseResult.rejected.length > 0) {
          return res.status(400).json({ success: false, message: parseResult.rejected[0].reason });
        }
        rawQuestions = parseResult.valid;
      } else if (req.body.text) {
        rawQuestions = qieHelpers.parseCSVText(req.body.text);
      } else if (Array.isArray(req.body.questions)) {
        rawQuestions = req.body.questions;
      } else {
        return res.status(400).json({ success: false, message: 'Send a file, text, or questions array.' });
      }

      var validated = qieHelpers.validateQuestions(rawQuestions);
      return res.json({
        success: true,
        preview: {
          valid:    validated.valid,
          rejected: validated.rejected,
          stats: {
            detected: rawQuestions.length,
            valid:    validated.valid.length,
            rejected: validated.rejected.length
          }
        }
      });
    } catch (err) {
      console.error('[QIE inst-paper] preview:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

router.post('/exams/:id/questions/import/confirm', guard, async (req, res) => {
  try {
    var exam = await PaperExam.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!exam) { return res.status(404).json({ success: false, message: 'Paper exam not found.' }); }
    if (exam.status === 'finalized') {
      return res.status(400).json({ success: false, message: 'Cannot import questions into a finalized exam. Revert to draft first.' });
    }

    var questions = req.body.questions;
    if (!Array.isArray(questions) || !questions.length) {
      return res.status(400).json({ success: false, message: 'No questions to import. Run preview first.' });
    }

    var lastQ     = await PaperQuestion.findOne({ examId: exam._id }).sort({ sortOrder: -1 }).select('sortOrder').lean();
    var startSort = lastQ ? (lastQ.sortOrder + 1) : 0;
    var section   = (req.body.section || '').trim();  /* optional bulk section assignment */

    var docs = questions.map(function (q, i) {
      return {
        schoolId:        req.schoolId,
        examId:          exam._id,
        questionType:    q.questionType  || 'objective',
        question:        q.question,
        options:         q.options       || [],
        correctAnswer:   typeof q.correctAnswer === 'number' ? q.correctAnswer : 0,
        modelAnswer:     '',
        markScheme:      '',
        marks:           1,
        difficulty:      q.difficulty    || 'medium',
        topic:           q.topic         || '',
        imageUrl:        '',
        tableHtml:       '',
        section:         section,
        answerSpaceLines:4,
        sortOrder:       startSort + i
      };
    });

    var imported = 0;
    try {
      var insertResult = await PaperQuestion.insertMany(docs, { ordered: false });
      imported = insertResult.length;
    } catch (insertErr) {
      imported = insertErr.insertedDocs ? insertErr.insertedDocs.length : 0;
    }

    var qCount = await PaperQuestion.countDocuments({ examId: exam._id, isActive: true });
    await PaperExam.findByIdAndUpdate(exam._id, { totalQuestions: qCount });

    return res.json({
      success:  true,
      message:  imported + ' question' + (imported !== 1 ? 's' : '') + ' imported.',
      imported: imported,
      total:    docs.length
    });
  } catch (err) {
    console.error('[QIE inst-paper] confirm:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/exams/:id/questions/export', guard, async (req, res) => {
  try {
    var exam = await PaperExam.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!exam) { return res.status(404).json({ success: false, message: 'Paper exam not found.' }); }

    var questions = await PaperQuestion.find({ examId: exam._id, isActive: true }).sort({ sortOrder: 1 });
    var LETTERS   = ['A', 'B', 'C', 'D', 'E'];
    var rows      = ['question,option_a,option_b,option_c,option_d,correct_answer,explanation,difficulty,topic,section'];

    questions.forEach(function (q) {
      var opts = q.options || [];
      rows.push([
        qieHelpers.csvCell(q.question),
        qieHelpers.csvCell(opts[0] || ''),
        qieHelpers.csvCell(opts[1] || ''),
        qieHelpers.csvCell(opts[2] || ''),
        qieHelpers.csvCell(opts[3] || ''),
        LETTERS[q.correctAnswer] || 'A',
        qieHelpers.csvCell(q.modelAnswer || ''),
        q.difficulty || 'medium',
        qieHelpers.csvCell(q.topic    || ''),
        qieHelpers.csvCell(q.section  || '')
      ].join(','));
    });

    var filename = (exam.title || 'paper').replace(/[^a-z0-9]/gi, '_') + '_export.csv';
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    return res.send(rows.join('\n'));
  } catch (err) {
    console.error('[QIE inst-paper] export:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/questions/import-template', guard, function (req, res) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="paper_question_template.csv"');
  return res.send(qieHelpers.TEMPLATE_CSV);
});

module.exports = router;