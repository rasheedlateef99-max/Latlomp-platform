/* ============================================
   QMS QUESTION PARSER

   Supported input formats:

   Format A — Labeled prefix:
     Question: What is 2 + 2?
     A. 3
     B. 4
     C. 5
     D. 6
     Answer: B

   Format B — Numbered:
     1. What is 2 + 2?
     A. 3
     B. 4
     C. 5
     D. 6
     Answer: B

   Format C — No prefix (plain question text):
     What is 2 + 2?
     A) 3
     B) 4
     C) 5
     D) 6
     Ans: B

   Format D — Parenthesised options:
     What is 2 + 2?
     (A) 3
     (B) 4
     (C) 5
     (D) 6
     Correct: B

   All formats support optional:
     Explanation: Why option B is correct.
============================================ */
'use strict';

var OPTION_RE  = /^([A-Da-d])\s*[.)]\s+(.+)$|^\(([A-Da-d])\)\s*(.+)$/;
var ANSWER_RE  = /^(?:answer|ans|correct|key|solution|answer key)\s*[:\-=]\s*\(?([A-Da-d1-4])\)?/i;
var EXPL_RE    = /^(?:explanation|expl|exp|reason|note|solution|workings?|hint|remark)\s*[:=]\s*(.+)/i;
var Q_LABEL_RE = /^(?:question|q)\s*\d*\s*[:.)]\s*(.+)/i;
var Q_NUM_RE   = /^\d+\s*[.)]\s*(.+)/;

var LETTER_MAP = { 'A': 0, 'B': 1, 'C': 2, 'D': 3, '1': 0, '2': 1, '3': 2, '4': 3 };

function letterToIndex(ch) {
  return LETTER_MAP[(ch || '').toUpperCase()];
}

/* Parse a single question block (array of lines) */
function parseBlock(lines) {
  var qLines      = [];
  var options     = [];
  var correctIdx  = undefined;
  var explanation = '';
  var optionSeen  = false;

  lines.forEach(function (line) {
    line = line.trim();
    if (!line) { return; }

    var ansMatch  = line.match(ANSWER_RE);
    var optMatch  = line.match(OPTION_RE);
    var explMatch = line.match(EXPL_RE);
    var qLblMatch = (!optionSeen && qLines.length === 0) ? line.match(Q_LABEL_RE) : null;
    var qNumMatch = (!optionSeen && qLines.length === 0) ? line.match(Q_NUM_RE)   : null;

    if (ansMatch) {
      var idx = letterToIndex(ansMatch[1]);
      if (idx !== undefined) { correctIdx = idx; }
    } else if (explMatch) {
      explanation = explMatch[1].trim();
    } else if (optMatch) {
      optionSeen = true;
      /* optMatch[2] for "A. text", optMatch[4] for "(A) text" */
      var optText = (optMatch[2] || optMatch[4] || '').trim();
      options.push(optText);
    } else if (qLblMatch) {
      qLines.push(qLblMatch[1].trim());
    } else if (qNumMatch) {
      qLines.push(qNumMatch[1].trim());
    } else if (!optionSeen) {
      /* Multi-line question text continuation */
      qLines.push(line);
    }
    /* Lines after options that are not answer/explanation are ignored */
  });

  return {
    question:      qLines.join(' ').replace(/\s+/g, ' ').trim(),
    options:       options,
    correctAnswer: (correctIdx !== undefined) ? correctIdx : null,
    explanation:   explanation
  };
}

/* Split raw text into individual question blocks */
function splitBlocks(text) {
  /* Prefer numbered split (1. 2. 3.) when it produces multiple blocks containing options */
  var numSplit = text.split(/(?=^\d+\s*[.)]\s+)/m).filter(function (b) { return b.trim(); });
  if (numSplit.length > 1) {
    var hasOptions = numSplit.some(function (b) { return OPTION_RE.test(b); });
    if (hasOptions) { return numSplit; }
  }
  /* Fall back to blank-line separation */
  return text.split(/\n\s*\n/).filter(function (b) { return b.trim(); });
}

/* ============================================
   parseText — Main entry point for paste import
   Returns: { questions:[], warnings:[], parseErrors:0 }
============================================ */
function parseText(rawText) {
  if (!rawText || !rawText.trim()) {
    return { questions: [], warnings: ['Input text is empty.'], parseErrors: 0 };
  }

  var text       = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  var blocks     = splitBlocks(text);
  var questions  = [];
  var warnings   = [];
  var parseErrors = 0;

  blocks.forEach(function (block, i) {
    var lines  = block.split('\n');
    var parsed = parseBlock(lines);

    if (!parsed.question) {
      warnings.push('Block ' + (i + 1) + ': No question text detected — skipped.');
      parseErrors++;
      return;
    }
    if (parsed.options.length < 2) {
      warnings.push(
        'Block ' + (i + 1) + ' ("' + parsed.question.substring(0, 40) + '..."): ' +
        'Fewer than 2 options (' + parsed.options.length + ' found) — skipped.'
      );
      parseErrors++;
      return;
    }

    questions.push(parsed);
  });

  return { questions: questions, warnings: warnings, parseErrors: parseErrors };
}

/* ============================================
   parseCsv — Entry point for CSV file import
   Expected columns:
     question, option_a, option_b, option_c, option_d,
     correct_answer [, explanation]
   Returns: { questions:[], warnings:[], parseErrors:0 }
============================================ */
function parseCsv(csvText) {
  var lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .split('\n').map(function (l) { return l.trim(); }).filter(Boolean);

  if (!lines.length) {
    return { questions: [], warnings: ['CSV file is empty.'], parseErrors: 0 };
  }

  /* Parse header row */
  var header  = parseCsvLine(lines[0]).map(function (h) {
    return h.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
  });

  var idx = {
    question: header.findIndex(function (h) { return h === 'question'; }),
    a:        header.findIndex(function (h) { return h === 'option_a' || h === 'a'; }),
    b:        header.findIndex(function (h) { return h === 'option_b' || h === 'b'; }),
    c:        header.findIndex(function (h) { return h === 'option_c' || h === 'c'; }),
    d:        header.findIndex(function (h) { return h === 'option_d' || h === 'd'; }),
    ans:      header.findIndex(function (h) {
      return h === 'correct_answer' || h === 'answer' || h === 'correct' || h === 'ans';
    }),
    expl:     header.findIndex(function (h) { return h === 'explanation' || h === 'expl'; })
  };

  if (idx.question < 0) {
    return {
      questions: [], parseErrors: 0,
      warnings: ['CSV missing "question" column. Expected columns: question, option_a, option_b, option_c, option_d, correct_answer']
    };
  }

  var questions   = [];
  var warnings    = [];
  var parseErrors = 0;

  lines.slice(1).forEach(function (line, i) {
    var row    = i + 2; /* 1-indexed, skipping header */
    var cols   = parseCsvLine(line);
    var q      = idx.question >= 0 ? (cols[idx.question] || '').trim() : '';
    var optA   = idx.a   >= 0 ? (cols[idx.a]   || '').trim() : '';
    var optB   = idx.b   >= 0 ? (cols[idx.b]   || '').trim() : '';
    var optC   = idx.c   >= 0 ? (cols[idx.c]   || '').trim() : '';
    var optD   = idx.d   >= 0 ? (cols[idx.d]   || '').trim() : '';
    var ans    = idx.ans  >= 0 ? (cols[idx.ans]  || '').trim() : '';
    var expl   = idx.expl >= 0 ? (cols[idx.expl] || '').trim() : '';

    if (!q) {
      warnings.push('Row ' + row + ': Empty question — skipped.');
      parseErrors++;
      return;
    }

    var options = [optA, optB, optC, optD].filter(Boolean);
    if (options.length < 2) {
      warnings.push('Row ' + row + ': Fewer than 2 options — skipped.');
      parseErrors++;
      return;
    }

    var correctIdx = letterToIndex(ans);
    questions.push({
      question:      q,
      options:       options,
      correctAnswer: (correctIdx !== undefined) ? correctIdx : null,
      explanation:   expl
    });
  });

  return { questions: questions, warnings: warnings, parseErrors: parseErrors };
}

/* Simple CSV line parser that handles quoted fields */
function parseCsvLine(line) {
  var result   = [];
  var current  = '';
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if      (ch === '"')                   { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes)      { result.push(current.trim()); current = ''; }
    else                                   { current += ch; }
  }
  result.push(current.trim());
  return result;
}

module.exports = { parseText: parseText, parseCsv: parseCsv };