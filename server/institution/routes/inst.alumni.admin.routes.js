'use strict';
/* ============================================
   LATLOMP INSTITUTION — ALUMNI ADMIN ROUTES (E6)
   Mounted at /api/institution/alumni
   All paths start with /admin/
   Uses instProtect (institution staff JWT)
============================================ */
const express            = require('express');
const router             = express.Router();
const mongoose           = require('mongoose');
const AlumniProfile      = require('../models/AlumniProfile.model');
const AlumniEvent        = require('../models/AlumniEvent.model');
const AlumniAnnouncement = require('../models/AlumniAnnouncement.model');
const AlumniMentorship   = require('../models/AlumniMentorship.model');
const AlumniContribution = require('../models/AlumniContribution.model');
const SchoolStudent      = require('../models/SchoolStudent.model');
const {
  instProtect, schoolAdminOnly,
  seniorStaffOrAdmin, canManageStudents, teacherOrAdmin
} = require('../middleware/inst.auth');
const { requireActiveSubscription } = require('../middleware/inst.tenant');

var adminGuard  = [instProtect, schoolAdminOnly,    requireActiveSubscription];
var seniorGuard = [instProtect, seniorStaffOrAdmin, requireActiveSubscription];
var manageGuard = [instProtect, canManageStudents,  requireActiveSubscription];
var readGuard   = [instProtect, teacherOrAdmin,     requireActiveSubscription];

/* ============================================
   ALUMNI MANAGEMENT
============================================ */

/* GET /admin/list — all alumni for this institution */
router.get('/admin/list', manageGuard, async function(req, res) {
  try {
    var { status, session, page, limit, search } = req.query;
    var pageNum  = Math.max(1, parseInt(page)  || 1);
    var limitNum = Math.min(50, parseInt(limit) || 20);
    var skip     = (pageNum - 1) * limitNum;

    var filter = { schoolId: req.schoolId };
    if (status)  filter.status              = status;
    if (session) filter.graduationSession   = session;

    var [total, alumni] = await Promise.all([
      AlumniProfile.countDocuments(filter),
      AlumniProfile.find(filter)
        .select('displayName bio profession industry graduationSession ' +
                'lastClassName status mentorshipAvailable alumniSince ' +
                'directoryVisibility studentId activatedAt')
        .sort({ alumniSince: -1 })
        .skip(skip).limit(limitNum)
        .lean()
    ]);

    /* Optionally enrich with student name for search */
    if (search) {
      var rx   = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      var sids = alumni.map(function(a) { return a.studentId; });
      var students = await SchoolStudent.find({
        _id: { $in: sids }, schoolId: req.schoolId,
        $or: [{ name: rx }, { admissionNo: rx }]
      }).select('_id').lean();
      var matchIds = new Set(students.map(function(s) { return s._id.toString(); }));
      alumni = alumni.filter(function(a) { return matchIds.has(a.studentId.toString()); });
    }

    return res.json({
      success: true, alumni, total,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
    });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /admin/:alumniId — full alumni profile for staff */
router.get('/admin/:alumniId', manageGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.alumniId)) {
      return res.status(400).json({ success: false, message: 'Invalid alumni ID.' });
    }

    var profile = await AlumniProfile.findOne({
      _id: req.params.alumniId, schoolId: req.schoolId
    }).lean();
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Alumni profile not found.' });
    }

    var student = await SchoolStudent.findOne({
      _id: profile.studentId, schoolId: req.schoolId
    })
    .select('name admissionNo studentId gender status class passportPhotoUrl classHistory joinedYear')
    .lean();

    return res.json({ success: true, profile, student });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /admin/:alumniId/timeline — staff viewing alumni's academic timeline */
router.get('/admin/:alumniId/timeline', manageGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.alumniId)) {
      return res.status(400).json({ success: false, message: 'Invalid alumni ID.' });
    }

    var profile = await AlumniProfile.findOne({
      _id: req.params.alumniId, schoolId: req.schoolId
    }).select('studentId').lean();
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Alumni profile not found.' });
    }

    var timelineService = require('../services/timeline.service');
    var result = await timelineService.getTimeline(
      profile.studentId.toString(), req.schoolId,
      { includeConfidential: false, includeAdmin: false, releasedResultsOnly: false }
    );

    return res.json({ success: true, ...result });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /admin/:alumniId/status — activate/deactivate/archive */
router.put('/admin/:alumniId/status', adminGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.alumniId)) {
      return res.status(400).json({ success: false, message: 'Invalid alumni ID.' });
    }
    var validStatuses = ['active','inactive','archived','deceased'];
    var { status, reason } = req.body;
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }

    var now     = new Date();
    var updates = { status };
    if (status === 'inactive' || status === 'archived') {
      updates.deactivatedAt     = now;
      updates.deactivatedBy     = req.schoolUser._id;
      updates.deactivationReason= (reason || '').trim();
    } else if (status === 'active') {
      updates.activatedAt = now;
      updates.activatedBy = req.schoolUser._id;
    }

    var profile = await AlumniProfile.findOneAndUpdate(
      { _id: req.params.alumniId, schoolId: req.schoolId },
      { $set: updates },
      { new: true }
    );
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Alumni profile not found.' });
    }

    return res.json({ success: true, message: 'Alumni status updated to ' + status + '.', profile });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   EVENTS MANAGEMENT
============================================ */

/* POST /admin/events */
router.post('/admin/events', seniorGuard, async function(req, res) {
  try {
    var { title, description, eventType, date, endDate, location, capacity, visibility } = req.body;
    if (!title || !date) {
      return res.status(400).json({ success: false, message: 'Title and date are required.' });
    }

    var event = await AlumniEvent.create({
      schoolId:     req.schoolId,
      title:        title.trim(),
      description:  (description || '').trim(),
      eventType:    eventType     || 'other',
      date:         new Date(date),
      endDate:      endDate       ? new Date(endDate) : null,
      location:     location      || {},
      capacity:     capacity      || null,
      visibility:   visibility    || 'alumni_only',
      status:       'draft',
      createdBy:    req.schoolUser._id,
      createdByName:req.schoolUser.name || ''
    });

    return res.status(201).json({ success: true, message: 'Event created.', event });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /admin/events */
router.get('/admin/events', readGuard, async function(req, res) {
  try {
    var filter = { schoolId: req.schoolId };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.type)   filter.eventType = req.query.type;

    var events = await AlumniEvent.find(filter)
      .sort({ date: -1 })
      .lean();

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

/* PUT /admin/events/:id */
router.put('/admin/events/:id', seniorGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid event ID.' });
    }

    var event = await AlumniEvent.findOne({ _id: req.params.id, schoolId: req.schoolId });
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

/* DELETE /admin/events/:id — cancel */
router.delete('/admin/events/:id', adminGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid event ID.' });
    }
    if (!req.body.reason || !req.body.reason.trim()) {
      return res.status(400).json({ success: false, message: 'A reason is required to cancel an event.' });
    }

    var event = await AlumniEvent.findOneAndUpdate(
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

    return res.json({ success: true, message: 'Event cancelled.', event });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ANNOUNCEMENTS MANAGEMENT
============================================ */

/* POST /admin/announcements */
router.post('/admin/announcements', seniorGuard, async function(req, res) {
  try {
    var { title, body, visibility, priority, publishNow, expiresAt } = req.body;
    if (!title || !body) {
      return res.status(400).json({ success: false, message: 'Title and body are required.' });
    }

    var now    = new Date();
    var status = publishNow ? 'published' : 'draft';

    var announcement = await AlumniAnnouncement.create({
      schoolId:        req.schoolId,
      title:           title.trim(),
      body:            body.trim(),
      visibility:      visibility || 'alumni_only',
      priority:        priority   || 'normal',
      status,
      publishedAt:     publishNow ? now  : null,
      publishedBy:     publishNow ? req.schoolUser._id : null,
      publishedByName: publishNow ? (req.schoolUser.name || '') : '',
      expiresAt:       expiresAt  ? new Date(expiresAt) : null,
      createdBy:       req.schoolUser._id,
      createdByName:   req.schoolUser.name || ''
    });

    return res.status(201).json({ success: true, message: 'Announcement ' + status + '.', announcement });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /admin/announcements */
router.get('/admin/announcements', readGuard, async function(req, res) {
  try {
    var filter = { schoolId: req.schoolId };
    if (req.query.status) filter.status = req.query.status;

    var announcements = await AlumniAnnouncement.find(filter)
      .sort({ createdAt: -1 }).lean();

    return res.json({ success: true, announcements, count: announcements.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /admin/announcements/:id */
router.put('/admin/announcements/:id', seniorGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid announcement ID.' });
    }

    var ann = await AlumniAnnouncement.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!ann) {
      return res.status(404).json({ success: false, message: 'Announcement not found.' });
    }

    var allowed = ['title','body','visibility','priority','expiresAt'];
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
   MENTORSHIP / CONTRIBUTIONS OVERSIGHT
============================================ */

/* GET /admin/mentorships */
router.get('/admin/mentorships', manageGuard, async function(req, res) {
  try {
    var filter = { schoolId: req.schoolId };
    if (req.query.status) filter.status = req.query.status;

    var mentorships = await AlumniMentorship.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, mentorships, count: mentorships.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /admin/contributions */
router.get('/admin/contributions', manageGuard, async function(req, res) {
  try {
    var filter = { schoolId: req.schoolId };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.type)   filter.contributionType = req.query.type;

    var contributions = await AlumniContribution.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    /* Summary */
    var totalFinancial = contributions
      .filter(function(c) { return c.paymentStatus === 'completed' && c.amount; })
      .reduce(function(s, c) { return s + (c.amount || 0); }, 0);

    return res.json({
      success: true, contributions, count: contributions.length,
      summary: { totalFinancialContributions: totalFinancial }
    });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /admin/contributions/:id/acknowledge */
router.put('/admin/contributions/:id/acknowledge', seniorGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid ID.' });
    }

    var contrib = await AlumniContribution.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: {
          status:             'confirmed',
          acknowledgedAt:     new Date(),
          acknowledgedBy:     req.schoolUser._id,
          acknowledgedByName: req.schoolUser.name || ''
      }},
      { new: true }
    );
    if (!contrib) {
      return res.status(404).json({ success: false, message: 'Contribution not found.' });
    }

    return res.json({ success: true, message: 'Contribution acknowledged.', contribution: contrib });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;