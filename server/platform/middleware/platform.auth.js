/* ============================================
   LATLOMP PLATFORM — PLATFORM STAFF AUTH MIDDLEWARE

   Three separate guards for the platform admin layer.

   COLLISION PREVENTION:
     This middleware checks decoded.platformStaffId.
     Main platform tokens carry decoded.userId.
     Institution tokens carry decoded.schoolUserId.
     Student tokens carry decoded.studentId + role:'student'.
     These four payload shapes are structurally incompatible.
     No token issued for one system can pass any guard
     built for a different system.

   ROOT SUPER ADMIN:
     Root is NOT protected by this middleware.
     Root uses the existing main platform JWT (adminOnly).
     Root's token is { userId } — it does not contain
     platformStaffId and will fail platformStaffProtect.
     The two auth systems are completely separate.

   PERMISSION MODEL:
     Fixed permission sets per role — defined in code.
     Only role assignments are stored in the database.
     Adding a new permission set requires only a code change.
============================================ */
'use strict';

const jwt           = require('jsonwebtoken');
const PlatformStaff = require('../models/PlatformStaff.model');

/* ============================================
   PERMISSION SETS PER ROLE
   Each role's capabilities are explicit.
   'root' is listed for reference only and is
   never stored as a platformRole on any account.
============================================ */
var PERMISSIONS = {
  platform_admin: [
    'view_schools',
    'manage_schools',          /* suspend, activate, delete */
    'view_subscriptions',
    'manage_subscriptions',    /* add days, change plan, expire */
    'view_plans',
    'manage_plans',            /* create, edit, toggle plans */
    'view_payments',
    'send_announcements',
    'view_logs',
    'view_analytics',
    'invite_staff',            /* invite new platform staff */
    'view_staff'               /* view staff list */
    /* Note: suspend/delete staff is ROOT ONLY — not in this set */
  ],

  support_admin: [
    'view_schools',
    'view_subscriptions',
    'view_analytics',
    'send_announcements',
    'view_logs'
  ],

  finance_admin: [
    'view_schools',
    'view_subscriptions',
    'manage_subscriptions',
    'view_plans',
    'manage_plans',
    'view_payments',
    'view_analytics'
  ],

  content_admin: [
    'send_announcements',
    'view_analytics'
  ],

  developer: [
    'view_schools',
    'view_subscriptions',
    'view_payments',
    'view_logs',
    'view_analytics'
  ]
};

/* ============================================
   SIGN PLATFORM STAFF TOKEN
   Token payload:  { platformStaffId, platformRole }
   Expiry:         7 days
   Secret:         process.env.JWT_SECRET (shared)
   Storage (client): localStorage 'latlomp_platform_token'
============================================ */
function signPlatformToken(platformStaffId, platformRole) {
  return jwt.sign(
    {
      platformStaffId: platformStaffId.toString(),
      platformRole:    platformRole
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/* ============================================
   platformStaffProtect
   Verifies the platform staff JWT.
   Attaches: req.platformStaff, req.platformRole,
             req.platformPermissions
   Rejects: all other token types
============================================ */
async function platformStaffProtect(req, res, next) {
  try {
    var token = null;
    var authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authenticated. Please log in.' });
    }

    var decoded = jwt.verify(token, process.env.JWT_SECRET);

    /* Must be a platform staff token */
    if (!decoded.platformStaffId) {
      return res.status(401).json({ success: false, message: 'Invalid token type.' });
    }

    var staff = await PlatformStaff.findById(decoded.platformStaffId);
    if (!staff) {
      return res.status(401).json({ success: false, message: 'Staff account not found.' });
    }

    if (staff.status !== 'active' || !staff.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been suspended. Please contact the platform administrator.'
      });
    }

    req.platformStaff       = staff;
    req.platformRole        = staff.platformRole;
    req.platformPermissions = PERMISSIONS[staff.platformRole] || [];
    next();

  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
}

/* ============================================
   rootOrPlatformAdmin
   Runs AFTER platformStaffProtect.
   Allows only platform_admin role.
   Used for: invite staff, view staff list,
             manage CBT content as platform admin.

   NOTE: Suspend/delete/reactivate staff endpoints
   use ROOT SUPER ADMIN guard (main platform adminOnly)
   NOT this guard. This is intentional — platform admins
   cannot manage the lifecycle of other platform admins.
============================================ */
function rootOrPlatformAdmin(req, res, next) {
  if (!req.platformStaff) {
    return res.status(403).json({ success: false, message: 'Access denied.' });
  }
  if (req.platformRole !== 'platform_admin') {
    return res.status(403).json({
      success: false,
      message: 'Platform administrator access required for this action.'
    });
  }
  next();
}

/* ============================================
   requirePlatformPermission(action)
   Factory guard — checks a specific permission.
   Called AFTER platformStaffProtect.

   Usage:
     router.get('/schools', platformStaffProtect,
       requirePlatformPermission('view_schools'),
       handler)
============================================ */
function requirePlatformPermission(action) {
  return function (req, res, next) {
    if (!req.platformPermissions || !req.platformPermissions.includes(action)) {
      return res.status(403).json({
        success: false,
        message: 'Your role does not have permission to perform this action.'
      });
    }
    next();
  };
}

module.exports = {
  signPlatformToken,
  platformStaffProtect,
  rootOrPlatformAdmin,
  requirePlatformPermission,
  PERMISSIONS
};