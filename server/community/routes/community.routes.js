/* ============================================
   E9B: POST AND FEED ROUTES
   All queries: TENANT SCOPED to req.schoolId.
   authorId: ALWAYS from req.communityMember (never body).
   All text: sanitizeText() applied before storage.
============================================ */

var CommunityPost = require('../models/CommunityPost.model');
var feedService   = require('../services/community.feed.service');

var ANNOUNCEMENT_TYPES_STAFF_ONLY = ['announcement'];
var ALL_POST_TYPES = ['post', 'announcement', 'event_ref', 'achievement', 'competition', 'award', 'reunion'];
var VALID_VISIBILITY = ['all', 'students', 'parents', 'staff', 'alumni'];

/* ---- Allowed visibility for member role ---- */
function getAllowedVisibilities(memberType, memberRole) {
  if (memberRole === 'admin' || memberRole === 'moderator' ||
      memberType === 'staff' || memberType === 'admin') {
    return VALID_VISIBILITY;
  }
  var base = ['all'];
  var typeMap = { student: 'students', parent: 'parents', alumni: 'alumni' };
  var own = typeMap[memberType];
  if (own) base.push(own);
  return base;
}

/* ============================================
   GET /api/community/events
   Event picker for event_ref post type.
   Returns upcoming published events for this school.
   Uses community token (not inst token).
   SchoolEvent is NOT duplicated — just referenced.
============================================ */
router.get('/events', communityProtect, async function(req, res) {
  try {
    var SchoolEvent = require('../../institution/models/SchoolEvent.model');
    var sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    var events = await SchoolEvent.find({
      schoolId: req.schoolId, /* TENANT SCOPE */
      status:   'published',
      date:     { $gte: sevenDaysAgo }
    })
    .select('title date eventType location')
    .sort({ date: 1 })
    .limit(30)
    .lean();

    return res.json({ success: true, events });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/community/feed
   Cursor-based chronological feed.
   Visibility enforced server-side by member type/role.
   Returns 20 published non-pinned posts.
============================================ */
router.get('/feed', communityProtect, async function(req, res) {
  try {
    var cursor = req.query.cursor || null;
    var limit  = parseInt(req.query.limit) || feedService.FEED_LIMIT;
    var member = req.communityMember;

    var result = await feedService.getFeed(
      req.schoolId,
      member.memberType,
      member.role,
      cursor,
      limit
    );

    return res.json({
      success:    true,
      posts:      result.posts,
      nextCursor: result.nextCursor,
      hasMore:    result.hasMore
    });
  } catch(err) {
    console.error('[community] GET /feed:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/community/feed/pinned
   Returns up to MAX_PINNED published pinned posts.
============================================ */
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
   POST /api/community/posts
   Create a new community post.
   authorId: from req.communityMember — never from body.
   Enforces: post type permissions, visibility, content limits.
============================================ */
router.post('/posts', communityProtect, communityWriteGuard, async function(req, res) {
  try {
    var member   = req.communityMember;
    var settings = await ensureSettings(req.schoolId);

    /* Check community is enabled */
    if (!settings.isEnabled) {
      return res.status(403).json({ success: false, message: 'Community is not enabled.' });
    }

    /* Check if this member type is allowed to post */
    var memberType = member.memberType;
    if (memberType === 'student' && !settings.allowStudentPosts) {
      return res.status(403).json({ success: false, message: 'Student posting is currently disabled by the administrator.' });
    }
    if (memberType === 'parent' && !settings.allowParentPosts) {
      return res.status(403).json({ success: false, message: 'Parent posting is currently disabled by the administrator.' });
    }
    if (memberType === 'alumni' && !settings.allowAlumniPosts) {
      return res.status(403).json({ success: false, message: 'Alumni posting is currently disabled by the administrator.' });
    }

    /* Validate content */
    var content = sanitizeText(req.body.content || '');
    if (!content) {
      return res.status(400).json({ success: false, message: 'Post content cannot be empty.' });
    }
    var maxLen = settings.maxPostLength || 2000;
    if (content.length > maxLen) {
      return res.status(400).json({ success: false, message: 'Post exceeds maximum length of ' + maxLen + ' characters.' });
    }

    /* Validate post type */
    var postType = req.body.postType || 'post';
    if (!ALL_POST_TYPES.includes(postType)) {
      return res.status(400).json({ success: false, message: 'Invalid post type.' });
    }

    /* Announcement type: staff/admin only */
    if (ANNOUNCEMENT_TYPES_STAFF_ONLY.includes(postType) &&
        memberType !== 'staff' && memberType !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only staff and administrators can post announcements.' });
    }

    /* Validate visibility */
    var visibility = req.body.visibility || 'all';
    var allowed    = getAllowedVisibilities(memberType, member.role);
    if (!allowed.includes(visibility)) {
      return res.status(400).json({
        success: false,
        message: 'You cannot post with visibility "' + visibility + '". Allowed: ' + allowed.join(', ')
      });
    }

    /* Validate event reference */
    var refType = null;
    var refId   = null;
    if (postType === 'event_ref') {
      if (!req.body.refId || !mongoose.isValidObjectId(req.body.refId)) {
        return res.status(400).json({ success: false, message: 'An event must be selected for this post type.' });
      }
      /* Verify event belongs to this school — TENANT SCOPE */
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

    /* Determine initial status */
    var requiresApproval = settings.requirePostApproval && member.role === 'member';
    var initialStatus    = requiresApproval ? 'pending' : 'published';

    var post = await CommunityPost.create({
      schoolId:         req.schoolId,   /* TENANT SCOPE — from JWT, never from body */
      authorId:         member._id,     /* from communityProtect — never from body */
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
        createdAt:       post.createdAt
      }
    });
  } catch(err) {
    console.error('[community] POST /posts:', err.message);
    return res.status(500).json({ success: false, message: membershipService.safeErrorMsg(err) });
  }
});

/* ============================================
   GET /api/community/posts/:id
   Get single post. Returns only if published
   OR if requester is the author OR if mod/admin.
============================================ */
router.get('/posts/:id', communityProtect, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    }

    var member = req.communityMember;
    var filter = {
      _id:      req.params.id,
      schoolId: req.schoolId  /* TENANT SCOPE */
    };

    var post = await CommunityPost.findOne(filter).lean();
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }

    /* Access rules */
    var isAuthor    = post.authorId && post.authorId.toString() === member._id.toString();
    var isModAdmin  = member.role === 'moderator' || member.role === 'admin';
    var visibility  = feedService.getVisibilityFor(member.memberType, member.role);

    if (post.status === 'removed' && !isModAdmin) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }
    if (post.status === 'archived' && !isAuthor && !isModAdmin) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }
    if (post.status === 'pending' && !isAuthor && !isModAdmin) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }
    if (!visibility.includes(post.visibility) && !isModAdmin) {
      return res.status(403).json({ success: false, message: 'You do not have permission to view this post.' });
    }

    /* Enrich event ref */
    var posts = await feedService.enrichEventRefs
      ? [post]
      : [post];
    var enriched = (await require('../services/community.feed.service').enrichEventRefs
      ? require('../services/community.feed.service').enrichEventRefs([post], req.schoolId)
      : Promise.resolve([post]));

    /* Strip moderationNote unless mod/admin */
    var result = enriched[0] || post;
    if (!isModAdmin) delete result.moderationNote;

    return res.json({ success: true, post: result });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /api/community/posts/:id
   Edit own post content.
   Cannot change: postType, visibility, refId.
   Mod/admin can edit any post content.
============================================ */
router.put('/posts/:id', communityProtect, communityWriteGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    }

    var member   = req.communityMember;
    var isModAdmin = member.role === 'moderator' || member.role === 'admin';

    var post = await CommunityPost.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId  /* TENANT SCOPE */
    });
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }

    /* Only author or mod/admin can edit */
    var isAuthor = post.authorId.toString() === member._id.toString();
    if (!isAuthor && !isModAdmin) {
      return res.status(403).json({ success: false, message: 'You can only edit your own posts.' });
    }

    /* Cannot edit removed posts */
    if (post.status === 'removed' || post.status === 'archived') {
      return res.status(400).json({ success: false, message: 'This post cannot be edited.' });
    }

    var settings = await ensureSettings(req.schoolId);
    var content  = sanitizeText(req.body.content || '');
    if (!content) {
      return res.status(400).json({ success: false, message: 'Post content cannot be empty.' });
    }
    var maxLen = settings.maxPostLength || 2000;
    if (content.length > maxLen) {
      return res.status(400).json({ success: false, message: 'Post exceeds maximum length of ' + maxLen + ' characters.' });
    }

    post.content  = content;
    post.updatedAt = new Date();
    await post.save();

    return res.json({ success: true, message: 'Post updated.', content: post.content });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   DELETE /api/community/posts/:id
   Soft-delete own post (status → 'archived').
   Mod/admin soft-deletes via admin route below.
   Records kept for audit — never hard deleted.
============================================ */
router.delete('/posts/:id', communityProtect, communityWriteGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    }

    var member = req.communityMember;
    var post   = await CommunityPost.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId  /* TENANT SCOPE */
    });
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }

    /* Only own posts */
    if (post.authorId.toString() !== member._id.toString()) {
      return res.status(403).json({ success: false, message: 'You can only delete your own posts.' });
    }

    if (post.status === 'removed' || post.status === 'archived') {
      return res.status(400).json({ success: false, message: 'Post is already deleted.' });
    }

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
   ADMIN / MODERATION POST ROUTES
============================================ */

/* GET /api/community/admin/posts/pending
   Approval queue — oldest first.
   mod/admin only.
*/
router.get('/admin/posts/pending', communityProtect, communityModGuard, async function(req, res) {
  try {
    var cursor = req.query.cursor || null;
    var result = await feedService.getPendingPosts(req.schoolId, cursor, 20);
    var count  = await feedService.getPendingCount(req.schoolId);
    return res.json({
      success:    true,
      posts:      result.posts,
      nextCursor: result.nextCursor,
      hasMore:    result.hasMore,
      totalPending: count
    });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/community/admin/posts/:id/approve */
router.post('/admin/posts/:id/approve', communityProtect, communityModGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    }
    var post = await CommunityPost.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId, status: 'pending' }, /* TENANT SCOPE */
      { $set: {
          status:     'published',
          approvedAt: new Date(),
          approvedBy: req.communityMember._id
        }},
      { new: true }
    );
    if (!post) {
      return res.status(404).json({ success: false, message: 'Pending post not found.' });
    }
    return res.json({ success: true, message: 'Post approved and published.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/community/admin/posts/:id/reject */
router.post('/admin/posts/:id/reject', communityProtect, communityModGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    }
    var reason = sanitizeText(req.body.reason || 'Did not meet community guidelines');
    var post = await CommunityPost.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId, status: 'pending' }, /* TENANT SCOPE */
      { $set: {
          status:         'removed',
          moderationNote: reason,
          deletedAt:      new Date(),
          deletedBy:      req.communityMember._id,
          deletedReason:  reason
        }},
      { new: true }
    );
    if (!post) {
      return res.status(404).json({ success: false, message: 'Pending post not found.' });
    }
    return res.json({ success: true, message: 'Post rejected.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/community/admin/posts/:id/pin */
router.post('/admin/posts/:id/pin', communityProtect, communityModGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    }

    /* Enforce MAX_PINNED per school */
    var pinnedCount = await CommunityPost.countDocuments({
      schoolId: req.schoolId,
      isPinned: true,
      status:   'published'
    });
    if (pinnedCount >= feedService.MAX_PINNED) {
      return res.status(400).json({
        success: false,
        message: 'Maximum ' + feedService.MAX_PINNED + ' posts can be pinned. Unpin one first.'
      });
    }

    var post = await CommunityPost.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId, status: 'published' }, /* TENANT SCOPE */
      { $set: { isPinned: true, pinnedAt: new Date(), pinnedBy: req.communityMember._id }},
      { new: true }
    );
    if (!post) {
      return res.status(404).json({ success: false, message: 'Published post not found.' });
    }
    return res.json({ success: true, message: 'Post pinned.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/community/admin/posts/:id/unpin */
router.post('/admin/posts/:id/unpin', communityProtect, communityModGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    }
    var post = await CommunityPost.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId, isPinned: true }, /* TENANT SCOPE */
      { $set: { isPinned: false, pinnedAt: null, pinnedBy: null }},
      { new: true }
    );
    if (!post) {
      return res.status(404).json({ success: false, message: 'Pinned post not found.' });
    }
    return res.json({ success: true, message: 'Post unpinned.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/community/admin/posts/:id/lock */
router.post('/admin/posts/:id/lock', communityProtect, communityModGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    }
    var post = await CommunityPost.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId }, /* TENANT SCOPE */
      { $set: { isLocked: true, lockedAt: new Date(), lockedBy: req.communityMember._id }},
      { new: true }
    );
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }
    return res.json({ success: true, message: 'Discussion locked. No new comments will be accepted.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/community/admin/posts/:id/unlock */
router.post('/admin/posts/:id/unlock', communityProtect, communityModGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    }
    var post = await CommunityPost.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId, isLocked: true }, /* TENANT SCOPE */
      { $set: { isLocked: false, lockedAt: null, lockedBy: null }},
      { new: true }
    );
    if (!post) {
      return res.status(404).json({ success: false, message: 'Locked post not found.' });
    }
    return res.json({ success: true, message: 'Discussion unlocked.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* DELETE /api/community/admin/posts/:id
   Moderator/admin removal. Sets status: 'removed'.
   Soft delete — record kept for audit.
   moderationNote: stored internally, never shown to author.
*/
router.delete('/admin/posts/:id', communityProtect, communityModGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    }
    var reason = sanitizeText(req.body.reason || 'Removed by moderator');
    var post   = await CommunityPost.findOneAndUpdate(
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
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found or already removed.' });
    }
    return res.json({ success: true, message: 'Post removed.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});