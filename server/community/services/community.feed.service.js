'use strict';
/* ============================================
   LATLOMP COMMUNITY — FEED SERVICE (E9B)

   getFeed:        cursor-based chronological feed
   getPinnedPosts: pinned posts (up to MAX_PINNED)
   getPendingPosts:approval queue for mod/admin
   enrichEventRefs:batch-load event data (no N+1)
   getVisibilityFor:member type → allowed visibility

   schoolId ALWAYS from authenticated context.
   All queries TENANT SCOPED.
============================================ */
'use strict';

var mongoose      = require('mongoose');
var CommunityPost = require('../models/CommunityPost.model');

var FEED_LIMIT = 20;
var MAX_PINNED = 5;

/* ============================================
   getVisibilityFor(memberType, memberRole)
   Returns array of visibility values this member can see.
   Moderators and admins see all visibility levels.
============================================ */
function getVisibilityFor(memberType, memberRole) {
  if (memberRole === 'admin' || memberRole === 'moderator') {
    return ['all', 'students', 'parents', 'staff', 'alumni'];
  }
  switch (memberType) {
    case 'admin':
    case 'staff':
      return ['all', 'students', 'parents', 'staff', 'alumni'];
    case 'student':
      return ['all', 'students'];
    case 'parent':
      return ['all', 'parents'];
    case 'alumni':
      return ['all', 'alumni'];
    default:
      return ['all'];
  }
}

/* ============================================
   getFeed
   Cursor-based. Fetches FEED_LIMIT+1 to determine hasMore.
   cursor = _id of last post seen (ObjectId string)
   isPinned: false — pinned fetched separately.
============================================ */
async function getFeed(schoolId, memberType, memberRole, cursor, limit) {
  var pageLimit  = Math.min(limit || FEED_LIMIT, 50);
  var visibility = getVisibilityFor(memberType, memberRole);

  var filter = {
    schoolId:   schoolId,  /* TENANT SCOPE */
    status:     'published',
    visibility: { $in: visibility },
    isPinned:   false
  };

  if (cursor && mongoose.isValidObjectId(cursor)) {
    filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
  }

  var posts = await CommunityPost.find(filter)
    .sort({ createdAt: -1 })
    .limit(pageLimit + 1)
    .lean();

  var hasMore    = posts.length > pageLimit;
  if (hasMore)   posts = posts.slice(0, pageLimit);
  var nextCursor = (hasMore && posts.length)
    ? posts[posts.length - 1]._id.toString()
    : null;

  posts = await enrichEventRefs(posts, schoolId);
  posts = await enrichAnnouncementRefs(posts, schoolId);

  return { posts, nextCursor, hasMore };
}

/* ============================================
   getPinnedPosts
   Returns up to MAX_PINNED published pinned posts.
   Sorted by pinnedAt desc so most recently pinned first.
============================================ */
async function getPinnedPosts(schoolId, memberType, memberRole) {
  var visibility = getVisibilityFor(memberType, memberRole);

  var pinned = await CommunityPost.find({
    schoolId:   schoolId,  /* TENANT SCOPE */
    status:     'published',
    isPinned:   true,
    visibility: { $in: visibility }
  })
  .sort({ pinnedAt: -1 })
  .limit(MAX_PINNED)
  .lean();

  pinned = await enrichEventRefs(pinned, schoolId);
  return enrichAnnouncementRefs(pinned, schoolId);
}

/* ============================================
   getPendingPosts
   Approval queue — oldest first so oldest requests
   are reviewed first.
   For mod/admin only.
============================================ */
async function getPendingPosts(schoolId, cursor, limit) {
  var pageLimit = Math.min(limit || 20, 50);

  var filter = {
    schoolId: schoolId,  /* TENANT SCOPE */
    status:   'pending'
  };

  if (cursor && mongoose.isValidObjectId(cursor)) {
    filter._id = { $gt: new mongoose.Types.ObjectId(cursor) }; /* oldest first → $gt */
  }

  var posts = await CommunityPost.find(filter)
    .sort({ createdAt: 1 })
    .limit(pageLimit + 1)
    .lean();

  var hasMore    = posts.length > pageLimit;
  if (hasMore)   posts = posts.slice(0, pageLimit);
  var nextCursor = (hasMore && posts.length)
    ? posts[posts.length - 1]._id.toString()
    : null;

  return { posts, nextCursor, hasMore };
}

/* ============================================
   getPendingCount
   Fast count for badge display.
============================================ */
async function getPendingCount(schoolId) {
  return CommunityPost.countDocuments({ schoolId, status: 'pending' });
}

/* ============================================
   enrichEventRefs
   Batch-loads SchoolEvent data for event_ref posts.
   One query for ALL refs in the batch — no N+1.
   SchoolEvent is the authoritative record — not duplicated.
   Adds refData field to each post that has a ref.
============================================ */
async function enrichEventRefs(posts, schoolId) {
  if (!posts || !posts.length) return posts;

  var eventIds = posts
    .filter(function(p) { return p.refType === 'event' && p.refId; })
    .map(function(p)    { return p.refId; });

  if (!eventIds.length) return posts;

  var SchoolEvent = require('../../institution/models/SchoolEvent.model');
  var events = await SchoolEvent.find({
    _id:      { $in: eventIds },
    schoolId: schoolId  /* TENANT SCOPE — critical */
  })
  .select('title date location status eventType')
  .lean();

  var eventMap = {};
  events.forEach(function(e) { eventMap[e._id.toString()] = e; });

  return posts.map(function(p) {
    if (p.refType === 'event' && p.refId) {
      p.refData = eventMap[p.refId.toString()] || null;
    }
    return p;
  });
}

/* ============================================
   enrichAnnouncementRefs
   Batch-loads SchoolAnnouncement data for announcement-ref posts.
   One query for ALL refs in the batch — no N+1.
   SchoolAnnouncement is authoritative — never modified here.
   Adds refData field to each post that references an announcement.
   
   ⚠️ SchoolAnnouncement field names inspected:
   Uses 'content body' in select to handle either field name.
============================================ */
async function enrichAnnouncementRefs(posts, schoolId) {
  if (!posts || !posts.length) return posts;

  var announcementIds = posts
    .filter(function(p) { return p.refType === 'announcement' && p.refId; })
    .map(function(p) { return p.refId; });

  if (!announcementIds.length) return posts;

  var SchoolAnnouncement = require('../../institution/models/SchoolAnnouncement.model');
  var announcements = await SchoolAnnouncement.find({
    _id:      { $in: announcementIds },
    schoolId: schoolId,    /* TENANT SCOPE — critical */
    status:   'published'
  })
  .select('title content body targetAudience priority publishedAt createdAt')
  .lean();

  var announcementMap = {};
  announcements.forEach(function(a) {
    announcementMap[a._id.toString()] = a;
  });

  return posts.map(function(p) {
    if (p.refType === 'announcement' && p.refId) {
      p.refData = announcementMap[p.refId.toString()] || null;
    }
    return p;
  });
}

/* ============================================
   getOfficialAnnouncements
   Returns recent published SchoolAnnouncements visible
   to the requesting member type.
   Called by GET /api/community/feed/official.
   These are displayed read-only in the community feed —
   they are NEVER duplicated into CommunityPost records.
============================================ */
async function getOfficialAnnouncements(schoolId, memberType, memberRole, limit) {
  var SchoolAnnouncement = require('../../institution/models/SchoolAnnouncement.model');

  /* Determine which targetAudience values this member can see */
  var visibleAudiences;
  if (memberRole === 'admin' || memberRole === 'moderator' ||
      memberType === 'admin' || memberType === 'staff') {
    visibleAudiences = ['all', 'parents', 'students', 'staff'];
  } else if (memberType === 'student') {
    visibleAudiences = ['all', 'students'];
  } else if (memberType === 'parent') {
    visibleAudiences = ['all', 'parents'];
  } else {
    visibleAudiences = ['all'];
  }

  var thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  return SchoolAnnouncement.find({
    schoolId:       schoolId,               /* TENANT SCOPE */
    status:         'published',
    targetAudience: { $in: visibleAudiences },
    createdAt:      { $gte: thirtyDaysAgo }
  })
  .select('title content body targetAudience priority publishedAt createdAt')
  .sort({ priority: -1, createdAt: -1 })
  .limit(Math.min(limit || 5, 10))
  .lean();
}

module.exports = {
  getFeed,
  getPinnedPosts,
  getPendingPosts,
  getPendingCount,
  enrichEventRefs,
  enrichAnnouncementRefs,
  getOfficialAnnouncements,
  getVisibilityFor,
  FEED_LIMIT,
  MAX_PINNED
};