'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP COMMUNITY — MEMBERSHIP LOG (E9F)

   Audit trail for all community membership events.
   Records who did what to whom and when.
   Records are append-only — never modified.
   schoolId ALWAYS from authenticated context.

   Used by:
     E9F member detail modal (recent log)
     E9G moderation log (upcoming)
     Admin audit trail
============================================ */
const communityMembershipLogSchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true
  },

  /* The member this event is about */
  memberId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'CommunityMembership',
    required: true
  },
  memberRef:  { type: mongoose.Schema.Types.ObjectId, required: true },
  memberName: { type: String, default: '' },

  /* What happened */
  action: {
    type:     String,
    enum:     [
      'joined',             /* first time joined community */
      'role_changed',       /* role promoted or demoted */
      'suspended',          /* write access suspended */
      'unsuspended',        /* suspension lifted */
      'banned',             /* permanently banned */
      'left',               /* self-exited community */
      'moderator_added',    /* set as designated moderator */
      'moderator_removed'   /* removed as designated moderator */
    ],
    required: true
  },
  previousValue:  { type: String, default: null },  /* e.g. old role */
  newValue:       { type: String, default: null },  /* e.g. new role */
  reason:         { type: String, default: '' },    /* suspension/ban reason */

  /* Who performed the action (null = self / system) */
  performedById:   { type: mongoose.Schema.Types.ObjectId, default: null },
  performedByName: { type: String, default: '' },
  performedByType: { type: String, default: '' }

}, {
  timestamps: true,
  /* Prevent accidental modification — these are audit records */
  versionKey: false
});

/* ---- Indexes ---- */
/* Admin log view: all events for this school, newest first */
communityMembershipLogSchema.index({ schoolId: 1, createdAt: -1 });
/* Member detail view: events for one member */
communityMembershipLogSchema.index({ schoolId: 1, memberId: 1, createdAt: -1 });
/* Filter by action type */
communityMembershipLogSchema.index({ schoolId: 1, action: 1, createdAt: -1 });

module.exports = mongoose.model('CommunityMembershipLog', communityMembershipLogSchema);