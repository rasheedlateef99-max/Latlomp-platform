/* ============================================
   QMS QUESTION VALIDATOR

   Performs three levels of validation:
     Level 1 — Field validation (missing fields)
     Level 2 — Batch deduplication (same import)
     Level 3 — Database deduplication (existing bank)

   Returns: { valid:[], duplicates:[], rejected:[], stats:{} }
============================================ */
'use strict';

/* Lazy-load to avoid circular dependency issues */
var _QMSQuestion = null;
function getModel() {
  if (!_QMSQuestion) {
    try { _QMSQuestion = require('../models/QMSQuestion.model'); } catch(e) { /* model may not exist yet */ }
  }
  return _QMSQuestion;
}

/* Normalize text for duplicate comparison */
function normalizeForDedupe(text) {
  return (text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

/* ============================================
   validate(questions, opts)
   opts: { examType, subjectId }
============================================ */
async function validate(questions, opts) {
  opts      = opts || {};
  var examType  = opts.examType  || '';
  var subjectId = opts.subjectId || null;

  var valid      = [];
  var duplicates = [];
  var rejected   = [];
  var seenNorms  = {}; /* within-batch dedupe */

  /* Load existing normalized question texts from DB for this exam+subject */
  var existingNorms = {};
  var QMSQuestion   = getModel();
  if (QMSQuestion && subjectId) {
    try {
      var existing = await QMSQuestion.find({
        examType:  examType,
        subjectId: subjectId,
        status:    { $ne: 'deleted' }
      }).select('question').lean();
      existing.forEach(function (q) {
        existingNorms[normalizeForDedupe(q.question)] = true;
      });
    } catch (e) {
      /* If model doesn't exist yet (first import), skip DB check */
    }
  }

  questions.forEach(function (q, i) {
    /* ---- Level 1: Field validation ---- */
    var reason = null;

    if (!q.question || !q.question.trim()) {
      reason = 'Missing question text';
    } else if (!q.options || q.options.length < 2) {
      reason = 'Fewer than 2 options (' + (q.options ? q.options.length : 0) + ' found)';
    } else if (q.correctAnswer === null || q.correctAnswer === undefined) {
      reason = 'Missing correct answer — could not detect answer line';
    } else if (typeof q.correctAnswer !== 'number' || isNaN(q.correctAnswer)) {
      reason = 'Correct answer is not a valid number';
    } else if (q.correctAnswer < 0 || q.correctAnswer >= q.options.length) {
      reason = 'Correct answer index (' + q.correctAnswer + ') out of range — only ' + q.options.length + ' options';
    }

    if (reason) {
      rejected.push({
        index:    i,
        question: (q.question || '(empty)').substring(0, 80),
        reason:   reason
      });
      return;
    }

    /* ---- Level 2: Within-batch duplicate ---- */
    var norm = normalizeForDedupe(q.question);

    if (seenNorms[norm]) {
      duplicates.push({
        index:    i,
        question: q.question.substring(0, 80),
        reason:   'Duplicate within this import batch'
      });
      return;
    }

    /* ---- Level 3: Database duplicate ---- */
    if (existingNorms[norm]) {
      duplicates.push({
        index:    i,
        question: q.question.substring(0, 80),
        reason:   'Already exists in Question Bank'
      });
      return;
    }

    seenNorms[norm] = true;
    valid.push(q);
  });

  return {
    valid:      valid,
    duplicates: duplicates,
    rejected:   rejected,
    stats: {
      detected:  questions.length,
      valid:     valid.length,
      duplicate: duplicates.length,
      rejected:  rejected.length
    }
  };
}

module.exports = { validate: validate };