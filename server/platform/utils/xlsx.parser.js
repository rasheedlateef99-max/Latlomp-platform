/* ============================================
   QMS XLSX PARSER
   Uses SheetJS (xlsx) to read .xlsx/.xls files.
   Converts the first sheet to an array of rows,
   then processes like the CSV parser.

   Expected columns (case-insensitive):
     question, option_a, option_b, option_c, option_d,
     correct_answer [, explanation, topic, difficulty, year, source]

   Requires: npm install xlsx
============================================ */
'use strict';

function parseXlsx(buffer) {
  var XLSX;
  try {
    XLSX = require('xlsx');
  } catch (e) {
    return {
      questions:   [],
      warnings:    ['xlsx package not installed. Run: npm install xlsx'],
      parseErrors: 0
    };
  }

  try {
    var workbook = XLSX.read(buffer, { type: 'buffer' });
    var sheetName = workbook.SheetNames[0];

    if (!sheetName) {
      return { questions: [], warnings: ['XLSX file has no sheets.'], parseErrors: 0 };
    }

    var sheet = workbook.Sheets[sheetName];
    /* Convert to array-of-objects using first row as headers */
    var rows  = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (!rows.length) {
      return { questions: [], warnings: ['XLSX sheet is empty.'], parseErrors: 0 };
    }

    /* Normalize header keys */
    function normKey(obj) {
      var out = {};
      Object.keys(obj).forEach(function (k) {
        out[k.toLowerCase().trim().replace(/[^a-z0-9]/g, '_')] = String(obj[k]).trim();
      });
      return out;
    }

    /* Find the answer column: correct_answer, answer, ans, correct, key */
    function getAnsKey(row) {
      var candidates = ['correct_answer', 'answer', 'ans', 'correct', 'key', 'correct_ans'];
      for (var i = 0; i < candidates.length; i++) {
        if (row[candidates[i]] !== undefined) { return candidates[i]; }
      }
      return null;
    }

    /* Map letter/number answer to 0-based index */
    var LETTER_MAP = { 'A': 0, 'B': 1, 'C': 2, 'D': 3, '1': 0, '2': 1, '3': 2, '4': 3 };
    function letterToIndex(ch) {
      return LETTER_MAP[(ch || '').toString().trim().toUpperCase()] !== undefined
        ? LETTER_MAP[(ch || '').toString().trim().toUpperCase()]
        : null;
    }

    var questions   = [];
    var warnings    = [];
    var parseErrors = 0;

    rows.forEach(function (rawRow, i) {
      var row    = normKey(rawRow);
      var rowNum = i + 2; /* 1-indexed + 1 for header */

      var q   = row['question'] || '';
      var optA = row['option_a'] || row['a'] || row['opt_a'] || '';
      var optB = row['option_b'] || row['b'] || row['opt_b'] || '';
      var optC = row['option_c'] || row['c'] || row['opt_c'] || '';
      var optD = row['option_d'] || row['d'] || row['opt_d'] || '';

      var ansKey = getAnsKey(row);
      var ans    = ansKey ? (row[ansKey] || '') : '';
      var expl   = row['explanation'] || row['expl'] || '';
      var topic  = row['topic'] || '';
      var diff   = row['difficulty'] || row['diff'] || '';
      var yr     = row['year'] || '';
      var src    = row['source'] || '';

      if (!q) {
        parseErrors++;
        warnings.push('Row ' + rowNum + ': Empty question — skipped.');
        return;
      }

      var options = [optA, optB, optC, optD].filter(Boolean);
      if (options.length < 2) {
        parseErrors++;
        warnings.push('Row ' + rowNum + ': Fewer than 2 options — skipped.');
        return;
      }

      var correctIdx = letterToIndex(ans);

      questions.push({
        question:      q,
        options:       options,
        correctAnswer: (correctIdx !== null) ? correctIdx : null,
        explanation:   expl,
        topic:         topic,
        difficulty:    ['easy','medium','hard','mixed'].includes(diff.toLowerCase()) ? diff.toLowerCase() : 'medium',
        year:          yr ? parseInt(yr) || null : null,
        source:        src
      });
    });

    return { questions: questions, warnings: warnings, parseErrors: parseErrors };

  } catch (e) {
    return {
      questions:   [],
      warnings:    ['Failed to parse XLSX: ' + e.message],
      parseErrors: 0
    };
  }
}

module.exports = { parseXlsx: parseXlsx };