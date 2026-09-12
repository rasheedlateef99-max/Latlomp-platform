'use strict';
/* ============================================
   LATLOMP COMMUNITY — MEMBERSHIP SERVICE (E9A)

   Handles: findOrCreate membership, token issuance,
   role determination from existing RBAC.

   Does NOT duplicate identity data.
   memberRef always points to authoritative model.
============================================ */
'use strict';

var jwt                 = require('jsonwebtoken');
var CommunityMembership = require('../models/CommunityMembership.model');
var COMMUNITY_SECRET    = require('../middleware/community.protect').COMMUNITY_SECRET;
var TOKEN_EXPIRY        = '7d';

/* ============================================
   determineCommunityRole(memberType, sourceRole)
   Maps existing platform roles to community roles.
   sourceRole = SchoolUser.role value for staff.
   
   ⚠️ Exact SchoolUser.role enum REQUIRES INSPECTION.
   The pattern below is defensive and safe.
============================================ */
function determineCommunityRole(memberType, sourceRole) {
  if (memberType === 'admin') return 'admin';
  if (memberType === 'staff' && sourceRole) {
    var r = String(sourceRole).toLowerCase();
    /* Admin-level roles → community admin */
    if (r.includes('admin') || r === 'principal' || r === 'head_teacher') {
      return 'admin';
    }
    /* Senior roles → community moderator */
    if (r.includes('senior') || r.includes('head_of') || r === 'vice_principal' ||
        r === 'hod' || r.includes('deputy')) {
      return 'moderator';
    }
  }
  /* Students, parents, alumni, regular staff → member */
  return 'member';
}

/* ============================================
   findOrCreateMembership
   Creates a membership record if one doesn't exist.
   Updates display info on subsequent calls.
   NEVER overwrites role/status if member already exists.
============================================ */
async function findOrCreateMembership(options) {
  var { schoolId, memberType, memberRef, memberName, memberAvatar, sourceRole } = options;

  var existing = await CommunityMembership.findOne({
    schoolId:   schoolId,   /* TENANT SCOPE */
    memberType: memberType,
    memberRef:  memberRef
  });

  if (existing) {
    /* Update display info if stale — but never change role/status here */
    var updateFields = { lastActiveAt: new Date() };
    if (memberName && memberName !== existing.memberName) {
      updateFields.memberName = memberName;
    }
    if (memberAvatar && memberAvatar !== existing.memberAvatar) {
      updateFields.memberAvatar = memberAvatar;
    }
    await CommunityMembership.findByIdAndUpdate(existing._id, { $set: updateFields });

    /* Return fresh copy */
    return CommunityMembership.findById(existing._id).lean();
  }

  /* New membership */
  var role = determineCommunityRole(memberType, sourceRole);

  var membership = await CommunityMembership.create({
    schoolId:     schoolId,
    memberType:   memberType,
    memberRef:    memberRef,
    memberName:   memberName   || 'Member',
    memberAvatar: memberAvatar || '',
    role:         role,
    status:       'active',
    joinedAt:     new Date(),
    lastActiveAt: new Date()
  });

  return membership.toObject ? membership.toObject() : membership;
}

/* ============================================
   issueCommunityToken
   Signs a community JWT from a membership record.
   communityToken: true distinguishes from inst tokens.
============================================ */
function issueCommunityToken(membership) {
  return jwt.sign({
    communityToken: true,
    schoolId:       membership.schoolId.toString(),
    memberId:       membership._id.toString(),
    memberType:     membership.memberType,
    memberRef:      membership.memberRef.toString(),
    role:           membership.role,
    status:         membership.status
  }, COMMUNITY_SECRET, { expiresIn: TOKEN_EXPIRY });
}

/* ============================================
   safeErrorMsg
   Prevents Mongoose schema details leaking to client.
============================================ */
function safeErrorMsg(err) {
  if (err && err.name === 'ValidationError') {
    return 'Validation failed. Check your input.';
  }
  if (err && err.code === 11000) {
    return 'A duplicate record exists.';
  }
  return (err && err.message) || 'An unexpected error occurred.';
}

module.exports = {
  findOrCreateMembership,
  issueCommunityToken,
  determineCommunityRole,
  safeErrorMsg,
  TOKEN_EXPIRY
};