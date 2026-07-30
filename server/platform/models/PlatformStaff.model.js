/* ============================================
   LATLOMP PLATFORM — PLATFORM STAFF MODEL

   ✅ POLISH UPDATE: Dynamic permission system.
   Permissions are now stored per staff member
   in the database rather than being hardcoded
   by role in middleware.

   Root Admin can grant or revoke individual
   module permissions at any time without
   changing any code.

   PERMISSION FIELDS:
     permissions: [String] — array of module keys
     e.g. ['institutions', 'subscriptions', 'analytics']

   When staff accepts an invitation, they receive
   the default permissions for their role.
   Root Admin can then customize as needed.
============================================ */
'use strict';

const mongoose = require('mongoose');

/* ============================================
   PERMISSION REGISTRY — imported from single
   source of truth. To add a new module, edit
   server/platform/config/permissions.registry.js
   only. This file never needs to change.
============================================ */
var registry             = require('../config/permissions.registry');
var PLATFORM_MODULES     = registry.PERMISSION_REGISTRY;
var ROLE_DEFAULT_PERMISSIONS = registry.ROLE_DEFAULT_PERMISSIONS;

var PLATFORM_ROLES = [
  'platform_admin',
  'support_admin',
  'finance_admin',
  'content_admin',
  'developer'
];

const loginEntrySchema = new mongoose.Schema({
  ip:        { type: String, default: '' },
  userAgent: { type: String, default: '' },
  at:        { type: Date,   default: Date.now }
}, { _id: false });

const platformStaffSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true },
    email:    { type: String, required: true, lowercase: true, trim: true, unique: true },
    avatar:   { type: String, default: '' },
    googleId: { type: String, default: '' },

    platformRole: {
      type:     String,
      enum:     PLATFORM_ROLES,
      required: true
    },

    /* ✅ DYNAMIC PERMISSIONS — stored per staff member.
       Root Admin manages these through the admin panel.
       Populated with role defaults on invitation acceptance. */
    permissions: {
      type:    [String],
      default: []
    },

    status: {
      type:    String,
      enum:    ['active', 'suspended'],
      default: 'active'
    },
    isActive: { type: Boolean, default: true },

    suspendedBy:      { type: String, default: null },
    suspendedAt:      { type: Date,   default: null },
    suspensionReason: { type: String, default: '' },

    invitedBy: { type: String, default: 'root' },
    invitedAt: { type: Date,   default: null },
    joinedAt:  { type: Date,   default: null },

    lastLoginAt:  { type: Date,              default: null },
    loginHistory: { type: [loginEntrySchema], default: [] }
  },
  { timestamps: true }
);

platformStaffSchema.index({ email:        1 }, { unique: true });
platformStaffSchema.index({ platformRole: 1 });
platformStaffSchema.index({ status:       1 });

/* ---- Static helpers ---- */
platformStaffSchema.statics.ROLES   = PLATFORM_ROLES;
platformStaffSchema.statics.MODULES = PLATFORM_MODULES;

/* Get default permissions for a role (delegates to registry) */
platformStaffSchema.statics.getDefaultPermissions = function (role) {
  return registry.getDefaultPermissions(role);
};

module.exports = mongoose.model('PlatformStaff', platformStaffSchema);