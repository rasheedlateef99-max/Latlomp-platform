/* ============================================
   QMS QUESTION PARSER
   ✅ STEP 2: Theory-aware rewrite.
   
   Objective parsing: UNCHANGED from original.
   Theory parsing: complete rewrite.
     Primary boundary:  QUESTION N / Q. N headers
     Secondary:         "---" / "===" separator lines
     Tertiary:          double blank lines
     Fallback:          single blank line
   
   Objective formats supported (unchanged):
     Format A — Labeled prefix:  "Question: ..."
     Format B — Numbered:        "1. What is..."
     Format C — Plain text
     Format D — Parenthesised options "(A) ..."
   
   Theory formats supported (new):
     Format T1 — QUESTION N headers:
       QUESTION 1 [8 MARKS]
       (a) Question text...
       DETAILED SOLUTION & MARKING SCHEME
       (a) Answer...
     Format T2 — ModelAnswer labels:
       Question: What is osmosis?
       ModelAnswer: Movement of water...
       Marks: 5
     Format T3 — CSV (via parseCsv with theory opts)
     Format T4 — "---" separators between questions
============================================ */
'use strict';

/* ============================================
   OBJECTIVE PARSING CONSTANTS (unchanged)
============================================ */
var OPTION_RE  = /^([A-Da-d])\s*[.)]\s+(.+)$|^\(([A-Da-d])\)\s*(.+)$/;
var ANSWER_RE  = /^(?:answer|ans|correct|key|solution|answer key)\s*[:\-=]\s*\(?([A-Da-d1-4])\)?/i;
var EXPL_RE    = /^(?:explanation|expl|exp|reason|note|solution|workings?|hint|remark)\s*[:=]\s*(.+)/i;
var Q_LABEL_RE = /^(?:question|q)\s*\d*\s*[:.)]\s*(.+)/i;
var Q_NUM_RE   = /^\d+\s*[.)]\s*(.+)/;
var LETTER_MAP = { 'A': 0, 'B': 1, 'C': 2, 'D': 3, '1': 0, '2': 1, '3': 2, '4': 3 };

/* ============================================
   THEORY PARSING CONSTANTS (new)
============================================ */

/* Matches "QUESTION 1", "QUESTION 1 [8 MARKS]", "Q. 1", "Q1 ", "Q 1" at line start.
   The lookahead (?=\s|\[|$) avoids matching "Q1: something" mid-sentence. */
var TH_BOUNDARY_RE = /^[ \t]*(?:QUESTION\s+\d+|Q\.?\s*\d+)(?=\s|\[|$)/m;

/* Matches "[8 MARKS]" or "(8 MARKS)" or "[8 marks]" anywhere in a line */
var TH_MARKS_HDR_RE = /[\[\(](\d+)\s*MARKS?[\]\)]/i;

/* Matches solution/answer section headers on their own line */
var TH_SOL_HEADER_RE = new RegExp(
  '^[ \\t]*(?:' +
    '(?:DETAILED\\s+)?SOLUTION\\s*(?:(?:&|AND)\\s*MARKING\\s+SCHEME)?' + '|' +
    '(?:DETAILED\\s+)?MARKING\\s+SCHEME' + '|' +
    'MARK\\s+SCHEME' + '|' +
    'MODEL\\s+ANSWER' + '|' +
    'EXPECTED\\s+ANSWER' + '|' +
    'REFERENCE\\s+ANSWER' + '|' +
    'WORKED\\s+SOLUTION' + '|' +
    'FULL\\s+SOLUTION' + '|' +
    'OFFICIAL\\s+ANSWER'  +
  ')\\s*:?\\s*$',
  'im'
);

/* Matches labeled model answer in paste format: "ModelAnswer: ..." */
var TH_MODEL_INLINE_RE = /^(?:model[\s_-]?answer|expected[\s_-]?answer|reference[\s_-]?answer|model|expected|scheme|marking[\s_-]?guide|mark[\s_-]?scheme)\s*[:=]\s*(.+)/i;

/* Matches labeled marks line: "Marks: 5" */
var TH_MARKS_LINE_RE   = /^(?:marks?|score|points?|total[\s_-]?marks?)\s*[:=]\s*(\d+)/i;

function letterToIndex(ch) {
  return LETTER_MAP[(ch || '').toUpperCase()];
}

/* ============================================
   OBJECTIVE BLOCK SPLITTER (unchanged)
============================================ */
function splitBlocks(text) {
  var numSplit = text.split(/(?=^\d+\s*[.)]\s+)/m).filter(function(b) { return b.trim(); });
  if (numSplit.length > 1) {
    var hasOptions = numSplit.some(function(b) { return OPTION_RE.test(b); });
    if (hasOptions) { return numSplit; }
  }
  return text.split(/\n\s*\n/).filter(function(b) { return b.trim(); });
}

/* ============================================
   OBJECTIVE BLOCK PARSER (unchanged)
============================================ */
function parseBlock(lines, questionType) {
  questionType = questionType || 'objective';
  var isTheory = (questionType === 'theory');

  var qLines      = [];
  var options     = [];
  var correctIdx  = undefined;
  var explanation = '';
  var modelAnswer = '';
  var marks       = null;
  var optionSeen  = false;

  lines.forEach(function(line) {
    line = line.trim();
    if (!line) { return; }

    var ansMatch      = line.match(ANSWER_RE);
    var optMatch      = line.match(OPTION_RE);
    var explMatch     = line.match(EXPL_RE);
    var modelAnsMatch = line.match(TH_MODEL_INLINE_RE);
    var marksMatch    = line.match(TH_MARKS_LINE_RE);
    var qLblMatch     = (!optionSeen && qLines.length === 0) ? line.match(Q_LABEL_RE) : null;
    var qNumMatch     = (!optionSeen && qLines.length === 0) ? line.match(Q_NUM_RE)   : null;

    if (modelAnsMatch) {
      modelAnswer = modelAnsMatch[1].trim();
    } else if (marksMatch) {
      marks = parseInt(marksMatch[1]) || null;
    } else if (ansMatch && !isTheory) {
      var idx = letterToIndex(ansMatch[1]);
      if (idx !== undefined) { correctIdx = idx; }
    } else if (explMatch) {
      explanation = explMatch[1].trim();
    } else if (optMatch && !isTheory) {
      optionSeen = true;
      var optText = (optMatch[2] || optMatch[4] || '').trim();
      options.push(optText);
    } else if (qLblMatch) {
      qLines.push(qLblMatch[1].trim());
    } else if (qNumMatch) {
      qLines.push(qNumMatch[1].trim());
    } else if (!optionSeen) {
      qLines.push(line);
    }
  });

  var result = {
    question:      qLines.join(' ').replace(/\s+/g, ' ').trim(),
    options:       options,
    correctAnswer: (correctIdx !== undefined) ? correctIdx : null,
    explanation:   explanation
  };

  if (isTheory) {
    result.questionType  = 'theory';
    result.modelAnswer   = modelAnswer;
    result.correctAnswer = null;
    result.options       = [];
    if (marks !== null) { result.marks = marks; }
  }

  return result;
}

/* ============================================
   ✅ STEP 2 — THEORY BLOCK SPLITTER
   
   Primary:   split on QUESTION N / Q. N headers
   Secondary: split on "---" / "===" separators
   Tertiary:  split on double blank lines
   Fallback:  split on single blank line
   
   The QUESTION N approach is line-by-line so
   blank lines WITHIN a question are preserved
   as part of that question's block. This is why
   the old /\n\s*\n/ fallback shattered theory
   questions — it split on every blank line.
============================================ */
function splitTheoryBlocks(text) {
  /* ---- PRIMARY: QUESTION N boundaries ---- */
  var lines  = text.split('\n');
  var blocks = [];
  var current = [];
  var hasQBoundary = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    /* Only try boundary detection after the first line */
    if (i > 0 && TH_BOUNDARY_RE.test(line)) {
      hasQBoundary = true;
      var blockText = current.join('\n').trim();
      if (blockText.length > 0) { blocks.push(blockText); }
      current = [line];
    } else {
      current.push(line);
    }
  }
  /* Push the final block */
  var last = current.join('\n').trim();
  if (last.length > 0) { blocks.push(last); }

  if (hasQBoundary && blocks.length > 1) { return blocks; }

  /* ---- SECONDARY: "---" / "===" / "***" separators ---- */
  var sepBlocks = text.split(/^[ \t]*[-=*]{3,}[ \t]*$/m)
    .map(function(b) { return b.trim(); })
    .filter(function(b) { return b.length > 10; });
  if (sepBlocks.length > 1) { return sepBlocks; }

  /* ---- TERTIARY: Double (or triple) blank lines ---- */
  var dblBlocks = text.split(/\n[ \t]*\n[ \t]*\n/)
    .map(function(b) { return b.trim(); })
    .filter(function(b) { return b.length > 0; });
  if (dblBlocks.length > 1) { return dblBlocks; }

  /* ---- FALLBACK: Single blank line ---- */
  return text.split(/\n[ \t]*\n/)
    .map(function(b) { return b.trim(); })
    .filter(function(b) { return b.length > 0; });
}

/* ============================================
   ✅ STEP 2 — THEORY BLOCK PARSER
   
   Given one theory block, extracts:
     question text  — everything before the solution header
     modelAnswer    — everything after the solution header
     marks          — from "[N MARKS]" or "Marks: N"
   
   Handles WAEC-style format:
     QUESTION 1 [8 MARKS]
     (a) evaluate: ...
     (b) A trader bought...
     DETAILED SOLUTION & MARKING SCHEME
     (a) LHS = ...  [M1] ... [A1]
     (b) Profit = ...  [A1]
============================================ */
function parseTheoryBlock(blockText) {
  if (!blockText || !blockText.trim()) { return null; }

  var lines    = blockText.split('\n');
  var marks    = null;

  /* Check header line for marks: "QUESTION 1 [8 MARKS]" */
  if (lines.length > 0) {
    var hdrMarks = lines[0].match(TH_MARKS_HDR_RE);
    if (hdrMarks) { marks = parseInt(hdrMarks[1]); }
  }

  var qLines   = [];
  var ansLines = [];
  var inAnswer = false;

  for (var i = 0; i < lines.length; i++) {
    var line     = lines[i];
    var trimLine = line.trim();

    if (!inAnswer) {
      /* Solution/answer section header? */
      if (TH_SOL_HEADER_RE.test(trimLine)) {
        inAnswer = true;
        continue;         /* skip the header line itself */
      }
      /* Inline ModelAnswer: label? */
      var inlineMatch = trimLine.match(TH_MODEL_INLINE_RE);
      if (inlineMatch) {
        ansLines.push(inlineMatch[1]);
        inAnswer = true;
        continue;
      }
      /* Inline Marks: N line? */
      if (!marks) {
        var marksLine = trimLine.match(TH_MARKS_LINE_RE);
        if (marksLine) {
          marks = parseInt(marksLine[1]);
          continue;       /* don't include "Marks: 5" in question text */
        }
      }
      qLines.push(line);
    } else {
      ansLines.push(line);
    }
  }

  var questionText = qLines.join('\n').trim();
  var modelAnswer  = ansLines.join('\n').trim();

  /* If block had no question text but has answer text, swap */
  if (!questionText && modelAnswer) {
    questionText = modelAnswer;
    modelAnswer  = '';
  }

  return {
    questionType:  'theory',
    question:      questionText,
    modelAnswer:   modelAnswer,
    explanation:   modelAnswer,   /* mirror for display compat */
    marks:         marks || 1,
    options:       [],
    correctAnswer: null
  };
}

/* ============================================
   parseText — Main entry point for paste/TXT import
   ✅ STEP 2: Routes to theory or objective parser
              based on opts.questionType.
   
   Theory mode:
     Uses splitTheoryBlocks() + parseTheoryBlock().
     Does NOT require options or correctAnswer.
   
   Objective mode (unchanged):
     Uses splitBlocks() + parseBlock().
     Still requires ≥ 2 options + correct answer.
============================================ */
function parseText(rawText, opts) {
  opts         = opts || {};
  var questionType = opts.questionType || 'objective';
  var isTheory     = (questionType === 'theory');

  if (!rawText || !rawText.trim()) {
    return { questions: [], warnings: ['Input text is empty.'], parseErrors: 0 };
  }

  var text        = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  var questions   = [];
  var warnings    = [];
  var parseErrors = 0;

  /* ---- THEORY MODE ---- */
  if (isTheory) {
    var blocks = splitTheoryBlocks(text);

    if (blocks.length === 0) {
      return { questions: [], warnings: ['No content detected. Please check the pasted text.'], parseErrors: 0 };
    }

    blocks.forEach(function(block, i) {
      if (!block.trim()) { return; }

      var parsed = parseTheoryBlock(block);

      if (!parsed || !parsed.question || parsed.question.trim().length < 3) {
        warnings.push(
          'Block ' + (i + 1) + ': No question text detected — skipped. ' +
          '(Block starts with: "' + block.substring(0, 60).replace(/\n/g, ' ') + '")'
        );
        parseErrors++;
        return;
      }

      questions.push(parsed);
    });

    return { questions: questions, warnings: warnings, parseErrors: parseErrors };
  }

  /* ---- OBJECTIVE MODE (unchanged logic) ---- */
  var objBlocks = splitBlocks(text);

  objBlocks.forEach(function(block, i) {
    var lines  = block.split('\n');
    var parsed = parseBlock(lines, questionType);

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
   ✅ STEP 2: Theory CSV supports columns:
     question, model_answer, marks, explanation
     (no option_a-d or correct_answer required)
   Objective CSV: unchanged.
============================================ */
function parseCsv(csvText, opts) {
  opts         = opts || {};
  var questionType = opts.questionType || 'objective';
  var isTheory     = (questionType === 'theory');

  var lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .split('\n').map(function(l) { return l.trim(); }).filter(Boolean);

  if (!lines.length) {
    return { questions: [], warnings: ['CSV file is empty.'], parseErrors: 0 };
  }

  /* Parse header row */
  var header = parseCsvLine(lines[0]).map(function(h) {
    return h.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
  });

  var idx = {
    question: header.findIndex(function(h) { return h === 'question'; }),
    a:        header.findIndex(function(h) { return h === 'option_a' || h === 'a'; }),
    b:        header.findIndex(function(h) { return h === 'option_b' || h === 'b'; }),
    c:        header.findIndex(function(h) { return h === 'option_c' || h === 'c'; }),
    d:        header.findIndex(function(h) { return h === 'option_d' || h === 'd'; }),
    ans:      header.findIndex(function(h) {
      return h === 'correct_answer' || h === 'answer' || h === 'correct' || h === 'ans';
    }),
    expl:        header.findIndex(function(h) { return h === 'explanation' || h === 'expl'; }),
    /* Theory columns */
    modelAnswer: header.findIndex(function(h) {
      return h === 'model_answer' || h === 'expected_answer' || h === 'reference_answer' ||
             h === 'model'        || h === 'expected'        || h === 'marking_guide'    ||
             h === 'mark_scheme'  || h === 'modelanswer'     || h === 'expectedanswer';
    }),
    marks: header.findIndex(function(h) {
      return h === 'marks' || h === 'mark' || h === 'score' || h === 'points';
    })
  };

  if (idx.question < 0) {
    return {
      questions: [], parseErrors: 0,
      warnings: [isTheory
        ? 'CSV missing "question" column. Theory CSV expects: question, model_answer, marks, explanation'
        : 'CSV missing "question" column. Objective CSV expects: question, option_a, option_b, option_c, option_d, correct_answer'
      ]
    };
  }

  var questions   = [];
  var warnings    = [];
  var parseErrors = 0;

  lines.slice(1).forEach(function(line, i) {
    var row  = i + 2;
    var cols = parseCsvLine(line);
    var q    = idx.question >= 0 ? (cols[idx.question] || '').trim() : '';

    if (!q) {
      warnings.push('Row ' + row + ': Empty question — skipped.');
      parseErrors++;
      return;
    }

    /* ---- Theory row ---- */
    if (isTheory) {
      var modelAns = idx.modelAnswer >= 0 ? (cols[idx.modelAnswer] || '').trim() : '';
      var marksVal = idx.marks >= 0 ? (parseInt(cols[idx.marks] || '') || null) : null;
      var expl     = idx.expl  >= 0 ? (cols[idx.expl]  || '').trim() : '';
      questions.push({
        questionType:  'theory',
        question:      q,
        options:       [],
        correctAnswer: null,
        modelAnswer:   modelAns,
        explanation:   expl || modelAns,
        marks:         marksVal
      });
      return;
    }

    /* ---- Objective row (unchanged) ---- */
    var optA = idx.a   >= 0 ? (cols[idx.a]   || '').trim() : '';
    var optB = idx.b   >= 0 ? (cols[idx.b]   || '').trim() : '';
    var optC = idx.c   >= 0 ? (cols[idx.c]   || '').trim() : '';
    var optD = idx.d   >= 0 ? (cols[idx.d]   || '').trim() : '';
    var ans  = idx.ans >= 0 ? (cols[idx.ans]  || '').trim() : '';
    var expl = idx.expl>= 0 ? (cols[idx.expl] || '').trim() : '';

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

/* Simple CSV line parser — unchanged */
function parseCsvLine(line) {
  var result   = [];
  var current  = '';
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if      (ch === '"')               { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes)  { result.push(current.trim()); current = ''; }
    else                               { current += ch; }
  }
  result.push(current.trim());
  return result;
}

module.exports = {
  parseText:          parseText,
  parseCsv:           parseCsv,
  /* Exported for testing */
  splitTheoryBlocks:  splitTheoryBlocks,
  parseTheoryBlock:   parseTheoryBlock
};