/* ============================================
   LATLOMP PLATFORM — PLATFORM STAFF MANAGEMENT ROUTES

   Replaces the Stage 1 placeholder.
   Mounted at: /api/platform-staff

   ACCESS MODEL:
     combinedRootOrPlatformAdmin — root OR platform_admin
       POST /invite
       GET  /
       GET  /invitations
       GET  /:id
       DELETE /invitations/:id

     rootProtect — ROOT SUPER ADMIN ONLY
       PUT  /:id/suspend
       PUT  /:id/reactivate
       DELETE /:id

   AUDIT TRAIL:
     Every action records who performed it.
     req.isRoot === true  → 'root'
     req.isRoot === false → req.platformStaff._id

   OPTION A ENFORCED:
     Only rootProtect guards control suspension,
     reactivation, and deletion of staff accounts.
     Platform admins cannot lock out each other.
============================================ */
'use strict';

const express            = require('express');
const router             = express.Router();

const PlatformStaff      = require('../models/PlatformStaff.model');
const PlatformInvitation = require('../models/PlatformInvitation.model');
const {
  combinedRootOrPlatformAdmin,
  rootProtect,
  platformStaffProtect,
  requirePlatformPermission
} = require('../middleware/platform.auth');

/* ---- Audit helper ---- */
function actorLabel(req) {
  return req.isRoot ? 'root' : (req.platformStaff ? req.platformStaff._id.toString() : 'unknown');
}

/* ============================================
   POST /api/platform-staff/invite
   ROOT + PLATFORM_ADMIN
   Create a secure invitation for a new platform
   staff member. Returns the invitation URL.
   No email is sent automatically — admin shares
   URL via WhatsApp, Telegram, email, etc.
============================================ */
router.post('/invite', combinedRootOrPlatformAdmin, async function (req, res) {
  try {
    var body         = req.body || {};
    var email        = (body.email || '').toLowerCase().trim();
    var name         = (body.name  || '').trim();
    var platformRole = (body.platformRole || '').trim();

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address is required.' });
    }
    if (!platformRole || !PlatformStaff.ROLES.includes(platformRole)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid platform role. Valid roles: ' + PlatformStaff.ROLES.join(', ')
      });
    }

    /* Cannot invite someone who already has a platform staff account */
    var existing = await PlatformStaff.findOne({ email: email });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A platform staff account already exists for this email address.'
      });
    }

    /* Revoke any pending invitations for this email */
    await PlatformInvitation.updateMany(
      { email: email, status: 'pending' },
      { $set: { status: 'revoked', revokedBy: actorLabel(req), revokedAt: new Date() } }
    );

    /* Create the new invitation */
    var invite = await PlatformInvitation.create({
      email:        email,
      name:         name,
      platformRole: platformRole,
      invitedBy:    actorLabel(req)
    });

    var baseUrl    = process.env.APP_URL || 'https://latlompsystem.up.railway.app';
    var inviteUrl  = baseUrl + '/platform/staff-invite.html?token=' + invite.token;
    var roleLabel  = PlatformInvitation.getRoleLabel(platformRole);

    return res.status(201).json({
      success:   true,
      message:   'Invitation created for ' + email + ' as ' + roleLabel + '.',
      invitation: {
        _id:          invite._id,
        email:        invite.email,
        name:         invite.name,
        platformRole: invite.platformRole,
        roleLabel:    roleLabel,
        inviteUrl:    inviteUrl,
        expiresAt:    invite.expiresAt,
        status:       invite.status
      }
    });
  } catch (err) {
    console.error('[platform.staff] POST /invite:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/platform-staff/invitations
   ROOT + PLATFORM_ADMIN
   ⚠ Must be BEFORE GET /:id to avoid Express
     treating 'invitations' as an :id parameter.
============================================ */
router.get('/invitations', combinedRootOrPlatformAdmin, async function (req, res) {
  try {
    var statusFilter = req.query.status || 'pending';
    var query        = {};
    if (statusFilter && statusFilter !== 'all') { query.status = statusFilter; }

    var invitations = await PlatformInvitation.find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    var result = invitations.map(function (inv) {
      return {
        _id:          inv._id,
        email:        inv.email,
        name:         inv.name         || '',
        platformRole: inv.platformRole,
        roleLabel:    PlatformInvitation.getRoleLabel(inv.platformRole),
        status:       inv.status,
        invitedBy:    inv.invitedBy,
        expiresAt:    inv.expiresAt,
        acceptedAt:   inv.acceptedAt   || null,
        revokedAt:    inv.revokedAt    || null,
        isExpiredNow: inv.status === 'pending' && new Date() > inv.expiresAt,
        createdAt:    inv.createdAt
      };
    });

    return res.status(200).json({ success: true, invitations: result, total: result.length });
  } catch (err) {
    console.error('[platform.staff] GET /invitations:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   DELETE /api/platform-staff/invitations/:id
   ROOT + PLATFORM_ADMIN
   Revoke a pending invitation.
   A revoked invitation URL immediately stops working.
   ⚠ Must be BEFORE DELETE /:id to avoid path conflict.
============================================ */
router.delete('/invitations/:id', combinedRootOrPlatformAdmin, async function (req, res) {
  try {
    var invite = await PlatformInvitation.findById(req.params.id);
    if (!invite) {
      return res.status(404).json({ success: false, message: 'Invitation not found.' });
    }
    if (invite.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only pending invitations can be revoked. This invitation is already ' + invite.status + '.'
      });
    }

    invite.status    = 'revoked';
    invite.revokedBy = actorLabel(req);
    invite.revokedAt = new Date();
    await invite.save();

    return res.status(200).json({
      success: true,
      message: 'Invitation for ' + invite.email + ' has been revoked. The link is now invalid.'
    });
  } catch (err) {
    console.error('[platform.staff] DELETE /invitations/:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/platform-staff
   ROOT + PLATFORM_ADMIN
   Returns all platform staff accounts.
   Never exposes googleId or login IP history.
============================================ */
router.get('/', combinedRootOrPlatformAdmin, async function (req, res) {
  try {
    var staff = await PlatformStaff.find({})
      .select('-googleId -loginHistory')
      .sort({ createdAt: -1 })
      .lean();

    var result = staff.map(function (s) {
      return {
        _id:          s._id,
        name:         s.name,
        email:        s.email,
        avatar:       s.avatar         || '',
        platformRole: s.platformRole,
        roleLabel:    PlatformInvitation.getRoleLabel(s.platformRole),
        status:       s.status,
        isActive:     s.isActive,
        invitedBy:    s.invitedBy,
        joinedAt:     s.joinedAt,
        lastLoginAt:  s.lastLoginAt    || null,
        suspendedAt:  s.suspendedAt    || null,
        suspensionReason: s.suspensionReason || ''
      };
    });

    return res.status(200).json({ success: true, staff: result, total: result.length });
  } catch (err) {
    console.error('[platform.staff] GET /:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/platform-staff/:id
   ROOT + PLATFORM_ADMIN
   Returns individual staff profile.
   Includes redacted login history (IP masked).
============================================ */
router.get('/:id', combinedRootOrPlatformAdmin, async function (req, res) {
  try {
    var staff = await PlatformStaff.findById(req.params.id)
      .select('-googleId')
      .lean();

    if (!staff) {
      return res.status(404).json({ success: false, message: 'Platform staff member not found.' });
    }

    /* Mask IP addresses for privacy — show only last 4 chars */
    var safeHistory = (staff.loginHistory || []).map(function (entry) {
      var ip = entry.ip || '';
      return {
        ipMasked: ip.length > 4 ? '***' + ip.slice(-4) : ip,
        userAgent: (entry.userAgent || '').substring(0, 80),
        at:        entry.at
      };
    });

    return res.status(200).json({
      success: true,
      staff: {
        _id:              staff._id,
        name:             staff.name,
        email:            staff.email,
        avatar:           staff.avatar           || '',
        platformRole:     staff.platformRole,
        roleLabel:        PlatformInvitation.getRoleLabel(staff.platformRole),
        status:           staff.status,
        isActive:         staff.isActive,
        invitedBy:        staff.invitedBy,
        joinedAt:         staff.joinedAt,
        lastLoginAt:      staff.lastLoginAt       || null,
        suspendedAt:      staff.suspendedAt       || null,
        suspendedBy:      staff.suspendedBy       || null,
        suspensionReason: staff.suspensionReason  || '',
        loginHistory:     safeHistory,
        createdAt:        staff.createdAt
      }
    });
  } catch (err) {
    console.error('[platform.staff] GET /:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /api/platform-staff/:id/suspend
   ROOT ONLY — Option A confirmed.
   Platform admins cannot suspend each other.
   Body: { reason (optional) }
============================================ */
router.put('/:id/suspend', rootProtect, async function (req, res) {
  try {
    var staff = await PlatformStaff.findById(req.params.id);
    if (!staff) {
      return res.status(404).json({ success: false, message: 'Platform staff member not found.' });
    }
    if (staff.status === 'suspended') {
      return res.status(400).json({ success: false, message: 'This account is already suspended.' });
    }

    var reason = (req.body && req.body.reason) ? String(req.body.reason).trim() : '';

    staff.status           = 'suspended';
    staff.isActive         = false;
    staff.suspendedBy      = 'root';
    staff.suspendedAt      = new Date();
    staff.suspensionReason = reason;
    await staff.save();

    return res.status(200).json({
      success: true,
      message: staff.name + '\'s account has been suspended. They cannot log in until reactivated.',
      staff: { _id: staff._id, name: staff.name, status: staff.status }
    });
  } catch (err) {
    console.error('[platform.staff] PUT /:id/suspend:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /api/platform-staff/:id/reactivate
   ROOT ONLY — Option A confirmed.
============================================ */
router.put('/:id/reactivate', rootProtect, async function (req, res) {
  try {
    var staff = await PlatformStaff.findById(req.params.id);
    if (!staff) {
      return res.status(404).json({ success: false, message: 'Platform staff member not found.' });
    }
    if (staff.status === 'active' && staff.isActive) {
      return res.status(400).json({ success: false, message: 'This account is already active.' });
    }

    staff.status           = 'active';
    staff.isActive         = true;
    staff.suspendedBy      = null;
    staff.suspendedAt      = null;
    staff.suspensionReason = '';
    await staff.save();

    return res.status(200).json({
      success: true,
      message: staff.name + '\'s account has been reactivated. They can log in again.',
      staff: { _id: staff._id, name: staff.name, status: staff.status }
    });
  } catch (err) {
    console.error('[platform.staff] PUT /:id/reactivate:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   DELETE /api/platform-staff/:id
   ROOT ONLY — Option A confirmed.
   Permanently removes the staff account.
   Also revokes any pending invitations for
   that email address.
============================================ */
router.delete('/:id', rootProtect, async function (req, res) {
  try {
    var staff = await PlatformStaff.findById(req.params.id);
    if (!staff) {
      return res.status(404).json({ success: false, message: 'Platform staff member not found.' });
    }

    var staffName  = staff.name;
    var staffEmail = staff.email;

    /* Revoke any pending invitations for this email */
    await PlatformInvitation.updateMany(
      { email: staffEmail, status: 'pending' },
      { $set: { status: 'revoked', revokedBy: 'root', revokedAt: new Date() } }
    );

    /* Delete the staff account */
    await PlatformStaff.findByIdAndDelete(req.params.id);

    return res.status(200).json({
      success: true,
      message: staffName + ' (' + staffEmail + ') has been permanently removed from platform administration.'
    });
  } catch (err) {
    console.error('[platform.staff] DELETE /:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});


/* ============================================
   DATA ENDPOINTS FOR PLATFORM STAFF DASHBOARD
   ✅ STAGE 3 ADDITION

   These allow platform staff to read institution
   data based on their permission set.
   Protected by platformStaffProtect +
   requirePlatformPermission per action.

   Route prefix: /api/platform-staff/data/*
   ⚠ 'data' path defined here — must stay before
   any /:id route to prevent path collision.
   (No /:id conflict since 'data' is a literal segment.)
============================================ */

/* Lazy model loaders — safe paths from this file's location.
   platform/routes/ → up 2 = server/ → institution/models/ */
function _getSchoolModel() {
  try { return require('../../institution/models/School.model'); } catch (e) { return null; }
}
function _getSubModels() {
  try { return require('../../institution/models/Subscription.model'); } catch (e) { return {}; }
}

/* ---- GET /api/platform-staff/data/stats ---- */
router.get(
  '/data/stats',
  platformStaffProtect,
  requirePlatformPermission('view_analytics'),
  async function (req, res) {
    try {
      var School = _getSchoolModel();
      if (!School) {
        return res.status(503).json({ success: false, message: 'Stats service temporarily unavailable.' });
      }
      var [total, active, trial, expired, suspended] = await Promise.all([
        School.countDocuments({}),
        School.countDocuments({ status: 'active',    isSuspended: { $ne: true } }),
        School.countDocuments({ status: 'trial',     isSuspended: { $ne: true } }),
        School.countDocuments({ status: 'expired',   isSuspended: { $ne: true } }),
        School.countDocuments({ isSuspended: true })
      ]);
      var mods = _getSubModels();
      var Subscription = mods.Subscription || null;
      var totalRevenue  = 0;
      if (Subscription) {
        var revAgg = await Subscription.aggregate([
          { $match: { status: 'active', isTrial: { $ne: true } } },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        totalRevenue = revAgg.length > 0 ? (revAgg[0].total || 0) : 0;
      }
      return res.json({
        success: true,
        stats: { total, active, trial, expired, suspended, totalRevenue }
      });
    } catch (err) {
      console.error('[platform-staff] GET /data/stats:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

/* ---- GET /api/platform-staff/data/schools ---- */
router.get(
  '/data/schools',
  platformStaffProtect,
  requirePlatformPermission('view_schools'),
  async function (req, res) {
    try {
      var School = _getSchoolModel();
      if (!School) {
        return res.status(503).json({ success: false, message: 'School service temporarily unavailable.' });
      }
      var page    = Math.max(1, parseInt(req.query.page)  || 1);
      var limit   = Math.min(20, parseInt(req.query.limit) || 15);
      var skip    = (page - 1) * limit;
      var search  = (req.query.search || '').trim();
      var status  = req.query.status || '';

      var query = {};
      if (status && status !== 'all') {
        if (status === 'suspended') { query.isSuspended = true; }
        else { query.status = status; query.isSuspended = { $ne: true }; }
      }
      if (search) {
        var rx    = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        query.$or = [{ name: rx }, { email: rx }];
      }

      var [schools, total] = await Promise.all([
        School.find(query)
          .select('name email logo slug status subscriptionPlan subscriptionExpiry isSuspended type createdAt')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        School.countDocuments(query)
      ]);

      var now = new Date();
      var result = schools.map(function (s) {
        var daysLeft = 0;
        if (s.subscriptionExpiry) {
          daysLeft = Math.ceil((new Date(s.subscriptionExpiry) - now) / 86400000);
        }
        return {
          _id:              s._id,
          name:             s.name,
          email:            s.email            || '',
          logo:             s.logo             || '',
          slug:             s.slug             || '',
          type:             s.type             || 'secondary',
          status:           s.isSuspended ? 'suspended' : (s.status || 'unknown'),
          subscriptionPlan: s.subscriptionPlan || '—',
          subscriptionExpiry: s.subscriptionExpiry || null,
          daysLeft:         Math.max(0, daysLeft),
          isSuspended:      !!s.isSuspended,
          createdAt:        s.createdAt
        };
      });

      return res.json({
        success: true,
        schools: result,
        total:   total,
        pages:   Math.ceil(total / limit) || 1,
        page:    page
      });
    } catch (err) {
      console.error('[platform-staff] GET /data/schools:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

/* ---- GET /api/platform-staff/data/plans ---- */
router.get(
  '/data/plans',
  platformStaffProtect,
  requirePlatformPermission('view_plans'),
  async function (req, res) {
    try {
      var mods = _getSubModels();
      var SubscriptionPlan = mods.SubscriptionPlan || null;
      if (!SubscriptionPlan) {
        return res.status(503).json({ success: false, message: 'Plans service temporarily unavailable.' });
      }
      var plans = await SubscriptionPlan.find({}).sort({ sortOrder: 1 }).lean();
      return res.json({ success: true, plans: plans });
    } catch (err) {
      console.error('[platform-staff] GET /data/plans:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

module.exports = router;