'use strict';
/* ============================================
   LATLOMP INSTITUTION — TRANSCRIPT ROUTES (E5)

   Staff + student (authenticated) transcript operations.
   Public verification → inst.transcript.verify.routes.js

   Guard conventions follow existing project:
   adminGuard  — revoke, configure
   seniorGuard — generate/issue
   manageGuard — view, request
============================================ */
const express          = require('express');
const router           = express.Router();
const mongoose         = require('mongoose');
const TranscriptRequest= require('../models/TranscriptRequest.model');
const transcriptService= require('../services/transcript.service');
const pdfService       = require('../services/result.pdf.service');
const {
  instProtect, schoolAdminOnly,
  seniorStaffOrAdmin, canManageStudents, teacherOrAdmin
} = require('../middleware/inst.auth');
const { requireActiveSubscription } = require('../middleware/inst.tenant');

var adminGuard  = [instProtect, schoolAdminOnly,    requireActiveSubscription];
var seniorGuard = [instProtect, seniorStaffOrAdmin, requireActiveSubscription];
var manageGuard = [instProtect, canManageStudents,  requireActiveSubscription];

/* ============================================
   POST /api/institution/transcripts
   Request a transcript for a student.
   Body: { studentId, scope: { type, sessions } }
============================================ */
router.post('/', seniorGuard, async function(req, res) {
  try {
    var { studentId, scope } = req.body;
    if (!studentId || !mongoose.isValidObjectId(studentId)) {
      return res.status(400).json({ success: false, message: 'Valid studentId is required.' });
    }

    /* Verify student belongs to this school */
    var SchoolStudent = require('../models/SchoolStudent.model');
    var student = await SchoolStudent.findOne({ _id: studentId, schoolId: req.schoolId })
      .select('name status').lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    /* Prevent duplicate in-progress requests */
    var existing = await TranscriptRequest.findOne({
      schoolId:  req.schoolId,
      studentId: studentId,
      status:    { $in: ['requested', 'generating'] }
    }).select('_id status').lean();
    if (existing) {
      return res.status(400).json({
        success:  false,
        message:  'A transcript request is already in progress for this student.',
        existingId: existing._id
      });
    }

    var validScope = { type: 'full', sessions: [] };
    if (scope && scope.type === 'session' && Array.isArray(scope.sessions) && scope.sessions.length > 0) {
      validScope = { type: 'session', sessions: scope.sessions };
    }

    var transcript = await transcriptService.requestTranscript(
      studentId, req.schoolId, validScope,
      req.schoolUser, 'staff'
    );

    return res.status(201).json({
      success:     true,
      message:     'Transcript request created for ' + student.name + '. Use /generate to issue it.',
      transcriptId: transcript._id,
      status:      transcript.status
    });
  } catch(err) {
    console.error('[inst.transcript] POST /:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/transcripts/student/:studentId
   List all transcripts for a student.
============================================ */
router.get('/student/:studentId', manageGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.studentId)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }

    var SchoolStudent = require('../models/SchoolStudent.model');
    var student = await SchoolStudent.findOne({
      _id: req.params.studentId, schoolId: req.schoolId
    }).select('name admissionNo class status').lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    var transcripts = await TranscriptRequest.find({
      schoolId:  req.schoolId,
      studentId: req.params.studentId
    })
    .select('-canonicalSnapshot -auditLog') /* exclude large fields in list */
    .sort({ version: -1 })
    .lean();

    return res.json({
      success: true,
      student: { _id: student._id, name: student.name, admissionNo: student.admissionNo, class: student.class, status: student.status },
      transcripts,
      count: transcripts.length
    });
  } catch(err) {
    console.error('[inst.transcript] GET /student/:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/transcripts/:id
   Full transcript record (with audit log for admin).
============================================ */
router.get('/:id', manageGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid transcript ID.' });
    }

    var transcript = await TranscriptRequest.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId
    })
    .select('-canonicalSnapshot') /* not needed for display */
    .lean();

    if (!transcript) {
      return res.status(404).json({ success: false, message: 'Transcript not found.' });
    }

    var appUrl          = (process.env.APP_URL || 'https://latlompsystem.up.railway.app').replace(/\/$/, '');
    var verificationUrl = transcript.verificationId
      ? appUrl + '/institution/transcript-verify.html?ref=' + transcript.verificationId
      : null;

    return res.json({
      success:        true,
      transcript,
      verificationUrl,
      isSigned:       !!transcript.signature,
      hasStoredFile:  !!(transcript.storage && transcript.storage.url)
    });
  } catch(err) {
    console.error('[inst.transcript] GET /:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /api/institution/transcripts/:id/generate
   Generate PDF + issue transcript.
   seniorGuard — official issuance.
============================================ */
router.post('/:id/generate', seniorGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid transcript ID.' });
    }

    var result = await transcriptService.generateAndIssue(
      req.params.id, req.schoolId, req.schoolUser
    );

    return res.json({
      success:         true,
      message:         'Transcript issued successfully.',
      verificationId:  result.transcript.verificationId,
      verificationUrl: result.verificationUrl,
      version:         result.transcript.version,
      isSigned:        !!result.transcript.signature,
      algorithm:       result.transcript.algorithm || null,
      issuedAt:        result.transcript.issuedAt,
      hasStoredFile:   !!(result.transcript.storage && result.transcript.storage.url)
    });
  } catch(err) {
    console.error('[inst.transcript] POST /generate:', err.message);
    var status = err.message.includes('not installed') ? 503 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/transcripts/:id/download
   Download transcript PDF.
============================================ */
router.get('/:id/download', manageGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid transcript ID.' });
    }

    var transcript = await TranscriptRequest.findOne({
      _id: req.params.id, schoolId: req.schoolId
    }).lean();

    if (!transcript) {
      return res.status(404).json({ success: false, message: 'Transcript not found.' });
    }
    if (!['issued'].includes(transcript.status)) {
      return res.status(400).json({
        success: false,
        message: 'Transcript is not issued. Status: ' + transcript.status
      });
    }

    var pdfBuffer;
    var studentName = '';
    try {
      var SchoolStudent = require('../models/SchoolStudent.model');
      var st = await SchoolStudent.findById(transcript.studentId).select('name').lean();
      if (st) { studentName = st.name.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_'); }
    } catch(e) {}

    /* Try stored file first */
    if (transcript.storage && transcript.storage.url && transcript.storage.provider !== 'error') {
      try {
        pdfBuffer = await pdfService.retrieveDocument(transcript.storage);
      } catch(e) { console.warn('[E5] Stored transcript retrieve failed, regenerating.'); }
    }

    /* Regenerate on-the-fly if stored file unavailable */
    if (!pdfBuffer) {
      var assembled = await transcriptService.assembleCanonicalTranscriptData(
        transcript.studentId.toString(), req.schoolId, transcript.scope
      );
      if (!assembled) {
        return res.status(404).json({ success: false, message: 'Academic data not found.' });
      }

      var appUrl = (process.env.APP_URL || 'https://latlompsystem.up.railway.app').replace(/\/$/, '');
      assembled.canonicalData.transcriptId = transcript._id.toString();
      assembled.canonicalData.version      = transcript.version;
      assembled.canonicalData.issuedAt     = transcript.issuedAt
        ? new Date(transcript.issuedAt).toISOString() : new Date().toISOString();

      pdfBuffer = await transcriptService.generateTranscriptPDF(assembled.canonicalData, {
        school:          assembled.raw.school,
        student:         assembled.raw.student,
        verificationId:  transcript.verificationId,
        verificationUrl: appUrl + '/institution/transcript-verify.html?ref=' + transcript.verificationId,
        issuedAt:        transcript.issuedAt,
        keyId:           transcript.signingKeyId
      });
    }

    /* Audit log download */
    try {
      await TranscriptRequest.findByIdAndUpdate(transcript._id, {
        $push: { auditLog: {
          action:    'transcript_downloaded',
          actor:     req.schoolUser._id,
          actorName: req.schoolUser.name || '',
          actorRole: req.schoolUser.role || '',
          timestamp: new Date()
        }}
      });
    } catch(e) {}

    var filename = 'Transcript_' + studentName + '_v' + transcript.version + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.end(pdfBuffer);
  } catch(err) {
    console.error('[inst.transcript] GET /download:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   DELETE /api/institution/transcripts/:id
   Revoke/invalidate (admin only).
   Body: { reason, newStatus? }
   newStatus: 'revoked' | 'invalidated' (default 'revoked')
============================================ */
router.delete('/:id', adminGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid transcript ID.' });
    }
    if (!req.body.reason || !req.body.reason.trim()) {
      return res.status(400).json({ success: false, message: 'A reason is required for revocation.' });
    }

    var transcript = await transcriptService.revokeTranscript(
      req.params.id, req.schoolId, req.schoolUser,
      req.body.reason, req.body.newStatus || 'revoked'
    );

    return res.json({
      success:     true,
      message:     'Transcript ' + transcript.status + '. Verification reference will reflect this status.',
      status:      transcript.status,
      revokedAt:   transcript.revokedAt
    });
  } catch(err) {
    console.error('[inst.transcript] DELETE /:id:', err.message);
    return res.status(err.message.includes('not found') ? 404 : 400)
              .json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/transcripts/:id/audit
   Audit log (admin only).
============================================ */
router.get('/:id/audit', adminGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid transcript ID.' });
    }

    var transcript = await TranscriptRequest.findOne({
      _id: req.params.id, schoolId: req.schoolId
    }).select('auditLog status verificationId version studentId').lean();

    if (!transcript) {
      return res.status(404).json({ success: false, message: 'Transcript not found.' });
    }

    return res.json({
      success:        true,
      verificationId: transcript.verificationId,
      status:         transcript.status,
      version:        transcript.version,
      auditLog:       transcript.auditLog || []
    });
  } catch(err) {
    console.error('[inst.transcript] GET /:id/audit:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /api/institution/transcripts/:id/supersede
   Generate a new version, mark old as superseded.
   Body: { reason, scope? }
   adminGuard — official versioning action.
============================================ */
router.post('/:id/supersede', adminGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid transcript ID.' });
    }
    if (!req.body.reason || !req.body.reason.trim()) {
      return res.status(400).json({ success: false, message: 'A reason is required.' });
    }

    /* Load old transcript */
    var oldTranscript = await TranscriptRequest.findOne({
      _id: req.params.id, schoolId: req.schoolId, status: 'issued'
    });
    if (!oldTranscript) {
      return res.status(404).json({
        success: false,
        message: 'Issued transcript not found.'
      });
    }

    /* Create new request with incremented version */
    var newScope = req.body.scope || oldTranscript.scope;
    var newTranscript = await TranscriptRequest.create({
      schoolId:        req.schoolId,
      studentId:       oldTranscript.studentId,
      portfolioId:     oldTranscript.portfolioId,
      scope:           newScope,
      status:          'requested',
      version:         oldTranscript.version + 1,
      supersedes:      oldTranscript._id,
      requestedBy:     req.schoolUser._id,
      requestedByName: req.schoolUser.name || '',
      requestedByRole: req.schoolUser.role || '',
      requestSource:   'admin',
      notes:           req.body.reason.trim(),
      auditLog: [{
        action:    'transcript_supersede_requested',
        actor:     req.schoolUser._id,
        actorName: req.schoolUser.name || '',
        actorRole: req.schoolUser.role || '',
        timestamp: new Date(),
        metadata:  new Map([['supersedes', req.params.id], ['reason', req.body.reason.trim()]])
      }]
    });

    /* Mark old as superseded */
    await transcriptService.revokeTranscript(
      req.params.id, req.schoolId,
      req.schoolUser, req.body.reason, 'superseded'
    );
    await TranscriptRequest.findByIdAndUpdate(oldTranscript._id, {
      $set: { supersededBy: newTranscript._id }
    });

    /* Auto-generate the new version */
    var result = await transcriptService.generateAndIssue(
      newTranscript._id.toString(), req.schoolId, req.schoolUser
    );

    return res.json({
      success:         true,
      message:         'Transcript superseded. New version ' + newTranscript.version + ' issued.',
      oldVersion:      oldTranscript.version,
      newVersion:      result.transcript.version,
      newTranscriptId: newTranscript._id,
      verificationId:  result.transcript.verificationId,
      verificationUrl: result.verificationUrl
    });
  } catch(err) {
    console.error('[inst.transcript] POST /:id/supersede:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;