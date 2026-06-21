/* ============================================
   LATLOMP INSTITUTION — SCORE ENTRY ROUTES
   ✅ PHASE L.3: Score Entry + Auto-Calculation

   Reads each school's own ScoreConfig (Phase L.1) to
   determine which components exist and how grading
   works, so the same routes serve every school
   regardless of how they structure their assessments.

   Position (Phase L.4) is intentionally NOT calculated
   here — it requires comparing every student in a
   class+subject+term together, which is a separate
   batch operation.
============================================ */
'use strict';

const express = require('express');
const router  = express.Router();

const SchoolScore   = require('../models/SchoolScore.model');
const ScoreConfig   = require('../models/ScoreConfig.model');
const SchoolStudent = require('../models/SchoolStudent.model');

const { instProtect, teacherOrAdmin } = require('../middleware/inst.auth');
const { requireActiveSubscription }   = require('../middleware/inst.tenant');

var guard = [instProtect, teacherOrAdmin, requireActiveSubscription];

/* ============================================
   Shared calculation helper.
   Validates supplied scores against the config's
   components and computes total/percentage/grade.
   Does NOT throw — returns an errors[] array so
   callers (single vs bulk) can decide how strict
   to be.
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
   ScoreConfig. Frontend uses this to render the
   correct columns dynamically.
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
   POST /entry
   Save or update ONE student's score for one
   subject/term. Strict — rejects invalid input
   rather than silently clamping.
============================================ */
router.post('/entry', guard, async function (req, res) {
  try {
    var body = req.body || {};
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
          classId:       body.classId,
          academicYear:  body.academicYear || '',
          configId:      config._id,
          scores:        calc.scoresObj,
          total:         calc.total,
          maxPossible:   calc.maxPossible,
          percentage:    calc.percentage,
          grade:         calc.grade,
          remark:        calc.remark,
          teacherComment: body.teacherComment || '',
          lastEditedBy:  req.schoolUser._id,
          lastEditedAt:  now
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
      return res.status(409).json({ success: false, message: 'A score record for this student already exists. Please refresh and try again.' });
    }
    console.error('[inst.score] POST /entry:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to save score.' });
  }
});

/* ============================================
   POST /bulk
   Save MANY students at once (spreadsheet save).
   Per-row error handling — one bad row does not
   block the rest of the class.
============================================ */
router.post('/bulk', guard, async function (req, res) {
  try {
    var body = req.body || {};
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
        errors.push('Row ' + (i + 1) + ' (' + entry.studentId + '): student not found in this school.');
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
   Returns: the active config, the full active class
   roster, and any existing scores for this group —
   everything the L.5 spreadsheet entry page needs in
   one call.
============================================ */
router.get('/class/:classId/subject/:subjectId/term/:termId', guard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var classId   = req.params.classId;
    var subjectId = req.params.subjectId;
    var termId    = req.params.termId;

    var config = await ScoreConfig.getOrCreateDefault(schoolId, req.schoolUser._id);

    var students = await SchoolStudent.find({ schoolId: schoolId, classId: classId, status: 'active' })
      .select('name studentId admissionNo')
      .sort({ name: 1 })
      .lean();

    var scores = await SchoolScore.find({ schoolId: schoolId, classId: classId, subjectId: subjectId, termId: termId })
      .lean();

    var scoreByStudent = {};
    scores.forEach(function (s) { scoreByStudent[s.studentId.toString()] = s; });

    var roster = students.map(function (st) {
      var existing = scoreByStudent[st._id.toString()] || null;
      return {
        studentId:   st._id,
        name:        st.name,
        studentCode: st.studentId || '',
        admissionNo: st.admissionNo || '',
        score:       existing
      };
    });

    return res.json({
      success: true,
      config:  config,
      roster:  roster,
      total:   roster.length
    });
  } catch (err) {
    console.error('[inst.score] GET /class/.../subject/.../term/...:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load class scores.' });
  }
});

/* ============================================
   GET /student/:studentId
   All score records for one student — used later
   by Phase M (report cards).
============================================ */
router.get('/student/:studentId', guard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var scores = await SchoolScore.find({ schoolId: schoolId, studentId: req.params.studentId })
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

module.exports = router;