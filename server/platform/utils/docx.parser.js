/* ============================================
   QMS DOCX PARSER
   Uses mammoth to extract text from .docx files.
   Extracted text is passed through the existing
   question.parser for structure detection.

   Requires: npm install mammoth
============================================ */
'use strict';

var textParser = require('./question.parser');

async function parseDocx(buffer) {
  /* Lazy-load mammoth to avoid crash if not installed */
  var mammoth;
  try {
    mammoth = require('mammoth');
  } catch (e) {
    return {
      questions:   [],
      warnings:    ['mammoth package not installed. Run: npm install mammoth'],
      parseErrors: 0
    };
  }

  try {
    /* Extract plain text — preserves line breaks */
    var result = await mammoth.extractRawText({ buffer: buffer });

    if (!result.value || !result.value.trim()) {
      return {
        questions:   [],
        warnings:    ['DOCX file appears to be empty or contains no extractable text.'],
        parseErrors: 0
      };
    }

    /* Mammoth warnings (e.g. unsupported features) */
    var extraWarnings = (result.messages || [])
      .filter(function (m) { return m.type === 'warning'; })
      .map(function (m) { return 'DOCX: ' + m.message; });

    /* Pass extracted text through the existing parser */
    var parsed = textParser.parseText(result.value);

    return {
      questions:   parsed.questions,
      warnings:    extraWarnings.concat(parsed.warnings),
      parseErrors: parsed.parseErrors
    };
  } catch (e) {
    return {
      questions:   [],
      warnings:    ['Failed to parse DOCX: ' + e.message],
      parseErrors: 0
    };
  }
}

module.exports = { parseDocx: parseDocx };