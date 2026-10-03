'use strict';
/* ============================================
   LATLOMP — IN-APP NOTIFICATION SERVICE (P10-A)

   All functions are fire-and-forget safe —
   every exported function catches its own errors
   so a notification failure never breaks the
   route that triggered it.

   Does NOT send emails — that stays in
   inst.email.service.js.
   Does NOT create financial records.
   schoolId enforced on every DB write.
============================================ */
const SchoolNotification = require('../models/SchoolNotification.model');

/* Finance-relevant roles — receive claim_submitted alerts */
var FINANCE_ROLES = ['bursar', 'school_admin', 'principal', 'vice_principal'];

/* ── Internal: get all finance-role staff IDs at a school ── */
async function getFinanceStaffIds(schoolId) {
  try {
    var SchoolUser = require('../models/SchoolUser.model');
    var staff = await SchoolUser.find({
      schoolId: schoolId,
      isActive: { $ne: false },
      $or: [
        { role:            { $in: FINANCE_ROLES } },
        { additionalRoles: { $elemMatch: { $in: FINANCE_ROLES } } }
      ]
    }).select('_id').lean();
    return staff.map(function(s) { return s._id; });
  } catch(e) {
    console.error('[notification] getFinanceStaffIds:', e.message);
    return [];
  }
}

/* ── Create a single notification ── */
async function createNotification(opts) {
  try {
    return await SchoolNotification.create({
      schoolId:      opts.schoolId,
      recipientType: opts.recipientType,
      recipientId:   opts.recipientId   || null,
      type:          opts.type,
      title:         opts.title,
      body:          opts.body          || '',
      entityType:    opts.entityType    || '',
      entityId:      opts.entityId      || null,
      metadata:      opts.metadata      || {}
    });
  } catch(e) {
    console.error('[notification] createNotification:', e.message);
    return null;
  }
}

/* ── Notify all finance staff at a school ── */
async function notifyFinanceStaff(schoolId, opts) {
  try {
    var staffIds = await getFinanceStaffIds(schoolId);
    if (!staffIds.length) { return; }
    var docs = staffIds.map(function(id) {
      return {
        schoolId:      schoolId,
        recipientType: 'staff',
        recipientId:   id,
        type:          opts.type          || 'general',
        title:         opts.title         || '',
        body:          opts.body          || '',
        entityType:    opts.entityType    || '',
        entityId:      opts.entityId      || null,
        metadata:      opts.metadata      || {},
        isRead:        false,
        isDeleted:     false
      };
    });
    await SchoolNotification.insertMany(docs, { ordered: false });
  } catch(e) {
    console.error('[notification] notifyFinanceStaff:', e.message);
  }
}

/* ── Notify a specific parent ── */
async function notifyParent(schoolId, parentId, opts) {
  if (!parentId) { return null; }
  return createNotification(Object.assign({}, opts, {
    schoolId,
    recipientType: 'parent',
    recipientId:   parentId
  }));
}

/* ── Notify a specific student ── */
async function notifyStudent(schoolId, studentId, opts) {
  if (!studentId) { return null; }
  return createNotification(Object.assign({}, opts, {
    schoolId,
    recipientType: 'student',
    recipientId:   studentId
  }));
}

/* ── Notify payer based on claim.payerType and claim.payerId ──
   Handles parent / student automatically.
   Skips external/alumni/staff (no portal to notify). */
async function notifyClaimPayer(schoolId, claim, opts) {
  if (!claim || !claim.payerId) { return null; }
  if (claim.payerType === 'parent') {
    return notifyParent(schoolId, claim.payerId, opts);
  }
  if (claim.payerType === 'student') {
    return notifyStudent(schoolId, claim.payerId, opts);
  }
  return null;
}

/* ── Get unread count for a recipient ── */
async function getUnreadCount(schoolId, recipientType, recipientId) {
  try {
    return await SchoolNotification.countDocuments({
      schoolId,
      recipientType,
      recipientId: recipientId || null,
      isRead:      false,
      isDeleted:   false
    });
  } catch(e) { return 0; }
}

/* ── Get paginated notifications for a recipient ── */
async function getNotifications(schoolId, recipientType, recipientId, opts) {
  opts      = opts || {};
  var page  = Math.max(1, parseInt(opts.page)  || 1);
  var limit = Math.min(30, parseInt(opts.limit) || 20);
  var skip  = (page - 1) * limit;
  var filter = {
    schoolId,
    recipientType,
    recipientId:  recipientId || null,
    isDeleted:    false
  };
  try {
    var [notifications, total, unreadCount] = await Promise.all([
      SchoolNotification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip).limit(limit).lean(),
      SchoolNotification.countDocuments(filter),
      SchoolNotification.countDocuments(
        Object.assign({}, filter, { isRead: false })
      )
    ]);
    return {
      notifications,
      total,
      page,
      pages:       Math.ceil(total / limit),
      unreadCount
    };
  } catch(e) {
    console.error('[notification] getNotifications:', e.message);
    return { notifications: [], total: 0, page: 1, pages: 0, unreadCount: 0 };
  }
}

/* ── Mark one notification as read ── */
async function markRead(notifId, schoolId, recipientId) {
  try {
    await SchoolNotification.findOneAndUpdate(
      { _id: notifId, schoolId, recipientId },
      { $set: { isRead: true, readAt: new Date() } }
    );
  } catch(e) { console.error('[notification] markRead:', e.message); }
}

/* ── Mark all as read for a recipient ── */
async function markAllRead(schoolId, recipientType, recipientId) {
  try {
    await SchoolNotification.updateMany(
      { schoolId, recipientType, recipientId: recipientId || null,
        isRead: false, isDeleted: false },
      { $set: { isRead: true, readAt: new Date() } }
    );
  } catch(e) { console.error('[notification] markAllRead:', e.message); }
}

/* ── Soft-delete one notification (removes from history UI) ── */
async function deleteNotification(notifId, schoolId, recipientId) {
  try {
    await SchoolNotification.findOneAndUpdate(
      { _id: notifId, schoolId, recipientId },
      { $set: { isDeleted: true } }
    );
  } catch(e) { console.error('[notification] deleteNotification:', e.message); }
}

module.exports = {
  notifyFinanceStaff,
  notifyParent,
  notifyStudent,
  notifyClaimPayer,
  getUnreadCount,
  getNotifications,
  markRead,
  markAllRead,
  deleteNotification
};