/* ============================================
   LATLOMP INSTITUTION — SCORE ENTRY ROUTES
   ✅ PHASE L.3: Score Entry + Auto-Calculation
   ✅ PHASE L.4: Position Ranking Engine
   ✅ PHASE L.6: Score Config Update Endpoints
============================================ */
'use strict';

const express = require('express');
const router  = express.Router();

const SchoolScore   = require('../models/SchoolScore.model');
const ScoreConfig   = require('../models/ScoreConfig.model');
const SchoolStudent = require('../models/SchoolStudent.model');

const { instProtect, teacherOrAdmin, schoolAdminOnly } = require('../middleware/inst.auth');
const { requireActiveSubscription }                    = require('../middleware/inst.tenant');

var guard      = [instProtect, teacherOrAdmin,  requireActiveSubscription];
var adminGuard = [instProtect, schoolAdminOnly, requireActiveSubscription];

/* ============================================
   Shared calculation helper.
============================================ */
function calcScoreFromConfig(config, suppliedScores) {
  var components = (config && config.components) || [];
  var scoresObj  = {};
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
   Fetch (or auto-create) this school's active
   ScoreConfig.
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
   ✅ PHASE L.6: PUT /config/:id
   School admin updates the score config —
   components and/or grade boundaries.
   Restricted to schoolAdminOnly.
============================================ */
router.put('/config/:id', adminGuard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var body     = req.body || {};

    var config = await ScoreConfig.findOne({ _id: req.params.id, schoolId: schoolId });
    if (!config) {
      return res.status(404).json({ success: false, message: 'Score configuration not found.' });
    }

    /* ---- Validate components if provided ---- */
    if (body.components !== undefined) {
      if (!Array.isArray(body.components) || body.components.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one score component is required.' });
      }

      var keys = body.components.map(function (c) { return c.key; });
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

    /* ---- Validate grade boundaries if provided ---- */
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

    /* ---- Optional name update ---- */
    if (body.name) { config.name = body.name.trim(); }

    await config.save();

    return res.json({
      success: true,
      message: 'Score configuration updated successfully.',
      config:  config
    });
  } catch (err) {
    console.error('[inst.score] PUT /config/:id:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update score configuration.' });
  }
});

/* ============================================
   ✅ PHASE L.6: POST /config
   Creates a new config if none exists.
   Fallback used by the UI's reset flow.
   Also restricted to schoolAdminOnly.
============================================ */
router.post('/config', adminGuard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var body     = req.body || {};

    /* Deactivate any existing default config first */
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

    return res.status(201).json({
      success: true,
      message: 'Score configuration created.',
      config:  config
    });
  } catch (err) {
    console.error('[inst.score] POST /config:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to create score configuration.' });
  }
});

/* ============================================
   POST /entry
============================================ */
router.post('/entry', guard, async function (req, res) {
  try {
    var body     = req.body || {};
    var schoolId = req.schoolId;

    if (!body.studentId || !body.classId || !body.subjectId || !body.termId) {
      return res.status(400).json({ success: false, message: 'studentId, classId, subjectId, and termId are all required.' });
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

    var now = new Date();

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
        $setOnInsert: {
          enteredBy: req.schoolUser._id,
          enteredAt: now
        }
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
   POST /bulk
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
            $setOnInsert: {
              enteredBy: req.schoolUser._id,
              enteredAt: now
            }
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
============================================ */
router.get('/class/:classId/subject/:subjectId/term/:termId', guard, async function (req, res) {
  try {
    var schoolId  = req.schoolId;
    var classId   = req.params.classId;
    var subjectId = req.params.subjectId;
    var termId    = req.params.termId;

    var config   = await ScoreConfig.getOrCreateDefault(schoolId, req.schoolUser._id);
    var students = await SchoolStudent.find({ schoolId: schoolId, classId: classId, status: 'active' })
      .select('name studentId admissionNo')
      .sort({ name: 1 })
      .lean();

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
   GET /student/:studentId
============================================ */
router.get('/student/:studentId', guard, async function (req, res) {
  try {
    var scores = await SchoolScore.find({ schoolId: req.schoolId, studentId: req.params.studentId })
      .populate('subjectId', 'name code')
      .populate('termId', 'name session term')
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ success: true, scores: scores });
  } catch (err) {
    console.error('[inst.score] GET /student/:studentId:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load student scores.' });
  }
});

/* ============================================
   DELETE /:id
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
   ✅ PHASE L.4: POST /rank/:classId/:subjectId/:termId
============================================ */
router.post('/rank/:classId/:subjectId/:termId', guard, async function (req, res) {
  try {
    var schoolId  = req.schoolId;
    var classId   = req.params.classId;
    var subjectId = req.params.subjectId;
    var termId    = req.params.termId;

    var scores = await SchoolScore.find({
      schoolId:  schoolId,
      classId:   classId,
      subjectId: subjectId,
      termId:    termId
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