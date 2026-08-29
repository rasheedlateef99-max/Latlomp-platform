'use strict';
/* ============================================
   LATLOMP INSTITUTION — PORTFOLIO ROUTES (E2)

   Institution staff access to student portfolios.
   Student-facing endpoint lives in inst.student.portal.routes.js

   Guard conventions follow inst.student.mgmt.routes.js:
   manageGuard  — any authorized staff (canManageStudents)
   seniorGuard  — senior staff + admin (seniorStaffOrAdmin)
   adminGuard   — school admin only
============================================ */
const express          = require('express');
const router           = express.Router();
const mongoose         = require('mongoose');
const AcademicPortfolio  = require('../models/AcademicPortfolio.model');
const PortfolioEntry     = require('../models/PortfolioEntry.model');
const SchoolStudent      = require('../models/SchoolStudent.model');
const portfolioService   = require('../services/portfolio.service');
const {
  instProtect,
  schoolAdminOnly,
  seniorStaffOrAdmin,
  canManageStudents,
  getEffectiveRoles
} = require('../middleware/inst.auth');
const { requireActiveSubscription } = require('../middleware/inst.tenant');

var manageGuard = [instProtect, canManageStudents,  requireActiveSubscription];
var seniorGuard = [instProtect, seniorStaffOrAdmin, requireActiveSubscription];
var adminGuard  = [instProtect, schoolAdminOnly,    requireActiveSubscription];

var SENIOR_ROLES = ['school_admin', 'principal', 'vice_principal', 'dean'];
function isUnrestricted(schoolUser) {
  return getEffectiveRoles(schoolUser).some(function (r) { return SENIOR_ROLES.includes(r); });
}

/* ============================================
   GET /api/institution/portfolio/student/:studentId
   Full portfolio for authorized staff.
   Senior/admin: includeConfidential = true.
   Other staff:  includeConfidential = false.
============================================ */
router.get('/student/:studentId', manageGuard, async function (req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.studentId)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }

    /* Verify student belongs to this school */
    var studentCheck = await SchoolStudent.findOne({
      _id: req.params.studentId, schoolId: req.schoolId
    }).select('_id').lean();
    if (!studentCheck) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    var canSeeConfidential = isUnrestricted(req.schoolUser);

    var data = await portfolioService.getPortfolioData(
      req.params.studentId,
      req.schoolId,
      {
        releasedScoresOnly:  false,         /* staff sees all scores */
        includeConfidential: canSeeConfidential
      }
    );

    if (!data) {
      return res.status(404).json({ success: false, message: 'Portfolio not found.' });
    }

    return res.json({ success: true, data });
  } catch (err) {
    console.error('[inst.portfolio] GET /student/:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/portfolio/student/:studentId/summary
   Lightweight summary — for lists, search results.
============================================ */
router.get('/student/:studentId/summary', manageGuard, async function (req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.studentId)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }

    var summary = await portfolioService.getSummary(req.params.studentId, req.schoolId);
    if (!summary) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    return res.json({ success: true, summary });
  } catch (err) {
    console.error('[inst.portfolio] GET /student/:id/summary:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /api/institution/portfolio/student/:studentId/entries
   Add award, achievement, skill, or milestone.
   Discipline entries require senior/admin.
   Body: { entryType, title, description?, date?,
           termId?, academicYear?, evidence?,
           isConfidential? }
============================================ */
router.post('/student/:studentId/entries', manageGuard, async function (req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.studentId)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }

    var { entryType, title, description, date, termId, academicYear, evidence, isConfidential } = req.body;

    var validTypes = ['award', 'achievement', 'skill', 'milestone', 'discipline_ref'];
    if (!validTypes.includes(entryType)) {
      return res.status(400).json({ success: false, message: 'Invalid entry type.' });
    }
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Title is required.' });
    }

    /* Discipline entries require senior staff or admin */
    if (entryType === 'discipline_ref' && !isUnrestricted(req.schoolUser)) {
      return res.status(403).json({
        success: false,
        message: 'Disciplinary records can only be added by senior staff or administrators.'
      });
    }

    /* Verify student belongs to this school */
    var student = await SchoolStudent.findOne({
      _id: req.params.studentId, schoolId: req.schoolId
    }).select('name').lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    /* Ensure portfolio exists */
    var portfolio = await portfolioService.ensurePortfolio(req.params.studentId, req.schoolId);
    if (!portfolio) {
      return res.status(404).json({ success: false, message: 'Portfolio could not be created.' });
    }

    /* discipline_ref is always confidential */
    var effectiveConfidential = (entryType === 'discipline_ref') ? true : !!isConfidential;

    var entry = await PortfolioEntry.create({
      schoolId:       req.schoolId,
      studentId:      req.params.studentId,
      portfolioId:    portfolio._id,
      entryType,
      title:          title.trim(),
      description:    (description || '').trim(),
      date:           date    || null,
      termId:         termId  || null,
      academicYear:   (academicYear || '').trim(),
      evidence:       (evidence || '').trim(),
      isConfidential: effectiveConfidential,
      issuedBy:       req.schoolUser._id,
      issuedByName:   req.schoolUser.name || ''
    });

    await entry.populate('issuedBy', 'name email');
    await entry.populate('termId', 'name session');

    return res.status(201).json({
      success: true,
      message: entryType.replace('_', ' ') + ' added to ' + student.name + "'s portfolio.",
      entry
    });
  } catch (err) {
    console.error('[inst.portfolio] POST /entries:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /api/institution/portfolio/student/:studentId/entries/:entryId
   Update an existing entry (non-discipline only for regular staff).
============================================ */
router.put('/student/:studentId/entries/:entryId', manageGuard, async function (req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.studentId) || !mongoose.isValidObjectId(req.params.entryId)) {
      return res.status(400).json({ success: false, message: 'Invalid ID.' });
    }

    var entry = await PortfolioEntry.findOne({
      _id:       req.params.entryId,
      studentId: req.params.studentId,
      schoolId:  req.schoolId,
      status:    'active'
    });
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Entry not found.' });
    }

    /* Discipline entries restricted to senior/admin */
    if (entry.isConfidential && !isUnrestricted(req.schoolUser)) {
      return res.status(403).json({
        success: false,
        message: 'Confidential entries can only be modified by senior staff or administrators.'
      });
    }

    var allowed = ['title', 'description', 'date', 'evidence', 'academicYear'];
    allowed.forEach(function (f) {
      if (req.body[f] !== undefined) { entry[f] = req.body[f]; }
    });
    if (req.body.termId !== undefined) { entry.termId = req.body.termId || null; }

    await entry.save();
    await entry.populate('issuedBy', 'name email');
    await entry.populate('termId',   'name session');

    return res.json({ success: true, message: 'Entry updated.', entry });
  } catch (err) {
    console.error('[inst.portfolio] PUT /entries/:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   DELETE /api/institution/portfolio/student/:studentId/entries/:entryId
   Revoke entry (soft delete — preserves audit trail).
============================================ */
router.delete('/student/:studentId/entries/:entryId', seniorGuard, async function (req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.studentId) || !mongoose.isValidObjectId(req.params.entryId)) {
      return res.status(400).json({ success: false, message: 'Invalid ID.' });
    }

    var entry = await PortfolioEntry.findOne({
      _id:       req.params.entryId,
      studentId: req.params.studentId,
      schoolId:  req.schoolId
    });
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Entry not found.' });
    }

    entry.status        = 'revoked';
    entry.revokedReason = (req.body.reason || 'Removed by senior staff').trim();
    entry.revokedBy     = req.schoolUser._id;
    entry.revokedAt     = new Date();
    await entry.save();

    return res.json({ success: true, message: 'Entry revoked.' });
  } catch (err) {
    console.error('[inst.portfolio] DELETE /entries/:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/portfolio/student/:studentId/entries
   List all entries for a student (type filter optional).
   Query: ?entryType=award|achievement|skill|milestone|discipline_ref
============================================ */
router.get('/student/:studentId/entries', manageGuard, async function (req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.studentId)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }

    var canSeeConfidential = isUnrestricted(req.schoolUser);
    var filter = {
      schoolId:  req.schoolId,
      studentId: req.params.studentId,
      status:    'active'
    };
    if (!canSeeConfidential) {
      filter.isConfidential = { $ne: true };
    }
    if (req.query.entryType) {
      filter.entryType = req.query.entryType;
    }

    var entries = await PortfolioEntry.find(filter)
      .populate('issuedBy', 'name email')
      .populate('termId',   'name session')
      .sort({ date: -1, createdAt: -1 })
      .lean();

    return res.json({ success: true, count: entries.length, entries });
  } catch (err) {
    console.error('[inst.portfolio] GET /entries:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /api/institution/portfolio/student/:studentId/lifecycle
   Admin-only: manually update portfolio lifecycle status.
   Normally this is done automatically by Phase S.
   Body: { portfolioStatus, reason? }
============================================ */
router.put('/student/:studentId/lifecycle', adminGuard, async function (req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.studentId)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }

    var validStatuses = ['active', 'graduated', 'alumni', 'transferred', 'archived', 'inactive'];
    var { portfolioStatus } = req.body;
    if (!validStatuses.includes(portfolioStatus)) {
      return res.status(400).json({ success: false, message: 'Invalid portfolio status.' });
    }

    var portfolio = await AcademicPortfolio.findOneAndUpdate(
      { studentId: req.params.studentId, schoolId: req.schoolId },
      { $set: { portfolioStatus, lastComputedAt: null } },
      { new: true }
    );
    if (!portfolio) {
      /* Portfolio may not exist yet — ensure it */
      portfolio = await portfolioService.ensurePortfolio(req.params.studentId, req.schoolId);
      if (portfolio) {
        await AcademicPortfolio.findByIdAndUpdate(portfolio._id, { $set: { portfolioStatus } });
      }
    }

    return res.json({
      success: true,
      message: 'Portfolio lifecycle updated to "' + portfolioStatus + '".',
      portfolioStatus
    });
  } catch (err) {
    console.error('[inst.portfolio] PUT /lifecycle:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E4: GET /api/institution/portfolio/student/:studentId/timeline
   Full academic timeline for authorized staff.
   Senior/admin: includeConfidential=true.
   Other staff:  includeConfidential=false.
   Query: ?type= &session= &termId= &includeAdmin=1
============================================ */
router.get('/student/:studentId/timeline', manageGuard, async function (req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.studentId)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }

    var timelineService = require('../services/timeline.service');
    var canSeeConfidential = isUnrestricted(req.schoolUser);
    var canSeeAdmin        = isUnrestricted(req.schoolUser); /* rolled_back events */

    var result = await timelineService.getTimeline(
      req.params.studentId,
      req.schoolId,
      {
        includeConfidential: canSeeConfidential,
        includeAdmin:        canSeeAdmin && req.query.includeAdmin === '1',
        releasedResultsOnly: false, /* staff sees all archive records */
        filterType:          req.query.type    || null,
        filterSession:       req.query.session || null,
        filterTermId:        req.query.termId  || null
      }
    );

    if (!result) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[inst.portfolio] GET /student/:id/timeline:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   ✅ E4: GET /api/institution/portfolio/student/:studentId/timeline/summary
   Lightweight counts for dashboard widgets.
============================================ */
router.get('/student/:studentId/timeline/summary', manageGuard, async function (req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.studentId)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }

    var timelineService = require('../services/timeline.service');
    var summary = await timelineService.getTimelineSummary(req.params.studentId, req.schoolId);
    if (!summary) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    return res.json({ success: true, summary });
  } catch (err) {
    console.error('[inst.portfolio] GET /student/:id/timeline/summary:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;