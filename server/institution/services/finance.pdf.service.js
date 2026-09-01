'use strict';
/* ============================================
   LATLOMP — FINANCE PDF SERVICE (E7B)

   Receipt and statement PDF generation.
   Reuses pdfkit (already installed for E3/E5).
   Uses xlsx for Excel exports (already installed).
   Reuses fetchImageBuffer from result.pdf.service.js.

   generateReceiptPDF(payment, school) → Buffer
   generateStatementPDF(statementData)  → Buffer
   generateStatementExcel(statementData)→ Buffer
============================================ */
'use strict';

const crypto = require('crypto');

/* ---- Lazy-load pdfkit ---- */
function getPDFDocument() {
  try { return require('pdfkit'); } catch(e) {
    throw new Error('pdfkit not installed. Run: npm install pdfkit');
  }
}

/* ---- Reuse fetchImageBuffer from E3 ---- */
var fetchImageBuffer;
try {
  fetchImageBuffer = require('./result.pdf.service').fetchImageBuffer;
} catch(e) {
  fetchImageBuffer = async function() { return null; };
}

function fmtAmount(amount, currency) {
  currency = currency || 'NGN';
  var symbol = currency === 'NGN' ? '₦' : (currency === 'USD' ? '$' : currency + ' ');
  return symbol + (Number(amount || 0)).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function hexToRgb(hex) {
  hex = (hex || '#6c63ff').replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  return {
    r: parseInt(hex.substring(0,2), 16) || 108,
    g: parseInt(hex.substring(2,4), 16) || 99,
    b: parseInt(hex.substring(4,6), 16) || 255
  };
}

/* ============================================
   generateReceiptPDF(payment, school) → Buffer
   Professional digital receipt.
   payment: populated SchoolFeePayment record.
   school:  School document.
============================================ */
async function generateReceiptPDF(payment, school) {
  var PDFDocument = getPDFDocument();
  var primary     = (school && school.primaryColor) || '#6c63ff';

  var logoBuffer = null;
  try { logoBuffer = await fetchImageBuffer(school && school.logo); } catch(e) {}

  return new Promise(function(resolve, reject) {
    try {
      /* A5 size — compact receipt */
      var doc    = new PDFDocument({ size: [420, 595], margin: 0 });
      var chunks = [];
      doc.on('data', function(c) { chunks.push(c); });
      doc.on('end',  function()  { resolve(Buffer.concat(chunks)); });
      doc.on('error', reject);

      var W      = doc.page.width;
      var margin = 32;
      var usable = W - (margin * 2);

      /* ---- Header band ---- */
      doc.fillColor(primary).rect(0, 0, W, 80).fill();

      if (logoBuffer) {
        try { doc.image(logoBuffer, margin, 14, { width: 52, height: 52 }); }
        catch(e) {}
      }

      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(13)
         .text((school && school.name || 'School').toUpperCase(), margin + 60, 18,
               { width: usable - 60, lineBreak: false });
      doc.font('Helvetica').fontSize(8).fillColor('rgba(255,255,255,0.8)')
         .text('OFFICIAL PAYMENT RECEIPT', margin + 60, 36, { lineBreak: false });
      doc.fontSize(7).fillColor('rgba(255,255,255,0.65)')
         .text([(school && school.address), (school && school.phone)].filter(Boolean).join(' · '),
               margin + 60, 50, { lineBreak: false });

      var y = 96;

      /* ---- Receipt badge ---- */
      doc.fillColor(primary).fillOpacity(0.08).rect(margin, y, usable, 36).fill();
      doc.fillOpacity(1).fillColor(primary).font('Helvetica-Bold').fontSize(8)
         .text('RECEIPT NUMBER', margin + 12, y + 8, { lineBreak: false });
      doc.fillColor('#1a1a2e').fontSize(14).font('Helvetica-Bold')
         .text(payment.receiptNumber || '—', margin + 12, y + 20, { lineBreak: false });
      doc.fillColor(primary).font('Helvetica-Bold').fontSize(9)
         .text('VERIFIED ✓', W - margin - 70, y + 14, { lineBreak: false });
      y += 50;

      /* ---- Amount due ---- */
      doc.fillColor(primary).font('Helvetica-Bold').fontSize(9)
         .text('AMOUNT PAID', margin, y, { lineBreak: false });
      y += 14;
      doc.fillColor('#1a1a2e').font('Helvetica-Bold').fontSize(26)
         .text(fmtAmount(payment.amount, payment.currency), margin, y, { lineBreak: false });
      y += 36;

      /* ---- Info rows ---- */
      function infoRow(label, value, emphasize) {
        doc.strokeColor('#eeeeee').lineWidth(0.4)
           .moveTo(margin, y).lineTo(margin + usable, y).stroke();
        doc.fillColor('#888888').font('Helvetica').fontSize(8)
           .text(label, margin, y + 4, { lineBreak: false });
        doc.fillColor(emphasize ? primary : '#1a1a2e')
           .font(emphasize ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
           .text(String(value || '—'), margin + 130, y + 4,
                 { width: usable - 130, lineBreak: false, align: 'right' });
        y += 22;
      }

      var student     = payment.studentId || {};
      var structure   = payment.feeStructureId || {};
      var term        = payment.termId || {};

      infoRow('Student',       student.name || '—');
      infoRow('Admission No',  student.admissionNo || '—');
      infoRow('Class / Level', student.class || '—');
      infoRow('Fee Category',  structure.name || '—');
      infoRow('Term / Session',(term.name || '') + (term.session ? ' · ' + term.session : ''));
      infoRow('Payment Method',payment.method || '—');
      infoRow('Transaction Ref',payment.paystackRef || payment.externalRef || '—', true);
      infoRow('Payment Date',  fmtDateTime(payment.recordedAt));
      infoRow('Status',        'CONFIRMED ✓', true);

      /* ---- Platform fee note (small) ---- */
      if (payment.platformFeeAmount > 0) {
        y += 4;
        doc.fillColor('#aaaaaa').font('Helvetica').fontSize(7)
           .text('Total charged: ' + fmtAmount(payment.totalCharged, payment.currency) +
                 ' (incl. processing fee of ' + fmtAmount(payment.platformFeeAmount, payment.currency) + ')',
                 margin, y, { width: usable });
        y += 18;
      }

      /* ---- Footer ---- */
      var footerY = doc.page.height - 44;
      doc.fillColor(primary).fillOpacity(0.06).rect(0, footerY, W, 44).fill();
      doc.fillOpacity(1).fillColor('#888888').font('Helvetica').fontSize(7)
         .text('This is an official payment receipt issued by the LatLomp Education Platform.',
               margin, footerY + 10, { width: usable, align: 'center' });
      doc.fontSize(7)
         .text('Generated: ' + fmtDateTime(new Date()),
               margin, footerY + 22, { width: usable, align: 'center' });

      doc.end();
    } catch(err) { reject(err); }
  });
}

/* ============================================
   generateStatementPDF(statementData) → Buffer
   Professional financial statement document.
============================================ */
async function generateStatementPDF(statementData) {
  var PDFDocument = getPDFDocument();
  var school      = statementData.school  || {};
  var summary     = statementData.summary || {};
  var txns        = statementData.transactions || [];
  var primary     = school.primaryColor   || '#6c63ff';

  var logoBuffer = null;
  try { logoBuffer = await fetchImageBuffer(school.logo); } catch(e) {}

  return new Promise(function(resolve, reject) {
    try {
      var doc    = new PDFDocument({ size: 'A4', margin: 0,
        info: { Title: 'Financial Statement — ' + (school.name || ''), Author: 'LatLomp Finance' }
      });
      var chunks = [];
      doc.on('data', function(c) { chunks.push(c); });
      doc.on('end',  function()  { resolve(Buffer.concat(chunks)); });
      doc.on('error', reject);

      var pageW  = doc.page.width;
      var margin = 40;
      var usable = pageW - (margin * 2);

      /* ---- HEADER ---- */
      doc.fillColor(primary).rect(0, 0, pageW, 88).fill();
      if (logoBuffer) {
        try { doc.image(logoBuffer, margin, 14, { width: 60, height: 60 }); }
        catch(e) {}
      }
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(14)
         .text((school.name || 'School').toUpperCase(), margin + 68, 18,
               { width: usable - 68, align: 'center', lineBreak: false });
      doc.font('Helvetica').fontSize(10).fillColor('rgba(255,255,255,0.9)')
         .text('FINANCIAL STATEMENT', margin + 68, 38,
               { width: usable - 68, align: 'center', lineBreak: false });
      doc.fontSize(7).fillColor('rgba(255,255,255,0.65)')
         .text([(school.address), (school.phone)].filter(Boolean).join(' · '),
               margin + 68, 54, { width: usable - 68, align: 'center', lineBreak: false });

      var y = 102;

      /* ---- Statement metadata ---- */
      doc.fillColor(primary).fillOpacity(0.06).rect(margin, y, usable, 36).fill();
      doc.fillOpacity(1).fillColor(primary).font('Helvetica-Bold').fontSize(8)
         .text('STATEMENT REF: ' + (statementData.statementRef || '—'),
               margin + 10, y + 8, { lineBreak: false });
      doc.fillColor('#555555').font('Helvetica').fontSize(7.5)
         .text('Generated: ' + fmtDateTime(statementData.generatedAt),
               margin + 10, y + 22, { lineBreak: false });

      /* Period info */
      var periodLabel = 'All Time';
      if (statementData.period) {
        var p = statementData.period;
        if (p.type === 'today')  periodLabel = 'Today';
        if (p.type === 'week')   periodLabel = 'This Week';
        if (p.type === 'month')  periodLabel = 'This Month';
        if (p.type === 'term')   periodLabel = 'This Term';
        if (p.type === 'session')periodLabel = 'This Session';
        if (p.type === 'custom') periodLabel = (p.from ? fmtDate(p.from) : '') + ' — ' + (p.to ? fmtDate(p.to) : '');
      }
      doc.fillColor('#555555').font('Helvetica').fontSize(7.5)
         .text('Period: ' + periodLabel, pageW - margin - 160, y + 8, { lineBreak: false });
      doc.text('Transactions: ' + (summary.transactionCount || 0),
               pageW - margin - 160, y + 22, { lineBreak: false });
      y += 50;

      /* ---- Summary boxes ---- */
      doc.fillColor('#1a1a2e').font('Helvetica-Bold').fontSize(10)
         .text('FINANCIAL SUMMARY', margin, y);
      y += 14;

      var boxW = (usable - 10) / 3;
      var boxes = [
        { label: 'Total Collected',     value: fmtAmount(summary.totalCollected, 'NGN'),    bg: primary },
        { label: 'Outstanding Balance', value: fmtAmount(summary.outstanding, 'NGN'),       bg: '#ff6584' },
        { label: 'Net After Refunds',   value: fmtAmount(statementData.netCollected, 'NGN'),bg: '#43e97b' }
      ];
      boxes.forEach(function(box, i) {
        var bx = margin + (i * (boxW + 5));
        doc.fillColor(box.bg).fillOpacity(0.12).rect(bx, y, boxW, 44).fill();
        doc.fillOpacity(1).strokeColor(box.bg).lineWidth(0.5).rect(bx, y, boxW, 44).stroke();
        doc.fillColor('#555555').font('Helvetica').fontSize(7)
           .text(box.label, bx + 8, y + 8, { width: boxW - 16, lineBreak: false });
        doc.fillColor(box.bg === primary ? '#1a1a2e' : '#1a1a2e')
           .font('Helvetica-Bold').fontSize(11)
           .text(box.value, bx + 8, y + 20, { width: boxW - 16, lineBreak: false });
      });
      y += 58;

      /* Secondary stats row */
      var stats2 = [
        ['Min Transaction', fmtAmount(summary.minAmount, 'NGN')],
        ['Max Transaction', fmtAmount(summary.maxAmount, 'NGN')],
        ['Avg Transaction', fmtAmount(summary.avgAmount, 'NGN')],
        ['Refunds',         fmtAmount(summary.totalRefunded, 'NGN')],
        ['Donations',       fmtAmount(summary.totalDonations, 'NGN')]
      ];
      var s2W = usable / stats2.length;
      stats2.forEach(function(s, i) {
        var sx = margin + (i * s2W);
        doc.fillColor('#888888').font('Helvetica').fontSize(7)
           .text(s[0], sx, y, { lineBreak: false });
        doc.fillColor('#1a1a2e').font('Helvetica-Bold').fontSize(9)
           .text(s[1], sx, y + 12, { lineBreak: false });
      });
      y += 32;

      /* ---- Transaction table ---- */
      doc.fillColor('#1a1a2e').font('Helvetica-Bold').fontSize(10).text('TRANSACTION LISTING', margin, y);
      y += 14;

      var colW  = [90, 110, 100, 60, 70, 65];
      var cols  = ['Date', 'Receipt No.', 'Student', 'Amount', 'Method', 'Status'];
      var tblW  = colW.reduce(function(a,b) { return a+b; }, 0);

      /* Table header */
      doc.fillColor(primary).rect(margin, y, tblW, 16).fill();
      var cx = margin;
      cols.forEach(function(h, i) {
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5)
           .text(h, cx + 3, y + 5, { width: colW[i] - 6, lineBreak: false, ellipsis: true });
        cx += colW[i];
      });
      y += 16;

      /* Table rows */
      txns.slice(0, 200).forEach(function(t, rowIdx) { /* cap at 200 for PDF */
        if (y > doc.page.height - 60) { doc.addPage(); y = 40; }

        if (rowIdx % 2 === 1) {
          doc.fillColor('#f8f8ff').rect(margin, y, tblW, 13).fill();
        }

        var student = t.studentId || {};
        var row = [
          fmtDate(t.recordedAt),
          t.receiptNumber || '—',
          student.name || '—',
          fmtAmount(t.amount, t.currency),
          t.method || '—',
          (t.status || '').toUpperCase()
        ];

        cx = margin;
        row.forEach(function(cell, ci) {
          doc.fillColor('#1a1a2e').font('Helvetica').fontSize(7.5)
             .text(String(cell), cx + 3, y + 3, { width: colW[ci] - 6, lineBreak: false, ellipsis: true });
          cx += colW[ci];
        });

        doc.strokeColor('#eeeeee').lineWidth(0.3)
           .moveTo(margin, y + 13).lineTo(margin + tblW, y + 13).stroke();
        y += 13;
      });

      if (txns.length > 200) {
        doc.fillColor('#888888').font('Helvetica').fontSize(7.5)
           .text('Showing 200 of ' + txns.length + ' transactions. Export as Excel for complete listing.',
                 margin, y + 8);
        y += 20;
      }

      /* ---- Footer ---- */
      var footerY = doc.page.height - 40;
      doc.fillColor('#f8f8f8').rect(0, footerY, pageW, 40).fill();
      doc.fillColor('#888888').font('Helvetica').fontSize(7)
         .text('This statement is a record of financial activity managed through the LatLomp Education Platform. ' +
               'LatLomp is not the custodian of school funds.',
               margin, footerY + 10, { width: usable, align: 'center' });
      doc.fontSize(6.5).text('Generated: ' + fmtDateTime(new Date()),
               margin, footerY + 24, { width: usable, align: 'center' });

      doc.end();
    } catch(err) { reject(err); }
  });
}

/* ============================================
   generateStatementExcel(statementData) → Buffer
   Complete transaction export.
   Uses xlsx (already installed).
============================================ */
function generateStatementExcel(statementData) {
  var XLSX    = require('xlsx');
  var school  = statementData.school   || {};
  var summary = statementData.summary  || {};
  var txns    = statementData.transactions || [];

  var rows = [];

  /* Institution header */
  rows.push([school.name || 'Financial Statement']);
  rows.push(['FINANCIAL STATEMENT — ' + (statementData.statementRef || '')]);
  rows.push(['Period:', statementData.period ? statementData.period.type : 'All Time',
             '', 'Generated:', new Date().toLocaleDateString('en-GB')]);
  rows.push([]);

  /* Summary section */
  rows.push(['FINANCIAL SUMMARY', '', '', '', '']);
  rows.push(['Total Collected:',   summary.totalCollected  || 0,
             '', 'Transaction Count:', summary.transactionCount || 0]);
  rows.push(['Outstanding Balance:',summary.outstanding    || 0,
             '', 'Refunds:',          summary.totalRefunded || 0]);
  rows.push(['Net After Refunds:',  statementData.netCollected || 0,
             '', 'Donations:',        summary.totalDonations || 0]);
  rows.push(['Min Transaction:',    summary.minAmount || 0,
             '', 'Max Transaction:', summary.maxAmount || 0]);
  rows.push(['Average Transaction:',summary.avgAmount || 0, '', '', '']);
  rows.push([]);

  /* Transaction header */
  rows.push([
    'Date', 'Time', 'Receipt No.', 'Paystack Ref', 'External Ref',
    'Student Name', 'Admission No.', 'Class', 'Fee Category',
    'Term', 'Session', 'Amount', 'Currency', 'Method', 'Status',
    'Platform Fee', 'Total Charged'
  ]);

  /* Transaction rows */
  txns.forEach(function(t) {
    var student   = t.studentId    || {};
    var structure = t.feeStructureId || {};
    var term      = t.termId       || {};
    var dt        = t.recordedAt ? new Date(t.recordedAt) : new Date();
    rows.push([
      dt.toLocaleDateString('en-GB'),
      dt.toLocaleTimeString('en-GB'),
      t.receiptNumber   || '',
      t.paystackRef     || '',
      t.externalRef     || '',
      student.name      || '',
      student.admissionNo|| '',
      student.class     || '',
      structure.name    || '',
      term.name         || '',
      term.session      || '',
      t.amount          || 0,
      t.currency        || 'NGN',
      t.method          || '',
      t.status          || '',
      t.platformFeeAmount || 0,
      t.totalCharged    || 0
    ]);
  });

  rows.push([]);
  rows.push(['Report generated by LatLomp Education Platform']);

  var ws = XLSX.utils.aoa_to_sheet(rows);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Financial Statement');

  ws['!cols'] = [
    {wch:12},{wch:10},{wch:14},{wch:20},{wch:18},{wch:22},{wch:14},{wch:14},
    {wch:18},{wch:14},{wch:12},{wch:12},{wch:8},{wch:12},{wch:12},{wch:14},{wch:14}
  ];

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  generateReceiptPDF,
  generateStatementPDF,
  generateStatementExcel,
  fmtAmount,
  fmtDate,
  fmtDateTime
};