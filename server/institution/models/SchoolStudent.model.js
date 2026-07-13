/* ============================================
   LATLOMP INSTITUTION — SCHOOL STUDENT MODEL

   ✅ PHASE A (preserved):
   - classId, departmentId, level

   ✅ PHASE J CHANGES (preserved):
   - studentId (auto-generated, school-scoped)
   - passportPhotoUrl
   - parentName, parentEmail (parentPhone already existed)
   - status enum (lifecycle: active/graduated/transferred/repeated/inactive)
   - classHistory[] (movement tracking — feeds Phase S promotions)
   - joinedSession, joinedYear

   ✅ PHASE P (preserved):
   - pinCode (bcrypt-hashed student portal PIN)

   🐛 BUG FIX (preserved):
   - departmentId ref changed from 'Department' to 'SchoolDepartment'

   ✅ RESTRUCTURE STAGE 2:
   - createdByRole: which role type created this student
     (audit trail: 'school_admin', 'class_teacher', 'hod', etc.)
   - createdById: which staff member created this student
     (allows class_teacher to identify their registered students)
   Both fields are optional with safe defaults.
   Existing students are NOT broken — no migration needed.
============================================ */
'use strict';

const mongoose = require('mongoose');

/* ✅ PHASE J: One entry per class movement event */
const classHistoryEntrySchema = new mongoose.Schema({
  classId:    { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolClass', default: null },
  className:  { type: String, default: '' },
  session:    { type: String, default: '' },
  term:       { type: String, default: '' },
  action: {
    type: String,
    enum: ['enrolled', 'promoted', 'repeated', 'transferred_in', 'transferred_out', 'graduated'],
    default: 'enrolled'
  },
  recordedAt: { type: Date, default: Date.now }
}, { _id: false });

const schoolStudentSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },

    /* ---- Identity ---- */
    /* ✅ PHASE J: Auto-generated, school-scoped (e.g. "BFS-2025-0001") */
    studentId:   { type: String, default: '' },
    name:        { type: String, required: true, trim: true },
    admissionNo: { type: String, default: '' },

    /* Legacy string fields — kept for backward compatibility */
    class:       { type: String, default: '' },
    arm:         { type: String, default: '' },

    /* ✅ PHASE A: Structured class reference (optional) */
    classId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'SchoolClass',
      default: null
    },

    /* ✅ PHASE A: Department reference (for poly/uni)
       🐛 FIXED: ref was 'Department' — now 'SchoolDepartment' */
    departmentId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'SchoolDepartment',
      default: null
    },

    /* ✅ PHASE A: Academic level (for poly/uni) */
    level: { type: String, default: '' },

    /* ✅ PHASE J: Class movement history — feeds Phase S promotions */
    classHistory: { type: [classHistoryEntrySchema], default: [] },

    /* ---- Demographics ---- */
    gender:      { type: String, enum: ['male','female','other',''], default: '' },
    dateOfBirth: { type: Date,   default: null },

    /* ✅ PHASE J: Passport photo */
    passportPhotoUrl: { type: String, default: '' },

    /* ---- Contact ---- */
    email:       { type: String, default: '', lowercase: true },
    phone:       { type: String, default: '' },
    address:     { type: String, default: '' },

    /* ✅ PHASE J: Expanded parent/guardian info */
    parentName:  { type: String, default: '' },
    parentPhone: { type: String, default: '' },
    parentEmail: { type: String, default: '', lowercase: true },

    /* ✅ PHASE P: Student portal PIN (bcrypt-hashed) */
    pinCode: { type: String, default: '' },

    /* ✅ PHASE J: Lifecycle status */
    status: {
      type:    String,
      enum:    ['active', 'graduated', 'transferred', 'repeated', 'inactive'],
      default: 'active'
    },
    /* Legacy quick filter — kept in sync with status */
    isActive: { type: Boolean, default: true },

    /* ✅ PHASE J: Session tracking */
    joinedSession: { type: String, default: '' },
    joinedYear:    { type: Number, default: null },

    /* ---- Stats ---- */
    totalExamsTaken: { type: Number, default: 0 },
    averageScore:    { type: Number, default: 0 },

    /* ---- ✅ RESTRUCTURE STAGE 2: Audit trail ----
       Tracks which staff role and which staff member
       created this student record. Enables class teachers
       to verify their own student registrations and
       provides an audit trail for delegated student creation.
       Both fields are optional with safe defaults.
       Existing students retain default values.
    ---- */
    createdByRole: { type: String, default: '' },
    /* e.g. 'school_admin', 'class_teacher', 'department_admin' */

    createdById: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'SchoolUser',
      default: null
    }
  },
  { timestamps: true }
);

/* ---- Indexes ---- */
schoolStudentSchema.index({ schoolId: 1 });
schoolStudentSchema.index({ schoolId: 1, class: 1 });
schoolStudentSchema.index({ schoolId: 1, classId: 1 });
schoolStudentSchema.index({ schoolId: 1, departmentId: 1 });
schoolStudentSchema.index({ schoolId: 1, admissionNo: 1 }, { unique: true, sparse: true });
/* ✅ PHASE J */
schoolStudentSchema.index({ schoolId: 1, studentId: 1 }, { unique: true, sparse: true });
schoolStudentSchema.index({ schoolId: 1, status: 1 });
/* ✅ STAGE 2: Lookup by creating staff member */
schoolStudentSchema.index({ schoolId: 1, createdById: 1 });

/* ============================================
   ✅ PHASE J: Generate next student ID for a school
   Format: PREFIX-YEAR-SEQUENCE (e.g. "BFS-2025-0001")
============================================ */
schoolStudentSchema.statics.generateStudentId = async function (schoolId, schoolName, year) {
  var prefix = (schoolName || 'SCH')
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
    .substring(0, 3);
  if (prefix.length < 2) { prefix = 'SCH'; }

  var yr = year || new Date().getFullYear();

  var count = await this.countDocuments({
    schoolId:  schoolId,
    studentId: { $regex: '^' + prefix + '-' + yr + '-' }
  });

  var seq = String(count + 1).padStart(4, '0');
  return prefix + '-' + yr + '-' + seq;
};

module.exports = mongoose.model('SchoolStudent', schoolStudentSchema);