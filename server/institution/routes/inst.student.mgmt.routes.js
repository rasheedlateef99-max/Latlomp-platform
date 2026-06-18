/* ============================================
   LATLOMP INSTITUTION — STUDENT MANAGEMENT ROUTES
   ✅ PHASE J: Student Identity System

   🐛 BUG FIX:
   - Removed hard require('../models/SchoolClass.model')
     which crashed server if file doesn't exist yet.
   - SchoolClass is now loaded lazily inside functions
     using a safe try/catch — if it doesn't exist,
     routes still work, class name matching is skipped.
   - Auth fixed to match project pattern:
     instProtect + schoolAdminOnly + requireActiveSubscription
     (confirmed from inst.school.routes.js Document 9)

   IMPORTANT: This file is SEPARATE from
   inst.student.routes.js which handles CBT exam
   access (verify-code, submit) — untouched.
============================================ */
'use strict';

const express  = require('express');
const router   = express.Router();
const mongoose = require('mongoose');

const SchoolStudent = require('../models/SchoolStudent.model');
const School        = require('../models/School.model');

const { instProtect, schoolAdminOnly } = require('../middleware/inst.auth');
const { requireActiveSubscription }    = require('../middleware/inst.tenant');

var guard = [instProtect, schoolAdminOnly, requireActiveSubscription];

/* ---- Lazy-load SchoolClass model ---- */
function getSchoolClassModel() {
  try { return require('../models/SchoolClass.model'); } catch(e) {
    return null;
  }
}

/* ============================================
   GET /list
============================================ */
router.get('/list', guard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var page     = Math.max(1, parseInt(req.query.page)  || 1);
    var limit    = Math.min(100, parseInt(req.query.limit) || 30);
    var skip     = (page - 1) * limit;

    var query = { schoolId: schoolId };
    if (req.query.classId) { query.classId = req.query.classId; }
    if (req.query.status)  { query.status  = req.query.status; }

    if (req.query.search) {
      var s  = String(req.query.search).trim();
      var rx = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ name: rx }, { admissionNo: rx }, { studentId: rx }];
    }

    var total    = await SchoolStudent.countDocuments(query);
    var students = await SchoolStudent.find(query)
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
    console.error('[inst.student.mgmt] GET /list:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load students.' });
  }
});

/* ============================================
   GET /stats
============================================ */
router.get('/stats', guard, async function (req, res) {
  try {
    var schoolId = req.schoolId;

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
    console.error('[inst.student.mgmt] GET /stats:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load stats.' });
  }
});

/* ============================================
   GET /:id
============================================ */
router.get('/:id', guard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }
    var student = await SchoolStudent.findOne({ _id: req.params.id, schoolId: schoolId }).lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }
    return res.json({ success: true, student: student });
  } catch (err) {
    console.error('[inst.student.mgmt] GET /:id:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load student.' });
  }
});

/* ============================================
   POST /
   Register new student
============================================ */
router.post('/', guard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var body     = req.body || {};
    var name     = (body.name || '').trim();

    if (!name) {
      return res.status(400).json({ success: false, message: 'Student name is required.' });
    }

    var school     = await School.findById(schoolId).select('name').lean();
    var schoolName = school ? school.name : 'SCH';
    var joinedYear = parseInt(body.joinedYear) || new Date().getFullYear();
    var studentId  = await SchoolStudent.generateStudentId(schoolId, schoolName, joinedYear);

    /* Try to get class name from SchoolClass model — safe fallback if missing */
    var classLabel = (body.classLabel || '').trim();
    if (!classLabel && body.classId) {
      try {
        var SchoolClass = getSchoolClassModel();
        if (SchoolClass) {
          var cls = await SchoolClass.findOne({ _id: body.classId, schoolId: schoolId }).lean();
          if (cls) { classLabel = cls.name; }
        }
      } catch(e) { /* ignore */ }
    }

    var classHistory = [];
    if (body.classId && classLabel) {
      classHistory.push({
        classId:    body.classId,
        className:  classLabel,
        session:    body.joinedSession || '',
        term:       '',
        action:     'enrolled',
        recordedAt: new Date()
      });
    }

    var student = await SchoolStudent.create({
      schoolId:         schoolId,
      studentId:        studentId,
      name:             name,
      admissionNo:      (body.admissionNo      || '').trim(),
      class:            classLabel,
      classId:          body.classId           || null,
      gender:           body.gender            || '',
      dateOfBirth:      body.dateOfBirth        || null,
      passportPhotoUrl: (body.passportPhotoUrl  || '').trim(),
      email:            (body.email            || '').trim(),
      phone:            (body.phone            || '').trim(),
      address:          (body.address          || '').trim(),
      parentName:       (body.parentName        || '').trim(),
      parentPhone:      (body.parentPhone       || '').trim(),
      parentEmail:      (body.parentEmail       || '').trim(),
      status:           'active',
      isActive:         true,
      joinedSession:    (body.joinedSession     || '').trim(),
      joinedYear:       joinedYear,
      classHistory:     classHistory
    });

    return res.status(201).json({ success: true, message: 'Student registered successfully.', student: student });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'A student with this admission number already exists.' });
    }
    console.error('[inst.student.mgmt] POST /:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to register student.' });
  }
});

/* ============================================
   PUT /:id
   Update profile fields
============================================ */
router.put('/:id', guard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }
    var body    = req.body || {};
    var updates = {};
    var fields  = ['name','admissionNo','gender','email','phone','address',
                   'parentName','parentPhone','parentEmail','passportPhotoUrl','joinedSession'];
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
    console.error('[inst.student.mgmt] PUT /:id:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update student.' });
  }
});

/* ============================================
   PUT /:id/assign-class
============================================ */
router.put('/:id/assign-class', guard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var classId  = req.body.classId;
    var session  = req.body.session || '';
    var action   = req.body.action  || 'promoted';

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }
    if (!classId) {
      return res.status(400).json({ success: false, message: 'classId is required.' });
    }

    /* Try to resolve class name — safe fallback */
    var className = req.body.className || '';
    if (!className) {
      try {
        var SchoolClass = getSchoolClassModel();
        if (SchoolClass) {
          var cls = await SchoolClass.findOne({ _id: classId, schoolId: schoolId }).lean();
          if (cls) { className = cls.name; }
        }
      } catch(e) { /* ignore */ }
    }

    var student = await SchoolStudent.findOne({ _id: req.params.id, schoolId: schoolId });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    student.classId = classId;
    if (className) { student.class = className; }
    student.classHistory.push({
      classId:    classId,
      className:  className,
      session:    session,
      term:       '',
      action:     action,
      recordedAt: new Date()
    });

    await student.save();
    return res.json({ success: true, message: 'Class assignment updated.', student: student });
  } catch (err) {
    console.error('[inst.student.mgmt] PUT /:id/assign-class:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to assign class.' });
  }
});

/* ============================================
   PUT /:id/status
============================================ */
router.put('/:id/status', guard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
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
    console.error('[inst.student.mgmt] PUT /:id/status:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update status.' });
  }
});

/* ============================================
   DELETE /:id
============================================ */
router.delete('/:id', guard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }
    var student = await SchoolStudent.findOneAndDelete({ _id: req.params.id, schoolId: schoolId });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }
    return res.json({ success: true, message: 'Student removed.' });
  } catch (err) {
    console.error('[inst.student.mgmt] DELETE /:id:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to remove student.' });
  }
});

/* ============================================
   POST /bulk-import
============================================ */
router.post('/bulk-import', guard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var rows     = req.body.students;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No student rows provided.' });
    }
    if (rows.length > 1000) {
      return res.status(400).json({ success: false, message: 'Maximum 1000 students per import.' });
    }

    var school     = await School.findById(schoolId).select('name').lean();
    var schoolName = school ? school.name : 'SCH';
    var year       = new Date().getFullYear();

    /* Try to load class lookup — safe fallback */
    var classByName = {};
    try {
      var SchoolClass = getSchoolClassModel();
      if (SchoolClass) {
        var classes = await SchoolClass.find({ schoolId: schoolId }).lean();
        classes.forEach(function (c) {
          classByName[(c.name || '').toLowerCase().trim()] = c;
        });
      }
    } catch(e) { /* ignore — bulk import works without class matching */ }

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
      var studentId    = await SchoolStudent.generateStudentId(schoolId, schoolName, year);

      try {
        await SchoolStudent.create({
          schoolId:     schoolId,
          studentId:    studentId,
          name:         name,
          admissionNo:  admissionNo,
          class:        classLabel,
          classId:      matchedClass ? matchedClass._id : null,
          gender:       String(row.gender || row.Gender || '').toLowerCase().trim(),
          parentName:   String(row.parentName  || row['Parent Name']  || '').trim(),
          parentPhone:  String(row.parentPhone || row['Parent Phone'] || '').trim(),
          email:        String(row.email || row.Email || '').trim(),
          phone:        String(row.phone || row.Phone || '').trim(),
          status:       'active',
          isActive:     true,
          joinedYear:   year,
          classHistory: matchedClass ? [{
            classId:    matchedClass._id,
            className:  matchedClass.name,
            session:    '',
            term:       '',
            action:     'enrolled',
            recordedAt: new Date()
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
    console.error('[inst.student.mgmt] POST /bulk-import:', err.message);
    return res.status(500).json({ success: false, message: 'Bulk import failed.' });
  }
});

module.exports = router;