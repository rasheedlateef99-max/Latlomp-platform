'use strict';
/* ============================================
   LATLOMP INSTITUTION — PARENT COMMS (E7)
   Staff-side management of:
   - Homework (create/edit/delete per class)
   - Announcements (publish to parents)
   - School Events (create/manage)
   - Messages (view/reply to parent threads)

   Mounted at /api/institution/parent-comms/
   All routes use instProtect + role guards.
   Follows inst.portfolio.routes.js conventions.
============================================ */
'use strict';

const express           = require('express');
const router            = express.Router();
const mongoose          = require('mongoose');
const SchoolHomework    = require('../models/SchoolHomework.model');
const SchoolAnnouncement= require('../models/SchoolAnnouncement.model');
const SchoolEvent       = require('../models/SchoolEvent.model');
const SchoolMessage     = require('../models/SchoolMessage.model');
const SchoolStudent     = require('../models/SchoolStudent.model');
const {
  instProtect,
  schoolAdminOnly,
  seniorStaffOrAdmin,
  canManageStudents,
  teacherOrAdmin
} = require('../middleware/inst.auth');
const { requireActiveSubscription } = require('../middleware/inst.tenant');

var adminGuard  = [instProtect, schoolAdminOnly,    requireActiveSubscription];
var seniorGuard = [instProtect, seniorStaffOrAdmin, requireActiveSubscription];
var manageGuard = [instProtect, canManageStudents,  requireActiveSubscription];
var readGuard   = [instProtect, teacherOrAdmin,     requireActiveSubscription];

/* ============================================
   HOMEWORK
============================================ */

/* POST /api/institution/parent-comms/homework
   Teacher assigns homework to a class.
   Body: { classId, subjectId?, termId?, title,
           description?, instructions?, dueDate,
           attachmentUrl?, estimatedMins? }
*/
router.post('/homework', manageGuard, async function(req, res) {
  try {
    var { classId, subjectId, termId, title, description,
          instructions, dueDate, attachmentUrl, estimatedMins } = req.body;

    if (!classId || !title || !dueDate) {
      return res.status(400).json({ success: false, message: 'classId, title and dueDate are required.' });
    }

    /* Verify class belongs to this school */
    var SchoolClass = require('../models/Class.model');
    var cls = await SchoolClass.findOne({ _id: classId, schoolId: req.schoolId })
      .select('name').lean();
    if (!cls) {
      return res.status(404).json({ success: false, message: 'Class not found in this institution.' });
    }

    /* Verify subject belongs to this school (if provided) */
    var subjectName = '';
    if (subjectId) {
      try {
        var SchoolSubject = require('../models/SchoolSubject.model');
        var subj = await SchoolSubject.findOne({ _id: subjectId, schoolId: req.schoolId })
          .select('name').lean();
        if (subj) { subjectName = subj.name; }
      } catch (e) {}
    }

    var hw = await SchoolHomework.create({
      schoolId:       req.schoolId,
      classId,
      subjectId:      subjectId  || null,
      termId:         termId     || null,
      title:          title.trim(),
      description:    (description    || '').trim(),
      instructions:   (instructions   || '').trim(),
      dueDate:        new Date(dueDate),
      attachmentUrl:  (attachmentUrl  || '').trim(),
      estimatedMins:  estimatedMins   || null,
      subjectName,
      className:      cls.name,
      status:         'active',
      assignedBy:     req.schoolUser._id,
      assignedByName: req.schoolUser.name || ''
    });

    return res.status(201).json({ success: true, message: 'Homework assigned.', homework: hw });
  } catch(err) {
    console.error('[parent-comms] POST /homework:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/institution/parent-comms/homework
   List homework. Query: ?classId=&termId=&status=
*/
router.get('/homework', readGuard, async function(req, res) {
  try {
    var filter = { schoolId: req.schoolId };
    if (req.query.classId) filter.classId = req.query.classId;
    if (req.query.termId)  filter.termId  = req.query.termId;
    if (req.query.status)  filter.status  = req.query.status;

    var homework = await SchoolHomework.find(filter)
      .sort({ dueDate: -1 })
      .lean();

    return res.json({ success: true, homework, count: homework.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/parent-comms/homework/:id */
router.put('/homework/:id', manageGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid homework ID.' });
    }

    var hw = await SchoolHomework.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!hw) {
      return res.status(404).json({ success: false, message: 'Homework not found.' });
    }

    var allowed = ['title','description','instructions','dueDate',
                   'attachmentUrl','estimatedMins','status'];
    allowed.forEach(function(f) {
      if (req.body[f] !== undefined) { hw[f] = req.body[f]; }
    });
    await hw.save();

    return res.json({ success: true, message: 'Homework updated.', homework: hw });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* DELETE /api/institution/parent-comms/homework/:id
   Soft delete: status = 'cancelled'
*/
router.delete('/homework/:id', seniorGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid homework ID.' });
    }

    var hw = await SchoolHomework.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: { status: 'cancelled' } },
      { new: true }
    );
    if (!hw) {
      return res.status(404).json({ success: false, message: 'Homework not found.' });
    }

    return res.json({ success: true, message: 'Homework cancelled.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ANNOUNCEMENTS
============================================ */

/* POST /api/institution/parent-comms/announcements
   Body: { title, body, targetAudience?, priority?, publishNow?, expiresAt? }
*/
router.post('/announcements', seniorGuard, async function(req, res) {
  try {
    var { title, body, targetAudience, priority, publishNow, expiresAt } = req.body;
    if (!title || !body) {
      return res.status(400).json({ success: false, message: 'Title and body are required.' });
    }

    var status = publishNow ? 'published' : 'draft';
    var now    = new Date();

    var ann = await SchoolAnnouncement.create({
      schoolId:        req.schoolId,
      title:           title.trim(),
      body:            body.trim(),
      targetAudience:  targetAudience  || 'parents',
      priority:        priority        || 'normal',
      status,
      publishedAt:     publishNow ? now  : null,
      publishedBy:     publishNow ? req.schoolUser._id : null,
      publishedByName: publishNow ? (req.schoolUser.name || '') : '',
      expiresAt:       expiresAt  ? new Date(expiresAt)  : null,
      createdBy:       req.schoolUser._id,
      createdByName:   req.schoolUser.name || ''
    });

    return res.status(201).json({
      success:      true,
      message:      'Announcement ' + status + '.',
      announcement: ann
    });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/institution/parent-comms/announcements */
router.get('/announcements', readGuard, async function(req, res) {
  try {
    var filter = { schoolId: req.schoolId };
    if (req.query.status)   filter.status         = req.query.status;
    if (req.query.audience) filter.targetAudience = req.query.audience;

    var announcements = await SchoolAnnouncement.find(filter)
      .sort({ createdAt: -1 }).lean();

    return res.json({ success: true, announcements, count: announcements.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/parent-comms/announcements/:id */
router.put('/announcements/:id', seniorGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid announcement ID.' });
    }

    var ann = await SchoolAnnouncement.findOne({
      _id: req.params.id, schoolId: req.schoolId
    });
    if (!ann) {
      return res.status(404).json({ success: false, message: 'Announcement not found.' });
    }

    var allowed = ['title','body','targetAudience','priority','expiresAt'];
    allowed.forEach(function(f) {
      if (req.body[f] !== undefined) { ann[f] = req.body[f]; }
    });

    if (req.body.status === 'published' && ann.status === 'draft') {
      ann.status          = 'published';
      ann.publishedAt     = new Date();
      ann.publishedBy     = req.schoolUser._id;
      ann.publishedByName = req.schoolUser.name || '';
    } else if (req.body.status === 'archived') {
      ann.status = 'archived';
    }

    await ann.save();
    return res.json({ success: true, message: 'Announcement updated.', announcement: ann });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   SCHOOL EVENTS
============================================ */

/* POST /api/institution/parent-comms/events */
router.post('/events', seniorGuard, async function(req, res) {
  try {
    var { title, description, eventType, date, endDate,
          location, capacity, visibility } = req.body;
    if (!title || !date) {
      return res.status(400).json({ success: false, message: 'Title and date are required.' });
    }

    var event = await SchoolEvent.create({
      schoolId:      req.schoolId,
      title:         title.trim(),
      description:   (description || '').trim(),
      eventType:     eventType    || 'general',
      date:          new Date(date),
      endDate:       endDate      ? new Date(endDate) : null,
      location:      location     || {},
      capacity:      capacity     || null,
      visibility:    visibility   || 'parents',
      status:        'draft',
      createdBy:     req.schoolUser._id,
      createdByName: req.schoolUser.name || ''
    });

    return res.status(201).json({ success: true, message: 'Event created.', event });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/institution/parent-comms/events */
router.get('/events', readGuard, async function(req, res) {
  try {
    var filter = { schoolId: req.schoolId };
    if (req.query.status) filter.status    = req.query.status;
    if (req.query.type)   filter.eventType = req.query.type;

    var events = await SchoolEvent.find(filter)
      .sort({ date: -1 }).lean();

    var enriched = events.map(function(ev) {
      return Object.assign({}, ev, {
        registrantCount: ev.registrations
          ? ev.registrations.filter(function(r) { return r.status === 'registered'; }).length
          : 0
      });
    });

    return res.json({ success: true, events: enriched, count: enriched.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/parent-comms/events/:id */
router.put('/events/:id', seniorGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid event ID.' });
    }

    var event = await SchoolEvent.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }
    if (event.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Cannot modify a cancelled event.' });
    }

    var allowed = ['title','description','eventType','date','endDate',
                   'location','capacity','status','visibility'];
    allowed.forEach(function(f) {
      if (req.body[f] !== undefined) { event[f] = req.body[f]; }
    });
    event.updatedBy = req.schoolUser._id;

    if (req.body.status === 'cancelled') {
      event.cancelledAt = new Date();
      event.cancelReason = (req.body.cancelReason || '').trim();
    }
    await event.save();

    return res.json({ success: true, message: 'Event updated.', event });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* DELETE /api/institution/parent-comms/events/:id — cancel */
router.delete('/events/:id', adminGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid event ID.' });
    }
    if (!req.body.reason || !req.body.reason.trim()) {
      return res.status(400).json({ success: false, message: 'A reason is required to cancel.' });
    }

    var event = await SchoolEvent.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId, status: { $ne: 'cancelled' } },
      { $set: {
          status:       'cancelled',
          cancelledAt:  new Date(),
          cancelReason: req.body.reason.trim(),
          updatedBy:    req.schoolUser._id
      }},
      { new: true }
    );
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found or already cancelled.' });
    }

    return res.json({ success: true, message: 'Event cancelled.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   MESSAGES — STAFF SIDE
============================================ */

/* GET /api/institution/parent-comms/messages
   List all message threads for this school.
   Query: ?studentId=&status=&teacherId=
*/
router.get('/messages', manageGuard, async function(req, res) {
  try {
    var filter = { schoolId: req.schoolId };
    if (req.query.status)    filter.status    = req.query.status;
    if (req.query.studentId) filter.studentId = req.query.studentId;
    if (req.query.teacherId) filter.teacherId = req.query.teacherId;

    var messages = await SchoolMessage.find(filter)
      .select('-thread') /* list view: no thread bodies */
      .sort({ lastMessageAt: -1 })
      .limit(100)
      .lean();

    /* Enrich with unread count (messages from parent not yet read by staff) */
    var enriched = messages.map(function(m) {
      return Object.assign({}, m, { threadCount: m.thread ? m.thread.length : 0 });
    });

    return res.json({ success: true, messages: enriched, count: enriched.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/institution/parent-comms/messages/:id
   Full thread for staff.
*/
router.get('/messages/:id', manageGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid message ID.' });
    }

    var message = await SchoolMessage.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId
    }).lean();
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message thread not found.' });
    }

    return res.json({ success: true, message });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/institution/parent-comms/messages/send
   Staff initiates or replies to a thread.
   Body: { studentId, parentId, body, subject? }
*/
router.post('/messages/send', manageGuard, async function(req, res) {
  try {
    var { studentId, parentId, body, subject } = req.body;
    if (!studentId || !parentId || !body) {
      return res.status(400).json({ success: false, message: 'studentId, parentId and body are required.' });
    }

    /* Verify student belongs to this school */
    var student = await SchoolStudent.findOne({ _id: studentId, schoolId: req.schoolId })
      .select('name').lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    /* Find existing open thread or create new */
    var existing = await SchoolMessage.findOne({
      schoolId,
      studentId,
      parentId,
      status: 'open'
    });

    if (existing) {
      existing.thread.push({
        senderId:   req.schoolUser._id,
        senderType: 'teacher',
        senderName: req.schoolUser.name || '',
        body:       body.trim(),
        sentAt:     new Date()
      });
      existing.lastMessageAt = new Date();
      existing.lastMessageBy = 'teacher';
      if (!existing.teacherId) {
        existing.teacherId   = req.schoolUser._id;
        existing.teacherName = req.schoolUser.name || '';
      }
      await existing.save();
      return res.json({ success: true, message: 'Reply sent.', messageId: existing._id });
    }

    /* New thread */
    var newMessage = await SchoolMessage.create({
      schoolId:     req.schoolId,
      studentId,
      parentId,
      teacherId:    req.schoolUser._id,
      teacherName:  req.schoolUser.name || '',
      subject:      (subject || '').trim(),
      initiatedBy:  'teacher',
      status:       'open',
      lastMessageAt:new Date(),
      lastMessageBy:'teacher',
      thread: [{
        senderId:   req.schoolUser._id,
        senderType: 'teacher',
        senderName: req.schoolUser.name || '',
        body:       body.trim(),
        sentAt:     new Date()
      }]
    });

    return res.status(201).json({ success: true, message: 'Message thread started.', messageId: newMessage._id });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/parent-comms/messages/:id/close */
router.put('/messages/:id/close', seniorGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid message ID.' });
    }

    var msg = await SchoolMessage.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: { status: 'closed' } },
      { new: true }
    );
    if (!msg) {
      return res.status(404).json({ success: false, message: 'Message thread not found.' });
    }

    return res.json({ success: true, message: 'Thread closed.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;