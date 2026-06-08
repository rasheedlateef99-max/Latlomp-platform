/* ============================================
   LATLOMP INSTITUTION — STRUCTURE ROUTES
   
   Manages the academic structure of an institution:
   classes, subjects, departments, and terms.
   
   All routes are school-admin only and tenant-isolated.
   
   Endpoints:
   
   CLASSES
   GET  /api/institution/structure/classes
   POST /api/institution/structure/classes
   PUT  /api/institution/structure/classes/:id
   DELETE /api/institution/structure/classes/:id
   
   SUBJECTS
   GET  /api/institution/structure/subjects
   POST /api/institution/structure/subjects
   PUT  /api/institution/structure/subjects/:id
   DELETE /api/institution/structure/subjects/:id
   
   DEPARTMENTS
   GET  /api/institution/structure/departments
   POST /api/institution/structure/departments
   PUT  /api/institution/structure/departments/:id
   DELETE /api/institution/structure/departments/:id
   
   TERMS
   GET  /api/institution/structure/terms
   POST /api/institution/structure/terms
   PUT  /api/institution/structure/terms/:id
   PUT  /api/institution/structure/terms/:id/set-current
   DELETE /api/institution/structure/terms/:id
   
   AUTO-GENERATE
   POST /api/institution/structure/generate
        Generates default structure based on institutionType
        Called automatically after onboarding
   
   CONFIG (public)
   GET /api/institution/structure/config/:type
       Returns default class list and roles for a given type
============================================ */
const express      = require('express');
const router       = express.Router();
const School       = require('../models/School.model');
const SchoolClass  = require('../models/Class.model');
const SchoolSubject= require('../models/Subject.model');
const Department   = require('../models/Department.model');
const AcademicTerm = require('../models/AcademicTerm.model');
const { instProtect, schoolAdminOnly } = require('../middleware/inst.auth');
const { requireActiveSubscription }    = require('../middleware/inst.tenant');
const structureConfig = require('../config/inst.structure.config');

var adminGuard = [instProtect, schoolAdminOnly, requireActiveSubscription];

/* ============================================
   CONFIG — Public endpoint
   Returns default structure info for a type
   Used by onboarding frontend
============================================ */
router.get('/config/:type', function(req, res) {
  var type   = req.params.type;
  var config = structureConfig.getStructure(type);
  return res.status(200).json({
    success: true,
    type:    type,
    label:   config.label,
    classes: config.classes,
    roles:   config.roles.map(function(r) {
      return { value: r, label: structureConfig.ROLE_LABELS[r] || r };
    }),
    defaultSubjects: config.defaultSubjects,
    hasDepartments:  config.hasDepartments,
    hasFaculties:    config.hasFaculties
  });
});

/* Returns all supported institution types */
router.get('/types', function(req, res) {
  return res.status(200).json({
    success: true,
    types: structureConfig.getTypes()
  });
});

/* ============================================
   AUTO-GENERATE — Called after onboarding
   
   Generates:
   1. Default classes based on institutionType
   2. Default subjects (for primary/secondary)
   3. Empty department list (for poly/uni)
   4. First academic term for current session
   
   Safe to call multiple times — will not duplicate.
============================================ */
router.post('/generate', adminGuard, async (req, res) => {
  try {
    var schoolId = req.schoolId;
    var school   = await School.findById(schoolId);
    if (!school) return res.status(404).json({ success: false, message: 'School not found.' });

    var type = req.body.type || school.type || 'secondary';
    var config = structureConfig.getStructure(type);

    /* ---- Update school type if provided ---- */
    if (req.body.type && req.body.type !== school.type) {
      school.type = type;
      await school.save();
    }

    /* ---- Generate classes (skip if already have classes) ---- */
    var existingCount = await SchoolClass.countDocuments({ schoolId });
    var classesCreated = 0;

    if (existingCount === 0) {
      var classesToCreate = config.classes.map(function(cls) {
        return {
          schoolId:  schoolId,
          name:      cls.name,
          category:  cls.category,
          sortOrder: cls.sortOrder,
          isActive:  true
        };
      });
      if (classesToCreate.length > 0) {
        await SchoolClass.insertMany(classesToCreate);
        classesCreated = classesToCreate.length;
      }
    }

    /* ---- Generate subjects (secondary/primary only) ---- */
    var subjectsCreated = 0;
    var existingSubjects = await SchoolSubject.countDocuments({ schoolId });

    if (existingSubjects === 0 && config.defaultSubjects.length > 0) {
      var subjectsToCreate = config.defaultSubjects.map(function(name, idx) {
        return { schoolId, name, sortOrder: idx, isActive: true };
      });
      await SchoolSubject.insertMany(subjectsToCreate);
      subjectsCreated = subjectsToCreate.length;
    }

    /* ---- Create first academic term if none exists ---- */
    var termCreated = false;
    var existingTerms = await AcademicTerm.countDocuments({ schoolId });

    if (existingTerms === 0) {
      var year     = new Date().getFullYear();
      var session  = year + '/' + (year + 1);
      var termName = school.type === 'university' || school.type === 'polytechnic'
        ? 'First Semester'
        : 'First Term';
      var termCode = school.type === 'university' || school.type === 'polytechnic'
        ? 'semester_1'
        : 'first';

      await AcademicTerm.create({
        schoolId,
        name:      termName,
        session:   session,
        term:      termCode,
        isCurrent: true,
        isActive:  true
      });
      termCreated = true;
    }

    return res.status(200).json({
      success:  true,
      message:  'Institution structure generated successfully.',
      generated: {
        classes:  classesCreated,
        subjects: subjectsCreated,
        term:     termCreated
      }
    });

  } catch (err) {
    console.error('[Structure] Generate error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   CLASSES
============================================ */

/* GET all classes */
router.get('/classes', adminGuard, async (req, res) => {
  try {
    var classes = await SchoolClass.find({ schoolId: req.schoolId })
      .populate('formTeacherId', 'name email role')
      .populate('departmentId', 'name')
      .sort({ sortOrder: 1, name: 1 });
    return res.status(200).json({ success: true, classes });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* CREATE class */
router.post('/classes', adminGuard, async (req, res) => {
  try {
    var { name, level, arm, category, formTeacherId, departmentId, capacity, sortOrder } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Class name is required.' });

    /* Check for duplicate name in this school */
    var existing = await SchoolClass.findOne({ schoolId: req.schoolId, name: name.trim() });
    if (existing) return res.status(400).json({ success: false, message: 'A class with this name already exists.' });

    var cls = await SchoolClass.create({
      schoolId:      req.schoolId,
      name:          name.trim(),
      level:         level         || '',
      arm:           arm           || '',
      category:      category      || 'other',
      formTeacherId: formTeacherId || null,
      departmentId:  departmentId  || null,
      capacity:      parseInt(capacity) || 0,
      sortOrder:     parseInt(sortOrder) || 0
    });

    return res.status(201).json({ success: true, message: 'Class created.', class: cls });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* UPDATE class */
router.put('/classes/:id', adminGuard, async (req, res) => {
  try {
    var allowed = ['name','level','arm','category','formTeacherId','departmentId','capacity','sortOrder','isActive'];
    var updates = {};
    allowed.forEach(function(f) { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    var cls = await SchoolClass.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: updates },
      { new: true }
    );
    if (!cls) return res.status(404).json({ success: false, message: 'Class not found.' });
    return res.status(200).json({ success: true, message: 'Class updated.', class: cls });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* DELETE class */
router.delete('/classes/:id', adminGuard, async (req, res) => {
  try {
    var cls = await SchoolClass.findOneAndDelete({ _id: req.params.id, schoolId: req.schoolId });
    if (!cls) return res.status(404).json({ success: false, message: 'Class not found.' });
    return res.status(200).json({ success: true, message: cls.name + ' deleted.' });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* ============================================
   SUBJECTS
============================================ */

/* GET all subjects */
router.get('/subjects', adminGuard, async (req, res) => {
  try {
    var subjects = await SchoolSubject.find({ schoolId: req.schoolId })
      .populate('classIds',    'name')
      .populate('teacherIds',  'name email')
      .populate('departmentId','name')
      .sort({ sortOrder: 1, name: 1 });
    return res.status(200).json({ success: true, subjects });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* CREATE subject */
router.post('/subjects', adminGuard, async (req, res) => {
  try {
    var { name, code, classIds, departmentId, teacherIds, isCore, sortOrder } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Subject name is required.' });

    var existing = await SchoolSubject.findOne({ schoolId: req.schoolId, name: name.trim() });
    if (existing) return res.status(400).json({ success: false, message: 'A subject with this name already exists.' });

    var subject = await SchoolSubject.create({
      schoolId:     req.schoolId,
      name:         name.trim(),
      code:         code         || '',
      classIds:     classIds     || [],
      departmentId: departmentId || null,
      teacherIds:   teacherIds   || [],
      isCore:       isCore !== false,
      sortOrder:    parseInt(sortOrder) || 0
    });

    return res.status(201).json({ success: true, message: 'Subject created.', subject });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* UPDATE subject */
router.put('/subjects/:id', adminGuard, async (req, res) => {
  try {
    var allowed = ['name','code','classIds','departmentId','teacherIds','isCore','sortOrder','isActive'];
    var updates = {};
    allowed.forEach(function(f) { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    var subject = await SchoolSubject.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: updates },
      { new: true }
    );
    if (!subject) return res.status(404).json({ success: false, message: 'Subject not found.' });
    return res.status(200).json({ success: true, message: 'Subject updated.', subject });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* DELETE subject */
router.delete('/subjects/:id', adminGuard, async (req, res) => {
  try {
    var subject = await SchoolSubject.findOneAndDelete({ _id: req.params.id, schoolId: req.schoolId });
    if (!subject) return res.status(404).json({ success: false, message: 'Subject not found.' });
    return res.status(200).json({ success: true, message: subject.name + ' deleted.' });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* ============================================
   DEPARTMENTS
============================================ */

/* GET all departments */
router.get('/departments', adminGuard, async (req, res) => {
  try {
    var departments = await Department.find({ schoolId: req.schoolId })
      .populate('hodId', 'name email')
      .sort({ sortOrder: 1, name: 1 });
    return res.status(200).json({ success: true, departments });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* CREATE department */
router.post('/departments', adminGuard, async (req, res) => {
  try {
    var { name, code, faculty, hodId, description, sortOrder } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Department name is required.' });

    var existing = await Department.findOne({ schoolId: req.schoolId, name: name.trim() });
    if (existing) return res.status(400).json({ success: false, message: 'A department with this name already exists.' });

    var dept = await Department.create({
      schoolId:    req.schoolId,
      name:        name.trim(),
      code:        code        || '',
      faculty:     faculty     || '',
      hodId:       hodId       || null,
      description: description || '',
      sortOrder:   parseInt(sortOrder) || 0
    });

    return res.status(201).json({ success: true, message: 'Department created.', department: dept });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* UPDATE department */
router.put('/departments/:id', adminGuard, async (req, res) => {
  try {
    var allowed = ['name','code','faculty','hodId','description','sortOrder','isActive'];
    var updates = {};
    allowed.forEach(function(f) { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    var dept = await Department.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: updates },
      { new: true }
    );
    if (!dept) return res.status(404).json({ success: false, message: 'Department not found.' });
    return res.status(200).json({ success: true, message: 'Department updated.', department: dept });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* DELETE department */
router.delete('/departments/:id', adminGuard, async (req, res) => {
  try {
    var dept = await Department.findOneAndDelete({ _id: req.params.id, schoolId: req.schoolId });
    if (!dept) return res.status(404).json({ success: false, message: 'Department not found.' });
    return res.status(200).json({ success: true, message: dept.name + ' deleted.' });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* ============================================
   ACADEMIC TERMS
============================================ */

/* GET all terms */
router.get('/terms', adminGuard, async (req, res) => {
  try {
    var terms = await AcademicTerm.find({ schoolId: req.schoolId })
      .sort({ session: -1, term: 1 });
    return res.status(200).json({ success: true, terms });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* GET current term */
router.get('/terms/current', adminGuard, async (req, res) => {
  try {
    var term = await AcademicTerm.findOne({ schoolId: req.schoolId, isCurrent: true });
    return res.status(200).json({ success: true, term: term || null });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* CREATE term */
router.post('/terms', adminGuard, async (req, res) => {
  try {
    var { name, session, term, startDate, endDate, isCurrent } = req.body;
    if (!name)    return res.status(400).json({ success: false, message: 'Term name is required.' });
    if (!session) return res.status(400).json({ success: false, message: 'Session is required.' });

    /* Check for duplicate term in same session */
    var existing = await AcademicTerm.findOne({
      schoolId: req.schoolId, session, term: term || 'first'
    });
    if (existing) return res.status(400).json({ success: false, message: 'This term already exists for the session.' });

    var newTerm = await AcademicTerm.create({
      schoolId:  req.schoolId,
      name:      name.trim(),
      session:   session.trim(),
      term:      term      || 'first',
      startDate: startDate || null,
      endDate:   endDate   || null,
      isCurrent: !!isCurrent
    });

    return res.status(201).json({ success: true, message: 'Academic term created.', term: newTerm });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* UPDATE term */
router.put('/terms/:id', adminGuard, async (req, res) => {
  try {
    var allowed = ['name','session','term','startDate','endDate','isActive'];
    var updates = {};
    allowed.forEach(function(f) { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    var termDoc = await AcademicTerm.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: updates },
      { new: true }
    );
    if (!termDoc) return res.status(404).json({ success: false, message: 'Term not found.' });
    return res.status(200).json({ success: true, message: 'Term updated.', term: termDoc });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* SET as current term — unsets all others for this school */
router.put('/terms/:id/set-current', adminGuard, async (req, res) => {
  try {
    /* Unset all */
    await AcademicTerm.updateMany(
      { schoolId: req.schoolId },
      { $set: { isCurrent: false } }
    );

    /* Set this one */
    var termDoc = await AcademicTerm.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: { isCurrent: true } },
      { new: true }
    );
    if (!termDoc) return res.status(404).json({ success: false, message: 'Term not found.' });
    return res.status(200).json({
      success: true,
      message: termDoc.name + ' ' + termDoc.session + ' is now the current term.',
      term: termDoc
    });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

/* DELETE term */
router.delete('/terms/:id', adminGuard, async (req, res) => {
  try {
    var termDoc = await AcademicTerm.findOneAndDelete({ _id: req.params.id, schoolId: req.schoolId });
    if (!termDoc) return res.status(404).json({ success: false, message: 'Term not found.' });
    return res.status(200).json({ success: true, message: 'Term deleted.' });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;