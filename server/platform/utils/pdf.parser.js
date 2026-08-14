/* ============================================
   ✅ STEP 2 — PDF TEXT EXTRACTOR
   
   Wraps pdf-parse for use by qms.routes.js.
   Install: npm install pdf-parse
   
   Returns { text, pageCount, error }.
   Does NOT parse questions — that is handled
   by question.parser.js after extraction.
   
   Limitations:
   - Text-based PDFs only (not scanned images)
   - Mathematical symbols may render imperfectly
     (PDF glyph encoding varies by document)
   - Multi-column layouts may merge columns
   
   For best results, paste text directly or
   use CSV import for controlled column layout.
============================================ */
'use strict';

async function extractPdfText(buffer) {
  try {
    var pdfParse = require('pdf-parse');
    var data     = await pdfParse(buffer);
    return {
      text:      (data.text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
      pageCount: data.numpages || 0,
      error:     null
    };
  } catch (err) {
    return {
      text:      '',
      pageCount: 0,
      error:     err.message
    };
  }
}

module.exports = { extractPdfText: extractPdfText };