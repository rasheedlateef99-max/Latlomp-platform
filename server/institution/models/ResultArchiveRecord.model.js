'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — RESULT ARCHIVE RECORD (E3)

   Lightweight metadata record for generated
   academic documents.

   DOES NOT store: scores, grades, attendance,
   student profile, or any authoritative data.
   Those remain in their original models.

   Points to:
   - Authoritative sources via termId, studentId
   - Generated document via storage sub-document
   - E2 portfolio via portfolioId
   - E5 transcript via verificationId (extension)

   Versioning:
   When regenerated, old record → 'superseded'
   New record created with documentVersion + 1.
   History never destroyed.
============================================ */
const storageSchema = new mongoose.Schema({
  provider:  { type: String, default: 'cloudinary' }, /* 'cloudinary' | 'local' */
  key:       { type: String, default: '' },           /* Cloudinary public_id or relative path */
  url:       { type: String, default: '' }            /* Secure URL for download */
}, { _id: false });

const resultArchiveRecordSchema = new mongoose.Schema({
  /* ---- Tenant isolation ---- */
  schoolId:   { type: mongoose.Schema.Types.ObjectId, ref: 'School',      required: true },
  studentId:  { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolStudent', required: true },
  portfolioId:{ type: mongoose.Schema.Types.ObjectId, ref: 'AcademicPortfolio', default: null },

  /* ---- Academic context ---- */
  termId:       { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicTerm', required: true },
  classId:      { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolClass',  default: null },
  academicYear: { type: String, default: '' },

  /* ---- Context snapshots (for display without extra queries) ---- */
  termSnapshot:  {
    name:    { type: String, default: '' },
    session: { type: String, default: '' },
    term:    { type: String, default: '' }
  },
  classSnapshot: {
    name:     { type: String, default: '' },
    category: { type: String, default: '' }
  },

  /* ---- Document identity ---- */
  documentType: {
    type:    String,
    enum:    ['report_card', 'result_sheet', 'transcript'], /* transcript added by E5 */
    default: 'report_card'
  },
  documentVersion: { type: Number, default: 1 },

  /* ---- Document integrity (E5 extension point) ---- */
  documentHash: { type: String, default: '' }, /* SHA-256 of PDF buffer */

  /* ---- Storage (provider-abstracted) ---- */
  storage: { type: storageSchema, default: () => ({}) },

  /* ---- Lifecycle ---- */
  status: {
    type:    String,
    enum:    ['generated', 'issued', 'superseded', 'revoked'],
    default: 'generated'
  },

  /* ---- Audit ---- */
  generatedAt:     { type: Date, default: Date.now },
  generatedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  generatedByName: { type: String, default: '' },
  issuedAt:        { type: Date, default: null },
  issuedBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  revokedAt:       { type: Date, default: null },
  revokedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  revokedReason:   { type: String, default: '' },

  /* ---- E5 extension: controlled verification ---- */
  verificationId: { type: String, default: null }, /* populated by E5 */

  /* ---- Flexible metadata ---- */
  metadata: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

resultArchiveRecordSchema.index({ schoolId: 1, studentId: 1, termId: 1, documentType: 1 });
resultArchiveRecordSchema.index({ schoolId: 1, studentId: 1, status: 1 });
resultArchiveRecordSchema.index({ schoolId: 1, termId: 1 });
resultArchiveRecordSchema.index({ studentId: 1 });
resultArchiveRecordSchema.index({ schoolId: 1, documentType: 1, status: 1 });

module.exports = mongoose.model('ResultArchiveRecord', resultArchiveRecordSchema);