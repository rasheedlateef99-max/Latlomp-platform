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

/* ✅ ECE PHASE 6 QIE — Teacher question import.
   protect + teacherOnly are applied by router.use() above
   so no additional auth needed on these routes. */
var multer     = require('multer');
var qieUpload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
var qieHelpers = require('../platform/utils/qie.helpers');

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

/* ============================================
   ECE PHASE 6 — QIE ROUTES (TEACHER PLATFORM)
   Target model: TeacherQuestion

   CRITICAL: TeacherQuestion uses 'questionText'
   NOT 'question'. The QIE parser returns 'question'.
   This file remaps: q.question → questionText.

   Tenant isolation: teacherId: req.user.id
   Auth: router.use(protect) + router.use(teacherOnly)
   covers all routes — no extra guard needed.

   POST /exams/:id/questions/import/preview
   POST /exams/:id/questions/import/confirm
   GET  /exams/:id/questions/export
   GET  /questions/import-template
============================================ */

router.post(
  '/exams/:id/questions/import/preview',
  qieUpload.single('file'),
  async (req, res) => {
    try {
      /* ✅ Teacher isolation: only the owner can import into their exam */
      var exam = await TeacherExam.findOne({ _id: req.params.id, teacherId: req.user.id });
      if (!exam) { return res.status(404).json({ success: false, message: 'Exam not found.' }); }

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

      /* Apply exam type filter: if exam is 'objective', flag theory questions */
      var validated = qieHelpers.validateQuestions(rawQuestions);

      if (exam.examType === 'objective') {
        validated.rejected = validated.rejected.concat(
          validated.valid.filter(function (q) { return q.questionType === 'theory'; })
            .map(function (q) { return { question: q.question, reason: 'This exam only accepts objective questions.' }; })
        );
        validated.valid = validated.valid.filter(function (q) { return q.questionType !== 'theory'; });
      } else if (exam.examType === 'theory') {
        validated.valid = validated.valid.map(function (q) {
          return Object.assign({}, q, { questionType: 'theory', options: [] });
        });
      }

      return res.json({
        success: true,
        preview: {
          valid:    validated.valid,
          rejected: validated.rejected,
          stats: {
            detected: rawQuestions.length,
            valid:    validated.valid.length,
            rejected: validated.rejected.length
          },
          examType: exam.examType  /* client uses this to show appropriate preview columns */
        }
      });
    } catch (err) {
      console.error('[QIE teacher] preview:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

router.post('/exams/:id/questions/import/confirm', async (req, res) => {
  try {
    var exam = await TeacherExam.findOne({ _id: req.params.id, teacherId: req.user.id });
    if (!exam) { return res.status(404).json({ success: false, message: 'Exam not found.' }); }
    if (!exam.isActive) {
      return res.status(400).json({ success: false, message: 'Cannot import into an inactive exam.' });
    }

    var questions = req.body.questions;
    if (!Array.isArray(questions) || !questions.length) {
      return res.status(400).json({ success: false, message: 'No questions to import. Run preview first.' });
    }

    var existingCount = await TeacherQuestion.countDocuments({ examId: req.params.id });

    var docs = questions.map(function (q, i) {
      var isTheory  = q.questionType === 'theory' || exam.examType === 'theory';
      return {
        examId:         req.params.id,
        questionType:   isTheory ? 'theory' : 'objective',
        /* ✅ CRITICAL REMAP: parser returns 'question', model needs 'questionText' */
        questionText:   q.question,
        options:        isTheory ? [] : (q.options || []),
        correctAnswer:  isTheory ? null : (typeof q.correctAnswer === 'number' ? q.correctAnswer : 0),
        expectedAnswer: isTheory ? (q.explanation || '') : '',
        marks:          1,
        orderNumber:    existingCount + i + 1
      };
    });

    var imported = 0;
    try {
      var insertResult = await TeacherQuestion.insertMany(docs, { ordered: false });
      imported = insertResult.length;
    } catch (insertErr) {
      imported = insertErr.insertedDocs ? insertErr.insertedDocs.length : 0;
    }

    await ActivityLog.record({
      userId:      req.user.id,
      userName:    req.user.name  || 'Teacher',
      userEmail:   req.user.email || '',
      userRole:    'teacher',
      action:      'teacher_questions_imported',
      description: 'Teacher imported ' + imported + ' questions into exam "' + exam.title + '"',
      metadata:    { examId: exam._id, examTitle: exam.title, imported: imported }
    });

    return res.json({
      success:  true,
      message:  imported + ' question' + (imported !== 1 ? 's' : '') + ' imported.',
      imported: imported,
      total:    docs.length
    });
  } catch (err) {
    console.error('[QIE teacher] confirm:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/exams/:id/questions/export', async (req, res) => {
  try {
    var exam = await TeacherExam.findOne({ _id: req.params.id, teacherId: req.user.id });
    if (!exam) { return res.status(404).json({ success: false, message: 'Exam not found.' }); }

    var questions = await TeacherQuestion.find({ examId: req.params.id }).sort({ orderNumber: 1 });
    var LETTERS   = ['A', 'B', 'C', 'D', 'E'];
    var rows      = ['question,option_a,option_b,option_c,option_d,correct_answer,expected_answer,marks'];

    questions.forEach(function (q) {
      var opts = q.options || [];
      var ca   = q.questionType === 'objective' ? (LETTERS[q.correctAnswer] || 'A') : '';
      rows.push([
        qieHelpers.csvCell(q.questionText || q.question || ''),
        qieHelpers.csvCell(opts[0] || ''),
        qieHelpers.csvCell(opts[1] || ''),
        qieHelpers.csvCell(opts[2] || ''),
        qieHelpers.csvCell(opts[3] || ''),
        ca,
        qieHelpers.csvCell(q.expectedAnswer || ''),
        q.marks || 1
      ].join(','));
    });

    var filename = (exam.title || 'questions').replace(/[^a-z0-9]/gi, '_') + '_export.csv';
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    return res.send(rows.join('\n'));
  } catch (err) {
    console.error('[QIE teacher] export:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /questions/import-template
   Must be before any /questions/:id routes to avoid CastError.
   In teacher.routes.js the only /questions/:id routes are
   PUT and DELETE — different HTTP methods — so no conflict. */
router.get('/questions/import-template', function (req, res) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="teacher_question_template.csv"');
  return res.send(qieHelpers.TEMPLATE_CSV);
});

/* ============================================
   ✅ STEP 4 — TEACHER ECE CONFIG ROUTES
   protect + teacherOnly already applied via
   router.use() above — no extra guard needed.

   GET  /api/teacher/ece-config  → load config
   PUT  /api/teacher/ece-config  → save config
============================================ */
router.get('/ece-config', async (req, res) => {
  try {
    var ECEConfig = require('../ece/models/ECEConfig.model');
    var config    = await ECEConfig.getOrCreate(
      'teacher',
      req.user.id,
      req.user.name || 'Teacher'
    );
    return res.json({ success: true, config: config.toClientObject() });
  } catch (err) {
    console.error('[ECE teacher] GET /ece-config:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/ece-config', async (req, res) => {
  try {
    var ECEConfig = require('../ece/models/ECEConfig.model');
    var newCaps   = req.body.capabilities;

    if (!newCaps || typeof newCaps !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'capabilities object is required.'
      });
    }

    /* Respect root-admin global availability — silently downgrade blocked caps */
    var globalCfg   = await ECEConfig.findOne({ scope: 'cbt', scopeId: null }).lean();
    var globalAvail = (globalCfg && globalCfg.globalAvailability) ? globalCfg.globalAvailability : {};

    var config = await ECEConfig.getOrCreate(
      'teacher',
      req.user.id,
      req.user.name || 'Teacher'
    );

    Object.keys(newCaps).forEach(function (group) {
      if (typeof newCaps[group] !== 'object') { return; }
      if (!config.capabilities[group]) { config.capabilities[group] = {}; }
      Object.keys(newCaps[group]).forEach(function (key) {
        var val = newCaps[group][key];
        if (globalAvail[key] === false && val === true) { val = false; }
        config.capabilities[group][key] = val;
      });
    });

    config.lastModifiedBy = req.user.name || 'teacher';
    config.lastModifiedAt = new Date();
    config.markModified('capabilities');
    await config.save();

    return res.json({
      success: true,
      message: 'ECE configuration saved.',
      config:  config.toClientObject()
    });
  } catch (err) {
    console.error('[ECE teacher] PUT /ece-config:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;