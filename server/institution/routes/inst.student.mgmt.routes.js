/* ============================================
   LATLOMP INSTITUTION — STUDENT MANAGEMENT ROUTES
   ✅ PHASE J: Student Identity System

   IMPORTANT: This file is SEPARATE from
   inst.student.routes.js, which handles CBT exam
   access (verify-code, submit) and has NO auth —
   it is accessed by exam code only. That file is
   untouched.

   This file handles school-admin student records:
   registration, profile, class assignment, status
   lifecycle, bulk import. All routes require a
   valid school-admin session and are isolated by
   schoolId on every single query.

   Mounted at: /api/institution/students
   (plural — distinct from /api/institution/student
   which is singular and used by the CBT path)
============================================ */
'use strict';

const express  = require('express');
const router   = express.Router();
const mongoose = require('mongoose');

const SchoolStudent = require('../models/SchoolStudent.model');
const School         = require('../models/School.model');
const SchoolClass    = require('../models/SchoolClass.model');

const { instSchoolAuth } = require('../middleware/inst.auth.middleware');
/* ⚠️ VERIFY: if your middleware exports a different name for
   school-admin auth (e.g. instAdminAuth, instSchoolAdminAuth),
   change the line above to match. Everything else is unaffected. */

router.use(instSchoolAuth);

/* ============================================
   GET /list
   Paginated, filterable, searchable student list
============================================ */
router.get('/list', async function (req, res) {
  try {
    var schoolId = req.schoolUser.schoolId;
    var page     = Math.max(1, parseInt(req.query.page) || 1);
    var limit    = Math.min(100, parseInt(req.query.limit) || 30);
    var skip     = (page - 1) * limit;

    var query = { schoolId: schoolId };

    if (req.query.classId) { query.classId = req.query.classId; }
    if (req.query.status)  { query.status  = req.query.status; }

    if (req.query.search) {
      var s   = String(req.query.search).trim();
      var rx  = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { name: rx },
        { admissionNo: rx },
        { studentId: rx }
      ];
    }

    var total = await SchoolStudent.countDocuments(query);
    var students = await SchoolStudent.find(query)
      .populate('classId', 'name category')
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return res.json({
      success: true,
      students: students,
      pagination: { page: page, limit: limit, total: total, pages: Math.ceil(total / limit) || 1 }
    });
  } catch (err) {
    console.error('[inst.student.mgmt] GET /list error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load students.' });
  }
});

/* ============================================
   GET /stats
   Quick counts for the dashboard cards
============================================ */
router.get('/stats', async function (req, res) {
  try {
    var schoolId = req.schoolUser.schoolId;

    var total       = await SchoolStudent.countDocuments({ schoolId: schoolId });
    var active      = await SchoolStudent.countDocuments({ schoolId: schoolId, status: 'active' });
    var graduated   = await SchoolStudent.countDocuments({ schoolId: schoolId, status: 'graduated' });
    var transferred = await SchoolStudent.countDocuments({ schoolId: schoolId, status: 'transferred' });
    var noClass     = await SchoolStudent.countDocuments({ schoolId: schoolId, classId: null });

    return res.json({
      success: true,
      stats: { total: total, active: active, graduated: graduated, transferred: transferred, noClass: noClass }
    });
  } catch (err) {
    console.error('[inst.student.mgmt] GET /stats error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load stats.' });
  }
});

/* ============================================
   GET /:id
   Single student profile
============================================ */
router.get('/:id', async function (req, res) {
  try {
    var schoolId = req.schoolUser.schoolId;
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }
    var student = await SchoolStudent.findOne({ _id: req.params.id, schoolId: schoolId })
      .populate('classId', 'name category')
      .lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }
    return res.json({ success: true, student: student });
  } catch (err) {
    console.error('[inst.student.mgmt] GET /:id error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load student.' });
  }
});

/* ============================================
   POST /
   Register new student — auto-generates studentId
============================================ */
router.post('/', async function (req, res) {
  try {
    var schoolId = req.schoolUser.schoolId;
    var body     = req.body || {};

    var name = (body.name || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, message: 'Student name is required.' });
    }

    var school     = await School.findById(schoolId).select('name').lean();
    var schoolName = school ? school.name : 'SCH';

    var joinedYear = parseInt(body.joinedYear) || new Date().getFullYear();
    var studentId  = await SchoolStudent.generateStudentId(schoolId, schoolName, joinedYear);

    var classHistoryEntry = null;
    if (body.classId) {
      var cls = await SchoolClass.findOne({ _id: body.classId, schoolId: schoolId }).lean();
      if (cls) {
        classHistoryEntry = {
          classId:    cls._id,
          className:  cls.name,
          session:    body.joinedSession || '',
          term:       '',
          action:     'enrolled',
          recordedAt: new Date()
        };
      }
    }

    var student = await SchoolStudent.create({
      schoolId:         schoolId,
      studentId:        studentId,
      name:             name,
      admissionNo:      (body.admissionNo || '').trim(),
      class:            (body.classLabel || '').trim(),
      classId:          body.classId || null,
      gender:           body.gender || '',
      dateOfBirth:      body.dateOfBirth || null,
      passportPhotoUrl: (body.passportPhotoUrl || '').trim(),
      email:            (body.email || '').trim(),
      phone:            (body.phone || '').trim(),
      address:          (body.address || '').trim(),
      parentName:       (body.parentName || '').trim(),
      parentPhone:      (body.parentPhone || '').trim(),
      parentEmail:      (body.parentEmail || '').trim(),
      status:           'active',
      isActive:         true,
      joinedSession:    (body.joinedSession || '').trim(),
      joinedYear:       joinedYear,
      classHistory:     classHistoryEntry ? [classHistoryEntry] : []
    });

    return res.status(201).json({ success: true, message: 'Student registered successfully.', student: student });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'A student with this admission number already exists.' });
    }
    console.error('[inst.student.mgmt] POST / error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to register student.' });
  }
});

/* ============================================
   PUT /:id
   Update profile fields (NOT class assignment —
   use /:id/assign-class for that, so history is
   always recorded correctly)
============================================ */
router.put('/:id', async function (req, res) {
  try {
    var schoolId = req.schoolUser.schoolId;
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }
    var body = req.body || {};

    var updates = {};
    var fields = ['name','admissionNo','gender','email','phone','address','parentName','parentPhone','parentEmail','passportPhotoUrl','joinedSession'];
    fields.forEach(function (f) {
      if (body[f] !== undefined) { updates[f] = String(body[f]).trim(); }
    });
    if (body.dateOfBirth !== undefined) { updates.dateOfBirth = body.dateOfBirth || null; }
    if (body.classLabel  !== undefined) { updates.class = String(body.classLabel).trim(); }

    if (updates.name === '') {
      return res.status(400).json({ success: false, message: 'Student name cannot be empty.' });
    }

    var student = await SchoolStudent.findOneAndUpdate(
      { _id: req.params.id, schoolId: schoolId },
      { $set: updates },
      { new: true }
    );

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    return res.json({ success: true, message: 'Student updated.', student: student });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'A student with this admission number already exists.' });
    }
    console.error('[inst.student.mgmt] PUT /:id error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update student.' });
  }
});

/* ============================================
   PUT /:id/assign-class
   Change class + permanently record history entry
============================================ */
router.put('/:id/assign-class', async function (req, res) {
  try {
    var schoolId = req.schoolUser.schoolId;
    var classId  = req.body.classId;
    var session  = req.body.session || '';
    var action   = req.body.action || 'promoted';

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }
    if (!classId) {
      return res.status(400).json({ success: false, message: 'Class is required.' });
    }

    var cls = await SchoolClass.findOne({ _id: classId, schoolId: schoolId }).lean();
    if (!cls) {
      return res.status(404).json({ success: false, message: 'Class not found.' });
    }

    var student = await SchoolStudent.findOne({ _id: req.params.id, schoolId: schoolId });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    student.classId = cls._id;
    student.class    = cls.name;
    student.classHistory.push({
      classId:    cls._id,
      className:  cls.name,
      session:    session,
      term:       '',
      action:     action,
      recordedAt: new Date()
    });

    await student.save();

    return res.json({ success: true, message: 'Class assignment updated.', student: student });
  } catch (err) {
    console.error('[inst.student.mgmt] PUT /:id/assign-class error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to assign class.' });
  }
});

/* ============================================
   PUT /:id/status
   Change lifecycle status — keeps isActive in sync
============================================ */
router.put('/:id/status', async function (req, res) {
  try {
    var schoolId = req.schoolUser.schoolId;
    var status   = req.body.status;
    var allowed  = ['active','graduated','transferred','repeated','inactive'];

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }
    if (allowed.indexOf(status) === -1) {
      return res.status(400).json({ success: false, message: 'Invalid status value.' });
    }

    var student = await SchoolStudent.findOneAndUpdate(
      { _id: req.params.id, schoolId: schoolId },
      { $set: { status: status, isActive: (status === 'active') } },
      { new: true }
    );

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    return res.json({ success: true, message: 'Student status updated to ' + status + '.', student: student });
  } catch (err) {
    console.error('[inst.student.mgmt] PUT /:id/status error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update status.' });
  }
});

/* ============================================
   DELETE /:id
============================================ */
router.delete('/:id', async function (req, res) {
  try {
    var schoolId = req.schoolUser.schoolId;
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }
    var student = await SchoolStudent.findOneAndDelete({ _id: req.params.id, schoolId: schoolId });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }
    return res.json({ success: true, message: 'Student removed.' });
  } catch (err) {
    console.error('[inst.student.mgmt] DELETE /:id error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to remove student.' });
  }
});

/* ============================================
   POST /bulk-import
   Accepts a pre-parsed array of student rows
   (parsed client-side from CSV/XLSX via SheetJS —
   no multer, no new backend packages)
============================================ */
router.post('/bulk-import', async function (req, res) {
  try {
    var schoolId = req.schoolUser.schoolId;
    var rows = req.body.students;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No student rows provided.' });
    }
    if (rows.length > 1000) {
      return res.status(400).json({ success: false, message: 'Maximum 1000 students per import.' });
    }

    var school     = await School.findById(schoolId).select('name').lean();
    var schoolName = school ? school.name : 'SCH';
    var year       = new Date().getFullYear();

    var classByName = {};
    var classes = await SchoolClass.find({ schoolId: schoolId }).lean();
    classes.forEach(function (c) { classByName[(c.name || '').toLowerCase().trim()] = c; });

    var created = 0;
    var skipped = 0;
    var errors  = [];

    for (var i = 0; i < rows.length; i++) {
      var row  = rows[i] || {};
      var name = String(row.name || row.Name || '').trim();

      if (!name) { skipped++; errors.push('Row ' + (i + 1) + ': missing name.'); continue; }

      var admissionNo = String(row.admissionNo || row.AdmissionNo || row['Admission No'] || '').trim();

      if (admissionNo) {
        var dup = await SchoolStudent.findOne({ schoolId: schoolId, admissionNo: admissionNo }).lean();
        if (dup) { skipped++; errors.push('Row ' + (i + 1) + ': admission number "' + admissionNo + '" already exists.'); continue; }
      }

      var classLabel   = String(row.class || row.Class || '').trim();
      var matchedClass = classLabel ? classByName[classLabel.toLowerCase()] : null;

      var studentId = await SchoolStudent.generateStudentId(schoolId, schoolName, year);

      try {
        await SchoolStudent.create({
          schoolId:     schoolId,
          studentId:    studentId,
          name:         name,
          admissionNo:  admissionNo,
          class:        classLabel,
          classId:      matchedClass ? matchedClass._id : null,
          gender:       String(row.gender || row.Gender || '').toLowerCase().trim(),
          parentName:   String(row.parentName || row['Parent Name'] || '').trim(),
          parentPhone:  String(row.parentPhone || row['Parent Phone'] || '').trim(),
          email:        String(row.email || row.Email || '').trim(),
          phone:        String(row.phone || row.Phone || '').trim(),
          status:       'active',
          isActive:     true,
          joinedYear:   year,
          classHistory: matchedClass ? [{
            classId: matchedClass._id, className: matchedClass.name,
            session: '', term: '', action: 'enrolled', recordedAt: new Date()
          }] : []
        });
        created++;
      } catch (e) {
        skipped++;
        errors.push('Row ' + (i + 1) + ': ' + e.message);
      }
    }

    return res.json({
      success: true,
      message: created + ' student(s) imported, ' + skipped + ' skipped.',
      created: created,
      skipped: skipped,
      errors:  errors.slice(0, 20)
    });
  } catch (err) {
    console.error('[inst.student.mgmt] POST /bulk-import error:', err.message);
    return res.status(500).json({ success: false, message: 'Bulk import failed.' });
  }
});

module.exports = router;