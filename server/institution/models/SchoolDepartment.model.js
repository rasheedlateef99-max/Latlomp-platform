/* ============================================
   LATLOMP INSTITUTION — SCHOOL DEPARTMENT MODEL

   Represents a department within polytechnics,
   universities, or colleges of education.
   NOT used for primary/secondary schools.

   Named 'SchoolDepartment' (not 'Department') to
   avoid collision with the main platform's CBT
   Department model — established naming rule from
   Phase A architecture decisions.

   FUTURE INTEGRATION:
   - Structure routes: full CRUD
   - Score Entry (Phase L): departmentId context
   - Timetable (Phase N): department-level scheduling
============================================ */
'use strict';

const mongoose = require('mongoose');

const schoolDepartmentSchema = new mongoose.Schema(
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
      /* e.g. "Computer Science", "Electrical Engineering" */
    },

    code: {
      type:    String,
      default: '',
      trim:    true
      /* e.g. "CSC", "EEE" */
    },

    /* ---- Faculty (for universities) ---- */
    faculty: {
      type:    String,
      default: ''
      /* e.g. "Faculty of Engineering", "Science Faculty" */
    },

    /* ---- Description ---- */
    description: {
      type:    String,
      default: ''
    },

    /* ---- Head of Department ---- */
    hodId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'SchoolUser',
      default: null
    },

    /* ---- Status ---- */
    isActive: {
      type:    Boolean,
      default: true
    }
  },
  { timestamps: true }
);

schoolDepartmentSchema.index({ schoolId: 1 });
schoolDepartmentSchema.index({ schoolId: 1, name: 1 });
schoolDepartmentSchema.index(
  { schoolId: 1, name: 1 },
  { unique: true }
);

module.exports = mongoose.model('SchoolDepartment', schoolDepartmentSchema);