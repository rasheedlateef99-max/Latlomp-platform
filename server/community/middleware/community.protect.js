'use strict';
/* ============================================
   LATLOMP COMMUNITY — PROTECT MIDDLEWARE (E9A)

   Separate from instProtect — does NOT modify
   or replace instProtect. E1–E8 routes unchanged.

   Reads:  Authorization: Bearer <community_token>
   Sets:   req.communityMember  (CommunityMembership doc)
           req.schoolId          (from token — never from body)

   communityWriteGuard: additionally rejects suspended members.
   communityModGuard:   requires moderator or admin role.
   communityAdminGuard: requires admin role only.

   Token secret: COMMUNITY_JWT_SECRET || JWT_SECRET
   Token key:    latlomp_community_token (localStorage)
============================================ */
'use strict';

var jwt                 = require('jsonwebtoken');
var mongoose            = require('mongoose');
var CommunityMembership = require('../models/CommunityMembership.model');

var COMMUNITY_SECRET = process.env.COMMUNITY_JWT_SECRET || process.env.JWT_SECRET;

/* ============================================
   communityProtect
   Verifies community token and loads membership.
   All community routes (read + write) must use this.
============================================ */
async function communityProtect(req, res, next) {
  try {
    var authHeader = req.headers['authorization'] || '';
    var token      = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Community access requires authentication. Please log in to your portal first.'
      });
    }

    var decoded;
    try {
      decoded = jwt.verify(token, COMMUNITY_SECRET);
    } catch(jwtErr) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired community session. Please rejoin from your portal.',
        expired: jwtErr.name === 'TokenExpiredError'
      });
    }

    /* Verify this is actually a community token */
    if (!decoded.communityToken) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token type. Use your community session token.'
      });
    }

    if (!mongoose.isValidObjectId(decoded.memberId) ||
        !mongoose.isValidObjectId(decoded.schoolId)) {
      return res.status(401).json({ success: false, message: 'Malformed community token.' });
    }

    /* Load membership — TENANT SCOPED from token (never from body) */
    var membership = await CommunityMembership.findOne({
      _id:      decoded.memberId,
      schoolId: decoded.schoolId  /* TENANT SCOPE */
    }).lean();

    if (!membership) {
      return res.status(401).json({
        success: false,
        message: 'Community membership not found. Please rejoin from your portal.'
      });
    }

    if (membership.status === 'banned') {
      return res.status(403).json({
        success: false,
        message: 'Your community access has been permanently removed.' +
                 (membership.bannedReason ? ' Reason: ' + membership.bannedReason : '')
      });
    }

    /* Set request context — schoolId ALWAYS from token */
    req.communityMember = membership;
    req.schoolId        = membership.schoolId; /* Consistent with E1–E8 pattern */

    /* Update lastActiveAt asynchronously (non-blocking) */
    CommunityMembership.findByIdAndUpdate(
      membership._id,
      { $set: { lastActiveAt: new Date() } }
    ).catch(function() {});

    next();
  } catch(err) {
    console.error('[communityProtect] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Authentication error.' });
  }
}

/* ============================================
   communityWriteGuard
   Use AFTER communityProtect.
   Rejects suspended members from write operations.
   Suspended members may still read (communityProtect
   allows them through; write routes add this guard).
============================================ */
function communityWriteGuard(req, res, next) {
  var member = req.communityMember;
  if (!member) {
    return res.status(401).json({ success: false, message: 'Not authenticated.' });
  }
  if (member.status === 'suspended') {
    var until = member.suspendedUntil;
    /* Check if suspension has expired */
    if (!until || until > new Date()) {
      return res.status(403).json({
        success: false,
        message: 'Your community posting privileges are suspended.' +
                 (member.suspendedReason ? ' Reason: ' + member.suspendedReason : '') +
                 (until ? ' Until: ' + new Date(until).toLocaleDateString('en-GB') : ' (indefinitely)'),
        suspendedUntil: until || null
      });
    }
    /* Suspension expired — lift it asynchronously and allow write */
    CommunityMembership.findByIdAndUpdate(
      member._id,
      { $set: { status: 'active', suspendedUntil: null, suspendedReason: '' } }
    ).catch(function() {});
  }
  next();
}

/* ============================================
   communityModGuard
   Use AFTER communityProtect.
   Requires moderator or admin role.
============================================ */
function communityModGuard(req, res, next) {
  var role = req.communityMember && req.communityMember.role;
  if (role !== 'moderator' && role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Moderator or admin role required for this action.'
    });
  }
  next();
}

/* ============================================
   communityAdminGuard
   Use AFTER communityProtect.
   Requires admin role only.
============================================ */
function communityAdminGuard(req, res, next) {
  var role = req.communityMember && req.communityMember.role;
  if (role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Community admin role required for this action.'
    });
  }
  next();
}

module.exports = {
  communityProtect,
  communityWriteGuard,
  communityModGuard,
  communityAdminGuard,
  COMMUNITY_SECRET
};