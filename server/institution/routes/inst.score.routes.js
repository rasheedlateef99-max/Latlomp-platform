/* ============================================
   LATLOMP INSTITUTION — SCORE ENTRY ROUTES
   ✅ PHASE L.3: Score Entry + Auto-Calculation
   ✅ PHASE L.4: Position Ranking Engine
   ✅ PHASE L.6: Score Config Update Endpoints
   ✅ PHASE L.7: Approval Workflow + Visibility

   ✅ RESTRUCTURE STAGE 3:
   Score approval authority delegated to senior staff.
   CHANGED GUARD (5 endpoints):
     GET  /submissions/pending-count → approvalGuard
     GET  /submissions              → approvalGuard
     PUT  /submissions/:id/approve  → approvalGuard
     PUT  /submissions/:id/reject   → approvalGuard
     PUT  /submissions/:id/release  → approvalGuard
   UNCHANGED (admin only — score structure config):
     PUT  /config/:id → adminGuard
     POST /config     → adminGuard
   All other route logic is identical to Phase L.7.
============================================ */
'use strict';

const express = require('express');
const router  = express.Router();

const SchoolScore        = require('../models/SchoolScore.model');
const ScoreConfig        = require('../models/ScoreConfig.model');
const SchoolStudent      = require('../models/SchoolStudent.model');
const ScoreSubmission    = require('../models/ScoreSubmission.model');

const {
  instProtect,
  teacherOrAdmin,
  schoolAdminOnly,
  seniorStaffOrAdmin          /* ✅ STAGE 3: added */
} = require('../middleware/inst.auth');
const { requireActiveSubscription } = require('../middleware/inst.tenant');

var guard         = [instProtect, teacherOrAdmin,     requireActiveSubscription];
var adminGuard    = [instProtect, schoolAdminOnly,    requireActiveSubscription];
/* ✅ STAGE 3: approval authority now includes principal, vice_principal, dean, hod */
var approvalGuard = [instProtect, seniorStaffOrAdmin, requireActiveSubscription];

/* ============================================
   Shared calculation helper (unchanged).
============================================ */
function calcScoreFromConfig(config, suppliedScores) {
  var components  = (config && config.components) || [];
  var scoresObj   = {};
  var total       = 0;
  var maxPossible = 0;
  var errors      = [];

  suppliedScores = suppliedScores || {};

  components.forEach(function (comp) {
    var raw = suppliedScores[comp.key];
    var val = (raw === undefined || raw === null || raw === '') ? 0 : Number(raw);

    if (isNaN(val)) {
      errors.push(comp.label + ' must be a number.');
      val = 0;
    } else if (val < 0) {
      errors.push(comp.label + ' cannot be negative.');
      val = 0;
    } else if (val > comp.maxScore) {
      errors.push(comp.label + ' cannot exceed ' + comp.maxScore + '.');
      val = comp.maxScore;
    }

    scoresObj[comp.key] = val;
    total       += val;
    maxPossible += comp.maxScore;
  });

  var percentage = maxPossible > 0 ? Math.round((total / maxPossible) * 100) : 0;
  var gradeInfo  = ScoreConfig.resolveGrade(config.gradeBoundaries, percentage);

  return {
    scoresObj:   scoresObj,
    total:       total,
    maxPossible: maxPossible,
    percentage:  percentage,
    grade:       gradeInfo.grade,
    remark:      gradeInfo.remark,
    errors:      errors
  };
}

/* ============================================
   GET /config
============================================ */
router.get('/config', guard, async function (req, res) {
  try {
    var config = await ScoreConfig.getOrCreateDefault(req.schoolId, req.schoolUser._id);
    return res.json({ success: true, config: config });
  } catch (err) {
    console.error('[inst.score] GET /config:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load score configuration.' });
  }
});

/* ============================================
   PUT /config/:id  (L.6) — adminGuard (unchanged)
   Score structure config remains admin-only.
============================================ */
router.put('/config/:id', adminGuard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var body     = req.body || {};

    var config = await ScoreConfig.findOne({ _id: req.params.id, schoolId: schoolId });
    if (!config) {
      return res.status(404).json({ success: false, message: 'Score configuration not found.' });
    }

    if (body.components !== undefined) {
      if (!Array.isArray(body.components) || body.components.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one score component is required.' });
      }
      var keys  = body.components.map(function (c) { return c.key; });
      var dupes = keys.filter(function (k, i) { return keys.indexOf(k) !== i; });
      if (dupes.length > 0) {
        return res.status(400).json({ success: false, message: 'Duplicate component keys: ' + [...new Set(dupes)].join(', ') });
      }
      for (var i = 0; i < body.components.length; i++) {
        var c = body.components[i];
        if (!c.key || !c.label || !c.maxScore) {
          return res.status(400).json({ success: false, message: 'Each component requires key, label, and maxScore.' });
        }
        if (c.maxScore < 1) {
          return res.status(400).json({ success: false, message: 'Component "' + c.label + '" maxScore must be at least 1.' });
        }
      }
      config.components = body.components;
    }

    if (body.gradeBoundaries !== undefined) {
      if (!Array.isArray(body.gradeBoundaries)) {
        return res.status(400).json({ success: false, message: 'gradeBoundaries must be an array.' });
      }
      for (var j = 0; j < body.gradeBoundaries.length; j++) {
        var g = body.gradeBoundaries[j];
        if (!g.grade || !g.remark) {
          return res.status(400).json({ success: false, message: 'Each grade boundary requires grade and remark.' });
        }
        if (g.minScore > g.maxScore) {
          return res.status(400).json({ success: false, message: 'Grade "' + g.grade + '": minScore cannot exceed maxScore.' });
        }
      }
      config.gradeBoundaries = body.gradeBoundaries;
    }

    if (body.name) { config.name = body.name.trim(); }
    await config.save();

    return res.json({ success: true, message: 'Score configuration updated successfully.', config: config });
  } catch (err) {
    console.error('[inst.score] PUT /config/:id:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update score configuration.' });
  }
});

/* ============================================
   POST /config  (L.6) — adminGuard (unchanged)
============================================ */
router.post('/config', adminGuard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var body     = req.body || {};

    await ScoreConfig.updateMany(
      { schoolId: schoolId, isDefault: true },
      { $set: { isDefault: false, isActive: false } }
    );

    var config = await ScoreConfig.create({
      schoolId:        schoolId,
      name:            body.name || 'Default Score Structure',
      isDefault:       true,
      isActive:        true,
      components:      body.components      || ScoreConfig.getDefaultComponents(),
      gradeBoundaries: body.gradeBoundaries || ScoreConfig.getDefaultGradeBoundaries(),
      createdBy:       req.schoolUser._id
    });

    return res.status(201).json({ success: true, message: 'Score configuration created.', config: config });
  } catch (err) {
    console.error('[inst.score] POST /config:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to create score configuration.' });
  }
});

/* ============================================
   GET /submission-status/:classId/:subjectId/:termId
   ⚠ Defined before /submit to avoid path conflict.
============================================ */
router.get('/submission-status/:classId/:subjectId/:termId', guard, async function (req, res) {
  try {
    var submission = await ScoreSubmission.findOne({
      schoolId:  req.schoolId,
      classId:   req.params.classId,
      subjectId: req.params.subjectId,
      termId:    req.params.termId
    })
      .populate('submittedBy', 'name')
      .populate('approvedBy',  'name')
      .populate('rejectedBy',  'name')
      .lean();

    return res.json({ success: true, submission: submission || null });
  } catch (err) {
    console.error('[inst.score] GET /submission-status:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /submissions/pending-count
   ✅ STAGE 3: approvalGuard — principal and
   vice_principal see pending count on their dashboard.
   ⚠ Must be before /submissions/:id
============================================ */
router.get('/submissions/pending-count', approvalGuard, async function (req, res) {
  try {
    var count = await ScoreSubmission.countDocuments({
      schoolId: req.schoolId,
      status:   'pending'
    });
    return res.json({ success: true, count: count });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /submissions
   ✅ STAGE 3: approvalGuard — senior staff can
   view all submissions to review and approve.
============================================ */
router.get('/submissions', approvalGuard, async function (req, res) {
  try {
    var { status, page, limit } = req.query;
    var filter = { schoolId: req.schoolId };
    if (status && status !== 'all') { filter.status = status; }

    var pageNum  = parseInt(page)  || 1;
    var limitNum = parseInt(limit) || 20;
    var skip     = (pageNum - 1) * limitNum;

    var [submissions, total] = await Promise.all([
      ScoreSubmission.find(filter)
        .populate('classId',   'name')
        .populate('subjectId', 'name')
        .populate('termId',    'name session')
        .populate('submittedBy', 'name email')
        .populate('approvedBy',  'name')
        .populate('rejectedBy',  'name')
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      ScoreSubmission.countDocuments(filter)
    ]);

    return res.json({
      success:     true,
      submissions: submissions,
      total:       total,
      pages:       Math.ceil(total / limitNum),
      page:        pageNum
    });
  } catch (err) {
    console.error('[inst.score] GET /submissions:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /submissions/:id/approve
   ✅ STAGE 3: approvalGuard — principal,
   vice_principal, dean, hod can now approve.
============================================ */
router.put('/submissions/:id/approve', approvalGuard, async function (req, res) {
  try {
    var sub = await ScoreSubmission.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!sub) {
      return res.status(404).json({ success: false, message: 'Submission not found.' });
    }
    if (sub.status === 'approved') {
      return res.status(400).json({ success: false, message: 'Already approved.' });
    }

    sub.status     = 'approved';
    sub.approvedBy = req.schoolUser._id;
    sub.approvedAt = new Date();
    sub.rejectionReason = '';
    await sub.save();

    await sub.populate([
      { path: 'classId',     select: 'name' },
      { path: 'subjectId',   select: 'name' },
      { path: 'termId',      select: 'name session' },
      { path: 'submittedBy', select: 'name' },
      { path: 'approvedBy',  select: 'name' }
    ]);

    return res.json({
      success:    true,
      message:    'Submission approved. Scores are now locked.',
      submission: sub
    });
  } catch (err) {
    console.error('[inst.score] PUT /submissions/:id/approve:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /submissions/:id/reject
   ✅ STAGE 3: approvalGuard
   Body: { reason: string }
============================================ */
router.put('/submissions/:id/reject', approvalGuard, async function (req, res) {
  try {
    var { reason } = req.body || {};
    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'A rejection reason is required.' });
    }

    var sub = await ScoreSubmission.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!sub) {
      return res.status(404).json({ success: false, message: 'Submission not found.' });
    }
    if (sub.status === 'rejected') {
      return res.status(400).json({ success: false, message: 'Already rejected.' });
    }

    sub.status          = 'rejected';
    sub.rejectedBy      = req.schoolUser._id;
    sub.rejectedAt      = new Date();
    sub.rejectionReason = reason.trim();
    sub.approvedBy      = null;
    sub.approvedAt      = null;
    await sub.save();

    await sub.populate([
      { path: 'classId',   select: 'name' },
      { path: 'subjectId', select: 'name' },
      { path: 'termId',    select: 'name session' },
      { path: 'submittedBy', select: 'name' },
      { path: 'rejectedBy',  select: 'name' }
    ]);

    return res.json({
      success:    true,
      message:    'Submission rejected. Teacher can revise and resubmit.',
      submission: sub
    });
  } catch (err) {
    console.error('[inst.score] PUT /submissions/:id/reject:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /submissions/:id/release
   ✅ STAGE 3: approvalGuard
============================================ */
router.put('/submissions/:id/release', approvalGuard, async function (req, res) {
  try {
    var sub = await ScoreSubmission.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!sub) {
      return res.status(404).json({ success: false, message: 'Submission not found.' });
    }
    if (sub.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Only approved submissions can be released. Approve this submission first.'
      });
    }

    sub.releasedToStudents = !sub.releasedToStudents;
    if (sub.releasedToStudents) {
      sub.releasedAt = new Date();
      sub.releasedBy = req.schoolUser._id;
    } else {
      sub.releasedAt = null;
      sub.releasedBy = null;
    }
    await sub.save();

    return res.json({
      success:            true,
      message:            sub.releasedToStudents
        ? 'Scores released to students.'
        : 'Score visibility revoked.',
      releasedToStudents: sub.releasedToStudents,
      submission:         sub
    });
  } catch (err) {
    console.error('[inst.score] PUT /submissions/:id/release:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /submit (unchanged)
============================================ */
router.post('/submit', guard, async function (req, res) {
  try {
    var { classId, subjectId, termId, academicYear } = req.body || {};

    if (!classId || !subjectId || !termId) {
      return res.status(400).json({
        success: false,
        message: 'classId, subjectId, and termId are required.'
      });
    }

    var existing = await ScoreSubmission.findOne({
      schoolId: req.schoolId, classId: classId,
      subjectId: subjectId, termId: termId
    });

    if (existing && existing.status === 'approved') {
      return res.status(400).json({
        success: false,
        message: 'These scores are already approved and cannot be resubmitted. Contact your school admin.'
      });
    }

    var scoreCount = await SchoolScore.countDocuments({
      schoolId: req.schoolId, classId: classId,
      subjectId: subjectId,   termId: termId
    });

    if (scoreCount === 0) {
      return res.status(400).json({
        success: false,
        message: 'No scores have been saved yet. Use "Save & Rank" first, then submit for approval.'
      });
    }

    var now = new Date();
    var submission = await ScoreSubmission.findOneAndUpdate(
      { schoolId: req.schoolId, classId: classId, subjectId: subjectId, termId: termId },
      {
        $set: {
          status:          'pending',
          submittedBy:     req.schoolUser._id,
          submittedAt:     now,
          academicYear:    academicYear || '',
          scoreCount:      scoreCount,
          rejectionReason: '',
          rejectedBy:      null,
          rejectedAt:      null,
          approvedBy:      null,
          approvedAt:      null
        }
      },
      { upsert: true, new: true }
    );

    await submission.populate('submittedBy', 'name');

    return res.status(201).json({
      success:    true,
      message:    scoreCount + ' scores submitted for approval.',
      submission: submission
    });
  } catch (err) {
    console.error('[inst.score] POST /submit:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /entry (unchanged)
============================================ */
router.post('/entry', guard, async function (req, res) {
  try {
    var body     = req.body || {};
    var schoolId = req.schoolId;

    if (!body.studentId || !body.classId || !body.subjectId || !body.termId) {
      return res.status(400).json({ success: false, message: 'studentId, classId, subjectId, and termId are all required.' });
    }

    var approvedSub = await ScoreSubmission.findOne({
      schoolId: schoolId, classId: body.classId,
      subjectId: body.subjectId, termId: body.termId,
      status: 'approved'
    });
    if (approvedSub) {
      return res.status(403).json({
        success: false,
        code:    'SCORES_LOCKED',
        message: 'These scores have been approved and are locked. Contact your school admin to make changes.'
      });
    }

    var student = await SchoolStudent.findOne({ _id: body.studentId, schoolId: schoolId }).lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found in this school.' });
    }

    var config = await ScoreConfig.getOrCreateDefault(schoolId, req.schoolUser._id);
    var calc   = calcScoreFromConfig(config, body.scores);

    if (calc.errors.length > 0) {
      return res.status(400).json({ success: false, message: calc.errors.join(' '), errors: calc.errors });
    }

    var now   = new Date();
    var saved = await SchoolScore.findOneAndUpdate(
      { schoolId: schoolId, studentId: body.studentId, subjectId: body.subjectId, termId: body.termId },
      {
        $set: {
          classId:        body.classId,
          academicYear:   body.academicYear || '',
          configId:       config._id,
          scores:         calc.scoresObj,
          total:          calc.total,
          maxPossible:    calc.maxPossible,
          percentage:     calc.percentage,
          grade:          calc.grade,
          remark:         calc.remark,
          teacherComment: body.teacherComment || '',
          lastEditedBy:   req.schoolUser._id,
          lastEditedAt:   now
        },
        $setOnInsert: { enteredBy: req.schoolUser._id, enteredAt: now }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    return res.status(200).json({ success: true, message: 'Score saved.', score: saved });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'A score record already exists. Please refresh and try again.' });
    }
    console.error('[inst.score] POST /entry:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to save score.' });
  }
});

/* ============================================
   POST /bulk (unchanged)
============================================ */
router.post('/bulk', guard, async function (req, res) {
  try {
    var body     = req.body || {};
    var schoolId = req.schoolId;

    if (!body.classId || !body.subjectId || !body.termId) {
      return res.status(400).json({ success: false, message: 'classId, subjectId, and termId are required.' });
    }
    if (!Array.isArray(body.entries) || body.entries.length === 0) {
      return res.status(400).json({ success: false, message: 'No entries provided.' });
    }
    if (body.entries.length > 500) {
      return res.status(400).json({ success: false, message: 'Maximum 500 entries per bulk save.' });
    }

    var approvedSub = await ScoreSubmission.findOne({
      schoolId: schoolId, classId: body.classId,
      subjectId: body.subjectId, termId: body.termId,
      status: 'approved'
    });
    if (approvedSub) {
      return res.status(403).json({
        success: false,
        code:    'SCORES_LOCKED',
        message: 'These scores have been approved and are locked. Contact your school admin to make changes.'
      });
    }

    var config = await ScoreConfig.getOrCreateDefault(schoolId, req.schoolUser._id);
    var now    = new Date();
    var saved  = 0;
    var failed = 0;
    var errors = [];

    for (var i = 0; i < body.entries.length; i++) {
      var entry = body.entries[i] || {};

      if (!entry.studentId) {
        failed++;
        errors.push('Row ' + (i + 1) + ': missing studentId.');
        continue;
      }

      var student = await SchoolStudent.findOne({ _id: entry.studentId, schoolId: schoolId }).select('_id name').lean();
      if (!student) {
        failed++;
        errors.push('Row ' + (i + 1) + ' (' + entry.studentId + '): student not found.');
        continue;
      }

      var calc = calcScoreFromConfig(config, entry.scores);
      if (calc.errors.length > 0) {
        failed++;
        errors.push('Row ' + (i + 1) + ' (' + (student.name || entry.studentId) + '): ' + calc.errors.join(' '));
        continue;
      }

      try {
        await SchoolScore.findOneAndUpdate(
          { schoolId: schoolId, studentId: entry.studentId, subjectId: body.subjectId, termId: body.termId },
          {
            $set: {
              classId:        body.classId,
              academicYear:   body.academicYear || '',
              configId:       config._id,
              scores:         calc.scoresObj,
              total:          calc.total,
              maxPossible:    calc.maxPossible,
              percentage:     calc.percentage,
              grade:          calc.grade,
              remark:         calc.remark,
              teacherComment: entry.teacherComment || '',
              lastEditedBy:   req.schoolUser._id,
              lastEditedAt:   now
            },
            $setOnInsert: { enteredBy: req.schoolUser._id, enteredAt: now }
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        saved++;
      } catch (e) {
        failed++;
        errors.push('Row ' + (i + 1) + ' (' + (student.name || entry.studentId) + '): ' + e.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: saved + ' score' + (saved !== 1 ? 's' : '') + ' saved, ' + failed + ' failed.',
      saved:   saved,
      failed:  failed,
      errors:  errors.slice(0, 30)
    });
  } catch (err) {
    console.error('[inst.score] POST /bulk:', err.message);
    return res.status(500).json({ success: false, message: 'Bulk save failed.' });
  }
});

/* ============================================
   GET /class/:classId/subject/:subjectId/term/:termId
   (unchanged)
============================================ */
router.get('/class/:classId/subject/:subjectId/term/:termId', guard, async function (req, res) {
  try {
    var schoolId  = req.schoolId;
    var classId   = req.params.classId;
    var subjectId = req.params.subjectId;
    var termId    = req.params.termId;

    var config   = await ScoreConfig.getOrCreateDefault(schoolId, req.schoolUser._id);
    var students = await SchoolStudent.find({ schoolId: schoolId, classId: classId, status: 'active' })
      .select('name studentId admissionNo').sort({ name: 1 }).lean();

    var scores = await SchoolScore.find({ schoolId: schoolId, classId: classId, subjectId: subjectId, termId: termId }).lean();

    var scoreByStudent = {};
    scores.forEach(function (s) { scoreByStudent[s.studentId.toString()] = s; });

    var roster = students.map(function (st) {
      return {
        studentId:   st._id,
        name:        st.name,
        studentCode: st.studentId || '',
        admissionNo: st.admissionNo || '',
        score:       scoreByStudent[st._id.toString()] || null
      };
    });

    return res.json({ success: true, config: config, roster: roster, total: roster.length });
  } catch (err) {
    console.error('[inst.score] GET /class/...:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load class scores.' });
  }
});

/* ============================================
   GET /student/:studentId (unchanged)
============================================ */
router.get('/student/:studentId', guard, async function (req, res) {
  try {
    var scores = await SchoolScore.find({ schoolId: req.schoolId, studentId: req.params.studentId })
      .populate('subjectId', 'name code')
      .populate('termId', 'name session term')
      .sort({ createdAt: -1 }).lean();
    return res.json({ success: true, scores: scores });
  } catch (err) {
    console.error('[inst.score] GET /student/:studentId:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load student scores.' });
  }
});

/* ============================================
   DELETE /:id (unchanged)
============================================ */
router.delete('/:id', guard, async function (req, res) {
  try {
    var deleted = await SchoolScore.findOneAndDelete({ _id: req.params.id, schoolId: req.schoolId });
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Score record not found.' });
    }
    return res.json({ success: true, message: 'Score record deleted.' });
  } catch (err) {
    console.error('[inst.score] DELETE /:id:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to delete score record.' });
  }
});

/* ============================================
   POST /rank/:classId/:subjectId/:termId (unchanged)
============================================ */
router.post('/rank/:classId/:subjectId/:termId', guard, async function (req, res) {
  try {
    var schoolId  = req.schoolId;
    var classId   = req.params.classId;
    var subjectId = req.params.subjectId;
    var termId    = req.params.termId;

    var scores = await SchoolScore.find({
      schoolId: schoolId, classId: classId,
      subjectId: subjectId, termId: termId
    }).lean();

    if (scores.length === 0) {
      return res.json({ success: true, message: 'No score records found — nothing to rank.', ranked: 0 });
    }

    scores.sort(function (a, b) { return (b.total || 0) - (a.total || 0); });

    var total   = scores.length;
    var now     = new Date();
    var updates = scores.map(function (scoreDoc, idx) {
      var higherCount = 0;
      for (var k = 0; k < idx; k++) {
        if ((scores[k].total || 0) > (scoreDoc.total || 0)) { higherCount++; }
      }
      return { _id: scoreDoc._id, position: higherCount + 1 };
    });

    await Promise.all(updates.map(function (u) {
      return SchoolScore.findByIdAndUpdate(u._id, {
        $set: { position: u.position, positionOutOf: total, positionCalculatedAt: now }
      });
    }));

    var summary = updates.map(function (u, i) {
      return { studentId: scores[i].studentId, total: scores[i].total || 0, position: u.position, outOf: total };
    });

    return res.json({ success: true, message: total + ' students ranked.', ranked: total, summary: summary });
  } catch (err) {
    console.error('[inst.score] POST /rank:', err.message);
    return res.status(500).json({ success: false, message: 'Ranking failed.' });
  }
});

module.exports = router;