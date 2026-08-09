/* ============================================
   LATLOMP PLATFORM — QIE HELPERS
   Phase 6: Shared Question Input Engine utilities.

   Used by three isolated systems:
     Institution CBT  (SchoolQuestion)
     Institution Paper (PaperQuestion)
     Teacher Platform  (TeacherQuestion)

   Each system imports into its OWN model.
   This file never touches QMSQuestion or CBT
   Question model. Isolation is preserved.
============================================ */
'use strict';

/* ============================================
   CSV / TXT PARSER
   Accepts the standard QIE import format:
   question, option_a, option_b, option_c, option_d,
   correct_answer (A/B/C/D or 0/1/2/3),
   explanation, difficulty, topic
============================================ */
function parseCSVText(text) {
  var lines = (text || '').split('\n')
    .map(function (l) { return l.trim(); })
    .filter(Boolean);

  if (!lines.length) { return []; }

  /* Skip header row if detected */
  var start = 0;
  var firstLower = lines[0].toLowerCase();
  if (firstLower.indexOf('question') !== -1 || firstLower.indexOf('option') !== -1) {
    start = 1;
  }

  var LETTERS = ['A', 'B', 'C', 'D', 'E'];
  var questions = [];

  for (var i = start; i < lines.length; i++) {
    var cols = parseCSVLine(lines[i]);
    if (!cols.length || !cols[0]) { continue; }

    var qText = stripQuotes(cols[0]).trim();
    if (!qText) { continue; }

    /* Options: cols 1–4 */
    var options = [];
    for (var oi = 1; oi <= 4; oi++) {
      var opt = cols[oi] ? stripQuotes(cols[oi]).trim() : '';
      if (opt) { options.push(opt); }
    }

    /* Correct answer: col 5 — A/B/C/D or 0/1/2/3 */
    var correctAnswer = 0;
    var ansRaw = (cols[5] || 'A').trim().toUpperCase();
    var letterIdx = LETTERS.indexOf(ansRaw);
    if (letterIdx !== -1) {
      correctAnswer = letterIdx;
    } else {
      var parsed = parseInt(ansRaw);
      if (!isNaN(parsed)) { correctAnswer = parsed; }
    }

    var explanation = cols[6] ? stripQuotes(cols[6]).trim() : '';
    var difficulty  = (cols[7] || 'medium').toLowerCase().trim();
    if (['easy', 'medium', 'hard'].indexOf(difficulty) === -1) { difficulty = 'medium'; }
    var topic = cols[8] ? stripQuotes(cols[8]).trim() : '';

    /* If fewer than 2 options detected, treat as theory */
    var qType = options.length >= 2 ? 'objective' : 'theory';

    questions.push({
      question:      qText,
      questionType:  qType,
      options:       options,
      correctAnswer: Math.max(0, Math.min(correctAnswer, Math.max(0, options.length - 1))),
      explanation:   explanation,
      difficulty:    difficulty,
      topic:         topic
    });
  }

  return questions;
}

/* RFC 4180-compatible CSV line splitter */
function parseCSVLine(line) {
  var result  = [];
  var current = '';
  var inQ     = false;

  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { current += '"'; i++; }
      else { inQ = !inQ; }
    } else if (ch === ',' && !inQ) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function stripQuotes(s) {
  s = (s || '').trim();
  if (s.startsWith('"') && s.endsWith('"')) { s = s.slice(1, -1); }
  return s.replace(/""/g, '"');
}

/* ============================================
   FILE BUFFER PARSER
   Delegates to platform parsers for docx/xlsx.
   Falls back to CSV parser for txt/csv.
   Always returns { valid:[], rejected:[] }.
============================================ */
async function parseFileBuffer(buffer, filename) {
  var ext = (filename || '').toLowerCase().split('.').pop();

  if (ext === 'csv' || ext === 'txt') {
    return { valid: parseCSVText(buffer.toString('utf8')), rejected: [] };
  }

  if (ext === 'docx') {
    try {
      var docxParser = require('./docx.parser');
      var result     = await docxParser.parseDocxBuffer(buffer);
      if (Array.isArray(result))  { return { valid: result,       rejected: [] }; }
      if (result && result.valid) { return { valid: result.valid, rejected: result.rejected || [] }; }
      return { valid: [], rejected: [{ reason: 'DOCX parser returned unexpected format.' }] };
    } catch (e) {
      return { valid: [], rejected: [{ reason: 'DOCX parsing failed: ' + e.message }] };
    }
  }

  if (ext === 'xlsx' || ext === 'xls') {
    try {
      var xlsxParser = require('./xlsx.parser');
      var result     = xlsxParser.parseXlsxBuffer(buffer);
      if (Array.isArray(result))  { return { valid: result,       rejected: [] }; }
      if (result && result.valid) { return { valid: result.valid, rejected: result.rejected || [] }; }
      return { valid: [], rejected: [{ reason: 'XLSX parser returned unexpected format.' }] };
    } catch (e) {
      return { valid: [], rejected: [{ reason: 'XLSX parsing failed: ' + e.message }] };
    }
  }

  return {
    valid: [],
    rejected: [{ reason: 'Unsupported file type ".' + ext + '". Use CSV, TXT, DOCX, or XLSX.' }]
  };
}

/* ============================================
   VALIDATOR
   Normalises and validates parsed questions.
   Returns { valid:[], rejected:[] }.
============================================ */
function validateQuestions(rawQuestions) {
  var valid    = [];
  var rejected = [];

  (rawQuestions || []).forEach(function (q, i) {
    if (!q.question || !q.question.trim()) {
      rejected.push({ index: i, question: q.question || '', reason: 'Question text is required.' });
      return;
    }

    var qt = ((q.questionType || 'objective') + '').toLowerCase().trim();
    if (['objective', 'theory', 'fill_in_blank', 'true_false'].indexOf(qt) === -1) {
      qt = 'objective';
    }

    var opts = (q.options || []).map(function (o) { return (o || '').trim(); }).filter(Boolean);

    if (qt === 'objective' && opts.length < 2) {
      rejected.push({ index: i, question: q.question, reason: 'Objective questions require at least 2 options.' });
      return;
    }

    var ca = typeof q.correctAnswer === 'number' ? q.correctAnswer : 0;
    if (qt === 'objective' && (ca < 0 || ca >= opts.length)) { ca = 0; }

    valid.push({
      question:      q.question.trim(),
      questionType:  qt,
      options:       qt === 'theory' ? [] : opts,
      correctAnswer: qt === 'theory' ? 0 : ca,
      explanation:   (q.explanation || '').trim(),
      difficulty:    ['easy', 'medium', 'hard'].indexOf(q.difficulty) !== -1 ? q.difficulty : 'medium',
      topic:         (q.topic || '').trim()
    });
  });

  return { valid: valid, rejected: rejected };
}

/* ============================================
   CSV CELL ENCODER
   Wraps value in quotes if it contains commas,
   quotes, or newlines.
============================================ */
function csvCell(val) {
  var s = String(val === null || val === undefined ? '' : val);
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/* ============================================
   IMPORT TEMPLATE CSV
   Downloadable starting point for users.
   correct_answer: A/B/C/D (column 6).
============================================ */
var TEMPLATE_CSV = [
  'question,option_a,option_b,option_c,option_d,correct_answer,explanation,difficulty,topic',
  '"What is the capital of Nigeria?","Lagos","Abuja","Kano","Ibadan","B","Abuja became the capital in 1991.","easy","geography"',
  '"Which organ pumps blood around the body?","Brain","Lungs","Heart","Liver","C","The heart is the circulatory pump.","easy","biology"',
  '"Solve: 15 × 4","45","55","60","65","C","15 × 4 = 60.","medium","mathematics"',
  '"Theory question example — leave option columns blank","","","","","","","medium","general"'
].join('\n');

module.exports = {
  parseCSVText:      parseCSVText,
  parseCSVLine:      parseCSVLine,
  csvCell:           csvCell,
  parseFileBuffer:   parseFileBuffer,
  validateQuestions: validateQuestions,
  TEMPLATE_CSV:      TEMPLATE_CSV
};