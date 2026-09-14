'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP COMMUNITY — MODERATION LOG (E9G)

   Audit trail for all content moderation actions.
   Separate from CommunityMembershipLog (which tracks
   membership/role events).

   Records are append-only — never modified.
   contentPreview stored so log remains readable
   even after content is deleted.
   schoolId ALWAYS from authenticated context.
============================================ */
const communityModerationLogSchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true
  },

  /* What happened to what */
  action: {
    type:     String,
    enum:     [
      'post_approved',
      'post_rejected',
      'post_removed',
      'post_restored',
      'post_pinned',
      'post_unpinned',
      'post_locked',
      'post_unlocked',
      'comment_removed',
      'comment_restored',
      'report_dismissed',
      'report_actioned'
    ],
    required: true
  },
  targetType:       { type: String, enum: ['post', 'comment'], required: true },
  targetId:         { type: mongoose.Schema.Types.ObjectId, required: true },

  /* Author of the affected content */
  targetAuthorId:   { type: mongoose.Schema.Types.ObjectId, default: null },
  targetAuthorName: { type: String, default: '' },

  /* First 120 chars of content at action time */
  contentPreview:   { type: String, default: '' },

  /* Why */
  reason:           { type: String, default: '' },

  /* Who acted */
  performedById:    { type: mongoose.Schema.Types.ObjectId, required: true },
  performedByName:  { type: String, default: '' },
  performedByType:  { type: String, default: '' },

  /* If action was triggered from a report */
  relatedReportId:  { type: mongoose.Schema.Types.ObjectId, default: null }

}, {
  timestamps: true,
  versionKey: false
});

/* ---- Indexes ---- */
communityModerationLogSchema.index({ schoolId: 1, createdAt: -1 });
communityModerationLogSchema.index({ schoolId: 1, action: 1, createdAt: -1 });
communityModerationLogSchema.index({ schoolId: 1, targetId: 1, createdAt: -1 });
communityModerationLogSchema.index({ schoolId: 1, performedById: 1, createdAt: -1 });

module.exports = mongoose.model('CommunityModerationLog', communityModerationLogSchema);