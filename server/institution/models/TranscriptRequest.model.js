'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — TRANSCRIPT REQUEST (E5)

   Owns: transcript lifecycle, canonical snapshot,
   cryptographic signature, verification identity,
   versioning, audit trail, revocation.

   Does NOT own: scores, grades, attendance,
   class history, student identity, promotion data.
   Those remain in their authoritative models.

   verificationId:
     Public, non-guessable, URL-safe (base64url).
     Safe to expose. Does NOT expose MongoDB _id.

   canonicalSnapshot:
     Compact deterministic JSON of the academic
     facts at time of issuance. Enables alumni/
     long-term verification without live data.
     This is E5-owned data (transcript domain),
     not duplication of academic source facts.
     Stored as String to preserve byte-exact
     representation for hash/signature verification.

   signature:
     ECDSA-P256-SHA256 over canonicalHash.
     null if signing keys not configured.

   Versioning:
     supersedes → previous TranscriptRequest _id
     supersededBy → newer TranscriptRequest _id
     Both null for first version.
     Old status set to 'superseded', never deleted.
============================================ */
var auditEventSchema = new mongoose.Schema({
  action:    { type: String, required: true },
  actor:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  actorName: { type: String, default: '' },
  actorRole: { type: String, default: '' },
  timestamp: { type: Date, default: Date.now },
  metadata:  { type: Map, of: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

var transcriptRequestSchema = new mongoose.Schema({
  /* ---- Tenant + identity ---- */
  schoolId:    { type: mongoose.Schema.Types.ObjectId, ref: 'School',           required: true },
  studentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolStudent',    required: true },
  portfolioId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicPortfolio', default: null },

  /* ---- Scope ---- */
  scope: {
    type:     { type: String, enum: ['full', 'session'], default: 'full' },
    sessions: [String] /* populated for type='session'; empty = all */
  },

  /* ---- Lifecycle ---- */
  status: {
    type:    String,
    enum:    ['requested', 'generating', 'issued', 'superseded', 'revoked', 'invalidated', 'failed'],
    default: 'requested'
  },
  version: { type: Number, default: 1 },

  /* ---- Versioning chain ---- */
  supersedes:   { type: mongoose.Schema.Types.ObjectId, ref: 'TranscriptRequest', default: null },
  supersededBy: { type: mongoose.Schema.Types.ObjectId, ref: 'TranscriptRequest', default: null },

  /* ---- Canonical data (E5-owned domain, compact) ---- */
  /* Stored as String for byte-exact hash/signature reproducibility */
  canonicalSnapshot: { type: String, default: '' },
  canonicalHash:     { type: String, default: '' }, /* SHA-256 hex of canonicalSnapshot */

  /* ---- Document (reuses E3 storage abstraction) ---- */
  documentHash: { type: String, default: '' }, /* SHA-256 hex of PDF */
  storage: {
    provider: { type: String, default: 'cloudinary' },
    key:      { type: String, default: '' },
    url:      { type: String, default: '' }
  },

  /* ---- Cryptographic signature ---- */
  signature:     { type: String, default: null }, /* ECDSA base64 DER, or null */
  signingKeyId:  { type: String, default: null }, /* key version reference */
  algorithm:     { type: String, default: null }, /* e.g. 'ECDSA-P256-SHA256' */

  /* ---- Verification identity ---- */
  verificationId: {
    type:    String,
    unique:  true,
    sparse:  true, /* null until issued */
    default: null
  },

  /* ---- Request metadata ---- */
  requestedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  requestedByName: { type: String, default: '' },
  requestedByRole: { type: String, default: '' },
  requestSource:   {
    type:    String,
    enum:    ['student_self', 'staff', 'admin', 'system'],
    default: 'staff'
  },

  /* ---- Issuance ---- */
  generatedAt:     { type: Date, default: null },
  generatedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  generatedByName: { type: String, default: '' },
  issuedAt:        { type: Date, default: null },

  /* ---- Revocation ---- */
  revokedAt:       { type: Date, default: null },
  revokedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  revokedByName:   { type: String, default: '' },
  revocationReason:{ type: String, default: '' },

  /* ---- Notes ---- */
  notes: { type: String, default: '' },

  /* ---- Append-only audit log ---- */
  auditLog: { type: [auditEventSchema], default: [] },

  /* ---- E6 extension point ---- */
  /* alumniAccessEnabled: allows alumni to share this transcript */
  alumniAccessEnabled: { type: Boolean, default: false },

  /* ---- Failure info ---- */
  failureReason: { type: String, default: '' }
}, { timestamps: true });

/* Indexes */
transcriptRequestSchema.index({ schoolId: 1, studentId: 1 });
transcriptRequestSchema.index({ schoolId: 1, status: 1 });
transcriptRequestSchema.index({ verificationId: 1 }, { unique: true, sparse: true });
transcriptRequestSchema.index({ studentId: 1, status: 1 });
transcriptRequestSchema.index({ schoolId: 1, studentId: 1, version: -1 });

module.exports = mongoose.model('TranscriptRequest', transcriptRequestSchema);