'use strict';
/* ============================================
   LATLOMP COMMUNITY — ROUTES (E9A + E9B)
   Mounted at: /api/community/
   schoolId: ALWAYS from JWT (never from body)
   authorId: ALWAYS from communityProtect (never from body)
============================================ */

var express    = require('express');
var router     = express.Router();
var mongoose   = require('mongoose');

var CommunityMembership = require('../models/CommunityMembership.model');
var CommunityMembershipLog = require('../models/CommunityMembershipLog.model');

/* ============================================
   E9F: Membership event logger
   Fire-and-forget — NEVER blocks user-facing responses.
   Log failures are warned but never bubble to client.
============================================ */
function logMembershipEvent(data) {
  CommunityMembershipLog.create({
    schoolId:        data.schoolId,
    memberId:        data.memberId,
    memberRef:       data.memberRef,
    memberName:      data.memberName      || '',
    action:          data.action,
    previousValue:   data.previousValue   || null,
    newValue:        data.newValue        || null,
    reason:          data.reason          || '',
    performedById:   data.performedById   || null,
    performedByName: data.performedByName || '',
    performedByType: data.performedByType || ''
  }).catch(function(e) {
    console.warn('[membership-log] write failed:', e.message);
  });
}
var CommunitySettings   = require('../models/CommunitySettings.model');
var CommunityPost       = require('../models/CommunityPost.model');
var multer              = require('multer');
var communityMediaSvc   = require('../services/community.media.service');

/* Multer: memory storage, 55MB ceiling covers images + video with header overhead */
var mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 55 * 1024 * 1024 }
});
var membershipService   = require('../services/community.membership.service');
var feedService         = require('../services/community.feed.service');

var {
  communityProtect,
  communityWriteGuard,
  communityModGuard,
  communityAdminGuard
} = require('../middleware/community.protect');

/* ---- Existing instProtect for staff join ---- */
var instProtect = require('../../institution/middleware/inst.auth').instProtect;

/* ---- Helpers ---- */
function sanitizeText(str) {
  if (!str) return '';
  return String(str).replace(/<[^>]*>/g, '').trim();
}

async function ensureSettings(schoolId) {
  var settings = await CommunitySettings.findOne({ schoolId }).lean();
  if (!settings) {
    var created = await CommunitySettings.create({ schoolId });
    return created.toObject ? created.toObject() : created;
  }
  return settings;
}

var ANNOUNCEMENT_TYPES_STAFF_ONLY = ['announcement'];
var ALL_POST_TYPES = ['post', 'announcement', 'event_ref', 'achievement', 'competition', 'award', 'reunion'];
var VALID_VISIBILITY = ['all', 'students', 'parents', 'staff', 'alumni'];

function getAllowedVisibilities(memberType, memberRole) {
  if (memberRole === 'admin' || memberRole === 'moderator' ||
      memberType === 'staff' || memberType === 'admin') {
    return VALID_VISIBILITY;
  }
  var base    = ['all'];
  var typeMap = { student: 'students', parent: 'parents', alumni: 'alumni' };
  var own     = typeMap[memberType];
  if (own) base.push(own);
  return base;
}

/* ============================================
   E9A: AUTH ROUTES
============================================ */

/* POST /api/community/auth/join/staff */
router.post('/auth/join/staff', instProtect, async function(req, res) {
  try {
    var schoolUser = req.schoolUser;
    var schoolId   = req.schoolId;

    var settings = await ensureSettings(schoolId);
    if (!settings.isEnabled) {
      return res.status(403).json({
        success: false,
        message: 'Community has not been enabled for this school yet. Ask your school administrator to enable it in Community Settings.'
      });
    }

    var sourceRole = (schoolUser.role || '').toLowerCase();
    var memberType = (sourceRole.includes('admin') || sourceRole === 'principal')
      ? 'admin' : 'staff';

    var membership = await membershipService.findOrCreateMembership({
      schoolId:     schoolId,
      memberType:   memberType,
      memberRef:    schoolUser._id,
      memberName:   schoolUser.name   || schoolUser.email || 'Staff Member',
      memberAvatar: schoolUser.avatar || '',
      sourceRole:   schoolUser.role
    });

    var communityToken = membershipService.issueCommunityToken(membership);

    return res.json({
      success: true,
      communityToken,
      membership: {
        _id:        membership._id,
        memberName: membership.memberName,
        memberType: membership.memberType,
        role:       membership.role,
        status:     membership.status,
        joinedAt:   membership.joinedAt
      }
    });
  } catch(err) {
    console.error('[community] POST /auth/join/staff:', err.message);
    return res.status(500).json({ success: false, message: membershipService.safeErrorMsg(err) });
  }
});

/* POST /api/community/auth/join/student — placeholder */
router.post('/auth/join/student', async function(req, res) {
  return res.status(501).json({
    success: false,
    message: 'Student community join requires inspection of student auth middleware.',
    code:    'REQUIRES_INSPECTION'
  });
});

/* POST /api/community/auth/join/parent — placeholder */
router.post('/auth/join/parent', async function(req, res) {
  return res.status(501).json({
    success: false,
    message: 'Parent community join requires inspection of parent auth middleware.',
    code:    'REQUIRES_INSPECTION'
  });
});

/* POST /api/community/auth/join/alumni — placeholder */
router.post('/auth/join/alumni', async function(req, res) {
  return res.status(501).json({
    success: false,
    message: 'Alumni community join requires inspection of alumni auth middleware.',
    code:    'REQUIRES_INSPECTION'
  });
});

/* POST /api/community/auth/refresh */
router.post('/auth/refresh', communityProtect, async function(req, res) {
  try {
    var freshToken = membershipService.issueCommunityToken(req.communityMember);
    return res.json({
      success:        true,
      communityToken: freshToken,
      membership: {
        _id:        req.communityMember._id,
        memberName: req.communityMember.memberName,
        memberType: req.communityMember.memberType,
        role:       req.communityMember.role,
        status:     req.communityMember.status
      }
    });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   E9A: MEMBER PROFILE ROUTES
============================================ */

/* GET /api/community/me */
router.get('/me', communityProtect, async function(req, res) {
  try {
    var member   = req.communityMember;
    var settings = await ensureSettings(req.schoolId);
    return res.json({
      success: true,
      member: {
        _id:             member._id,
        memberName:      member.memberName,
        memberAvatar:    member.memberAvatar,
        memberType:      member.memberType,
        role:            member.role,
        status:          member.status,
        joinedAt:        member.joinedAt,
        lastActiveAt:    member.lastActiveAt,
        suspendedUntil:  member.suspendedUntil  || null,
        suspendedReason: member.suspendedReason || ''
      },
      community: {
        name:           settings.communityName,
        welcomeMessage: settings.welcomeMessage,
        rules:          settings.rules
      }
    });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/community/me */
router.put('/me', communityProtect, communityWriteGuard, async function(req, res) {
  try {
    var member = req.communityMember;
    var update = {};

    if (req.body.memberName !== undefined) {
      var cleanName = sanitizeText(req.body.memberName).substring(0, 60);
      if (cleanName) update.memberName = cleanName;
    }
    if (req.body.memberAvatar !== undefined) {
      var avatar = String(req.body.memberAvatar || '').trim();
      if (/^javascript:/i.test(avatar) || /^data:/i.test(avatar)) {
        return res.status(400).json({ success: false, message: 'Invalid avatar URL.' });
      }
      update.memberAvatar = avatar;
    }
    if (!Object.keys(update).length) {
      return res.status(400).json({ success: false, message: 'Nothing to update.' });
    }

    var updated = await CommunityMembership.findByIdAndUpdate(
      member._id, { $set: update }, { new: true }
    ).lean();

    return res.json({ success: true, message: 'Profile updated.', member: {
      _id:          updated._id,
      memberName:   updated.memberName,
      memberAvatar: updated.memberAvatar
    }});
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   E9A: SETTINGS ROUTES
============================================ */

/* GET /api/community/settings */
router.get('/settings', communityProtect, async function(req, res) {
  try {
    var settings = await ensureSettings(req.schoolId);
    return res.json({
      success: true,
      settings: {
        isEnabled:           settings.isEnabled,
        communityName:       settings.communityName,
        welcomeMessage:      settings.welcomeMessage,
        rules:               settings.rules,
        requirePostApproval: settings.requirePostApproval,
        allowMediaUploads:   settings.allowMediaUploads,
        allowVideoUploads:   settings.allowVideoUploads,
        maxPostLength:       settings.maxPostLength,
        maxCommentLength:    settings.maxCommentLength
      }
    });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   E9A: MEMBERS ROUTES
============================================ */

/* GET /api/community/members */
router.get('/members', communityProtect, async function(req, res) {
  try {
    var page    = Math.max(1, parseInt(req.query.page)   || 1);
    var limit   = Math.min(50, parseInt(req.query.limit) || 20);
    var skip    = (page - 1) * limit;
    var isAdmin = ['moderator','admin'].includes(req.communityMember.role);

    var filter = {
      schoolId: req.schoolId,
      status:   { $in: ['active','suspended'] }
    };
    if (req.query.memberType) filter.memberType = req.query.memberType;
    if (req.query.role)       filter.role       = req.query.role;

    var [members, total] = await Promise.all([
      CommunityMembership.find(filter)
        .select(isAdmin
          ? 'memberName memberAvatar memberType role status suspendedUntil suspendedReason joinedAt lastActiveAt'
          : 'memberName memberAvatar memberType role joinedAt')
        .sort({ joinedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CommunityMembership.countDocuments(filter)
    ]);

    return res.json({
      success: true,
      members,
      pagination: { page, limit, total, pages: Math.ceil(total / limit), hasMore: skip + members.length < total }
    });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   E9A: ADMIN SETTINGS + MEMBER MANAGEMENT
============================================ */

/* PUT /api/community/admin/settings */
router.put('/admin/settings', communityProtect, communityAdminGuard, async function(req, res) {
  try {
    var allowed = [
      'isEnabled','communityName','welcomeMessage','rules',
      'requirePostApproval','allowStudentPosts','allowParentPosts',
      'allowAlumniPosts','allowStaffPosts','allowMediaUploads',
      'allowVideoUploads','maxMediaPerPost','maxPostLength','maxCommentLength'
    ];
    var update = {};
    allowed.forEach(function(field) {
      if (req.body[field] !== undefined) {
        update[field] = typeof req.body[field] === 'string'
          ? sanitizeText(req.body[field])
          : req.body[field];
      }
    });
    if (update.maxPostLength    && (update.maxPostLength    < 10 || update.maxPostLength    > 5000)) {
      return res.status(400).json({ success: false, message: 'Post length must be between 10 and 5000.' });
    }
    if (update.maxCommentLength && (update.maxCommentLength < 10 || update.maxCommentLength > 2000)) {
      return res.status(400).json({ success: false, message: 'Comment length must be between 10 and 2000.' });
    }
    var member = req.communityMember;
    update.updatedBy     = member.memberRef;
    update.updatedByName = member.memberName || '';
    update.updatedAt     = new Date();

    var settings = await CommunitySettings.findOneAndUpdate(
      { schoolId: req.schoolId },
      { $set: update },
      { upsert: true, new: true }
    ).lean();
    return res.json({ success: true, message: 'Community settings saved.', settings });
  } catch(err) {
    return res.status(500).json({ success: false, message: membershipService.safeErrorMsg(err) });
  }
});

/* GET /api/community/admin/members */
router.get('/admin/members', communityProtect, communityModGuard, async function(req, res) {
  try {
    var page   = Math.max(1, parseInt(req.query.page)   || 1);
    var limit  = Math.min(100, parseInt(req.query.limit) || 30);
    var skip   = (page - 1) * limit;
    var filter = { schoolId: req.schoolId };
    if (req.query.status)     filter.status     = req.query.status;
    if (req.query.memberType) filter.memberType = req.query.memberType;
    if (req.query.role)       filter.role       = req.query.role;
    /* E9F: name search — sanitized regex, tenant-scoped */
    if (req.query.q) {
      var safeQ = sanitizeText(req.query.q).substring(0, 60)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); /* escape regex special chars */
      if (safeQ) filter.memberName = { $regex: safeQ, $options: 'i' };
    }

    var [members, total] = await Promise.all([
      CommunityMembership.find(filter)
        .select('memberName memberAvatar memberType role status suspendedUntil suspendedReason bannedReason joinedAt lastActiveAt createdAt')
        .sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      CommunityMembership.countDocuments(filter)
    ]);
    return res.json({ success: true, members, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/community/admin/members/:id/role */
router.put('/admin/members/:id/role', communityProtect, communityAdminGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid member ID.' });
    }
    if (!['member','moderator','admin'].includes(req.body.role)) {
      return res.status(400).json({ success: false, message: 'Invalid role.' });
    }
    if (req.params.id === req.communityMember._id.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot change your own role.' });
    }
    /* E9F: fetch previous role for log before update */
    var prevMember = await CommunityMembership.findOne(
      { _id: req.params.id, schoolId: req.schoolId }
    ).select('role memberRef memberName').lean();

    var member = await CommunityMembership.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: { role: req.body.role, updatedBy: req.communityMember.memberRef, updatedByName: req.communityMember.memberName } },
      { new: true }
    );
    if (!member) return res.status(404).json({ success: false, message: 'Member not found.' });

    /* E9F: log role change (non-blocking) */
    logMembershipEvent({
      schoolId:        req.schoolId,
      memberId:        member._id,
      memberRef:       member.memberRef,
      memberName:      member.memberName,
      action:          'role_changed',
      previousValue:   prevMember ? prevMember.role : null,
      newValue:        req.body.role,
      performedById:   req.communityMember._id,
      performedByName: req.communityMember.memberName,
      performedByType: req.communityMember.memberType
    });

    return res.json({ success: true, message: 'Role updated.', role: member.role });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/community/admin/members/:id/suspend */
router.put('/admin/members/:id/suspend', communityProtect, communityModGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid member ID.' });
    }
    if (req.params.id === req.communityMember._id.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot suspend yourself.' });
    }
    var target = await CommunityMembership.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!target) return res.status(404).json({ success: false, message: 'Member not found.' });
    if (req.communityMember.role === 'moderator' && (target.role === 'moderator' || target.role === 'admin')) {
      return res.status(403).json({ success: false, message: 'Moderators cannot suspend other moderators or admins.' });
    }
    var reason   = sanitizeText(req.body.reason || '').substring(0, 200);
    var duration = parseInt(req.body.days) || null;
    var until    = duration ? new Date(Date.now() + duration * 24 * 60 * 60 * 1000) : null;
    await CommunityMembership.findByIdAndUpdate(target._id, {
      $set: { status: 'suspended', suspendedAt: new Date(), suspendedUntil: until, suspendedReason: reason, suspendedBy: req.communityMember.memberRef, updatedByName: req.communityMember.memberName }
    });

    /* E9F: log suspension (non-blocking) */
    logMembershipEvent({
      schoolId:        req.schoolId,
      memberId:        target._id,
      memberRef:       target.memberRef,
      memberName:      target.memberName,
      action:          'suspended',
      previousValue:   'active',
      newValue:        'suspended',
      reason:          reason,
      performedById:   req.communityMember._id,
      performedByName: req.communityMember.memberName,
      performedByType: req.communityMember.memberType
    });

    return res.json({ success: true, message: 'Member suspended' + (duration ? ' for ' + duration + ' day(s).' : ' indefinitely.'), suspendedUntil: until, suspendedReason: reason });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/community/admin/members/:id/unsuspend */
router.put('/admin/members/:id/unsuspend', communityProtect, communityModGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid member ID.' });
    }
    var member = await CommunityMembership.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId, status: 'suspended' },
      { $set: { status: 'active', suspendedUntil: null, suspendedReason: '', suspendedBy: null, updatedByName: req.communityMember.memberName } },
      { new: true }
    );
    if (!member) return res.status(404).json({ success: false, message: 'Suspended member not found.' });

    /* E9F: log unsuspension (non-blocking) */
    logMembershipEvent({
      schoolId:        req.schoolId,
      memberId:        member._id,
      memberRef:       member.memberRef,
      memberName:      member.memberName,
      action:          'unsuspended',
      previousValue:   'suspended',
      newValue:        'active',
      performedById:   req.communityMember._id,
      performedByName: req.communityMember.memberName,
      performedByType: req.communityMember.memberType
    });

    return res.json({ success: true, message: 'Suspension lifted.', status: 'active' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* DELETE /api/community/admin/members/:id (ban) */
router.delete('/admin/members/:id', communityProtect, communityAdminGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid member ID.' });
    }
    if (req.params.id === req.communityMember._id.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot ban yourself.' });
    }
    var reason = sanitizeText(req.body.reason || '').substring(0, 200);
    var member = await CommunityMembership.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: { status: 'banned', bannedAt: new Date(), bannedReason: reason, bannedBy: req.communityMember.memberRef, updatedByName: req.communityMember.memberName } },
      { new: true }
    );
    if (!member) return res.status(404).json({ success: false, message: 'Member not found.' });

    /* E9F: log ban (non-blocking) */
    logMembershipEvent({
      schoolId:        req.schoolId,
      memberId:        member._id,
      memberRef:       member.memberRef,
      memberName:      member.memberName,
      action:          'banned',
      previousValue:   member.status || 'active',
      newValue:        'banned',
      reason:          reason,
      performedById:   req.communityMember._id,
      performedByName: req.communityMember.memberName,
      performedByType: req.communityMember.memberType
    });

    return res.json({ success: true, message: 'Member banned.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   E9B: EVENT PICKER
============================================ */

/* GET /api/community/events */
router.get('/events', communityProtect, async function(req, res) {
  try {
    var SchoolEvent = require('../../institution/models/SchoolEvent.model');
    var sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    var events = await SchoolEvent.find({
      schoolId: req.schoolId,
      status:   'published',
      date:     { $gte: sevenDaysAgo }
    }).select('title date eventType location').sort({ date: 1 }).limit(30).lean();
    return res.json({ success: true, events });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   E9B: FEED ROUTES
============================================ */

/* GET /api/community/feed */
router.get('/feed', communityProtect, async function(req, res) {
  try {
    var cursor = req.query.cursor || null;
    var limit  = parseInt(req.query.limit) || feedService.FEED_LIMIT;
    var member = req.communityMember;
    var result = await feedService.getFeed(req.schoolId, member.memberType, member.role, cursor, limit);
    return res.json({ success: true, posts: result.posts, nextCursor: result.nextCursor, hasMore: result.hasMore });
  } catch(err) {
    console.error('[community] GET /feed:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/community/feed/pinned */
router.get('/feed/pinned', communityProtect, async function(req, res) {
  try {
    var member = req.communityMember;
    var pinned = await feedService.getPinnedPosts(req.schoolId, member.memberType, member.role);
    return res.json({ success: true, posts: pinned });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   E9B: POST CRUD
============================================ */

/* POST /api/community/posts */
router.post('/posts', communityProtect, communityWriteGuard, async function(req, res) {
  try {
    var member   = req.communityMember;
    var settings = await ensureSettings(req.schoolId);

    if (!settings.isEnabled) {
      return res.status(403).json({ success: false, message: 'Community is not enabled.' });
    }

    var memberType = member.memberType;
    if (memberType === 'student' && !settings.allowStudentPosts) {
      return res.status(403).json({ success: false, message: 'Student posting is currently disabled.' });
    }
    if (memberType === 'parent' && !settings.allowParentPosts) {
      return res.status(403).json({ success: false, message: 'Parent posting is currently disabled.' });
    }
    if (memberType === 'alumni' && !settings.allowAlumniPosts) {
      return res.status(403).json({ success: false, message: 'Alumni posting is currently disabled.' });
    }

    var content = sanitizeText(req.body.content || '');
    if (!content && (!req.body.mediaIds || !req.body.mediaIds.length)) {
      return res.status(400).json({ success: false, message: 'Post must have content or media.' });
    }

    var maxLen = settings.maxPostLength || 2000;
    if (content.length > maxLen) {
      return res.status(400).json({ success: false, message: 'Post exceeds maximum length of ' + maxLen + ' characters.' });
    }

    var postType = req.body.postType || 'post';
    if (!ALL_POST_TYPES.includes(postType)) {
      return res.status(400).json({ success: false, message: 'Invalid post type.' });
    }
    if (ANNOUNCEMENT_TYPES_STAFF_ONLY.includes(postType) && memberType !== 'staff' && memberType !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only staff and administrators can post announcements.' });
    }

    var visibility = req.body.visibility || 'all';
    var allowed    = getAllowedVisibilities(memberType, member.role);
    if (!allowed.includes(visibility)) {
      return res.status(400).json({ success: false, message: 'You cannot post with visibility "' + visibility + '".' });
    }

   /* ---- Event / Announcement reference ---- */
    var refType = null;
    var refId   = null;

    if (postType === 'event_ref') {
      if (!req.body.refId || !mongoose.isValidObjectId(req.body.refId)) {
        return res.status(400).json({ success: false, message: 'An event must be selected for this post type.' });
      }
      var SchoolEvent = require('../../institution/models/SchoolEvent.model');
      var event = await SchoolEvent.findOne({
        _id:      req.body.refId,
        schoolId: req.schoolId,
        status:   'published'
      }).select('_id').lean();
      if (!event) {
        return res.status(404).json({ success: false, message: 'Event not found or not published.' });
      }
      refType = 'event';
      refId   = event._id;
    }

    /* ---- E9E: Announcement reference (staff only) ---- */
    if (postType === 'announcement' && req.body.refId) {
      if (!mongoose.isValidObjectId(req.body.refId)) {
        return res.status(400).json({ success: false, message: 'Invalid announcement ID.' });
      }
      if (memberType !== 'staff' && memberType !== 'admin') {
        return res.status(403).json({ success: false, message: 'Only staff can reference official announcements.' });
      }
      var SchoolAnnouncement = require('../../institution/models/SchoolAnnouncement.model');
      var announcement = await SchoolAnnouncement.findOne({
        _id:      req.body.refId,
        schoolId: req.schoolId,    /* TENANT SCOPE */
        status:   'published'
      }).select('_id').lean();
      if (!announcement) {
        return res.status(404).json({ success: false, message: 'Announcement not found or not published.' });
      }
      refType = 'announcement';
      refId   = announcement._id;
    }

    /* ---- E9E: Activity metadata ---- */
    var activityMeta = null;
    var activityTypes = ['achievement', 'competition', 'award', 'reunion'];
    if (activityTypes.includes(postType) && req.body.activityMeta) {
      var rawMeta = req.body.activityMeta;
      /* Sanitize each string field — no HTML allowed */
      var metaFields = {};
      Object.keys(rawMeta).forEach(function(key) {
        if (typeof rawMeta[key] === 'string') {
          var clean = sanitizeText(rawMeta[key]).substring(0, 200);
          if (clean) metaFields[key] = clean;
        }
      });
      if (Object.keys(metaFields).length) activityMeta = metaFields;
    }

    /* ---- E9D: Media validation ---- */
    var mediaIds       = [];
    var mediaUrls      = [];
    var mediaMimeTypes = [];

    if (req.body.mediaIds && Array.isArray(req.body.mediaIds) && req.body.mediaIds.length > 0) {
      if (!settings.allowMediaUploads) {
        return res.status(403).json({ success: false, message: 'Media uploads are disabled for this community.' });
      }

      var maxMedia = settings.maxMediaPerPost || 4;
      if (req.body.mediaIds.length > maxMedia) {
        return res.status(400).json({
          success: false,
          message: 'Maximum ' + maxMedia + ' media items per post.'
        });
      }

      /* Validate all IDs are valid ObjectIds */
      var validIds = req.body.mediaIds.filter(function(id) {
        return mongoose.isValidObjectId(id);
      });
      if (validIds.length !== req.body.mediaIds.length) {
        return res.status(400).json({ success: false, message: 'Invalid media ID(s).' });
      }

      /* Verify each media belongs to this school AND this member — TENANT SCOPE + IDOR protection */
      var SchoolWebsiteMedia = require('../../institution/models/SchoolWebsiteMedia.model');
      var medias = await SchoolWebsiteMedia.find({
        _id:         { $in: validIds },
        schoolId:    req.schoolId,     /* TENANT SCOPE */
        usageContext:'community_post',
        uploadedBy:  member.memberRef  /* Must be uploader's own media */
      }).select('_id url thumbnailUrl mimeType').lean();

      if (medias.length !== validIds.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more media items were not found or do not belong to you.'
        });
      }

      /* Preserve the order the client sent */
      var mediaMap = {};
      medias.forEach(function(m) { mediaMap[m._id.toString()] = m; });
      validIds.forEach(function(id) {
        var m = mediaMap[id.toString()];
        if (m) {
          mediaIds.push(m._id);
          mediaUrls.push(m.url);
          mediaMimeTypes.push(m.mimeType);
        }
      });
    }

    var requiresApproval = settings.requirePostApproval && member.role === 'member';
    var initialStatus    = requiresApproval ? 'pending' : 'published';

    var post = await CommunityPost.create({
      schoolId:         req.schoolId,
      authorId:         member._id,
      authorType:       member.memberType,
      authorRef:        member.memberRef,
      authorName:       member.memberName   || 'Member',
      authorAvatar:     member.memberAvatar || '',
      content,
      postType,
      refType,
      refId,
      visibility,
      status:           initialStatus,
      requiresApproval: requiresApproval,
      mediaIds,
      mediaUrls,
      mediaMimeTypes,
      activityMeta      /* E9E */
    });

    return res.status(201).json({
      success: true,
      message: requiresApproval
        ? 'Post submitted and awaiting moderator approval.'
        : 'Post published.',
      post: {
        _id:             post._id,
        content:         post.content,
        postType:        post.postType,
        visibility:      post.visibility,
        status:          post.status,
        requiresApproval:post.requiresApproval,
        isPinned:        false,
        isLocked:        false,
        commentCount:    0,
        reactionCount:   0,
        authorName:      post.authorName,
        authorType:      post.authorType,
        authorId:        post.authorId,
        mediaUrls:       post.mediaUrls,
        mediaMimeTypes:  post.mediaMimeTypes,
        activityMeta:    post.activityMeta || null,
        refType:         post.refType,
        refId:           post.refId,
        createdAt:       post.createdAt
      }
    });
  } catch(err) {
    console.error('[community] POST /posts:', err.message);
    return res.status(500).json({ success: false, message: membershipService.safeErrorMsg(err) });
  }
});

/* GET /api/community/posts/:id */
router.get('/posts/:id', communityProtect, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    }
    var member     = req.communityMember;
    var isModAdmin = member.role === 'moderator' || member.role === 'admin';

    var post = await CommunityPost.findOne({ _id: req.params.id, schoolId: req.schoolId }).lean();
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });

    var isAuthor   = post.authorId && post.authorId.toString() === member._id.toString();
    var visibility = feedService.getVisibilityFor(member.memberType, member.role);

    if (post.status === 'removed'  && !isModAdmin) return res.status(404).json({ success: false, message: 'Post not found.' });
    if (post.status === 'archived' && !isAuthor && !isModAdmin) return res.status(404).json({ success: false, message: 'Post not found.' });
    if (post.status === 'pending'  && !isAuthor && !isModAdmin) return res.status(404).json({ success: false, message: 'Post not found.' });
    if (!visibility.includes(post.visibility) && !isModAdmin) return res.status(403).json({ success: false, message: 'You do not have permission to view this post.' });

    var enriched = await feedService.enrichEventRefs([post], req.schoolId);
    var result   = enriched[0] || post;
    if (!isModAdmin) delete result.moderationNote;

    return res.json({ success: true, post: result });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/community/posts/:id */
router.put('/posts/:id', communityProtect, communityWriteGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    }
    var member     = req.communityMember;
    var isModAdmin = member.role === 'moderator' || member.role === 'admin';

    var post = await CommunityPost.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });

    var isAuthor = post.authorId.toString() === member._id.toString();
    if (!isAuthor && !isModAdmin) return res.status(403).json({ success: false, message: 'You can only edit your own posts.' });
    if (post.status === 'removed' || post.status === 'archived') return res.status(400).json({ success: false, message: 'This post cannot be edited.' });

    var settings = await ensureSettings(req.schoolId);
    var content  = sanitizeText(req.body.content || '');
    if (!content) return res.status(400).json({ success: false, message: 'Post content cannot be empty.' });
    if (content.length > (settings.maxPostLength || 2000)) return res.status(400).json({ success: false, message: 'Post too long.' });

    post.content = content;
    await post.save();

    return res.json({ success: true, message: 'Post updated.', content: post.content });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* DELETE /api/community/posts/:id (own post soft-delete) */
router.delete('/posts/:id', communityProtect, communityWriteGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    }
    var member = req.communityMember;
    var post   = await CommunityPost.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    if (post.authorId.toString() !== member._id.toString()) return res.status(403).json({ success: false, message: 'You can only delete your own posts.' });
    if (post.status === 'removed' || post.status === 'archived') return res.status(400).json({ success: false, message: 'Post is already deleted.' });

    post.status        = 'archived';
    post.deletedAt     = new Date();
    post.deletedBy     = member._id;
    post.deletedReason = sanitizeText(req.body.reason || 'Deleted by author');
    await post.save();

    return res.json({ success: true, message: 'Post deleted.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   E9B: ADMIN / MODERATION POST ROUTES
============================================ */

/* GET /api/community/admin/posts/pending */
router.get('/admin/posts/pending', communityProtect, communityModGuard, async function(req, res) {
  try {
    var cursor = req.query.cursor || null;
    var result = await feedService.getPendingPosts(req.schoolId, cursor, 20);
    var count  = await feedService.getPendingCount(req.schoolId);
    return res.json({ success: true, posts: result.posts, nextCursor: result.nextCursor, hasMore: result.hasMore, totalPending: count });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/community/admin/posts/:id/approve */
router.post('/admin/posts/:id/approve', communityProtect, communityModGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    var post = await CommunityPost.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId, status: 'pending' },
      { $set: { status: 'published', approvedAt: new Date(), approvedBy: req.communityMember._id } },
      { new: true }
    );
    if (!post) return res.status(404).json({ success: false, message: 'Pending post not found.' });
    return res.json({ success: true, message: 'Post approved and published.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/community/admin/posts/:id/reject */
router.post('/admin/posts/:id/reject', communityProtect, communityModGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    var reason = sanitizeText(req.body.reason || 'Did not meet community guidelines');
    var post   = await CommunityPost.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId, status: 'pending' },
      { $set: { status: 'removed', moderationNote: reason, deletedAt: new Date(), deletedBy: req.communityMember._id, deletedReason: reason } },
      { new: true }
    );
    if (!post) return res.status(404).json({ success: false, message: 'Pending post not found.' });
    return res.json({ success: true, message: 'Post rejected.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/community/admin/posts/:id/pin */
router.post('/admin/posts/:id/pin', communityProtect, communityModGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    var pinnedCount = await CommunityPost.countDocuments({ schoolId: req.schoolId, isPinned: true, status: 'published' });
    if (pinnedCount >= feedService.MAX_PINNED) {
      return res.status(400).json({ success: false, message: 'Maximum ' + feedService.MAX_PINNED + ' posts can be pinned. Unpin one first.' });
    }
    var post = await CommunityPost.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId, status: 'published' },
      { $set: { isPinned: true, pinnedAt: new Date(), pinnedBy: req.communityMember._id } },
      { new: true }
    );
    if (!post) return res.status(404).json({ success: false, message: 'Published post not found.' });
    return res.json({ success: true, message: 'Post pinned.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/community/admin/posts/:id/unpin */
router.post('/admin/posts/:id/unpin', communityProtect, communityModGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    var post = await CommunityPost.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId, isPinned: true },
      { $set: { isPinned: false, pinnedAt: null, pinnedBy: null } },
      { new: true }
    );
    if (!post) return res.status(404).json({ success: false, message: 'Pinned post not found.' });
    return res.json({ success: true, message: 'Post unpinned.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/community/admin/posts/:id/lock */
router.post('/admin/posts/:id/lock', communityProtect, communityModGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    var post = await CommunityPost.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: { isLocked: true, lockedAt: new Date(), lockedBy: req.communityMember._id } },
      { new: true }
    );
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    return res.json({ success: true, message: 'Discussion locked.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/community/admin/posts/:id/unlock */
router.post('/admin/posts/:id/unlock', communityProtect, communityModGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    var post = await CommunityPost.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId, isLocked: true },
      { $set: { isLocked: false, lockedAt: null, lockedBy: null } },
      { new: true }
    );
    if (!post) return res.status(404).json({ success: false, message: 'Locked post not found.' });
    return res.json({ success: true, message: 'Discussion unlocked.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* DELETE /api/community/admin/posts/:id (moderation removal) */
router.delete('/admin/posts/:id', communityProtect, communityModGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    var reason = sanitizeText(req.body.reason || 'Removed by moderator');
    var post   = await CommunityPost.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId, status: { $ne: 'removed' } },
      { $set: { status: 'removed', moderationNote: reason, deletedAt: new Date(), deletedBy: req.communityMember._id, deletedReason: reason } },
      { new: true }
    );
    if (!post) return res.status(404).json({ success: false, message: 'Post not found or already removed.' });
    return res.json({ success: true, message: 'Post removed.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});
/* ============================================
   E9C: COMMENT AND REACTION ROUTES
   All queries: TENANT SCOPED to req.schoolId.
   authorId: ALWAYS from req.communityMember.
   Locked posts: server rejects new comments.
   Suspended members: communityWriteGuard blocks writes.
============================================ */

var CommunityComment = require('../models/CommunityComment.model');
var CommunityReaction= require('../models/CommunityReaction.model');
var commentService   = require('../services/community.comment.service');

var VALID_REACTIONS = ['like', 'love', 'celebrate', 'support', 'insightful'];

/* ============================================
   GET /api/community/posts/:id/comments
   Paginated comment thread with nested replies.
   cursor = _id of last top-level comment seen.
============================================ */
router.get('/posts/:id/comments', communityProtect, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    }

    /* Verify post exists and is visible — TENANT SCOPE */
    var post = await CommunityPost.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId,
      status:   'published'
    }).select('_id isLocked commentCount').lean();

    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }

    var cursor = req.query.cursor || null;
    var limit  = parseInt(req.query.limit) || commentService.COMMENT_PAGE;

    var result = await commentService.getCommentThread(
      req.schoolId,
      post._id,
      cursor,
      limit
    );

    return res.json({
      success:      true,
      comments:     result.comments,
      nextCursor:   result.nextCursor,
      hasMore:      result.hasMore,
      totalComments:post.commentCount || 0,
      isLocked:     post.isLocked
    });
  } catch(err) {
    console.error('[community] GET /posts/:id/comments:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /api/community/posts/:id/comments
   Create a top-level comment on a post.
   Rejects if: post locked, post not published,
   post not in same school, member suspended.
============================================ */
router.post('/posts/:id/comments', communityProtect, communityWriteGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    }

    var member   = req.communityMember;
    var settings = await ensureSettings(req.schoolId);

    /* Verify post — TENANT SCOPE */
    var post = await CommunityPost.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId,
      status:   'published'
    }).select('_id isLocked visibility').lean();

    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }

    /* ✅ Locked discussion: server enforces this — not just frontend */
    if (post.isLocked) {
      return res.status(403).json({
        success: false,
        message: 'This discussion is locked. No new comments are being accepted.',
        isLocked: true
      });
    }

    /* Validate content */
    var content = sanitizeText(req.body.content || '');
    if (!content) {
      return res.status(400).json({ success: false, message: 'Comment cannot be empty.' });
    }
    var maxLen = settings.maxCommentLength || 500;
    if (content.length > maxLen) {
      return res.status(400).json({
        success: false,
        message: 'Comment exceeds maximum length of ' + maxLen + ' characters.'
      });
    }

    var comment = await CommunityComment.create({
      schoolId:     req.schoolId,
      postId:       post._id,
      parentId:     null,
      authorId:     member._id,
      authorType:   member.memberType,
      authorRef:    member.memberRef,
      authorName:   member.memberName   || 'Member',
      authorAvatar: member.memberAvatar || '',
      content,
      status: 'published'
    });

    /* Atomic counter increment — non-blocking */
    commentService.incrementPostCommentCount(post._id, req.schoolId, 1)
      .catch(function(e) { console.warn('[community] commentCount inc failed:', e.message); });

    return res.status(201).json({
      success: true,
      message: 'Comment added.',
      comment: {
        _id:          comment._id,
        postId:       comment.postId,
        parentId:     null,
        authorName:   comment.authorName,
        authorType:   comment.authorType,
        authorAvatar: comment.authorAvatar,
        content:      comment.content,
        status:       comment.status,
        reactionCount:0,
        replyCount:   0,
        replies:      [],
        createdAt:    comment.createdAt
      }
    });
  } catch(err) {
    console.error('[community] POST /posts/:id/comments:', err.message);
    return res.status(500).json({ success: false, message: membershipService.safeErrorMsg(err) });
  }
});

/* ============================================
   POST /api/community/posts/:postId/comments/:commentId/replies
   Create a reply to a top-level comment.
   Replies to replies are NOT supported (depth = 1 max).
   If someone replies to a reply, it is flattened
   to the same parent comment thread.
============================================ */
router.post(
  '/posts/:postId/comments/:commentId/replies',
  communityProtect,
  communityWriteGuard,
  async function(req, res) {
    try {
      if (!mongoose.isValidObjectId(req.params.postId) ||
          !mongoose.isValidObjectId(req.params.commentId)) {
        return res.status(400).json({ success: false, message: 'Invalid ID.' });
      }

      var member   = req.communityMember;
      var settings = await ensureSettings(req.schoolId);

      /* Verify post is published and not locked — TENANT SCOPE */
      var post = await CommunityPost.findOne({
        _id:      req.params.postId,
        schoolId: req.schoolId,
        status:   'published'
      }).select('_id isLocked').lean();
      if (!post) {
        return res.status(404).json({ success: false, message: 'Post not found.' });
      }
      if (post.isLocked) {
        return res.status(403).json({
          success:  false,
          message:  'This discussion is locked.',
          isLocked: true
        });
      }

      /* Verify parent comment exists in same school/post — TENANT SCOPE */
      var parentComment = await CommunityComment.findOne({
        _id:      req.params.commentId,
        schoolId: req.schoolId,
        postId:   post._id,
        status:   'published'
      }).select('_id parentId').lean();
      if (!parentComment) {
        return res.status(404).json({ success: false, message: 'Comment not found.' });
      }

      /* Flatten depth: if parent is itself a reply, use its parent instead */
      var effectiveParentId = parentComment.parentId
        ? parentComment.parentId
        : parentComment._id;

      /* Validate content */
      var content = sanitizeText(req.body.content || '');
      if (!content) {
        return res.status(400).json({ success: false, message: 'Reply cannot be empty.' });
      }
      var maxLen = settings.maxCommentLength || 500;
      if (content.length > maxLen) {
        return res.status(400).json({
          success: false,
          message: 'Reply exceeds maximum length of ' + maxLen + ' characters.'
        });
      }

      var reply = await CommunityComment.create({
        schoolId:     req.schoolId,
        postId:       post._id,
        parentId:     effectiveParentId,
        authorId:     member._id,
        authorType:   member.memberType,
        authorRef:    member.memberRef,
        authorName:   member.memberName   || 'Member',
        authorAvatar: member.memberAvatar || '',
        content,
        status: 'published'
      });

      /* Increment post comment count and parent reply count atomically */
      Promise.all([
        commentService.incrementPostCommentCount(post._id, req.schoolId, 1),
        commentService.incrementCommentReplyCount(effectiveParentId, req.schoolId, 1)
      ]).catch(function(e) { console.warn('[community] reply counter inc failed:', e.message); });

      return res.status(201).json({
        success:  true,
        message:  'Reply added.',
        comment: {
          _id:          reply._id,
          postId:       reply.postId,
          parentId:     reply.parentId,
          authorName:   reply.authorName,
          authorType:   reply.authorType,
          authorAvatar: reply.authorAvatar,
          content:      reply.content,
          status:       reply.status,
          reactionCount:0,
          createdAt:    reply.createdAt
        }
      });
    } catch(err) {
      console.error('[community] POST /comments/:id/replies:', err.message);
      return res.status(500).json({ success: false, message: membershipService.safeErrorMsg(err) });
    }
  }
);

/* ============================================
   PUT /api/community/comments/:id
   Edit own comment content.
   Mod/admin can also edit any comment.
============================================ */
router.put('/comments/:id', communityProtect, communityWriteGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid comment ID.' });
    }

    var member     = req.communityMember;
    var isModAdmin = member.role === 'moderator' || member.role === 'admin';

    var comment = await CommunityComment.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId  /* TENANT SCOPE */
    });
    if (!comment) {
      return res.status(404).json({ success: false, message: 'Comment not found.' });
    }

    var isAuthor = comment.authorId.toString() === member._id.toString();
    if (!isAuthor && !isModAdmin) {
      return res.status(403).json({ success: false, message: 'You can only edit your own comments.' });
    }
    if (comment.status === 'removed' || comment.status === 'archived') {
      return res.status(400).json({ success: false, message: 'This comment cannot be edited.' });
    }

    var settings = await ensureSettings(req.schoolId);
    var content  = sanitizeText(req.body.content || '');
    if (!content) {
      return res.status(400).json({ success: false, message: 'Comment cannot be empty.' });
    }
    if (content.length > (settings.maxCommentLength || 500)) {
      return res.status(400).json({ success: false, message: 'Comment too long.' });
    }

    comment.content = content;
    await comment.save();

    return res.json({ success: true, message: 'Comment updated.', content: comment.content });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   DELETE /api/community/comments/:id
   Soft-delete own comment (status → 'archived').
   Adjusts post commentCount and parent replyCount.
============================================ */
router.delete('/comments/:id', communityProtect, communityWriteGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid comment ID.' });
    }

    var member  = req.communityMember;
    var comment = await CommunityComment.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId  /* TENANT SCOPE */
    });
    if (!comment) {
      return res.status(404).json({ success: false, message: 'Comment not found.' });
    }
    if (comment.authorId.toString() !== member._id.toString()) {
      return res.status(403).json({ success: false, message: 'You can only delete your own comments.' });
    }
    if (comment.status === 'removed' || comment.status === 'archived') {
      return res.status(400).json({ success: false, message: 'Comment is already deleted.' });
    }

    comment.status        = 'archived';
    comment.deletedAt     = new Date();
    comment.deletedBy     = member._id;
    comment.deletedReason = sanitizeText(req.body.reason || 'Deleted by author');
    await comment.save();

    /* Decrement counters atomically */
    var decrements = [
      commentService.incrementPostCommentCount(comment.postId, req.schoolId, -1)
    ];
    if (comment.parentId) {
      decrements.push(commentService.incrementCommentReplyCount(comment.parentId, req.schoolId, -1));
    }
    Promise.all(decrements).catch(function(e) {
      console.warn('[community] comment delete counter dec failed:', e.message);
    });

    return res.json({ success: true, message: 'Comment deleted.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ADMIN COMMENT MODERATION ROUTES
============================================ */

/* DELETE /api/community/admin/comments/:id (moderator removal) */
router.delete('/admin/comments/:id', communityProtect, communityModGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid comment ID.' });
    }

    var reason  = sanitizeText(req.body.reason || 'Removed by moderator');
    var comment = await CommunityComment.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId, status: { $ne: 'removed' } }, /* TENANT SCOPE */
      { $set: {
          status:         'removed',
          moderationNote: reason,
          deletedAt:      new Date(),
          deletedBy:      req.communityMember._id,
          deletedReason:  reason
        }},
      { new: true }
    );
    if (!comment) {
      return res.status(404).json({ success: false, message: 'Comment not found or already removed.' });
    }

    /* Decrement counters */
    var decrements = [
      commentService.incrementPostCommentCount(comment.postId, req.schoolId, -1)
    ];
    if (comment.parentId) {
      decrements.push(commentService.incrementCommentReplyCount(comment.parentId, req.schoolId, -1));
    }
    Promise.all(decrements).catch(function(e) {
      console.warn('[community] mod comment removal counter failed:', e.message);
    });

    return res.json({ success: true, message: 'Comment removed.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   REACTIONS
   POST   /api/community/posts/:id/react
   POST   /api/community/comments/:id/react
   DELETE /api/community/posts/:id/react
   DELETE /api/community/comments/:id/react
   GET    /api/community/posts/:id/reactions
   GET    /api/community/comments/:id/reactions
============================================ */

/* ---- Internal: toggle reaction helper ---- */
async function handleReaction(req, res, targetType, targetId) {
  var member   = req.communityMember;
  var reaction = req.body.reaction || 'like';

  if (!VALID_REACTIONS.includes(reaction)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid reaction. Must be one of: ' + VALID_REACTIONS.join(', ')
    });
  }

  /* Verify target belongs to this school — TENANT SCOPE */
  var target;
  if (targetType === 'post') {
    target = await CommunityPost.findOne({
      _id:      targetId,
      schoolId: req.schoolId,
      status:   'published'
    }).select('_id').lean();
  } else {
    target = await CommunityComment.findOne({
      _id:      targetId,
      schoolId: req.schoolId,
      status:   'published'
    }).select('_id').lean();
  }
  if (!target) {
    return res.status(404).json({ success: false, message: (targetType === 'post' ? 'Post' : 'Comment') + ' not found.' });
  }

  /* Check for existing reaction by this member on this target */
  var existing = await CommunityReaction.findOne({
    schoolId:   req.schoolId,
    targetType: targetType,
    targetId:   targetId,
    authorId:   member._id
  }).lean();

  if (existing) {
    if (existing.reaction === reaction) {
      /* Same reaction again — remove it (toggle off) */
      await CommunityReaction.deleteOne({ _id: existing._id });

      /* Decrement counter */
      if (targetType === 'post') {
        CommunityPost.findOneAndUpdate(
          { _id: targetId, schoolId: req.schoolId },
          { $inc: { reactionCount: -1 } }
        ).catch(function() {});
      } else {
        CommunityComment.findOneAndUpdate(
          { _id: targetId, schoolId: req.schoolId },
          { $inc: { reactionCount: -1 } }
        ).catch(function() {});
      }

      return res.json({ success: true, action: 'removed', reaction: null, targetId });
    } else {
      /* Different reaction — update (no counter change, just reaction type) */
      await CommunityReaction.findByIdAndUpdate(existing._id, { $set: { reaction } });
      return res.json({ success: true, action: 'updated', reaction, targetId });
    }
  }

  /* New reaction — upsert safety: unique index prevents true duplicates */
  try {
    await CommunityReaction.create({
      schoolId:   req.schoolId,
      targetType: targetType,
      targetId:   targetId,
      authorId:   member._id,
      authorType: member.memberType,
      authorName: member.memberName || '',
      reaction
    });
  } catch(dupErr) {
    if (dupErr.code === 11000) {
      /* Duplicate key — race condition handled gracefully */
      return res.json({ success: true, action: 'exists', reaction, targetId });
    }
    throw dupErr;
  }

  /* Increment counter */
  if (targetType === 'post') {
    CommunityPost.findOneAndUpdate(
      { _id: targetId, schoolId: req.schoolId },
      { $inc: { reactionCount: 1 } }
    ).catch(function() {});
  } else {
    CommunityComment.findOneAndUpdate(
      { _id: targetId, schoolId: req.schoolId },
      { $inc: { reactionCount: 1 } }
    ).catch(function() {});
  }

  return res.status(201).json({ success: true, action: 'added', reaction, targetId });
}

/* ---- Internal: get reaction summary helper ---- */
async function getReactionSummary(req, res, targetType, targetId) {
  if (!mongoose.isValidObjectId(targetId)) {
    return res.status(400).json({ success: false, message: 'Invalid ID.' });
  }

  var reactions = await CommunityReaction.find({
    schoolId:   req.schoolId,  /* TENANT SCOPE */
    targetType: targetType,
    targetId:   targetId
  }).select('reaction authorName authorType').lean();

  /* Group by reaction type */
  var summary = {};
  VALID_REACTIONS.forEach(function(r) { summary[r] = 0; });
  reactions.forEach(function(r) {
    if (summary[r.reaction] !== undefined) summary[r.reaction]++;
  });

  /* Find own reaction */
  var myReaction = reactions.find(function(r) {
    return req.communityMember &&
           r.authorId && /* not on CommunityReaction but we can check the query */
           reactions.some(function(rx) { return rx.authorName === req.communityMember.memberName; });
  });

  /* More reliable own-reaction lookup */
  var ownReaction = await CommunityReaction.findOne({
    schoolId:   req.schoolId,
    targetType: targetType,
    targetId:   targetId,
    authorId:   req.communityMember._id
  }).select('reaction').lean();

  return res.json({
    success:    true,
    total:      reactions.length,
    summary,
    myReaction: ownReaction ? ownReaction.reaction : null
  });
}

/* POST /api/community/posts/:id/react */
router.post('/posts/:id/react', communityProtect, communityWriteGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    }
    return await handleReaction(req, res, 'post', req.params.id);
  } catch(err) {
    console.error('[community] POST /posts/:id/react:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/community/comments/:id/react */
router.post('/comments/:id/react', communityProtect, communityWriteGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid comment ID.' });
    }
    return await handleReaction(req, res, 'comment', req.params.id);
  } catch(err) {
    console.error('[community] POST /comments/:id/react:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/community/posts/:id/reactions */
router.get('/posts/:id/reactions', communityProtect, async function(req, res) {
  try {
    return await getReactionSummary(req, res, 'post', req.params.id);
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/community/comments/:id/reactions */
router.get('/comments/:id/reactions', communityProtect, async function(req, res) {
  try {
    return await getReactionSummary(req, res, 'comment', req.params.id);
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});
/* ============================================
   E9D: COMMUNITY MEDIA ROUTES
   All queries: TENANT SCOPED to req.schoolId.
   uploadedBy: ALWAYS from req.communityMember.memberRef.
   IDOR: every fetch/delete includes { schoolId, usageContext }.
============================================ */

/* POST /api/community/media/upload */
router.post(
  '/media/upload',
  communityProtect,
  communityWriteGuard,
  mediaUpload.single('file'),
  async function(req, res) {
    try {
      var member   = req.communityMember;
      var settings = await ensureSettings(req.schoolId);

      if (!settings.isEnabled) {
        return res.status(403).json({ success: false, message: 'Community is not enabled.' });
      }
      if (!settings.allowMediaUploads) {
        return res.status(403).json({
          success: false,
          message: 'Media uploads have been disabled by the administrator.'
        });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file provided.' });
      }

      var result = await communityMediaSvc.uploadCommunityMedia(req.file, {
        schoolId:   req.schoolId,
        memberId:   member._id,
        memberType: member.memberType,
        memberRef:  member.memberRef
      });

      return res.status(201).json({ success: true, media: result });
    } catch(err) {
      console.error('[community] POST /media/upload:', err.message);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File too large. Maximum 5MB for images, 50MB for videos.'
        });
      }
      return res.status(400).json({ success: false, message: err.message || 'Upload failed.' });
    }
  }
);

/* GET /api/community/media — own uploaded media */
router.get('/media', communityProtect, async function(req, res) {
  try {
    var member = req.communityMember;
    var result = await communityMediaSvc.getCommunityMedia(
      req.schoolId,
      member.memberRef,
      parseInt(req.query.page)  || 1,
      parseInt(req.query.limit) || 20
    );
    return res.json({ success: true, ...result });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* DELETE /api/community/media/:id — delete own uploaded media */
router.delete('/media/:id', communityProtect, communityWriteGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid media ID.' });
    }
    await communityMediaSvc.deleteCommunityMedia(
      req.params.id,
      req.schoolId,
      req.communityMember.memberRef
    );
    return res.json({ success: true, message: 'Media deleted.' });
  } catch(err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});
/* ============================================
   E9E: OFFICIAL ANNOUNCEMENTS ROUTES
   SchoolAnnouncement is read-only from community.
   Never modified through these routes.
   schoolId: ALWAYS from req.schoolId (JWT token).
============================================ */

/* GET /api/community/feed/official
   Returns recent published SchoolAnnouncements visible
   to the requesting member. Read-only display in community.
   NOT stored as CommunityPosts — referenced only.
*/
router.get('/feed/official', communityProtect, async function(req, res) {
  try {
    var member = req.communityMember;
    var limit  = parseInt(req.query.limit) || 5;

    var announcements = await feedService.getOfficialAnnouncements(
      req.schoolId,
      member.memberType,
      member.role,
      limit
    );

    return res.json({ success: true, announcements });
  } catch(err) {
    console.error('[community] GET /feed/official:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/community/announcements
   Announcement picker for staff/admin creating a reference post.
   Returns recent published SchoolAnnouncements for this school.
   Staff only — regular members cannot see the picker list.
*/
router.get('/announcements', communityProtect, async function(req, res) {
  try {
    var member = req.communityMember;

    /* Only staff/admin can use the announcement picker */
    if (member.memberType !== 'staff' && member.memberType !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only staff and administrators can reference official announcements.'
      });
    }

    var SchoolAnnouncement = require('../../institution/models/SchoolAnnouncement.model');
    var fourteenDaysAgo    = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    var announcements = await SchoolAnnouncement.find({
      schoolId: req.schoolId,   /* TENANT SCOPE */
      status:   'published',
      createdAt:{ $gte: fourteenDaysAgo }
    })
    .select('title targetAudience priority publishedAt createdAt')
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

    return res.json({ success: true, announcements });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   E9F: ROLE & MEMBERSHIP MANAGEMENT ROUTES
============================================ */

/* ============================================
   GET /api/community/admin/stats
   Community statistics for mod/admin dashboard.
   All queries TENANT SCOPED to req.schoolId.
============================================ */
router.get('/admin/stats', communityProtect, communityModGuard, async function(req, res) {
  try {
    var schoolId    = req.schoolId;
    var sevenDaysAgo= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    /* Run all counts in parallel — no sequential blocking */
    var [
      totalMembers,
      activeMembers,
      suspendedMembers,
      bannedMembers,
      membersByType,
      publishedPosts,
      pendingPosts,
      removedPosts,
      newMembersWeek,
      postsWeek,
      commentsWeek
    ] = await Promise.all([
      CommunityMembership.countDocuments({ schoolId }),
      CommunityMembership.countDocuments({ schoolId, status: 'active' }),
      CommunityMembership.countDocuments({ schoolId, status: 'suspended' }),
      CommunityMembership.countDocuments({ schoolId, status: 'banned' }),
      CommunityMembership.aggregate([
        { $match: { schoolId: schoolId } },
        { $group: { _id: '$memberType', count: { $sum: 1 } } }
      ]),
      CommunityPost.countDocuments({ schoolId, status: 'published' }),
      CommunityPost.countDocuments({ schoolId, status: 'pending' }),
      CommunityPost.countDocuments({ schoolId, status: 'removed' }),
      CommunityMembership.countDocuments({ schoolId, joinedAt: { $gte: sevenDaysAgo } }),
      CommunityPost.countDocuments({ schoolId, status: 'published', createdAt: { $gte: sevenDaysAgo } }),
      CommunityComment.countDocuments({ schoolId, status: 'published', createdAt: { $gte: sevenDaysAgo } })
    ]);

    /* Shape membersByType into a map */
    var byType = {};
    membersByType.forEach(function(row) { byType[row._id] = row.count; });

    return res.json({
      success: true,
      stats: {
        members: {
          total:     totalMembers,
          active:    activeMembers,
          suspended: suspendedMembers,
          banned:    bannedMembers,
          byType:    byType
        },
        posts: {
          published: publishedPosts,
          pending:   pendingPosts,
          removed:   removedPosts
        },
        recentActivity: {
          newMembersThisWeek:  newMembersWeek,
          postsThisWeek:       postsWeek,
          commentsThisWeek:    commentsWeek
        }
      }
    });
  } catch(err) {
    console.error('[community] GET /admin/stats:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/community/admin/moderators
   List members with moderator or admin role.
   Used by moderator management panel in settings.
============================================ */
router.get('/admin/moderators', communityProtect, communityModGuard, async function(req, res) {
  try {
    var moderators = await CommunityMembership.find({
      schoolId: req.schoolId,          /* TENANT SCOPE */
      role:     { $in: ['moderator', 'admin'] },
      status:   { $ne: 'banned' }
    })
    .select('memberName memberAvatar memberType role status joinedAt lastActiveAt')
    .sort({ role: 1, joinedAt: 1 })
    .lean();

    return res.json({ success: true, moderators });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/community/admin/members/:id/profile
   Single member detail with recent membership log.
   schoolId scope prevents cross-school lookup.
============================================ */
router.get('/admin/members/:id/profile', communityProtect, communityModGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid member ID.' });
    }

    /* Lookup member — TENANT SCOPE */
    var member = await CommunityMembership.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId
    }).lean();
    if (!member) {
      return res.status(404).json({ success: false, message: 'Member not found.' });
    }

    /* Parallel: post count + recent log */
    var [postCount, recentLog] = await Promise.all([
      CommunityPost.countDocuments({
        schoolId: req.schoolId,  /* TENANT SCOPE */
        authorId: member._id,
        status:   { $nin: ['removed'] }
      }),
      CommunityMembershipLog.find({
        schoolId: req.schoolId,  /* TENANT SCOPE */
        memberId: member._id
      })
      .select('action previousValue newValue reason performedByName createdAt')
      .sort({ createdAt: -1 })
      .limit(15)
      .lean()
    ]);

    return res.json({
      success: true,
      member: {
        _id:             member._id,
        memberName:      member.memberName,
        memberAvatar:    member.memberAvatar,
        memberType:      member.memberType,
        role:            member.role,
        status:          member.status,
        suspendedUntil:  member.suspendedUntil  || null,
        suspendedReason: member.suspendedReason || '',
        bannedReason:    member.bannedReason    || '',
        joinedAt:        member.joinedAt,
        lastActiveAt:    member.lastActiveAt    || null,
        postCount:       postCount
      },
      recentLog: recentLog
    });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /api/community/leave
   Member voluntarily leaves the community.
   Sets status to 'left'. Soft change — record kept.
   Member must rejoin from their portal to return.
============================================ */
router.post('/leave', communityProtect, async function(req, res) {
  try {
    var member = req.communityMember;

    /* Admins cannot use self-leave to exit their own community */
    if (member.role === 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Community administrators cannot leave. Transfer admin role to another member first, or contact a platform administrator.'
      });
    }

    await CommunityMembership.findByIdAndUpdate(member._id, {
      $set: { status: 'left', updatedByName: member.memberName }
    });

    /* E9F: log self-exit (non-blocking) */
    logMembershipEvent({
      schoolId:        req.schoolId,
      memberId:        member._id,
      memberRef:       member.memberRef,
      memberName:      member.memberName,
      action:          'left',
      previousValue:   member.status,
      newValue:        'left',
      performedById:   null,
      performedByName: member.memberName + ' (self)',
      performedByType: member.memberType
    });

    return res.json({
      success: true,
      message: 'You have left the community. You can rejoin from your portal.'
    });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/community/admin/log
   School-wide membership event log.
   Paginated, newest first. Mod/admin only.
============================================ */
router.get('/admin/log', communityProtect, communityModGuard, async function(req, res) {
  try {
    var page  = Math.max(1, parseInt(req.query.page)   || 1);
    var limit = Math.min(50, parseInt(req.query.limit) || 30);
    var skip  = (page - 1) * limit;
    var filter= { schoolId: req.schoolId };  /* TENANT SCOPE */

    if (req.query.action)   filter.action   = req.query.action;
    if (req.query.memberId && mongoose.isValidObjectId(req.query.memberId)) {
      filter.memberId = req.query.memberId;
    }

    var [events, total] = await Promise.all([
      CommunityMembershipLog.find(filter)
        .select('action previousValue newValue reason memberName performedByName performedByType createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CommunityMembershipLog.countDocuments(filter)
    ]);

    return res.json({
      success: true,
      events,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});
module.exports = router;