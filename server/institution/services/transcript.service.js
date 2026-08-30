'use strict';
/* ============================================
   LATLOMP INSTITUTION — TRANSCRIPT SERVICE (E5)

   Responsibilities:
   1. assembleCanonicalTranscriptData() — multi-term
      aggregation from authoritative sources.
      5 batch queries total. No N+1.
   2. buildCanonicalSnapshot()    — deterministic JSON
   3. generateTranscriptPDF()     — reuses E3 pdfkit
   4. requestTranscript()         — create request record
   5. generateAndIssue()          — full pipeline
   6. revokeTranscript()          — soft revocation
   7. getStudentTranscripts()     — list with filters
   8. getTranscriptForVerification() — safe public data

   NEVER modifies: SchoolScore, SchoolStudent,
   PromotionBatch, AcademicPortfolio (except
   lastTranscriptRef update on issuance),
   ResultArchiveRecord (except verificationId update).
============================================ */
'use strict';

const crypto           = require('crypto');
const mongoose         = require('mongoose');
const SchoolStudent    = require('../models/SchoolStudent.model');
const SchoolScore      = require('../models/SchoolScore.model');
const AcademicTerm     = require('../models/AcademicTerm.model');
const School           = require('../models/School.model');
const AcademicPortfolio= require('../models/AcademicPortfolio.model');
const PortfolioEntry   = require('../models/PortfolioEntry.model');
const TranscriptRequest= require('../models/TranscriptRequest.model');
const pdfService       = require('./result.pdf.service');
const signingService   = require('./transcript.signing.service');

/* ---- Graceful loaders ---- */
function getScoreSubmissionModel() { try { return require('../models/ScoreSubmission.model'); } catch(e) { return null; } }
function getReportCardSettingsModel() { try { return require('../models/ReportCardSettings.model'); } catch(e) { return null; } }
function getPromotionBatchModel() { try { return require('../models/PromotionBatch.model'); } catch(e) { return null; } }
function getResultArchiveRecordModel() { try { return require('../models/ResultArchiveRecord.model'); } catch(e) { return null; } }

var TERM_ORDER = { first:1, second:2, third:3, semester_1:4, semester_2:5, '':0 };

function termSortVal(t) { return TERM_ORDER[t || ''] || 99; }

/* ============================================
   assembleCanonicalTranscriptData(studentId, schoolId, scope)

   scope: { type: 'full' | 'session', sessions: [] }

   Returns: { canonicalData{}, canonicalSnapshot(string),
              canonicalHash(string) }
   or null if student not found.

   BATCH STRATEGY (5 queries total):
   1. Student + School + Portfolio (parallel)
   2. All SchoolScore for student (one query)
   3. ScoreSubmissions for release context (one query)
   4. AcademicTerms for found termIds (one batch)
   5. ReportCardSettings for class+term combos (one batch)
   + PromotionBatch for history (one query)
   + PortfolioEntry for awards (one query)
============================================ */
async function assembleCanonicalTranscriptData(studentId, schoolId, scope) {
  scope = scope || { type: 'full', sessions: [] };

  /* ---- 1. Student + School + Portfolio (parallel) ---- */
  var [student, school, portfolio] = await Promise.all([
    SchoolStudent.findOne({ _id: studentId, schoolId })
      .select('name admissionNo studentId gender status class classId classHistory ' +
              'joinedSession joinedYear passportPhotoUrl')
      .lean(),
    School.findById(schoolId)
      .select('name logo address state phone email primaryColor motto principalName')
      .lean(),
    AcademicPortfolio.findOne({ studentId, schoolId })
      .select('portfolioStatus')
      .lean()
  ]);

  if (!student || !school) { return null; }

  /* ---- 2. All SchoolScore (1 query) ---- */
  var scoreFilter = { schoolId, studentId };
  var scores = await SchoolScore.find(scoreFilter)
    .populate('subjectId', 'name code isCore sortOrder')
    .lean();

  /* ---- 3. ScoreSubmissions for release status (1 query) ---- */
  var ScoreSubmission = getScoreSubmissionModel();
  var approvedPairs   = new Set();
  if (ScoreSubmission) {
    try {
      var subs = await ScoreSubmission.find({
        schoolId, status: 'approved', releasedToStudents: true
      }).select('classId subjectId termId').lean();
      subs.forEach(function(s) {
        approvedPairs.add(s.classId.toString() + ':' + s.subjectId.toString() + ':' + s.termId.toString());
      });
    } catch(e) { /* non-fatal — include all approved scores */ }
  }

  /* ---- 4. Unique termIds from scores → load terms (1 batch) ---- */
  var termIdStrings = [...new Set(scores.map(function(s) { return s.termId.toString(); }))];
  var terms = termIdStrings.length > 0
    ? await AcademicTerm.find({ _id: { $in: termIdStrings }, schoolId }).lean()
    : [];
  var termMap = {};
  terms.forEach(function(t) { termMap[t._id.toString()] = t; });

  /* ---- 5. Filter terms by scope.sessions if type='session' ---- */
  if (scope.type === 'session' && scope.sessions && scope.sessions.length > 0) {
    var allowedSessions = new Set(scope.sessions);
    termIdStrings = termIdStrings.filter(function(tid) {
      var t = termMap[tid];
      return t && allowedSessions.has(t.session);
    });
    /* Also filter scores */
    scores = scores.filter(function(s) {
      var t = termMap[s.termId.toString()];
      return t && allowedSessions.has(t.session);
    });
  }

  /* ---- 6. ReportCardSettings for teacher comments (1 batch) ---- */
  var ReportCardSettings = getReportCardSettingsModel();
  var settingsMap = {};
  if (ReportCardSettings && scores.length > 0) {
    try {
      /* Build unique classId+termId pairs from scores */
      var classTermPairs = [];
      var seen = new Set();
      scores.forEach(function(s) {
        var key = (s.classId || '').toString() + ':' + s.termId.toString();
        if (!seen.has(key) && s.classId) {
          seen.add(key);
          classTermPairs.push({ classId: s.classId, termId: s.termId });
        }
      });
      if (classTermPairs.length > 0) {
        var settings = await ReportCardSettings.find({
          schoolId,
          $or: classTermPairs.map(function(p) { return { classId: p.classId, termId: p.termId }; })
        }).lean();
        settings.forEach(function(s) {
          settingsMap[s.classId.toString() + ':' + s.termId.toString()] = s;
        });
      }
    } catch(e) { /* non-fatal */ }
  }

  /* ---- 7. Group scores by termId ---- */
  var scoresByTerm = {};
  scores.forEach(function(s) {
    var tid = s.termId.toString();
    if (!scoresByTerm[tid]) { scoresByTerm[tid] = []; }
    scoresByTerm[tid].push(s);
  });

  /* ---- 8. Build academicHistory per term ---- */
  var academicHistory = [];
  Object.keys(scoresByTerm).forEach(function(termId) {
    var termScores = scoresByTerm[termId];
    var term       = termMap[termId];
    if (!term) { return; }

    var classId   = termScores[0] && termScores[0].classId;
    var classIdStr= classId ? classId.toString() : '';

    /* Subjects — sorted by name for determinism */
    var subjects = termScores
      .filter(function(s) { return s.subjectId && s.subjectId._id; })
      .sort(function(a, b) {
        return (a.subjectId.name || '').localeCompare(b.subjectId.name || '');
      })
      .map(function(s) {
        /* Determine class from score's classId — HISTORICAL accuracy */
        return {
          name:        s.subjectId.name        || '',
          code:        s.subjectId.code        || '',
          isCore:      s.subjectId.isCore      !== false,
          total:       s.total                 || 0,
          maxPossible: s.maxPossible           || 100,
          percentage:  s.percentage            || 0,
          grade:       s.grade                 || '',
          remark:      s.remark                || '',
          position:    s.position              || null,
          positionOutOf: s.positionOutOf       || null
        };
      });

    var validSubjects = subjects.filter(function(s) { return s.total !== null; });
    var pctSum       = validSubjects.reduce(function(a, s) { return a + (s.percentage || 0); }, 0);
    var totalMarks   = validSubjects.reduce(function(a, s) { return a + (s.total       || 0); }, 0);
    var maxSum       = validSubjects.reduce(function(a, s) { return a + (s.maxPossible || 0); }, 0);
    var passed       = validSubjects.filter(function(s) { return (s.percentage || 0) >= 50; }).length;

    /* className from scores' classId context — historical, not student.classId */
    var settingsKey = classIdStr + ':' + termId;
    var settings    = settingsMap[settingsKey] || null;

    /* Class name best effort from classHistory */
    var classNameFromHistory = '';
    if (student.classHistory) {
      var histEntry = student.classHistory.slice().reverse().find(function(h) {
        return h.classId && h.classId.toString() === classIdStr &&
               (h.session === term.session);
      });
      if (histEntry) { classNameFromHistory = histEntry.className || ''; }
    }

    academicHistory.push({
      session:      term.session || '',
      term:         term.term   || '',
      termName:     term.name   || '',
      termOrder:    termSortVal(term.term),
      className:    classNameFromHistory,
      classId:      classIdStr,
      subjects,
      summary: {
        totalMarks,
        maxPossibleSum: maxSum,
        avgPercent:     validSubjects.length > 0 ? Math.round((pctSum / validSubjects.length) * 100) / 100 : 0,
        subjectsPassed: passed,
        subjectsTotal:  validSubjects.length
      },
      settings: settings ? {
        isReleased:       settings.isReleased || false,
        principalComment: settings.principalComment || '',
        resumptionDate:   settings.resumptionDate || null
      } : null
    });
  });

  /* Sort academicHistory: session ASC, term order ASC */
  academicHistory.sort(function(a, b) {
    var sc = a.session.localeCompare(b.session);
    if (sc !== 0) { return sc; }
    return a.termOrder - b.termOrder;
  });

  /* ---- 9. Promotion history from classHistory (authoritative) ---- */
  var promotionHistory = (student.classHistory || [])
    .filter(function(h) { return ['promoted','repeated','graduated','transferred_out'].includes(h.action); })
    .map(function(h) {
      return {
        action:    h.action,
        className: h.className  || '',
        session:   h.session    || '',
        term:      h.term       || '',
        date:      h.recordedAt || null
      };
    })
    .sort(function(a, b) {
      var sc = a.session.localeCompare(b.session);
      if (sc !== 0) { return sc; }
      return termSortVal(a.term) - termSortVal(b.term);
    });

  /* ---- 10. Awards from PortfolioEntry (non-confidential only) ---- */
  var awards = [];
  try {
    var entries = await PortfolioEntry.find({
      schoolId, studentId,
      entryType:      { $in: ['award', 'achievement', 'milestone'] },
      status:         'active',
      isConfidential: { $ne: true }
    }).select('title description entryType date academicYear').lean();

    awards = entries.map(function(e) {
      return {
        type:        e.entryType,
        title:       e.title       || '',
        description: e.description || '',
        date:        e.date        || null,
        academicYear:e.academicYear|| ''
      };
    }).sort(function(a, b) {
      /* Sort by date, then title for determinism */
      if (a.date && b.date) { return new Date(a.date) - new Date(b.date); }
      return (a.title || '').localeCompare(b.title || '');
    });
  } catch(e) { /* non-fatal */ }

  /* ---- 11. Assemble canonical data object ---- */
  var canonicalData = {
    /* E5-owned metadata (not signed academic data) */
    transcriptId:    'placeholder', /* replaced by actual _id on create */
    version:         1,
    issuedAt:        null, /* set on issuance */

    /* Institutional identity */
    institution: {
      id:      school._id.toString(),
      name:    school.name          || '',
      address: school.address       || '',
      state:   school.state         || '',
      phone:   school.phone         || '',
      email:   school.email         || ''
    },

    /* Student identity */
    student: {
      name:        student.name          || '',
      admissionNo: student.admissionNo   || '',
      studentCode: student.studentId     || '',
      gender:      student.gender        || '',
      joinedYear:  student.joinedYear    || null
    },

    /* Scope */
    scope: {
      type:     scope.type     || 'full',
      sessions: (scope.sessions || []).slice().sort()
    },

    /* Academic content */
    academicHistory,
    promotionHistory,
    awards,
    currentStatus: portfolio ? portfolio.portfolioStatus : (student.status || 'active')
  };

  return { canonicalData, raw: { school, student } };
}

/* ============================================
   buildCanonicalSnapshot(canonicalData) → { snapshot, hash }
   Makes canonicalData deterministic and hashes it.
============================================ */
function buildCanonicalSnapshot(canonicalData) {
  var snapshot = signingService.deterministicJSON(canonicalData);
  var hash     = signingService.hashCanonicalData(snapshot);
  return { snapshot, hash };
}

/* ============================================
   generateTranscriptPDF(canonicalData, transcriptMeta)
   Reuses E3 pdfkit infrastructure.
   Returns Buffer.
   transcriptMeta: { verificationId, verificationUrl,
                     school, student, signature, keyId }
============================================ */
async function generateTranscriptPDF(canonicalData, transcriptMeta) {
  var PDFDocument;
  try { PDFDocument = require('pdfkit'); }
  catch(e) { throw new Error('pdfkit not installed. Run: npm install pdfkit'); }

  var QRCode;
  try { QRCode = require('qrcode'); }
  catch(e) { throw new Error('qrcode not installed. Run: npm install qrcode'); }

  var school   = transcriptMeta.school   || canonicalData.institution  || {};
  var student  = transcriptMeta.student  || canonicalData.student      || {};
  var primary  = school.primaryColor || '#6c63ff';
  var history  = canonicalData.academicHistory  || [];
  var awards   = canonicalData.awards           || [];
  var promo    = canonicalData.promotionHistory || [];

  /* Fetch images gracefully */
  var [logoBuffer, photoBuffer] = await Promise.all([
    pdfService.fetchImageBuffer(school.logo),
    pdfService.fetchImageBuffer(student.passportPhotoUrl || student.photo)
  ]);

  /* QR code (verification URL only — no academic data in QR) */
  var qrBuffer = null;
  if (transcriptMeta.verificationUrl) {
    try {
      qrBuffer = await QRCode.toBuffer(transcriptMeta.verificationUrl, {
        type: 'png', width: 160, margin: 1,
        color: { dark: '#1a1a2e', light: '#ffffff' }
      });
    } catch(e) { console.warn('[E5/PDF] QR generation failed:', e.message); }
  }

  return new Promise(function(resolve, reject) {
    try {
      var doc    = new PDFDocument({ size: 'A4', margin: 0 });
      var chunks = [];
      doc.on('data', function(c) { chunks.push(c); });
      doc.on('end',  function()  { resolve(Buffer.concat(chunks)); });
      doc.on('error', reject);

      var pageW  = doc.page.width;  /* 595 */
      var margin = 40;
      var usable = pageW - (margin * 2);

      /* ---- HEADER ---- */
      doc.fillColor(primary).rect(0, 0, pageW, 88).fill();

      if (logoBuffer) {
        try { doc.image(logoBuffer, margin, 12, { width: 64, height: 64 }); }
        catch(e) {}
      }

      var hx = margin + 72;
      var hw = pageW - hx - margin;
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(15)
         .text((school.name || '').toUpperCase(), hx, 14, { width: hw, align: 'center', lineBreak: false });
      doc.font('Helvetica').fontSize(11).fillColor('rgba(255,255,255,0.9)')
         .text('OFFICIAL ACADEMIC TRANSCRIPT', hx, 32, { width: hw, align: 'center', lineBreak: false });
      doc.fontSize(8).fillColor('rgba(255,255,255,0.7)')
         .text([school.address, school.phone, school.email].filter(Boolean).join(' · '),
               hx, 50, { width: hw, align: 'center', lineBreak: false });
      if (school.motto) {
        doc.fontSize(7).text('"' + school.motto + '"', hx, 64,
                             { width: hw, align: 'center', lineBreak: false });
      }

      var y = 96;

      /* ---- STUDENT IDENTITY SECTION ---- */
      var photoW = 72;
      var photoH = 90;
      var photoX = pageW - margin - photoW;

      if (photoBuffer) {
        try {
          doc.strokeColor(primary).lineWidth(1.5)
             .rect(photoX - 2, y - 2, photoW + 4, photoH + 4).stroke();
          doc.image(photoBuffer, photoX, y, { width: photoW, height: photoH });
        } catch(e) {
          doc.strokeColor('#cccccc').lineWidth(0.8)
             .rect(photoX, y, photoW, photoH).stroke();
          doc.fillColor('#aaaaaa').fontSize(8)
             .text('No Photo', photoX, y + 38, { width: photoW, align: 'center' });
        }
      }

      doc.fillColor(primary).font('Helvetica-Bold').fontSize(16)
         .text(student.name || canonicalData.student.name || '', margin, y, { width: usable - photoW - 12 });

      var infoItems = [
        ['Admission No:',  (student.admissionNo || canonicalData.student.admissionNo || '—')],
        ['Student ID:',    (student.studentCode  || canonicalData.student.studentCode  || '—')],
        ['Gender:',        (student.gender       || canonicalData.student.gender       || '—')],
        ['Year of Entry:', (student.joinedYear   || canonicalData.student.joinedYear   || '—')],
        ['Status:',        (canonicalData.currentStatus || '—').charAt(0).toUpperCase() +
                           (canonicalData.currentStatus || '').slice(1)]
      ];

      var iy = y + 20;
      var lw = (usable - photoW - 12) / 2;
      infoItems.forEach(function(item, i) {
        var col = i < 3 ? margin      : margin + lw;
        var iy2 = i < 3 ? (iy + i*14) : (iy + (i-3)*14);
        doc.fillColor('#666666').font('Helvetica').fontSize(8)
           .text(item[0], col, iy2, { continued: false, lineBreak: false });
        doc.fillColor('#1a1a2e').font('Helvetica-Bold').fontSize(8)
           .text(String(item[1]), col + 75, iy2, { lineBreak: false });
      });

      y += Math.max(photoH, 75) + 16;

      /* Scope label */
      var scopeLabel = canonicalData.scope.type === 'session'
        ? 'Sessions: ' + (canonicalData.scope.sessions || []).join(', ')
        : 'Complete Academic Record';
      doc.fillColor(primary).rect(margin, y, usable, 20).fill();
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9)
         .text('TRANSCRIPT SCOPE: ' + scopeLabel.toUpperCase(),
               margin, y + 6, { width: usable, align: 'center', lineBreak: false });
      y += 28;

      /* ---- ACADEMIC HISTORY ---- */
      doc.fillColor('#1a1a2e').font('Helvetica-Bold').fontSize(10)
         .text('ACADEMIC PERFORMANCE HISTORY', margin, y);
      y += 14;

      /* Group by session */
      var sessionMap = {};
      history.forEach(function(h) {
        var s = h.session || 'Unknown';
        if (!sessionMap[s]) { sessionMap[s] = []; }
        sessionMap[s].push(h);
      });

      Object.keys(sessionMap).sort().forEach(function(session) {
        /* Page break check */
        if (y > doc.page.height - 160) { doc.addPage(); y = 40; }

        /* Session header */
        doc.fillColor(primary).fillOpacity(0.12)
           .rect(margin, y, usable, 16).fill();
        doc.fillOpacity(1).fillColor(primary).font('Helvetica-Bold').fontSize(9)
           .text('ACADEMIC SESSION: ' + session.toUpperCase(),
                 margin + 6, y + 4, { lineBreak: false });
        y += 20;

        sessionMap[session].forEach(function(termRecord) {
          if (y > doc.page.height - 120) { doc.addPage(); y = 40; }

          /* Term sub-header */
          doc.fillColor('#444').font('Helvetica-Bold').fontSize(8)
             .text((termRecord.termName || '') + (termRecord.className ? ' · ' + termRecord.className : ''),
                   margin, y, { lineBreak: false });
          y += 12;

          /* Subject table */
          var colW = [155, 45, 45, 45, 42, 70, 70];
          var headers = ['Subject', 'Total', 'Max', '%', 'Grade', 'Remark', 'Position'];
          var tableX  = margin;
          var tableW  = colW.reduce(function(a, b) { return a + b; }, 0);

          /* Header row */
          doc.fillColor(primary).rect(tableX, y, tableW, 16).fill();
          var cx = tableX;
          headers.forEach(function(h, i) {
            doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5)
               .text(h, cx + 3, y + 5, { width: colW[i] - 6, lineBreak: false, ellipsis: true });
            cx += colW[i];
          });
          y += 16;

          /* Subject rows */
          (termRecord.subjects || []).forEach(function(s, rowIdx) {
            if (y > doc.page.height - 40) { doc.addPage(); y = 40; }
            if (rowIdx % 2 === 1) {
              doc.fillColor('#f5f5ff').rect(tableX, y, tableW, 14).fill();
            }
            var pos  = s.position ? (s.position + '/' + (s.positionOutOf || '')) : '—';
            var name = (s.isCore ? '★ ' : '') + (s.name || '—');
            var pct  = s.percentage != null ? s.percentage + '%' : '—';
            var row  = [name, s.total != null ? s.total : '—', s.maxPossible || '—',
                        pct, s.grade || '—', s.remark || '—', pos];
            cx = tableX;
            row.forEach(function(cell, ci) {
              doc.fillColor('#1a1a2e').font('Helvetica').fontSize(7.5)
                 .text(String(cell), cx + 3, y + 4,
                       { width: colW[ci] - 6, lineBreak: false, ellipsis: true });
              cx += colW[ci];
            });
            doc.strokeColor('#e0e0e0').lineWidth(0.3)
               .moveTo(tableX, y + 14).lineTo(tableX + tableW, y + 14).stroke();
            y += 14;
          });

          /* Term summary */
          var sum = termRecord.summary || {};
          doc.fillColor(primary).rect(tableX, y, tableW, 16).fill();
          doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5)
             .text('Average: ' + (sum.avgPercent || 0) + '%  |  ' +
                   'Passed: ' + (sum.subjectsPassed || 0) + '/' + (sum.subjectsTotal || 0) + '  |  ' +
                   'Total: ' + (sum.totalMarks || 0) + '/' + (sum.maxPossibleSum || 0),
                   tableX, y + 5, { width: tableW, align: 'center', lineBreak: false });
          y += 20;
        });

        y += 8;
      });

      /* ---- PROMOTION HISTORY ---- */
      if (promo.length > 0) {
        if (y > doc.page.height - 80) { doc.addPage(); y = 40; }
        doc.fillColor('#1a1a2e').font('Helvetica-Bold').fontSize(10).text('ACADEMIC PROGRESSION', margin, y);
        y += 14;
        promo.forEach(function(p, i) {
          var label = (p.action || '').toUpperCase().replace(/_/g, ' ');
          var ctx   = p.session + (p.term ? ' — ' + p.term : '') + (p.className ? ' · ' + p.className : '');
          doc.fillColor(i % 2 === 0 ? '#f5f5ff' : '#ffffff')
             .rect(margin, y, usable, 14).fill();
          doc.fillColor('#333').font('Helvetica').fontSize(8)
             .text(label, margin + 4, y + 4, { continued: true });
          doc.fillColor('#666').font('Helvetica').fontSize(8)
             .text('   ' + ctx, { lineBreak: false });
          y += 14;
        });
        y += 10;
      }

      /* ---- AWARDS & ACHIEVEMENTS ---- */
      if (awards.length > 0) {
        if (y > doc.page.height - 80) { doc.addPage(); y = 40; }
        doc.fillColor('#1a1a2e').font('Helvetica-Bold').fontSize(10).text('AWARDS & ACHIEVEMENTS', margin, y);
        y += 14;
        awards.forEach(function(a, i) {
          doc.fillColor(i % 2 === 0 ? '#f5f5ff' : '#ffffff')
             .rect(margin, y, usable, 14).fill();
          doc.fillColor(primary).font('Helvetica-Bold').fontSize(8)
             .text(a.title || '—', margin + 4, y + 4, { continued: true });
          if (a.description) {
            doc.fillColor('#555').font('Helvetica').fontSize(7.5)
               .text('  — ' + a.description, { lineBreak: false, ellipsis: true });
          }
          y += 14;
        });
        y += 10;
      }

      /* ---- TRANSCRIPT METADATA + QR ---- */
      if (y > doc.page.height - 140) { doc.addPage(); y = 40; }

      /* QR code — right side */
      var qrSize = 80;
      var qrX    = pageW - margin - qrSize;
      if (qrBuffer) {
        try {
          doc.image(qrBuffer, qrX, y, { width: qrSize, height: qrSize });
          doc.fillColor('#888').font('Helvetica').fontSize(6.5)
             .text('Scan to verify', qrX, y + qrSize + 2, { width: qrSize, align: 'center' });
        } catch(e) {}
      }

      /* Metadata box */
      var metaW = usable - qrSize - 16;
      doc.fillColor(primary).fillOpacity(0.06)
         .rect(margin, y, metaW, 90).fill();
      doc.fillOpacity(1).strokeColor(primary).lineWidth(0.8)
         .rect(margin, y, metaW, 90).stroke();

      var my = y + 8;
      var meta = [
        ['Transcript ID:',    transcriptMeta.verificationId || '—'],
        ['Issue Date:',       transcriptMeta.issuedAt
          ? new Date(transcriptMeta.issuedAt).toLocaleDateString('en-GB',
              { day:'numeric', month:'long', year:'numeric' })
          : new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })],
        ['Scope:',            scopeLabel],
        ['Signed:',           transcriptMeta.keyId
          ? 'Yes (Key: ' + transcriptMeta.keyId + ')' : 'Unsigned'],
        ['Verify at:',        transcriptMeta.verificationUrl || '—']
      ];
      meta.forEach(function(m) {
        doc.fillColor(primary).font('Helvetica-Bold').fontSize(7.5)
           .text(m[0], margin + 8, my, { continued: false, lineBreak: false });
        doc.fillColor('#1a1a2e').font('Helvetica').fontSize(7.5)
           .text(m[1], margin + 100, my, { width: metaW - 108, lineBreak: false, ellipsis: true });
        my += 13;
      });

      y += 100;

      /* ---- FOOTER ---- */
      var footerY = doc.page.height - 52;
      doc.fillColor('#f0f0f5').rect(0, footerY, pageW, 52).fill();

      /* Official statement */
      doc.fillColor('#333').font('Helvetica').fontSize(7.5)
         .text('This is an official academic transcript issued by ' + (school.name || '') +
               ' through the LatLomp Education Platform. Verify authenticity at: ' +
               (transcriptMeta.verificationUrl || 'latlomp.com/verify'),
               margin, footerY + 8, { width: usable - 120, lineBreak: false });

      /* Signature line */
      doc.strokeColor('#333').lineWidth(0.5)
         .moveTo(pageW - margin - 110, footerY + 36)
         .lineTo(pageW - margin - 10,  footerY + 36).stroke();
      doc.fillColor('#666').fontSize(7)
         .text('Authorised Signature', pageW - margin - 110, footerY + 38,
               { width: 100, align: 'center', lineBreak: false });

      doc.fillColor('#999').font('Helvetica').fontSize(6.5)
         .text('LatLomp Education Platform · Generated ' + new Date().toLocaleDateString('en-GB'),
               margin, footerY + 40, { width: usable, align: 'center', lineBreak: false });

      doc.end();
    } catch(buildErr) {
      reject(buildErr);
    }
  });
}

/* ============================================
   requestTranscript(studentId, schoolId, scope, requestedBy, requestSource)
   Creates TranscriptRequest in 'requested' state.
============================================ */
async function requestTranscript(studentId, schoolId, scope, requestedBy, requestSource) {
  var portfolio = await AcademicPortfolio.findOne({ studentId, schoolId }).select('_id').lean();

  var transcript = await TranscriptRequest.create({
    schoolId,
    studentId,
    portfolioId:     portfolio ? portfolio._id : null,
    scope:           scope || { type: 'full', sessions: [] },
    status:          'requested',
    version:         1,
    requestedBy:     requestedBy ? requestedBy._id : null,
    requestedByName: requestedBy ? (requestedBy.name || '') : '',
    requestedByRole: requestedBy ? (requestedBy.role || '') : '',
    requestSource:   requestSource || 'staff',
    auditLog: [{
      action:    'transcript_requested',
      actor:     requestedBy ? requestedBy._id : null,
      actorName: requestedBy ? (requestedBy.name || '') : '',
      actorRole: requestedBy ? (requestedBy.role || '') : '',
      timestamp: new Date()
    }]
  });

  return transcript;
}

/* ============================================
   generateAndIssue(transcriptId, schoolId, generatedBy)
   Full pipeline:
     1. Load transcript request
     2. Assemble canonical data
     3. Sign
     4. Generate PDF
     5. Store
     6. Update record
     7. Update AcademicPortfolio.lastTranscriptRef
   Returns: { transcript, verificationUrl }
============================================ */
async function generateAndIssue(transcriptId, schoolId, generatedBy) {
  var transcript = await TranscriptRequest.findOne({ _id: transcriptId, schoolId });
  if (!transcript) { throw new Error('Transcript request not found.'); }
  if (!['requested', 'failed'].includes(transcript.status)) {
    throw new Error('Cannot generate a transcript with status: ' + transcript.status);
  }

  /* Mark generating */
  transcript.status = 'generating';
  transcript.auditLog.push({
    action:    'transcript_generating',
    actor:     generatedBy ? generatedBy._id : null,
    actorName: generatedBy ? (generatedBy.name || '') : '',
    actorRole: generatedBy ? (generatedBy.role || '') : '',
    timestamp: new Date()
  });
  await transcript.save();

  try {
    /* ---- 1. Assemble canonical data ---- */
    var assembled = await assembleCanonicalTranscriptData(
      transcript.studentId.toString(),
      schoolId,
      transcript.scope
    );
    if (!assembled) { throw new Error('Student or school not found.'); }

    var { canonicalData, raw } = assembled;

    /* ---- 2. Generate verificationId ---- */
    var verificationId = crypto.randomBytes(18).toString('base64url');
    var issuedAt       = new Date();

    /* ---- 3. Finalize canonical data with issuance metadata ---- */
    canonicalData.transcriptId = transcript._id.toString();
    canonicalData.version      = transcript.version;
    canonicalData.issuedAt     = issuedAt.toISOString();

    /* ---- 4. Build deterministic snapshot + hash ---- */
    var { snapshot, hash } = buildCanonicalSnapshot(canonicalData);

    /* ---- 5. Sign ---- */
    var sigResult = signingService.signData(snapshot);

    /* ---- 6. Generate verification URL ---- */
    var appUrl          = (process.env.APP_URL || 'https://latlompsystem.up.railway.app').replace(/\/$/, '');
    var verificationUrl = appUrl + '/institution/transcript-verify.html?ref=' + verificationId;

    /* ---- 7. Generate PDF ---- */
    var pdfBuffer = await generateTranscriptPDF(canonicalData, {
      school:          raw.school,
      student:         raw.student,
      verificationId,
      verificationUrl,
      issuedAt,
      keyId:           sigResult.keyId,
      signature:       sigResult.signature
    });

    /* ---- 8. Hash PDF ---- */
    var documentHash = pdfService.hashDocument(pdfBuffer);

    /* ---- 9. Store PDF ---- */
    var storageInfo;
    try {
      storageInfo = await pdfService.storeDocument(pdfBuffer, {
        schoolId,
        studentId: transcript.studentId.toString(),
        termId:    'transcript',
        version:   transcript.version,
        documentType: 'transcript'
      });
    } catch(storeErr) {
      console.error('[E5] Storage failed:', storeErr.message);
      storageInfo = { provider: 'error', key: '', url: '' };
    }

    /* ---- 10. Update transcript record ---- */
    transcript.canonicalSnapshot = snapshot;
    transcript.canonicalHash     = hash;
    transcript.documentHash      = documentHash;
    transcript.storage           = storageInfo;
    transcript.signature         = sigResult.signature || null;
    transcript.signingKeyId      = sigResult.keyId     || null;
    transcript.algorithm         = sigResult.algorithm || null;
    transcript.verificationId    = verificationId;
    transcript.status            = 'issued';
    transcript.generatedAt       = issuedAt;
    transcript.issuedAt          = issuedAt;
    transcript.generatedBy       = generatedBy ? generatedBy._id   : null;
    transcript.generatedByName   = generatedBy ? (generatedBy.name || '') : '';
    transcript.auditLog.push({
      action:    'transcript_issued',
      actor:     generatedBy ? generatedBy._id : null,
      actorName: generatedBy ? (generatedBy.name || '') : '',
      actorRole: generatedBy ? (generatedBy.role || '') : '',
      timestamp: issuedAt,
      metadata:  new Map([
        ['verificationId', verificationId],
        ['signed',         String(!!sigResult.signature)]
      ])
    });
    await transcript.save();

    /* ---- 11. Update AcademicPortfolio.lastTranscriptRef ---- */
    try {
      await AcademicPortfolio.findOneAndUpdate(
        { studentId: transcript.studentId, schoolId },
        { $set: { lastTranscriptRef: transcript._id } }
      );
    } catch(pe) { /* non-fatal */ }

    return { transcript, verificationUrl };
  } catch(err) {
    /* Mark failed — can be retried */
    transcript.status        = 'failed';
    transcript.failureReason = err.message;
    transcript.auditLog.push({
      action:    'transcript_failed',
      timestamp: new Date(),
      metadata:  new Map([['error', err.message]])
    });
    await transcript.save();
    throw err;
  }
}

/* ============================================
   revokeTranscript(transcriptId, schoolId, revokedBy, reason, newStatus)
   newStatus: 'revoked' | 'invalidated' | 'superseded'
============================================ */
async function revokeTranscript(transcriptId, schoolId, revokedBy, reason, newStatus) {
  newStatus = newStatus || 'revoked';
  if (!['revoked','invalidated','superseded'].includes(newStatus)) {
    throw new Error('Invalid revocation status: ' + newStatus);
  }
  if (!reason || !reason.trim()) {
    throw new Error('Revocation reason is required.');
  }

  var transcript = await TranscriptRequest.findOne({ _id: transcriptId, schoolId });
  if (!transcript) { throw new Error('Transcript not found.'); }
  if (!['issued'].includes(transcript.status)) {
    throw new Error('Only issued transcripts can be revoked. Current status: ' + transcript.status);
  }

  var now = new Date();
  transcript.status          = newStatus;
  transcript.revokedAt       = now;
  transcript.revokedBy       = revokedBy ? revokedBy._id   : null;
  transcript.revokedByName   = revokedBy ? (revokedBy.name || '') : '';
  transcript.revocationReason= reason.trim();
  transcript.auditLog.push({
    action:    'transcript_' + newStatus,
    actor:     revokedBy ? revokedBy._id : null,
    actorName: revokedBy ? (revokedBy.name || '') : '',
    actorRole: revokedBy ? (revokedBy.role || '') : '',
    timestamp: now,
    metadata:  new Map([['reason', reason.trim()]])
  });
  await transcript.save();
  return transcript;
}

/* ============================================
   verifyTranscript(verificationId) → verification result
   Public verification. Returns minimum information.
   Never exposes full academic data or private info.
============================================ */
async function verifyTranscript(verificationId) {
  if (!verificationId || typeof verificationId !== 'string') {
    return { verified: false, status: 'NOT_FOUND', message: 'Invalid verification reference.' };
  }

  var transcript = await TranscriptRequest.findOne({ verificationId })
    .select('status canonicalSnapshot canonicalHash signature signingKeyId algorithm ' +
            'version issuedAt revokedAt revocationReason generatedByName ' +
            'scope schoolId studentId portfolioId supersededBy')
    .lean();

  if (!transcript) {
    /* Anti-enumeration: same response for wrong ID and non-existent */
    return { verified: false, status: 'NOT_FOUND', message: 'Verification reference not found or invalid.' };
  }

  /* Revoked/superseded/invalidated */
  if (['revoked','invalidated','superseded'].includes(transcript.status)) {
    return {
      verified:     false,
      status:       transcript.status.toUpperCase(),
      message:      transcript.status === 'superseded'
        ? 'This transcript has been superseded by a newer version.'
        : 'This transcript has been ' + transcript.status + '.',
      revokedAt:    transcript.revokedAt     || null,
      reason:       transcript.revocationReason || '',
      issuedAt:     transcript.issuedAt      || null,
      version:      transcript.version
    };
  }

  if (transcript.status !== 'issued') {
    return { verified: false, status: 'NOT_ISSUED', message: 'This transcript has not been issued.' };
  }

  /* ---- Data integrity verification ---- */
  var dataIntegrityStatus;
  var canonicalIntegrityValid = false;
  if (transcript.canonicalSnapshot && transcript.canonicalHash) {
    var recomputedHash = signingService.hashCanonicalData(transcript.canonicalSnapshot);
    canonicalIntegrityValid = (recomputedHash === transcript.canonicalHash);
    dataIntegrityStatus = canonicalIntegrityValid ? 'HASH_VERIFIED' : 'HASH_MISMATCH';
  } else {
    dataIntegrityStatus = 'HASH_UNAVAILABLE';
  }

  /* ---- Signature verification ---- */
  var sigResult = signingService.verifySignature(
    transcript.canonicalSnapshot || '',
    transcript.signature,
    transcript.signingKeyId
  );

  /* ---- School + student minimal display info ---- */
  var school = null;
  var studentDisplay = null;
  try {
    school = await School.findById(transcript.schoolId)
      .select('name address phone logo primaryColor').lean();
    var st = await SchoolStudent.findById(transcript.studentId)
      .select('name admissionNo').lean();
    if (st) {
      studentDisplay = {
        name:        st.name,
        admissionNo: st.admissionNo || ''
      };
    }
  } catch(e) { /* non-fatal — verification still proceeds */ }

  var overallVerified = canonicalIntegrityValid &&
    (sigResult.signatureStatus === 'VALID' || sigResult.signatureStatus === 'UNSIGNED');

  return {
    verified:          overallVerified,
    status:            'VALID',
    message:           overallVerified
      ? 'This transcript is authentic and has not been modified.'
      : 'Transcript data integrity could not be fully confirmed.',

    /* Institution info */
    institution: school ? {
      name:    school.name    || '',
      address: school.address || '',
      phone:   school.phone   || ''
    } : null,

    /* Minimum student info for verification */
    studentDisplay,

    /* Document metadata */
    documentType:  'Official Academic Transcript',
    verificationId,
    version:       transcript.version,
    scope:         transcript.scope,
    issuedAt:      transcript.issuedAt,

    /* Integrity results */
    dataIntegrityStatus,
    signatureStatus:  sigResult.signatureStatus,
    integrityStatus:  sigResult.integrityStatus,
    algorithm:        transcript.algorithm || null,
    signingKeyId:     transcript.signingKeyId || null
  };
}

module.exports = {
  assembleCanonicalTranscriptData,
  buildCanonicalSnapshot,
  generateTranscriptPDF,
  requestTranscript,
  generateAndIssue,
  revokeTranscript,
  verifyTranscript
};