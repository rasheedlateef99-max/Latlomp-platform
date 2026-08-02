/* ============================================
   LATLOMP PLATFORM — QMS ROUTES

   POST /api/qms/import/preview        — parse + validate (no DB write)
   POST /api/qms/import/preview/file   — file upload variant
   POST /api/qms/import/confirm        — save to Question Bank
   GET  /api/qms/import/history        — list import jobs
   GET  /api/qms/import/:jobId         — single import job detail
   GET  /api/qms/departments           — list departments for import form
   GET  /api/qms/subjects              — list subjects for import form
   GET  /api/qms/stats                 — Question Bank statistics

   All routes require question_import permission via
   adminOrPlatformStaff() guard from auth.middleware.js.
   Root Admin always passes. Platform Staff need explicit
   question_import permission assigned.
============================================ */
'use strict';

const express     = require('express');
const router      = express.Router();
const QMSQuestion = require('../models/QMSQuestion.model');
const ImportJob   = require('../models/ImportJob.model');
const Department  = require('../../models/Department.model');
const Subject     = require('../../models/Subject.model');
const { adminOrPlatformStaff } = require('../../middleware/auth.middleware');
const parser      = require('../utils/question.parser');
const validator   = require('../utils/question.validator');
const engine               = require('../services/question.engine');
const ExaminationBlueprint = require('../models/ExaminationBlueprint.model');

/* ---- Multer for file uploads ---- */
var multer = null;
var upload = null;
try {
  multer = require('multer');
  upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 10 * 1024 * 1024 }, /* 10MB */
    fileFilter: function (req, file, cb) {
      var allowed = ['.txt', '.csv', '.docx', '.xlsx', '.xls'];
      var ext     = '.' + (file.originalname.split('.').pop() || '').toLowerCase();
      if (allowed.includes(ext)) { cb(null, true); }
      else { cb(new Error('Unsupported file type: ' + ext + '. Allowed: ' + allowed.join(', '))); }
    }
  });
  console.log('✅ [QMS] File upload ready — supports txt, csv, docx, xlsx');
} catch (e) {
  console.warn('⚠️  [QMS] multer not available — file upload disabled. Run: npm install multer');
}



/* ---- Question ID generator — BATCH SAFE ----
   Computes the starting sequence number ONCE before
   building the document array. All IDs in the same
   batch get unique sequential values.
   Call generateBatchIds(examType, subjectName, count)
   instead of calling generateQuestionId in a loop. ---- */
async function generateBatchIds(examType, subjectName, count) {
  var prefix   = (examType    || 'GEN').toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 8);
  var subj     = (subjectName || 'GEN').toUpperCase().replace(/[^A-Z]/g,    '').substring(0, 3);
  /* One DB query for the entire batch — avoids collision */
  var existing = await QMSQuestion.countDocuments({ examType: examType });
  var ids      = [];
  for (var i = 0; i < count; i++) {
    ids.push(prefix + '-' + subj + '-' + String(existing + i + 1).padStart(8, '0'));
  }
  return ids;
}

/* ---- Caller identity from req.user ---- */
function callerName(req) {
  if (!req.user) { return 'system'; }
  return req.user.email || req.user.name || req.user.id || 'admin';
}

/* ============================================
   GET /api/qms/departments
   Returns departments filtered by examCategory.
   Reuses existing Department model.
============================================ */
router.get('/departments', adminOrPlatformStaff('question_import'), async function (req, res) {
  try {
    var filter = {};
    if (req.query.examCategory) { filter.examCategory = req.query.examCategory; }
    var depts = await Department.find(filter).sort({ name: 1 }).lean();
    return res.json({ success: true, departments: depts });
  } catch (e) {
    console.error('[QMS] GET /departments:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   GET /api/qms/subjects
   Returns subjects for a department.
   Reuses existing Subject model.
============================================ */
router.get('/subjects', adminOrPlatformStaff('question_import'), async function (req, res) {
  try {
    var filter = {};
    if (req.query.departmentId) { filter.department = req.query.departmentId; }
    var subjects = await Subject.find(filter).sort({ name: 1 }).lean();
    return res.json({ success: true, subjects: subjects });
  } catch (e) {
    console.error('[QMS] GET /subjects:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   POST /api/qms/import/preview
   Parse text + validate. No DB writes.

   Body (JSON):
     text, examType, departmentId, subjectId,
     subjectName, departmentName
============================================ */
router.post('/import/preview', adminOrPlatformStaff('question_import'), async function (req, res) {
  try {
    var text           = (req.body.text           || '').trim();
    var examType       = (req.body.examType       || '').trim();
    var subjectId      = (req.body.subjectId      || '').trim() || null;
    var subjectName    = (req.body.subjectName    || '').trim();
    var departmentName = (req.body.departmentName || '').trim();

    if (!text) {
      return res.status(400).json({ success: false, message: 'Question text is required.' });
    }
    if (!examType) {
      return res.status(400).json({ success: false, message: 'Exam type is required.' });
    }

    var parseResult = parser.parseText(text);
    var valResult   = await validator.validate(parseResult.questions, {
      examType:  examType,
      subjectId: subjectId
    });

    return res.json({
      success: true,
      preview: {
        stats:       valResult.stats,
        parseErrors: parseResult.parseErrors,
        warnings:    parseResult.warnings,
        valid:       valResult.valid,
        duplicates:  valResult.duplicates.slice(0, 50),  /* cap for response size */
        rejected:    valResult.rejected.slice(0, 50)
      }
    });
  } catch (e) {
    console.error('[QMS] POST /import/preview:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   POST /api/qms/import/preview/file
   File upload variant of preview.
   Supports: .txt, .csv
   Future: .docx, .xlsx (Phase 2)
============================================ */
router.post(
  '/import/preview/file',
  adminOrPlatformStaff('question_import'),
  function (req, res, next) {
    if (!upload) {
      return res.status(503).json({
        success: false,
        message: 'File upload is not available. Please use Paste Text instead, or run: npm install multer'
      });
    }
    upload.single('file')(req, res, next);
  },
  async function (req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file received.' });
      }

      var examType       = (req.body.examType       || '').trim();
      var subjectId      = (req.body.subjectId      || '').trim() || null;
      var subjectName    = (req.body.subjectName    || '').trim();
      var departmentName = (req.body.departmentName || '').trim();
      var filename       = req.file.originalname || '';
      var ext            = (filename.split('.').pop() || '').toLowerCase();

      if (!examType) {
        return res.status(400).json({ success: false, message: 'Exam type is required.' });
      }

      var content = req.file.buffer.toString('utf8');
      var parseResult;

      if (ext === 'csv') {
        parseResult = parser.parseCsv(content);
      } else if (ext === 'txt') {
        parseResult = parser.parseText(content);
      } else if (ext === 'docx') {
        /* ✅ PHASE 2: DOCX support via mammoth */
        var docxParser = require('../utils/docx.parser');
        parseResult    = await docxParser.parseDocx(req.file.buffer);
      } else if (ext === 'xlsx' || ext === 'xls') {
        /* ✅ PHASE 2: XLSX support via SheetJS */
        var xlsxParser = require('../utils/xlsx.parser');
        parseResult    = xlsxParser.parseXlsx(req.file.buffer);
      } else {
        return res.status(400).json({
          success: false,
          message: 'Supported formats: .txt, .csv, .docx, .xlsx'
        });
      }

      var valResult = await validator.validate(parseResult.questions, {
        examType:  examType,
        subjectId: subjectId
      });

      return res.json({
        success:  true,
        filename: filename,
        preview: {
          stats:       valResult.stats,
          parseErrors: parseResult.parseErrors,
          warnings:    parseResult.warnings,
          valid:       valResult.valid,
          duplicates:  valResult.duplicates.slice(0, 50),
          rejected:    valResult.rejected.slice(0, 50)
        }
      });
    } catch (e) {
      console.error('[QMS] POST /import/preview/file:', e.message);
      return res.status(500).json({ success: false, message: e.message });
    }
  }
);

/* ============================================
   POST /api/qms/import/confirm
   Saves validated questions to QMSQuestion.
   Creates an ImportJob audit record.

   Body (JSON):
     questions      — the validated questions array from preview
     examType, departmentId, subjectId,
     subjectName, departmentName,
     sourceType, originalFilename
     stats          — { detected, valid, duplicate, rejected }
============================================ */
router.post('/import/confirm', adminOrPlatformStaff('question_import'), async function (req, res) {
  var startTime = Date.now();
  try {
    var questions      = req.body.questions || [];
    var examType       = (req.body.examType       || '').trim();
    var departmentId   = (req.body.departmentId   || '').trim() || null;
    var subjectId      = (req.body.subjectId      || '').trim() || null;
    var subjectName    = (req.body.subjectName    || '').trim();
    var departmentName = (req.body.departmentName || '').trim();
    var sourceType     = req.body.sourceType      || 'paste';
    var origFilename   = req.body.originalFilename || '';
    var stats          = req.body.stats            || {};
    var importedBy     = callerName(req);
    /* ✅ STAGE 1: Question type for the entire batch.
       Defaults to 'objective' for full backward compatibility. */
    var questionType   = (req.body.questionType || 'objective').trim();

    if (!questions.length) {
      return res.status(400).json({ success: false, message: 'No questions to import.' });
    }
    if (!examType) {
      return res.status(400).json({ success: false, message: 'Exam type is required.' });
    }

    /* Create ImportJob first (records attempt even if partial failure) */
    var job = await ImportJob.create({
      importedBy:       importedBy,
      sourceType:       sourceType,
      originalFilename: origFilename,
      examType:         examType,
      departmentId:     departmentId,
      subjectId:        subjectId,
      departmentName:   departmentName,
      subjectName:      subjectName,
      status:           'processing',
      stats: {
        detected:  stats.detected  || questions.length,
        valid:     stats.valid     || questions.length,
        duplicate: stats.duplicate || 0,
        rejected:  stats.rejected  || 0,
        imported:  0
      }
    });

    /* Build document array — generate ALL IDs in one DB call */
    var docs   = [];
    var errors = [];

    var batchIds = [];
    try {
      batchIds = await generateBatchIds(examType, subjectName, questions.length);
    } catch (idErr) {
      /* Fallback: use timestamp-based IDs if count query fails */
      var ts = Date.now();
      for (var k = 0; k < questions.length; k++) {
        batchIds.push('GEN-GEN-' + String(ts + k).slice(-8).padStart(8, '0'));
      }
    }

    for (var i = 0; i < questions.length; i++) {
      var q = questions[i];
      try {
        var qId = batchIds[i];
        docs.push({
          questionId:     qId,
          examType:       examType,
          subjectId:      subjectId,
          departmentId:   departmentId,
          subjectName:    subjectName,
          departmentName: departmentName,
          question:       q.question,
          options:        q.options,
          correctAnswer:  q.correctAnswer,
          explanation:    q.explanation   || '',
          questionType:   questionType,
          topic:          q.topic         || '',
          difficulty:     q.difficulty    || 'medium',
          year:           q.year          || null,
          source:         q.source        || '',
          status:         'approved',
          importJobId:    job._id,
          createdBy:      importedBy,
          approvedBy:     importedBy,
          approvedAt:     new Date(),
          versions:       []
        });
      } catch (docErr) {
        errors.push({ index: i, error: docErr.message });
      }
    }

   /* Bulk insert with partial failure tolerance */
    var inserted   = 0;
    var writeErrors = [];

    if (docs.length > 0) {
      try {
        var result = await QMSQuestion.insertMany(docs, { ordered: false });
        inserted   = result.length;
      } catch (insertErr) {
        /* ordered:false returns insertedDocs for the docs that succeeded */
        if (insertErr.insertedDocs) {
          inserted = insertErr.insertedDocs.length;
        } else if (insertErr.result && insertErr.result.insertedCount) {
          inserted = insertErr.result.insertedCount;
        }
        if (insertErr.writeErrors) {
          insertErr.writeErrors.forEach(function (we) {
            writeErrors.push({ index: we.index, error: we.errmsg });
            errors.push({ index: we.index, error: we.errmsg });
          });
        }
      }
    }

    var idCollisions  = writeErrors.filter(function (e) { return e.error && e.error.includes('E11000'); }).length;
    var otherErrors   = writeErrors.length - idCollisions;
    var finalStatus   = inserted === docs.length ? 'completed'
                      : inserted > 0             ? 'partial'
                      :                            'failed';

    await ImportJob.findByIdAndUpdate(job._id, {
      $set: {
        status:            finalStatus,
        'stats.imported':  inserted,
        'stats.rejected':  (stats.rejected || 0) + otherErrors,
        processingMs:      Date.now() - startTime,
        errorMessage:      idCollisions > 0
          ? idCollisions + ' questions skipped due to ID conflicts (likely re-import of same batch)'
          : ''
      }
    });

    return res.json({
      success:     true,
      message:     inserted + ' question' + (inserted !== 1 ? 's' : '') + ' imported successfully.',
      imported:    inserted,
      total:       docs.length,
      errors:      errors.length,
      idCollisions: idCollisions,
      jobId:       job._id,
      status:      finalStatus
    });

  } catch (e) {
    console.error('[QMS] POST /import/confirm:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   GET /api/qms/import/history
============================================ */
router.get('/import/history', adminOrPlatformStaff('question_import'), async function (req, res) {
  try {
    var page  = Math.max(1, parseInt(req.query.page)  || 1);
    var limit = Math.min(50, parseInt(req.query.limit) || 20);
    var skip  = (page - 1) * limit;
    var total = await ImportJob.countDocuments({});
    var jobs  = await ImportJob.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
    return res.json({ success: true, total: total, page: page, pages: Math.ceil(total / limit), jobs: jobs });
  } catch (e) {
    console.error('[QMS] GET /import/history:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   GET /api/qms/import/:jobId
============================================ */
router.get('/import/:jobId', adminOrPlatformStaff('question_import'), async function (req, res) {
  try {
    var job = await ImportJob.findById(req.params.jobId).lean();
    if (!job) { return res.status(404).json({ success: false, message: 'Import job not found.' }); }
    return res.json({ success: true, job: job });
  } catch (e) {
    console.error('[QMS] GET /import/:jobId:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   GET /api/qms/stats
   Question Bank overview statistics
============================================ */
router.get('/stats', adminOrPlatformStaff('question_import'), async function (req, res) {
  try {
    var [total, approved, pending, archived, byExamType, totalJobs, latestJob] = await Promise.all([
      QMSQuestion.countDocuments({ status: { $ne: 'deleted' } }),
      QMSQuestion.countDocuments({ status: 'approved' }),
      QMSQuestion.countDocuments({ status: 'pending_review' }),
      QMSQuestion.countDocuments({ status: 'archived' }),
      QMSQuestion.aggregate([
        { $match: { status: { $ne: 'deleted' } } },
        { $group: { _id: '$examType', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      ImportJob.countDocuments({}),
      ImportJob.findOne({}).sort({ createdAt: -1 }).lean()
    ]);

    var byType = {};
    byExamType.forEach(function (e) { byType[e._id] = e.count; });

    return res.json({
      success: true,
      stats: {
        total:      total,
        approved:   approved,
        pending:    pending,
        archived:   archived,
        byExamType: byType,
        totalJobs:  totalJobs,
        latestJob:  latestJob ? latestJob.createdAt : null
      }
    });
  } catch (e) {
    console.error('[QMS] GET /stats:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   ✅ PHASE 2 — QUESTION BANK ROUTES
============================================ */

/* ----
   GET /api/qms/bank
   List questions with filters and pagination.
   Guards: question_bank or question_import
   Filters: examType, subjectId, departmentId,
            status, difficulty, search, year
---- */
router.get('/bank', adminOrPlatformStaff('question_bank'), async function (req, res) {
  try {
    var page   = Math.max(1,   parseInt(req.query.page)   || 1);
    var limit  = Math.min(100, parseInt(req.query.limit)  || 25);
    var skip   = (page - 1) * limit;

    var filter = {};

    if (req.query.examType   && req.query.examType   !== 'all') filter.examType   = req.query.examType;
    if (req.query.subjectId)     filter.subjectId     = req.query.subjectId;
    if (req.query.departmentId)  filter.departmentId  = req.query.departmentId;
    if (req.query.difficulty)    filter.difficulty    = req.query.difficulty;
    if (req.query.year)          filter.year          = parseInt(req.query.year);

    /* Status filter — default excludes deleted */
    if (req.query.status && req.query.status !== 'all') {
      filter.status = req.query.status;
    } else if (!req.query.status) {
      filter.status = { $ne: 'deleted' };
    }

    /* Text search */
    if (req.query.search) {
      var searchRegex = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { question:      searchRegex },
        { topic:         searchRegex },
        { subjectName:   searchRegex },
        { questionId:    searchRegex }
      ];
    }

    var [total, questions] = await Promise.all([
      QMSQuestion.countDocuments(filter),
      QMSQuestion.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-versions') /* exclude version history from list */
        .lean()
    ]);

    return res.json({
      success:   true,
      total:     total,
      page:      page,
      pages:     Math.ceil(total / limit),
      questions: questions
    });
  } catch (e) {
    console.error('[QMS] GET /bank:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ----
   GET /api/qms/bank/count
   ✅ MUST be registered before /bank/:id or Express
   treats 'count' as an ObjectId and throws CastError.
   Fast count grouped by examType and status.
---- */
router.get('/bank/count', adminOrPlatformStaff('question_bank'), async function (req, res) {
  try {
    var agg = await QMSQuestion.aggregate([
      { $match: { status: { $ne: 'deleted' } } },
      { $group: { _id: { examType: '$examType', status: '$status' }, count: { $sum: 1 } } }
    ]);
    var result = {};
    agg.forEach(function (r) {
      var et = r._id.examType;
      var st = r._id.status;
      if (!result[et]) { result[et] = {}; }
      result[et][st] = r.count;
    });
    return res.json({ success: true, counts: result });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   ✅ STAGE 1 — ORPHAN QUESTION ROUTES
   Questions imported without a subject assigned.
   Must be registered BEFORE /bank/:id to prevent
   Express treating 'orphans' as an ObjectId.
============================================ */

/* ----
   GET /api/qms/bank/orphans
   Returns QMSQuestions with no subjectId assigned.
   Paginated. Used by the Orphan Cleanup tool.
---- */
router.get('/bank/orphans', adminOrPlatformStaff('question_bank'), async function (req, res) {
  try {
    var page  = Math.max(1,   parseInt(req.query.page)  || 1);
    var limit = Math.min(100, parseInt(req.query.limit) || 25);
    var skip  = (page - 1) * limit;

    var filter = {
      $or: [
        { subjectId: null },
        { subjectId: { $exists: false } }
      ],
      status: { $ne: 'deleted' }
    };

    if (req.query.examType && req.query.examType !== 'all') {
      filter.examType = req.query.examType;
    }

    var [total, questions] = await Promise.all([
      QMSQuestion.countDocuments(filter),
      QMSQuestion.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('questionId question options correctAnswer examType questionType difficulty topic status importJobId createdAt')
        .lean()
    ]);

    return res.json({
      success:   true,
      total:     total,
      page:      page,
      pages:     Math.ceil(total / limit),
      questions: questions
    });
  } catch (e) {
    console.error('[QMS] GET /bank/orphans:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ----
   POST /api/qms/bank/orphans/assign
   Assigns a set of orphaned questions to a Subject.
   Validates that the Subject exists in CBT Management first.

   Body: {
     ids:            [ObjectId],
     subjectId:      string,
     subjectName:    string,
     departmentId:   string,
     departmentName: string,
     examType:       string (optional — overrides existing)
     questionType:   string (optional — defaults to 'objective')
   }
---- */
router.post('/bank/orphans/assign', adminOrPlatformStaff('question_bank'), async function (req, res) {
  try {
    var ids            = req.body.ids            || [];
    var subjectId      = (req.body.subjectId     || '').trim() || null;
    var subjectName    = (req.body.subjectName   || '').trim();
    var departmentId   = (req.body.departmentId  || '').trim() || null;
    var departmentName = (req.body.departmentName|| '').trim();
    var examType       = (req.body.examType      || '').trim()       || null;
    var questionType   = (req.body.questionType  || 'objective').trim();

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'ids array is required.' });
    }
    if (ids.length > 500) {
      return res.status(400).json({ success: false, message: 'Maximum 500 questions per assignment.' });
    }
    if (!subjectId) {
      return res.status(400).json({ success: false, message: 'subjectId is required.' });
    }

    /* Validate Subject existence — architecture requires structures to pre-exist */
    var Subject = require('../../models/Subject.model');
    var subject = await Subject.findById(subjectId).select('name department').lean();
    if (!subject) {
      return res.status(404).json({
        success: false,
        message: 'Subject not found. Please create this Subject inside CBT Management before assigning questions.'
      });
    }

    var update = {
      subjectId:      subjectId,
      subjectName:    subjectName || subject.name || '',
      departmentId:   departmentId,
      departmentName: departmentName,
      questionType:   questionType
    };

    /* Only update examType if explicitly provided */
    if (examType) { update.examType = examType; }

    var result = await QMSQuestion.updateMany(
      { _id: { $in: ids } },
      { $set: update }
    );

    return res.json({
      success:  true,
      message:  result.modifiedCount + ' question' + (result.modifiedCount !== 1 ? 's' : '') +
                ' assigned to ' + (update.subjectName) + '.',
      modified: result.modifiedCount
    });
  } catch (e) {
    console.error('[QMS] POST /bank/orphans/assign:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ----
   POST /api/qms/bank
   Create a single question directly.
   Used by the CBT Management "Add Question" flow.
   Identical field shape to import/confirm but for one question.
   Must be registered before /bank/:id.

   Body: { question, options[], correctAnswer, explanation,
           examType, questionType, subjectId, subjectName,
           departmentId, departmentName, topic, difficulty,
           year, source, status }
---- */
router.post('/bank', adminOrPlatformStaff('question_bank'), async function (req, res) {
  try {
    var body           = req.body;
    var examType       = (body.examType       || 'jamb').trim();
    var questionType   = (body.questionType   || 'objective').trim();
    var subjectId      = (body.subjectId      || '').trim() || null;
    var subjectName    = (body.subjectName    || '').trim();
    var departmentId   = (body.departmentId   || '').trim() || null;
    var departmentName = (body.departmentName || '').trim();
    var createdBy      = callerName(req);

    /* Field validation */
    if (!body.question || !body.question.trim()) {
      return res.status(400).json({ success: false, message: 'Question text is required.' });
    }
    if (!Array.isArray(body.options) || body.options.length < 2) {
      return res.status(400).json({ success: false, message: 'At least 2 options are required.' });
    }
    var correctAnswer = parseInt(body.correctAnswer);
    if (isNaN(correctAnswer) || correctAnswer === undefined) {
      return res.status(400).json({ success: false, message: 'Correct answer index is required.' });
    }
    if (correctAnswer < 0 || correctAnswer >= body.options.length) {
      return res.status(400).json({
        success: false,
        message: 'Correct answer index (' + correctAnswer + ') is out of range — only ' + body.options.length + ' options provided.'
      });
    }

    /* Generate unique question ID */
    var batchIds = await generateBatchIds(examType, subjectName, 1);

    var doc = await QMSQuestion.create({
      questionId:     batchIds[0],
      examType:       examType,
      questionType:   questionType,
      subjectId:      subjectId,
      departmentId:   departmentId,
      subjectName:    subjectName,
      departmentName: departmentName,
      question:       body.question.trim(),
      options:        body.options.map(function (o) { return (o || '').trim(); }).filter(Boolean),
      correctAnswer:  correctAnswer,
      explanation:    (body.explanation || '').trim(),
      topic:          (body.topic       || '').trim(),
      subtopic:       (body.subtopic    || '').trim(),
      difficulty:     body.difficulty   || 'medium',
      year:           body.year ? parseInt(body.year) : null,
      source:         (body.source || '').trim(),
      keywords:       Array.isArray(body.keywords) ? body.keywords : [],
      status:         body.status       || 'approved',
      createdBy:      createdBy,
      approvedBy:     createdBy,
      approvedAt:     new Date(),
      versions:       []
    });

    return res.json({
      success:  true,
      message:  'Question created.',
      question: doc.toObject()
    });
  } catch (e) {
    console.error('[QMS] POST /bank:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ----
   GET /api/qms/bank/:id
   Single question including version history.
---- */
router.get('/bank/:id', adminOrPlatformStaff('question_bank'), async function (req, res) {
  try {
    var q = await QMSQuestion.findById(req.params.id).lean();
    if (!q) { return res.status(404).json({ success: false, message: 'Question not found.' }); }
    return res.json({ success: true, question: q });
  } catch (e) {
    console.error('[QMS] GET /bank/:id:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ----
   PUT /api/qms/bank/:id
   Edit a question. Automatically snapshots the current
   version before applying changes.

   Body: { question, options, correctAnswer, explanation,
           topic, subtopic, difficulty, year, source,
           keywords, status, reason }
---- */
router.put('/bank/:id', adminOrPlatformStaff('question_bank'), async function (req, res) {
  try {
    var doc = await QMSQuestion.findById(req.params.id);
    if (!doc) { return res.status(404).json({ success: false, message: 'Question not found.' }); }
    if (doc.status === 'deleted') {
      return res.status(400).json({ success: false, message: 'Cannot edit a deleted question.' });
    }

    var body   = req.body;
    var editor = callerName(req);

    /* Snapshot current version BEFORE applying changes */
    if (
      (body.question      !== undefined && body.question      !== doc.question) ||
      (body.options       !== undefined)                                         ||
      (body.correctAnswer !== undefined && body.correctAnswer !== doc.correctAnswer) ||
      (body.explanation   !== undefined && body.explanation   !== doc.explanation)
    ) {
      doc.versions.push({
        question:      doc.question,
        options:       doc.options.slice(),
        correctAnswer: doc.correctAnswer,
        explanation:   doc.explanation,
        editedBy:      editor,
        reason:        body.reason || 'Manual edit'
      });
      /* Keep only last 20 versions */
      if (doc.versions.length > 20) { doc.versions = doc.versions.slice(-20); }
    }

    /* Apply updates */
    var ALLOWED = ['question', 'options', 'correctAnswer', 'explanation',
                   'topic', 'subtopic', 'difficulty', 'year', 'source',
                   'keywords', 'status'];
    ALLOWED.forEach(function (field) {
      if (body[field] !== undefined) { doc[field] = body[field]; }
    });

    /* Validate correctAnswer range */
    if (doc.correctAnswer < 0 || doc.correctAnswer >= doc.options.length) {
      return res.status(400).json({ success: false, message: 'correctAnswer index out of range.' });
    }

    await doc.save();

    return res.json({
      success:  true,
      message:  'Question updated.',
      question: doc.toObject()
    });
  } catch (e) {
    console.error('[QMS] PUT /bank/:id:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ----
   DELETE /api/qms/bank/:id
   Soft delete — sets status to 'deleted'.
   Hard delete requires an explicit ?hard=true query
   parameter AND root admin only.
---- */
router.delete('/bank/:id', adminOrPlatformStaff('question_bank'), async function (req, res) {
  try {
    var doc = await QMSQuestion.findById(req.params.id);
    if (!doc) { return res.status(404).json({ success: false, message: 'Question not found.' }); }

    /* Hard delete — root admin only */
    if (req.query.hard === 'true') {
      if (!req.isRoot) {
        return res.status(403).json({ success: false, message: 'Hard delete requires Root Administrator access.' });
      }
      await QMSQuestion.findByIdAndDelete(req.params.id);
      return res.json({ success: true, message: 'Question permanently deleted.' });
    }

    /* Soft delete */
    doc.status = 'deleted';
    await doc.save();
    return res.json({ success: true, message: 'Question moved to deleted state. It can be restored if needed.' });
  } catch (e) {
    console.error('[QMS] DELETE /bank/:id:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ----
   GET /api/qms/bank/:id/versions
   Returns version history for a question.
---- */
router.get('/bank/:id/versions', adminOrPlatformStaff('question_bank'), async function (req, res) {
  try {
    var doc = await QMSQuestion.findById(req.params.id).select('questionId question versions');
    if (!doc) { return res.status(404).json({ success: false, message: 'Question not found.' }); }
    return res.json({
      success:    true,
      questionId: doc.questionId,
      current:    doc.question,
      versions:   doc.versions.reverse() /* newest first */
    });
  } catch (e) {
    console.error('[QMS] GET /bank/:id/versions:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ----
   PUT /api/qms/bank/:id/restore/:versionIdx
   Restores a previous version.
   versionIdx is the index in the versions array
   (0 = oldest, after the /versions endpoint reversed it:
   0 = newest from the caller's perspective — so we re-reverse)
---- */
router.put('/bank/:id/restore/:versionIdx', adminOrPlatformStaff('question_bank'), async function (req, res) {
  try {
    var doc = await QMSQuestion.findById(req.params.id);
    if (!doc) { return res.status(404).json({ success: false, message: 'Question not found.' }); }

    var versions = doc.versions.slice().reverse(); /* newest first (matches UI index) */
    var idx      = parseInt(req.params.versionIdx);

    if (isNaN(idx) || idx < 0 || idx >= versions.length) {
      return res.status(400).json({ success: false, message: 'Invalid version index.' });
    }

    var target = versions[idx];
    var editor = callerName(req);

    /* Snapshot current state before restore */
    doc.versions.push({
      question:      doc.question,
      options:       doc.options.slice(),
      correctAnswer: doc.correctAnswer,
      explanation:   doc.explanation,
      editedBy:      editor,
      reason:        'Snapshot before restore to version ' + idx
    });

    /* Restore */
    doc.question      = target.question;
    doc.options       = target.options;
    doc.correctAnswer = target.correctAnswer;
    doc.explanation   = target.explanation;

    if (doc.versions.length > 20) { doc.versions = doc.versions.slice(-20); }
    await doc.save();

    return res.json({ success: true, message: 'Question restored to version ' + idx + '.', question: doc.toObject() });
  } catch (e) {
    console.error('[QMS] PUT /bank/:id/restore:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ----
   POST /api/qms/bank/bulk
   Bulk operations on multiple questions.

   Body: { operation, ids[], payload? }
   Operations:
     approve  → status: 'approved'
     archive  → status: 'archived'
     delete   → status: 'deleted' (soft)
     move     → change subjectId + subjectName (payload required)
     restore  → status: 'approved' (from deleted/archived)
---- */
router.post('/bank/bulk', adminOrPlatformStaff('question_bank'), async function (req, res) {
  try {
    var operation = (req.body.operation || '').trim();
    var ids       = req.body.ids;
    var payload   = req.body.payload || {};

    if (!operation) {
      return res.status(400).json({ success: false, message: 'operation is required.' });
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'ids must be a non-empty array.' });
    }
    if (ids.length > 500) {
      return res.status(400).json({ success: false, message: 'Maximum 500 questions per bulk operation.' });
    }

    var ALLOWED_OPS = ['approve', 'archive', 'delete', 'restore', 'move', 'tag'];
    if (!ALLOWED_OPS.includes(operation)) {
      return res.status(400).json({ success: false, message: 'Invalid operation: ' + operation });
    }

    var update;

    switch (operation) {
      case 'approve':  update = { $set: { status: 'approved'  } }; break;
      case 'archive':  update = { $set: { status: 'archived'  } }; break;
      case 'delete':   update = { $set: { status: 'deleted'   } }; break;
      case 'restore':  update = { $set: { status: 'approved'  } }; break;
      case 'move':
        if (!payload.subjectId) {
          return res.status(400).json({ success: false, message: 'move operation requires payload.subjectId' });
        }
        update = { $set: {
          subjectId:      payload.subjectId,
          subjectName:    payload.subjectName    || '',
          departmentId:   payload.departmentId   || null,
          departmentName: payload.departmentName || ''
        }};
        break;
      case 'tag':
        /* ✅ PHASE 5: Bulk assign topic/difficulty/year to selected questions */
        if (!payload.topic && !payload.difficulty && payload.year === undefined) {
          return res.status(400).json({ success: false,
            message: 'tag operation requires at least one of: payload.topic, payload.difficulty, payload.year' });
        }
        var tagSet = {};
        if (payload.topic      !== undefined) tagSet.topic      = payload.topic;
        if (payload.difficulty !== undefined) tagSet.difficulty = payload.difficulty;
        if (payload.year       !== undefined) tagSet.year       = payload.year ? parseInt(payload.year) : null;
        update = { $set: tagSet };
        break;
    }

    var result = await QMSQuestion.updateMany({ _id: { $in: ids } }, update);

    return res.json({
      success:  true,
      message:  result.modifiedCount + ' question' + (result.modifiedCount !== 1 ? 's' : '') + ' updated (' + operation + ').',
      modified: result.modifiedCount
    });
  } catch (e) {
    console.error('[QMS] POST /bank/bulk:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* /bank/count moved ABOVE /bank/:id — see earlier in this file */

/* ============================================
   ✅ PHASE 3 — QUESTION ENGINE ROUTES

   All routes use adminOrPlatformStaff('question_engine').
   Root Admin always passes. Platform Staff need the
   question_engine permission explicitly assigned.

   These routes NEVER write to the database.
   They only read from QMSQuestion.
============================================ */

/* ----
   GET /api/qms/engine/availability
   Check how many approved questions match criteria.
   Used by admin UI to validate before assembling.

   Query params: examType, subjectId, departmentId,
                 difficulty, topic, year
---- */
router.get(
  '/engine/availability',
  adminOrPlatformStaff('question_engine'),
  async function (req, res) {
    try {
      var result = await engine.getAvailability({
        examType:     req.query.examType     || '',
        subjectId:    req.query.subjectId    || '',
        departmentId: req.query.departmentId || '',
        difficulty:   req.query.difficulty   || '',
        topic:        req.query.topic        || '',
        year:         req.query.year         || null
      });
      return res.json(result);
    } catch (e) {
      console.error('[QMS Engine] GET /availability:', e.message);
      return res.status(500).json({ success: false, message: e.message });
    }
  }
);

/* ----
   POST /api/qms/engine/assemble
   Assemble a question set from the bank.
   Returns questions in a preview-safe format
   (correctAnswer is included — admin only).

   Body: { examType, subjectId, departmentId,
           difficulty, topic, year, count, shuffle }
---- */
router.post(
  '/engine/assemble',
  adminOrPlatformStaff('question_engine'),
  async function (req, res) {
    try {
      var params = {
        examType:     (req.body.examType     || '').trim(),
        subjectId:    (req.body.subjectId    || '').trim() || null,
        departmentId: (req.body.departmentId || '').trim() || null,
        difficulty:   (req.body.difficulty   || '').trim() || null,
        topic:        (req.body.topic        || '').trim() || null,
        year:         req.body.year          || null,
        count:        parseInt(req.body.count)    || 40,
        shuffle:      req.body.shuffle !== false
      };

      if (!params.examType) {
        return res.status(400).json({ success: false, message: 'examType is required.' });
      }
      if (params.count < 1 || params.count > 500) {
        return res.status(400).json({ success: false, message: 'count must be between 1 and 500.' });
      }

      var result = await engine.assemble(params);
      return res.json(result);
    } catch (e) {
      console.error('[QMS Engine] POST /assemble:', e.message);
      return res.status(500).json({ success: false, message: e.message });
    }
  }
);

/* ----
   GET /api/qms/engine/breakdown
   Returns question counts grouped by subject.
   Used by admin to see the full picture of
   what is available per exam type.

   Query params: examType (optional, default all)
---- */
router.get(
  '/engine/breakdown',
  adminOrPlatformStaff('question_engine'),
  async function (req, res) {
    try {
      var examType = (req.query.examType || '').trim() || 'all';
      var result   = await engine.getBreakdown(examType);
      return res.json(result);
    } catch (e) {
      console.error('[QMS Engine] GET /breakdown:', e.message);
      return res.status(500).json({ success: false, message: e.message });
    }
  }
);

/* ----
   GET /api/qms/engine/summary
   Top-level stats: total approved, by exam type, by difficulty.
   Used by the engine overview card in admin UI.
---- */
router.get(
  '/engine/summary',
  adminOrPlatformStaff('question_engine'),
  async function (req, res) {
    try {
      var result = await engine.getSummaryStats();
      return res.json(result);
    } catch (e) {
      console.error('[QMS Engine] GET /summary:', e.message);
      return res.status(500).json({ success: false, message: e.message });
    }
  }
);

/* ============================================
   ✅ PHASE 4 — INTEGRATION STATUS ENDPOINT

   GET /api/qms/engine/integration-status
   Shows which subjects are served by QMS engine
   vs legacy Question model for a given exam type.
   Admin-only — never called by students.

   Query: examType (jamb|waec|neco|post-utme|practice|all)
============================================ */
router.get(
  '/engine/integration-status',
  adminOrPlatformStaff('question_engine'),
  async function (req, res) {
    try {
      var examType = (req.query.examType || 'jamb').trim();
      var Subject  = require('../../models/Subject.model');
      var Question = require('../../models/Question.model');

      /* Build filters matching integration logic in cbt.routes.js */
      /* ✅ STAGE 1: Filter to objective only for integration status
         (legacy system only has objective questions) */
      var qmsFilter    = { status: 'approved', questionType: 'objective' };
      var legacyFilter = { isActive: true };

      if (examType !== 'all') {
        qmsFilter.examType = { $in: [examType, 'all'] };
        legacyFilter.$or = [
          { examCategory: examType },
          { examCategory: 'all' }
        ];
      }

      var [subjects, qmsCounts, legacyCounts] = await Promise.all([
        Subject.find({}).lean(),

        QMSQuestion.aggregate([
          { $match: qmsFilter },
          { $group: { _id: '$subjectId', count: { $sum: 1 } } }
        ]),

        Question.aggregate([
          { $match: legacyFilter },
          { $group: { _id: '$subjectId', count: { $sum: 1 } } }
        ])
      ]);

      var qmsMap    = {};
      var legacyMap = {};
      qmsCounts.forEach(function (r) {
        if (r._id) qmsMap[r._id.toString()] = r.count;
      });
      legacyCounts.forEach(function (r) {
        if (r._id) legacyMap[r._id.toString()] = r.count;
      });

      var result = subjects
        .map(function (s) {
          var sid    = s._id.toString();
          var qms    = qmsMap[sid]    || 0;
          var legacy = legacyMap[sid] || 0;
          /* Source logic mirrors cbt.routes.js session/start:
             QMS wins if it has ANY approved questions for this subject */
          var source = qms > 0 ? 'qms' : (legacy > 0 ? 'legacy' : 'none');
          return {
            subjectId:   s._id,
            subjectName: s.name || '(Unnamed Subject)',   /* always a string — prevents esc() TypeError */
            qmsCount:    qms,
            legacyCount: legacy,
            source:      source,
            total:       qms + legacy
          };
        })
        .filter(function (s) { return s.total > 0; })
        .sort(function (a, b) { return b.total - a.total; });

      var usingQMS    = result.filter(function (s) { return s.source === 'qms';    }).length;
      var usingLegacy = result.filter(function (s) { return s.source === 'legacy'; }).length;

      return res.json({
        success:  true,
        examType: examType,
        subjects: result,
        summary: {
          total:       result.length,
          usingQMS:    usingQMS,
          usingLegacy: usingLegacy
        }
      });

    } catch (e) {
      console.error('[QMS] GET /engine/integration-status:', e.message);
      return res.status(500).json({ success: false, message: e.message });
    }
  }
);

/* ============================================
   ✅ PHASE 5 — TAG MANAGER ENDPOINT

   GET /api/qms/tags
   Returns all unique topics with question counts.
   Powers the Tag Manager panel in the admin UI.

   Query params:
     examType  — filter by exam type (optional)
     minCount  — minimum count to include (default 1)
     limit     — max topics returned (default 100)
============================================ */
router.get('/tags', adminOrPlatformStaff('question_bank'), async function (req, res) {
  try {
    var examType = (req.query.examType || '').trim();
    var minCount = parseInt(req.query.minCount) || 1;
    var limit    = Math.min(200, parseInt(req.query.limit) || 100);

    var matchFilter = { status: { $ne: 'deleted' }, topic: { $ne: '', $exists: true } };
    if (examType && examType !== 'all') {
      matchFilter.examType = examType;
    }

    var [topics, keywords] = await Promise.all([
      /* Topic aggregation */
      QMSQuestion.aggregate([
        { $match: matchFilter },
        { $group: {
          _id:        '$topic',
          count:      { $sum: 1 },
          examTypes:  { $addToSet: '$examType' },
          subjects:   { $addToSet: '$subjectName' }
        }},
        { $match: { count: { $gte: minCount } } },
        { $sort:  { count: -1 } },
        { $limit: limit }
      ]),

      /* Keyword aggregation — flatten keywords array */
      QMSQuestion.aggregate([
        { $match: { status: { $ne: 'deleted' }, keywords: { $exists: true, $ne: [] } } },
        { $unwind: '$keywords' },
        { $match: { keywords: { $ne: '' } } },
        { $group: { _id: '$keywords', count: { $sum: 1 } } },
        { $sort:  { count: -1 } },
        { $limit: 50 }
      ])
    ]);

    return res.json({
      success:  true,
      topics:   topics.map(function (t) {
        return {
          topic:     t._id,
          count:     t.count,
          examTypes: t.examTypes.filter(Boolean),
          subjects:  t.subjects.filter(Boolean).slice(0, 5)
        };
      }),
      keywords: keywords.map(function (k) {
        return { keyword: k._id, count: k.count };
      })
    });
  } catch (e) {
    console.error('[QMS] GET /tags:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   ✅ PHASE 5 — ADVANCED ANALYTICS ENDPOINT

   GET /api/qms/analytics
   Comprehensive statistics for the admin UI.

   Returns:
     importTrend   — daily import activity (last 30 days)
     topSubjects   — top 10 subjects by question count
     yearDist      — question count by year
     diffDist      — question count by difficulty
     sourceDist    — questions by import source type
     statusDist    — question count by status
     weeklyVelocity — questions added per week (last 8 weeks)
============================================ */
router.get('/analytics', adminOrPlatformStaff('question_stats'), async function (req, res) {
  try {
    var thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    var eightWeeksAgo = new Date(Date.now() - 56 * 24 * 60 * 60 * 1000);

    var [
      importTrend,
      topSubjects,
      yearDist,
      diffDist,
      sourceDist,
      statusDist,
      weeklyVelocity,
      examTypeDist
    ] = await Promise.all([

      /* Daily import job activity */
      ImportJob.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        { $group: {
          _id:      { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          jobs:     { $sum: 1 },
          imported: { $sum: '$stats.imported' },
          rejected: { $sum: '$stats.rejected' }
        }},
        { $sort: { _id: 1 } }
      ]),

      /* Top 10 subjects by approved question count */
      QMSQuestion.aggregate([
        { $match: { status: 'approved' } },
        { $group: {
          _id:         { subjectId: '$subjectId', subjectName: '$subjectName' },
          count:       { $sum: 1 },
          examTypes:   { $addToSet: '$examType' }
        }},
        { $sort:  { count: -1 } },
        { $limit: 10 }
      ]),

      /* Year distribution */
      QMSQuestion.aggregate([
        { $match: { status: { $ne: 'deleted' }, year: { $ne: null, $gt: 1989, $lt: 2100 } } },
        { $group: { _id: '$year', count: { $sum: 1 } } },
        { $sort:  { _id: 1 } }
      ]),

      /* Difficulty distribution (non-deleted) */
      QMSQuestion.aggregate([
        { $match: { status: { $ne: 'deleted' } } },
        { $group: { _id: '$difficulty', count: { $sum: 1 } } }
      ]),

     /* Source type distribution — include partial jobs (common when Issue 1 occurred) */
      ImportJob.aggregate([
        { $match: { status: { $in: ['completed', 'partial'] } } },
        { $group: {
          _id:      '$sourceType',
          jobs:     { $sum: 1 },
          imported: { $sum: '$stats.imported' }
        }},
        { $sort: { imported: -1 } }
      ]),

      /* Status distribution */
      QMSQuestion.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),

     /* Daily velocity (last 56 days = 8 weeks) — safer than %Y-W%V which needs MongoDB 4.4+ */
      QMSQuestion.aggregate([
        { $match: { createdAt: { $gte: eightWeeksAgo }, status: { $ne: 'deleted' } } },
        { $group: {
          _id:   { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }},
        { $sort: { _id: 1 } },
        { $limit: 56 }
      ]),

      /* Exam type distribution */
      QMSQuestion.aggregate([
        { $match: { status: 'approved' } },
        { $group: { _id: '$examType', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ])
    ]);

    /* Build daily map with zeroes for missing days */
    var dailyMap = {};
    importTrend.forEach(function (d) { dailyMap[d._id] = d; });
    var trendFilled = [];
    for (var i = 29; i >= 0; i--) {
      var d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      var key = d.toISOString().substring(0, 10);
      trendFilled.push({
        date:     key,
        jobs:     dailyMap[key] ? dailyMap[key].jobs     : 0,
        imported: dailyMap[key] ? dailyMap[key].imported : 0,
        rejected: dailyMap[key] ? dailyMap[key].rejected : 0
      });
    }

    var diffMap   = {};
    diffDist.forEach(function (d) { diffMap[d._id] = d.count; });

    var statusMap = {};
    statusDist.forEach(function (d) { statusMap[d._id] = d.count; });

    var etMap = {};
    examTypeDist.forEach(function (e) { etMap[e._id] = e.count; });

    return res.json({
      success: true,
      analytics: {
        importTrend:    trendFilled,
        topSubjects:    topSubjects.map(function (s) {
          return { subjectName: s._id.subjectName || '(Unassigned)', count: s.count, examTypes: s.examTypes };
        }),
        yearDist:       yearDist.map(function (y) { return { year: y._id, count: y.count }; }),
        diffDist:       {
          easy:   diffMap['easy']   || 0,
          medium: diffMap['medium'] || 0,
          hard:   diffMap['hard']   || 0,
          mixed:  diffMap['mixed']  || 0
        },
        sourceDist:     sourceDist,
        statusDist:     statusMap,
        weeklyVelocity: weeklyVelocity,
        examTypeDist:   etMap
      }
    });
  } catch (e) {
    console.error('[QMS] GET /analytics:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   ✅ STABILIZATION — ENGINE HEALTH ENDPOINT

   GET /api/qms/engine/health
   Operational health data for the engine dashboard.
   Returns Question Health, Coverage and Engine Status.
   Never writes to DB.
============================================ */
router.get('/engine/health', adminOrPlatformStaff('question_engine'), async function (req, res) {
  try {
    var Question = require('../../models/Question.model');

    var nonDeleted = { status: { $ne: 'deleted' } };

    var [
      totalQMS, approvedQMS, draftQMS, archivedQMS, deletedQMS,
      withTopics, withExpl, totalLegacy,
      lastJob, totalSubjects, subjectsWithQMS, assemblyReadyAgg
    ] = await Promise.all([
      QMSQuestion.countDocuments(nonDeleted),
      QMSQuestion.countDocuments({ status: 'approved' }),
      QMSQuestion.countDocuments({ status: 'draft' }),
      QMSQuestion.countDocuments({ status: 'archived' }),
      QMSQuestion.countDocuments({ status: 'deleted' }),
      QMSQuestion.countDocuments({ status: { $ne: 'deleted' }, topic: { $ne: '', $exists: true } }),
      QMSQuestion.countDocuments({ status: { $ne: 'deleted' }, explanation: { $ne: '', $exists: true } }),
      Question.countDocuments({ isActive: true }),
      ImportJob.findOne({}).sort({ createdAt: -1 }).lean(),
      Subject.countDocuments({}),
      QMSQuestion.distinct('subjectId', { status: 'approved' }),
      QMSQuestion.aggregate([
        { $match: { status: 'approved' } },
        { $group: { _id: '$subjectId', count: { $sum: 1 } } },
        { $match: { count: { $gte: 40 } } },
        { $count: 'ready' }
      ])
    ]);

    var activeQMS         = totalQMS - deletedQMS;
    var missingTopics     = activeQMS - withTopics;
    var missingExpl       = activeQMS - withExpl;
    var qmsSubjectCount   = subjectsWithQMS.filter(Boolean).length;
    var assemblyReady     = assemblyReadyAgg.length > 0 ? assemblyReadyAgg[0].ready : 0;
    var coveragePct       = totalSubjects > 0 ? Math.round((qmsSubjectCount / totalSubjects) * 100) : 0;

    return res.json({
      success: true,
      health: {
        questionBank: {
          total:               activeQMS,
          approved:            approvedQMS,
          draft:               draftQMS,
          archived:            archivedQMS,
          deleted:             deletedQMS,
          withTopics:          withTopics,
          missingTopics:       missingTopics,
          withExplanations:    withExpl,
          missingExplanations: missingExpl,
          legacy:              totalLegacy
        },
        coverage: {
          totalSubjects:    totalSubjects,
          subjectsWithQMS:  qmsSubjectCount,
          coveragePct:      coveragePct
        },
        engine: {
          assemblyReadySubjects: assemblyReady,
          status:               approvedQMS > 0 ? 'operational' : 'no_questions',
          lastImport:           lastJob ? {
            date:     lastJob.createdAt,
            status:   lastJob.status,
            imported: lastJob.stats ? (lastJob.stats.imported || 0) : 0,
            examType: lastJob.examType || '—'
          } : null
        }
      }
    });
  } catch (e) {
    console.error('[QMS] GET /engine/health:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   ✅ STABILIZATION — LEGACY QUESTION BANK

   GET /api/qms/bank/legacy
   Lists legacy Question model documents so Root
   Admin can see both question sources in one UI.
   Read-only — never modifies legacy questions.

   Query: page, limit, subjectId, examCategory, search
============================================ */
router.get('/bank/legacy', adminOrPlatformStaff('question_bank'), async function (req, res) {
  try {
    var Question = require('../../models/Question.model');

    var page  = Math.max(1,   parseInt(req.query.page)  || 1);
    var limit = Math.min(100, parseInt(req.query.limit) || 25);
    var skip  = (page - 1) * limit;

    var filter = { isActive: true };

    if (req.query.subjectId) {
      filter.subjectId = req.query.subjectId;
    }
    if (req.query.examCategory && req.query.examCategory !== 'all') {
      filter.$or = [
        { examCategory: req.query.examCategory },
        { examCategory: 'all' }
      ];
    }
    if (req.query.search) {
      var searchRegex = new RegExp(
        req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'
      );
      filter.question = searchRegex;
    }

    var [total, questions] = await Promise.all([
      Question.countDocuments(filter),
      Question.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('question options correctAnswer explanation examCategory subjectId isActive createdAt')
        .lean()
    ]);

    /* Enrich with subject names */
    var subjectIds = [...new Set(questions.map(function (q) { return q.subjectId; }).filter(Boolean))];
    var subjects   = await Subject.find({ _id: { $in: subjectIds } }).select('name').lean();
    var subjMap    = {};
    subjects.forEach(function (s) { subjMap[s._id.toString()] = s.name; });

    var enriched = questions.map(function (q) {
      return Object.assign({}, q, {
        subjectName: q.subjectId ? (subjMap[q.subjectId.toString()] || '—') : '—',
        source:      'legacy'
      });
    });

    return res.json({
      success:   true,
      source:    'legacy',
      total:     total,
      page:      page,
      pages:     Math.ceil(total / limit),
      questions: enriched
    });
  } catch (e) {
    console.error('[QMS] GET /bank/legacy:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   ✅ STAGE 1 — EXAMINATION BLUEPRINT ROUTES

   POST /api/qms/blueprint/pool-health-batch
   GET  /api/qms/blueprint/pool-health/:subjectId
   GET  /api/qms/blueprint/subject/:subjectId
   PUT  /api/qms/blueprint/subject/:subjectId
   DELETE /api/qms/blueprint/:blueprintId

   Blueprint = the configuration for how a Subject's
   Question Pool is used during an examination session.
   Stage 1: admin-interface only.
   Stage 4: session/start will read these directly.
============================================ */

/* ----
   POST /api/qms/blueprint/pool-health-batch
   Returns question pool counts for multiple subjects in one call.
   Used by CBT Management subject list to show pool sizes.
   Body: { subjectIds: [string, ...] }
---- */
router.post(
  '/blueprint/pool-health-batch',
  adminOrPlatformStaff('question_bank'),
  async function (req, res) {
    try {
      var subjectIds = req.body.subjectIds || [];
      if (!subjectIds.length) {
        return res.json({ success: true, health: {} });
      }

      var mongoose  = require('mongoose');
      var objectIds = subjectIds.map(function (id) {
        try { return mongoose.Types.ObjectId(id); }
        catch (e) { return null; }
      }).filter(Boolean);

      var [agg, bps] = await Promise.all([
        QMSQuestion.aggregate([
          {
            $match: {
              subjectId: { $in: objectIds },
              status:    'approved'
            }
          },
          {
            $group: {
              _id:   { subjectId: '$subjectId', questionType: '$questionType' },
              count: { $sum: 1 }
            }
          }
        ]),
        ExaminationBlueprint.find({
          subjectId: { $in: subjectIds }
        }).select('subjectId examType questionType count status').lean()
      ]);

      var health = {};

      agg.forEach(function (r) {
        var sid = r._id.subjectId.toString();
        var qt  = r._id.questionType || 'objective';
        if (!health[sid]) { health[sid] = { total: 0 }; }
        health[sid][qt]   = r.count;
        health[sid].total = (health[sid].total || 0) + r.count;
      });

      /* Attach blueprint status per subject */
      bps.forEach(function (bp) {
        var sid = bp.subjectId.toString();
        if (!health[sid]) { health[sid] = { total: 0 }; }
        if (!health[sid]._blueprints) { health[sid]._blueprints = []; }
        health[sid]._blueprints.push({
          examType:     bp.examType,
          questionType: bp.questionType,
          count:        bp.count,
          status:       bp.status
        });
      });

      return res.json({ success: true, health: health });
    } catch (e) {
      console.error('[QMS Blueprint] pool-health-batch:', e.message);
      return res.status(500).json({ success: false, message: e.message });
    }
  }
);

/* ----
   GET /api/qms/blueprint/pool-health/:subjectId
   Full pool health for a single subject.
   Returns pool counts per questionType and blueprint status.
---- */
router.get(
  '/blueprint/pool-health/:subjectId',
  adminOrPlatformStaff('question_bank'),
  async function (req, res) {
    try {
      var mongoose = require('mongoose');
      var sid;
      try { sid = mongoose.Types.ObjectId(req.params.subjectId); }
      catch (e) { return res.status(400).json({ success: false, message: 'Invalid subjectId.' }); }

      var [agg, blueprints] = await Promise.all([
        QMSQuestion.aggregate([
          { $match: { subjectId: sid, status: 'approved' } },
          { $group: { _id: '$questionType', count: { $sum: 1 } } }
        ]),
        ExaminationBlueprint.find({ subjectId: req.params.subjectId }).lean()
      ]);

      var poolCounts = {};
      agg.forEach(function (r) { poolCounts[r._id || 'objective'] = r.count; });

      var bpMap = {};
      blueprints.forEach(function (bp) {
        var key = bp.examType + '_' + bp.questionType;
        bpMap[key] = bp;
      });

      var questionTypes   = ['objective', 'theory', 'practical', 'oral'];
      var typeHealth      = {};
      questionTypes.forEach(function (qt) {
        var available = poolCounts[qt] || 0;
        /* Use 'all' blueprint as default fallback */
        var bp = bpMap['all_' + qt] || null;
        var required = bp ? bp.count : 0;
        typeHealth[qt] = {
          available: available,
          required:  required,
          ready:     required > 0 && available >= required,
          blueprint: bp
        };
      });

      return res.json({
        success:    true,
        subjectId:  req.params.subjectId,
        poolCounts: poolCounts,
        total:      Object.values(poolCounts).reduce(function (s, c) { return s + c; }, 0),
        typeHealth: typeHealth,
        blueprints: blueprints
      });
    } catch (e) {
      console.error('[QMS Blueprint] pool-health/:id:', e.message);
      return res.status(500).json({ success: false, message: e.message });
    }
  }
);

/* ----
   GET /api/qms/blueprint/subject/:subjectId
   Returns all blueprints for a subject.
   Used by the Blueprint editor modal.
---- */
router.get(
  '/blueprint/subject/:subjectId',
  adminOrPlatformStaff('question_bank'),
  async function (req, res) {
    try {
      var blueprints = await ExaminationBlueprint.find({
        subjectId: req.params.subjectId
      }).lean();

      return res.json({ success: true, blueprints: blueprints });
    } catch (e) {
      console.error('[QMS Blueprint] GET subject/:id:', e.message);
      return res.status(500).json({ success: false, message: e.message });
    }
  }
);

/* ----
   PUT /api/qms/blueprint/subject/:subjectId
   Upsert (create or update) a blueprint.
   Body: { examType, questionType, count, duration, passMark,
           difficultyDistribution, randomize, shuffleOptions,
           instructions, securityOptions }
---- */
router.put(
  '/blueprint/subject/:subjectId',
  adminOrPlatformStaff('question_bank'),
  async function (req, res) {
    try {
      var body         = req.body;
      var subjectId    = req.params.subjectId;
      var examType     = (body.examType    || 'all').trim();
      var questionType = (body.questionType|| 'objective').trim();

      /* Validate subject exists */
      var Subject = require('../../models/Subject.model');
      var subject = await Subject.findById(subjectId)
        .populate('department', 'name').lean();
      if (!subject) {
        return res.status(404).json({ success: false, message: 'Subject not found.' });
      }

      var deptName = subject.department ? subject.department.name : '';

      /* Build update fields */
      var update = {
        subjectName:    subject.name,
        departmentName: deptName,
        lastModifiedBy: callerName(req),
        lastModifiedAt: new Date()
      };

      var ALLOWED = [
        'count', 'duration', 'passMark', 'difficultyDistribution',
        'randomize', 'shuffleOptions', 'instructions', 'securityOptions'
      ];
      ALLOWED.forEach(function (f) {
        if (body[f] !== undefined) { update[f] = body[f]; }
      });

      /* Validate difficulty distribution */
      if (update.difficultyDistribution) {
        var dd = update.difficultyDistribution;
        var sum = (dd.easy || 0) + (dd.medium || 0) + (dd.hard || 0);
        if (sum < 95 || sum > 105) {
          return res.status(400).json({
            success: false,
            message: 'Difficulty distribution must total 100% (got ' + sum + '%).'
          });
        }
      }

      /* Compute status: check if pool has enough questions */
      var poolCount = await QMSQuestion.countDocuments({
        subjectId:    subjectId,
        questionType: questionType,
        examType:     { $in: [examType, 'all'] },
        status:       'approved'
      });
      var requiredCount = update.count || 40;
      update.status = poolCount >= requiredCount ? 'ready'
                    : poolCount > 0              ? 'incomplete'
                    :                              'draft';

      var bp = await ExaminationBlueprint.findOneAndUpdate(
        { subjectId: subjectId, examType: examType, questionType: questionType },
        { $set: update },
        { new: true, upsert: true, runValidators: true }
      );

      return res.json({
        success:   true,
        message:   'Blueprint saved. Status: ' + bp.status + '.',
        blueprint: bp
      });
    } catch (e) {
      console.error('[QMS Blueprint] PUT subject/:id:', e.message);
      return res.status(500).json({ success: false, message: e.message });
    }
  }
);

/* ----
   DELETE /api/qms/blueprint/:blueprintId
   Remove a blueprint. Subject and question pool are unaffected.
---- */
router.delete(
  '/blueprint/:blueprintId',
  adminOrPlatformStaff('question_bank'),
  async function (req, res) {
    try {
      var bp = await ExaminationBlueprint.findByIdAndDelete(req.params.blueprintId);
      if (!bp) {
        return res.status(404).json({ success: false, message: 'Blueprint not found.' });
      }
      return res.json({
        success: true,
        message: 'Blueprint deleted. The question pool is unchanged.'
      });
    } catch (e) {
      console.error('[QMS Blueprint] DELETE /:id:', e.message);
      return res.status(500).json({ success: false, message: e.message });
    }
  }
);

/* ============================================
   ✅ STAGE 3 — LEGACY MIGRATION ROUTES

   GET  /api/qms/migrate/dry-run   — read-only analysis
   POST /api/qms/migrate/commit    — execute migration
   GET  /api/qms/migrate/status    — check prior migrations

   SAFETY GUARANTEES:
     dry-run:  zero DB writes. Safe to run repeatedly.
     commit:   idempotent. Running twice never duplicates questions.
               Dedup check: normalised question text per subject.
     Both:     never touch legacy Question model. Read-only.
     Both:     never touch cbt.routes.js session flow.
============================================ */

/* ---- Normalise text for dedup comparison ---- */
function normText(text) {
  return (text || '').toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

/* ----
   GET /api/qms/migrate/dry-run
   Analyses all legacy Question documents and reports what would
   happen if migration were run right now.

   Returns: summary, bySubject[], orphans{count, sample[]},
            examTypeBreakdown{}, missingSubjects[]
   ZERO DB WRITES.
---- */
router.get('/migrate/dry-run', adminOrPlatformStaff('question_bank'), async function (req, res) {
  try {
    var Question = require('../../models/Question.model');

    /* 1. Load all legacy questions */
    var legacyAll = await Question.find({}).lean();

    if (legacyAll.length === 0) {
      return res.json({
        success: true,
        analysis: {
          summary: {
            totalLegacy: 0, activeCount: 0, inactiveCount: 0,
            orphanCount: 0, withSubject: 0,
            alreadyInQMS: 0, toMigrate: 0, missingSubjects: 0
          },
          bySubject: [], orphans: { count: 0, sample: [] },
          examTypeBreakdown: {}
        }
      });
    }

    /* 2. Load subject map for name lookups */
    var subjectDocs = await Subject.find({})
      .populate('department', 'name').lean();
    var subjMap = {};
    subjectDocs.forEach(function (s) {
      subjMap[s._id.toString()] = {
        name:       s.name,
        deptName:   s.department ? s.department.name : '—',
        deptId:     s.department ? s.department._id  : null
      };
    });

    /* 3. Load normalised QMS question texts for dedup
          Key: normText(question) + '|' + subjectId */
    var qmsTexts = await QMSQuestion.find({ status: { $ne: 'deleted' } })
      .select('question subjectId').lean();
    var qmsSet = new Set();
    qmsTexts.forEach(function (q) {
      var key = normText(q.question) + '|' + (q.subjectId ? q.subjectId.toString() : 'none');
      qmsSet.add(key);
    });

    /* 4. Analyse */
    var orphans   = [];
    var bySubject = {};
    var examTypes = {};
    var activeCount   = 0;
    var inactiveCount = 0;

    legacyAll.forEach(function (q) {
      if (q.isActive) activeCount++; else inactiveCount++;

      var et = q.examCategory || 'all';
      examTypes[et] = (examTypes[et] || 0) + 1;

      if (!q.subjectId) {
        orphans.push({
          _id:          q._id,
          question:     (q.question || '').substring(0, 80),
          examCategory: et,
          isActive:     q.isActive
        });
        return;
      }

      var sid       = q.subjectId.toString();
      var norm      = normText(q.question);
      var dedupeKey = norm + '|' + sid;
      var isDupe    = qmsSet.has(dedupeKey);
      var subjInfo  = subjMap[sid];

      if (!bySubject[sid]) {
        bySubject[sid] = {
          subjectId:     sid,
          subjectName:   subjInfo ? subjInfo.name    : '(Unknown Subject)',
          departmentName:subjInfo ? subjInfo.deptName : '—',
          subjectExists: !!subjInfo,
          legacyCount:   0,
          active:        0,
          inactive:      0,
          alreadyInQMS:  0,
          toMigrate:     0,
          examTypes:     {}
        };
      }

      bySubject[sid].legacyCount++;
      if (q.isActive) { bySubject[sid].active++; }
      else            { bySubject[sid].inactive++; }
      if (isDupe) { bySubject[sid].alreadyInQMS++; }
      else        { bySubject[sid].toMigrate++; }
      bySubject[sid].examTypes[et] = (bySubject[sid].examTypes[et] || 0) + 1;
    });

    var subjectRows    = Object.values(bySubject).sort(function (a, b) { return b.legacyCount - a.legacyCount; });
    var alreadyInQMS   = subjectRows.reduce(function (s, r) { return s + r.alreadyInQMS; }, 0);
    var toMigrate      = subjectRows.reduce(function (s, r) { return s + r.toMigrate;    }, 0);
    var missingSubjects = subjectRows.filter(function (r) { return !r.subjectExists; }).length;

    /* Assign per-subject status label */
    subjectRows.forEach(function (r) {
      r.status = !r.subjectExists              ? 'no_subject'
               : r.toMigrate === 0             ? 'all_duplicate'
               : r.alreadyInQMS > 0            ? 'partial'
               :                                 'ready';
    });

    return res.json({
      success: true,
      analysis: {
        summary: {
          totalLegacy:     legacyAll.length,
          activeCount:     activeCount,
          inactiveCount:   inactiveCount,
          orphanCount:     orphans.length,
          withSubject:     legacyAll.length - orphans.length,
          alreadyInQMS:    alreadyInQMS,
          toMigrate:       toMigrate,
          missingSubjects: missingSubjects
        },
        bySubject:         subjectRows,
        orphans:           { count: orphans.length, sample: orphans.slice(0, 10) },
        examTypeBreakdown: examTypes
      }
    });

  } catch (e) {
    console.error('[QMS Migrate] dry-run:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ----
   POST /api/qms/migrate/commit
   Migrates legacy Question documents into QMSQuestion.

   Safety:
     - Idempotent: dedup by normalised text per subject
     - Orphans skipped (no subjectId) — reported, not lost
     - Missing subjects skipped — reported
     - Inactive questions migrated as status:'archived'
     - Creates one ImportJob per commit as audit record
     - NEVER deletes legacy documents

   Body: { confirm: true }   (safety gate — must send explicitly)
---- */
router.post('/migrate/commit', adminOrPlatformStaff('question_bank'), async function (req, res) {
  var startTime = Date.now();
  try {
    if (req.body.confirm !== true) {
      return res.status(400).json({
        success: false,
        message: 'Send { confirm: true } to execute migration. Run dry-run first to verify.'
      });
    }

    var Question  = require('../../models/Question.model');
    var migratedBy = callerName(req);

    /* Load all legacy questions */
    var legacyAll = await Question.find({}).lean();
    if (legacyAll.length === 0) {
      return res.json({ success: true, message: 'No legacy questions to migrate.', results: { attempted: 0, migrated: 0 } });
    }

    /* Subject map */
    var subjectDocs = await Subject.find({})
      .populate('department', 'name _id').lean();
    var subjMap = {};
    subjectDocs.forEach(function (s) {
      subjMap[s._id.toString()] = {
        name:    s.name,
        deptName:s.department ? s.department.name  : '',
        deptId:  s.department ? s.department._id   : null
      };
    });

    /* Existing QMS normalised texts for dedup */
    var qmsTexts = await QMSQuestion.find({ status: { $ne: 'deleted' } })
      .select('question subjectId').lean();
    var qmsSet = new Set();
    qmsTexts.forEach(function (q) {
      qmsSet.add(normText(q.question) + '|' + (q.subjectId ? q.subjectId.toString() : 'none'));
    });

    /* Create migration audit ImportJob */
    var migJob = await ImportJob.create({
      importedBy:       migratedBy,
      sourceType:       'paste',          /* closest available enum value */
      originalFilename: 'legacy_migration',
      examType:         'all',
      status:           'processing',
      stats:            {
        detected:  legacyAll.length,
        valid:     0, duplicate: 0, rejected: 0, imported: 0
      }
    });

    /* Process in batches of 100 */
    var BATCH = 100;
    var totalMigrated   = 0;
    var totalDuplicate  = 0;
    var totalOrphan     = 0;
    var totalNoSubject  = 0;
    var totalErrors     = 0;
    var bySubjectResult = {};

    /* Group by subject for batch ID generation efficiency */
    var grouped = {};        /* sid → [questions] */
    var orphansList = [];

    legacyAll.forEach(function (q) {
      if (!q.subjectId) {
        orphansList.push(q);
        return;
      }
      var sid = q.subjectId.toString();
      if (!grouped[sid]) { grouped[sid] = []; }

      var dedupeKey = normText(q.question) + '|' + sid;
      if (qmsSet.has(dedupeKey)) {
        if (!bySubjectResult[sid]) { bySubjectResult[sid] = { migrated:0, duplicate:0, errors:0 }; }
        bySubjectResult[sid].duplicate++;
        totalDuplicate++;
      } else {
        grouped[sid].push(q);
      }
    });

    totalOrphan = orphansList.length;

    /* Migrate each subject's questions */
    var sids = Object.keys(grouped);
    for (var si = 0; si < sids.length; si++) {
      var sid       = sids[si];
      var qs        = grouped[sid];
      var subjInfo  = subjMap[sid];

      if (!subjInfo) {
        /* Subject doesn't exist in CBT Management — skip */
        totalNoSubject += qs.length;
        if (!bySubjectResult[sid]) { bySubjectResult[sid] = { migrated:0, duplicate:0, errors:0 }; }
        bySubjectResult[sid].noSubject = qs.length;
        continue;
      }

      if (!bySubjectResult[sid]) { bySubjectResult[sid] = { migrated:0, duplicate:0, errors:0 }; }

      /* Process in batches */
      for (var bStart = 0; bStart < qs.length; bStart += BATCH) {
        var batch = qs.slice(bStart, bStart + BATCH);

        /* Generate IDs for this batch */
        var batchIds;
        try {
          batchIds = await generateBatchIds(batch[0].examCategory || 'all', subjInfo.name, batch.length);
        } catch (idErr) {
          var ts = Date.now();
          batchIds = batch.map(function (_, idx) {
            return 'MIG-MIG-' + String(ts + idx).slice(-8).padStart(8, '0');
          });
        }

        var docs = batch.map(function (q, idx) {
          return {
            questionId:     batchIds[idx],
            examType:       q.examCategory || 'all',
            questionType:   'objective',
            subjectId:      q.subjectId,
            departmentId:   subjInfo.deptId   || null,
            subjectName:    subjInfo.name      || '',
            departmentName: subjInfo.deptName  || '',
            question:       q.question,
            options:        q.options,
            correctAnswer:  q.correctAnswer,
            explanation:    q.explanation      || '',
            topic:          '',
            difficulty:     'medium',
            year:           null,
            source:         'legacy_migration',
            status:         q.isActive ? 'approved' : 'archived',
            importJobId:    migJob._id,
            createdBy:      migratedBy,
            approvedBy:     migratedBy,
            approvedAt:     new Date(),
            versions:       []
          };
        });

        try {
          var insertResult = await QMSQuestion.insertMany(docs, { ordered: false });
          var insertedCount = insertResult.length;
          bySubjectResult[sid].migrated += insertedCount;
          totalMigrated                 += insertedCount;

          /* Add newly migrated texts to dedup set */
          docs.forEach(function (d) {
            qmsSet.add(normText(d.question) + '|' + (d.subjectId ? d.subjectId.toString() : 'none'));
          });
        } catch (insertErr) {
          var success = insertErr.insertedDocs ? insertErr.insertedDocs.length : 0;
          var errCount = batch.length - success;
          bySubjectResult[sid].migrated += success;
          bySubjectResult[sid].errors   += errCount;
          totalMigrated                 += success;
          totalErrors                   += errCount;
        }
      }
    }

    var processingMs = Date.now() - startTime;
    var finalStatus  = totalErrors > 0 ? 'partial' : 'completed';

    /* Update migration ImportJob */
    await ImportJob.findByIdAndUpdate(migJob._id, {
      $set: {
        status:            finalStatus,
        'stats.imported':  totalMigrated,
        'stats.duplicate': totalDuplicate,
        'stats.rejected':  totalOrphan + totalNoSubject + totalErrors,
        processingMs:      processingMs
      }
    });

    /* Build per-subject result rows */
    var resultRows = Object.keys(bySubjectResult).map(function (sid) {
      var r       = bySubjectResult[sid];
      var subjInf = subjMap[sid];
      return {
        subjectId:   sid,
        subjectName: subjInf ? subjInf.name : '(Unknown)',
        migrated:    r.migrated    || 0,
        duplicate:   r.duplicate   || 0,
        noSubject:   r.noSubject   || 0,
        errors:      r.errors      || 0
      };
    }).sort(function (a, b) { return b.migrated - a.migrated; });

    return res.json({
      success: true,
      message: totalMigrated + ' question' + (totalMigrated !== 1 ? 's' : '') +
               ' migrated from legacy CBT into the QMS Question Bank.',
      results: {
        attempted:   legacyAll.length,
        migrated:    totalMigrated,
        duplicate:   totalDuplicate,
        orphan:      totalOrphan,
        noSubject:   totalNoSubject,
        errors:      totalErrors,
        processingMs:processingMs,
        jobId:       migJob._id,
        status:      finalStatus
      },
      bySubject: resultRows
    });

  } catch (e) {
    console.error('[QMS Migrate] commit:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ----
   GET /api/qms/migrate/status
   Returns the history of migration jobs and current
   counts in both legacy and QMS models.
---- */
router.get('/migrate/status', adminOrPlatformStaff('question_bank'), async function (req, res) {
  try {
    var Question = require('../../models/Question.model');

    var [
      legacyTotal, legacyActive, legacyInactive,
      qmsTotal, qmsMigrated, qmsApproved,
      migrationJobs
    ] = await Promise.all([
      Question.countDocuments({}),
      Question.countDocuments({ isActive: true }),
      Question.countDocuments({ isActive: false }),
      QMSQuestion.countDocuments({ status: { $ne: 'deleted' } }),
      QMSQuestion.countDocuments({ source: 'legacy_migration', status: { $ne: 'deleted' } }),
      QMSQuestion.countDocuments({ status: 'approved' }),
      ImportJob.find({ originalFilename: 'legacy_migration' })
        .sort({ createdAt: -1 }).limit(10).lean()
    ]);

    var isMigrated = migrationJobs.some(function (j) {
      return j.status === 'completed' || j.status === 'partial';
    });

    return res.json({
      success: true,
      status: {
        isMigrated:      isMigrated,
        legacy:  { total: legacyTotal, active: legacyActive, inactive: legacyInactive },
        qms:     { total: qmsTotal, migrated: qmsMigrated, approved: qmsApproved },
        jobs:    migrationJobs
      }
    });
  } catch (e) {
    console.error('[QMS Migrate] status:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;