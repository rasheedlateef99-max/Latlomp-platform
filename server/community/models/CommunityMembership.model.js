'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP COMMUNITY — MEMBERSHIP (E9A)

   NOT a duplicate identity model.
   Links an existing LatLomp identity to their
   participation in one school's community.

   memberType + memberRef point to the authoritative
   identity record in the existing platform:
     'student'  → SchoolStudent._id
     'parent'   → SchoolParent._id
     'alumni'   → AlumniProfile._id
     'staff'    → SchoolUser._id (teacher/support)
     'admin'    → SchoolUser._id (admin role)

   schoolId is ALWAYS from authenticated token.
   NEVER from request body.

   One membership record per person per school.
   Unique index enforces this.
============================================ */
const communityMembershipSchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true
  },

  /* ---- Identity link (not a duplicate) ---- */
  memberType: {
    type:     String,
    enum:     ['student', 'parent', 'alumni', 'staff', 'admin'],
    required: true
  },
  memberRef: {
    type:     mongoose.Schema.Types.ObjectId,
    required: true
    /* ref is dynamic: SchoolStudent/SchoolParent/AlumniProfile/SchoolUser */
  },

  /* ---- Denormalised display info (for feed performance) ---- */
  memberName:   { type: String, default: '', trim: true },
  memberAvatar: { type: String, default: '' },

  /* ---- Community role ---- */
  role: {
    type:    String,
    enum:    ['member', 'moderator', 'admin'],
    default: 'member'
  },

  /* ---- Membership status ---- */
  status: {
    type:    String,
    enum:    ['active', 'suspended', 'banned', 'left'],
    default: 'active'
  },

  /* ---- Suspension details ---- */
  suspendedUntil:  { type: Date,   default: null },
  suspendedReason: { type: String, default: '' },
  suspendedBy:     {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolUser',
    default: null
  },
  suspendedAt:     { type: Date,   default: null },

  /* ---- Ban details ---- */
  bannedReason: { type: String, default: '' },
  bannedBy:     {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolUser',
    default: null
  },
  bannedAt: { type: Date, default: null },

  /* ---- Activity ---- */
  joinedAt:     { type: Date, default: Date.now },
  lastActiveAt: { type: Date, default: null },

  /* ---- Audit ---- */
  updatedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  updatedByName: { type: String, default: '' }

}, { timestamps: true });

/* ---- Indexes ---- */
/* One membership per person per school */
communityMembershipSchema.index(
  { schoolId: 1, memberRef: 1, memberType: 1 },
  { unique: true }
);
communityMembershipSchema.index({ schoolId: 1, status: 1, role: 1 });
communityMembershipSchema.index({ schoolId: 1, memberType: 1, status: 1 });
communityMembershipSchema.index({ schoolId: 1, createdAt: -1 });

module.exports = mongoose.model('CommunityMembership', communityMembershipSchema);