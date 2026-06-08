/* ============================================
   LATLOMP INSTITUTION — SUBJECT MODEL
   
   Represents a subject/course within a school.
   Examples:
     Secondary: Mathematics, Physics, Chemistry
     University: MTH101, CSC201, ENG301
   
   Subjects can be assigned to specific classes
   and specific teachers.
   
   Future modules (timetable, results, report cards)
   will reference subjectId from this model.
============================================ */
const mongoose = require('mongoose');

const subjectSchema = new mongoose.Schema(
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
      /* e.g. "Mathematics", "Physics", "Arabic Language" */
    },

    /* Course code for tertiary institutions */
    code: {
      type:    String,
      default: '',
      trim:    true,
      uppercase: true
      /* e.g. "MTH101", "CSC201" */
    },

    /* ---- Relationships ---- */
    /* Which classes offer this subject */
    classIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref:  'SchoolClass'
    }],

    /* Department this subject belongs to */
    departmentId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Department',
      default: null
    },

    /* Teachers assigned to this subject */
    teacherIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref:  'SchoolUser'
    }],

    /* ---- Settings ---- */
    isCore:     { type: Boolean, default: true },  /* compulsory vs elective */
    isActive:   { type: Boolean, default: true },
    sortOrder:  { type: Number,  default: 0 }
  },
  { timestamps: true }
);

subjectSchema.index({ schoolId: 1, isActive: 1 });
subjectSchema.index({ schoolId: 1, name: 1 });

module.exports = mongoose.model('SchoolSubject', subjectSchema);