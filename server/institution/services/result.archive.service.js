'use strict';
/* ============================================
   LATLOMP INSTITUTION — RESULT ARCHIVE SERVICE (E3)

   Responsibilities:
   1. assembleReportData()   — assemble from authoritative sources
   2. getStudentTermHistory() — list accessible terms for a student
   3. createOrUpdateArchiveRecord() — versioned archive metadata
   4. getArchiveDocument()   — retrieves with ownership check
   5. revokeArchiveDocument() — soft delete with audit
   6. generateExcel()        — XLSX export (xlsx already installed)

   Does NOT own: scores, results, attendance, promotions.
   Reads only. Never modifies authoritative records.
============================================ */
'use strict';

const mongoose           = require('mongoose');
const School             = require('../models/School.model');
const SchoolStudent      = require('../models/SchoolStudent.model');
const SchoolScore        = require('../models/SchoolScore.model');
const ReportCardSettings = require('../models/ReportCardSettings.model');
const AcademicTerm       = require('../models/AcademicTerm.model');
const ResultArchiveRecord= require('../models/ResultArchiveRecord.model');
const AcademicPortfolio  = require('../models/AcademicPortfolio.model');

/* ---- Graceful loaders ---- */
function getScoreSubmissionModel() {
  try { return require('../models/ScoreSubmission.model'); } catch(e) { return null; }
}
function getAttendanceModel() {
  var tries = ['../models/Attendance.model', '../models/SchoolAttendance.model'];
  for (var i = 0; i < tries.length; i++) {
    try { return require(tries[i]); } catch(e) {}
  }
  return null;
}
function getPromotionBatchModel() {
  try { return require('../models/PromotionBatch.model'); } catch(e) { return null; }
}

/* ============================================
   buildSubjectSummary(subjects)
   Mirror of reportcard buildSummary() —
   kept in service so PDF/Excel share same logic.
============================================ */
function buildSubjectSummary(subjects) {
  var validSubjects = subjects.filter(function(s) { return s.total !== null; });
  var totalMarks    = 0;
  var maxPossibleSum= 0;
  var subjectsPassed= 0;
  var percentSum    = 0;

  validSubjects.forEach(function(s) {
    totalMarks     += (s.total       || 0);
    maxPossibleSum += (s.maxPossible || 0);
    percentSum     += (s.percentage  || 0);
    if ((s.percentage || 0) >= 50) { subjectsPassed++; }
  });

  return {
    totalMarks,
    maxPossibleSum,
    avgPercent:     validSubjects.length > 0 ? Math.round(percentSum / validSubjects.length) : 0,
    subjectsPassed,
    subjectsTotal:  validSubjects.length
  };
}

/* ============================================
   assembleReportData(studentId, schoolId, termId, opts)

   opts.releasedOnly  — true for student/portal access
   opts.skipComments  — skip ReportCardSettings lookup

   Returns structured payload for PDF/Excel/API.
   Returns null if student not found.
   Returns { notReleased: true } if releasedOnly and not released.
============================================ */
async function assembleReportData(studentId, schoolId, termId, opts) {
  opts = opts || {};
  var releasedOnly = !!opts.releasedOnly;

  /* ---- 1. Student + School + Term in parallel ---- */
  var [student, school, term] = await Promise.all([
    SchoolStudent.findOne({ _id: studentId, schoolId })
      .select('name admissionNo studentId gender dateOfBirth passportPhotoUrl ' +
              'class classId status joinedSession joinedYear parentName parentPhone')
      .lean(),
    School.findById(schoolId)
      .select('name logo address state phone email primaryColor motto principalName')
      .lean(),
    AcademicTerm.findOne({ _id: termId, schoolId }).lean()
  ]);

  if (!student || !school || !term) { return null; }

  /* ---- 2. Load all scores for this student + term ---- */
  var scores = await SchoolScore.find({
    schoolId, studentId, termId
  }).populate('subjectId', 'name code isCore sortOrder').lean();

  /* ---- 3. If releasedOnly: filter to released subjects only ---- */
  if (releasedOnly && scores.length > 0) {
    var ScoreSubmission = getScoreSubmissionModel();
    if (ScoreSubmission) {
      var classId = scores[0].classId;
      var releasedSubs = await ScoreSubmission.find({
        schoolId, classId, termId,
        status: 'approved', releasedToStudents: true
      }).select('subjectId').lean();
      var releasedSubjectIds = new Set(releasedSubs.map(function(s) {
        return s.subjectId.toString();
      }));
      scores = scores.filter(function(s) {
        return s.subjectId && releasedSubjectIds.has(
          (s.subjectId._id || s.subjectId).toString()
        );
      });
    }
  }

  /* ---- 4. Determine classId from scores (historical accuracy) ---- */
  var effectiveClassId = scores.length > 0 ? scores[0].classId : student.classId;

  /* ---- 5. Load ReportCardSettings ---- */
  var settings   = null;
  var teacherComment = '';
  if (effectiveClassId) {
    settings = await ReportCardSettings.findOne({
      schoolId, classId: effectiveClassId, termId
    }).lean();
  }

  /* ---- 6. Release check for student/portal access ---- */
  if (releasedOnly && (!settings || !settings.isReleased)) {
    return { notReleased: true, termName: term.name };
  }

  if (settings && settings.studentComments) {
    var sid = studentId.toString();
    teacherComment = (typeof settings.studentComments.get === 'function')
      ? (settings.studentComments.get(sid) || '')
      : (settings.studentComments[sid] || '');
  }

  /* ---- 7. Build subject list ---- */
  var subjects = scores
    .filter(function(s) { return s.subjectId && s.subjectId._id; })
    .sort(function(a, b) {
      return ((a.subjectId && a.subjectId.sortOrder) || 0) -
             ((b.subjectId && b.subjectId.sortOrder) || 0);
    })
    .map(function(s) {
      return {
        subjectName:  s.subjectId.name      || 'Unknown',
        subjectCode:  s.subjectId.code      || '',
        isCore:       s.subjectId.isCore    !== false,
        total:        s.total               || 0,
        maxPossible:  s.maxPossible         || 100,
        percentage:   s.percentage          || 0,
        grade:        s.grade               || '—',
        remark:       s.remark              || '—',
        position:     s.position            || null,
        positionOutOf:s.positionOutOf       || null,
        scores:       s.scores              || {}
      };
    });

  var summary = buildSubjectSummary(subjects);

  /* ---- 8. Attendance summary ---- */
  var attendanceSummary = null;
  var Attendance = getAttendanceModel();
  if (Attendance) {
    try {
      var attAgg = await Attendance.aggregate([
        { $match: {
          schoolId:  new mongoose.Types.ObjectId(schoolId.toString()),
          studentId: new mongoose.Types.ObjectId(studentId.toString())
        }},
        { $group: {
          _id:     null,
          total:   { $sum: 1 },
          present: { $sum: { $cond: [{ $in: ['$status', ['present','late']] }, 1, 0] }},
          absent:  { $sum: { $cond: [{ $eq: ['$status', 'absent']           }, 1, 0] }}
        }}
      ]);
      if (attAgg.length > 0) {
        var a = attAgg[0];
        attendanceSummary = {
          total:      a.total,
          present:    a.present,
          absent:     a.absent,
          percentage: a.total > 0 ? Math.round((a.present / a.total) * 100) : 0
        };
      }
    } catch (e) { /* non-fatal */ }
  }

  /* ---- 9. Promotion status ---- */
  var promotionStatus = null;
  var PromotionBatch = getPromotionBatchModel();
  if (PromotionBatch) {
    try {
      var batch = await PromotionBatch.findOne({
        schoolId,
        'students.studentId': new mongoose.Types.ObjectId(studentId.toString()),
        status: { $in: ['completed', 'partial'] }
      }).select('students executedAt sourceTermSnapshot sourceClassSnapshot').lean();

      if (batch) {
        var entry = batch.students && batch.students.find(function(s) {
          return s.studentId && s.studentId.toString() === studentId.toString();
        });
        if (entry && entry.executionStatus === 'success') {
          promotionStatus = {
            decision:   entry.finalDecision,
            executedAt: batch.executedAt,
            fromClass:  batch.sourceClassSnapshot ? batch.sourceClassSnapshot.name : '',
            toClass:    entry.targetClassName || ''
          };
        }
      }
    } catch (e) { /* non-fatal */ }
  }

  return {
    school: {
      _id:           school._id,
      name:          school.name,
      logo:          school.logo          || '',
      address:       school.address       || '',
      state:         school.state         || '',
      phone:         school.phone         || '',
      email:         school.email         || '',
      primaryColor:  school.primaryColor  || '#6c63ff',
      motto:         school.motto         || '',
      principalName: school.principalName || ''
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
      classId:         effectiveClassId         || null
    },
    term: {
      _id:     term._id,
      name:    term.name,
      session: term.session,
      term:    term.term
    },
    settings: {
      principalComment: settings ? (settings.principalComment || '') : '',
      resumptionDate:   settings ? (settings.resumptionDate   || null) : null,
      isReleased:       settings ? !!settings.isReleased : false,
      teacherComment
    },
    subjects,
    summary,
    attendanceSummary,
    promotionStatus
  };
}

/* ============================================
   getStudentTermHistory(studentId, schoolId, opts)

   opts.releasedOnly — only include released terms
   Returns: [{ term, classSnapshot, hasScores, isReleased, archiveRecord }]
   Sorted: most recent session first
============================================ */
async function getStudentTermHistory(studentId, schoolId, opts) {
  opts = opts || {};
  var releasedOnly = !!opts.releasedOnly;

  /* Find all distinct termIds with scores for this student */
  var termIds = await SchoolScore.distinct('termId', { schoolId, studentId });
  if (!termIds.length) { return []; }

  /* Fetch those terms */
  var terms = await AcademicTerm.find({ _id: { $in: termIds }, schoolId })
    .sort({ session: -1, term: 1 }).lean();

  if (!terms.length) { return []; }

  /* For each term, check release status and find archive record */
  var results = [];
  for (var i = 0; i < terms.length; i++) {
    var term      = terms[i];
    /* Get classId from first score in this term */
    var firstScore = await SchoolScore.findOne({ schoolId, studentId, termId: term._id })
      .select('classId').lean();
    var classId    = firstScore ? firstScore.classId : null;

    var isReleased = false;
    if (classId) {
      var settings = await ReportCardSettings.findOne({ schoolId, classId, termId: term._id })
        .select('isReleased').lean();
      isReleased = settings ? !!settings.isReleased : false;
    }

    if (releasedOnly && !isReleased) { continue; }

    /* Find latest archive record for this term */
    var archiveRecord = await ResultArchiveRecord.findOne({
      schoolId, studentId, termId: term._id,
      documentType: 'report_card',
      status:       { $in: ['generated', 'issued'] }
    }).select('_id documentVersion status generatedAt storage').lean();

    results.push({
      term: { _id: term._id, name: term.name, session: term.session, term: term.term },
      classId,
      hasScores:     true,
      isReleased,
      archiveRecord: archiveRecord || null
    });
  }

  return results;
}

/* ============================================
   createOrUpdateArchiveRecord(meta)
   Versions correctly: marks old as 'superseded'.
   Never destroys old archive records.
============================================ */
async function createOrUpdateArchiveRecord(meta) {
  /* Find any existing current record for this student+term+type */
  var existing = await ResultArchiveRecord.findOne({
    schoolId:     meta.schoolId,
    studentId:    meta.studentId,
    termId:       meta.termId,
    documentType: meta.documentType || 'report_card',
    status:       { $in: ['generated', 'issued'] }
  });

  var nextVersion = 1;
  if (existing) {
    nextVersion = (existing.documentVersion || 1) + 1;
    /* Mark old as superseded — history preserved */
    await ResultArchiveRecord.findByIdAndUpdate(existing._id, {
      $set: { status: 'superseded' }
    });
  }

  /* Find E2 portfolio for this student */
  var portfolio = await AcademicPortfolio.findOne({
    schoolId: meta.schoolId, studentId: meta.studentId
  }).select('_id').lean();

  return ResultArchiveRecord.create({
    schoolId:        meta.schoolId,
    studentId:       meta.studentId,
    portfolioId:     portfolio ? portfolio._id : null,
    termId:          meta.termId,
    classId:         meta.classId      || null,
    academicYear:    meta.academicYear || '',
    termSnapshot:    meta.termSnapshot    || {},
    classSnapshot:   meta.classSnapshot   || {},
    documentType:    meta.documentType    || 'report_card',
    documentVersion: nextVersion,
    documentHash:    meta.documentHash    || '',
    storage:         meta.storage         || {},
    status:          'generated',
    generatedAt:     new Date(),
    generatedBy:     meta.generatedBy     || null,
    generatedByName: meta.generatedByName || '',
    metadata:        meta.metadata        || {}
  });
}

/* ============================================
   getArchiveDocument(documentId, schoolId)
   Returns null if not found or wrong school.
============================================ */
async function getArchiveDocument(documentId, schoolId) {
  return ResultArchiveRecord.findOne({
    _id:      documentId,
    schoolId: schoolId
  }).lean();
}

/* ============================================
   revokeArchiveDocument(documentId, schoolId, userId, reason)
============================================ */
async function revokeArchiveDocument(documentId, schoolId, userId, reason) {
  return ResultArchiveRecord.findOneAndUpdate(
    { _id: documentId, schoolId },
    {
      $set: {
        status:        'revoked',
        revokedAt:     new Date(),
        revokedBy:     userId,
        revokedReason: reason || 'Revoked by administrator'
      }
    },
    { new: true }
  );
}

/* ============================================
   generateExcel(reportData)
   Uses xlsx (already installed in package.json).
   Returns Buffer.
============================================ */
function generateExcel(reportData) {
  var XLSX = require('xlsx');

  var school  = reportData.school  || {};
  var student = reportData.student || {};
  var term    = reportData.term    || {};
  var summary = reportData.summary || {};
  var subjects= reportData.subjects|| [];

  var rows = [];

  /* School + document heading */
  rows.push([school.name || 'School', '', '', '', '', '', '']);
  rows.push(['ACADEMIC REPORT CARD', '', '', '', '', '', '']);
  rows.push([]);

  /* Student info */
  rows.push(['Student Name:', student.name || '',      '', 'Admission No:', student.admissionNo || '']);
  rows.push(['Class/Level:', student.class || '',      '', 'Gender:',       student.gender      || '']);
  rows.push(['Term:',        term.name     || '',      '', 'Session:',      term.session        || '']);
  rows.push([]);

  /* Subject table header */
  rows.push(['Subject', 'Core?', 'Total', 'Max', '%', 'Grade', 'Remark', 'Class Position']);

  /* Subject rows */
  subjects.forEach(function(s) {
    var pos = s.position ? s.position + '/' + (s.positionOutOf || '') : '—';
    rows.push([
      s.subjectName  || '',
      s.isCore ? '★ Core' : '',
      s.total        != null ? s.total        : '—',
      s.maxPossible  != null ? s.maxPossible  : '—',
      s.percentage   != null ? s.percentage + '%' : '—',
      s.grade        || '—',
      s.remark       || '—',
      pos
    ]);
  });

  rows.push([]);

  /* Summary */
  rows.push(['SUMMARY', '', '', '', '', '', '']);
  rows.push(['Total Marks:', (summary.totalMarks || 0) + '/' + (summary.maxPossibleSum || 0)]);
  rows.push(['Average:', (summary.avgPercent || 0) + '%']);
  rows.push(['Subjects Passed:', (summary.subjectsPassed || 0) + '/' + (summary.subjectsTotal || 0)]);

  if (reportData.attendanceSummary) {
    rows.push([]);
    var att = reportData.attendanceSummary;
    rows.push(['Attendance:', att.percentage + '% (' + att.present + '/' + att.total + ' days)']);
  }

  if (reportData.promotionStatus) {
    rows.push([]);
    var ps = reportData.promotionStatus;
    rows.push(['Promotion Status:', (ps.decision || '').toUpperCase().replace(/_/g, ' ')]);
  }

  rows.push([]);

  /* Comments */
  if (reportData.settings && reportData.settings.teacherComment) {
    rows.push(["Class Teacher's Comment:", reportData.settings.teacherComment]);
  }
  if (reportData.settings && reportData.settings.principalComment) {
    rows.push(["Principal's Comment:", reportData.settings.principalComment]);
  }
  if (reportData.settings && reportData.settings.resumptionDate) {
    rows.push(['Next Term Resumes:', new Date(reportData.settings.resumptionDate)
      .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })]);
  }

  rows.push([]);
  rows.push(['Generated by:', 'LatLomp Education Platform', '', 'Date:', new Date().toLocaleDateString('en-GB')]);

  /* Build workbook */
  var ws = XLSX.utils.aoa_to_sheet(rows);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report Card');

  /* Basic column widths */
  ws['!cols'] = [
    { wch: 30 }, { wch: 10 }, { wch: 8 }, { wch: 8 },
    { wch: 8 },  { wch: 8 },  { wch: 15 },{ wch: 15 }
  ];

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  assembleReportData,
  getStudentTermHistory,
  createOrUpdateArchiveRecord,
  getArchiveDocument,
  revokeArchiveDocument,
  generateExcel,
  buildSubjectSummary /* exported for testing */
};