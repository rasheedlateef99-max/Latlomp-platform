'use strict';
/* ============================================
   LATLOMP — MESSAGING GUARDS (B1)

   Turns three different logins into ONE actor object:
     req.msgActor = {
       kind, id, idStr, schoolId, schoolIdStr, name, email,
       roles[], classId, departmentId, isAlumni, school:{name,writable}
     }

   - staff:   existing instProtect + teacherOrAdmin + active subscription
   - parent:  existing parentProtect; the school is picked by the SERVER:
              exactly one linked school → automatic; several → the client
              may name one (x-school-id header or ?schoolId=) and it is
              validated against the parent's own links, never trusted
   - student: the student JWT is verified, then the student is reloaded
              from the database on EVERY request (status checked);
              graduated students must also have an active AlumniProfile

   Read-only: if the school's subscription is inactive or the school is
   suspended, parents / students / alumni can still read but cannot write.
   (Staff are already blocked by requireActiveSubscription.)
============================================ */
const jwt = require('jsonwebtoken');
const { instProtect, teacherOrAdmin }  = require('./inst.auth');
const { requireActiveSubscription }    = require('./inst.tenant');
const { parentProtect }                = require('./parent.auth');
const School        = require('../models/School.model');
const SchoolStudent = require('../models/SchoolStudent.model');
const AlumniProfile = require('../models/AlumniProfile.model');
const policy        = require('../services/messaging.policy');

let rateLimit = null;
try { rateLimit = require('express-rate-limit'); } catch (e) { /* limiter becomes a no-op, like the other institution limiters */ }

function fail(res, status, code, message, extra) {
  return res.status(status).json(Object.assign({ success: false, code: code, message: message }, extra || {}));
}

function idOf(x) { return x && x._id ? x._id : x; }

/* ---------- staff ---------- */
function attachStaffActor(req, res, next) {
  const u = req.schoolUser;
  const sid = idOf(req.schoolId);
  if (!u || !sid) { return fail(res, 403, 'NO_SCHOOL_CONTEXT', 'School context missing.'); }
  req.msgActor = {
    kind: 'staff', id: u._id, idStr: String(u._id),
    schoolId: sid, schoolIdStr: String(sid),
    name: u.name || '', email: u.email || '', roles: policy.roleSet(u),
    classId: u.classId || null, departmentId: u.departmentId || null,
    isAlumni: false, school: { name: (req.school && req.school.name) || '', writable: true }
  };
  next();
}

/* ---------- parent ---------- */
function parentSchoolIds(parent) {
  const out = [];
  ((parent && parent.linkedStudents) || []).forEach(function (ls) {
    const id = ls && ls.schoolId ? String(idOf(ls.schoolId)) : '';
    if (id && out.indexOf(id) === -1) { out.push(id); }
  });
  return out;
}

async function attachParentActor(req, res, next) {
  try {
    const parent = req.parent;
    const ids = parentSchoolIds(parent);
    if (!ids.length) { return fail(res, 403, 'NO_SCHOOL_LINK', 'Your account is not linked to a school.'); }

    const header = req.get ? req.get('x-school-id') : '';
    const asked = typeof header === 'string' && header ? header
      : (typeof req.query.schoolId === 'string' ? req.query.schoolId : '');

    let chosen = null;
    if (asked) {
      if (ids.indexOf(asked) === -1) { return fail(res, 403, 'SCHOOL_NOT_LINKED', 'That school is not linked to your account.'); }
      chosen = asked;
    } else if (ids.length === 1) {
      chosen = ids[0];
    } else {
      const schools = await School.find({ _id: { $in: ids } }).select('name').lean();
      return fail(res, 409, 'SCHOOL_REQUIRED', 'Please choose a school.', {
        schools: schools.map(function (s) { return { _id: String(s._id), name: s.name }; })
      });
    }

    const school = await School.findById(chosen).select('name isSuspended status subscriptionExpiry');
    if (!school) { return fail(res, 404, 'SCHOOL_NOT_FOUND', 'School not found.'); }

    req.msgActor = {
      kind: 'parent', id: parent._id, idStr: String(parent._id),
      schoolId: school._id, schoolIdStr: String(school._id),
      name: parent.name || '', email: parent.email || '', roles: [],
      classId: null, departmentId: null, isAlumni: false,
      school: { name: school.name || '', writable: !!school.isSubscriptionActive }
    };
    next();
  } catch (err) {
    console.error('[messaging.guard] parent:', err.message);
    return fail(res, 500, 'SERVER_ERROR', 'Something went wrong. Please try again.');
  }
}

/* ---------- student / alumni ---------- */
async function studentGuard(req, res, next) {
  try {
    const auth = req.headers && req.headers.authorization;
    if (!auth || auth.indexOf('Bearer ') !== 0) { return fail(res, 401, 'NOT_AUTHENTICATED', 'Not authenticated. Please log in.'); }
    let decoded;
    try { decoded = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET); }
    catch (e) { return fail(res, 401, 'SESSION_EXPIRED', 'Invalid or expired session. Please log in again.'); }
    if (!decoded || decoded.role !== 'student' || !policy.isObjectIdString(String(decoded.studentId || ''))) {
      return fail(res, 401, 'INVALID_TOKEN', 'Invalid token type.');
    }

    /* school comes from the DATABASE record; the token must agree with it */
    const student = await SchoolStudent.findOne({
      _id: String(decoded.studentId), status: { $in: ['active', 'graduated'] }
    }).select('name schoolId status classId departmentId').lean();
    if (!student || String(student.schoolId) !== String(decoded.schoolId)) {
      return fail(res, 401, 'ACCOUNT_UNAVAILABLE', 'This account is not active.');
    }

    let isAlumni = false;
    let displayName = student.name;
    if (student.status === 'graduated') {
      const profile = await AlumniProfile.findOne({ studentId: student._id, schoolId: student.schoolId, status: 'active' })
        .select('displayName').lean();
      if (!profile) { return fail(res, 403, 'ALUMNI_PROFILE_INACTIVE', 'Alumni profile not found or inactive.'); }
      isAlumni = true;
      displayName = profile.displayName || student.name;
    }

    const school = await School.findById(student.schoolId).select('name isSuspended status subscriptionExpiry');
    if (!school) { return fail(res, 404, 'SCHOOL_NOT_FOUND', 'School not found.'); }

    req.msgActor = {
      kind: 'student', id: student._id, idStr: String(student._id),
      schoolId: student.schoolId, schoolIdStr: String(student.schoolId),
      name: displayName || '', email: '', roles: [],
      classId: student.classId || null, departmentId: student.departmentId || null,
      isAlumni: isAlumni, school: { name: school.name || '', writable: !!school.isSubscriptionActive }
    };
    next();
  } catch (err) {
    console.error('[messaging.guard] student:', err.message);
    return fail(res, 500, 'SERVER_ERROR', 'Something went wrong. Please try again.');
  }
}

/* ---------- write gate for non-staff ---------- */
function requireWritable(req, res, next) {
  const a = req.msgActor;
  if (a && a.school && a.school.writable) { return next(); }
  return fail(res, 403, 'SCHOOL_READ_ONLY', 'Messaging is read-only because the school account is not active.');
}

/* ---------- per-PERSON rate limits (not per school, not per IP) ---------- */
function personLimiter(windowMs, limit, message) {
  if (!rateLimit) { return function (req, res, next) { next(); }; }
  return rateLimit({
    windowMs: windowMs, limit: limit, standardHeaders: true, legacyHeaders: false,
    keyGenerator: function (req) { return req.msgActor ? ('msg:' + req.msgActor.kind + ':' + req.msgActor.idStr) : 'msg:anon'; },
    message: { success: false, code: 'RATE_LIMITED', message: message }
  });
}
const searchLimiter  = personLimiter(60 * 1000, 60, 'Too many searches. Please wait a moment.');
const requestLimiter = personLimiter(60 * 60 * 1000, 20, 'Too many connection requests this hour. Please try again later.');

const staffGuard  = [instProtect, teacherOrAdmin, requireActiveSubscription, attachStaffActor];
const parentGuard = [parentProtect, attachParentActor];

module.exports = {
  staffGuard, parentGuard, studentGuard,
  attachStaffActor, attachParentActor, requireWritable,
  searchLimiter, requestLimiter, parentSchoolIds
};
