'use strict';
/* ============================================
   LATLOMP INSTITUTION — ALUMNI SELF-SERVICE (E6)

   alumniProtect middleware defined here.
   Validates student JWT (same PIN-based token)
   + checks graduated status + active AlumniProfile.

   Alumni use the SAME token type as students.
   No second auth system. No new Google OAuth.
   PIN remains valid after graduation.
============================================ */
const express            = require('express');
const router             = express.Router();
const jwt                = require('jsonwebtoken');
const mongoose           = require('mongoose');
const AlumniProfile      = require('../models/AlumniProfile.model');
const AlumniConnection   = require('../models/AlumniConnection.model');
const AlumniEvent        = require('../models/AlumniEvent.model');
const AlumniAnnouncement = require('../models/AlumniAnnouncement.model');
const AlumniMentorship   = require('../models/AlumniMentorship.model');
const AlumniContribution = require('../models/AlumniContribution.model');
const SchoolStudent      = require('../models/SchoolStudent.model');
const TranscriptRequest  = require('../models/TranscriptRequest.model');
const School             = require('../models/School.model');

/* ============================================
   alumniProtect middleware
   Same JWT as student portal.
   Additional checks: graduated + active profile.
============================================ */
async function alumniProtect(req, res, next) {
  try {
    var authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Not authenticated. Please log in.' });
    }
    var token   = authHeader.split(' ')[1];
    var decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.studentId || decoded.role !== 'student') {
      return res.status(401).json({ success: false, message: 'Invalid token type.' });
    }
    req.studentId = decoded.studentId;
    req.schoolId  = decoded.schoolId;

    /* Verify graduated status */
    var student = await SchoolStudent.findOne({
      _id:      decoded.studentId,
      schoolId: decoded.schoolId,
      status:   'graduated'
    }).select('name admissionNo status').lean();

    if (!student) {
      return res.status(403).json({
        success: false,
        message: 'Alumni access requires a graduated status. Current students use the Student Portal.'
      });
    }

    /* Load active alumni profile */
    var alumniProfile = await AlumniProfile.findOne({
      studentId: decoded.studentId,
      schoolId:  decoded.schoolId,
      status:    'active'
    }).lean();

    if (!alumniProfile) {
      return res.status(403).json({
        success: false,
        message: 'Alumni profile not found or inactive. Please contact your institution.',
        code:    'ALUMNI_PROFILE_INACTIVE'
      });
    }

    req.alumniProfile = alumniProfile;
    req.student       = student;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired session. Please log in again.'
    });
  }
}

/* ============================================
   PROFILE ENDPOINTS
============================================ */

/* GET /api/institution/alumni/me */
router.get('/me', alumniProtect, async function(req, res) {
  try {
    var profile = await AlumniProfile.findOne({
      _id:      req.alumniProfile._id,
      schoolId: req.schoolId
    }).lean();

    var student = await SchoolStudent.findById(req.studentId)
      .select('name admissionNo studentId gender passportPhotoUrl class status joinedYear')
      .lean();

    var school = await School.findById(req.schoolId)
      .select('name logo primaryColor address phone').lean();

    return res.json({ success: true, profile, student, school });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/alumni/me */
router.put('/me', alumniProtect, async function(req, res) {
  try {
    var allowed = ['displayName','bio','location','profession','industry',
                   'organisation','skills','mentorshipAvailable','mentorshipAreas',
                   'maxMentees','directoryVisibility','contactPreferences'];
    var updates = {};
    allowed.forEach(function(f) {
      if (req.body[f] !== undefined) { updates[f] = req.body[f]; }
    });

    /* Validate directoryVisibility */
    if (updates.directoryVisibility &&
        !['private','alumni_only','public'].includes(updates.directoryVisibility)) {
      return res.status(400).json({ success: false, message: 'Invalid visibility setting.' });
    }

    /* Alumni CANNOT modify academic records — only alumni-owned fields */
    var profile = await AlumniProfile.findOneAndUpdate(
      { _id: req.alumniProfile._id, schoolId: req.schoolId },
      { $set: Object.assign(updates, { lastActiveAt: new Date() }) },
      { new: true }
    );

    return res.json({ success: true, message: 'Profile updated.', profile });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ACADEMIC HISTORY — delegates to existing services
   Alumni access their OWN records only (Q1)
============================================ */

/* GET /api/institution/alumni/me/portfolio */
router.get('/me/portfolio', alumniProtect, async function(req, res) {
  try {
    var portfolioService = require('../services/portfolio.service');
    var data = await portfolioService.getPortfolioData(
      req.studentId, req.schoolId,
      { releasedScoresOnly: true, includeConfidential: false }
    );
    if (!data) {
      return res.status(404).json({ success: false, message: 'Portfolio not found.' });
    }
    return res.json({ success: true, data });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/institution/alumni/me/timeline */
router.get('/me/timeline', alumniProtect, async function(req, res) {
  try {
    var timelineService = require('../services/timeline.service');
    var result = await timelineService.getTimeline(
      req.studentId, req.schoolId,
      {
        includeConfidential: false,
        includeAdmin:        false,
        releasedResultsOnly: true,
        filterType:          req.query.type    || null,
        filterSession:       req.query.session || null
      }
    );
    if (!result) {
      return res.status(404).json({ success: false, message: 'Timeline not found.' });
    }
    return res.json({ success: true, ...result });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/institution/alumni/me/transcripts */
router.get('/me/transcripts', alumniProtect, async function(req, res) {
  try {
    var appUrl = (process.env.APP_URL || 'https://latlompsystem.up.railway.app').replace(/\/$/, '');
    var transcripts = await TranscriptRequest.find({
      schoolId:  req.schoolId,
      studentId: req.studentId,
      status:    { $in: ['issued','superseded','revoked'] }
    })
    .select('-canonicalSnapshot -auditLog')
    .sort({ version: -1 })
    .lean();

    var result = transcripts.map(function(t) {
      return {
        _id:            t._id,
        status:         t.status,
        version:        t.version,
        scope:          t.scope,
        verificationId: t.verificationId || null,
        verificationUrl:t.verificationId
          ? (process.env.PUBLIC_TRANSCRIPT_VERIFY_URL || appUrl + '/institution/transcript-verify.html')
            + '?ref=' + t.verificationId
          : null,
        issuedAt:       t.issuedAt,
        isSigned:       !!t.signature,
        isValid:        t.status === 'issued'
      };
    });

    return res.json({ success: true, transcripts: result, count: result.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/institution/alumni/me/transcripts/request
   C3: Alumni can self-request; issuance still requires institutional approval */
router.post('/me/transcripts/request', alumniProtect, async function(req, res) {
  try {
    var existing = await TranscriptRequest.findOne({
      schoolId:  req.schoolId,
      studentId: req.studentId,
      status:    { $in: ['requested','generating'] }
    }).select('_id').lean();
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A transcript request is already in progress. Please wait for the institution to issue it.'
      });
    }

    var transcriptService = require('../services/transcript.service');
    var transcript = await transcriptService.requestTranscript(
      req.studentId, req.schoolId,
      req.body.scope || { type: 'full', sessions: [] },
      null, 'student_self'
    );

    return res.status(201).json({
      success:      true,
      message:      'Transcript request submitted. Your institution will issue it when ready.',
      transcriptId: transcript._id,
      status:       transcript.status
    });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   DIRECTORY
============================================ */

/* GET /api/institution/alumni/directory
   Returns alumni profiles visible to other alumni.
   Filters: industry, profession, mentorship, session, page
   Alumni CANNOT see other students' academic data (Q1)
*/
router.get('/directory', alumniProtect, async function(req, res) {
  try {
    var { industry, profession, mentorship, session, page, limit } = req.query;
    var pageNum  = Math.max(1, parseInt(page)  || 1);
    var limitNum = Math.min(30, parseInt(limit) || 20);
    var skip     = (pageNum - 1) * limitNum;

    var filter = {
      schoolId:            req.schoolId,
      status:              'active',
      directoryVisibility: { $in: ['alumni_only','public'] }
    };

    /* Never return own profile in directory */
    filter._id = { $ne: req.alumniProfile._id };

    if (industry)    filter.industry              = new RegExp(industry.trim(), 'i');
    if (profession)  filter.profession             = new RegExp(profession.trim(), 'i');
    if (mentorship === 'true') filter.mentorshipAvailable = true;
    if (session)     filter.graduationSession      = session;

    var [total, alumni] = await Promise.all([
      AlumniProfile.countDocuments(filter),
      AlumniProfile.find(filter)
        /* Project: only directory-safe fields. No academic data. */
        .select('displayName bio location profession industry organisation ' +
                'skills mentorshipAvailable mentorshipAreas graduationSession ' +
                'lastClassName directoryVisibility alumniSince')
        .sort({ alumniSince: -1 })
        .skip(skip).limit(limitNum)
        .lean()
    ]);

    /* Attach connection status for each result */
    var alumniIds = alumni.map(function(a) { return a._id; });
    var connections = await AlumniConnection.find({
      schoolId:   req.schoolId,
      $or: [
        { requesterId: req.alumniProfile._id, recipientId: { $in: alumniIds } },
        { recipientId: req.alumniProfile._id, requesterId: { $in: alumniIds } }
      ]
    }).select('requesterId recipientId status').lean();

    var connMap = {};
    connections.forEach(function(c) {
      var otherId = c.requesterId.toString() === req.alumniProfile._id.toString()
        ? c.recipientId.toString() : c.requesterId.toString();
      connMap[otherId] = c.status;
    });

    var result = alumni.map(function(a) {
      return Object.assign({}, a, { connectionStatus: connMap[a._id.toString()] || null });
    });

    return res.json({
      success: true,
      alumni:  result,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
    });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/institution/alumni/classmates
   Alumni from same class/session using existing classHistory.
   3 queries total. No N+1.
*/
router.get('/classmates', alumniProtect, async function(req, res) {
  try {
    var student = await SchoolStudent.findOne({
      _id: req.studentId, schoolId: req.schoolId
    }).select('classHistory').lean();

    if (!student || !student.classHistory || !student.classHistory.length) {
      return res.json({ success: true, classmates: [], count: 0 });
    }

    /* Get sessions from own classHistory */
    var ownSessions = [...new Set(student.classHistory.map(function(h) { return h.session; }).filter(Boolean))];

    /* Find other students who shared any of these sessions */
    var classmateStudentIds = await SchoolStudent.distinct('_id', {
      schoolId: req.schoolId,
      status:   'graduated',
      _id:      { $ne: req.studentId },
      'classHistory.session': { $in: ownSessions }
    });

    if (!classmateStudentIds.length) {
      return res.json({ success: true, classmates: [], count: 0 });
    }

    /* Load their alumni profiles (only alumni-visible ones) */
    var classmates = await AlumniProfile.find({
      schoolId:            req.schoolId,
      studentId:           { $in: classmateStudentIds },
      status:              'active',
      directoryVisibility: { $in: ['alumni_only','public'] }
    })
    .select('displayName profession industry graduationSession lastClassName mentorshipAvailable alumniSince')
    .sort({ alumniSince: -1 })
    .lean();

    return res.json({ success: true, classmates, count: classmates.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   CONNECTIONS (Q3 — two-level model)
============================================ */

/* GET /api/institution/alumni/connections */
router.get('/connections', alumniProtect, async function(req, res) {
  try {
    var connections = await AlumniConnection.find({
      schoolId: req.schoolId,
      $or: [
        { requesterId: req.alumniProfile._id },
        { recipientId: req.alumniProfile._id }
      ]
    })
    .sort({ updatedAt: -1 })
    .lean();

    /* Enrich with profile display info */
    var otherIds = connections.map(function(c) {
      return c.requesterId.toString() === req.alumniProfile._id.toString()
        ? c.recipientId : c.requesterId;
    });

    var profiles = await AlumniProfile.find({ _id: { $in: otherIds } })
      .select('displayName profession industry alumniSince graduationSession')
      .lean();
    var profileMap = {};
    profiles.forEach(function(p) { profileMap[p._id.toString()] = p; });

    var enriched = connections.map(function(c) {
      var otherId = c.requesterId.toString() === req.alumniProfile._id.toString()
        ? c.recipientId.toString() : c.requesterId.toString();
      return Object.assign({}, c, {
        otherProfile:  profileMap[otherId] || null,
        isRequester:   c.requesterId.toString() === req.alumniProfile._id.toString()
      });
    });

    return res.json({ success: true, connections: enriched, count: enriched.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/institution/alumni/connections/request/:targetId */
router.post('/connections/request/:targetId', alumniProtect, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.targetId)) {
      return res.status(400).json({ success: false, message: 'Invalid target profile ID.' });
    }
    if (req.params.targetId === req.alumniProfile._id.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot connect with yourself.' });
    }

    /* Verify target is in same school and visible */
    var target = await AlumniProfile.findOne({
      _id:                 req.params.targetId,
      schoolId:            req.schoolId,
      status:              'active',
      directoryVisibility: { $in: ['alumni_only','public'] }
    }).select('_id').lean();
    if (!target) {
      return res.status(404).json({ success: false, message: 'Alumni profile not found or not discoverable.' });
    }

    /* Check no existing connection */
    var existing = await AlumniConnection.findOne({
      $or: [
        { requesterId: req.alumniProfile._id, recipientId: req.params.targetId },
        { requesterId: req.params.targetId, recipientId: req.alumniProfile._id }
      ]
    }).lean();
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Connection already exists. Status: ' + existing.status
      });
    }

    var connection = await AlumniConnection.create({
      schoolId:    req.schoolId,
      requesterId: req.alumniProfile._id,
      recipientId: req.params.targetId,
      message:     (req.body.message || '').trim().substring(0, 300),
      requestedAt: new Date()
    });

    return res.status(201).json({ success: true, message: 'Connection request sent.', connection });
  } catch(err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'Connection request already sent.' });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/alumni/connections/:id/respond
   Body: { action: 'accept' | 'reject' }
*/
router.put('/connections/:id/respond', alumniProtect, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid connection ID.' });
    }
    var { action } = req.body;
    if (!['accept','reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be accept or reject.' });
    }

    var connection = await AlumniConnection.findOne({
      _id:         req.params.id,
      schoolId:    req.schoolId,
      recipientId: req.alumniProfile._id, /* only recipient can respond */
      status:      'pending'
    });
    if (!connection) {
      return res.status(404).json({ success: false, message: 'Pending connection request not found.' });
    }

    connection.status      = action === 'accept' ? 'accepted' : 'rejected';
    connection.respondedAt = new Date();
    await connection.save();

    return res.json({
      success: true,
      message: 'Connection ' + connection.status + '.',
      status:  connection.status
    });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* DELETE /api/institution/alumni/connections/:id
   Withdraw pending request or remove accepted connection.
*/
router.delete('/connections/:id', alumniProtect, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid connection ID.' });
    }

    var connection = await AlumniConnection.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId,
      $or: [
        { requesterId: req.alumniProfile._id },
        { recipientId: req.alumniProfile._id }
      ]
    });
    if (!connection) {
      return res.status(404).json({ success: false, message: 'Connection not found.' });
    }

    if (connection.status === 'pending' &&
        connection.requesterId.toString() === req.alumniProfile._id.toString()) {
      connection.status = 'withdrawn';
    } else {
      await AlumniConnection.findByIdAndDelete(connection._id);
      return res.json({ success: true, message: 'Connection removed.' });
    }
    await connection.save();
    return res.json({ success: true, message: 'Connection request withdrawn.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   EVENTS
============================================ */

/* GET /api/institution/alumni/events */
router.get('/events', alumniProtect, async function(req, res) {
  try {
    var now = new Date();
    var filter = {
      schoolId:   req.schoolId,
      status:     'published',
      visibility: 'alumni_only',
      date:       { $gte: now }
    };
    if (req.query.type) filter.eventType = req.query.type;

    var events = await AlumniEvent.find(filter)
      .select('-registrations.alumniId') /* don't expose other registrant IDs */
      .sort({ date: 1 })
      .lean();

    /* Attach own registration status per event */
    var result = events.map(function(ev) {
      var myReg = ev.registrations && ev.registrations.find(function(r) {
        return r.alumniId && r.alumniId.toString() === req.alumniProfile._id.toString();
      });
      return Object.assign({}, ev, {
        myRegistrationStatus: myReg ? myReg.status : null,
        registrantCount:      ev.registrations ? ev.registrations.filter(function(r) {
          return r.status === 'registered';
        }).length : 0,
        registrations: undefined /* remove full array from response */
      });
    });

    return res.json({ success: true, events: result, count: result.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/institution/alumni/events/:id/register */
router.post('/events/:id/register', alumniProtect, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid event ID.' });
    }

    var event = await AlumniEvent.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId,
      status:   'published'
    });
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }
    if (new Date(event.date) < new Date()) {
      return res.status(400).json({ success: false, message: 'This event has already passed.' });
    }

    /* Check existing registration */
    var existingReg = event.registrations && event.registrations.find(function(r) {
      return r.alumniId && r.alumniId.toString() === req.alumniProfile._id.toString() &&
             r.status === 'registered';
    });
    if (existingReg) {
      return res.status(400).json({ success: false, message: 'Already registered for this event.' });
    }

    /* Check capacity */
    var activeCount = event.registrations
      ? event.registrations.filter(function(r) { return r.status === 'registered'; }).length
      : 0;
    var status = (event.capacity && activeCount >= event.capacity) ? 'waitlisted' : 'registered';

    event.registrations.push({
      alumniId:     req.alumniProfile._id,
      alumniName:   req.alumniProfile.displayName || req.student.name,
      registeredAt: new Date(),
      status
    });
    await event.save();

    return res.json({
      success: true,
      message: status === 'waitlisted'
        ? 'Added to waitlist. Capacity is full.'
        : 'Registered successfully.',
      status
    });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* DELETE /api/institution/alumni/events/:id/register */
router.delete('/events/:id/register', alumniProtect, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid event ID.' });
    }

    var event = await AlumniEvent.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    var regIdx = event.registrations.findIndex(function(r) {
      return r.alumniId && r.alumniId.toString() === req.alumniProfile._id.toString() &&
             r.status !== 'cancelled';
    });
    if (regIdx === -1) {
      return res.status(404).json({ success: false, message: 'Registration not found.' });
    }

    event.registrations[regIdx].status = 'cancelled';
    await event.save();

    return res.json({ success: true, message: 'Registration cancelled.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ANNOUNCEMENTS
============================================ */

/* GET /api/institution/alumni/announcements */
router.get('/announcements', alumniProtect, async function(req, res) {
  try {
    var now = new Date();
    var filter = {
      schoolId:   req.schoolId,
      status:     'published',
      visibility: 'alumni_only',
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
    };

    var announcements = await AlumniAnnouncement.find(filter)
      .sort({ priority: -1, publishedAt: -1 })
      .lean();

    return res.json({ success: true, announcements, count: announcements.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   MENTORSHIP
============================================ */

/* GET /api/institution/alumni/mentorship */
router.get('/mentorship', alumniProtect, async function(req, res) {
  try {
    /* Return mentorships where this alumni is mentor OR mentee */
    var mentorships = await AlumniMentorship.find({
      schoolId: req.schoolId,
      $or: [
        { mentorAlumniId: req.alumniProfile._id },
        { menteeAlumniId: req.alumniProfile._id }
      ]
    }).sort({ createdAt: -1 }).lean();

    return res.json({ success: true, mentorships, count: mentorships.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/institution/alumni/mentorship/offer
   Alumni offers to mentor (mentor-initiated).
   Body: { areas, menteeType:'student'|'alumni',
           menteeAlumniId? (if alumni mentee) }
*/
router.post('/mentorship/offer', alumniProtect, async function(req, res) {
  try {
    if (!req.alumniProfile.mentorshipAvailable) {
      return res.status(400).json({
        success: false,
        message: 'Enable mentorship in your profile first.'
      });
    }
    var { menteeType } = req.body;
    if (!['student','alumni'].includes(menteeType)) {
      return res.status(400).json({ success: false, message: 'menteeType must be student or alumni.' });
    }

    /* Check max mentees */
    var activeMentorships = await AlumniMentorship.countDocuments({
      mentorAlumniId: req.alumniProfile._id,
      status:         'active'
    });
    if (activeMentorships >= (req.alumniProfile.maxMentees || 2)) {
      return res.status(400).json({
        success: false,
        message: 'You have reached your maximum active mentorships (' + (req.alumniProfile.maxMentees || 2) + ').'
      });
    }

    var menteeAlumniId = null;
    var menteeName     = '';
    if (menteeType === 'alumni' && req.body.menteeAlumniId) {
      var targetAlumni = await AlumniProfile.findOne({
        _id: req.body.menteeAlumniId, schoolId: req.schoolId, status: 'active'
      }).select('displayName').lean();
      if (!targetAlumni) {
        return res.status(404).json({ success: false, message: 'Target alumni not found.' });
      }
      menteeAlumniId = targetAlumni._id;
      menteeName     = targetAlumni.displayName || '';
    }

    var mentorship = await AlumniMentorship.create({
      schoolId:       req.schoolId,
      mentorAlumniId: req.alumniProfile._id,
      mentorName:     req.alumniProfile.displayName || req.student.name,
      menteeType,
      menteeAlumniId: menteeAlumniId || null,
      menteeName:     menteeName,
      areas:          Array.isArray(req.body.areas) ? req.body.areas : [],
      initiatedBy:    'mentor',
      status:         menteeAlumniId ? 'offered' : 'offered', /* staff matches students */
      requestMessage: (req.body.message || '').trim()
    });

    return res.status(201).json({
      success:    true,
      message:    'Mentorship offer created.',
      mentorship
    });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/alumni/mentorship/:id
   Update own mentorship (respond, cancel, complete)
*/
router.put('/mentorship/:id', alumniProtect, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid ID.' });
    }

    var mentorship = await AlumniMentorship.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId,
      $or: [
        { mentorAlumniId: req.alumniProfile._id },
        { menteeAlumniId: req.alumniProfile._id }
      ]
    });
    if (!mentorship) {
      return res.status(404).json({ success: false, message: 'Mentorship not found.' });
    }

    var { action, message } = req.body;

    if (action === 'accept' && mentorship.status === 'offered') {
      mentorship.status      = 'active';
      mentorship.startedAt   = new Date();
      mentorship.responseMessage = (message || '').trim();
    } else if (action === 'decline' && mentorship.status === 'offered') {
      mentorship.status      = 'cancelled';
      mentorship.cancelledAt = new Date();
      mentorship.cancelReason= (message || 'Declined').trim();
    } else if (action === 'complete' && mentorship.status === 'active') {
      mentorship.status      = 'completed';
      mentorship.completedAt = new Date();
      var isMentor = mentorship.mentorAlumniId.toString() === req.alumniProfile._id.toString();
      if (isMentor) { mentorship.mentorFeedback = (message || '').trim(); }
      else          { mentorship.menteeFeedback = (message || '').trim(); }
    } else if (action === 'cancel') {
      mentorship.status      = 'cancelled';
      mentorship.cancelledAt = new Date();
      mentorship.cancelReason= (message || '').trim();
      var who = mentorship.mentorAlumniId.toString() === req.alumniProfile._id.toString() ? 'mentor' : 'mentee';
      mentorship.cancelledBy = who;
    } else {
      return res.status(400).json({ success: false, message: 'Invalid action for current status.' });
    }

    await mentorship.save();
    return res.json({ success: true, message: 'Mentorship updated.', mentorship });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   CONTRIBUTIONS
============================================ */

/* GET /api/institution/alumni/contributions */
router.get('/contributions', alumniProtect, async function(req, res) {
  try {
    var contributions = await AlumniContribution.find({
      alumniProfileId: req.alumniProfile._id,
      schoolId:        req.schoolId
    }).sort({ createdAt: -1 }).lean();

    return res.json({ success: true, contributions, count: contributions.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/institution/alumni/contributions
   Non-financial contributions (volunteering, speaking, etc.)
*/
router.post('/contributions', alumniProtect, async function(req, res) {
  try {
    var { contributionType, campaign, description } = req.body;
    var financialTypes = ['donation','sponsorship'];
    if (!contributionType) {
      return res.status(400).json({ success: false, message: 'contributionType is required.' });
    }
    if (financialTypes.includes(contributionType) && !req.body.amount) {
      return res.status(400).json({
        success: false,
        message: 'Financial contributions must use /contributions/initialize for payment processing.'
      });
    }

    var contribution = await AlumniContribution.create({
      schoolId:        req.schoolId,
      alumniProfileId: req.alumniProfile._id,
      studentId:       req.studentId,
      contributionType,
      amount:          req.body.amount || null,
      currency:        req.body.currency || 'NGN',
      campaign:        (campaign    || '').trim(),
      description:     (description || '').trim(),
      status:          'pending',
      paymentStatus:   req.body.amount ? 'pending' : null
    });

    return res.status(201).json({
      success:      true,
      message:      'Contribution recorded.',
      contribution
    });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/institution/alumni/contributions/initialize
   Financial contributions via Paystack (R2 infrastructure).
   Reuses existing provider registry and school payment account.
*/
router.post('/contributions/initialize', alumniProtect, async function(req, res) {
  try {
    var { amount, currency, campaign, description, contributionType } = req.body;
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'A valid amount is required.' });
    }
    if (!['donation','sponsorship'].includes(contributionType)) {
      return res.status(400).json({ success: false, message: 'contributionType must be donation or sponsorship.' });
    }

    /* Check school has active payment account */
    var SchoolPaymentAccount = require('../models/SchoolPaymentAccount.model');
    var payAccount = await SchoolPaymentAccount.findOne({
      schoolId: req.schoolId, status: 'active', onlinePaymentsEnabled: true
    }).lean();
    if (!payAccount) {
      return res.status(400).json({
        success: false,
        message: 'This institution has not configured online payments. Please contact the school for alternative arrangements.'
      });
    }

    /* Check platform master switch */
    var PlatformConfig = require('../models/PlatformConfig.model');
    var onlineEnabled  = await PlatformConfig.getValue('online_payments_enabled', true);
    if (!onlineEnabled) {
      return res.status(503).json({ success: false, message: 'Online payments temporarily unavailable.' });
    }

    /* Calculate platform fee (same as R2 fee payment) */
    var { calculateFeeBreakdown } = require('../config/fee.config');
    var contributionAmount = parseFloat(amount);
    var effectiveCurrency  = currency || payAccount.currency || 'NGN';
    var breakdown          = await calculateFeeBreakdown(contributionAmount, effectiveCurrency);

    /* Create pending contribution */
    var reference = 'CONT-' + req.schoolId.toString().slice(-6).toUpperCase() + '-' + Date.now();
    var contribution = await AlumniContribution.create({
      schoolId:        req.schoolId,
      alumniProfileId: req.alumniProfile._id,
      studentId:       req.studentId,
      contributionType,
      amount:          contributionAmount,
      currency:        effectiveCurrency,
      paymentRef:      reference,
      paymentStatus:   'pending',
      campaign:        (campaign    || '').trim(),
      description:     (description || '').trim(),
      status:          'pending'
    });

    /* Initialize Paystack (provider registry from R2) */
    var { getProvider } = require('../providers/payment.provider');
    var provider = getProvider(payAccount.provider || 'paystack');
    var appUrl   = (process.env.APP_URL || 'https://latlompsystem.up.railway.app').replace(/\/$/, '');

    var initResult = await provider.initializePayment({
      email:             req.student.admissionNo + '@alumni.' + req.schoolId.toString().slice(-4) + '.latlomp.ng',
      schoolFeeAmount:   breakdown.schoolFeeAmount,
      platformFeeAmount: breakdown.platformFeeAmount,
      currency:          effectiveCurrency,
      subaccountCode:    payAccount.providerAccountCode,
      reference,
      callbackUrl:       appUrl + '/institution/alumni/index.html?contRef=' + reference,
      metadata: {
        type:            'alumni_contribution',
        schoolId:        req.schoolId.toString(),
        alumniProfileId: req.alumniProfile._id.toString(),
        studentId:       req.studentId,
        contributionId:  contribution._id.toString(),
        contributionType
      }
    });

    return res.json({
      success:          true,
      reference:        initResult.reference,
      authorizationUrl: initResult.authorizationUrl,
      contributionId:   contribution._id,
      breakdown: {
        currency:          effectiveCurrency,
        contributionAmount:breakdown.schoolFeeAmount,
        platformFeeAmount: breakdown.platformFeeAmount,
        totalCharged:      breakdown.totalCharged
      }
    });
  } catch(err) {
    console.error('[alumni.contributions.initialize]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/institution/alumni/contributions/verify-payment
   Called after Paystack redirect.
   Body: { reference }
*/
router.post('/contributions/verify-payment', alumniProtect, async function(req, res) {
  try {
    var { reference } = req.body;
    if (!reference) {
      return res.status(400).json({ success: false, message: 'Payment reference required.' });
    }

    /* Idempotency */
    var existing = await AlumniContribution.findOne({
      paymentRef: reference, paymentStatus: 'completed'
    }).lean();
    if (existing) {
      return res.json({ success: true, alreadyVerified: true, contributionId: existing._id });
    }

    var SchoolPaymentAccount = require('../models/SchoolPaymentAccount.model');
    var payAccount = await SchoolPaymentAccount.findOne({ schoolId: req.schoolId, status: 'active' }).lean();
    if (!payAccount) {
      return res.status(400).json({ success: false, message: 'Payment account not configured.' });
    }

    var { getProvider } = require('../providers/payment.provider');
    var provider        = getProvider(payAccount.provider || 'paystack');
    var result          = await provider.verifyPayment(reference);

    if (result.status !== 'success') {
      return res.status(400).json({ success: false, message: 'Payment not completed. Status: ' + result.status });
    }

    var contribution = await AlumniContribution.findOneAndUpdate(
      { paymentRef: reference, schoolId: req.schoolId },
      { $set: {
          paymentStatus: 'completed',
          status:        'confirmed',
          amount:        result.schoolFeeAmount
      }},
      { new: true }
    );

    return res.json({
      success:        true,
      message:        'Contribution payment confirmed.',
      contributionId: contribution ? contribution._id : null
    });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;