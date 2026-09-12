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
var CommunitySettings   = require('../models/CommunitySettings.model');
var CommunityPost       = require('../models/CommunityPost.model');
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
    var member = await CommunityMembership.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: { role: req.body.role, updatedBy: req.communityMember.memberRef, updatedByName: req.communityMember.memberName } },
      { new: true }
    );
    if (!member) return res.status(404).json({ success: false, message: 'Member not found.' });
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
    if (!content) {
      return res.status(400).json({ success: false, message: 'Post content cannot be empty.' });
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

    var refType = null;
    var refId   = null;
    if (postType === 'event_ref') {
      if (!req.body.refId || !mongoose.isValidObjectId(req.body.refId)) {
        return res.status(400).json({ success: false, message: 'An event must be selected for this post type.' });
      }
      var SchoolEvent = require('../../institution/models/SchoolEvent.model');
      var event = await SchoolEvent.findOne({ _id: req.body.refId, schoolId: req.schoolId, status: 'published' }).select('_id').lean();
      if (!event) {
        return res.status(404).json({ success: false, message: 'Event not found or not published.' });
      }
      refType = 'event';
      refId   = event._id;
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
      requiresApproval: requiresApproval
    });

    return res.status(201).json({
      success: true,
      message: requiresApproval ? 'Post submitted and awaiting moderator approval.' : 'Post published.',
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

module.exports = router;