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
const engine      = require('../services/question.engine');

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



/* ---- Question ID generator ---- */
async function generateQuestionId(examType, subjectName) {
  var prefix = (examType || 'GEN').toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 8);
  var subj   = (subjectName || 'GEN').toUpperCase().replace(/[^A-Z]/g, '').substring(0, 3);
  /* Count existing questions for this exam type to build sequence number */
  var count  = await QMSQuestion.countDocuments({ examType: examType });
  var seq    = String(count + 1).padStart(8, '0');
  return prefix + '-' + subj + '-' + seq;
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

    /* Build document array */
    var docs   = [];
    var errors = [];

    for (var i = 0; i < questions.length; i++) {
      var q = questions[i];
      try {
        var qId = await generateQuestionId(examType, subjectName);
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
    var inserted = 0;
    if (docs.length > 0) {
      try {
        var result = await QMSQuestion.insertMany(docs, { ordered: false });
        inserted   = result.length;
      } catch (insertErr) {
        /* ordered:false → partial inserts possible */
        if (insertErr.insertedDocs) { inserted = insertErr.insertedDocs.length; }
        if (insertErr.writeErrors) {
          insertErr.writeErrors.forEach(function (we) {
            errors.push({ index: we.index, error: we.errmsg });
          });
        }
      }
    }

    /* Update job record */
    var finalStatus = inserted === docs.length ? 'completed'
                    : inserted > 0             ? 'partial'
                    :                            'failed';

    await ImportJob.findByIdAndUpdate(job._id, {
      $set: {
        status:           finalStatus,
        'stats.imported': inserted,
        processingMs:     Date.now() - startTime
      }
    });

    return res.json({
      success:    true,
      message:    inserted + ' question' + (inserted !== 1 ? 's' : '') + ' imported successfully.',
      imported:   inserted,
      total:      docs.length,
      errors:     errors.length,
      jobId:      job._id,
      status:     finalStatus
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

/* ----
   GET /api/qms/bank/count
   Fast count for dashboard overview.
   Returns count grouped by examType and status.
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
      var qmsFilter    = { status: 'approved' };
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
            subjectName: s.name,
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

      /* Source type distribution from ImportJobs */
      ImportJob.aggregate([
        { $match: { status: 'completed' } },
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

      /* Weekly velocity — questions added per week */
      QMSQuestion.aggregate([
        { $match: { createdAt: { $gte: eightWeeksAgo }, status: { $ne: 'deleted' } } },
        { $group: {
          _id:   { $dateToString: { format: '%Y-W%V', date: '$createdAt' } },
          count: { $sum: 1 }
        }},
        { $sort: { _id: 1 } },
        { $limit: 8 }
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

module.exports = router;