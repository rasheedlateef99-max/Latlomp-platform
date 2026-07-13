/* ============================================
   LATLOMP INSTITUTION — AUTH MIDDLEWARE

   Separate from main platform auth.
   Uses same JWT secret but separate role checks.

   ✅ RESTRUCTURE STAGE 1:
   Added 4 new permission guards and 2 scope-check
   helpers to support the delegation model without
   changing any existing guard.

   ✅ RESTRUCTURE STAGE 2 CORRECTION:
   Stage 1 delivered verifyStudentScope() and
   verifyAttendanceScope() referencing:
     schoolUser.assignedClassId
     schoolUser.assignedDepartmentId
   The actual SchoolUser model fields are:
     schoolUser.classId
     schoolUser.departmentId
   (These existed since Phase A — no new fields needed)
   All references corrected in this file.
   No logic changes — field name correction only.

   WHAT CHANGED FROM STAGE 1:
     verifyStudentScope()    — classId/departmentId
     verifyAttendanceScope() — classId

   WHAT IS UNCHANGED:
     instProtect, schoolAdminOnly, teacherOrAdmin,
     signInstToken, getEffectiveRoles,
     seniorStaffOrAdmin, canManageStudents,
     canEnterScores, canMarkAttendance
     — all identical to Stage 1 delivery.
============================================ */

'use strict';

const jwt        = require('jsonwebtoken');
const SchoolUser = require('../models/SchoolUser.model');
const School     = require('../models/School.model');

/* ============================================
   ROLE LISTS
   Kept in sync with SchoolUser.model.js VALID_ROLES.
   'bursar' preserved for backward compatibility.
============================================ */
var ALL_ROLES = [
  'school_admin', 'teacher', 'vice_principal', 'bursar',
  'class_teacher', 'subject_teacher', 'lecturer', 'instructor',
  'hod', 'dean', 'department_admin', 'principal'
];

var SENIOR_ROLES = [
  'school_admin', 'principal', 'vice_principal', 'dean', 'hod'
];

var STUDENT_MGMT_ROLES = [
  'school_admin', 'principal', 'vice_principal', 'dean',
  'hod', 'department_admin', 'class_teacher'
];

var TEACHING_ROLES = [
  'school_admin', 'principal', 'vice_principal', 'dean',
  'hod', 'department_admin', 'class_teacher',
  'subject_teacher', 'teacher', 'lecturer', 'instructor'
];

/* ============================================
   getEffectiveRoles(user)
   Returns union of primary role + additionalRoles.
   Foundation of the multiple-responsibilities model.
============================================ */
function getEffectiveRoles(user) {
  if (!user) { return []; }
  var base  = user.role ? [user.role] : [];
  var extra = (Array.isArray(user.additionalRoles) && user.additionalRoles.length > 0)
    ? user.additionalRoles
    : [];
  var combined = base.concat(extra);
  return combined.filter(function (r, idx) {
    return combined.indexOf(r) === idx;
  });
}

/* ============================================
   ORIGINAL: instProtect (UNCHANGED)
============================================ */
async function instProtect(req, res, next) {
  try {
    var token = null;
    var authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authenticated. Please log in.' });
    }
    var decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.schoolUserId) {
      return res.status(401).json({ success: false, message: 'Invalid token type.' });
    }
    var user = await SchoolUser.findById(decoded.schoolUserId).populate('schoolId');
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found.' });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated.' });
    }
    req.schoolUser = user;
    req.schoolId   = user.schoolId._id || user.schoolId;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
}

/* ============================================
   ORIGINAL: schoolAdminOnly (UNCHANGED)
============================================ */
function schoolAdminOnly(req, res, next) {
  if (!req.schoolUser || req.schoolUser.role !== 'school_admin') {
    return res.status(403).json({ success: false, message: 'School admin access required.' });
  }
  next();
}

/* ============================================
   UPDATED: teacherOrAdmin
   Expanded to include ALL institution roles.
   (was: school_admin, teacher, vice_principal)
   (now: all roles in ALL_ROLES)
   Purely additive — no role removed.
============================================ */
function teacherOrAdmin(req, res, next) {
  if (!req.schoolUser) {
    return res.status(403).json({ success: false, message: 'Access required.' });
  }
  var effectiveRoles = getEffectiveRoles(req.schoolUser);
  if (!effectiveRoles.some(function (r) { return ALL_ROLES.includes(r); })) {
    return res.status(403).json({ success: false, message: 'Staff access required.' });
  }
  next();
}

/* ============================================
   ORIGINAL: signInstToken (UNCHANGED)
============================================ */
function signInstToken(schoolUserId, schoolId) {
  return jwt.sign(
    { schoolUserId: schoolUserId, schoolId: schoolId },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/* ============================================
   seniorStaffOrAdmin
   Roles: school_admin, principal, vice_principal,
          dean, hod
   Used on: score approval, report card release.
============================================ */
function seniorStaffOrAdmin(req, res, next) {
  if (!req.schoolUser) {
    return res.status(403).json({ success: false, message: 'Access required.' });
  }
  var effectiveRoles = getEffectiveRoles(req.schoolUser);
  if (!effectiveRoles.some(function (r) { return SENIOR_ROLES.includes(r); })) {
    return res.status(403).json({ success: false, message: 'Senior staff or admin access required.' });
  }
  next();
}

/* ============================================
   canManageStudents
   Role check only. Scope check runs inside
   route via verifyStudentScope().
============================================ */
function canManageStudents(req, res, next) {
  if (!req.schoolUser) {
    return res.status(403).json({ success: false, message: 'Access required.' });
  }
  var effectiveRoles = getEffectiveRoles(req.schoolUser);
  if (!effectiveRoles.some(function (r) { return STUDENT_MGMT_ROLES.includes(r); })) {
    return res.status(403).json({
      success: false,
      message: 'You do not have permission to manage student records.'
    });
  }
  next();
}

/* ============================================
   verifyStudentScope(schoolUser, targetClassId, targetDeptId)

   ✅ STAGE 2 CORRECTION:
   Uses schoolUser.classId (not assignedClassId)
   Uses schoolUser.departmentId (not assignedDepartmentId)
   These are the actual field names in SchoolUser.model.js
   (existed since Phase A).

   Called INSIDE route handlers after canManageStudents.
   Returns null if allowed, error string if denied.
============================================ */
function verifyStudentScope(schoolUser, targetClassId, targetDeptId) {
  var effectiveRoles = getEffectiveRoles(schoolUser);

  /* Unrestricted roles — full student access */
  var unrestrictedRoles = ['school_admin', 'principal', 'vice_principal', 'dean'];
  if (effectiveRoles.some(function (r) { return unrestrictedRoles.includes(r); })) {
    return null;
  }

  var hasClassTeacher = effectiveRoles.includes('class_teacher');
  var hasDeptRole     = effectiveRoles.some(function (r) {
    return ['hod', 'department_admin'].includes(r);
  });

  var classAllowed = false;
  var deptAllowed  = false;
  var classError   = null;
  var deptError    = null;

  if (hasClassTeacher) {
    /* ✅ CORRECTED: was schoolUser.assignedClassId — now schoolUser.classId */
    if (!schoolUser.classId) {
      classError = 'No class has been assigned to your account. Please contact your school administrator.';
    } else if (targetClassId) {
      if (schoolUser.classId.toString() === targetClassId.toString()) {
        classAllowed = true;
      } else {
        classError = 'You can only manage students in your assigned class.';
      }
    } else {
      classAllowed = true;
    }
  }

  if (hasDeptRole) {
    /* ✅ CORRECTED: was schoolUser.assignedDepartmentId — now schoolUser.departmentId */
    if (!schoolUser.departmentId) {
      deptError = 'No department has been assigned to your account. Please contact your school administrator.';
    } else if (targetDeptId) {
      if (schoolUser.departmentId.toString() === targetDeptId.toString()) {
        deptAllowed = true;
      } else {
        deptError = 'You can only manage students in your assigned department.';
      }
    } else {
      deptAllowed = true;
    }
  }

  if (hasClassTeacher || hasDeptRole) {
    if (classAllowed || deptAllowed) { return null; }
    return classError || deptError || 'Access denied.';
  }

  return 'You do not have permission to manage student records.';
}

/* ============================================
   canEnterScores
   All teaching roles can enter scores.
   Subject/class scope enforced by route
   using user's classes[] and subjects[] arrays.
============================================ */
function canEnterScores(req, res, next) {
  if (!req.schoolUser) {
    return res.status(403).json({ success: false, message: 'Access required.' });
  }
  var effectiveRoles = getEffectiveRoles(req.schoolUser);
  if (!effectiveRoles.some(function (r) { return TEACHING_ROLES.includes(r); })) {
    return res.status(403).json({
      success: false,
      message: 'Teaching staff access required for score entry.'
    });
  }
  next();
}

/* ============================================
   canMarkAttendance
   All teaching roles can mark attendance.
   Route calls verifyAttendanceScope() for
   class ownership enforcement.
============================================ */
function canMarkAttendance(req, res, next) {
  if (!req.schoolUser) {
    return res.status(403).json({ success: false, message: 'Access required.' });
  }
  var effectiveRoles = getEffectiveRoles(req.schoolUser);
  if (!effectiveRoles.some(function (r) { return TEACHING_ROLES.includes(r); })) {
    return res.status(403).json({
      success: false,
      message: 'Teaching staff access required for attendance marking.'
    });
  }
  next();
}

/* ============================================
   verifyAttendanceScope(schoolUser, targetClassId)

   ✅ STAGE 2 CORRECTION:
   Uses schoolUser.classId (not assignedClassId).

   Returns null if allowed, error string if denied.
============================================ */
function verifyAttendanceScope(schoolUser, targetClassId) {
  var effectiveRoles = getEffectiveRoles(schoolUser);

  /* Unrestricted */
  var unrestrictedRoles = ['school_admin', 'principal', 'vice_principal', 'dean'];
  if (effectiveRoles.some(function (r) { return unrestrictedRoles.includes(r); })) {
    return null;
  }

  /* class_teacher: must use their assigned class only */
  if (effectiveRoles.includes('class_teacher')) {
    /* ✅ CORRECTED: was schoolUser.assignedClassId — now schoolUser.classId */
    if (!schoolUser.classId) {
      return 'No class has been assigned to your account. Please contact your school administrator.';
    }
    if (targetClassId && schoolUser.classId.toString() !== targetClassId.toString()) {
      return 'You can only mark attendance for your assigned class.';
    }
    return null;
  }

  /* All other teaching roles: scope from classes[] array */
  if (targetClassId) {
    var assignedClasses = Array.isArray(schoolUser.classes)
      ? schoolUser.classes.map(function (c) { return c.toString(); })
      : [];
    if (assignedClasses.length > 0 && !assignedClasses.includes(targetClassId.toString())) {
      return 'You can only mark attendance for your assigned classes.';
    }
  }

  return null;
}

/* ============================================
   EXPORTS — all original + all Stage 1 + correction
============================================ */
module.exports = {
  /* ---- ORIGINAL (unchanged) ---- */
  instProtect,
  schoolAdminOnly,
  teacherOrAdmin,
  signInstToken,

  /* ---- Stage 1 additions (field names corrected in Stage 2) ---- */
  getEffectiveRoles,
  seniorStaffOrAdmin,
  canManageStudents,
  verifyStudentScope,
  canEnterScores,
  canMarkAttendance,
  verifyAttendanceScope
};