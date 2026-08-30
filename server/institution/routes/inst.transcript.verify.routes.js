'use strict';
/* ============================================
   LATLOMP INSTITUTION — PUBLIC VERIFICATION (E5)

   Rate-limited. No authentication required.
   Returns MINIMUM information to establish
   authenticity. Never exposes private data.

   VERIFY ≠ DOWNLOAD ≠ STUDENT PORTAL ACCESS.
============================================ */
const express          = require('express');
const router           = express.Router();
const transcriptService= require('../services/transcript.service');

/* ---- Rate limiting ---- */
var verifyLimit;
try {
  var rl = require('express-rate-limit');
  verifyLimit = rl({
    windowMs:        15 * 60 * 1000, /* 15 minutes */
    max:             60,             /* 60 verifications per IP per 15min */
    standardHeaders: true,
    legacyHeaders:   false,
    message:         { success: false, message: 'Too many verification attempts. Please try again later.' }
  });
} catch(e) {
  verifyLimit = function(req, res, next) { next(); };
}

/* ============================================
   GET /api/verify/transcript/:verificationId
   Public transcript verification.
   Returns: status, issuer, minimum student info,
            integrity/signature results.
   NEVER returns: full academic data, discipline,
   payment info, private staff notes.
============================================ */
router.get('/transcript/:verificationId', verifyLimit, async function(req, res) {
  try {
    var vid = (req.params.verificationId || '').trim();

    /* Basic format check — base64url ~24 chars */
    if (!vid || vid.length < 12 || vid.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(vid)) {
      /* Anti-enumeration: same response as not found */
      return res.status(404).json({
        success:  false,
        verified: false,
        status:   'NOT_FOUND',
        message:  'Verification reference not found or invalid.'
      });
    }

    var result = await transcriptService.verifyTranscript(vid);

    /* Audit log the verification */
    try {
      var TranscriptRequest = require('../models/TranscriptRequest.model');
      await TranscriptRequest.findOneAndUpdate(
        { verificationId: vid },
        { $push: { auditLog: {
          action:    'transcript_verified',
          timestamp: new Date(),
          metadata:  new Map([
            ['ip',       req.ip || ''],
            ['status',   result.status || 'UNKNOWN']
          ])
        }}}
      );
    } catch(auditErr) { /* non-fatal */ }

    var httpStatus = result.status === 'NOT_FOUND' ? 404
                   : result.status === 'NOT_ISSUED' ? 404
                   : 200;

    return res.status(httpStatus).json({
      success: httpStatus === 200,
      ...result
    });
  } catch(err) {
    console.error('[verify] GET /transcript/:id:', err.message);
    return res.status(500).json({
      success:  false,
      verified: false,
      status:   'SERVER_ERROR',
      message:  'Verification service temporarily unavailable.'
    });
  }
});

module.exports = router;