/* ============================================
   LATLOMP INSTITUTION — REPORT CARD ROUTES

   ✅ PHASE M: Report Card System

   ✅ RESTRUCTURE STAGE 3:
   Report card authority delegated per approved plan.

   GUARD CHANGES:
     PUT /settings  → approvalGuard (seniorStaffOrAdmin)
       Principal comment + resumption date is a
       senior staff action, not general teacher.
     PUT /release   → approvalGuard (seniorStaffOrAdmin)
       Official release remains senior staff only.
     PUT /comment   → manageGuard (canManageStudents)
       Class teacher can write comments for own class.
       Scope check enforces class ownership.

   SCOPE ADDITIONS (GET endpoints):
     GET /class/:classId/term/:termId
       class_teacher: can only access their assigned class.
       All other roles: unrestricted (existing behavior).
     GET /student/:studentId/term/:termId
       class_teacher: can only access students in their class.
       All other roles: unrestricted (existing behavior).

   ALL ROUTE LOGIC IS UNCHANGED except the guard
   declarations and scope checks added above.
============================================ */
'use strict';

const express            = require('express');
const router             = express.Router();

const School             = require('../models/School.model');
const SchoolScore        = require('../models/SchoolScore.model');
const ScoreConfig        = require('../models/ScoreConfig.model');
const SchoolStudent      = require('../models/SchoolStudent.model');
const ReportCardSettings = require('../models/ReportCardSettings.model');
const AcademicTerm       = require('../models/AcademicTerm.model');

const {
  instProtect,
  schoolAdminOnly,
  teacherOrAdmin,
  seniorStaffOrAdmin,     /* ✅ STAGE 3 */
  canManageStudents,      /* ✅ STAGE 3 */
  verifyStudentScope,     /* ✅ STAGE 3 */
  getEffectiveRoles       /* ✅ STAGE 3 */
} = require('../middleware/inst.auth');
const { requireActiveSubscription } = require('../middleware/inst.tenant');

/* Existing guards (unchanged) */
var adminGuard    = [instProtect, schoolAdminOnly,    requireActiveSubscription];
var readGuard     = [instProtect, teacherOrAdmin,     requireActiveSubscription];
/* ✅ STAGE 3: new guard variables */
var approvalGuard = [instProtect, seniorStaffOrAdmin, requireActiveSubscription];
var manageGuard   = [instProtect, canManageStudents,  requireActiveSubscription];

/* ---- Senior role list for scope checks ---- */
var SENIOR_ROLES = ['school_admin', 'principal', 'vice_principal', 'dean', 'hod'];

/* ============================================
   HELPER: Get or create settings for a class/term
   (unchanged from Phase M)
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
   (unchanged from Phase M)
============================================ */
function buildSummary(subjects) {
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
  };
}

/* ============================================
   ✅ STAGE 3 HELPER: isClassTeacherRestricted
   Returns true if this user is a class_teacher
   without senior staff authority. Used to decide
   whether to apply scope checks on read endpoints.
============================================ */
function isClassTeacherRestricted(schoolUser) {
  var effectiveRoles = getEffectiveRoles(schoolUser);
  if (effectiveRoles.some(function (r) { return SENIOR_ROLES.includes(r); })) {
    return false;  /* Senior staff — no scope restriction */
  }
  return effectiveRoles.includes('class_teacher');
}

/* ============================================
   GET /class/:classId/term/:termId
   ✅ STAGE 3: scope check added for class_teacher.
   class_teacher can only access their assigned class.
   All other roles: behavior unchanged.
============================================ */
router.get('/class/:classId/term/:termId', readGuard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var classId  = req.params.classId;
    var termId   = req.params.termId;

    /* ✅ STAGE 3: class_teacher scope check */
    if (isClassTeacherRestricted(req.schoolUser)) {
      if (!req.schoolUser.classId ||
          req.schoolUser.classId.toString() !== classId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only view report cards for your assigned class.'
        });
      }
    }

    var [ school, term ] = await Promise.all([
      School.findById(schoolId)
        .select('name logo address state primaryColor motto principalName')
        .lean(),
      AcademicTerm.findOne({ _id: termId, schoolId: schoolId }).lean()
    ]);

    if (!term) {
      return res.status(404).json({ success: false, message: 'Term not found.' });
    }

    var config   = await ScoreConfig.getOrCreateDefault(schoolId, req.schoolUser._id);
    var settings = await getOrCreateSettings(schoolId, classId, termId);

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

    var scores = await SchoolScore.find({
      schoolId: schoolId,
      classId:  classId,
      termId:   termId
    })
      .populate('subjectId', 'name code sortOrder isCore')
      .lean();

    var scoresByStudent = {};
    scores.forEach(function (score) {
      var sid = score.studentId.toString();
      if (!scoresByStudent[sid]) { scoresByStudent[sid] = []; }
      scoresByStudent[sid].push(score);
    });

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
      .sort(function (a, b) {
        return (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name);
      });

    var studentData = students.map(function (student) {
      var sid           = student._id.toString();
      var studentScores = scoresByStudent[sid] || [];

      var scoreBySubject = {};
      studentScores.forEach(function (s) {
        if (s.subjectId && s.subjectId._id) {
          scoreBySubject[s.subjectId._id.toString()] = s;
        }
      });

      var subjects = subjectList.map(function (subj) {
        var s = scoreBySubject[subj._id.toString()];
        return {
          subjectId:    subj._id,
          name:         subj.name,
          code:         subj.code,
          sortOrder:    subj.sortOrder,
          isCore:       subj.isCore,
          scores:       s ? (s.scores || {}) : {},
          total:        s ? (s.total       || 0)    : null,
          maxPossible:  s ? (s.maxPossible  || 0)   : null,
          percentage:   s ? (s.percentage   || 0)   : null,
          grade:        s ? (s.grade        || '—') : '—',
          remark:       s ? (s.remark       || '—') : '—',
          position:     s ? (s.position     || null): null,
          positionOutOf:s ? (s.positionOutOf|| null): null,
          absent:       !s
        };
      });

      var summary = buildSummary(subjects.filter(function (s) { return !s.absent; }));

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

    /* Compute overall class positions */
    var sorted = studentData.slice().sort(function (a, b) {
      return (b.summary.totalMarks || 0) - (a.summary.totalMarks || 0);
    });
    sorted.forEach(function (student, idx) {
      var pos = 1;
      for (var k = 0; k < idx; k++) {
        if ((sorted[k].summary.totalMarks || 0) > (student.summary.totalMarks || 0)) { pos++; }
      }
      student.summary.overallPosition = pos;
      student.summary.overallOutOf    = studentData.length;
    });

    return res.json({
      success:       true,
      school:        school,
      term:          term,
      config:        config,
      settings:      settings,
      subjectList:   subjectList,
      students:      studentData,
      totalStudents: studentData.length
    });

  } catch (err) {
    console.error('[reportcard] GET /class:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /student/:studentId/term/:termId
   ✅ STAGE 3: scope check for class_teacher.
   class_teacher can only access students in
   their assigned class.
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

    /* ✅ STAGE 3: class_teacher can only access their class's students */
    if (isClassTeacherRestricted(req.schoolUser)) {
      var scopeErr = verifyStudentScope(
        req.schoolUser,
        student.classId ? student.classId.toString() : null,
        student.departmentId ? student.departmentId.toString() : null
      );
      if (scopeErr) {
        return res.status(403).json({ success: false, message: scopeErr });
      }
    }

    var config = await ScoreConfig.getOrCreateDefault(schoolId, req.schoolUser._id);

    var scores = await SchoolScore.find({
      schoolId:  schoolId,
      studentId: studentId,
      termId:    termId
    })
      .populate('subjectId', 'name code sortOrder isCore')
      .lean();

    var settings = student.classId
      ? await getOrCreateSettings(schoolId, student.classId.toString(), termId)
      : null;

    var teacherComment = '';
    if (settings && settings.studentComments) {
      teacherComment = (settings.studentComments.get)
        ? (settings.studentComments.get(studentId) || '')
        : (settings.studentComments[studentId]     || '');
    }

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
          total:        s.total        || 0,
          maxPossible:  s.maxPossible  || 0,
          percentage:   s.percentage   || 0,
          grade:        s.grade        || '—',
          remark:       s.remark       || '—',
          position:     s.position     || null,
          positionOutOf:s.positionOutOf|| null
        };
      });

    var summary = buildSummary(subjects);

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
   ✅ STAGE 3: approvalGuard
   Principal comment and resumption date are
   set by senior staff, not general teachers.
============================================ */
router.put('/class/:classId/term/:termId/settings', approvalGuard, async function (req, res) {
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

    return res.json({ success: true, message: 'Settings updated.', settings: settings });
  } catch (err) {
    console.error('[reportcard] PUT /settings:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /class/:classId/term/:termId/comment/:studentId
   ✅ STAGE 3: manageGuard + scope check
   Class teacher can write comments for students
   in their own class. Senior staff and admin
   can write comments for any class.
   Body: { comment }
============================================ */
router.put('/class/:classId/term/:termId/comment/:studentId', manageGuard, async function (req, res) {
  try {
    var classId   = req.params.classId;
    var studentId = req.params.studentId;

    /* ✅ STAGE 3: scope check for class_teacher */
    if (isClassTeacherRestricted(req.schoolUser)) {
      var scopeErr = verifyStudentScope(req.schoolUser, classId, null);
      if (scopeErr) {
        return res.status(403).json({ success: false, message: scopeErr });
      }
    }

    var { comment } = req.body || {};
    var settings = await getOrCreateSettings(req.schoolId, classId, req.params.termId);

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
   ✅ STAGE 3: approvalGuard
   Official release remains senior staff only.
============================================ */
router.put('/class/:classId/term/:termId/release', approvalGuard, async function (req, res) {
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