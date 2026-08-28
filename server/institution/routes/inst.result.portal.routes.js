'use strict';
/* ============================================
   LATLOMP INSTITUTION — RESULT PORTAL ROUTES (E1B)

   Two exported routers (dual mount pattern):

   publicRouter  → mounted at /api/portal
     Rate-limited by IP. No institution JWT.
     Exposes ONLY: school info, student lookup
     by admission number, result retrieval via
     verified token. No raw student data without
     valid token.

   adminRouter → mounted at /api/institution/portal
     Requires institution JWT + active subscription.
     Staff issue tokens, configure portal settings,
     list and revoke tokens.
============================================ */
const express            = require('express');
const publicRouter       = express.Router();
const adminRouter        = express.Router();
const mongoose           = require('mongoose');
const crypto             = require('crypto');
const School             = require('../models/School.model');
const SchoolStudent      = require('../models/SchoolStudent.model');
const AcademicTerm       = require('../models/AcademicTerm.model');
const ResultAccessToken  = require('../models/ResultAccessToken.model');
const { instProtect, schoolAdminOnly, canManageStudents, teacherOrAdmin }
  = require('../middleware/inst.auth');
const { requireActiveSubscription } = require('../middleware/inst.tenant');

var adminGuard  = [instProtect, schoolAdminOnly,    requireActiveSubscription];
var staffGuard  = [instProtect, teacherOrAdmin,     requireActiveSubscription];
var manageGuard = [instProtect, canManageStudents,  requireActiveSubscription];

/* ---- IP-based rate limiting for public endpoints ---- */
var ipLimit;
try {
  var rl = require('express-rate-limit');
  ipLimit = function(windowMin, max, msg) {
    return rl({
      windowMs:        windowMin * 60 * 1000,
      max:             max,
      standardHeaders: true,
      legacyHeaders:   false,
      message:         { success: false, message: msg }
    });
  };
} catch(e) {
  ipLimit = function() { return function(req, res, next) { next(); }; };
}

var lookupLimit  = ipLimit(15, 30, 'Too many lookup attempts. Please try again in 15 minutes.');
var accessLimit  = ipLimit(15, 15, 'Too many access attempts. Please try again in 15 minutes.');
var requestLimit = ipLimit(60, 10, 'Too many token requests. Please contact the institution.');

/* ============================================
   HELPERS
============================================ */
function getSchoolScoreModel() {
  try { return require('../models/SchoolScore.model'); } catch(e) { return null; }
}
function getScoreConfigModel() {
  try { return require('../models/ScoreConfig.model'); } catch(e) { return null; }
}

/* Build printable result data from SchoolScore records */
async function buildResultData(student, school, termDoc, schoolId) {
  var SchoolScore  = getSchoolScoreModel();
  var ScoreConfig  = getScoreConfigModel();

  var result = {
    student: {
      name:            student.name,
      admissionNo:     student.admissionNo || '',
      studentId:       student.studentId   || '',
      class:           student.class       || '',
      passportPhotoUrl:student.passportPhotoUrl || ''
    },
    school: {
      name:         school.name,
      logo:         school.logo         || '',
      address:      school.address      || '',
      phone:        school.phone        || '',
      email:        school.email        || '',
      primaryColor: school.primaryColor || '#6c63ff'
    },
    term:    termDoc ? { name: termDoc.name, session: termDoc.session, term: termDoc.term } : null,
    subjects: [],
    summary: { totalSubjects: 0, passed: 0, failed: 0, overallAverage: 0, overallGrade: '' },
    generatedAt: new Date()
  };

  if (!SchoolScore) { return result; }

  var filter = { schoolId: schoolId, studentId: student._id };
  if (termDoc) { filter.termId = termDoc._id; }

  var scores = await SchoolScore.find(filter)
    .populate('subjectId', 'name code isCore')
    .populate('termId',    'name session term')
    .sort({ createdAt: 1 }).lean();

  /* Only return scores from approved submissions */
  var SubM;
  try { SubM = require('../models/ScoreSubmission.model'); } catch(e) {}
  var approvedPairs = new Set(); /* "classId:subjectId:termId" */
  if (SubM && student.classId) {
    var subs = await SubM.find({
      schoolId: schoolId,
      classId:  student.classId,
      status:   'approved'
    }).select('subjectId termId').lean();
    subs.forEach(function(s) {
      approvedPairs.add(s.subjectId.toString() + ':' + s.termId.toString());
    });
  }

  var totalScore = 0; var count = 0;
  scores.forEach(function(s) {
    var pairKey = (s.subjectId ? s.subjectId._id || s.subjectId : '') + ':' + (s.termId ? s.termId._id || s.termId : '');
    /* Include if: approved submission exists, OR no submission system used */
    if (approvedPairs.size > 0 && !approvedPairs.has(pairKey)) { return; }

    result.subjects.push({
      subjectName: s.subjectId ? s.subjectId.name : 'Unknown',
      subjectCode: s.subjectId ? s.subjectId.code : '',
      isCore:      s.subjectId ? s.subjectId.isCore : false,
      scores:      s.scores || {},
      total:       s.total || 0,
      maxPossible: s.maxPossible || 100,
      percentage:  s.percentage || 0,
      grade:       s.grade || '',
      remark:      s.remark || '',
      position:    s.position || null,
      positionOutOf: s.positionOutOf || null,
      termName:    s.termId ? s.termId.name : '',
      session:     s.termId ? s.termId.session : ''
    });
    totalScore += s.percentage || 0;
    count++;
    if ((s.percentage || 0) >= 50) { result.summary.passed++; }
    else                           { result.summary.failed++; }
  });

  result.summary.totalSubjects   = result.subjects.length;
  result.summary.overallAverage  = count > 0 ? Math.round((totalScore / count) * 100) / 100 : 0;

  /* Resolve overall grade from ScoreConfig if available */
  if (ScoreConfig) {
    try {
      var config = await ScoreConfig.findOne({ schoolId: schoolId, isDefault: true }).lean();
      if (config && config.gradeBoundaries) {
        var grade = ScoreConfig.resolveGrade(config.gradeBoundaries, result.summary.overallAverage);
        result.summary.overallGrade  = grade.grade  || '';
        result.summary.overallRemark = grade.remark || '';
      }
    } catch (e) {}
  }

  return result;
}

/* ============================================
   PUBLIC ROUTER — /api/portal
   Mounted at: app.use("/api/portal", publicRouter)
============================================ */

/* GET /api/portal/school/:slug/info
   Returns portal configuration for a school.
   Tells frontend whether portal is enabled and what mode.
   Does not return student data.
*/
publicRouter.get('/school/:slug/info', lookupLimit, async function (req, res) {
  try {
    var school = await School.findOne({ slug: req.params.slug })
      .select('name logo primaryColor settings isSuspended').lean();

    if (!school || school.isSuspended) {
      /* Same response for both not-found and suspended — prevent enumeration */
      return res.status(404).json({ success: false, message: 'School portal not found or not available.' });
    }

    var s = school.settings || {};
    if (!s.resultPortalEnabled) {
      return res.status(403).json({
        success: false,
        message: 'Result portal is not enabled for this institution. Contact the institution directly.'
      });
    }

    return res.json({
      success:    true,
      schoolName: school.name,
      schoolLogo: school.logo || '',
      primaryColor: school.primaryColor || '#6c63ff',
      portal: {
        enabled:     true,
        mode:        s.resultPortalMode        || 'staff_issued',
        fee:         s.resultPortalFee         || 0,
        expiryDays:  s.resultPortalExpiryDays  || 7,
        maxUsage:    s.resultPortalMaxUsage    || 5
      }
    });
  } catch (err) {
    console.error('[portal] GET /school/:slug/info:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/* POST /api/portal/lookup
   Finds a student by school slug + admission number.
   Returns only: masked name confirmation (student can confirm they found the right record).
   Rate limited — prevents admission number enumeration.
   Body: { schoolSlug, admissionNo }
*/
publicRouter.post('/lookup', lookupLimit, async function (req, res) {
  try {
    var { schoolSlug, admissionNo } = req.body;
    if (!schoolSlug || !admissionNo) {
      return res.status(400).json({ success: false, message: 'School identifier and admission number are required.' });
    }

    var school = await School.findOne({ slug: schoolSlug.toLowerCase().trim() })
      .select('_id name settings isSuspended').lean();

    if (!school || school.isSuspended || !(school.settings && school.settings.resultPortalEnabled)) {
      /* Unified response — prevents school slug enumeration */
      return res.status(404).json({
        success: false,
        message: 'Student not found. Please check your admission number and school identifier.'
      });
    }

    /* Find student including graduated/transferred (former students need access too) */
    var student = await SchoolStudent.findOne({
      schoolId:    school._id,
      admissionNo: admissionNo.trim(),
      status:      { $in: ['active', 'graduated', 'transferred', 'repeated', 'inactive'] }
    }).select('name admissionNo class status passportPhotoUrl').lean();

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found. Please check your admission number and school identifier.'
      });
    }

    /* Return limited info — student confirms their identity before entering PIN */
    var nameParts = (student.name || '').split(' ');
    var maskedName = nameParts.map(function(part, i) {
      if (i === 0) { return part; } /* Show first name in full */
      return part.charAt(0) + '***';
    }).join(' ');

    return res.json({
      success:    true,
      found:      true,
      maskedName,
      class:      student.class    || '',
      status:     student.status   || '',
      /* Don't return photo or _id at this stage */
      schoolName: school.name,
      portalMode: (school.settings && school.settings.resultPortalMode) || 'staff_issued'
    });
  } catch (err) {
    console.error('[portal] POST /lookup:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/* POST /api/portal/request-access
   For 'paid' mode: initializes payment, returns Paystack URL.
   For 'free' mode: generates token immediately, returns it.
   For 'staff_issued': returns instructions (token must be issued by staff).
   Body: { schoolSlug, admissionNo, termId? }
*/
publicRouter.post('/request-access', requestLimit, async function (req, res) {
  try {
    var { schoolSlug, admissionNo, termId } = req.body;
    if (!schoolSlug || !admissionNo) {
      return res.status(400).json({ success: false, message: 'School identifier and admission number are required.' });
    }

    var school = await School.findOne({ slug: schoolSlug.toLowerCase().trim() })
      .select('_id name settings isSuspended').lean();

    if (!school || school.isSuspended || !(school.settings && school.settings.resultPortalEnabled)) {
      return res.status(404).json({ success: false, message: 'Portal not available.' });
    }

    var s    = school.settings;
    var mode = s.resultPortalMode || 'staff_issued';

    var student = await SchoolStudent.findOne({
      schoolId: school._id, admissionNo: admissionNo.trim(),
      status: { $in: ['active', 'graduated', 'transferred', 'repeated', 'inactive'] }
    }).select('_id name admissionNo class').lean();

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    /* free mode: generate token immediately */
    if (mode === 'free') {
      var tokenData = ResultAccessToken.generateToken();
      var expiryMs  = (s.resultPortalExpiryDays || 7) * 24 * 60 * 60 * 1000;
      var token     = await ResultAccessToken.create({
        schoolId:            school._id,
        studentId:           student._id,
        admissionNo:         student.admissionNo,
        studentNameSnapshot: student.name,
        scope:               termId ? { termId: termId } : {},
        lookupKey:           tokenData.lookupKey,
        tokenHash:           tokenData.hash,
        expiresAt:           new Date(Date.now() + expiryMs),
        maxUsage:            s.resultPortalMaxUsage || 5,
        issuedMethod:        'free_self_service'
      });

      return res.json({
        success:    true,
        mode:       'free',
        message:    'Access token generated. Enter this token to view your result.',
        token:      tokenData.formatted,
        expiresAt:  token.expiresAt
      });
    }

    /* staff_issued mode */
    if (mode === 'staff_issued') {
      return res.json({
        success: true,
        mode:    'staff_issued',
        message: 'This institution issues result access tokens manually. Please contact the institution to receive your access token.'
      });
    }

    /* paid mode: initialize Paystack payment */
    if (mode === 'paid') {
      var fee = s.resultPortalFee || 0;
      if (fee <= 0) {
        /* Fee is 0 — treat as free */
        var td2   = ResultAccessToken.generateToken();
        var exp2  = (s.resultPortalExpiryDays || 7) * 24 * 60 * 60 * 1000;
        var tok2  = await ResultAccessToken.create({
          schoolId: school._id, studentId: student._id,
          admissionNo: student.admissionNo, studentNameSnapshot: student.name,
          scope: termId ? { termId } : {},
          lookupKey: td2.lookupKey, tokenHash: td2.hash,
          expiresAt: new Date(Date.now() + exp2),
          maxUsage: s.resultPortalMaxUsage || 5,
          issuedMethod: 'free_self_service'
        });
        return res.json({ success: true, mode: 'free', token: td2.formatted, expiresAt: tok2.expiresAt });
      }

      /* Initialize Paystack transaction */
      var paystackRef = 'PORTAL-' + school._id.toString().slice(-6).toUpperCase() + '-' + Date.now();
      var appUrl      = (process.env.APP_URL || 'https://latlompsystem.up.railway.app').replace(/\/$/, '');
      var callbackUrl = appUrl + '/institution/result-portal.html?ref=' + paystackRef + '&school=' + schoolSlug;

      var paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + process.env.PAYSTACK_SECRET_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email:     student.admissionNo + '@portal.' + schoolSlug + '.latlomp.ng', /* deterministic placeholder */
          amount:    Math.round(fee * 100),
          reference: paystackRef,
          callback_url: callbackUrl,
          metadata: {
            type:        'result_portal_access',
            schoolId:    school._id.toString(),
            studentId:   student._id.toString(),
            admissionNo: student.admissionNo,
            termId:      termId || ''
          }
        })
      });
      var pd = await paystackRes.json();
      if (!pd.status) {
        return res.status(400).json({ success: false, message: 'Payment initialization failed.' });
      }

      return res.json({
        success:          true,
        mode:             'paid',
        paymentUrl:       pd.data.authorization_url,
        paymentReference: paystackRef,
        amount:           fee,
        message:          'Complete payment to receive your result access token.'
      });
    }

    return res.status(400).json({ success: false, message: 'Unknown portal mode.' });
  } catch (err) {
    console.error('[portal] POST /request-access:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/* POST /api/portal/verify-payment
   For paid mode: verify Paystack payment, generate token.
   Body: { paymentReference, schoolSlug }
*/
publicRouter.post('/verify-payment', accessLimit, async function (req, res) {
  try {
    var { paymentReference, schoolSlug } = req.body;
    if (!paymentReference || !schoolSlug) {
      return res.status(400).json({ success: false, message: 'Payment reference and school identifier are required.' });
    }

    /* Check for already-issued token for this payment */
    var existing = await ResultAccessToken.findOne({ paymentRef: paymentReference }).lean();
    if (existing && existing.status === 'active') {
      return res.json({ success: true, alreadyIssued: true, message: 'Token already issued for this payment. Check your original access token.' });
    }

    /* Verify with Paystack */
    var verifyRes = await fetch(
      'https://api.paystack.co/transaction/verify/' + encodeURIComponent(paymentReference),
      { headers: { 'Authorization': 'Bearer ' + process.env.PAYSTACK_SECRET_KEY } }
    );
    var vd = await verifyRes.json();
    if (!vd.status || vd.data.status !== 'success') {
      return res.status(400).json({ success: false, message: 'Payment not confirmed. Status: ' + (vd.data && vd.data.status || 'unknown') });
    }

    var meta = vd.data.metadata || {};
    if (meta.type !== 'result_portal_access') {
      return res.status(400).json({ success: false, message: 'Invalid payment type for result portal.' });
    }

    var school = await School.findById(meta.schoolId).select('_id settings').lean();
    if (!school) { return res.status(404).json({ success: false, message: 'School not found.' }); }

    var student = await SchoolStudent.findById(meta.studentId).select('_id name admissionNo').lean();
    if (!student) { return res.status(404).json({ success: false, message: 'Student not found.' }); }

    var s = school.settings || {};
    var tokenData = ResultAccessToken.generateToken();
    var expiryMs  = (s.resultPortalExpiryDays || 7) * 24 * 60 * 60 * 1000;

    var token = await ResultAccessToken.create({
      schoolId:            school._id,
      studentId:           student._id,
      admissionNo:         student.admissionNo,
      studentNameSnapshot: student.name,
      scope:               meta.termId ? { termId: meta.termId } : {},
      lookupKey:           tokenData.lookupKey,
      tokenHash:           tokenData.hash,
      expiresAt:           new Date(Date.now() + expiryMs),
      maxUsage:            s.resultPortalMaxUsage || 5,
      issuedMethod:        'payment',
      paymentRef:          paymentReference
    });

    return res.json({
      success:   true,
      token:     tokenData.formatted,
      expiresAt: token.expiresAt,
      message:   'Payment verified. Use this token to access your result. Keep it safe.'
    });
  } catch (err) {
    console.error('[portal] POST /verify-payment:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/* POST /api/portal/access
   Verify token, retrieve result data.
   Body: { schoolSlug, admissionNo, token, termId? }
   Rate limited and brute-force protected via maxUsage.
*/
publicRouter.post('/access', accessLimit, async function (req, res) {
  try {
    var { schoolSlug, admissionNo, token: providedToken, termId } = req.body;

    if (!schoolSlug || !admissionNo || !providedToken) {
      return res.status(400).json({ success: false, message: 'School identifier, admission number, and access token are required.' });
    }

    var school = await School.findOne({ slug: schoolSlug.toLowerCase().trim() })
      .select('_id name logo address phone email primaryColor settings isSuspended').lean();

    if (!school || school.isSuspended) {
      return res.status(404).json({ success: false, message: 'School not found or unavailable.' });
    }
    if (!(school.settings && school.settings.resultPortalEnabled)) {
      return res.status(403).json({ success: false, message: 'Result portal is not enabled for this institution.' });
    }

    /* Find student */
    var student = await SchoolStudent.findOne({
      schoolId:    school._id,
      admissionNo: admissionNo.trim(),
      status:      { $in: ['active', 'graduated', 'transferred', 'repeated', 'inactive'] }
    }).lean();

    if (!student) {
      /* Unified response — prevents enumeration */
      return res.status(403).json({ success: false, message: 'Invalid credentials. Please check your admission number and access token.' });
    }

    /* Normalize token */
    var normalizedToken = (providedToken || '').replace(/-/g, '').toUpperCase().trim();
    if (normalizedToken.length !== 12) {
      return res.status(400).json({ success: false, message: 'Invalid access token format. Expected XXXX-XXXX-XXXX.' });
    }
    var lookupKey = normalizedToken.slice(0, 6);

    /* Find matching tokens by lookupKey + studentId */
    var candidates = await ResultAccessToken.find({
      schoolId:  school._id,
      studentId: student._id,
      lookupKey: lookupKey,
      status:    'active'
    }).lean();

    var validToken = null;
    for (var i = 0; i < candidates.length; i++) {
      if (ResultAccessToken.verifyToken(normalizedToken, candidates[i].tokenHash)) {
        validToken = candidates[i];
        break;
      }
    }

    /* Security: unified response for invalid/expired tokens */
    if (!validToken) {
      return res.status(403).json({ success: false, message: 'Invalid or expired access token.' });
    }
    if (new Date() > validToken.expiresAt) {
      await ResultAccessToken.findByIdAndUpdate(validToken._id, { $set: { status: 'expired' } });
      return res.status(403).json({ success: false, message: 'This access token has expired.' });
    }
    if (validToken.usageCount >= validToken.maxUsage) {
      await ResultAccessToken.findByIdAndUpdate(validToken._id, { $set: { status: 'exhausted' } });
      return res.status(403).json({ success: false, message: 'This access token has been used the maximum number of times.' });
    }

    /* Increment usage */
    await ResultAccessToken.findByIdAndUpdate(validToken._id, {
      $inc: { usageCount: 1 },
      $set: { lastUsedAt: new Date() }
    });

    /* Determine which term to show */
    var termDoc = null;
    var scopeTermId = validToken.scope && validToken.scope.termId;
    if (scopeTermId) {
      termDoc = await AcademicTerm.findById(scopeTermId).lean();
    } else if (termId && mongoose.isValidObjectId(termId)) {
      termDoc = await AcademicTerm.findOne({ _id: termId, schoolId: school._id }).lean();
    }

    /* Build result data */
    var resultData = await buildResultData(student, school, termDoc, school._id);

    /* Get available terms for this student (for frontend term selector) */
    var SchoolScore = getSchoolScoreModel();
    var availableTerms = [];
    if (SchoolScore) {
      try {
        var termIds = await SchoolScore.distinct('termId', {
          schoolId: school._id, studentId: student._id
        });
        if (termIds.length) {
          var terms = await AcademicTerm.find({ _id: { $in: termIds } }).lean();
          availableTerms = terms.map(function(t) {
            return { _id: t._id, name: t.name, session: t.session, term: t.term };
          });
        }
      } catch (e) {}
    }

    return res.json({
      success:        true,
      result:         resultData,
      availableTerms,
      tokenUsageLeft: Math.max(0, validToken.maxUsage - (validToken.usageCount + 1)),
      tokenExpiresAt: validToken.expiresAt
    });
  } catch (err) {
    console.error('[portal] POST /access:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/* ============================================
   ADMIN ROUTER — /api/institution/portal
   Mounted at: app.use("/api/institution/portal", adminRouter)
============================================ */

/* GET /api/institution/portal/config */
adminRouter.get('/config', staffGuard, async function (req, res) {
  try {
    var school = await School.findById(req.schoolId).select('settings slug').lean();
    var s      = (school && school.settings) || {};
    return res.json({
      success: true,
      config: {
        enabled:        !!s.resultPortalEnabled,
        mode:           s.resultPortalMode        || 'staff_issued',
        fee:            s.resultPortalFee         || 0,
        expiryDays:     s.resultPortalExpiryDays  || 7,
        maxUsage:       s.resultPortalMaxUsage    || 5,
        portalUrl:      school && school.slug
          ? (process.env.APP_URL || 'https://latlompsystem.up.railway.app').replace(/\/$/, '') +
            '/institution/result-portal.html?school=' + school.slug
          : null
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/portal/config */
adminRouter.put('/config', adminGuard, async function (req, res) {
  try {
    var { enabled, mode, fee, expiryDays, maxUsage } = req.body;
    var validModes = ['free', 'paid', 'staff_issued'];
    var updates    = {};

    if (enabled !== undefined)   updates['settings.resultPortalEnabled']    = !!enabled;
    if (validModes.includes(mode)) updates['settings.resultPortalMode']     = mode;
    if (fee !== undefined)       updates['settings.resultPortalFee']        = Math.max(0, parseFloat(fee) || 0);
    if (expiryDays !== undefined)updates['settings.resultPortalExpiryDays'] = Math.max(1, parseInt(expiryDays) || 7);
    if (maxUsage !== undefined)  updates['settings.resultPortalMaxUsage']   = Math.max(1, parseInt(maxUsage) || 5);

    await School.findByIdAndUpdate(req.schoolId, { $set: updates });
    return res.json({ success: true, message: 'Result portal configuration updated.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/institution/portal/tokens/issue
   Staff issues a token for a student (free issuance — Option C).
   Body: { studentId OR admissionNo, termId?, expiryDays?, maxUsage? }
*/
adminRouter.post('/tokens/issue', manageGuard, async function (req, res) {
  try {
    var { studentId, admissionNo, termId, expiryDays, maxUsage } = req.body;
    if (!studentId && !admissionNo) {
      return res.status(400).json({ success: false, message: 'studentId or admissionNo is required.' });
    }

    var student;
    if (studentId && mongoose.isValidObjectId(studentId)) {
      student = await SchoolStudent.findOne({ _id: studentId, schoolId: req.schoolId }).lean();
    } else if (admissionNo) {
      student = await SchoolStudent.findOne({ admissionNo: admissionNo.trim(), schoolId: req.schoolId }).lean();
    }
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    var termDoc = null;
    if (termId && mongoose.isValidObjectId(termId)) {
      termDoc = await AcademicTerm.findOne({ _id: termId, schoolId: req.schoolId }).lean();
      if (!termId || !termDoc) {
        return res.status(404).json({ success: false, message: 'Academic term not found.' });
      }
    }

    var school   = await School.findById(req.schoolId).select('settings').lean();
    var s        = (school && school.settings) || {};
    var expDays  = Math.max(1, parseInt(expiryDays) || s.resultPortalExpiryDays || 7);
    var maxUse   = Math.max(1, parseInt(maxUsage)   || s.resultPortalMaxUsage   || 5);
    var tokenData = ResultAccessToken.generateToken();

    var token = await ResultAccessToken.create({
      schoolId:            req.schoolId,
      studentId:           student._id,
      admissionNo:         student.admissionNo,
      studentNameSnapshot: student.name,
      scope:               termDoc ? { termId: termDoc._id, session: termDoc.session } : {},
      lookupKey:           tokenData.lookupKey,
      tokenHash:           tokenData.hash,
      expiresAt:           new Date(Date.now() + expDays * 24 * 60 * 60 * 1000),
      maxUsage:            maxUse,
      issuedMethod:        'staff_issued',
      issuedBy:            req.schoolUser._id
    });

    return res.status(201).json({
      success:    true,
      message:    'Access token issued for ' + student.name + '.',
      token:      tokenData.formatted,
      expiresAt:  token.expiresAt,
      maxUsage:   token.maxUsage,
      student: { name: student.name, admissionNo: student.admissionNo },
      scope:      termDoc ? { termName: termDoc.name, session: termDoc.session } : { scope: 'All terms' },
      instructions: 'Share the token with the student. It expires in ' + expDays + ' days and can be used ' + maxUse + ' time(s).'
    });
  } catch (err) {
    console.error('[portal] POST /tokens/issue:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/institution/portal/tokens */
adminRouter.get('/tokens', staffGuard, async function (req, res) {
  try {
    var { status, page = 1, limit = 30 } = req.query;
    var filter = { schoolId: req.schoolId };
    if (status) filter.status = status;
    var skip  = (parseInt(page) - 1) * parseInt(limit);
    var total = await ResultAccessToken.countDocuments(filter);
    var tokens = await ResultAccessToken.find(filter)
      .select('-tokenHash -lookupKey') /* never expose hash/key to frontend */
      .populate('studentId', 'name admissionNo class')
      .populate('issuedBy',  'name email')
      .sort({ createdAt: -1 })
      .skip(skip).limit(parseInt(limit)).lean();

    return res.json({ success: true, total, page: parseInt(page), tokens });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* DELETE /api/institution/portal/tokens/:id — Revoke token */
adminRouter.delete('/tokens/:id', adminGuard, async function (req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid token ID.' });
    }
    var token = await ResultAccessToken.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!token) {
      return res.status(404).json({ success: false, message: 'Token not found.' });
    }
    token.status        = 'revoked';
    token.revokedReason = (req.body.reason || 'Revoked by admin').trim();
    await token.save();
    return res.json({ success: true, message: 'Token revoked.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = { publicRouter, adminRouter };