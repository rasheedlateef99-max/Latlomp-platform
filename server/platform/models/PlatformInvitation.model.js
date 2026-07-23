/* ============================================
   LATLOMP PLATFORM — PLATFORM INVITATION MODEL

   Manages the complete invitation lifecycle for
   Platform Staff accounts.

   LIFECYCLE:
     pending   → Created, link not yet accepted
     accepted  → Staff member joined successfully
     expired   → Token TTL elapsed before acceptance
     revoked   → Manually cancelled by root/admin

   TOKEN:
     32 random bytes = 64 hex characters.
     Stored once in pre-validate hook.
     Cannot be regenerated on the same record.
     Each new invitation creates a fresh record.
============================================ */
'use strict';

const mongoose = require('mongoose');
const crypto   = require('crypto');

var VALID_ROLES = [
  'platform_admin',
  'support_admin',
  'finance_admin',
  'content_admin',
  'developer'
];

var ROLE_LABELS = {
  'platform_admin': 'Platform Administrator',
  'support_admin':  'Support Administrator',
  'finance_admin':  'Finance Administrator',
  'content_admin':  'Content Administrator',
  'developer':      'Developer'
};

const platformInvitationSchema = new mongoose.Schema(
  {
    /* ---- Recipient ---- */
    email: { type: String, required: true, lowercase: true, trim: true },
    name:  { type: String, default: '' },

    /* ---- Role being granted ---- */
    platformRole: {
      type:     String,
      enum:     VALID_ROLES,
      required: true
    },

    /* ---- Secure token (set by pre-validate) ---- */
    token: {
      type:   String,
      unique: true
    },

    /* ---- Lifecycle ---- */
    status: {
      type:    String,
      enum:    ['pending', 'accepted', 'expired', 'revoked'],
      default: 'pending'
    },

    /* ---- Audit ---- */
    invitedBy: { type: String, default: 'root' }, /* 'root' or PlatformStaff._id.toString() */
    expiresAt: { type: Date }, /* Set by pre-validate: now + 7 days */

    acceptedAt: { type: Date,   default: null },
    acceptedBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'PlatformStaff',
      default: null
    },

    /* ---- Revocation ---- */
    revokedBy:  { type: String, default: null },
    revokedAt:  { type: Date,   default: null }
  },
  { timestamps: true }
);

/* ---- Auto-set token + expiry ---- */
platformInvitationSchema.pre('validate', function (next) {
  if (!this.token) {
    this.token = crypto.randomBytes(32).toString('hex');
  }
  if (!this.expiresAt) {
    /* Default: 7 days from creation */
    this.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }
  next();
});

/* ---- Indexes ---- */
platformInvitationSchema.index({ token:    1 });
platformInvitationSchema.index({ email:    1 });
platformInvitationSchema.index({ status:   1 });
platformInvitationSchema.index({ expiresAt:1 });

/* ---- Static helpers ---- */
platformInvitationSchema.statics.getRoleLabel = function (role) {
  return ROLE_LABELS[role] || role;
};

module.exports = mongoose.model('PlatformInvitation', platformInvitationSchema);