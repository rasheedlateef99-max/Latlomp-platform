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
   PLATFORM MODULES — SINGLE SOURCE OF TRUTH
   These are all available platform modules.
   Used by admin UI (checkboxes) and middleware.
   Add new modules here when new features launch.
   Stored module keys must never be renamed once
   assigned to staff — rename breaks their access.
============================================ */
var PLATFORM_MODULES = [
  { key: 'store',         label: 'Store & Products',       icon: '🛒', desc: 'Manage store products and orders' },
  { key: 'institutions',  label: 'Institution Management', icon: '🏫', desc: 'View and manage registered schools' },
  { key: 'subscriptions', label: 'Subscription Management',icon: '💳', desc: 'Manage plans, renewals and payments' },
  { key: 'cbt',           label: 'CBT Management',          icon: '📝', desc: 'Manage CBT departments, subjects, questions' },
  { key: 'practice',      label: 'Practice Content',        icon: '⚡', desc: 'Manage practice questions and content' },
  { key: 'staff',         label: 'Platform Staff',          icon: '👥', desc: 'Invite and manage platform administration staff' },
  { key: 'analytics',     label: 'Analytics',               icon: '📊', desc: 'View platform-wide analytics and dashboards' },
  { key: 'reports',       label: 'Reports',                 icon: '📈', desc: 'View and export platform reports' },
  { key: 'announcements', label: 'Announcements',           icon: '📢', desc: 'Send announcements to all institutions' },
  { key: 'audit_logs',    label: 'Audit Logs',              icon: '🔍', desc: 'View system audit and activity logs' },
  { key: 'content',       label: 'Content Management',      icon: '📄', desc: 'Manage platform content and blog' }
];

/* ============================================
   ROLE DEFAULT PERMISSIONS
   Applied automatically when a staff member
   accepts their invitation. Root Admin can
   customize after account is created.
============================================ */
var ROLE_DEFAULT_PERMISSIONS = {
  platform_admin: [
    'institutions', 'subscriptions', 'cbt', 'staff',
    'analytics', 'reports', 'announcements', 'audit_logs', 'store'
  ],
  support_admin: [
    'institutions', 'analytics', 'announcements', 'audit_logs'
  ],
  finance_admin: [
    'institutions', 'subscriptions', 'reports', 'analytics'
  ],
  content_admin: [
    'announcements', 'content'
  ],
  developer: [
    'analytics', 'audit_logs', 'reports'
  ]
};

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

/* Get default permissions for a role */
platformStaffSchema.statics.getDefaultPermissions = function (role) {
  return (ROLE_DEFAULT_PERMISSIONS[role] || []).slice();
};

module.exports = mongoose.model('PlatformStaff', platformStaffSchema);