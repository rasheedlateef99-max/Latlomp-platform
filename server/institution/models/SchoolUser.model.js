/* ============================================
   LATLOMP INSTITUTION — SCHOOL USER MODEL
   
   Represents school admins and teachers.
   Separate from main platform User model.
   Multi-tenant: every record scoped to schoolId.
   
   ✅ PHASE A CHANGES:
   - role enum extended with all institution types
   - classId added (optional ref to SchoolClass)
   - departmentId added (optional ref to Department)
   - subjectIds added (array of SchoolSubject refs)
   All additions are nullable — existing records safe.
============================================ */
const mongoose = require('mongoose');

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

    /* ---- Role ----
       ✅ PHASE A: Extended to support all institution types.
       Old values (school_admin, teacher, vice_principal, bursar)
       remain in the enum — existing records NOT broken.

       Primary/Secondary:  class_teacher, subject_teacher
       Tertiary:           lecturer, hod, dean
       Training/Voc:       instructor
    ---- */
    role: {
      type:    String,
      enum:    [
        /* ── Existing values — backward-compatible ── */
        'school_admin',
        'teacher',
        'vice_principal',
        'bursar',
        /* ── New values — Phase A ── */
        'class_teacher',     /* primary/secondary */
        'subject_teacher',   /* primary/secondary */
        'lecturer',          /* poly/uni/college */
        'instructor',        /* training/vocational */
        'hod',               /* Head of Department */
        'dean'               /* University dean */
      ],
      default: 'teacher'
    },

    /* ---- Teaching assignments (legacy strings) ---- */
    subjects:      [String],   /* kept for backward compat */
    classes:       [String],   /* kept for backward compat */
    qualification: { type: String, default: '' },
    employeeId:    { type: String, default: '' },

    /* ---- ✅ PHASE A: Structured references (all optional) ---- */

    /* Which class this teacher is assigned to
       (class teacher / form teacher for primary/secondary) */
    classId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'SchoolClass',
      default: null
    },

    /* Which department this teacher/lecturer belongs to
       (polytechnic / university / college) */
    departmentId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Department',
      default: null
    },

    /* Subjects this teacher teaches (structured refs) */
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

/* Compound unique: one email per school */
schoolUserSchema.index({ schoolId: 1, email: 1 }, { unique: true });
schoolUserSchema.index({ schoolId: 1, role: 1 });
/* ✅ PHASE A: New indexes for structure-based queries */
schoolUserSchema.index({ schoolId: 1, classId: 1 });
schoolUserSchema.index({ schoolId: 1, departmentId: 1 });

module.exports = mongoose.model('SchoolUser', schoolUserSchema);