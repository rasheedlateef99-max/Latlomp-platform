/* ============================================
   LATLOMP INSTITUTION — SCHOOL USER MODEL

   Represents school admins and teachers.
   Separate from main platform User model.
   Multi-tenant: every record scoped to schoolId.

   ✅ PHASE A CHANGES (preserved):
   - role enum extended with all institution types
   - classId added (optional ref to SchoolClass)
   - departmentId added (optional ref to Department)
   - subjectIds added (array of SchoolSubject refs)
   All additions are nullable — existing records safe.

   ✅ RESTRUCTURE STAGE 2 CHANGES:
   - role enum: added 'department_admin', 'principal'
   - additionalRoles: [String] array for multiple
     responsibilities. Defaults to [] — existing staff
     unaffected. Each value must be a valid role.
   NOTE: classId and departmentId already existed
   and serve as the ownership scope fields used by
   verifyStudentScope() and verifyAttendanceScope()
   in inst.auth.js. No new fields needed for scope.
============================================ */
'use strict';

const mongoose = require('mongoose');

/* ============================================
   ALL VALID ROLE VALUES
   Kept in sync with inst.auth.js role lists.
   'bursar' preserved for backward compatibility.
   ✅ STAGE 2 ADDITIONS: 'department_admin', 'principal'
============================================ */
var VALID_ROLES = [
  /* ── Existing values — backward-compatible ── */
  'school_admin',
  'teacher',
  'vice_principal',
  'bursar',
  /* ── Phase A additions ── */
  'class_teacher',     /* primary/secondary */
  'subject_teacher',   /* primary/secondary */
  'lecturer',          /* poly/uni/college */
  'instructor',        /* training/vocational */
  'hod',               /* Head of Department — academic */
  'dean',              /* University dean */
  /* ── ✅ Restructure Stage 2 additions ── */
  'department_admin',  /* Department operations/admin (separate from hod) */
  'principal'          /* School principal — senior staff */
];

const schoolUserSchema = new mongoose.Schema(
  {
    /* ---- Tenant isolation ---- */
    schoolId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'School',
      required: true
    },

    /* ---- Identity ---- */
    name:    { type: String, required: true, trim: true },
    email:   { type: String, required: true, lowercase: true, trim: true },
    phone:   { type: String, default: '' },
    avatar:  { type: String, default: '' },

    /* ---- Primary Role ----
       One primary operational role per staff member.
       Permissions come from this + additionalRoles combined.
       See inst.auth.js getEffectiveRoles() for how
       multiple responsibilities are resolved.
    ---- */
    role: {
      type:    String,
      enum:    VALID_ROLES,
      default: 'teacher'
    },

    /* ---- ✅ STAGE 2: Additional Responsibilities ----
       Allows one person to hold multiple responsibilities.
       Examples:
         class_teacher + subject_teacher
         hod + lecturer
         department_admin + lecturer
         principal + teacher (small school)

       Permissions = union of role + additionalRoles.
       Scope restrictions still apply per responsibility.
       'school_admin' excluded from additionalRoles —
       admin cannot be delegated, only assigned as primary role.

       Defaults to [] — all existing staff unaffected.
    ---- */
    additionalRoles: {
      type: [{
        type: String,
        enum: VALID_ROLES.filter(function (r) { return r !== 'school_admin'; })
      }],
      default: []
    },

    /* ---- Teaching assignments (legacy strings) ---- */
    subjects:      [String],   /* kept for backward compat */
    classes:       [String],   /* kept for backward compat */
    qualification: { type: String, default: '' },
    employeeId:    { type: String, default: '' },

    /* ---- Structured references (all optional) ---- */

    /* ✅ PHASE A: Class ownership scope.
       For class_teacher: the one class they own.
       Used by verifyStudentScope() and
       verifyAttendanceScope() in inst.auth.js.
       Set during invitation when role = class_teacher. */
    classId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'SchoolClass',
      default: null
    },

    /* ✅ PHASE A: Department ownership scope.
       For department_admin and hod: the department they own.
       Used by verifyStudentScope() in inst.auth.js.
       Set during invitation when role = department_admin or hod. */
    departmentId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Department',
      default: null
    },

    /* ✅ PHASE A: Subjects this teacher teaches (structured refs) */
    subjectIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref:  'SchoolSubject'
    }],

    /* ---- Auth ---- */
    googleId:     { type: String, default: '' },
    authProvider: { type: String, default: 'google' },
    lastLoginAt:  { type: Date,   default: null },

    /* ---- Status ---- */
    isActive:   { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },

    /* ---- Invitation ---- */
    invitedBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'SchoolUser',
      default: null
    },
    invitedAt: { type: Date, default: null },
    joinedAt:  { type: Date, default: null }
  },
  { timestamps: true }
);

/* ---- Indexes ---- */
/* Compound unique: one email per school */
schoolUserSchema.index({ schoolId: 1, email: 1 }, { unique: true });
schoolUserSchema.index({ schoolId: 1, role: 1 });
/* Phase A: Structure-based queries */
schoolUserSchema.index({ schoolId: 1, classId: 1 });
schoolUserSchema.index({ schoolId: 1, departmentId: 1 });

module.exports = mongoose.model('SchoolUser', schoolUserSchema);