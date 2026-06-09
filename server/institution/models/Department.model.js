/* ============================================
   LATLOMP INSTITUTION — DEPARTMENT MODEL
   
   Used by polytechnics, universities, colleges
   of education, and other tertiary institutions.
   
   Primary and secondary schools do NOT use this.
   The inst.structure.config.js controls which
   institution types have departments.
   
   Examples:
     Polytechnic:  Computer Science, Electrical Engineering
     University:   Faculty of Science → Dept of Physics
   
   ✅ FIX: Registered as 'SchoolDepartment' (not 'Department')
      to avoid collision with the main platform's CBT
      Department model which is already registered.
============================================ */
const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema(
  {
    /* ---- Tenant isolation ---- */
    schoolId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'School',
      required: true
    },

    /* ---- Identity ---- */
    name: {
      type:     String,
      required: true,
      trim:     true
      /* e.g. "Computer Science", "Mechanical Engineering" */
    },

    /* Short code for the department */
    code: {
      type:      String,
      default:   '',
      trim:      true,
      uppercase: true
      /* e.g. "CSC", "MEE" */
    },

    /* Faculty this department belongs to (universities) */
    faculty: {
      type:    String,
      default: '',
      trim:    true
      /* e.g. "Faculty of Engineering", "Faculty of Science" */
    },

    /* Head of Department */
    hodId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'SchoolUser',
      default: null
    },

    description: { type: String,  default: '' },
    isActive:    { type: Boolean, default: true },
    sortOrder:   { type: Number,  default: 0 }
  },
  { timestamps: true }
);

departmentSchema.index({ schoolId: 1, isActive: 1 });
departmentSchema.index({ schoolId: 1, name: 1 });

/* ✅ FIX: 'SchoolDepartment' — avoids collision with CBT Department model */
module.exports = mongoose.model('SchoolDepartment', departmentSchema);