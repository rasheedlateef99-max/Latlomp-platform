'use strict';
/* ============================================
   LATLOMP INSTITUTION — RESULT PDF SERVICE (E3)

   Reusable PDF generation service.
   E5 Transcript can call generateReportCardPDF()
   with a compatible payload structure.

   Storage abstraction:
     ARCHIVE_STORAGE_PROVIDER=cloudinary (default)
     ARCHIVE_STORAGE_PROVIDER=local (VPS filesystem)

   PDF generator: pdfkit (run: npm install pdfkit)
   NO system dependencies — VPS safe.
============================================ */
'use strict';

const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');

/* ---- Lazy-load pdfkit (clear error if missing) ---- */
var PDFDocument = null;
try {
  PDFDocument = require('pdfkit');
} catch (e) {
  console.error('[E3/PDF] pdfkit not installed. Run: npm install pdfkit');
}

/* ============================================
   hashDocument(buffer) → hex string (for E5)
============================================ */
function hashDocument(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/* ============================================
   fetchImageBuffer(url) → Buffer | null
   Graceful: returns null on any failure.
   Timeout: 5s — report never fails because of image.
============================================ */
async function fetchImageBuffer(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) { return null; }
  try {
    return await new Promise(function(resolve, reject) {
      var lib = url.startsWith('https') ? require('https') : require('http');
      var done = false;
      var req  = lib.get(url, function(res) {
        if (res.statusCode !== 200) { return reject(new Error('HTTP ' + res.statusCode)); }
        var chunks = [];
        res.on('data', function(c) { chunks.push(c); });
        res.on('end',  function()  { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(5000, function() {
        if (!done) { done = true; req.destroy(); reject(new Error('Timeout')); }
      });
    });
  } catch (e) {
    console.warn('[PDF] Image fetch skipped:', url, '—', e.message);
    return null;
  }
}

/* ============================================
   hexToRgb(hex) → { r, g, b }
   Handles #RGB and #RRGGBB.
============================================ */
function hexToRgb(hex) {
  hex = (hex || '#6c63ff').replace('#', '');
  if (hex.length === 3) {
    hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  }
  return {
    r: parseInt(hex.substring(0, 2), 16) || 108,
    g: parseInt(hex.substring(2, 4), 16) || 99,
    b: parseInt(hex.substring(4, 6), 16) || 255
  };
}

/* ============================================
   drawTable(doc, rows, colWidths, options) → endY
   Simple table drawer for pdfkit.
   rows[0] = header row.
   options: { x, y, rowHeight, primaryColor }
============================================ */
function drawTable(doc, rows, colWidths, options) {
  options      = options || {};
  var x0       = options.x          || 40;
  var startY   = options.y          || doc.y;
  var rowH     = options.rowHeight  || 20;
  var primary  = options.primaryColor || '#6c63ff';
  var totalW   = colWidths.reduce(function(a, b) { return a + b; }, 0);
  var y        = startY;

  rows.forEach(function(row, rowIdx) {
    var isHeader = rowIdx === 0;

    /* Row background */
    if (isHeader) {
      doc.fillColor(primary).rect(x0, y, totalW, rowH).fill();
    } else if (rowIdx % 2 === 0) {
      doc.fillColor('#f8f8ff').rect(x0, y, totalW, rowH).fill();
    }

    /* Cell content */
    var cellX = x0;
    row.forEach(function(cell, colIdx) {
      doc
        .fillColor(isHeader ? '#ffffff' : '#1a1a2e')
        .font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(isHeader ? 8 : 9)
        .text(
          String(cell === null || cell === undefined ? '—' : cell),
          cellX + 4,
          y + (isHeader ? 6 : 5),
          { width: colWidths[colIdx] - 8, lineBreak: false, ellipsis: true }
        );
      cellX += colWidths[colIdx];
    });

    /* Bottom border per row */
    doc.strokeColor('#e0e0e0').lineWidth(0.4)
       .moveTo(x0, y + rowH).lineTo(x0 + totalW, y + rowH).stroke();

    y += rowH;
  });

  /* Outer border */
  doc.strokeColor('#cccccc').lineWidth(0.8)
     .rect(x0, startY, totalW, y - startY).stroke();

  return y;
}

/* ============================================
   generateReportCardPDF(reportData) → Buffer

   reportData structure (same as result.archive.service
   assembleReportData() output — or E5 equivalent):
   { school, student, term, settings, subjects,
     summary, attendanceSummary, promotionStatus }
============================================ */
async function generateReportCardPDF(reportData) {
  if (!PDFDocument) {
    throw new Error('PDF generation requires pdfkit. Run: npm install pdfkit');
  }

  var school   = reportData.school   || {};
  var student  = reportData.student  || {};
  var term     = reportData.term     || {};
  var settings = reportData.settings || {};
  var subjects = reportData.subjects || [];
  var summary  = reportData.summary  || {};
  var att      = reportData.attendanceSummary;
  var promo    = reportData.promotionStatus;
  var primary  = school.primaryColor || '#6c63ff';

  /* Fetch images before opening doc (graceful failure) */
  var [logoBuffer, photoBuffer] = await Promise.all([
    fetchImageBuffer(school.logo),
    fetchImageBuffer(student.passportPhotoUrl)
  ]);

  return new Promise(function(resolve, reject) {
    try {
      var doc     = new PDFDocument({ size: 'A4', margin: 0,
        info: {
          Title:  'Report Card — ' + student.name,
          Author: school.name,
          Subject: (term.name || '') + ' Academic Report Card'
        }
      });
      var chunks  = [];
      doc.on('data',  function(c) { chunks.push(c); });
      doc.on('end',   function()  { resolve(Buffer.concat(chunks)); });
      doc.on('error', reject);

      var pageW  = doc.page.width;   /* 595 */
      var margin = 40;
      var usable = pageW - (margin * 2); /* 515 */

      /* =============================================
         SECTION 1: COLORED HEADER
      ============================================= */
      var headerH = 90;
      doc.fillColor(primary).rect(0, 0, pageW, headerH).fill();

      /* School logo — left side */
      if (logoBuffer) {
        try {
          doc.image(logoBuffer, margin, 12, { width: 66, height: 66 });
        } catch (imgErr) { /* skip if image format unsupported */ }
      }

      /* School info — centered (but shifted right of logo) */
      var infoX  = margin + 72;
      var infoW  = pageW - infoX - margin - 80;

      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(14)
         .text(school.name.toUpperCase(), infoX, 16, { width: infoW, align: 'center', lineBreak: false });

      doc.font('Helvetica').fontSize(9)
         .text('ACADEMIC REPORT CARD', infoX, 36, { width: infoW, align: 'center', lineBreak: false });

      var termDisplay = (term.name || '') + (term.session ? ' — ' + term.session : '');
      doc.fontSize(8).text(termDisplay, infoX, 50, { width: infoW, align: 'center', lineBreak: false });

      if (school.motto) {
        doc.fontSize(7).fillColor('rgba(255,255,255,0.75)')
           .text('"' + school.motto + '"', infoX, 64, { width: infoW, align: 'center', lineBreak: false });
      }

      /* =============================================
         SECTION 2: STUDENT INFO BAR
      ============================================= */
      var studentBarY = headerH + 10;
      var photoW      = 70;
      var photoH      = 88;
      var photoX      = pageW - margin - photoW;

      /* Student photo — right side */
      if (photoBuffer) {
        try {
          /* Photo border */
          doc.strokeColor(primary).lineWidth(2)
             .rect(photoX - 2, studentBarY - 2, photoW + 4, photoH + 4).stroke();
          doc.image(photoBuffer, photoX, studentBarY, { width: photoW, height: photoH });
        } catch (imgErr) {
          /* Draw placeholder box */
          doc.strokeColor('#cccccc').lineWidth(1)
             .rect(photoX, studentBarY, photoW, photoH).stroke();
          doc.fillColor('#aaaaaa').font('Helvetica').fontSize(8)
             .text('No Photo', photoX, studentBarY + 38, { width: photoW, align: 'center' });
        }
      }

      /* Student name */
      doc.fillColor('#1a1a2e').font('Helvetica-Bold').fontSize(14)
         .text(student.name, margin, studentBarY, { width: usable - photoW - 10 });

      /* Student info — 2-column grid */
      var infoLeft  = margin;
      var infoRight = margin + (usable - photoW - 10) / 2;
      var infoY     = studentBarY + 22;
      var fieldH    = 14;

      var leftFields = [
        ['Admission No:',  student.admissionNo || '—'],
        ['Student ID:',    student.studentCode  || '—'],
        ['Class / Level:', student.class        || '—'],
        ['Gender:',        student.gender        || '—']
      ];
      var rightFields = [
        ['Term:',    term.name    || '—'],
        ['Session:', term.session || '—'],
        ['Status:',  student.status ? student.status.charAt(0).toUpperCase() + student.status.slice(1) : 'Active'],
        ['',         '']
      ];

      leftFields.forEach(function(f, i) {
        var y2 = infoY + (i * fieldH);
        doc.fillColor('#888888').font('Helvetica').fontSize(8)
           .text(f[0], infoLeft, y2, { continued: false, lineBreak: false });
        doc.fillColor('#1a1a2e').font('Helvetica-Bold').fontSize(8)
           .text(f[1], infoLeft + 80, y2, { width: 100, lineBreak: false });

        if (rightFields[i][0]) {
          doc.fillColor('#888888').font('Helvetica').fontSize(8)
             .text(rightFields[i][0], infoRight, y2, { lineBreak: false });
          doc.fillColor('#1a1a2e').font('Helvetica-Bold').fontSize(8)
             .text(rightFields[i][1], infoRight + 60, y2, { width: 100, lineBreak: false });
        }
      });

      /* Divider */
      var divY = studentBarY + photoH + 8;
      doc.strokeColor(primary).lineWidth(1.5)
         .moveTo(margin, divY).lineTo(pageW - margin, divY).stroke();

      /* =============================================
         SECTION 3: RESULT TABLE
      ============================================= */
      var tableY = divY + 12;

      doc.fillColor('#1a1a2e').font('Helvetica-Bold').fontSize(9)
         .text('ACADEMIC PERFORMANCE', margin, tableY, { lineBreak: false });
      tableY += 16;

      /* Column widths total = 515 */
      var colWidths = [165, 48, 45, 45, 42, 85, 85];
      var colHeaders = ['Subject', 'Total', 'Max', '%', 'Grade', 'Remark', 'Position'];

      var tableRows = [colHeaders];
      subjects.forEach(function(s) {
        var pos     = s.position ? (s.position + '/' + (s.positionOutOf || '')) : '—';
        var name    = (s.isCore ? '★ ' : '') + (s.subjectName || '—');
        var pctStr  = s.percentage != null ? s.percentage + '%' : '—';
        tableRows.push([name, s.total != null ? s.total : '—', s.maxPossible || '—',
                        pctStr, s.grade || '—', s.remark || '—', pos]);
      });

      if (!subjects.length) {
        tableRows.push(['No scores available for this term', '', '', '', '', '', '']);
      }

      tableY = drawTable(doc, tableRows, colWidths, {
        x: margin, y: tableY, rowHeight: 18, primaryColor: primary
      });

      doc.fontSize(7).fillColor('#666666')
         .text('★ Core/Compulsory subject', margin, tableY + 4, { lineBreak: false });
      tableY += 18;

      /* =============================================
         SECTION 4: SUMMARY BAR
      ============================================= */
      var sumY = tableY + 10;
      doc.fillColor(primary).rect(margin, sumY, usable, 26).fill();

      var sumItems = [
        'Total Marks: ' + (summary.totalMarks || 0) + '/' + (summary.maxPossibleSum || 0),
        'Average: ' + (summary.avgPercent || 0) + '%',
        'Subjects Passed: ' + (summary.subjectsPassed || 0) + '/' + (summary.subjectsTotal || 0)
      ];

      var sumItemW = usable / sumItems.length;
      sumItems.forEach(function(item, i) {
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9)
           .text(item, margin + (i * sumItemW), sumY + 8,
                 { width: sumItemW - 10, align: 'center', lineBreak: false });
      });
      sumY += 30;

      /* =============================================
         SECTION 5: ATTENDANCE (if available)
      ============================================= */
      if (att) {
        doc.fillColor('#1a1a2e').font('Helvetica-Bold').fontSize(8)
           .text('ATTENDANCE: ', margin, sumY + 8, { continued: true });
        doc.fillColor('#333333').font('Helvetica').fontSize(8)
           .text(att.percentage + '% present  (' + att.present + ' days present, ' +
                 att.absent + ' days absent, total ' + att.total + ' days)',
                 { lineBreak: false });
        sumY += 20;
      }

      /* =============================================
         SECTION 6: COMMENTS
      ============================================= */
      var commentsY = sumY + 10;
      var commentBoxH = 60;
      doc.strokeColor('#e0e0e0').lineWidth(0.5)
         .rect(margin, commentsY, usable, commentBoxH).stroke();

      doc.fillColor(primary).font('Helvetica-Bold').fontSize(8)
         .text("Class Teacher's Comment:", margin + 6, commentsY + 6, { lineBreak: false });
      doc.fillColor('#1a1a2e').font('Helvetica').fontSize(9)
         .text(settings.teacherComment || '—', margin + 6, commentsY + 16,
               { width: usable - 12, lineBreak: false });

      doc.fillColor(primary).font('Helvetica-Bold').fontSize(8)
         .text("Principal's Comment:", margin + 6, commentsY + 32, { lineBreak: false });
      doc.fillColor('#1a1a2e').font('Helvetica').fontSize(9)
         .text(settings.principalComment || 'Keep it up!', margin + 6, commentsY + 42,
               { width: usable - 120, lineBreak: false });

      if (settings.resumptionDate) {
        var resumeStr = new Date(settings.resumptionDate)
          .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        doc.fillColor(primary).font('Helvetica-Bold').fontSize(8)
           .text('Next Term Resumes:', margin + usable - 160, commentsY + 32, { lineBreak: false });
        doc.fillColor('#1a1a2e').font('Helvetica-Bold').fontSize(9)
           .text(resumeStr, margin + usable - 160, commentsY + 42, { lineBreak: false });
      }
      commentsY += commentBoxH;

      /* =============================================
         SECTION 7: PROMOTION STATUS
      ============================================= */
      if (promo) {
        commentsY += 8;
        var promoText = (promo.decision || '').toUpperCase().replace(/_/g, ' ');
        var promoColor = promo.decision === 'promote' ? '#43e97b'
                       : promo.decision === 'graduate'? '#ffd600'
                       : promo.decision === 'repeat'  ? '#ff6584'
                       :                                '#a78bfa';
        doc.fillColor(promoColor).rect(margin, commentsY, usable, 22).fill();
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10)
           .text('PROMOTION STATUS: ' + promoText,
                 margin, commentsY + 6, { width: usable, align: 'center', lineBreak: false });
        commentsY += 22;
      }

      /* =============================================
         SECTION 8: FOOTER
      ============================================= */
      var footerY = doc.page.height - 36;
      doc.fillColor('#f0f0f5').rect(0, footerY, pageW, 36).fill();
      doc.fillColor('#666666').font('Helvetica').fontSize(7.5)
         .text('Generated by LatLomp Education Platform · ' + new Date().toLocaleDateString('en-GB'),
               margin, footerY + 10, { width: usable, align: 'center', lineBreak: false });
      if (school.phone || school.address) {
        doc.fillColor('#888888').fontSize(7)
           .text(([school.address, school.phone]).filter(Boolean).join(' · '),
                 margin, footerY + 22, { width: usable, align: 'center', lineBreak: false });
      }

      doc.end();
    } catch (buildErr) {
      reject(buildErr);
    }
  });
}

/* ============================================
   storeDocument(buffer, meta) → { provider, key, url }

   Abstracted storage layer.
   Switch storage via ARCHIVE_STORAGE_PROVIDER env var.
   Default: cloudinary (already installed)
   Fallback: local filesystem

   meta: { schoolId, studentId, termId, version, documentType }
============================================ */
async function storeDocument(buffer, meta) {
  var provider = process.env.ARCHIVE_STORAGE_PROVIDER || 'cloudinary';
  var filename  = [
    'report',
    (meta.documentType || 'report_card').replace('_', '-'),
    'v' + (meta.version || 1),
    (meta.termId ? meta.termId.toString().slice(-6) : '')
  ].filter(Boolean).join('_') + '.pdf';

  if (provider === 'local') {
    /* Local filesystem — for VPS deployment */
    var uploadDir = path.join(process.cwd(), 'uploads', 'archive',
                              String(meta.schoolId), String(meta.studentId));
    if (!fs.existsSync(uploadDir)) { fs.mkdirSync(uploadDir, { recursive: true }); }
    var localPath = path.join(uploadDir, filename);
    fs.writeFileSync(localPath, buffer);
    var relKey = path.join('uploads', 'archive', String(meta.schoolId), String(meta.studentId), filename);
    return { provider: 'local', key: relKey, url: '/' + relKey.replace(/\\/g, '/') };
  }

  /* Cloudinary (default — already installed as cloudinary: ^1.41.3) */
  var cloudinary = require('cloudinary').v2;
  var folder     = 'latlomp-archive/' + meta.schoolId + '/' + meta.studentId;
  var publicId   = folder + '/' + filename.replace('.pdf', '');

  var uploadResult = await new Promise(function(resolve, reject) {
    var stream = cloudinary.uploader.upload_stream(
      { resource_type: 'raw', public_id: publicId, format: 'pdf', overwrite: false },
      function(err, result) {
        if (err) { return reject(err); }
        resolve(result);
      }
    );
    stream.end(buffer);
  });

  return {
    provider: 'cloudinary',
    key:      uploadResult.public_id,
    url:      uploadResult.secure_url
  };
}

/* ============================================
   retrieveDocument(storageInfo) → Buffer
   Used for proxied download.
============================================ */
async function retrieveDocument(storageInfo) {
  if (!storageInfo || !storageInfo.key) {
    throw new Error('Storage information missing.');
  }

  if (storageInfo.provider === 'local') {
    var localPath = path.join(process.cwd(), storageInfo.key);
    return fs.readFileSync(localPath);
  }

  /* Cloudinary: fetch the raw file buffer */
  if (!storageInfo.url) {
    throw new Error('Cloudinary URL missing.');
  }
  var buf = await fetchImageBuffer(storageInfo.url);
  if (!buf) { throw new Error('Failed to retrieve document from storage.'); }
  return buf;
}

module.exports = {
  generateReportCardPDF,
  storeDocument,
  retrieveDocument,
  hashDocument,
  fetchImageBuffer /* exported for reuse by E5 */
};