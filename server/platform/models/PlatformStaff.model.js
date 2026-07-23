/* ============================================
   LATLOMP PLATFORM — PLATFORM STAFF MODEL

   Separate from institution SchoolUser model.
   Separate from main platform User model.
   Represents trusted staff invited by the
   Root Super Admin to assist with platform ops.

   ROOT SUPER ADMIN is NOT stored in this model.
   Root is identified by process.env + isAdmin:true
   on the main User model. It is unreachable via
   this collection and cannot be manipulated here.

   TOKEN TYPE:
     { platformStaffId, platformRole }
     Accepted ONLY by platformStaffProtect.
     Cannot contaminate instProtect or adminOnly.
============================================ */
'use strict';

const mongoose = require('mongoose');

/* ============================================
   VALID PLATFORM ROLES
   'root' is intentionally excluded — root cannot
   be stored as a database record or assigned to
   any platform staff account.
============================================ */
var PLATFORM_ROLES = [
  'platform_admin',  /* Full platform access. Can invite/view staff. */
  'support_admin',   /* View schools, announcements, logs, analytics. */
  'finance_admin',   /* Subscriptions, payments, plans. */
  'content_admin',   /* Announcements and content only. */
  'developer'        /* Read-only audit + analytics access. */
];

/* Compact login history — keeps last 10 entries */
const loginEntrySchema = new mongoose.Schema({
  ip:        { type: String, default: '' },
  userAgent: { type: String, default: '' },
  at:        { type: Date,   default: Date.now }
}, { _id: false });

const platformStaffSchema = new mongoose.Schema(
  {
    /* ---- Identity ---- */
    name:     { type: String, required: true, trim: true },
    email:    { type: String, required: true, lowercase: true, trim: true, unique: true },
    avatar:   { type: String, default: '' },
    googleId: { type: String, default: '' },

    /* ---- Role ---- */
    platformRole: {
      type:     String,
      enum:     PLATFORM_ROLES,
      required: true
    },

    /* ---- Status ---- */
    status: {
      type:    String,
      enum:    ['active', 'suspended'],
      default: 'active'
    },
    isActive: { type: Boolean, default: true },

    /* ---- Suspension ---- */
    suspendedBy:      { type: String, default: null }, /* 'root' or PlatformStaff._id.toString() */
    suspendedAt:      { type: Date,   default: null },
    suspensionReason: { type: String, default: '' },

    /* ---- Invitation tracking ---- */
    invitedBy: { type: String, default: 'root' }, /* 'root' or PlatformStaff._id.toString() */
    invitedAt: { type: Date,   default: null },
    joinedAt:  { type: Date,   default: null },

    /* ---- Login tracking ---- */
    lastLoginAt:  { type: Date,            default: null },
    loginHistory: { type: [loginEntrySchema], default: [] }
  },
  { timestamps: true }
);

/* ---- Indexes ---- */
platformStaffSchema.index({ email:        1 }, { unique: true });
platformStaffSchema.index({ platformRole: 1 });
platformStaffSchema.index({ status:       1 });

/* ---- Static helpers ---- */
platformStaffSchema.statics.ROLES = PLATFORM_ROLES;

module.exports = mongoose.model('PlatformStaff', platformStaffSchema);