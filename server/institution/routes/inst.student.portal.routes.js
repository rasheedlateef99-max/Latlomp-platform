/* ============================================
   LATLOMP INSTITUTION — STUDENT PORTAL ROUTES
   ✅ PHASE P: Student Authenticated Portal

   ✅ RESTRUCTURE STAGE 4:
   Set-pin endpoint now allows class_teacher and
   department_admin to set PINs for students in
   their own class/department.

   CHANGED:
     PUT /portal/admin/students/:id/set-pin
       was: adminGuard (schoolAdminOnly)
       now: manageGuard (canManageStudents) +
            scope check inside handler

   ALL OTHER ENDPOINTS UNCHANGED:
     All student-facing endpoints use studentProtect.
     studentProtect is defined in this file and is
     completely separate from institution JWT guards.
     No student endpoint changes in this stage.
============================================ */
'use strict';

const express             = require('express');
const router              = express.Router();
const jwt                 = require('jsonwebtoken');
const bcrypt              = require('bcryptjs');

const School              = require('../models/School.model');
const SchoolStudent       = require('../models/SchoolStudent.model');
const SchoolScore         = require('../models/SchoolScore.model');
const ScoreSubmission     = require('../models/ScoreSubmission.model');
const ReportCardSettings  = require('../models/ReportCardSettings.model');
const TimetableSlot       = require('../models/Timetable.model');
const AttendanceRecord    = require('../models/Attendance.model');
const AcademicTerm        = require('../models/AcademicTerm.model');
const SchoolClass         = require('../models/Class.model');
/* P9-B: Payment routes */
const mongoose           = require('mongoose');
const SchoolPaymentClaim = require('../models/SchoolPaymentClaim.model');
const { resolvePaymentAccounts, validateClaimCurrency } = require('../services/payment.account.service');

const {
  instProtect,
  schoolAdminOnly,
  canManageStudents,      /* ✅ STAGE 4 */
  verifyStudentScope,     /* ✅ STAGE 4 */
  getEffectiveRoles       /* ✅ STAGE 4 */
} = require('../middleware/inst.auth');
const { requireActiveSubscription } = require('../middleware/inst.tenant');

/* ✅ STAGE 4: manageGuard replaces adminGuard on set-pin */
var manageGuard = [instProtect, canManageStudents,  requireActiveSubscription];

/* Kept for reference (no longer used in this file after Stage 4) */
/* var adminGuard = [instProtect, schoolAdminOnly, requireActiveSubscription]; */

/* Senior roles — unrestricted scope */
var SENIOR_ROLES = ['school_admin', 'principal', 'vice_principal', 'dean'];

function isUnrestricted(schoolUser) {
  var roles = getEffectiveRoles(schoolUser);
  return roles.some(function (r) { return SENIOR_ROLES.includes(r); });
}

/* ============================================
   STUDENT JWT HELPERS (unchanged from Phase P)
============================================ */
function signStudentToken(studentId, schoolId) {
  return jwt.sign(
    {
      studentId: studentId.toString(),
      schoolId:  schoolId.toString(),
      role:      'student'
    },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function studentProtect(req, res, next) {
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
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired session. Please log in again.'
    });
  }
}

async function subscriptionActive(schoolId) {
  var school = await School.findById(schoolId);
  return school && school.isSubscriptionActive;
}

/* ============================================
   POST /portal/login (unchanged)
============================================ */
router.post('/portal/login', async function (req, res) {
  try {
    var body        = req.body || {};
    var schoolSlug  = body.schoolSlug;
    var admissionNo = body.admissionNo ? String(body.admissionNo).trim() : '';
    var studentCode = body.studentCode ? String(body.studentCode).trim() : '';
    var pin         = body.pin         ? String(body.pin).trim()         : '';

    if (!schoolSlug) {
      return res.status(400).json({ success: false, message: 'School identifier is required.' });
    }
    if (!admissionNo && !studentCode) {
      return res.status(400).json({ success: false, message: 'Admission number or student ID is required.' });
    }
    if (!pin) {
      return res.status(400).json({ success: false, message: 'PIN is required.' });
    }

    var school = await School.findOne({ slug: schoolSlug.trim() });
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found. Please check your login link.' });
    }
    if (!school.isSubscriptionActive) {
      return res.status(403).json({ success: false, message: 'Your school subscription is not active. Contact your school administrator.' });
    }

    /* ✅ E6: Allow 'graduated' students to log in (alumni PIN access) */
    var studentQuery = { schoolId: school._id, status: { $in: ['active', 'graduated'] } };
    if (admissionNo) { studentQuery.admissionNo = admissionNo; }
    else             { studentQuery.studentId   = studentCode; }

    var student = await SchoolStudent.findOne(studentQuery).populate('classId', 'name');
    if (!student) {
      return res.status(401).json({ success: false, message: 'Student not found or account is inactive. Check your details or contact your school.' });
    }
    if (!student.pinCode) {
      return res.status(401).json({ success: false, message: 'No PIN has been set for this account. Please contact your school administrator.' });
    }

    var pinMatch = await bcrypt.compare(pin, student.pinCode);
    if (!pinMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect PIN. Please try again.' });
    }

    var token = signStudentToken(student._id, school._id);

    return res.status(200).json({
      success: true,
      message: 'Welcome, ' + student.name + '!',
      token:   token,
      student: {
        _id:             student._id,
        name:            student.name,
        admissionNo:     student.admissionNo      || '',
        studentCode:     student.studentId        || '',
        gender:          student.gender           || '',
        passportPhotoUrl:student.passportPhotoUrl || '',
        className:       student.classId ? student.classId.name : '',
        classId:         student.classId ? student.classId._id  : null
      },
      school: {
        _id:          school._id,
        name:         school.name,
        logo:         school.logo         || '',
        primaryColor: school.primaryColor || '#6c63ff'
      }
    });
  } catch (err) {
    console.error('[student.portal] POST /login:', err.message);
    return res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
  }
});

/* ============================================
   GET /portal/me (unchanged)
============================================ */
router.get('/portal/me', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }
    var [student, school] = await Promise.all([
      SchoolStudent.findOne({ _id: req.studentId, schoolId: req.schoolId })
        .populate('classId', 'name').lean(),
      School.findById(req.schoolId)
        .select('name logo primaryColor address state attendanceMode').lean()
    ]);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }
    return res.json({
      success: true,
      student: {
        _id:             student._id,
        name:            student.name,
        admissionNo:     student.admissionNo      || '',
        studentCode:     student.studentId        || '',
        gender:          student.gender           || '',
        dateOfBirth:     student.dateOfBirth      || null,
        passportPhotoUrl:student.passportPhotoUrl || '',
        parentName:      student.parentName       || '',
        parentPhone:     student.parentPhone      || '',
        className:       student.classId ? student.classId.name : '',
        classId:         student.classId ? student.classId._id  : null
      },
      school: school
    });
  } catch (err) {
    console.error('[student.portal] GET /me:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /portal/terms (unchanged)
============================================ */
router.get('/portal/terms', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }
    var terms = await AcademicTerm.find({ schoolId: req.schoolId, isActive: true })
      .sort({ session: -1, term: 1 })
      .select('name session term isCurrent').lean();
    return res.json({ success: true, terms: terms });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /portal/scores (unchanged)
============================================ */
router.get('/portal/scores', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }
    var student = await SchoolStudent.findOne({ _id: req.studentId, schoolId: req.schoolId })
      .select('classId').lean();
    if (!student || !student.classId) {
      return res.status(404).json({ success: false, message: 'Student class not found.' });
    }

    var termId = req.query.termId || null;
    if (!termId) {
      var currentTerm = await AcademicTerm.findOne({ schoolId: req.schoolId, isCurrent: true }).lean();
      if (currentTerm) { termId = currentTerm._id; }
    }

    var subFilter = {
      schoolId: req.schoolId, classId: student.classId,
      status: 'approved', releasedToStudents: true
    };
    if (termId) { subFilter.termId = termId; }

    var releasedSubs = await ScoreSubmission.find(subFilter).select('subjectId').lean();
    if (releasedSubs.length === 0) {
      return res.json({ success: true, termId: termId, scores: [], message: 'No scores have been released yet.' });
    }

    var releasedSubjectIds = releasedSubs.map(function (s) { return s.subjectId; });
    var scoreFilter = { schoolId: req.schoolId, studentId: req.studentId, subjectId: { $in: releasedSubjectIds } };
    if (termId) { scoreFilter.termId = termId; }

    var scores = await SchoolScore.find(scoreFilter)
      .populate('subjectId', 'name code').populate('termId', 'name session')
      .sort({ 'subjectId.name': 1 }).lean();

    return res.json({
      success: true, termId: termId,
      scores: scores.map(function (s) {
        return {
          _id:          s._id,
          subjectName:  (s.subjectId && s.subjectId.name) || '',
          subjectCode:  (s.subjectId && s.subjectId.code) || '',
          term:         s.termId ? s.termId.name + ' — ' + s.termId.session : '',
          scores:       s.scores || {},
          total:        s.total        || 0,
          maxPossible:  s.maxPossible  || 0,
          percentage:   s.percentage   || 0,
          grade:        s.grade        || '—',
          remark:       s.remark       || '—',
          position:     s.position     || null,
          positionOutOf:s.positionOutOf || null
        };
      })
    });
  } catch (err) {
    console.error('[student.portal] GET /scores:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /portal/report-card (unchanged)
============================================ */
router.get('/portal/report-card', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }
    var student = await SchoolStudent.findOne({ _id: req.studentId, schoolId: req.schoolId })
      .select('classId name admissionNo studentId gender dateOfBirth').lean();
    if (!student || !student.classId) {
      return res.status(404).json({ success: false, message: 'Student or class not found.' });
    }

    var termId = req.query.termId || null;
    if (!termId) {
      var currentTerm = await AcademicTerm.findOne({ schoolId: req.schoolId, isCurrent: true }).lean();
      if (currentTerm) { termId = currentTerm._id; }
    }
    if (!termId) {
      return res.json({ success: true, released: false, message: 'No current term found.' });
    }

    var term     = await AcademicTerm.findById(termId).select('name session term').lean();
    var settings = await ReportCardSettings.findOne({
      schoolId: req.schoolId, classId: student.classId, termId: termId
    }).lean();

    if (!settings || !settings.isReleased) {
      return res.json({ success: true, released: false, message: 'Your report card has not been released yet. Please check back later.' });
    }

    var teacherComment = '';
    if (settings.studentComments) {
      var sid = req.studentId.toString();
      teacherComment = (typeof settings.studentComments.get === 'function')
        ? (settings.studentComments.get(sid) || '')
        : (settings.studentComments[sid]     || '');
    }

    return res.json({
      success: true, released: true, term: term,
      principalComment: settings.principalComment || '',
      resumptionDate:   settings.resumptionDate   || null,
      teacherComment:   teacherComment,
      classId:          student.classId,
      termId:           termId
    });
  } catch (err) {
    console.error('[student.portal] GET /report-card:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /portal/timetable (unchanged)
============================================ */
router.get('/portal/timetable', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }
    var student = await SchoolStudent.findOne({ _id: req.studentId, schoolId: req.schoolId })
      .select('classId').lean();
    if (!student || !student.classId) {
      return res.status(404).json({ success: false, message: 'Student class not found.' });
    }
    var [slots, school] = await Promise.all([
      TimetableSlot.find({ schoolId: req.schoolId, classId: student.classId, isActive: true })
        .populate('subjectId', 'name code').populate('teacherId', 'name').sort({ period: 1 }).lean(),
      School.findById(req.schoolId).select('timetablePeriods').lean()
    ]);
    var periods = (school && school.timetablePeriods && school.timetablePeriods.length > 0)
      ? school.timetablePeriods : [];
    var grouped = { monday:[], tuesday:[], wednesday:[], thursday:[], friday:[], saturday:[] };
    slots.forEach(function (slot) {
      if (grouped[slot.day]) {
        grouped[slot.day].push({
          period:      slot.period,
          subjectName: (slot.subjectId && slot.subjectId.name) || slot.subjectName || '',
          teacherName: (slot.teacherId && slot.teacherId.name) || slot.teacherName || '',
          room:        slot.room || '', color: slot.color || '',
          isBreak:     slot.isBreak || false,
          startTime:   slot.startTime || '', endTime: slot.endTime || ''
        });
      }
    });
    return res.json({ success: true, periods: periods, grouped: grouped, total: slots.length });
  } catch (err) {
    console.error('[student.portal] GET /timetable:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /portal/attendance (unchanged)
============================================ */
router.get('/portal/attendance', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }
    var filter = { schoolId: req.schoolId, studentId: req.studentId };
    if (req.query.termId) { filter.termId = req.query.termId; }

    var [totalsAgg, records] = await Promise.all([
      AttendanceRecord.aggregate([
        { $match: filter },
        { $group: {
          _id: null,
          presentCount: { $sum: { $cond: [{ $in: ['$status', ['present','late']] }, 1, 0] } },
          absentCount:  { $sum: { $cond: [{ $eq:  ['$status', 'absent']          }, 1, 0] } },
          lateCount:    { $sum: { $cond: [{ $eq:  ['$status', 'late']            }, 1, 0] } },
          excusedCount: { $sum: { $cond: [{ $eq:  ['$status', 'excused']         }, 1, 0] } },
          total:        { $sum: 1 }
        }}
      ]),
      AttendanceRecord.find(filter).sort({ date: -1, period: 1 }).limit(30).lean()
    ]);
    var t   = totalsAgg.length > 0 ? totalsAgg[0]
      : { presentCount: 0, absentCount: 0, lateCount: 0, excusedCount: 0, total: 0 };
    var pct = t.total > 0 ? Math.round((t.presentCount / t.total) * 100) : 0;
    return res.json({
      success: true,
      totals: { presentCount: t.presentCount, absentCount: t.absentCount,
                lateCount: t.lateCount, excusedCount: t.excusedCount,
                total: t.total, percentage: pct },
      records: records.map(function (r) {
        return { date: r.date, period: r.period || null, status: r.status, notes: r.notes || '' };
      })
    });
  } catch (err) {
    console.error('[student.portal] GET /attendance:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E2: GET /portal/portfolio
   Student's own academic portfolio.
   Read-only. Released scores only.
   No confidential entries.
============================================ */
router.get('/portal/portfolio', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }

    var portfolioService = require('../services/portfolio.service');
    var data = await portfolioService.getPortfolioData(
      req.studentId,
      req.schoolId,
      {
        releasedScoresOnly:  true,  /* student sees only released scores */
        includeConfidential: false  /* student never sees confidential entries */
      }
    );

    if (!data) {
      return res.status(404).json({ success: false, message: 'Portfolio not found.' });
    }

    return res.json({ success: true, portfolio: data });
  } catch (err) {
    console.error('[student.portal] GET /portfolio:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E4: GET /portal/timeline
   Student's own chronological academic timeline.
   No confidential entries. Only released archive records.
   Query: ?type= &session=
============================================ */
router.get('/portal/timeline', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }

    var timelineService = require('../services/timeline.service');

    var result = await timelineService.getTimeline(
      req.studentId,
      req.schoolId,
      {
        includeConfidential: false, /* student never sees confidential */
        includeAdmin:        false, /* student never sees rolled_back events */
        releasedResultsOnly: true,  /* only released archive records */
        filterType:          req.query.type    || null,
        filterSession:       req.query.session || null,
        filterTermId:        req.query.termId  || null
      }
    );

    if (!result) {
      return res.status(404).json({ success: false, message: 'Timeline not found.' });
    }

    /* Strip sensitive fields not appropriate for student self-view */
    result.student.parentInfo = undefined;
    result.timeline.forEach(function(event) {
      /* Remove batch-level administrative metadata from student view */
      if (event.metadata && event.metadata.batchRef) {
        delete event.metadata.batchRef;
        delete event.metadata.batchStatus;
      }
      /* Ensure no confidential flag leaks */
      if (event.metadata) { delete event.metadata.isConfidential; }
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[student.portal] GET /portal/timeline:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E4: GET /portal/timeline/summary
   Lightweight event counts for student dashboard widget.
============================================ */
router.get('/portal/timeline/summary', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }

    var timelineService = require('../services/timeline.service');
    var summary = await timelineService.getTimelineSummary(req.studentId, req.schoolId);

    if (!summary) {
      return res.status(404).json({ success: false, message: 'Not found.' });
    }

    return res.json({ success: true, summary });
  } catch (err) {
    console.error('[student.portal] GET /portal/timeline/summary:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E5: GET /portal/transcripts
   Student's own issued transcripts.
============================================ */
router.get('/portal/transcripts', studentProtect, async function(req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }

    var TranscriptRequest = require('../models/TranscriptRequest.model');
    var transcripts = await TranscriptRequest.find({
      schoolId:  req.schoolId,
      studentId: req.studentId,
      status:    { $in: ['issued', 'superseded', 'revoked'] }
    })
    .select('status version scope verificationId issuedAt revokedAt signature algorithm')
    .sort({ version: -1 })
    .lean();

    var appUrl = (process.env.APP_URL || 'https://latlompsystem.up.railway.app').replace(/\/$/, '');

    var result = transcripts.map(function(t) {
      return {
        _id:            t._id,
        status:         t.status,
        version:        t.version,
        scope:          t.scope,
        verificationId: t.verificationId || null,
        verificationUrl:t.verificationId
          ? appUrl + '/institution/transcript-verify.html?ref=' + t.verificationId : null,
        issuedAt:       t.issuedAt,
        isSigned:       !!t.signature,
        algorithm:      t.algorithm || null,
        isValid:        t.status === 'issued'
      };
    });

    return res.json({ success: true, transcripts: result, count: result.length });
  } catch(err) {
    console.error('[student.portal] GET /portal/transcripts:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E5: POST /portal/transcripts/request
   Student self-requests a transcript.
============================================ */
router.post('/portal/transcripts/request', studentProtect, async function(req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }

    var School = require('../models/School.model');
    var school = await School.findById(req.schoolId)
      .select('settings name').lean();

    /* Check school settings — institution may restrict self-request */
    var selfRequestAllowed = school && school.settings &&
      school.settings.transcriptSelfRequestEnabled !== false;
    /* Default: allowed (can be restricted via settings) */

    if (!selfRequestAllowed) {
      return res.status(403).json({
        success: false,
        message: 'Self-service transcript requests are not enabled for this institution. Please contact the school office.'
      });
    }

    var TranscriptRequest = require('../models/TranscriptRequest.model');
    var existing = await TranscriptRequest.findOne({
      schoolId:  req.schoolId,
      studentId: req.studentId,
      status:    { $in: ['requested', 'generating'] }
    }).select('_id status').lean();
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A transcript request is already in progress. Please wait for it to be issued.'
      });
    }

    var transcriptService = require('../services/transcript.service');
    var transcript = await transcriptService.requestTranscript(
      req.studentId,
      req.schoolId,
      { type: 'full', sessions: [] },
      null, /* no staff actor */
      'student_self'
    );

    return res.status(201).json({
      success:      true,
      message:      'Transcript request submitted. The institution will issue it when ready.',
      transcriptId: transcript._id,
      status:       transcript.status
    });
  } catch(err) {
    console.error('[student.portal] POST /portal/transcripts/request:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E5: GET /portal/transcripts/:id/download
   Student downloads own issued transcript.
============================================ */
router.get('/portal/transcripts/:id/download', studentProtect, async function(req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }

    var mongoose           = require('mongoose');
    var TranscriptRequest  = require('../models/TranscriptRequest.model');
    var pdfService         = require('../services/result.pdf.service');
    var transcriptService  = require('../services/transcript.service');

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid transcript ID.' });
    }

    var transcript = await TranscriptRequest.findOne({
      _id:       req.params.id,
      schoolId:  req.schoolId,
      studentId: req.studentId, /* ownership enforced — student can only access OWN transcript */
      status:    'issued'
    }).lean();

    if (!transcript) {
      return res.status(404).json({ success: false, message: 'Transcript not found or not yet issued.' });
    }

    var pdfBuffer;
    if (transcript.storage && transcript.storage.url && transcript.storage.provider !== 'error') {
      try { pdfBuffer = await pdfService.retrieveDocument(transcript.storage); }
      catch(e) { /* fall through to regenerate */ }
    }

    if (!pdfBuffer) {
      var assembled = await transcriptService.assembleCanonicalTranscriptData(
        req.studentId, req.schoolId, transcript.scope
      );
      if (!assembled) {
        return res.status(404).json({ success: false, message: 'Academic data not found.' });
      }
      assembled.canonicalData.transcriptId = transcript._id.toString();
      assembled.canonicalData.version      = transcript.version;
      assembled.canonicalData.issuedAt     = transcript.issuedAt
        ? new Date(transcript.issuedAt).toISOString() : new Date().toISOString();

      var appUrl = (process.env.APP_URL || 'https://latlompsystem.up.railway.app').replace(/\/$/, '');
      pdfBuffer = await transcriptService.generateTranscriptPDF(assembled.canonicalData, {
        school:          assembled.raw.school,
        student:         assembled.raw.student,
        verificationId:  transcript.verificationId,
        verificationUrl: appUrl + '/institution/transcript-verify.html?ref=' + transcript.verificationId,
        issuedAt:        transcript.issuedAt,
        keyId:           transcript.signingKeyId
      });
    }

    var studentName = '';
    try {
      var SchoolStudent = require('../models/SchoolStudent.model');
      var st = await SchoolStudent.findById(req.studentId).select('name').lean();
      if (st) { studentName = st.name.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_'); }
    } catch(e) {}

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Transcript_' + studentName + '_v' + transcript.version + '.pdf"');
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.end(pdfBuffer);
  } catch(err) {
    console.error('[student.portal] GET /portal/transcripts/:id/download:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E3: GET /portal/archive/history
   Lists academic terms with released scores.
   Student sees only released terms.
============================================ */
router.get('/portal/archive/history', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }

    var archiveService = require('../services/result.archive.service');
    var history = await archiveService.getStudentTermHistory(
      req.studentId, req.schoolId, { releasedOnly: true }
    );

    return res.json({ success: true, history, count: history.length });
  } catch (err) {
    console.error('[student.portal] GET /archive/history:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E3: GET /portal/archive/term/:termId
   Full report data for one term (student's own).
   Only released results included.
============================================ */
router.get('/portal/archive/term/:termId', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }

    var archiveService = require('../services/result.archive.service');
    var data = await archiveService.assembleReportData(
      req.studentId, req.schoolId, req.params.termId,
      { releasedOnly: true }
    );

    if (!data) {
      return res.status(404).json({ success: false, message: 'Academic record not found.' });
    }
    if (data.notReleased) {
      return res.status(403).json({
        success:    false,
        message:    'Results for ' + (data.termName || 'this term') + ' have not been released yet.',
        notReleased:true
      });
    }

    return res.json({ success: true, data });
  } catch (err) {
    console.error('[student.portal] GET /archive/term:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E3: GET /portal/archive/term/:termId/pdf
   Download own released report card as PDF.
   Only released terms accessible.
============================================ */
router.get('/portal/archive/term/:termId/pdf', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }

    var archiveService = require('../services/result.archive.service');
    var pdfService     = require('../services/result.pdf.service');

    /* Check for stored PDF first */
    var ResultArchiveRecord = require('../models/ResultArchiveRecord.model');
    var stored = await ResultArchiveRecord.findOne({
      schoolId:  req.schoolId,
      studentId: req.studentId,
      termId:    req.params.termId,
      status:    { $in: ['generated', 'issued'] }
    }).lean();

    var pdfBuffer;
    var studentName = '';
    try {
      var SchoolStudent = require('../models/SchoolStudent.model');
      var st = await SchoolStudent.findOne({ _id: req.studentId, schoolId: req.schoolId })
                                  .select('name').lean();
      if (st) { studentName = st.name.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_'); }
    } catch (e) {}

    if (stored && stored.storage && stored.storage.url && stored.storage.provider !== 'error') {
      try {
        pdfBuffer = await pdfService.retrieveDocument(stored.storage);
      } catch (e) { /* fall through to regenerate */ }
    }

    if (!pdfBuffer) {
      /* Assemble fresh (released only) + generate */
      var reportData = await archiveService.assembleReportData(
        req.studentId, req.schoolId, req.params.termId, { releasedOnly: true }
      );
      if (!reportData) {
        return res.status(404).json({ success: false, message: 'Report not found.' });
      }
      if (reportData.notReleased) {
        return res.status(403).json({
          success: false,
          message: 'Results for this term have not been released yet.'
        });
      }
      try {
        pdfBuffer = await pdfService.generateReportCardPDF(reportData);
      } catch (pdfErr) {
        if (pdfErr.message && pdfErr.message.includes('pdfkit')) {
          return res.status(503).json({ success: false, message: 'PDF service temporarily unavailable.' });
        }
        throw pdfErr;
      }
    }

    var AcademicTerm = require('../models/AcademicTerm.model');
    var term = await AcademicTerm.findById(req.params.termId).select('name session').lean();
    var termLabel = term ? (term.session || term.name) : '';
    var filename  = 'ReportCard_' + studentName + '_' + termLabel + '.pdf';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.end(pdfBuffer);
  } catch (err) {
    console.error('[student.portal] GET /archive/term/pdf:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E3: GET /portal/archive/term/:termId/excel
   Download own released result as Excel.
============================================ */
router.get('/portal/archive/term/:termId/excel', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }

    var archiveService = require('../services/result.archive.service');
    var reportData = await archiveService.assembleReportData(
      req.studentId, req.schoolId, req.params.termId, { releasedOnly: true }
    );

    if (!reportData)          { return res.status(404).json({ success: false, message: 'Report not found.' }); }
    if (reportData.notReleased) {
      return res.status(403).json({ success: false, message: 'Results not yet released.' });
    }

    var excelBuffer = archiveService.generateExcel(reportData);
    var AcademicTerm = require('../models/AcademicTerm.model');
    var term = await AcademicTerm.findById(req.params.termId).select('name session').lean();
    var termLabel = term ? (term.session || term.name) : '';
    var filename  = 'Results_' + termLabel + '.xlsx';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    return res.end(excelBuffer);
  } catch (err) {
    console.error('[student.portal] GET /archive/term/excel:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /portal/admin/students/:studentId/set-pin
   ✅ STAGE 4: manageGuard + scope check.
   class_teacher can now set PINs for students
   in their own class. All other management roles
   can set PINs within their scope.
   Admin and senior staff retain full access.
============================================ */
router.put('/portal/admin/students/:studentId/set-pin', manageGuard, async function (req, res) {
  try {
    var pin = req.body && req.body.pin ? String(req.body.pin).trim() : '';
    if (!pin) {
      return res.status(400).json({ success: false, message: 'PIN is required.' });
    }
    if (pin.length < 4 || pin.length > 8) {
      return res.status(400).json({ success: false, message: 'PIN must be 4 to 8 characters.' });
    }

    var student = await SchoolStudent.findOne({
      _id: req.params.studentId, schoolId: req.schoolId
    });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    /* ✅ STAGE 4: scope check — class_teacher can only set PINs for their class */
    if (!isUnrestricted(req.schoolUser)) {
      var scopeErr = verifyStudentScope(
        req.schoolUser,
        student.classId      ? student.classId.toString()      : null,
        student.departmentId ? student.departmentId.toString() : null
      );
      if (scopeErr) {
        return res.status(403).json({ success: false, message: scopeErr });
      }
    }

    var hashed      = await bcrypt.hash(pin, 10);
    student.pinCode = hashed;
    await student.save();

    return res.json({
      success: true,
      message: 'PIN set successfully for ' + student.name + '.'
    });
  } catch (err) {
    console.error('[student.portal] PUT /set-pin:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   P9-B — STUDENT PORTAL FEE + CLAIM ROUTES

   All four routes use studentProtect (applied
   per-route, same as every other portal endpoint).

   schoolId and studentId come from req.schoolId
   and req.studentId — set by studentProtect from
   the student JWT. Never trusted from req.body.

   payerType:    'student'        (hardcoded server-side)
   submittedVia: 'student_portal' (hardcoded server-side)
   currency:     from account record (client value validated
                 then overwritten)
============================================ */

/* ============================================
   GET /portal/fees
   Allocation-based fee progress for this student.
   Reuses getStudentFeeProgress() from finance.service.js (P7).
   Each progressItem carries its own currency — no global
   school currency assumed.
============================================ */
router.get('/portal/fees', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }
    var financeService = require('../services/finance.service');
    var result = await financeService.getStudentFeeProgress(req.schoolId, req.studentId);
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'No fee information found for this student.'
      });
    }
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[student.portal] GET /portal/fees:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /portal/fees/:assignmentId/payment-accounts
   Trigger-based payment-account picker for one obligation.
   Returns applicable SchoolManualPaymentAccount records.
   Full account details (incl. accountNumber) returned —
   the student needs them to make the bank transfer.
   Access gated by studentProtect + assignment IDOR check.
============================================ */
router.get('/portal/fees/:assignmentId/payment-accounts', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }
    if (!mongoose.isValidObjectId(req.params.assignmentId)) {
      return res.status(400).json({ success: false, message: 'Invalid assignment ID.' });
    }

    var SchoolFeeAssignment = require('../models/SchoolFeeAssignment.model');
    var assignment = await SchoolFeeAssignment.findOne({
      _id:       req.params.assignmentId,
      schoolId:  req.schoolId,      /* from JWT */
      studentId: req.studentId      /* from JWT — IDOR */
    }).select('feeStructureId status balance').lean();

    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Fee assignment not found.' });
    }
    if (['paid', 'waived', 'cancelled'].includes(assignment.status)) {
      return res.status(400).json({
        success: false,
        message: 'This fee is already ' + assignment.status + '. No payment is needed.'
      });
    }
    if ((assignment.balance || 0) <= 0) {
      return res.status(400).json({ success: false, message: 'This fee has no remaining balance.' });
    }

    var accounts = await resolvePaymentAccounts({
      schoolId:       req.schoolId,
      feeStructureId: assignment.feeStructureId || null,
      campaignId:     null
    });

    if (!accounts.length) {
      return res.json({
        success:  true,
        accounts: [],
        message:  'No payment accounts currently configured. Contact the school for payment details.'
      });
    }

    return res.json({
      success:  true,
      accounts: accounts.map(function (a) {
        return {
          _id:          a._id,
          accountLabel: a.accountLabel,
          accountType:  a.accountType  || '',
          bankName:     a.bankName,
          accountName:  a.accountName,
          accountNumber:a.accountNumber,
          currency:     a.currency,
          country:      a.country      || '',
          instructions: a.instructions || '',
          displayOrder: a.displayOrder || 0
        };
      })
    });
  } catch (err) {
    console.error('[student.portal] GET /portal/fees/:id/payment-accounts:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /portal/claims
   Student submits a bank-transfer payment claim.
   Currency is validated against the selected account
   and overwritten server-side — client value discarded.
   All security fields set server-side.
============================================ */
router.post('/portal/claims', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }

    var body = req.body || {};
    var {
      assignmentId, campaignId,
      payerName, payerPhone,
      amount, currency,
      paymentAccountId,
      reference, paymentDate, evidenceUrl, note
    } = body;

    var hasAssignment = assignmentId && mongoose.isValidObjectId(assignmentId);
    var hasCampaign   = campaignId   && mongoose.isValidObjectId(campaignId);

    if (!hasAssignment && !hasCampaign) {
      return res.status(400).json({
        success: false,
        message: 'A fee assignment or campaign must be specified.'
      });
    }
    if (!payerName || !payerName.trim()) {
      return res.status(400).json({ success: false, message: 'Payer name is required.' });
    }
    var parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: false, message: 'A valid payment amount is required.' });
    }
    if (!paymentDate) {
      return res.status(400).json({ success: false, message: 'Payment date is required.' });
    }
    if (!paymentAccountId || !mongoose.isValidObjectId(paymentAccountId)) {
      return res.status(400).json({ success: false, message: 'A payment account must be selected.' });
    }

    var resolvedFeeStructureId = null;

    if (hasAssignment) {
      var SchoolFeeAssignment = require('../models/SchoolFeeAssignment.model');
      var assignment = await SchoolFeeAssignment.findOne({
        _id:       assignmentId,
        schoolId:  req.schoolId,     /* from JWT */
        studentId: req.studentId     /* from JWT — IDOR */
      }).select('feeStructureId status balance').lean();

      if (!assignment) {
        return res.status(404).json({ success: false, message: 'Fee assignment not found.' });
      }
      if (['paid', 'waived', 'cancelled'].includes(assignment.status)) {
        return res.status(400).json({
          success: false,
          message: 'This fee is already ' + assignment.status + '.'
        });
      }
      if ((assignment.balance || 0) <= 0) {
        return res.status(400).json({ success: false, message: 'This fee has no remaining balance.' });
      }
      resolvedFeeStructureId = assignment.feeStructureId || null;
    }

    if (hasCampaign) {
      var SchoolDonationCampaign = require('../models/SchoolDonationCampaign.model');
      var campaign = await SchoolDonationCampaign.findOne({
        _id:      campaignId,
        schoolId: req.schoolId,
        status:   { $in: ['active', 'paused'] }
      }).select('allowManualClaim minContribution title').lean();

      if (!campaign) {
        return res.status(404).json({ success: false, message: 'Campaign not found or closed.' });
      }
      if (!campaign.allowManualClaim) {
        return res.status(400).json({
          success: false,
          message: '"' + campaign.title + '" does not accept bank-transfer claims.'
        });
      }
      if (campaign.minContribution && parsedAmount < campaign.minContribution) {
        return res.status(400).json({
          success: false,
          message: 'The minimum contribution for this campaign has not been met.'
        });
      }
    }

    /* Currency validated + overwritten from account — never from client */
    var currencyCheck = await validateClaimCurrency(paymentAccountId, currency, req.schoolId);
    if (!currencyCheck.valid) {
      return res.status(400).json({ success: false, message: currencyCheck.message });
    }
    var authoritativeCurrency = currencyCheck.accountCurrency;

    /* Duplicate reference warning (warn, do not block) */
    var duplicateWarning = null;
    if (reference && reference.trim()) {
      var existingClaim = await SchoolPaymentClaim.findOne({
        schoolId:         req.schoolId,
        reference:        reference.trim(),
        paymentAccountId: paymentAccountId,
        status:           { $in: ['awaiting_verification', 'verified'] }
      }).select('_id payerName').lean();
      if (existingClaim) {
        duplicateWarning = 'A claim with this reference already exists. Please verify it is not a duplicate.';
      }
    }

    /* Student document for email (name already from payerName) */
    var studentDoc = await SchoolStudent.findOne({
      _id:      req.studentId,
      schoolId: req.schoolId
    }).select('name email').lean();

    /* Create claim — security fields set server-side */
    var claim = await SchoolPaymentClaim.create({
      schoolId:          req.schoolId,             /* from JWT */
      studentId:         req.studentId,            /* from JWT */
      assignmentId:      hasAssignment ? assignmentId : null,
      feeStructureId:    resolvedFeeStructureId,
      campaignId:        hasCampaign   ? campaignId   : null,
      payerId:           req.studentId,            /* server-set */
      payerType:         'student',                /* server-set */
      payerName:         payerName.trim(),
      payerPhone:        (payerPhone   || '').trim(),
      payerEmail:        (studentDoc && studentDoc.email) || '',
      amount:            parsedAmount,
      currency:          authoritativeCurrency,    /* server-authoritative */
      paymentAccountId:  paymentAccountId,
      reference:         (reference   || '').trim(),
      paymentDate:       new Date(paymentDate),
      evidenceUrl:       (evidenceUrl || '').trim(),
      note:              (note        || '').trim().substring(0, 500),
      status:            'awaiting_verification',  /* always */
      submittedVia:      'student_portal',         /* server-set */
      submittedBy:       null,
      submittedByName:   (studentDoc && studentDoc.name) || ''
    });

    var response = {
      success: true,
      message: 'Claim submitted. The Finance team will verify your transfer and update you here.',
      claim: {
        _id:         claim._id,
        status:      claim.status,
        amount:      claim.amount,
        currency:    claim.currency,
        reference:   claim.reference,
        paymentDate: claim.paymentDate,
        createdAt:   claim.createdAt
      }
    };
    if (duplicateWarning) { response.warning = duplicateWarning; }

    return res.status(201).json(response);
  } catch (err) {
    console.error('[student.portal] POST /portal/claims:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /portal/claims
   Lists this student's own portal-submitted claims.
   payerId filter ensures student only sees their own.
============================================ */
router.get('/portal/claims', studentProtect, async function (req, res) {
  try {
    if (!await subscriptionActive(req.schoolId)) {
      return res.status(403).json({ success: false, message: 'School subscription is not active.' });
    }

    var filter = {
      schoolId:     req.schoolId,      /* from JWT */
      studentId:    req.studentId,     /* from JWT */
      payerId:      req.studentId,     /* student sees only their own */
      submittedVia: 'student_portal'
    };

    var VALID_STATUSES = [
      'awaiting_verification', 'verified', 'rejected', 'needs_correction', 'cancelled'
    ];
    if (req.query.status && VALID_STATUSES.includes(req.query.status)) {
      filter.status = req.query.status;
    }

    var claims = await SchoolPaymentClaim.find(filter)
      .populate('feeStructureId',   'name category')
      .populate('campaignId',        'title category')
      .populate('paymentAccountId',  'accountLabel bankName currency')
      .populate('resultPaymentId',   'receiptNumber amount currency status verifiedAt')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({
      success: true,
      total:   claims.length,
      claims:  claims.map(function (c) {
        return {
          _id:         c._id,
          status:      c.status,
          amount:      c.amount,
          currency:    c.currency,
          payerName:   c.payerName,
          reference:   c.reference || '',
          paymentDate: c.paymentDate,
          evidenceUrl: c.evidenceUrl || '',
          note:        c.note || '',
          feeStructureId: c.feeStructureId
            ? { name: c.feeStructureId.name, category: c.feeStructureId.category }
            : null,
          campaignId: c.campaignId
            ? { title: c.campaignId.title }
            : null,
          paymentAccount: c.paymentAccountId ? {
            accountLabel: c.paymentAccountId.accountLabel,
            bankName:     c.paymentAccountId.bankName,
            currency:     c.paymentAccountId.currency
          } : null,
          rejectionReason: c.rejectionReason || '',
          correctionNote:  c.correctionNote  || '',
          reviewedAt:      c.reviewedAt      || null,
          receipt: c.resultPaymentId ? {
            receiptNumber: c.resultPaymentId.receiptNumber,
            amount:        c.resultPaymentId.amount,
            currency:      c.resultPaymentId.currency,
            verifiedAt:    c.resultPaymentId.verifiedAt
          } : null,
          createdAt: c.createdAt
        };
      })
    });
  } catch (err) {
    console.error('[student.portal] GET /portal/claims:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;