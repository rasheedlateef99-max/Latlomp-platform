/* ============================================
   LATLOMP INSTITUTION — CLASS MODEL
   
   Represents a class or level within a school.
   Examples:
     Primary school:  Primary 1, Primary 2A
     Secondary:       JSS1, JSS2B, SSS3A
     Polytechnic:     ND1, HND2
     University:      100 Level, 200 Level
   
   Every class is tenant-isolated by schoolId.
   Future modules (attendance, timetable, fees)
   will reference classId from this model.
============================================ */
const mongoose = require('mongoose');

const classSchema = new mongoose.Schema(
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
      /* e.g. "JSS1", "SS2A", "Primary 3B", "100 Level" */
    },

    /* Base level without arm — used for grouping */
    level: {
      type:    String,
      default: '',
      trim:    true
      /* e.g. "JSS1" (base) when name is "JSS1A" */
    },

    /* Class arm / stream */
    arm: {
      type:    String,
      default: '',
      trim:    true
      /* e.g. "A", "B", "Gold", "Science" */
    },

    /* Category helps with ordering and filtering */
    category: {
      type:    String,
      enum:    ['primary', 'jss', 'sss', 'nd', 'hnd', 'year', 'level', 'other'],
      default: 'other'
    },

    /* ---- Assignments ---- */
    /* Class/Form teacher for this class */
    formTeacherId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'SchoolUser',
      default: null
    },

    /* Department this class belongs to (poly/uni) */
    departmentId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Department',
      default: null
    },

    /* ---- Settings ---- */
    capacity:  { type: Number, default: 0 },  /* 0 = unlimited */
    isActive:  { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 }

    /*
      Future fields to add when modules are built:
      timetableId, subjectIds, attendanceEnabled, etc.
      The schoolId index means adding them later is safe.
    */
  },
  { timestamps: true }
);

/* Indexes for fast tenant-scoped queries */
classSchema.index({ schoolId: 1, isActive: 1 });
classSchema.index({ schoolId: 1, category: 1, sortOrder: 1 });
classSchema.index({ schoolId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('SchoolClass', classSchema);