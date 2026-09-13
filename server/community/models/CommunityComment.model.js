'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP COMMUNITY — COMMENT (E9C)

   Handles both top-level comments and replies.
   parentId === null  → top-level comment on a post
   parentId set       → reply to another comment

   One model for both — no separate Reply model.
   Depth limited to 1 level of nesting at route
   layer (replies to replies are flattened to
   the same top-level comment thread).

   Soft deletion only — records kept for audit.
   schoolId ALWAYS from authenticated token.
   authorId ALWAYS from communityProtect.

   postId is indexed separately so comment threads
   can be loaded without scanning all comments.
============================================ */
const communityCommentSchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true
  },
  postId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'CommunityPost',
    required: true
  },

  /* null = top-level comment; ObjectId = reply to a comment */
  parentId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'CommunityComment',
    default: null
  },

  /* ---- Author (from CommunityMembership) ---- */
  authorId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'CommunityMembership',
    required: true
  },
  authorType:   { type: String, required: true },
  authorRef:    { type: mongoose.Schema.Types.ObjectId, required: true },
  authorName:   { type: String, default: '', trim: true }, /* denormalised */
  authorAvatar: { type: String, default: '' },             /* denormalised */

  /* ---- Content — plain text only ---- */
  content: {
    type:     String,
    required: true,
    trim:     true
  },

  /* ---- Moderation ---- */
  status: {
    type:    String,
    enum:    ['published', 'removed', 'archived'],
    default: 'published'
  },
  moderationNote: { type: String, default: '' }, /* internal only */

  /* ---- Denormalised counters ---- */
  reactionCount: { type: Number, default: 0 },
  replyCount:    { type: Number, default: 0 }, /* top-level only — replies don't count sub-replies */

  /* ---- Soft deletion ---- */
  deletedAt:     { type: Date,    default: null },
  deletedBy:     { type: mongoose.Schema.Types.ObjectId, default: null },
  deletedReason: { type: String,  default: '' }

}, { timestamps: true });

/* ---- Indexes ---- */
/* Main thread load: all published comments on a post, oldest first */
communityCommentSchema.index({ schoolId: 1, postId: 1, parentId: 1, status: 1, createdAt: 1 });
/* Replies to a specific comment */
communityCommentSchema.index({ schoolId: 1, parentId: 1, status: 1, createdAt: 1 });
/* Member's own comments */
communityCommentSchema.index({ schoolId: 1, authorId: 1, createdAt: -1 });
/* Moderation queries */
communityCommentSchema.index({ schoolId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('CommunityComment', communityCommentSchema);