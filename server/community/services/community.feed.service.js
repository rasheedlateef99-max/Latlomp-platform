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

  return enrichEventRefs(pinned, schoolId);
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

module.exports = {
  getFeed,
  getPinnedPosts,
  getPendingPosts,
  getPendingCount,
  getVisibilityFor,
  FEED_LIMIT,
  MAX_PINNED
};