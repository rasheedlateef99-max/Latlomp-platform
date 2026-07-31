/* ============================================
   LATLOMP PLATFORM — PERMISSION REGISTRY
   Single source of truth for all platform
   staff permissions.

   HOW TO ADD A NEW MODULE:
   1. Add an entry to PERMISSION_REGISTRY below.
   2. Protect your route:
        const { adminOrPlatformStaff } = require('../../middleware/auth.middleware');
        router.get('/...', adminOrPlatformStaff('your_key'), handler)
   3. Add nav item + section to admin.html sidebar.
   4. Add entry to SECTION_PERM_MAP in public/js/admin.js.

   That is all. No other files need changing.
============================================ */
'use strict';

/* ---- All available permission modules ---- */
var PERMISSION_REGISTRY = [
  /* Core */
  {
    key:      'institutions',
    label:    'Institution Management',
    icon:     '🏫',
    desc:     'View and manage registered schools',
    category: 'core'
  },
  {
    key:      'subscriptions',
    label:    'Subscription Management',
    icon:     '💳',
    desc:     'Manage plans, renewals and payments',
    category: 'core'
  },
  {
    key:      'staff',
    label:    'Platform Staff',
    icon:     '👥',
    desc:     'Invite and view platform administration staff',
    category: 'core'
  },
  /* Content */
  {
    key:      'cbt',
    label:    'CBT Management',
    icon:     '📝',
    desc:     'Manage CBT departments, subjects and questions',
    category: 'content'
  },
  {
    key:      'practice',
    label:    'Practice Content',
    icon:     '⚡',
    desc:     'Manage practice questions and content',
    category: 'content'
  },
  {
    key:      'content',
    label:    'Content Management',
    icon:     '📄',
    desc:     'Manage platform content and blog',
    category: 'content'
  },
  /* Commerce */
  {
    key:      'store',
    label:    'Store & Products',
    icon:     '🛒',
    desc:     'Manage store products and orders',
    category: 'commerce'
  },
  /* Reporting */
  {
    key:      'analytics',
    label:    'Analytics',
    icon:     '📊',
    desc:     'View platform-wide analytics and dashboards',
    category: 'reporting'
  },
  {
    key:      'reports',
    label:    'Reports',
    icon:     '📈',
    desc:     'View and export platform reports',
    category: 'reporting'
  },
  {
    key:      'audit_logs',
    label:    'Audit Logs',
    icon:     '🔍',
    desc:     'View system audit and activity logs',
    category: 'reporting'
  },
  /* Communication */
  {
    key:      'announcements',
    label:    'Announcements',
    icon:     '📢',
    desc:     'Send announcements to all institutions',
    category: 'communication'
  }

/* ── ECE MODULES (Phase 1 delivered) ───────────────────── */
  ,{
    key:      'ece_admin',
    label:    'ECE Administration',
    icon:     '🎓',
    desc:     'Configure the Examination Core Engine for all exam systems',
    category: 'ece'
  }
  ,{
    key:      'ece_read',
    label:    'ECE Read Access',
    icon:     '👁',
    desc:     'View ECE configuration and audit logs (read-only)',
    category: 'ece'
  }

  /* ── QMS MODULES (Phase 1 delivered) ───────────────────── */
  ,{
    key:      'question_import',
    label:    'Question Import',
    icon:     '📥',
    desc:     'Import questions into the platform question bank',
    category: 'qms'
  }
  ,{
    key:      'question_bank',
    label:    'Question Bank',
    icon:     '📚',
    desc:     'Browse, edit, and manage all stored questions',
    category: 'qms'
  }
  ,{
    key:      'question_engine',
    label:    'Question Engine',
    icon:     '🧠',
    desc:     'Configure intelligent question delivery for CBT',
    category: 'qms'
  }
  ,{
    key:      'question_stats',
    label:    'Question Statistics',
    icon:     '📊',
    desc:     'View import history and question bank analytics',
    category: 'qms'
  }

];
/* ── FUTURE MODULES ──────────────────────────────────────*/



/* ---- Role defaults — applied on invitation acceptance ---- */
var ROLE_DEFAULT_PERMISSIONS = {
 platform_admin: [
    'institutions', 'subscriptions', 'cbt', 'staff',
    'analytics', 'reports', 'announcements', 'audit_logs', 'store',
    'question_import', 'question_bank', 'question_engine', 'question_stats'
  ],
  support_admin:  ['institutions', 'analytics', 'announcements', 'audit_logs'],
  finance_admin:  ['institutions', 'subscriptions', 'reports', 'analytics'],
  content_admin:  ['announcements', 'content'],
  developer:      ['analytics', 'audit_logs', 'reports']
};

module.exports = {
  PERMISSION_REGISTRY:      PERMISSION_REGISTRY,
  ROLE_DEFAULT_PERMISSIONS: ROLE_DEFAULT_PERMISSIONS,

  /* Return all valid permission key strings */
  getAllKeys: function () {
    return PERMISSION_REGISTRY.map(function (p) { return p.key; });
  },

  /* Return default permissions for a role (safe copy) */
  getDefaultPermissions: function (role) {
    return (ROLE_DEFAULT_PERMISSIONS[role] || []).slice();
  }
};