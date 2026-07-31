/* ============================================
   EXAMINATION CORE ENGINE — GUARD MIDDLEWARE

   SCOPE ISOLATION:
     eceRootOnly       — Root Admin: cbt scope + globalAvailability
     eceInstitutionAdmin — Institution Admin: their school only
     eceTeacher        — Teacher: their own exams only
     eceReadAccess     — Root Admin or Platform Staff with ece_read

   These guards enforce the architectural principle:
   "Each examination system configures only itself."
============================================ */
'use strict';

var jwt = require('jsonwebtoken');

/* ============================================
   eceRootOnly
   Accepts the main platform admin token.
   Confirms user.role === 'admin'.
   Used for: cbt scope config, globalAvailability,
             audit log, registry, dashboard.
============================================ */
async function eceRootOnly(req, res, next) {
  try {
    var token = null;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authorized.' });
    }

    var decoded = jwt.verify(token, process.env.JWT_SECRET);

    /* Platform staff token — check ece_admin permission */
    if (decoded.platformStaffId) {
      var PlatformStaff = require('../../platform/models/PlatformStaff.model');
      var staff = await PlatformStaff.findById(decoded.platformStaffId)
        .select('permissions status isActive');
      if (!staff || staff.status !== 'active' || !staff.isActive) {
        return res.status(403).json({ success: false, message: 'Platform staff account is not active.' });
      }
      if (!(staff.permissions || []).includes('ece_admin')) {
        return res.status(403).json({ success: false, message: 'ECE administration permission required.' });
      }
      req.eceActor     = staff.email || staff._id.toString();
      req.eceActorRole = 'platform_staff';
      req.isRoot       = false;
      req.isEceAdmin   = true;
      return next();
    }

    /* Main admin token */
    var mainUserId = decoded.userId || decoded.id || null;
    if (!mainUserId) {
      return res.status(401).json({ success: false, message: 'Invalid token.' });
    }
    var User = require('../../models/User.model');
    var user = await User.findById(mainUserId).select('role email name isActive');
    if (!user || user.role !== 'admin' || !user.isActive) {
      return res.status(403).json({ success: false, message: 'Root Administrator access required.' });
    }
    req.eceActor     = user.email || user._id.toString();
    req.eceActorRole = 'root_admin';
    req.isRoot       = true;
    req.isEceAdmin   = true;
    return next();

  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Session expired.' });
    }
    console.error('[ECE Guard] eceRootOnly error:', err.message);
    return res.status(500).json({ success: false, message: 'Authentication error.' });
  }
}

/* ============================================
   eceInstitutionAdmin
   Accepts the institution staff token.
   Confirms the user is an admin of their school.
   Used for institution scope config only.
   Phase 7 activation: wired to institution admin.
============================================ */
async function eceInstitutionAdmin(req, res, next) {
  try {
    var token = null;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authorized.' });
    }
    var decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.schoolUserId) {
      return res.status(401).json({ success: false, message: 'Institution token required.' });
    }
    var SchoolUser = require('../../institution/models/SchoolUser.model');
    var sUser = await SchoolUser.findById(decoded.schoolUserId)
      .select('role schoolId email name isActive');
    if (!sUser || !sUser.isActive) {
      return res.status(401).json({ success: false, message: 'Institution account not found.' });
    }
    if (sUser.role !== 'admin' && sUser.role !== 'principal') {
      return res.status(403).json({ success: false,
        message: 'Institution Administrator access required for ECE configuration.' });
    }
    req.eceActor     = sUser.email || sUser._id.toString();
    req.eceActorRole = 'institution_admin';
    req.eceScopeId   = sUser.schoolId;
    req.isRoot       = false;
    req.isEceAdmin   = true;
    return next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Session expired.' });
    }
    console.error('[ECE Guard] eceInstitutionAdmin error:', err.message);
    return res.status(500).json({ success: false, message: 'Authentication error.' });
  }
}

/* ============================================
   eceTeacher
   Accepts the main platform token for teachers.
   Phase 7 activation: wired to teacher exam.
============================================ */
async function eceTeacher(req, res, next) {
  try {
    var token = null;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authorized.' });
    }
    var decoded = jwt.verify(token, process.env.JWT_SECRET);
    var uid = decoded.userId || decoded.id || null;
    if (!uid) {
      return res.status(401).json({ success: false, message: 'Invalid token.' });
    }
    var User = require('../../models/User.model');
    var user = await User.findById(uid).select('role email name isActive');
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Account not found.' });
    }
    if (user.role !== 'teacher' && user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Teacher access required for ECE configuration.' });
    }
    req.eceActor     = user.email || user._id.toString();
    req.eceActorRole = user.role === 'admin' ? 'root_admin' : 'teacher';
    req.eceScopeId   = user._id;
    req.isRoot       = user.role === 'admin';
    req.isEceAdmin   = true;
    return next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Session expired.' });
    }
    console.error('[ECE Guard] eceTeacher error:', err.message);
    return res.status(500).json({ success: false, message: 'Authentication error.' });
  }
}

module.exports = { eceRootOnly, eceInstitutionAdmin, eceTeacher };