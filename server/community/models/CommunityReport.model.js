'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP COMMUNITY — REPORT (E9G)

   Member reports on posts or comments.
   One report per member per target — unique index enforces this.

   contentPreview stored at report time so that even if
   the content is later removed, mods can see what was reported.

   schoolId ALWAYS from authenticated token.
   reportedById ALWAYS from communityProtect.
   Target verified same school before storing.
============================================ */
const communityReportSchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true
  },

  /* ---- Target ---- */
  targetType: {
    type:     String,
    enum:     ['post', 'comment'],
    required: true
  },
  targetId: {
    type:     mongoose.Schema.Types.ObjectId,
    required: true
  },

  /* ---- Who reported ---- */
  reportedById: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'CommunityMembership',
    required: true
  },
  reportedByName: { type: String, default: '' },  /* denormalised */
  reportedByType: { type: String, default: '' },  /* denormalised */

  /* ---- Report details ---- */
  reason: {
    type:    String,
    enum:    ['spam', 'inappropriate', 'harassment', 'misinformation', 'violence', 'other'],
    default: 'other'
  },
  details:        { type: String, default: '', trim: true }, /* optional member text */

  /* ---- Content snapshot — stored at report time ---- */
  contentPreview: { type: String, default: '' }, /* first 120 chars */

  /* ---- Resolution ---- */
  status: {
    type:    String,
    enum:    ['pending', 'dismissed', 'actioned'],
    default: 'pending'
  },
  reviewedById:   { type: mongoose.Schema.Types.ObjectId, default: null },
  reviewedByName: { type: String, default: '' },
  reviewedAt:     { type: Date,   default: null },
  reviewNote:     { type: String, default: '' }

}, { timestamps: true, versionKey: false });

/* ---- Indexes ---- */
/* One report per member per target */
communityReportSchema.index(
  { schoolId: 1, targetId: 1, targetType: 1, reportedById: 1 },
  { unique: true }
);
/* Reports queue: pending first, newest first */
communityReportSchema.index({ schoolId: 1, status: 1, createdAt: -1 });
/* Count total reports on a piece of content */
communityReportSchema.index({ schoolId: 1, targetId: 1, targetType: 1 });
/* Member's own reports */
communityReportSchema.index({ schoolId: 1, reportedById: 1, createdAt: -1 });

module.exports = mongoose.model('CommunityReport', communityReportSchema);