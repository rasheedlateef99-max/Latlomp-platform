/* ============================================
   LATLOMP INSTITUTION — STUDENT MANAGEMENT ROUTES
   ✅ PHASE J: Student Identity System

   ✅ RESTRUCTURE STAGE 4: Student management
   delegated to class_teacher and department_admin.

   GUARD CHANGES:
     manageGuard (canManageStudents) replaces adminGuard
     on all student read and write endpoints.
     Scope checks enforce class/department ownership.

   STAYS adminOnlyGuard:
     DELETE /:id       — deletion is high-risk, admin-only
     POST /bulk-import — mass operation, admin-only

   NEW ENDPOINT:
     GET /my-class/students — auto-scoped by role.
     Admin: all students. class_teacher: their class.
     department_admin/hod: their department.

   AUDIT TRAIL:
     POST / now sets createdByRole and createdById
     so admins can see which staff registered students.

   SCOPE ENFORCEMENT RULES:
     school_admin, principal, vice_principal, dean:
       Unrestricted — all students.
     class_teacher:
       Auto-filter by classId (their assigned class).
       Scope check on writes: target student.classId
       must match schoolUser.classId.
     hod / department_admin:
       Auto-filter by departmentId.
       Scope check on writes: target student.departmentId
       must match schoolUser.departmentId.

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

const {
  instProtect,
  schoolAdminOnly,
  canManageStudents,     /* ✅ STAGE 4 */
  verifyStudentScope,    /* ✅ STAGE 4 */
  getEffectiveRoles      /* ✅ STAGE 4 */
} = require('../middleware/inst.auth');
const { requireActiveSubscription } = require('../middleware/inst.tenant');

/* ✅ STAGE 4: manageGuard for most student operations */
var manageGuard    = [instProtect, canManageStudents,  requireActiveSubscription];
/* adminOnlyGuard for high-risk operations (delete, bulk-import) */
var adminOnlyGuard = [instProtect, schoolAdminOnly,    requireActiveSubscription];

/* ---- Lazy-load SchoolClass model (preserved from Phase J bug fix) ---- */
function getSchoolClassModel() {
  try { return require('../models/Class.model'); } catch (e) { return null; }
}

/* ============================================
   ✅ STAGE 4 HELPERS

   SENIOR_ROLES: unrestricted student access
   applyScopeFilter(): adds classId or departmentId
     to a Mongoose query based on caller's role.
     Called by GET /list, GET /stats,
     GET /my-class/students.
   isUnrestricted(): true for admin/senior staff
     (no scope filter applied).
============================================ */
var SENIOR_ROLES = ['school_admin', 'principal', 'vice_principal', 'dean'];

function isUnrestricted(schoolUser) {
  var roles = getEffectiveRoles(schoolUser);
  return roles.some(function (r) { return SENIOR_ROLES.includes(r); });
}

function applyScopeFilter(schoolUser, query) {
  if (isUnrestricted(schoolUser)) { return; }
  var effectiveRoles = getEffectiveRoles(schoolUser);
  if (effectiveRoles.includes('class_teacher') && schoolUser.classId) {
    query.classId = schoolUser.classId;
  } else if (
    effectiveRoles.some(function (r) { return ['hod', 'department_admin'].includes(r); }) &&
    schoolUser.departmentId
  ) {
    query.departmentId = schoolUser.departmentId;
  }
}

/* ============================================
   GET /list
   ✅ STAGE 4: manageGuard + auto-scope filter.
   Admin sees all students.
   class_teacher sees only their class.
   hod/department_admin sees only their department.
============================================ */
router.get('/list', manageGuard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var page     = Math.max(1, parseInt(req.query.page)    || 1);
    var limit    = Math.min(100, parseInt(req.query.limit) || 30);
    var skip     = (page - 1) * limit;

    var query = { schoolId: schoolId };

    /* ✅ STAGE 4: auto-scope by role */
    applyScopeFilter(req.schoolUser, query);

    /* Caller-supplied filters (apply only within scope) */
    if (req.query.classId && isUnrestricted(req.schoolUser)) {
      query.classId = req.query.classId;
    }
    if (req.query.status) { query.status = req.query.status; }

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
      success:    true,
      students:   students,
      pagination: {
        page: page, limit: limit,
        total: total,
        pages: Math.ceil(total / limit) || 1
      }
    });
  } catch (err) {
    console.error('[inst.student.mgmt] GET /list:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load students.' });
  }
});

/* ============================================
   GET /stats
   ✅ STAGE 4: manageGuard + scope filter.
   Counts are scoped to the caller's class/dept.
============================================ */
router.get('/stats', manageGuard, async function (req, res) {
  try {
    var schoolId  = req.schoolId;
    var baseQuery = { schoolId: schoolId };
    applyScopeFilter(req.schoolUser, baseQuery);

    var total       = await SchoolStudent.countDocuments(baseQuery);
    var active      = await SchoolStudent.countDocuments(Object.assign({}, baseQuery, { status: 'active' }));
    var graduated   = await SchoolStudent.countDocuments(Object.assign({}, baseQuery, { status: 'graduated' }));
    var transferred = await SchoolStudent.countDocuments(Object.assign({}, baseQuery, { status: 'transferred' }));
    var noClass     = await SchoolStudent.countDocuments(Object.assign({}, baseQuery, { classId: null }));

    return res.json({
      success: true,
      stats: {
        total:       total,
        active:      active,
        graduated:   graduated,
        transferred: transferred,
        noClass:     noClass
      }
    });
  } catch (err) {
    console.error('[inst.student.mgmt] GET /stats:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load stats.' });
  }
});

/* ============================================
   ✅ NEW STAGE 4: GET /my-class/students
   Auto-scoped student list for dashboard use.
   No pagination — returns full scoped list.
   Used by class_teacher dashboard on load.
   ⚠ Must be BEFORE GET /:id to avoid
     Express treating "my-class" as an :id param.
============================================ */
router.get('/my-class/students', manageGuard, async function (req, res) {
  try {
    var query = { schoolId: req.schoolId, status: 'active' };
    applyScopeFilter(req.schoolUser, query);

    var effectiveRoles = getEffectiveRoles(req.schoolUser);
    var scopeLabel     = 'institution';

    if (effectiveRoles.includes('class_teacher') && !isUnrestricted(req.schoolUser)) {
      scopeLabel = req.schoolUser.classId
        ? 'class:' + req.schoolUser.classId.toString()
        : 'unassigned';
    } else if (
      effectiveRoles.some(function (r) { return ['hod', 'department_admin'].includes(r); }) &&
      !isUnrestricted(req.schoolUser)
    ) {
      scopeLabel = req.schoolUser.departmentId
        ? 'department:' + req.schoolUser.departmentId.toString()
        : 'unassigned';
    }

    var students = await SchoolStudent.find(query)
      .select('name admissionNo studentId classId departmentId gender passportPhotoUrl pinCode status')
      .sort({ name: 1 })
      .lean();

    /* Mask pinCode in response — only expose whether it is set */
    var result = students.map(function (s) {
      return Object.assign({}, s, { hasPin: !!s.pinCode, pinCode: undefined });
    });

    return res.json({
      success:    true,
      students:   result,
      total:      result.length,
      scope:      scopeLabel
    });
  } catch (err) {
    console.error('[inst.student.mgmt] GET /my-class/students:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load students.' });
  }
});

/* ============================================
   GET /:id
   ✅ STAGE 4: manageGuard + scope check.
   class_teacher can only view students in
   their assigned class.
============================================ */
router.get('/:id', manageGuard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }
    var student = await SchoolStudent.findOne({ _id: req.params.id, schoolId: schoolId }).lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    /* ✅ STAGE 4: scope check */
    if (!isUnrestricted(req.schoolUser)) {
      var scopeErr = verifyStudentScope(
        req.schoolUser,
        student.classId      ? student.classId.toString()      : null,
        student.departmentId ? student.departmentId.toString() : null
      );
      if (scopeErr) {
        return res.status(403).json({ success: false, message: scopeErr });
      }
    }

    return res.json({ success: true, student: student });
  } catch (err) {
    console.error('[inst.student.mgmt] GET /:id:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load student.' });
  }
});

/* ============================================
   POST /
   Register new student.
   ✅ STAGE 4: manageGuard + scope check +
   audit trail (createdByRole, createdById).
   class_teacher can only register students
   to their assigned class.
============================================ */
router.post('/', manageGuard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var body     = req.body || {};
    var name     = (body.name || '').trim();

    if (!name) {
      return res.status(400).json({ success: false, message: 'Student name is required.' });
    }

    /* ✅ STAGE 4: scope check before creating */
    if (!isUnrestricted(req.schoolUser)) {
      var scopeErr = verifyStudentScope(
        req.schoolUser,
        body.classId      || null,
        body.departmentId || null
      );
      if (scopeErr) {
        return res.status(403).json({ success: false, message: scopeErr });
      }
    }

    var school     = await School.findById(schoolId).select('name').lean();
    var schoolName = school ? school.name : 'SCH';
    var joinedYear = parseInt(body.joinedYear) || new Date().getFullYear();
    var studentId  = await SchoolStudent.generateStudentId(schoolId, schoolName, joinedYear);

    /* Try to get class name — safe fallback */
    var classLabel = (body.classLabel || '').trim();
    if (!classLabel && body.classId) {
      try {
        var SchoolClass = getSchoolClassModel();
        if (SchoolClass) {
          var cls = await SchoolClass.findOne({ _id: body.classId, schoolId: schoolId }).lean();
          if (cls) { classLabel = cls.name; }
        }
      } catch (e) { /* ignore */ }
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
      departmentId:     body.departmentId      || null,
      gender:           body.gender            || '',
      dateOfBirth:      body.dateOfBirth       || null,
      passportPhotoUrl: (body.passportPhotoUrl || '').trim(),
      email:            (body.email            || '').trim(),
      phone:            (body.phone            || '').trim(),
      address:          (body.address          || '').trim(),
      parentName:       (body.parentName       || '').trim(),
      parentPhone:      (body.parentPhone      || '').trim(),
      parentEmail:      (body.parentEmail      || '').trim(),
      status:           'active',
      isActive:         true,
      joinedSession:    (body.joinedSession    || '').trim(),
      joinedYear:       joinedYear,
      classHistory:     classHistory,
      /* ✅ STAGE 4: audit trail */
      createdByRole:    req.schoolUser.role    || '',
      createdById:      req.schoolUser._id
    });

    return res.status(201).json({
      success: true,
      message: 'Student registered successfully.',
      student: student
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'A student with this admission number already exists.'
      });
    }
    console.error('[inst.student.mgmt] POST /:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to register student.' });
  }
});

/* ============================================
   PUT /:id
   Update profile fields.
   ✅ STAGE 4: manageGuard + scope check.
============================================ */
router.put('/:id', manageGuard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }

    /* Load student first to verify scope */
    var existing = await SchoolStudent.findOne({ _id: req.params.id, schoolId: schoolId }).lean();
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    /* ✅ STAGE 4: scope check */
    if (!isUnrestricted(req.schoolUser)) {
      var scopeErr = verifyStudentScope(
        req.schoolUser,
        existing.classId      ? existing.classId.toString()      : null,
        existing.departmentId ? existing.departmentId.toString() : null
      );
      if (scopeErr) {
        return res.status(403).json({ success: false, message: scopeErr });
      }
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
    return res.json({ success: true, message: 'Student updated.', student: student });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'A student with this admission number already exists.'
      });
    }
    console.error('[inst.student.mgmt] PUT /:id:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update student.' });
  }
});

/* ============================================
   PUT /:id/assign-class
   ✅ STAGE 4: manageGuard + scope check.
   class_teacher can only assign students to
   their own class, not to any other class.
============================================ */
router.put('/:id/assign-class', manageGuard, async function (req, res) {
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

    var student = await SchoolStudent.findOne({ _id: req.params.id, schoolId: schoolId });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    /* ✅ STAGE 4: scope check — verify they own both current and target class */
    if (!isUnrestricted(req.schoolUser)) {
      /* Check ownership of the student's current class */
      var scopeErr = verifyStudentScope(
        req.schoolUser,
        student.classId ? student.classId.toString() : null,
        null
      );
      if (scopeErr) {
        return res.status(403).json({ success: false, message: scopeErr });
      }
      /* For class_teacher: target class must also be their class */
      var effectiveRoles = getEffectiveRoles(req.schoolUser);
      if (effectiveRoles.includes('class_teacher') && req.schoolUser.classId) {
        if (req.schoolUser.classId.toString() !== classId.toString()) {
          return res.status(403).json({
            success: false,
            message: 'You can only assign students to your own class.'
          });
        }
      }
    }

    /* Try to resolve class name */
    var className = req.body.className || '';
    if (!className) {
      try {
        var SchoolClass = getSchoolClassModel();
        if (SchoolClass) {
          var cls = await SchoolClass.findOne({ _id: classId, schoolId: schoolId }).lean();
          if (cls) { className = cls.name; }
        }
      } catch (e) { /* ignore */ }
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
   ✅ STAGE 4: manageGuard + scope check.
============================================ */
router.put('/:id/status', manageGuard, async function (req, res) {
  try {
    var schoolId = req.schoolId;
    var status   = req.body.status;
    var allowed  = ['active', 'graduated', 'transferred', 'repeated', 'inactive'];

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }
    if (allowed.indexOf(status) === -1) {
      return res.status(400).json({ success: false, message: 'Invalid status value.' });
    }

    var existing = await SchoolStudent.findOne({ _id: req.params.id, schoolId: schoolId }).lean();
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    /* ✅ STAGE 4: scope check */
    if (!isUnrestricted(req.schoolUser)) {
      var scopeErr = verifyStudentScope(
        req.schoolUser,
        existing.classId      ? existing.classId.toString()      : null,
        existing.departmentId ? existing.departmentId.toString() : null
      );
      if (scopeErr) {
        return res.status(403).json({ success: false, message: scopeErr });
      }
    }

    var student = await SchoolStudent.findOneAndUpdate(
      { _id: req.params.id, schoolId: schoolId },
      { $set: { status: status, isActive: (status === 'active') } },
      { new: true }
    );
    return res.json({
      success: true,
      message: 'Student status updated to ' + status + '.',
      student: student
    });
  } catch (err) {
    console.error('[inst.student.mgmt] PUT /:id/status:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update status.' });
  }
});

/* ============================================
   DELETE /:id
   adminOnlyGuard — deletion stays admin-only.
   High-risk irreversible operation.
============================================ */
router.delete('/:id', adminOnlyGuard, async function (req, res) {
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
   adminOnlyGuard — mass operation stays admin-only.
============================================ */
router.post('/bulk-import', adminOnlyGuard, async function (req, res) {
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

    var classByName = {};
    try {
      var SchoolClass = getSchoolClassModel();
      if (SchoolClass) {
        var classes = await SchoolClass.find({ schoolId: schoolId }).lean();
        classes.forEach(function (c) {
          classByName[(c.name || '').toLowerCase().trim()] = c;
        });
      }
    } catch (e) { /* ignore */ }

    var created = 0;
    var skipped = 0;
    var errors  = [];

    for (var i = 0; i < rows.length; i++) {
      var row  = rows[i] || {};
      var name = String(row.name || row.Name || '').trim();

      if (!name) {
        skipped++;
        errors.push('Row ' + (i + 1) + ': missing name.');
        continue;
      }

      var admissionNo = String(row.admissionNo || row.AdmissionNo || row['Admission No'] || '').trim();
      if (admissionNo) {
        var dup = await SchoolStudent.findOne({ schoolId: schoolId, admissionNo: admissionNo }).lean();
        if (dup) {
          skipped++;
          errors.push('Row ' + (i + 1) + ': admission number "' + admissionNo + '" already exists.');
          continue;
        }
      }

      var classLabel   = String(row.class || row.Class || '').trim();
      var matchedClass = classLabel ? classByName[classLabel.toLowerCase()] : null;
      var studentId    = await SchoolStudent.generateStudentId(schoolId, schoolName, year);

      try {
        await SchoolStudent.create({
          schoolId:      schoolId,
          studentId:     studentId,
          name:          name,
          admissionNo:   admissionNo,
          class:         classLabel,
          classId:       matchedClass ? matchedClass._id : null,
          gender:        String(row.gender || row.Gender || '').toLowerCase().trim(),
          parentName:    String(row.parentName  || row['Parent Name']  || '').trim(),
          parentPhone:   String(row.parentPhone || row['Parent Phone'] || '').trim(),
          email:         String(row.email || row.Email || '').trim(),
          phone:         String(row.phone || row.Phone || '').trim(),
          status:        'active',
          isActive:      true,
          joinedYear:    year,
          classHistory:  matchedClass ? [{
            classId:    matchedClass._id,
            className:  matchedClass.name,
            session:    '',
            term:       '',
            action:     'enrolled',
            recordedAt: new Date()
          }] : [],
          createdByRole: req.schoolUser.role || '',
          createdById:   req.schoolUser._id
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