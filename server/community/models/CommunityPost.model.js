'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP COMMUNITY — POST (E9B)

   Community-generated content. NOT a duplicate of:
     SchoolAnnouncement — internal institutional notices
     SchoolWebsitePost  — public website articles

   authorId  → CommunityMembership (community identity)
   authorRef → original identity (SchoolUser/SchoolStudent etc.)
   refId     → authoritative record (SchoolEvent etc.) — NEVER duplicated

   Content is plain text only.
   Raw HTML from members is NEVER stored or rendered.

   Soft deletion only — records kept for audit/moderation.
   schoolId is ALWAYS from authenticated token.
============================================ */
const communityPostSchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true
  },

  /* ---- Author (from CommunityMembership — not a duplicate identity) ---- */
  authorId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'CommunityMembership',
    required: true
  },
  authorType:   { type: String, required: true }, /* student|parent|alumni|staff|admin */
  authorRef:    { type: mongoose.Schema.Types.ObjectId, required: true }, /* FK to actual identity */
  authorName:   { type: String, default: '', trim: true }, /* denormalised */
  authorAvatar: { type: String, default: '' },             /* denormalised */

  /* ---- Content — plain text only ---- */
  content: {
    type:     String,
    required: true,
    trim:     true
    /* Max length enforced at route — not in schema so it can be configurable */
  },

  /* ---- Post type ---- */
  postType: {
    type:    String,
    enum:    ['post', 'announcement', 'event_ref', 'achievement', 'competition', 'award', 'reunion'],
    default: 'post'
  },

  /* ---- Authoritative reference (event_ref etc.) ---- */
  refType: {
    type:    String,
    enum:    ['event', null],
    default: null
  },
  refId: {
    type:    mongoose.Schema.Types.ObjectId,
    default: null
    /* Points to SchoolEvent or other authoritative records — never duplicated */
  },

  /* ---- Visibility — enforced server-side ---- */
  visibility: {
    type:    String,
    enum:    ['all', 'students', 'parents', 'staff', 'alumni'],
    default: 'all'
  },

  /* ---- Moderation status ---- */
  status: {
    type:    String,
    enum:    ['pending', 'published', 'removed', 'archived'],
    default: 'published'
  },
  /* moderationNote: internal only — NEVER returned to original poster */
  moderationNote: { type: String, default: '' },

  /* ---- Pinned state ---- */
  isPinned: { type: Boolean, default: false },
  pinnedAt: { type: Date,    default: null  },
  pinnedBy: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'CommunityMembership',
    default: null
  },

  /* ---- Locked state (comments blocked when true) ---- */
  isLocked: { type: Boolean, default: false },
  lockedAt: { type: Date,    default: null  },
  lockedBy: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'CommunityMembership',
    default: null
  },

  /* ---- Approval ---- */
  requiresApproval: { type: Boolean, default: false },
  approvedAt:       { type: Date,    default: null  },
  approvedBy:       {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'CommunityMembership',
    default: null
  },

  /* ---- Media attachments (E9D — refs only, no binary in MongoDB) ---- */
  mediaIds:  { type: [mongoose.Schema.Types.ObjectId], default: [] },
  mediaUrls: { type: [String],                         default: [] }, /* denormalised */

  /* ---- Denormalised counters ---- */
  commentCount:  { type: Number, default: 0 },
  reactionCount: { type: Number, default: 0 },

  /* ---- Soft deletion ---- */
  deletedAt:     { type: Date,    default: null },
  deletedBy:     { type: mongoose.Schema.Types.ObjectId, default: null },
  deletedReason: { type: String,  default: '' }

}, { timestamps: true });

/* ---- Indexes (justified by actual feed query patterns) ---- */
communityPostSchema.index({ schoolId: 1, status: 1, isPinned: 1, createdAt: -1 });
communityPostSchema.index({ schoolId: 1, status: 1, visibility: 1, isPinned: 1, createdAt: -1 });
communityPostSchema.index({ schoolId: 1, authorId: 1, status: 1, createdAt: -1 });
communityPostSchema.index({ schoolId: 1, postType: 1, status: 1 });
communityPostSchema.index({ schoolId: 1, refType: 1, refId: 1 });
communityPostSchema.index({ schoolId: 1, status: 1, createdAt: 1 }); /* approval queue — oldest first */

module.exports = mongoose.model('CommunityPost', communityPostSchema);