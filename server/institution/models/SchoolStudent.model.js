/* ============================================
   LATLOMP INSTITUTION — SCHOOL STUDENT MODEL
   
   ✅ PHASE A CHANGES:
   - classId added (optional ref to SchoolClass)
   - departmentId added (optional ref to Department)
   - level added (for uni/poly students)
   All fields are optional — existing students not broken.
============================================ */
const mongoose = require('mongoose');

const schoolStudentSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },

    /* ---- Identity ---- */
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
      /* When set, this is the authoritative class assignment.
         The plain 'class' string field remains for backward compat. */
    },

    /* ✅ PHASE A: Department reference (for poly/uni) */
    departmentId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Department',
      default: null
    },

    /* ✅ PHASE A: Academic level (for poly/uni) */
    level: {
      type:    String,
      default: ''
      /* e.g. "100", "200", "ND1", "HND2" */
    },

    /* ---- Demographics ---- */
    gender:      { type: String, enum: ['male','female','other',''], default: '' },
    dateOfBirth: { type: Date,   default: null },

    /* ---- Contact ---- */
    email:       { type: String, default: '', lowercase: true },
    phone:       { type: String, default: '' },
    parentPhone: { type: String, default: '' },
    address:     { type: String, default: '' },

    /* ---- Auth (for future student portal) ---- */
    pinCode:     { type: String, default: '' },

    /* ---- Status ---- */
    isActive:         { type: Boolean, default: true },
    totalExamsTaken:  { type: Number,  default: 0 },
    averageScore:     { type: Number,  default: 0 }
  },
  { timestamps: true }
);

schoolStudentSchema.index({ schoolId: 1 });
schoolStudentSchema.index({ schoolId: 1, class: 1 });
/* ✅ PHASE A: New indexes */
schoolStudentSchema.index({ schoolId: 1, classId: 1 });
schoolStudentSchema.index({ schoolId: 1, departmentId: 1 });
schoolStudentSchema.index({ schoolId: 1, admissionNo: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('SchoolStudent', schoolStudentSchema);