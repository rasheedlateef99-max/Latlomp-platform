'use strict';
/* ============================================
   LATLOMP — INSTITUTION STAFF NOTIFICATIONS (P10-A)
   Base: /api/institution/notifications
   Auth: instProtect + teacherOrAdmin
   recipientId = req.schoolUser._id (always from JWT)
   schoolId    = req.schoolId       (always from JWT)
============================================ */
const express   = require('express');
const router    = express.Router();
const mongoose  = require('mongoose');
const notifSvc  = require('../services/inst.notification.service');
const { instProtect, teacherOrAdmin } = require('../middleware/inst.auth');
const { requireActiveSubscription }   = require('../middleware/inst.tenant');

var guard = [instProtect, teacherOrAdmin, requireActiveSubscription];

/* GET /api/institution/notifications
   Paginated notification list for this staff member. */
router.get('/', guard, async function(req, res) {
  try {
    var result = await notifSvc.getNotifications(
      req.schoolId, 'staff', req.schoolUser._id,
      { page: req.query.page || 1, limit: req.query.limit || 20 }
    );
    return res.json({ success: true, ...result });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/institution/notifications/count
   Lightweight unread count for the badge.
   MUST be declared before /:id routes. */
router.get('/count', guard, async function(req, res) {
  try {
    var count = await notifSvc.getUnreadCount(
      req.schoolId, 'staff', req.schoolUser._id
    );
    return res.json({ success: true, count });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/notifications/read-all
   Mark every unread notification as read.
   MUST be declared before /:id routes. */
router.put('/read-all', guard, async function(req, res) {
  try {
    await notifSvc.markAllRead(req.schoolId, 'staff', req.schoolUser._id);
    return res.json({ success: true, message: 'All marked as read.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/notifications/:id/read */
router.put('/:id/read', guard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid ID.' });
    }
    await notifSvc.markRead(req.params.id, req.schoolId, req.schoolUser._id);
    return res.json({ success: true });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* DELETE /api/institution/notifications/:id
   Soft-deletes the notification — removes it from history.
   Any notification (read or unread) can be deleted. */
router.delete('/:id', guard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid ID.' });
    }
    await notifSvc.deleteNotification(req.params.id, req.schoolId, req.schoolUser._id);
    return res.json({ success: true, message: 'Notification removed.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;