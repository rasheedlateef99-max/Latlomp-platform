'use strict';
const mongoose = require('mongoose');
const crypto   = require('crypto');

/* ============================================
   LATLOMP INSTITUTION — RESULT ACCESS TOKEN (E1B)

   Secure, scoped access credential for
   student/alumni result retrieval portal.

   Token design:
   - 12 uppercase alphanumeric chars (e.g. ABCD1234EFGH)
   - Formatted as XXXX-XXXX-XXXX for display
   - lookupKey: first 6 chars (non-secret, for DB lookup)
   - tokenHash: SHA-256 of full 12 chars (secure comparison)
   - timingSafeEqual prevents timing attacks on comparison

   Works for:
   - Current students (studentId populated)
   - Former/graduated students (studentId may still be populated)
   - admissionNo snapshot preserved for audit
============================================ */
const resultAccessTokenSchema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },

  /* Student identification */
  studentId:           { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolStudent', default: null },
  admissionNo:         { type: String, default: '',  trim: true },
  studentNameSnapshot: { type: String, default: '' },

  /* Access scope */
  scope: {
    termId:  { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicTerm', default: null },
    session: { type: String, default: '' }
  },

  /* Token security (never store raw token) */
  lookupKey: { type: String, required: true }, /* first 6 chars — non-secret, for indexed lookup */
  tokenHash: { type: String, required: true }, /* SHA-256 of full 12-char token */

  /* Lifecycle */
  expiresAt:  { type: Date,   required: true },
  usageCount: { type: Number, default: 0 },
  maxUsage:   { type: Number, default: 5 },
  lastUsedAt: { type: Date,   default: null },

  /* Issuance */
  issuedMethod: {
    type:    String,
    enum:    ['payment', 'staff_issued', 'free_self_service'],
    default: 'staff_issued'
  },
  issuedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  paymentRef: { type: String, default: '' },

  status: {
    type:    String,
    enum:    ['active', 'exhausted', 'expired', 'revoked'],
    default: 'active'
  },
  revokedReason: { type: String, default: '' }
}, { timestamps: true });

resultAccessTokenSchema.index({ schoolId: 1 });
resultAccessTokenSchema.index({ lookupKey: 1 });
resultAccessTokenSchema.index({ studentId: 1 });
resultAccessTokenSchema.index({ schoolId: 1, status: 1 });
resultAccessTokenSchema.index({ expiresAt: 1 });

/* ---- Generate a secure access token ---- */
resultAccessTokenSchema.statics.generateToken = function () {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  var token = '';
  var bytes = crypto.randomBytes(12);
  for (var i = 0; i < 12; i++) {
    token += chars[bytes[i] % chars.length];
  }
  return {
    plain:     token,
    formatted: token.slice(0, 4) + '-' + token.slice(4, 8) + '-' + token.slice(8, 12),
    lookupKey: token.slice(0, 6),
    hash:      crypto.createHash('sha256').update(token).digest('hex')
  };
};

/* ---- Verify a provided token against stored hash ---- */
resultAccessTokenSchema.statics.verifyToken = function (providedToken, storedHash) {
  var normalized = (providedToken || '').replace(/-/g, '').toUpperCase().trim();
  if (!normalized || normalized.length !== 12) { return false; }
  var hash = crypto.createHash('sha256').update(normalized).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch (e) { return false; }
};

module.exports = mongoose.model('ResultAccessToken', resultAccessTokenSchema);