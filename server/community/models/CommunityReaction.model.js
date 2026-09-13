'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP COMMUNITY — REACTION (E9C)

   Supports reactions on both posts and comments.
   targetType field distinguishes the target.

   DUPLICATE PREVENTION:
   Unique index on { schoolId, targetId, targetType, authorId }
   enforces one reaction per member per target.
   Upsert pattern: changing reaction type updates
   the existing record rather than creating a duplicate.

   schoolId ALWAYS from authenticated token.
   authorId ALWAYS from communityProtect.
   targetId verified to belong to same school before storing.
============================================ */
const communityReactionSchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true
  },

  targetType: {
    type:     String,
    enum:     ['post', 'comment'],
    required: true
  },
  targetId: {
    type:     mongoose.Schema.Types.ObjectId,
    required: true
  },

  /* ---- Author (from CommunityMembership) ---- */
  authorId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'CommunityMembership',
    required: true
  },
  authorType: { type: String, required: true }, /* denormalised */
  authorName: { type: String, default: '' },    /* denormalised */

  /* ---- Reaction type ---- */
  reaction: {
    type:    String,
    enum:    ['like', 'love', 'celebrate', 'support', 'insightful'],
    default: 'like'
  }

}, { timestamps: true });

/* ---- Unique index: one reaction per member per target ---- */
communityReactionSchema.index(
  { schoolId: 1, targetId: 1, targetType: 1, authorId: 1 },
  { unique: true }
);
/* Count reactions on a target */
communityReactionSchema.index({ schoolId: 1, targetId: 1, targetType: 1 });
/* Member's own reactions */
communityReactionSchema.index({ schoolId: 1, authorId: 1 });

module.exports = mongoose.model('CommunityReaction', communityReactionSchema);