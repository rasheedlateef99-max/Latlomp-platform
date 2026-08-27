'use strict';
/* ============================================
   LATLOMP INSTITUTION — PROMOTION ROUTES
   PHASE S: Academic Transition Engine

   Convention: follows inst.student.mgmt.routes.js
   patterns for guards, response format, tenant
   isolation, and validation.

   GUARD STRATEGY:
   adminGuard  — policy changes, execute, rollback
   seniorGuard — batch creation, evaluate, decide
   manageGuard — read-only (any authorized staff)
============================================ */
const express         = require('express');
const router          = express.Router();
const mongoose        = require('mongoose');

const SchoolStudent   = require('../models/SchoolStudent.model');
const PromotionBatch  = require('../models/PromotionBatch.model');
const PromotionPolicy = require('../models/PromotionPolicy.model');
const AcademicTerm    = require('../models/AcademicTerm.model');
const {
  getEffectivePolicy,
  findNextClass,
  evaluateStudentEligibility
} = require('../services/promotion.service');

const {
  instProtect,
  schoolAdminOnly,
  seniorStaffOrAdmin,
  canManageStudents
} = require('../middleware/inst.auth');
const { requireActiveSubscription } = require('../middleware/inst.tenant');

var adminGuard  = [instProtect, schoolAdminOnly,    requireActiveSubscription];
var seniorGuard = [instProtect, seniorStaffOrAdmin, requireActiveSubscription];
var manageGuard = [instProtect, canManageStudents,  requireActiveSubscription];

/* Lazy-load SchoolClass (same pattern as student mgmt routes) */
function getClassModel() {
  try { return require('../models/Class.model'); } catch (e) { return null; }
}

/* Generate a unique batch reference */
function generateBatchRef() {
  var ts   = Date.now().toString(36).toUpperCase();
  var rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return 'BATCH-' + ts + '-' + rand;
}

/* ============================================
   POLICY MANAGEMENT
============================================ */

/* GET /api/institution/promotion/policy
   Returns school-wide policy + any class overrides */
router.get('/policy', manageGuard, async function (req, res) {
  try {
    var policies = await PromotionPolicy.find({ schoolId: req.schoolId, isActive: true })
      .populate('classId', 'name category')
      .sort({ classId: 1 })
      .lean();

    var schoolWide  = policies.find(function (p) { return !p.classId; })  || null;
    var classSpecific = policies.filter(function (p) { return !!p.classId; });

    return res.json({
      success:      true,
      schoolWide:   schoolWide,
      classSpecific: classSpecific
    });
  } catch (err) {
    console.error('[inst.promotion] GET /policy:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load policy.' });
  }
});

/* PUT /api/institution/promotion/policy
   Upserts school-wide promotion policy */
router.put('/policy', adminGuard, async function (req, res) {
  try {
    var {
      checkAcademicPerformance, minScorePercent,
      checkAttendance, minAttendancePercent,
      requireFeesClearance, allowOverride
    } = req.body;

    if (minScorePercent !== undefined && (minScorePercent < 0 || minScorePercent > 100)) {
      return res.status(400).json({ success: false, message: 'minScorePercent must be 0–100.' });
    }
    if (minAttendancePercent !== undefined && (minAttendancePercent < 0 || minAttendancePercent > 100)) {
      return res.status(400).json({ success: false, message: 'minAttendancePercent must be 0–100.' });
    }

    var updates = {};
    var fields  = [
      'checkAcademicPerformance', 'minScorePercent',
      'checkAttendance', 'minAttendancePercent',
      'requireFeesClearance', 'allowOverride'
    ];
    fields.forEach(function (f) {
      if (req.body[f] !== undefined) { updates[f] = req.body[f]; }
    });

    var policy = await PromotionPolicy.findOneAndUpdate(
      { schoolId: req.schoolId, classId: null },
      { $set: Object.assign({ schoolId: req.schoolId, classId: null, isActive: true }, updates) },
      { upsert: true, new: true }
    );

    return res.json({ success: true, message: 'School-wide promotion policy updated.', policy });
  } catch (err) {
    console.error('[inst.promotion] PUT /policy:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update policy.' });
  }
});

/* PUT /api/institution/promotion/policy/class/:classId
   Upserts class-specific policy override */
router.put('/policy/class/:classId', adminGuard, async function (req, res) {
  try {
    var classId = req.params.classId;
    if (!mongoose.isValidObjectId(classId)) {
      return res.status(400).json({ success: false, message: 'Invalid class ID.' });
    }

    /* Verify class belongs to this school */
    var SchoolClass = getClassModel();
    if (SchoolClass) {
      var cls = await SchoolClass.findOne({ _id: classId, schoolId: req.schoolId }).lean();
      if (!cls) {
        return res.status(404).json({ success: false, message: 'Class not found.' });
      }
    }

    var updates = {};
    var fields  = [
      'checkAcademicPerformance', 'minScorePercent',
      'checkAttendance', 'minAttendancePercent',
      'requireFeesClearance', 'allowOverride'
    ];
    fields.forEach(function (f) {
      if (req.body[f] !== undefined) { updates[f] = req.body[f]; }
    });

    var policy = await PromotionPolicy.findOneAndUpdate(
      { schoolId: req.schoolId, classId: classId },
      { $set: Object.assign({ schoolId: req.schoolId, classId: classId, isActive: true }, updates) },
      { upsert: true, new: true }
    );

    return res.json({ success: true, message: 'Class-specific policy updated.', policy });
  } catch (err) {
    console.error('[inst.promotion] PUT /policy/class/:classId:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update class policy.' });
  }
});

/* DELETE /api/institution/promotion/policy/class/:classId
   Removes class-specific override (falls back to school-wide) */
router.delete('/policy/class/:classId', adminGuard, async function (req, res) {
  try {
    await PromotionPolicy.findOneAndUpdate(
      { schoolId: req.schoolId, classId: req.params.classId },
      { $set: { isActive: false } }
    );
    return res.json({ success: true, message: 'Class policy override removed.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to remove class policy.' });
  }
});

/* ============================================
   BATCH MANAGEMENT
============================================ */

/* GET /api/institution/promotion/batches
   List all batches for this school */
router.get('/batches', manageGuard, async function (req, res) {
  try {
    var batches = await PromotionBatch.find({ schoolId: req.schoolId })
      .select('-students') /* exclude students array for list view */
      .populate('sourceTermId',  'name session term')
      .populate('targetTermId',  'name session term')
      .populate('sourceClassId', 'name category')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({ success: true, count: batches.length, batches });
  } catch (err) {
    console.error('[inst.promotion] GET /batches:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load batches.' });
  }
});

/* POST /api/institution/promotion/batches
   Create a new promotion batch (draft state)
   Body: { sourceTermId, sourceClassId, targetTermId?, notes? }
*/
router.post('/batches', seniorGuard, async function (req, res) {
  try {
    var { sourceTermId, sourceClassId, targetTermId, notes } = req.body;

    if (!sourceTermId || !sourceClassId) {
      return res.status(400).json({
        success: false,
        message: 'sourceTermId and sourceClassId are required.'
      });
    }
    if (!mongoose.isValidObjectId(sourceTermId)) {
      return res.status(400).json({ success: false, message: 'Invalid source term ID.' });
    }
    if (!mongoose.isValidObjectId(sourceClassId)) {
      return res.status(400).json({ success: false, message: 'Invalid source class ID.' });
    }

    /* Verify term + class belong to this school */
    var [sourceTerm, sourceClass] = await Promise.all([
      AcademicTerm.findOne({ _id: sourceTermId, schoolId: req.schoolId }).lean(),
      getClassModel()
        ? getClassModel().findOne({ _id: sourceClassId, schoolId: req.schoolId }).lean()
        : null
    ]);

    if (!sourceTerm) {
      return res.status(404).json({ success: false, message: 'Source term not found.' });
    }
    if (!sourceClass) {
      return res.status(404).json({ success: false, message: 'Source class not found.' });
    }

    /* Idempotency: reject if a non-cancelled batch already exists for same class+term */
    var existing = await PromotionBatch.findOne({
      schoolId:      req.schoolId,
      sourceClassId: sourceClassId,
      sourceTermId:  sourceTermId,
      status:        { $nin: ['cancelled', 'rolled_back'] }
    }).lean();

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A promotion batch already exists for this class and term. ' +
                 'Ref: ' + existing.batchRef + ' | Status: ' + existing.status,
        existingBatchId: existing._id
      });
    }

    var targetTermDoc = null;
    if (targetTermId && mongoose.isValidObjectId(targetTermId)) {
      targetTermDoc = await AcademicTerm.findOne({ _id: targetTermId, schoolId: req.schoolId }).lean();
    }

    var batch = await PromotionBatch.create({
      schoolId:      req.schoolId,
      batchRef:      generateBatchRef(),
      sourceTermId,
      sourceTermSnapshot: {
        name:    sourceTerm.name,
        session: sourceTerm.session,
        term:    sourceTerm.term
      },
      targetTermId:  targetTermDoc ? targetTermDoc._id : null,
      targetTermSnapshot: targetTermDoc ? {
        name:    targetTermDoc.name,
        session: targetTermDoc.session,
        term:    targetTermDoc.term
      } : {},
      sourceClassId,
      sourceClassSnapshot: {
        name:     sourceClass.name,
        category: sourceClass.category || ''
      },
      students:      [],
      status:        'draft',
      createdBy:     req.schoolUser._id,
      createdByName: req.schoolUser.name || '',
      notes:         (notes || '').trim()
    });

    return res.status(201).json({
      success:  true,
      message:  'Promotion batch created (draft). Run evaluation to load students.',
      batchId:  batch._id,
      batchRef: batch.batchRef
    });
  } catch (err) {
    console.error('[inst.promotion] POST /batches:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to create batch.' });
  }
});

/* GET /api/institution/promotion/batches/:id
   Full batch details including students */
router.get('/batches/:id', manageGuard, async function (req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid batch ID.' });
    }

    var batch = await PromotionBatch.findOne({ _id: req.params.id, schoolId: req.schoolId })
      .populate('sourceTermId',  'name session term isCurrent')
      .populate('targetTermId',  'name session term isCurrent')
      .populate('sourceClassId', 'name category sortOrder')
      .lean();

    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found.' });
    }

    return res.json({ success: true, batch });
  } catch (err) {
    console.error('[inst.promotion] GET /batches/:id:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load batch.' });
  }
});

/* PUT /api/institution/promotion/batches/:id
   Update draft batch (change target term, notes) */
router.put('/batches/:id', seniorGuard, async function (req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid batch ID.' });
    }

    var batch = await PromotionBatch.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found.' });
    }
    if (!['draft', 'reviewed'].includes(batch.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only draft or reviewed batches can be updated. Current status: ' + batch.status
      });
    }

    if (req.body.targetTermId && mongoose.isValidObjectId(req.body.targetTermId)) {
      var targetTerm = await AcademicTerm.findOne({
        _id: req.body.targetTermId, schoolId: req.schoolId
      }).lean();
      if (!targetTerm) {
        return res.status(404).json({ success: false, message: 'Target term not found.' });
      }
      batch.targetTermId       = targetTerm._id;
      batch.targetTermSnapshot = { name: targetTerm.name, session: targetTerm.session, term: targetTerm.term };
    }
    if (req.body.notes !== undefined) { batch.notes = req.body.notes.trim(); }

    await batch.save();
    return res.json({ success: true, message: 'Batch updated.', batch });
  } catch (err) {
    console.error('[inst.promotion] PUT /batches/:id:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update batch.' });
  }
});

/* POST /api/institution/promotion/batches/:id/evaluate
   Load students from source class and run eligibility.
   Can be run multiple times (re-evaluation).
*/
router.post('/batches/:id/evaluate', seniorGuard, async function (req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid batch ID.' });
    }

    var batch = await PromotionBatch.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found.' });
    }
    if (['executing', 'completed', 'rolled_back', 'cancelled'].includes(batch.status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot re-evaluate a batch with status: ' + batch.status
      });
    }

    batch.status = 'evaluating';
    await batch.save();

    /* Load all active students in source class */
    var students = await SchoolStudent.find({
      schoolId: req.schoolId,
      classId:  batch.sourceClassId,
      status:   'active'
    }).lean();

    if (!students.length) {
      batch.status   = 'reviewed';
      batch.students = [];
      batch.summary.total = 0;
      await batch.save();
      return res.json({
        success: true,
        message: 'No active students found in this class.',
        evaluated: 0
      });
    }

    /* Get effective policy for this class */
    var policy = await getEffectivePolicy(req.schoolId, batch.sourceClassId.toString());

    /* Evaluate each student */
    var studentDecisions = [];
    for (var i = 0; i < students.length; i++) {
      var student = students[i];

      /* Eligibility evaluation */
      var eligibility = await evaluateStudentEligibility(student, policy, batch.sourceTermId);

      /* Find next class (determines graduation candidate) */
      var nextClass = await findNextClass(student.classId, req.schoolId);

      /* Graduation candidate check */
      if (eligibility.eligibilityStatus === 'eligible' && !nextClass) {
        eligibility.eligibilityStatus = 'graduation_candidate';
        eligibility.recommendation    = 'graduate';
      } else if (eligibility.eligibilityStatus === 'eligible' && nextClass) {
        eligibility.recommendation = 'promote';
      }

      /* Check if student was already processed for this source term
         (idempotency: look for existing classHistory entry from sourceTermId) */
      var alreadyProcessed = false;
      /* We check by looking at classHistory entries after the source term
         — for now we rely on the batch duplicate check above */

      studentDecisions.push({
        studentId:         student._id,
        studentName:       student.name,
        studentAdmissionNo:student.admissionNo || '',
        currentClassId:    student.classId,
        currentClassName:  student.class || '',

        eligibilityStatus: eligibility.eligibilityStatus,
        failedCriteria:    eligibility.failedCriteria,
        academicScore:     eligibility.academicScore,
        attendanceRate:    eligibility.attendanceRate,
        feesCleared:       eligibility.feesCleared,
        recommendation:    eligibility.recommendation,

        finalDecision:     'pending',
        targetClassId:     nextClass ? nextClass._id : null,
        targetClassName:   nextClass ? nextClass.name : '',

        overridden:        false,
        executionStatus:   'pending'
      });
    }

    batch.students           = studentDecisions;
    batch.status             = 'reviewed';
    batch.summary.total      = students.length;
    batch.summary.evaluated  = students.length;
    await batch.save();

    /* Count by status for response */
    var counts = { eligible: 0, not_eligible: 0, graduation_candidate: 0, requires_review: 0, holds: 0 };
    studentDecisions.forEach(function (s) {
      if (s.eligibilityStatus === 'eligible')            { counts.eligible++; }
      else if (s.eligibilityStatus === 'not_eligible')   { counts.not_eligible++; }
      else if (s.eligibilityStatus === 'graduation_candidate') { counts.graduation_candidate++; }
      else if (s.eligibilityStatus === 'requires_review'){ counts.requires_review++; }
      else                                               { counts.holds++; }
    });

    return res.json({
      success:    true,
      message:    students.length + ' student(s) evaluated.',
      evaluated:  students.length,
      counts,
      policyUsed: {
        isDefault: !!policy._isDefault,
        checkAcademicPerformance: policy.checkAcademicPerformance,
        minScorePercent:          policy.minScorePercent,
        checkAttendance:          policy.checkAttendance,
        requireFeesClearance:     policy.requireFeesClearance
      }
    });
  } catch (err) {
    console.error('[inst.promotion] POST /batches/:id/evaluate:', err.message);
    /* Reset status to draft on failure */
    try {
      await PromotionBatch.findByIdAndUpdate(req.params.id, { $set: { status: 'draft' } });
    } catch (e) { /* ignore */ }
    return res.status(500).json({ success: false, message: 'Evaluation failed: ' + err.message });
  }
});

/* PUT /api/institution/promotion/batches/:id/decisions
   Set final decisions for one or multiple students.
   Body: { decisions: [{ studentId, finalDecision, targetClassId?, overrideReason? }] }
   OR:   { bulkDecision: 'promote'|'repeat', studentIds: [id, ...] }
*/
router.put('/batches/:id/decisions', seniorGuard, async function (req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid batch ID.' });
    }

    var batch = await PromotionBatch.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found.' });
    }
    if (!['reviewed'].includes(batch.status)) {
      return res.status(400).json({
        success: false,
        message: 'Decisions can only be set on a reviewed batch. Current: ' + batch.status
      });
    }

    var validDecisions = ['promote', 'repeat', 'graduate', 'transfer_out', 'pending'];
    var updated = 0;

    /* Bulk decision shortcut */
    if (req.body.bulkDecision && Array.isArray(req.body.studentIds)) {
      var bulkDecision = req.body.bulkDecision;
      if (!validDecisions.includes(bulkDecision)) {
        return res.status(400).json({ success: false, message: 'Invalid decision: ' + bulkDecision });
      }
      var idSet = req.body.studentIds.map(function (id) { return id.toString(); });
      batch.students.forEach(function (s) {
        if (idSet.includes(s.studentId.toString())) {
          var prevDecision = s.finalDecision;
          s.finalDecision = bulkDecision;
          /* Auto-detect override: decision differs from recommendation */
          var recommendedMap = { promote: 'promote', repeat: 'repeat', graduate: 'graduate', review: 'review' };
          if (bulkDecision !== recommendedMap[s.recommendation] && s.recommendation !== 'review') {
            s.overridden       = true;
            s.overrideReason   = req.body.overrideReason || 'Bulk administrative decision';
            s.overriddenBy     = req.schoolUser._id;
            s.overriddenByName = req.schoolUser.name || '';
            s.overriddenAt     = new Date();
          }
          updated++;
        }
      });
    }

    /* Individual decisions array */
    if (Array.isArray(req.body.decisions)) {
      req.body.decisions.forEach(function (d) {
        if (!d.studentId || !validDecisions.includes(d.finalDecision)) { return; }
        var s = batch.students.find(function (st) {
          return st.studentId.toString() === d.studentId.toString();
        });
        if (!s) { return; }

        s.finalDecision = d.finalDecision;

        /* Target class override for promote decision */
        if (d.finalDecision === 'promote' && d.targetClassId) {
          s.targetClassId  = d.targetClassId;
          s.targetClassName = d.targetClassName || s.targetClassName;
        }

        /* Record override if decision differs from recommendation */
        var wasOverridden = (d.finalDecision !== s.recommendation &&
                             s.recommendation !== 'review' &&
                             d.finalDecision !== 'pending');
        if (wasOverridden || d.overrideReason) {
          s.overridden       = true;
          s.overrideReason   = (d.overrideReason || 'Administrative override').trim();
          s.overriddenBy     = req.schoolUser._id;
          s.overriddenByName = req.schoolUser.name || '';
          s.overriddenAt     = new Date();
        }
        updated++;
      });
    }

    /* Mark as reviewed (keeps status so more decisions can be made) */
    batch.status = 'reviewed';
    await batch.save();

    /* Count decisions */
    var decidedCount = batch.students.filter(function (s) { return s.finalDecision !== 'pending'; }).length;
    var pendingCount = batch.students.length - decidedCount;

    return res.json({
      success:      true,
      message:      updated + ' decision(s) updated.',
      updated,
      decidedCount,
      pendingCount
    });
  } catch (err) {
    console.error('[inst.promotion] PUT /batches/:id/decisions:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update decisions.' });
  }
});

/* POST /api/institution/promotion/batches/:id/execute
   Execute all finalized decisions.
   - Skips students with finalDecision='pending'
   - Processes each student individually
   - Reports exact success/fail counts
   - Never falsely reports partial success as full success
*/
router.post('/batches/:id/execute', adminGuard, async function (req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid batch ID.' });
    }

    var batch = await PromotionBatch.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found.' });
    }
    if (batch.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'This batch has already been executed. Use rollback to reverse it.'
      });
    }
    if (!['reviewed'].includes(batch.status)) {
      return res.status(400).json({
        success: false,
        message: 'Batch must be in reviewed status before execution. Current: ' + batch.status
      });
    }
    if (!batch.targetTermId) {
      return res.status(400).json({
        success: false,
        message: 'Target term must be set before execution.'
      });
    }

    var decidedStudents = batch.students.filter(function (s) { return s.finalDecision !== 'pending'; });
    if (!decidedStudents.length) {
      return res.status(400).json({
        success: false,
        message: 'No decisions have been set. Set final decisions before executing.'
      });
    }

    batch.status = 'executing';
    await batch.save();

    var summary = {
      total: batch.students.length, evaluated: batch.students.length,
      promoted: 0, repeated: 0, graduated: 0, transferred: 0,
      failed: 0, skipped: 0, overrides: 0
    };

    var targetTermDoc = batch.targetTermSnapshot;

    /* Process each student */
    for (var i = 0; i < batch.students.length; i++) {
      var s = batch.students[i];

      /* Skip undecided students */
      if (s.finalDecision === 'pending') {
        s.executionStatus = 'skipped';
        s.executionError  = 'No final decision set by administrator.';
        summary.skipped++;
        continue;
      }

      /* Count overrides */
      if (s.overridden) { summary.overrides++; }

      /* Load current student state */
      var student;
      try {
        student = await SchoolStudent.findOne({ _id: s.studentId, schoolId: req.schoolId });
        if (!student) {
          s.executionStatus = 'failed';
          s.executionError  = 'Student record not found.';
          summary.failed++;
          continue;
        }
      } catch (loadErr) {
        s.executionStatus = 'failed';
        s.executionError  = 'Failed to load student: ' + loadErr.message;
        summary.failed++;
        continue;
      }

      /* Store pre-execution state for rollback */
      s.preExecutionClassId   = student.classId;
      s.preExecutionClassName = student.class || '';
      s.preExecutionStatus    = student.status;

      var executionTimestamp = new Date();
      s.executionHistoryTimestamp = executionTimestamp;

      try {
        switch (s.finalDecision) {
          case 'promote':
            if (!s.targetClassId) {
              s.executionStatus = 'failed';
              s.executionError  = 'No target class set for promotion.';
              summary.failed++;
              continue;
            }
            /* Idempotency: check if already promoted to this class this term */
            var alreadyPromoted = student.classHistory.some(function (h) {
              return h.action === 'promoted' &&
                     h.classId && h.classId.toString() === s.targetClassId.toString() &&
                     h.session === targetTermDoc.session;
            });
            if (alreadyPromoted) {
              s.executionStatus = 'skipped';
              s.executionError  = 'Already promoted to this class for this period.';
              summary.skipped++;
              continue;
            }
            student.classId = s.targetClassId;
            student.class   = s.targetClassName || '';
            student.classHistory.push({
              classId:    s.targetClassId,
              className:  s.targetClassName || '',
              session:    targetTermDoc.session || '',
              term:       targetTermDoc.term    || '',
              action:     'promoted',
              recordedAt: executionTimestamp
            });
            await student.save();
            s.executionStatus = 'success';
            summary.promoted++;
            break;

          case 'repeat':
            student.classHistory.push({
              classId:    student.classId,
              className:  student.class || '',
              session:    targetTermDoc.session || '',
              term:       targetTermDoc.term    || '',
              action:     'repeated',
              recordedAt: executionTimestamp
            });
            await student.save();
            s.executionStatus = 'success';
            summary.repeated++;
            break;

          case 'graduate':
            student.status   = 'graduated';
            student.isActive = false;
            student.classHistory.push({
              classId:    student.classId,
              className:  student.class || '',
              session:    targetTermDoc.session || '',
              term:       targetTermDoc.term    || '',
              action:     'graduated',
              recordedAt: executionTimestamp
            });
            await student.save();
            s.executionStatus = 'success';
            summary.graduated++;
            break;

          case 'transfer_out':
            student.status   = 'transferred';
            student.isActive = false;
            student.classHistory.push({
              classId:    student.classId,
              className:  student.class || '',
              session:    targetTermDoc.session || '',
              term:       targetTermDoc.term    || '',
              action:     'transferred_out',
              recordedAt: executionTimestamp
            });
            await student.save();
            s.executionStatus = 'success';
            summary.transferred++;
            break;

          default:
            s.executionStatus = 'failed';
            s.executionError  = 'Unknown decision: ' + s.finalDecision;
            summary.failed++;
        }
      } catch (execErr) {
        s.executionStatus = 'failed';
        s.executionError  = execErr.message;
        summary.failed++;
      }
    }

    batch.summary      = summary;
    batch.executedBy   = req.schoolUser._id;
    batch.executedByName = req.schoolUser.name || '';
    batch.executedAt   = new Date();
    batch.status       = summary.failed > 0 || summary.skipped === batch.students.length
      ? 'partial'
      : 'completed';

    await batch.save();

    return res.json({
      success:  true,
      message:  'Batch execution complete. ' +
                summary.promoted + ' promoted, ' + summary.repeated + ' repeated, ' +
                summary.graduated + ' graduated, ' + summary.transferred + ' transferred. ' +
                (summary.failed > 0 ? summary.failed + ' failed.' : ''),
      summary,
      batchStatus: batch.status
    });
  } catch (err) {
    console.error('[inst.promotion] POST /batches/:id/execute:', err.message);
    try { await PromotionBatch.findByIdAndUpdate(req.params.id, { $set: { status: 'reviewed' } }); } catch(e) {}
    return res.status(500).json({ success: false, message: 'Execution failed: ' + err.message });
  }
});

/* POST /api/institution/promotion/batches/:id/rollback
   Reverses a completed batch.
   Creates reversal classHistory entries — never deletes original.
   Body: { reason }
*/
router.post('/batches/:id/rollback', adminGuard, async function (req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid batch ID.' });
    }
    if (!req.body.reason || !req.body.reason.trim()) {
      return res.status(400).json({ success: false, message: 'A reason is required for rollback.' });
    }

    var batch = await PromotionBatch.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found.' });
    }
    if (!['completed', 'partial'].includes(batch.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only completed or partial batches can be rolled back. Current: ' + batch.status
      });
    }
    if (batch.status === 'rolled_back') {
      return res.status(400).json({ success: false, message: 'Batch has already been rolled back.' });
    }

    var rollbackTimestamp = new Date();
    var rolledBack = 0;
    var blocked    = 0;
    var blockedDetails = [];

    /* Process only successfully executed students */
    for (var i = 0; i < batch.students.length; i++) {
      var s = batch.students[i];
      if (s.executionStatus !== 'success') { continue; }
      if (s.executionStatus === 'rolled_back') { continue; }

      var student;
      try {
        student = await SchoolStudent.findOne({ _id: s.studentId, schoolId: req.schoolId });
      } catch (e) { blocked++; blockedDetails.push(s.studentName + ': load failed'); continue; }

      if (!student) { blocked++; blockedDetails.push(s.studentName + ': not found'); continue; }

      /* Safety check: has the student had another transition AFTER this batch?
         If so, rollback could corrupt state — require manual resolution */
      var laterEntries = student.classHistory.filter(function (h) {
        return h.recordedAt > s.executionHistoryTimestamp &&
               h.action !== 'rolled_back';
      });
      if (laterEntries.length > 0) {
        blocked++;
        blockedDetails.push(
          s.studentName + ': has ' + laterEntries.length + ' later academic event(s). Manual resolution required.'
        );
        continue;
      }

      /* Restore pre-execution state */
      student.classId  = s.preExecutionClassId || student.classId;
      student.class    = s.preExecutionClassName || student.class;
      student.status   = s.preExecutionStatus || 'active';
      student.isActive = student.status === 'active';

      /* Append reversal entry — original entry is PRESERVED (immutable history) */
      student.classHistory.push({
        classId:    s.preExecutionClassId,
        className:  s.preExecutionClassName || '',
        session:    batch.sourceTermSnapshot.session || '',
        term:       batch.sourceTermSnapshot.term    || '',
        action:     'rolled_back',
        recordedAt: rollbackTimestamp
      });

      try {
        await student.save();
        s.executionStatus = 'rolled_back';
        rolledBack++;
      } catch (saveErr) {
        blocked++;
        blockedDetails.push(s.studentName + ': save failed — ' + saveErr.message);
      }
    }

    batch.status            = blocked > 0 ? 'partial' : 'rolled_back';
    batch.rollbackedBy      = req.schoolUser._id;
    batch.rollbackedByName  = req.schoolUser.name || '';
    batch.rollbackedAt      = rollbackTimestamp;
    batch.rollbackReason    = req.body.reason.trim();
    await batch.save();

    return res.json({
      success:     true,
      message:     rolledBack + ' student(s) rolled back.' +
                   (blocked > 0 ? ' ' + blocked + ' could not be reversed (manual action required).' : ''),
      rolledBack,
      blocked,
      blockedDetails: blockedDetails.slice(0, 20),
      batchStatus: batch.status
    });
  } catch (err) {
    console.error('[inst.promotion] POST /batches/:id/rollback:', err.message);
    return res.status(500).json({ success: false, message: 'Rollback failed: ' + err.message });
  }
});

/* DELETE /api/institution/promotion/batches/:id
   Cancel a draft batch only */
router.delete('/batches/:id', adminGuard, async function (req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid batch ID.' });
    }
    var batch = await PromotionBatch.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found.' });
    }
    if (!['draft', 'reviewed'].includes(batch.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only draft or reviewed batches can be cancelled. Use rollback for executed batches.'
      });
    }
    batch.status = 'cancelled';
    await batch.save();
    return res.json({ success: true, message: 'Batch cancelled.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to cancel batch.' });
  }
});

/* ============================================
   HISTORY & AUDIT
============================================ */

/* GET /api/institution/promotion/students/:studentId/history
   Full academic transition history for one student */
router.get('/students/:studentId/history', manageGuard, async function (req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.studentId)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID.' });
    }
    var student = await SchoolStudent.findOne({
      _id: req.params.studentId, schoolId: req.schoolId
    }).select('name admissionNo studentId class classId status classHistory joinedSession joinedYear').lean();

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    /* Find any batches this student appeared in */
    var batches = await PromotionBatch.find({
      schoolId:           req.schoolId,
      'students.studentId': req.params.studentId
    })
    .select('batchRef status executedAt sourceTermSnapshot targetTermSnapshot sourceClassSnapshot summary createdByName executedByName')
    .lean();

    var batchSummaries = batches.map(function (b) {
      var studentEntry = b.students && b.students.find(function (s) {
        return s.studentId && s.studentId.toString() === req.params.studentId;
      });
      return {
        batchRef:     b.batchRef,
        status:       b.status,
        executedAt:   b.executedAt,
        sourceTerm:   b.sourceTermSnapshot,
        targetTerm:   b.targetTermSnapshot,
        sourceClass:  b.sourceClassSnapshot,
        finalDecision: studentEntry ? studentEntry.finalDecision : null,
        executionStatus: studentEntry ? studentEntry.executionStatus : null,
        overridden:    studentEntry ? studentEntry.overridden : false
      };
    });

    return res.json({
      success:  true,
      student: {
        _id:          student._id,
        name:         student.name,
        admissionNo:  student.admissionNo,
        studentId:    student.studentId,
        class:        student.class,
        status:       student.status,
        joinedSession:student.joinedSession,
        joinedYear:   student.joinedYear,
        classHistory: student.classHistory
      },
      batchHistory: batchSummaries
    });
  } catch (err) {
    console.error('[inst.promotion] GET /students/:id/history:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load history.' });
  }
});

/* GET /api/institution/promotion/terms
   Convenience: list all terms for this school (for batch creation UI) */
router.get('/terms', manageGuard, async function (req, res) {
  try {
    var terms = await AcademicTerm.find({ schoolId: req.schoolId, isActive: true })
      .sort({ session: -1, term: 1 })
      .lean();
    return res.json({ success: true, terms });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load terms.' });
  }
});

/* GET /api/institution/promotion/classes
   Convenience: list active classes with student counts */
router.get('/classes', manageGuard, async function (req, res) {
  try {
    var SchoolClass = getClassModel();
    if (!SchoolClass) {
      return res.json({ success: true, classes: [] });
    }
    var classes = await SchoolClass.find({ schoolId: req.schoolId, isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    /* Add active student count per class */
    for (var i = 0; i < classes.length; i++) {
      classes[i].activeStudentCount = await SchoolStudent.countDocuments({
        schoolId: req.schoolId,
        classId:  classes[i]._id,
        status:   'active'
      });
    }

    return res.json({ success: true, classes });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load classes.' });
  }
});

module.exports = router;