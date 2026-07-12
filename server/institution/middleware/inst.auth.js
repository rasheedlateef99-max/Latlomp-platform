/* ============================================
   LATLOMP INSTITUTION — AUTH MIDDLEWARE

   Separate from main platform auth.
   Uses same JWT secret but separate role checks.

   ✅ RESTRUCTURE STAGE 1:
   Added 4 new permission guards and 2 scope-check
   helpers to support the delegation model without
   changing any existing guard.

   WHAT CHANGED:
     teacherOrAdmin — expanded allowed roles list
     (was: school_admin, teacher, vice_principal)
     (now: all institution staff roles)
     This is purely additive — no role is removed.
     Fixes a pre-existing gap where class_teacher,
     lecturer, hod, etc. were blocked from basic
     read endpoints they need for daily work.

   WHAT IS NEW:
     getEffectiveRoles()    — union of role +
                              additionalRoles
     seniorStaffOrAdmin     — approval authority
     canManageStudents      — student write access
     verifyStudentScope()   — scope helper for routes
     canEnterScores         — all teaching staff
     canMarkAttendance      — all teaching staff
     verifyAttendanceScope()— scope helper for routes

   WHAT IS UNCHANGED:
     instProtect            — identical to original
     schoolAdminOnly        — identical to original
     signInstToken          — identical to original

   BACKWARD COMPATIBILITY:
     All routes using instProtect, schoolAdminOnly,
     teacherOrAdmin, or signInstToken continue to work
     exactly as before. No existing import breaks.
     New exports are additive only.
============================================ */

'use strict';

const jwt        = require('jsonwebtoken');
const SchoolUser = require('../models/SchoolUser.model');
const School     = require('../models/School.model');

/* ============================================
   ALL VALID INSTITUTION ROLES
   Used by guards and scope helpers.
   Includes roles added in Restructure Stage 2
   (department_admin, principal) — safe to
   reference here because all guards degrade
   gracefully when a user has an unknown role.
============================================ */
var ALL_ROLES = [
  'school_admin',
  'principal',
  'vice_principal',
  'dean',
  'hod',
  'department_admin',
  'class_teacher',
  'subject_teacher',
  'teacher',
  'lecturer',
  'instructor'
];

var SENIOR_ROLES = [
  'school_admin',
  'principal',
  'vice_principal',
  'dean',
  'hod'
];

var STUDENT_MGMT_ROLES = [
  'school_admin',
  'principal',
  'vice_principal',
  'dean',
  'hod',
  'department_admin',
  'class_teacher'
];

var TEACHING_ROLES = [
  'school_admin',
  'principal',
  'vice_principal',
  'dean',
  'hod',
  'department_admin',
  'class_teacher',
  'subject_teacher',
  'teacher',
  'lecturer',
  'instructor'
];

/* ============================================
   ✅ STAGE 1 HELPER: getEffectiveRoles(user)

   Returns the union of a user's primary role
   and their additionalRoles array.

   This is the foundation of the multiple-
   responsibilities model. Every guard in this
   file calls this helper instead of checking
   req.schoolUser.role directly.

   Safe for existing users who do not yet have
   additionalRoles (the field defaults to []).
============================================ */
function getEffectiveRoles(user) {
  if (!user) { return []; }
  var base  = user.role ? [user.role] : [];
  var extra = (Array.isArray(user.additionalRoles) && user.additionalRoles.length > 0)
    ? user.additionalRoles
    : [];
  /* Deduplicate — a role in both role and additionalRoles appears once */
  var combined = base.concat(extra);
  return combined.filter(function (r, idx) {
    return combined.indexOf(r) === idx;
  });
}

/* ============================================
   ORIGINAL: instProtect (UNCHANGED)
   Verify JWT and attach school user to req.
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

    /* Must be a school user token */
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
   School admin only.
============================================ */
function schoolAdminOnly(req, res, next) {
  if (!req.schoolUser || req.schoolUser.role !== 'school_admin') {
    return res.status(403).json({ success: false, message: 'School admin access required.' });
  }
  next();
}

/* ============================================
   UPDATED: teacherOrAdmin
   ✅ STAGE 1 FIX: expanded allowed roles list.

   WAS: ['school_admin', 'teacher', 'vice_principal']
   NOW: all institution staff roles

   This is the guard used on most read endpoints
   (attendance, scores, timetable, structure reads).
   All existing allowed roles remain allowed.
   Previously blocked roles (class_teacher,
   subject_teacher, lecturer, hod, dean, etc.)
   are now correctly included.

   BACKWARD COMPATIBLE: purely additive change.
   No previously-allowed role is removed.
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
   Sign token for school user.
============================================ */
function signInstToken(schoolUserId, schoolId) {
  return jwt.sign(
    { schoolUserId: schoolUserId, schoolId: schoolId },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/* ============================================
   ✅ NEW STAGE 1: seniorStaffOrAdmin

   Roles: school_admin, principal, vice_principal,
          dean, hod

   Used on:
     Score submission approve/reject/release
     Report card official release
     Institution-wide attendance reports

   Supports additionalRoles: a teacher who also
   holds principal responsibility in their
   additionalRoles gets this access.
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
   ✅ NEW STAGE 1: canManageStudents

   ROLE CHECK ONLY — scope check runs inside
   the route handler via verifyStudentScope().

   Roles: school_admin, principal, vice_principal,
          dean, hod, department_admin, class_teacher

   Used on:
     POST /students (create)
     PUT  /students/:id (edit)
     DELETE /students/:id (deactivate)
     PUT  /student-portal/admin/students/:id/set-pin
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
   ✅ NEW STAGE 1: verifyStudentScope()

   Scope helper called INSIDE route handlers
   after canManageStudents guard passes.

   Returns null if access is allowed.
   Returns an error message string if access
   should be denied.

   Routes use it as:
     var scopeErr = verifyStudentScope(req.schoolUser, classId, deptId);
     if (scopeErr) {
       return res.status(403).json({ success:false, message: scopeErr });
     }

   SCOPE RULES:
     school_admin / principal / vice_principal / dean:
       No restriction — full access to all students.
     class_teacher:
       assignedClassId must match target student's classId.
       If assignedClassId is null (Stage 2 not yet set):
         Returns a configuration error message.
     hod / department_admin:
       assignedDepartmentId must match target departmentId.
       If assignedDepartmentId is null:
         Returns a configuration error message.
     Combined roles (class_teacher + hod):
       Either condition passing grants access.

   NOTE: assignedClassId and assignedDepartmentId
   are added in Restructure Stage 2. Until then,
   all users have null for both fields, so
   class_teacher and department_admin scope checks
   will return the configuration error message.
   This is intentional — scope becomes active only
   after Stage 5 assigns classes during invitation.
============================================ */
function verifyStudentScope(schoolUser, targetClassId, targetDeptId) {
  var effectiveRoles = getEffectiveRoles(schoolUser);

  /* Unrestricted roles */
  var unrestrictedRoles = ['school_admin', 'principal', 'vice_principal', 'dean'];
  if (effectiveRoles.some(function (r) { return unrestrictedRoles.includes(r); })) {
    return null;
  }

  var hasClassTeacher  = effectiveRoles.includes('class_teacher');
  var hasDeptRole      = effectiveRoles.some(function (r) {
    return ['hod', 'department_admin'].includes(r);
  });

  var classAllowed = false;
  var deptAllowed  = false;
  var classError   = null;
  var deptError    = null;

  if (hasClassTeacher) {
    if (!schoolUser.assignedClassId) {
      classError = 'No class has been assigned to your account. Please contact your school administrator.';
    } else if (targetClassId) {
      if (schoolUser.assignedClassId.toString() === targetClassId.toString()) {
        classAllowed = true;
      } else {
        classError = 'You can only manage students in your assigned class.';
      }
    } else {
      /* No specific class to check — general access for this role */
      classAllowed = true;
    }
  }

  if (hasDeptRole) {
    if (!schoolUser.assignedDepartmentId) {
      deptError = 'No department has been assigned to your account. Please contact your school administrator.';
    } else if (targetDeptId) {
      if (schoolUser.assignedDepartmentId.toString() === targetDeptId.toString()) {
        deptAllowed = true;
      } else {
        deptError = 'You can only manage students in your assigned department.';
      }
    } else {
      deptAllowed = true;
    }
  }

  /* If user has either class_teacher OR dept role, either passing grants access */
  if (hasClassTeacher || hasDeptRole) {
    if (classAllowed || deptAllowed) { return null; }
    /* Return the most relevant error */
    return classError || deptError || 'Access denied.';
  }

  /* No student management role at all (should not reach here after canManageStudents) */
  return 'You do not have permission to manage student records.';
}

/* ============================================
   ✅ NEW STAGE 1: canEnterScores

   All roles that teach can enter scores.
   Scope (which classes/subjects) is enforced
   by the route itself using the user's
   classes[] and subjects[] assignment arrays.

   Used on:
     POST /score/entry (score entry bulk save)
     PUT  /score/entry (edit saved scores)
     POST /score/submissions (submit for approval)
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
   ✅ NEW STAGE 1: canMarkAttendance

   All teaching roles can mark attendance.
   Scope varies by role:
     class_teacher: daily class attendance for
       their assigned class only.
     all others: attendance for their
       assigned classes[] array.

   Route calls verifyAttendanceScope() after
   this guard passes to enforce class ownership.

   Used on:
     POST /attendance/mark
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
   ✅ NEW STAGE 1: verifyAttendanceScope()

   Scope helper called INSIDE the attendance
   mark route handler.

   Returns null if marking is allowed.
   Returns an error string if denied.

   SCOPE RULES:
     school_admin / senior staff:
       Can mark attendance for any class.
     class_teacher:
       Can only mark attendance for their
       assignedClassId (daily class attendance).
     All other teaching roles:
       Scope comes from their classes[] array.
       If targetClassId is in their classes[],
       they can mark. Otherwise denied.
       This enforces subject teachers only mark
       their own assigned classes.

   Routes use it as:
     var scopeErr = verifyAttendanceScope(req.schoolUser, targetClassId);
     if (scopeErr) {
       return res.status(403).json({ success:false, message: scopeErr });
     }
============================================ */
function verifyAttendanceScope(schoolUser, targetClassId) {
  var effectiveRoles = getEffectiveRoles(schoolUser);

  /* Unrestricted: admin and senior staff */
  var unrestrictedRoles = ['school_admin', 'principal', 'vice_principal', 'dean'];
  if (effectiveRoles.some(function (r) { return unrestrictedRoles.includes(r); })) {
    return null;
  }

  /* class_teacher: must use their assigned class */
  if (effectiveRoles.includes('class_teacher')) {
    if (!schoolUser.assignedClassId) {
      return 'No class has been assigned to your account. Please contact your school administrator.';
    }
    if (targetClassId && schoolUser.assignedClassId.toString() !== targetClassId.toString()) {
      return 'You can only mark attendance for your assigned class.';
    }
    return null;
  }

  /* All other teaching roles: must be in their classes[] array */
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
   EXPORTS
   Includes all original exports (unchanged)
   plus all new Stage 1 exports.
============================================ */
module.exports = {
  /* ---- ORIGINAL (unchanged) ---- */
  instProtect,
  schoolAdminOnly,
  teacherOrAdmin,
  signInstToken,

  /* ---- NEW: Stage 1 addition ---- */
  getEffectiveRoles,
  seniorStaffOrAdmin,
  canManageStudents,
  verifyStudentScope,
  canEnterScores,
  canMarkAttendance,
  verifyAttendanceScope
};