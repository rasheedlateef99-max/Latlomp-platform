/* ============================================
   LATLOMP PLATFORM — PLATFORM STAFF AUTH MIDDLEWARE

   Three separate guards for the platform admin layer.

   COLLISION PREVENTION:
     This middleware checks decoded.platformStaffId.
     Main platform tokens carry decoded.id (confirmed Stage 5).
     ✅ STAGE 5 FIX: rootProtect and combinedRootOrPlatformAdmin
     now check decoded.userId || decoded.id — robust against
     either JWT convention.
   ✅ DEFINITIVE FIX: Admin is identified by user.role === 'admin'
     NOT by user.isAdmin (which does not exist on User model).
     User.model.js role enum: ['student', 'teacher', 'admin'].
     Confirmed from auth.middleware.js adminOnly guard pattern.
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
/* Lazy-load main platform User model (for root verification).
   Path: server/models/User.model.js — same model that adminOnly uses.
   Lazy-loaded to prevent circular dependency risk. */
function _getUserModel() {
  try { return require('../../models/User.model'); } catch (e) { return null; }
}

/* ============================================
   PERMISSION SETS PER ROLE
   Each role's capabilities are explicit.
   'root' is listed for reference only and is
   never stored as a platformRole on any account.
============================================ */
/* ✅ POLISH: Permission keys now match PLATFORM_MODULES in PlatformStaff.model.js.
   This map is used ONLY as a fallback for legacy staff accounts
   that were created before the dynamic permission system.
   New staff receive permissions from DB (populated on invite acceptance). */
var PERMISSIONS = {
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

   req.platformStaff = staff;
    req.platformRole  = staff.platformRole;
    /* ✅ POLISH: Read permissions from DB (dynamic per staff member).
       Falls back to hardcoded PERMISSIONS for legacy staff accounts
       that were created before the dynamic permission update. */
    req.platformPermissions = (staff.permissions && staff.permissions.length > 0)
      ? staff.permissions
      : (PERMISSIONS[staff.platformRole] || []);
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

/* ============================================
   rootProtect
   ✅ STAGE 2 ADDITION
   Accepts ONLY the Root Super Admin's main platform
   JWT (decoded.userId + isAdmin: true on User model).
   Platform staff tokens fail here by design.
   Used on: suspend, reactivate, delete staff endpoints.
   These actions are root-exclusive per Option A decision.
============================================ */
async function rootProtect(req, res, next) {
  try {
    var token = null;
    var authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authenticated.' });
    }

   var decoded = jwt.verify(token, process.env.JWT_SECRET);

    /* Must be a main platform token.
       ✅ STAGE 5 FIX: check both decoded.id (standard Mongoose convention)
       and decoded.userId (alternative convention) to be robust. */
    var mainUserId = decoded.userId || decoded.id || null;
    if (!mainUserId) {
      return res.status(403).json({
        success: false,
        message: 'Root administrator access required. This action is restricted to the platform owner.'
      });
    }

    var User = _getUserModel();
    if (!User) {
      return res.status(500).json({ success: false, message: 'Auth system error.' });
    }

   /* ✅ DEFINITIVE FIX: User model has no 'isAdmin' field.
       Admin is identified by role === 'admin' (confirmed from
       User.model.js role enum: ['student','teacher','admin']
       and adminOnly guard: req.user.role !== 'admin') */
    var user = await User.findById(mainUserId).select('role email name');
    if (!user || user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Root administrator access required.'
      });
    }

    req.rootUser = user;
    req.isRoot   = true;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
}

/* ============================================
   combinedRootOrPlatformAdmin
   ✅ STAGE 2 ADDITION
   Accepts EITHER:
     (a) Root Super Admin — main platform JWT + isAdmin
     (b) Platform Admin   — platform staff JWT + role='platform_admin'
   Used on: invite staff, view staff list, view invitations,
            revoke invitations.
   Attaches req.isRoot (boolean) so routes can distinguish
   who called them for audit trail purposes.
============================================ */
async function combinedRootOrPlatformAdmin(req, res, next) {
  try {
    var token = null;
    var authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authenticated.' });
    }

    var decoded = jwt.verify(token, process.env.JWT_SECRET);

    /* PATH A — Platform staff token */
    if (decoded.platformStaffId) {
      var staff = await PlatformStaff.findById(decoded.platformStaffId);
      if (!staff) {
        return res.status(401).json({ success: false, message: 'Staff account not found.' });
      }
      if (staff.status !== 'active' || !staff.isActive) {
        return res.status(403).json({ success: false, message: 'Your account has been suspended.' });
      }
      if (staff.platformRole !== 'platform_admin') {
        return res.status(403).json({
          success: false,
          message: 'Platform administrator role required for this action.'
        });
      }
      req.platformStaff       = staff;
      req.platformRole        = staff.platformRole;
      req.platformPermissions = PERMISSIONS[staff.platformRole] || [];
      req.isRoot              = false;
      return next();
    }

   /* PATH B — Main platform token (root super admin)
       ✅ STAGE 5 FIX: check both decoded.id and decoded.userId.
       The main platform JWT uses decoded.id (standard convention).
       We check both to be defensive against either convention. */
    var mainUserId = decoded.userId || decoded.id || null;
    if (mainUserId) {
      var User = _getUserModel();
      if (!User) {
        return res.status(500).json({ success: false, message: 'Auth system error.' });
      }
     /* ✅ DEFINITIVE FIX: check role === 'admin', not isAdmin field
         (User model uses role enum, no boolean isAdmin exists) */
      var user = await User.findById(mainUserId).select('role email name');
      if (!user || user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Platform administrator or root access required.'
        });
      }
      req.rootUser = user;
      req.isRoot   = true;
      return next();
    }

    /* No valid token type */
    return res.status(401).json({ success: false, message: 'Invalid token type.' });

  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
}
module.exports = {
  /* ---- Stage 1 exports (unchanged) ---- */
  signPlatformToken,
  platformStaffProtect,
  rootOrPlatformAdmin,
  requirePlatformPermission,
  PERMISSIONS,
  /* ---- Stage 2 additions ---- */
  rootProtect,
  combinedRootOrPlatformAdmin
};