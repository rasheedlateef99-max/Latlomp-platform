'use strict';
/* ============================================
   LATLOMP INSTITUTION — PORTFOLIO SERVICE (E2)

   Aggregation layer only. Assembles portfolio
   data from authoritative sources on demand.

   NEVER writes to: SchoolScore, SchoolResult,
   AttendanceRecord, PromotionBatch, SchoolStudent
   classHistory, or any other authoritative model.

   Options:
     releasedScoresOnly  — true for student portal
     includeConfidential — true for senior staff/admin

   Performance: batch queries per data source,
   no N+1 query pattern.
============================================ */
'use strict';

const mongoose       = require('mongoose');
const SchoolStudent  = require('../models/SchoolStudent.model');
const SchoolScore    = require('../models/SchoolScore.model');
const School         = require('../models/School.model');
const AcademicPortfolio = require('../models/AcademicPortfolio.model');
const PortfolioEntry    = require('../models/PortfolioEntry.model');

/* ---- Graceful model loaders ---- */
function getAttendanceModel() {
  var tries = ['../models/Attendance.model', '../models/SchoolAttendance.model'];
  for (var i = 0; i < tries.length; i++) {
    try { return require(tries[i]); } catch (e) {}
  }
  return null;
}
function getScoreSubmissionModel() {
  try { return require('../models/ScoreSubmission.model'); } catch (e) { return null; }
}
function getPromotionBatchModel() {
  try { return require('../models/PromotionBatch.model'); } catch (e) { return null; }
}
function toObjectId(id) {
  if (!id) return null;
  if (mongoose.Types.ObjectId.isValid(id)) { return new mongoose.Types.ObjectId(id.toString()); }
  return id;
}

/* ============================================
   ensurePortfolio(studentId, schoolId)
   Lazy-creates portfolio if it doesn't exist.
   Uses $setOnInsert — safe to call on every request.
============================================ */
async function ensurePortfolio(studentId, schoolId) {
  var student = await SchoolStudent.findOne(
    { _id: studentId, schoolId: schoolId }
  ).select('status').lean();
  if (!student) { return null; }

  var statusMap = {
    active:      'active',
    graduated:   'graduated',
    transferred: 'transferred',
    repeated:    'active',
    inactive:    'inactive'
  };

  return AcademicPortfolio.findOneAndUpdate(
    { studentId: studentId, schoolId: schoolId },
    {
      $setOnInsert: {
        studentId:       studentId,
        schoolId:        schoolId,
        portfolioStatus: statusMap[student.status] || 'active'
      }
    },
    { upsert: true, new: true }
  );
}

/* ============================================
   getPortfolioData(studentId, schoolId, options)

   Main aggregation method.
   options.releasedScoresOnly  — filter to released scores only
   options.includeConfidential — include discipline/confidential entries
   options.limitScoreTerms     — optional: restrict to N most recent terms

   Returns: structured portfolio object
   Returns: null if student not found
============================================ */
async function getPortfolioData(studentId, schoolId, options) {
  options = options || {};
  var releasedOnly        = !!options.releasedScoresOnly;
  var includeConfidential = !!options.includeConfidential;

  /* ---- 0. Ensure portfolio exists ---- */
  var portfolio = await ensurePortfolio(studentId, schoolId);
  if (!portfolio) { return null; }

  /* ---- 1. Parallel: student + school (2 queries) ---- */
  var [student, school] = await Promise.all([
    SchoolStudent.findOne({ _id: studentId, schoolId: schoolId })
      .populate('classId', 'name category sortOrder')
      .select('name admissionNo studentId gender dateOfBirth passportPhotoUrl ' +
              'class classId status joinedSession joinedYear ' +
              'parentName parentPhone parentEmail classHistory')
      .lean(),
    School.findById(schoolId)
      .select('name logo primaryColor address phone email')
      .lean()
  ]);

  if (!student || !school) { return null; }

  /* ---- 2. All scores for this student (1 query) ---- */
  var scores = await SchoolScore.find({ schoolId: schoolId, studentId: studentId })
    .populate('subjectId', 'name code isCore')
    .populate('termId',    'name session term')
    .lean();

  /* ---- 3. Filter to released scores if required (1 query) ---- */
  if (releasedOnly && scores.length > 0) {
    var ScoreSubmission = getScoreSubmissionModel();
    if (ScoreSubmission) {
      var releasedSubs = await ScoreSubmission.find({
        schoolId:          schoolId,
        status:            'approved',
        releasedToStudents:true
      }).select('classId subjectId termId').lean();

      /* Build lookup set: classId:subjectId:termId */
      var releasedKeys = new Set(releasedSubs.map(function (s) {
        return s.classId.toString() + ':' +
               s.subjectId.toString() + ':' +
               s.termId.toString();
      }));

      scores = scores.filter(function (s) {
        var cid = s.classId   ? s.classId.toString()                        : '';
        var sid = s.subjectId ? (s.subjectId._id || s.subjectId).toString() : '';
        var tid = s.termId    ? (s.termId._id    || s.termId).toString()    : '';
        return releasedKeys.has(cid + ':' + sid + ':' + tid);
      });
    }
  }

  /* ---- 4. Group scores by term ---- */
  var scoresByTerm = {};
  scores.forEach(function (s) {
    var termKey = s.termId ? (s.termId._id || s.termId).toString() : 'unassigned';
    if (!scoresByTerm[termKey]) {
      scoresByTerm[termKey] = {
        term:       s.termId  || null,
        subjects:   [],
        totalPct:   0,
        count:      0
      };
    }
    scoresByTerm[termKey].subjects.push({
      subjectName:  s.subjectId ? s.subjectId.name   : 'Unknown',
      subjectCode:  s.subjectId ? s.subjectId.code   : '',
      isCore:       s.subjectId ? s.subjectId.isCore : false,
      total:        s.total        || 0,
      maxPossible:  s.maxPossible  || 0,
      percentage:   s.percentage   || 0,
      grade:        s.grade        || '—',
      remark:       s.remark       || '—',
      position:     s.position     || null,
      positionOutOf:s.positionOutOf|| null,
      teacherComment: includeConfidential ? (s.teacherComment || '') : undefined
    });
    scoresByTerm[termKey].totalPct += (s.percentage || 0);
    scoresByTerm[termKey].count++;
  });

  var termPerformance = Object.values(scoresByTerm).map(function (t) {
    return {
      term:         t.term,
      subjects:     t.subjects,
      termAverage:  t.count > 0 ? Math.round((t.totalPct / t.count) * 100) / 100 : 0,
      subjectCount: t.count
    };
  }).sort(function (a, b) {
    /* Sort most recent term first using session string */
    var as = a.term && a.term.session ? a.term.session : '';
    var bs = b.term && b.term.session ? b.term.session : '';
    return bs.localeCompare(as);
  });

  /* ---- 5. Attendance summary (1 aggregate query) ---- */
  var attendanceSummary = null;
  var Attendance = getAttendanceModel();
  if (Attendance) {
    try {
      var attAgg = await Attendance.aggregate([
        { $match: {
          schoolId:  toObjectId(schoolId),
          studentId: toObjectId(studentId)
        }},
        { $group: {
          _id:      null,
          total:    { $sum: 1 },
          present:  { $sum: { $cond: [{ $in: ['$status', ['present','late']] }, 1, 0] }},
          absent:   { $sum: { $cond: [{ $eq:  ['$status', 'absent']          }, 1, 0] }},
          late:     { $sum: { $cond: [{ $eq:  ['$status', 'late']            }, 1, 0] }},
          excused:  { $sum: { $cond: [{ $eq:  ['$status', 'excused']         }, 1, 0] }}
        }}
      ]);
      if (attAgg.length > 0) {
        var a = attAgg[0];
        attendanceSummary = {
          total:      a.total,
          present:    a.present,
          absent:     a.absent,
          late:       a.late,
          excused:    a.excused,
          percentage: a.total > 0 ? Math.round((a.present / a.total) * 100) : 0
        };
      }
    } catch (e) {
      attendanceSummary = { unavailable: true, detail: 'Attendance data temporarily unavailable.' };
    }
  }

  /* ---- 6. Promotion history (1 query) ---- */
  var promotionHistory = [];
  var PromotionBatch = getPromotionBatchModel();
  if (PromotionBatch) {
    try {
      var batches = await PromotionBatch.find({
        schoolId: schoolId,
        'students.studentId': studentId,
        status:   { $in: ['completed', 'partial', 'rolled_back'] }
      }).select(
        'batchRef status executedAt ' +
        'sourceTermSnapshot targetTermSnapshot sourceClassSnapshot ' +
        'students createdByName executedByName'
      ).lean();

      batches.forEach(function (b) {
        var entry = b.students && b.students.find(function (s) {
          return s.studentId && s.studentId.toString() === studentId.toString();
        });
        if (!entry) { return; }
        promotionHistory.push({
          batchRef:       b.batchRef,
          batchStatus:    b.status,
          executedAt:     b.executedAt,
          finalDecision:  entry.finalDecision,
          executionStatus:entry.executionStatus,
          fromClass:      b.sourceClassSnapshot  ? b.sourceClassSnapshot.name  : '',
          toClass:        entry.targetClassName   || '',
          sourceTerm:     b.sourceTermSnapshot,
          targetTerm:     b.targetTermSnapshot,
          overridden:     entry.overridden        || false,
          /* overrideReason only for authorized staff */
          overrideReason: includeConfidential ? (entry.overrideReason || '') : undefined,
          executedBy:     includeConfidential ? (b.executedByName || '')     : undefined
        });
      });

      promotionHistory.sort(function (a, b) {
        return new Date(a.executedAt) - new Date(b.executedAt);
      });
    } catch (e) { /* PromotionBatch unavailable — non-fatal */ }
  }

  /* ---- 7. Portfolio entries (1 query) ---- */
  var entryFilter = {
    schoolId:  schoolId,
    studentId: studentId,
    status:    { $ne: 'revoked' }
  };
  if (!includeConfidential) {
    entryFilter.isConfidential = { $ne: true };
  }

  var entries = await PortfolioEntry.find(entryFilter)
    .populate('issuedBy', 'name email role')
    .populate('termId',   'name session')
    .sort({ date: -1 })
    .lean();

  /* ---- 8. Assemble and return ---- */
  return {
    portfolio: {
      _id:       portfolio._id,
      status:    portfolio.portfolioStatus,
      metadata:  portfolio.metadata || {},
      createdAt: portfolio.createdAt,
      updatedAt: portfolio.updatedAt
    },
    student: {
      _id:             student._id,
      name:            student.name,
      admissionNo:     student.admissionNo      || '',
      studentCode:     student.studentId        || '',
      gender:          student.gender           || '',
      dateOfBirth:     student.dateOfBirth      || null,
      passportPhotoUrl:student.passportPhotoUrl || '',
      class:           student.class            || '',
      classId:         student.classId          || null,
      status:          student.status,
      joinedSession:   student.joinedSession    || '',
      joinedYear:      student.joinedYear       || null,
      classHistory:    student.classHistory     || [],
      /* parentInfo restricted to authorized staff */
      parentInfo: includeConfidential ? {
        parentName:  student.parentName  || '',
        parentPhone: student.parentPhone || '',
        parentEmail: student.parentEmail || ''
      } : undefined
    },
    school: {
      _id:          school._id,
      name:         school.name,
      logo:         school.logo         || '',
      primaryColor: school.primaryColor || '#6c63ff'
    },
    academicPerformance: termPerformance,
    attendanceSummary,
    promotionHistory,
    entries: {
      awards:       entries.filter(function (e) { return e.entryType === 'award'; }),
      achievements: entries.filter(function (e) { return e.entryType === 'achievement'; }),
      skills:       entries.filter(function (e) { return e.entryType === 'skill'; }),
      milestones:   entries.filter(function (e) { return e.entryType === 'milestone'; }),
      discipline:   includeConfidential
        ? entries.filter(function (e) { return e.entryType === 'discipline_ref'; })
        : []
    }
  };
}

/* ============================================
   getSummary(studentId, schoolId)
   Lightweight — for list views and search results.
   No score/attendance aggregation.
============================================ */
async function getSummary(studentId, schoolId) {
  var [portfolio, student] = await Promise.all([
    AcademicPortfolio.findOne({ studentId: studentId, schoolId: schoolId }).lean(),
    SchoolStudent.findOne({ _id: studentId, schoolId: schoolId })
      .select('name admissionNo studentId class status passportPhotoUrl joinedYear')
      .lean()
  ]);
  if (!student) { return null; }

  var entryCount = await PortfolioEntry.countDocuments({
    schoolId:       schoolId,
    studentId:      studentId,
    status:         'active',
    isConfidential: { $ne: true }
  });

  return {
    portfolioId:     portfolio ? portfolio._id        : null,
    portfolioStatus: portfolio ? portfolio.portfolioStatus : 'not_created',
    student: {
      _id:             student._id,
      name:            student.name,
      admissionNo:     student.admissionNo      || '',
      studentCode:     student.studentId        || '',
      class:           student.class            || '',
      status:          student.status,
      passportPhotoUrl:student.passportPhotoUrl || '',
      joinedYear:      student.joinedYear       || null
    },
    entryCount
  };
}

/* ============================================
   updateLifecycle(studentId, schoolId, newStatus)
   Called by Phase S execute step on graduation/transfer.
   Non-blocking — portfolio sync failure never
   fails the academic transition.
============================================ */
async function updateLifecycle(studentId, schoolId, newStatus) {
  return AcademicPortfolio.findOneAndUpdate(
    { studentId: studentId, schoolId: schoolId },
    { $set: { portfolioStatus: newStatus, lastComputedAt: null } },
    { new: true }
  );
}

module.exports = {
  ensurePortfolio,
  getPortfolioData,
  getSummary,
  updateLifecycle
};