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

/* ---- Multer for file uploads ---- */
var multer = null;
var upload = null;
try {
  multer = require('multer');
  upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 10 * 1024 * 1024 } /* 10MB */
  });
  console.log('✅ [QMS] File upload ready (multer/memory)');
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
      } else {
        return res.status(400).json({
          success: false,
          message: 'Only .txt and .csv files are supported in Phase 1. ' +
                   'DOCX and XLSX support is coming in Phase 2.'
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

module.exports = router;