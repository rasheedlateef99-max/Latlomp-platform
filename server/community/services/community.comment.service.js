'use strict';
/* ============================================
   LATLOMP COMMUNITY — COMMENT SERVICE (E9C)

   getCommentThread: paginated top-level comments + replies.
   Uses two queries (top-level, then replies) instead of
   recursive population — avoids N+1 for the common case
   of shallow threads (max 1 level of nesting).

   Counter updates use atomic $inc — never full save().
   schoolId ALWAYS from authenticated context.
============================================ */
'use strict';

var CommunityComment = require('../models/CommunityComment.model');
var CommunityPost    = require('../models/CommunityPost.model');
var COMMENT_PAGE     = 20;

/* ============================================
   getCommentThread
   Returns paginated top-level comments, each
   with their replies nested inside.
   cursor = _id of last comment seen (oldest first).
============================================ */
async function getCommentThread(schoolId, postId, cursor, limit) {
  var pageLimit = Math.min(limit || COMMENT_PAGE, 50);

  var filter = {
    schoolId: schoolId,  /* TENANT SCOPE */
    postId:   postId,
    parentId: null,      /* top-level only */
    status:   'published'
  };

  if (cursor && require('mongoose').isValidObjectId(cursor)) {
    filter._id = { $gt: new require('mongoose').Types.ObjectId(cursor) };
  }

  /* Fetch top-level comments — oldest first for natural thread order */
  var topLevel = await CommunityComment.find(filter)
    .sort({ createdAt: 1 })
    .limit(pageLimit + 1)
    .lean();

  var hasMore    = topLevel.length > pageLimit;
  if (hasMore)   topLevel = topLevel.slice(0, pageLimit);
  var nextCursor = (hasMore && topLevel.length)
    ? topLevel[topLevel.length - 1]._id.toString()
    : null;

  if (!topLevel.length) {
    return { comments: [], nextCursor: null, hasMore: false };
  }

  /* Fetch all replies for these top-level comments in ONE query (no N+1) */
  var parentIds = topLevel.map(function(c) { return c._id; });
  var replies   = await CommunityComment.find({
    schoolId: schoolId,  /* TENANT SCOPE */
    postId:   postId,
    parentId: { $in: parentIds },
    status:   'published'
  })
  .sort({ createdAt: 1 })
  .lean();

  /* Group replies by parentId */
  var replyMap = {};
  replies.forEach(function(r) {
    var key = r.parentId.toString();
    if (!replyMap[key]) replyMap[key] = [];
    replyMap[key].push(r);
  });

  /* Attach replies to their parent */
  var thread = topLevel.map(function(c) {
    c.replies = replyMap[c._id.toString()] || [];
    return c;
  });

  return { comments: thread, nextCursor, hasMore };
}

/* ============================================
   incrementPostCommentCount
   Atomic $inc — never races with other writes.
   delta: +1 for new comment, -1 for deletion.
============================================ */
async function incrementPostCommentCount(postId, schoolId, delta) {
  await CommunityPost.findOneAndUpdate(
    { _id: postId, schoolId: schoolId },
    { $inc: { commentCount: delta } }
  );
}

/* ============================================
   incrementCommentReplyCount
   Atomic $inc on the parent comment.
============================================ */
async function incrementCommentReplyCount(commentId, schoolId, delta) {
  await CommunityComment.findOneAndUpdate(
    { _id: commentId, schoolId: schoolId },
    { $inc: { replyCount: delta } }
  );
}

module.exports = {
  getCommentThread,
  incrementPostCommentCount,
  incrementCommentReplyCount,
  COMMENT_PAGE
};