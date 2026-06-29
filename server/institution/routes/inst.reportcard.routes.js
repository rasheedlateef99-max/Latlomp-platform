/* ============================================
   LATLOMP INSTITUTION — REPORT CARD ROUTES

   ✅ PHASE M: Report Card System

   GET  /class/:classId/term/:termId
        Full class report card data. Loads all
        students, all subject scores, computes
        summaries and class-wide positions.

   GET  /student/:studentId/term/:termId
        Single student report card data.

   PUT  /class/:classId/term/:termId/settings
        Update principal comment + resumption date.

   PUT  /class/:classId/term/:termId/comment/:studentId
        Update one student's class teacher comment.

   PUT  /class/:classId/term/:termId/release
        Toggle release of report cards for this
        class/term. Released cards are visible
        to the student portal (Phase Q).

   Mounted at: /api/institution/reportcard
   Auth: schoolAdminOnly + requireActiveSubscription
============================================ */
'use strict';

const express              = require('express');
const router               = express.Router();

const School               = require('../models/School.model');
const SchoolScore          = require('../models/SchoolScore.model');
const ScoreConfig          = require('../models/ScoreConfig.model');
const SchoolStudent        = require('../models/SchoolStudent.model');
const ReportCardSettings   = require('../models/ReportCardSettings.model');
const AcademicTerm         = require('../models/AcademicTerm.model');

const { instProtect, schoolAdminOnly, teacherOrAdmin } = require('../middleware/inst.auth');
const { requireActiveSubscription }                    = require('../middleware/inst.tenant');

var adminGuard = [instProtect, schoolAdminOnly, requireActiveSubscription];
var readGuard  = [instProtect, teacherOrAdmin,  requireActiveSubscription];

/* ============================================
   HELPER: Get or create settings for a class/term
============================================ */
async function getOrCreateSettings(schoolId, classId, termId) {
  var settings = await ReportCardSettings.findOne({ schoolId, classId, termId });
  if (!settings) {
    settings = await ReportCardSettings.create({
      schoolId, classId, termId,
      principalComment: 'Keep it up!',
      resumptionDate:   null,
      isReleased:       false,
      studentComments:  {}
    });
  }
  return settings;
}

/* ============================================
   HELPER: Build student summary from subject scores
============================================ */
function buildSummary(subjects, classStudents) {
  var totalMarks     = 0;
  var maxPossibleSum = 0;
  var subjectsPassed = 0;
  var percentSum     = 0;

  subjects.forEach(function (s) {
    totalMarks     += (s.total      || 0);
    maxPossibleSum += (s.maxPossible || 0);
    percentSum     += (s.percentage  || 0);
    if ((s.percentage || 0) >= 50) { subjectsPassed++; }
  });

  var avgPercent = subjects.length > 0
    ? Math.round(percentSum / subjects.length)
    : 0;

  return {
    totalMarks:     totalMarks,
    maxPossibleSum: maxPossibleSum,
    avgPercent:     avgPercent,
    subjectsPassed: subjectsPassed,
    subjectsTotal:  subjects.length
    /* overallPosition computed after all students are processed */
  };
}

/* ============================================
   GET /class/:classId/term/:termId
   Full class report card. Heavy endpoint —
   loads all students, all scores, all settings.
   Computes class-wide overall positions.
============================================ */
router.get('/class/:classId/term/:termId', readGuard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var classId  = req.params.classId;
    var termId   = req.params.termId;

    /* ---- Verify class and term belong to this school ---- */
    var [ school, term ] = await Promise.all([
      School.findById(schoolId)
        .select('name logo address state primaryColor motto principalName')
        .lean(),
      AcademicTerm.findOne({ _id: termId, schoolId: schoolId }).lean()
    ]);

    if (!term) {
      return res.status(404).json({ success: false, message: 'Term not found.' });
    }

    /* ---- Score config ---- */
    var config = await ScoreConfig.getOrCreateDefault(schoolId, req.schoolUser._id);

    /* ---- Settings (or create defaults) ---- */
    var settings = await getOrCreateSettings(schoolId, classId, termId);

    /* ---- Active students in this class ---- */
    var students = await SchoolStudent.find({
      schoolId: schoolId,
      classId:  classId,
      status:   'active'
    })
      .select('name admissionNo studentId gender passportPhotoUrl parentName parentPhone dateOfBirth')
      .sort({ name: 1 })
      .lean();

    if (students.length === 0) {
      return res.json({
        success:  true,
        school:   school,
        term:     term,
        config:   config,
        settings: settings,
        students: [],
        message:  'No active students in this class.'
      });
    }

    /* ---- All scores for this class/term ---- */
    var scores = await SchoolScore.find({
      schoolId: schoolId,
      classId:  classId,
      termId:   termId
    })
      .populate('subjectId', 'name code sortOrder isCore')
      .lean();

    /* ---- Group scores by studentId ---- */
    var scoresByStudent = {};
    scores.forEach(function (score) {
      var sid = score.studentId.toString();
      if (!scoresByStudent[sid]) { scoresByStudent[sid] = []; }
      scoresByStudent[sid].push(score);
    });

    /* ---- Get sorted unique subjects with scores in this class/term ---- */
    var subjectMap = {};
    scores.forEach(function (score) {
      if (score.subjectId && score.subjectId._id) {
        var key = score.subjectId._id.toString();
        if (!subjectMap[key]) {
          subjectMap[key] = {
            _id:       score.subjectId._id,
            name:      score.subjectId.name      || '—',
            code:      score.subjectId.code      || '',
            sortOrder: score.subjectId.sortOrder || 0,
            isCore:    score.subjectId.isCore    !== false
          };
        }
      }
    });
    var subjectList = Object.values(subjectMap)
      .sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name); });

    /* ---- Build student data ---- */
    var studentData = students.map(function (student) {
      var sid           = student._id.toString();
      var studentScores = scoresByStudent[sid] || [];

      /* Map studentId → score for O(1) lookup */
      var scoreBySubject = {};
      studentScores.forEach(function (s) {
        if (s.subjectId && s.subjectId._id) {
          scoreBySubject[s.subjectId._id.toString()] = s;
        }
      });

      /* Build subject rows in canonical order */
      var subjects = subjectList.map(function (subj) {
        var s = scoreBySubject[subj._id.toString()];
        return {
          subjectId:    subj._id,
          name:         subj.name,
          code:         subj.code,
          sortOrder:    subj.sortOrder,
          isCore:       subj.isCore,
          scores:       s ? (s.scores || {}) : {},
          total:        s ? (s.total      || 0) : null,
          maxPossible:  s ? (s.maxPossible || 0) : null,
          percentage:   s ? (s.percentage  || 0) : null,
          grade:        s ? (s.grade       || '—') : '—',
          remark:       s ? (s.remark      || '—') : '—',
          position:     s ? (s.position    || null) : null,
          positionOutOf:s ? (s.positionOutOf || null) : null,
          absent:       !s   /* true if no score recorded */
        };
      });

      var summary = buildSummary(
        subjects.filter(function (s) { return !s.absent; }),
        students.length
      );

      /* Class teacher comment for this student */
      var teacherComment = (settings.studentComments && settings.studentComments.get)
        ? (settings.studentComments.get(sid) || '')
        : ((settings.studentComments && settings.studentComments[sid]) || '');

      return {
        _id:             student._id,
        name:            student.name,
        admissionNo:     student.admissionNo      || '',
        studentId:       student.studentId        || '',
        gender:          student.gender           || '',
        passportPhotoUrl:student.passportPhotoUrl || '',
        parentName:      student.parentName       || '',
        parentPhone:     student.parentPhone      || '',
        dateOfBirth:     student.dateOfBirth      || null,
        teacherComment:  teacherComment,
        subjects:        subjects,
        summary:         summary
      };
    });

    /* ---- Compute overall class position by totalMarks ---- */
    var sorted = studentData.slice().sort(function (a, b) {
      return (b.summary.totalMarks || 0) - (a.summary.totalMarks || 0);
    });
    sorted.forEach(function (student, idx) {
      var pos = 1;
      for (var k = 0; k < idx; k++) {
        if ((sorted[k].summary.totalMarks || 0) > (student.summary.totalMarks || 0)) {
          pos++;
        }
      }
      student.summary.overallPosition = pos;
      student.summary.overallOutOf    = studentData.length;
    });

    return res.json({
      success:     true,
      school:      school,
      term:        term,
      config:      config,
      settings:    settings,
      subjectList: subjectList,
      students:    studentData,
      totalStudents: studentData.length
    });

  } catch (err) {
    console.error('[reportcard] GET /class:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /student/:studentId/term/:termId
   Single student full report card.
   Used for individual print/PDF.
============================================ */
router.get('/student/:studentId/term/:termId', readGuard, async function (req, res) {
  try {
    var schoolId  = req.schoolId;
    var studentId = req.params.studentId;
    var termId    = req.params.termId;

    var [ student, term, school ] = await Promise.all([
      SchoolStudent.findOne({ _id: studentId, schoolId: schoolId }).lean(),
      AcademicTerm.findOne({ _id: termId, schoolId: schoolId }).lean(),
      School.findById(schoolId)
        .select('name logo address state primaryColor motto principalName')
        .lean()
    ]);

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }
    if (!term) {
      return res.status(404).json({ success: false, message: 'Term not found.' });
    }

    var config = await ScoreConfig.getOrCreateDefault(schoolId, req.schoolUser._id);

    /* ---- All scores for this student/term ---- */
    var scores = await SchoolScore.find({
      schoolId:  schoolId,
      studentId: studentId,
      termId:    termId
    })
      .populate('subjectId', 'name code sortOrder isCore')
      .lean();

    /* ---- Settings ---- */
    var settings = student.classId
      ? await getOrCreateSettings(schoolId, student.classId.toString(), termId)
      : null;

    var teacherComment = '';
    if (settings && settings.studentComments) {
      teacherComment = (settings.studentComments.get)
        ? (settings.studentComments.get(studentId) || '')
        : (settings.studentComments[studentId]     || '');
    }

    /* ---- Build subjects ---- */
    var subjects = scores
      .filter(function (s) { return s.subjectId && s.subjectId._id; })
      .sort(function (a, b) {
        return ((a.subjectId && a.subjectId.sortOrder) || 0) -
               ((b.subjectId && b.subjectId.sortOrder) || 0);
      })
      .map(function (s) {
        return {
          name:         s.subjectId.name,
          code:         s.subjectId.code,
          sortOrder:    s.subjectId.sortOrder,
          isCore:       s.subjectId.isCore,
          scores:       s.scores || {},
          total:        s.total       || 0,
          maxPossible:  s.maxPossible || 0,
          percentage:   s.percentage  || 0,
          grade:        s.grade       || '—',
          remark:       s.remark      || '—',
          position:     s.position    || null,
          positionOutOf:s.positionOutOf || null
        };
      });

    var summary = buildSummary(subjects, 0);

    return res.json({
      success:        true,
      school:         school,
      term:           term,
      config:         config,
      settings:       settings,
      teacherComment: teacherComment,
      student: {
        _id:             student._id,
        name:            student.name,
        admissionNo:     student.admissionNo      || '',
        studentId:       student.studentId        || '',
        gender:          student.gender           || '',
        passportPhotoUrl:student.passportPhotoUrl || '',
        parentName:      student.parentName       || '',
        parentPhone:     student.parentPhone      || '',
        dateOfBirth:     student.dateOfBirth      || null,
        classId:         student.classId          || null
      },
      subjects: subjects,
      summary:  summary
    });

  } catch (err) {
    console.error('[reportcard] GET /student:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /class/:classId/term/:termId/settings
   Admin updates principal comment and resumption date.
   Body: { principalComment, resumptionDate }
============================================ */
router.put('/class/:classId/term/:termId/settings', adminGuard, async function (req, res) {
  try {
    var { principalComment, resumptionDate } = req.body || {};
    var settings = await getOrCreateSettings(req.schoolId, req.params.classId, req.params.termId);

    if (principalComment !== undefined) {
      settings.principalComment = String(principalComment || '').trim();
    }
    if (resumptionDate !== undefined) {
      settings.resumptionDate = resumptionDate ? new Date(resumptionDate) : null;
    }
    await settings.save();

    return res.json({
      success:  true,
      message:  'Settings updated.',
      settings: settings
    });
  } catch (err) {
    console.error('[reportcard] PUT /settings:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /class/:classId/term/:termId/comment/:studentId
   Update one student's class teacher comment.
   Body: { comment }
============================================ */
router.put('/class/:classId/term/:termId/comment/:studentId', adminGuard, async function (req, res) {
  try {
    var { comment } = req.body || {};
    var studentId   = req.params.studentId;

    var settings = await getOrCreateSettings(req.schoolId, req.params.classId, req.params.termId);

    settings.studentComments.set(studentId, String(comment || '').trim());
    settings.markModified('studentComments');
    await settings.save();

    return res.json({
      success: true,
      message: 'Comment saved.',
      comment: settings.studentComments.get(studentId)
    });
  } catch (err) {
    console.error('[reportcard] PUT /comment:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /class/:classId/term/:termId/release
   Toggle release of report cards for this class/term.
   Released cards will be accessible in Phase Q
   (student/parent portal).
============================================ */
router.put('/class/:classId/term/:termId/release', adminGuard, async function (req, res) {
  try {
    var settings = await getOrCreateSettings(req.schoolId, req.params.classId, req.params.termId);

    settings.isReleased = !settings.isReleased;
    if (settings.isReleased) {
      settings.releasedAt = new Date();
      settings.releasedBy = req.schoolUser._id;
    } else {
      settings.releasedAt = null;
      settings.releasedBy = null;
    }
    await settings.save();

    return res.json({
      success:    true,
      message:    settings.isReleased
        ? 'Report cards released to students.'
        : 'Report card visibility revoked.',
      isReleased: settings.isReleased,
      settings:   settings
    });
  } catch (err) {
    console.error('[reportcard] PUT /release:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;