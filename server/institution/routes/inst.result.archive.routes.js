'use strict';
/* ============================================
   LATLOMP INSTITUTION — RESULT ARCHIVE ROUTES (E3)

   Staff routes for archive management.
   Student access via inst.student.portal.routes.js.

   Does NOT duplicate inst.reportcard.routes.js.
   Different concern: archive/document lifecycle
   vs. live class report card views.

   Convention follows inst.student.mgmt.routes.js.
============================================ */
const express       = require('express');
const router        = express.Router();
const mongoose      = require('mongoose');

const ResultArchiveRecord = require('../models/ResultArchiveRecord.model');
const archiveService      = require('../services/result.archive.service');
const pdfService          = require('../services/result.pdf.service');

const {
  instProtect,
  schoolAdminOnly,
  seniorStaffOrAdmin,
  canManageStudents,
  teacherOrAdmin
} = require('../middleware/inst.auth');
const { requireActiveSubscription } = require('../middleware/inst.tenant');

var readGuard   = [instProtect, teacherOrAdmin,     requireActiveSubscription];
var manageGuard = [instProtect, canManageStudents,  requireActiveSubscription];
var seniorGuard = [instProtect, seniorStaffOrAdmin, requireActiveSubscription];
var adminGuard  = [instProtect, schoolAdminOnly,    requireActiveSubscription];

/* ============================================
   GET /api/institution/archive/student/:studentId/history
   Lists all academic terms a student has scores in.
   Staff always sees all terms (not filtered by release).
============================================ */
router.get('/student/:studentId/history', readGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.studentId)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }

    /* Verify student belongs to this school */
    var SchoolStudent = require('../models/SchoolStudent.model');
    var student = await SchoolStudent.findOne({
      _id: req.params.studentId, schoolId: req.schoolId
    }).select('name admissionNo class status').lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    var history = await archiveService.getStudentTermHistory(
      req.params.studentId,
      req.schoolId,
      { releasedOnly: false } /* staff sees all terms */
    );

    return res.json({
      success: true,
      student: {
        _id:        student._id,
        name:       student.name,
        admissionNo:student.admissionNo || '',
        class:      student.class       || '',
        status:     student.status
      },
      history,
      count: history.length
    });
  } catch (err) {
    console.error('[archive] GET /history:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/archive/student/:studentId/term/:termId
   Full assembled report data for a student + term.
   Staff access — no release filter.
============================================ */
router.get('/student/:studentId/term/:termId', readGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.studentId) ||
        !mongoose.isValidObjectId(req.params.termId)) {
      return res.status(400).json({ success: false, message: 'Invalid ID.' });
    }

    var data = await archiveService.assembleReportData(
      req.params.studentId,
      req.schoolId,
      req.params.termId,
      { releasedOnly: false }
    );

    if (!data) {
      return res.status(404).json({ success: false, message: 'Student or term not found.' });
    }

    /* Find existing archive record (if any) */
    var archiveRecord = await ResultArchiveRecord.findOne({
      schoolId:  req.schoolId,
      studentId: req.params.studentId,
      termId:    req.params.termId,
      status:    { $in: ['generated', 'issued'] }
    }).select('_id documentVersion status generatedAt storage.url').lean();

    return res.json({
      success: true,
      data,
      archiveRecord: archiveRecord || null
    });
  } catch (err) {
    console.error('[archive] GET /term:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /api/institution/archive/student/:studentId/term/:termId/generate
   Generate PDF, store, create/update archive record.
   Requires senior staff — generating official documents.
============================================ */
router.post('/student/:studentId/term/:termId/generate', seniorGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.studentId) ||
        !mongoose.isValidObjectId(req.params.termId)) {
      return res.status(400).json({ success: false, message: 'Invalid ID.' });
    }

    /* Assemble authoritative data */
    var reportData = await archiveService.assembleReportData(
      req.params.studentId,
      req.schoolId,
      req.params.termId,
      { releasedOnly: false }
    );
    if (!reportData) {
      return res.status(404).json({ success: false, message: 'Student or term not found.' });
    }

    /* Generate PDF */
    var pdfBuffer;
    try {
      pdfBuffer = await pdfService.generateReportCardPDF(reportData);
    } catch (pdfErr) {
      if (pdfErr.message && pdfErr.message.includes('pdfkit')) {
        return res.status(503).json({
          success: false,
          message: 'PDF generation not available. Run: npm install pdfkit',
          code:    'PDF_SERVICE_UNAVAILABLE'
        });
      }
      throw pdfErr;
    }

    /* Hash for E5 */
    var documentHash = pdfService.hashDocument(pdfBuffer);

    /* Determine version (for storage key) */
    var existing = await ResultArchiveRecord.findOne({
      schoolId: req.schoolId, studentId: req.params.studentId,
      termId: req.params.termId, documentType: 'report_card',
      status: { $in: ['generated', 'issued'] }
    }).select('documentVersion').lean();
    var nextVersion = existing ? (existing.documentVersion + 1) : 1;

    /* Store document */
    var storageInfo;
    try {
      storageInfo = await pdfService.storeDocument(pdfBuffer, {
        schoolId:     req.schoolId,
        studentId:    req.params.studentId,
        termId:       req.params.termId,
        version:      nextVersion,
        documentType: 'report_card'
      });
    } catch (storeErr) {
      /* Storage failure: still create record without URL — PDF can be regenerated */
      console.error('[archive] Storage failed:', storeErr.message);
      storageInfo = { provider: 'error', key: '', url: '' };
    }

    /* Create/version archive record */
    var archiveRecord = await archiveService.createOrUpdateArchiveRecord({
      schoolId:        req.schoolId,
      studentId:       req.params.studentId,
      termId:          req.params.termId,
      classId:         reportData.student.classId || null,
      academicYear:    reportData.term.session    || '',
      termSnapshot:    { name: reportData.term.name, session: reportData.term.session, term: reportData.term.term },
      classSnapshot:   { name: reportData.student.class || '' },
      documentType:    'report_card',
      documentHash,
      storage:         storageInfo,
      generatedBy:     req.schoolUser._id,
      generatedByName: req.schoolUser.name || ''
    });

    return res.status(201).json({
      success:         true,
      message:         'Report card generated successfully. Version ' + archiveRecord.documentVersion + '.',
      archiveRecord: {
        _id:             archiveRecord._id,
        documentVersion: archiveRecord.documentVersion,
        status:          archiveRecord.status,
        generatedAt:     archiveRecord.generatedAt,
        hasStoredFile:   !!storageInfo.url,
        downloadUrl:     storageInfo.url ? ('/api/institution/archive/documents/' + archiveRecord._id + '/download') : null
      }
    });
  } catch (err) {
    console.error('[archive] POST /generate:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/archive/documents/:documentId
   Archive record metadata (no file).
============================================ */
router.get('/documents/:documentId', manageGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.documentId)) {
      return res.status(400).json({ success: false, message: 'Invalid document ID.' });
    }

    var record = await archiveService.getArchiveDocument(req.params.documentId, req.schoolId);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Archive record not found.' });
    }

    return res.json({
      success: true,
      record: {
        _id:             record._id,
        studentId:       record.studentId,
        termId:          record.termId,
        documentType:    record.documentType,
        documentVersion: record.documentVersion,
        status:          record.status,
        termSnapshot:    record.termSnapshot,
        classSnapshot:   record.classSnapshot,
        academicYear:    record.academicYear,
        generatedAt:     record.generatedAt,
        generatedByName: record.generatedByName,
        issuedAt:        record.issuedAt,
        hasStoredFile:   !!(record.storage && record.storage.url),
        documentHash:    record.documentHash || null /* E5 reference */
      }
    });
  } catch (err) {
    console.error('[archive] GET /documents/:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/archive/documents/:documentId/download
   Downloads stored PDF or regenerates on-the-fly.
   Logs the download access for audit.
============================================ */
router.get('/documents/:documentId/download', manageGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.documentId)) {
      return res.status(400).json({ success: false, message: 'Invalid document ID.' });
    }

    var record = await archiveService.getArchiveDocument(req.params.documentId, req.schoolId);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Archive record not found.' });
    }
    if (record.status === 'revoked') {
      return res.status(403).json({
        success: false,
        message: 'This document has been revoked. Contact your administrator.'
      });
    }

    /* Build filename */
    var studentName = '';
    try {
      var SchoolStudent = require('../models/SchoolStudent.model');
      var st = await SchoolStudent.findById(record.studentId).select('name').lean();
      if (st) { studentName = st.name.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_'); }
    } catch (e) {}
    var termLabel   = (record.termSnapshot && record.termSnapshot.session) || '';
    var filename    = 'ReportCard_' + studentName + '_' + termLabel + '_v' + record.documentVersion + '.pdf';

    /* If stored, retrieve and serve */
    if (record.storage && record.storage.url && record.storage.provider !== 'error') {
      try {
        var pdfBuffer = await pdfService.retrieveDocument(record.storage);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
        res.setHeader('Content-Length', pdfBuffer.length);
        /* Audit log */
        console.log('[archive] Document downloaded: ' + record._id + ' by: ' + req.schoolUser._id);
        return res.end(pdfBuffer);
      } catch (retrieveErr) {
        console.warn('[archive] Stored file retrieve failed, regenerating:', retrieveErr.message);
      }
    }

    /* Fallback: regenerate on-the-fly */
    var reportData = await archiveService.assembleReportData(
      record.studentId.toString(), req.schoolId, record.termId.toString(),
      { releasedOnly: false }
    );
    if (!reportData) {
      return res.status(404).json({ success: false, message: 'Source data not found for regeneration.' });
    }
    var pdfBuf = await pdfService.generateReportCardPDF(reportData);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Content-Length', pdfBuf.length);
    console.log('[archive] Document regenerated on-demand: ' + record._id);
    return res.end(pdfBuf);
  } catch (err) {
    console.error('[archive] GET /download:', err.message);
    if (err.message && err.message.includes('pdfkit')) {
      return res.status(503).json({ success: false, message: 'PDF service unavailable. Run: npm install pdfkit' });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/archive/documents/:documentId/excel
   On-demand Excel export (no archiving needed).
   Assembled fresh from authoritative sources.
============================================ */
router.get('/documents/:documentId/excel', manageGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.documentId)) {
      return res.status(400).json({ success: false, message: 'Invalid document ID.' });
    }

    var record = await archiveService.getArchiveDocument(req.params.documentId, req.schoolId);
    if (!record || record.status === 'revoked') {
      return res.status(404).json({ success: false, message: 'Document not found or revoked.' });
    }

    var reportData = await archiveService.assembleReportData(
      record.studentId.toString(), req.schoolId, record.termId.toString(),
      { releasedOnly: false }
    );
    if (!reportData) {
      return res.status(404).json({ success: false, message: 'Source data not found.' });
    }

    var excelBuffer = archiveService.generateExcel(reportData);
    var termLabel   = (record.termSnapshot && record.termSnapshot.session) || '';
    var filename    = 'Results_' + termLabel + '_v' + record.documentVersion + '.xlsx';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    return res.end(excelBuffer);
  } catch (err) {
    console.error('[archive] GET /excel:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   DELETE /api/institution/archive/documents/:documentId
   Revoke archive record (admin only).
   Soft delete — record preserved for audit.
============================================ */
router.delete('/documents/:documentId', adminGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.documentId)) {
      return res.status(400).json({ success: false, message: 'Invalid document ID.' });
    }
    if (!req.body.reason || !req.body.reason.trim()) {
      return res.status(400).json({ success: false, message: 'A reason is required to revoke a document.' });
    }

    var record = await archiveService.getArchiveDocument(req.params.documentId, req.schoolId);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    if (record.status === 'revoked') {
      return res.status(400).json({ success: false, message: 'Document is already revoked.' });
    }

    await archiveService.revokeArchiveDocument(
      req.params.documentId, req.schoolId,
      req.schoolUser._id, req.body.reason.trim()
    );

    return res.json({ success: true, message: 'Document revoked. Record preserved for audit.' });
  } catch (err) {
    console.error('[archive] DELETE /documents/:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;