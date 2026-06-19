/* ============================================
   LATLOMP INSTITUTION — SCHOOL CLASS MODEL

   Represents an academic class/level/group
   within a school. One school can have many
   classes. Every class is strictly isolated
   to its school via schoolId.

   SUPPORTS ALL INSTITUTION TYPES:
   Primary/Secondary:  Primary 1, JSS1, SS2
   University:         100 Level, 200 Level
   Polytechnic/HND:    ND1, ND2, HND1, HND2
   Vocational:         Year 1, Year 2

   STREAM SUPPORT:
   A class can have streams (arms) e.g. JSS1A,
   JSS1B, JSS1C stored via the arm field.
   Alternatively each stream is its own document
   (JSS1A as a class with category jss).

   FUTURE INTEGRATION:
   - Timetable (Phase N): classId on each slot
   - Attendance (Phase O): classId on each record
   - Score Entry (Phase L): classId on SchoolScore
   - Report Cards (Phase M): classId on report
   - Promotions (Phase S): classHistory uses classId
   - Phase A structure routes: already reference this

   🐛 BUG FIX CONTEXT:
   This file was referenced as 'SchoolClass' in
   SchoolExam, SchoolStudent, SchoolUser models
   but was never created, crashing the server when
   inst.student.mgmt.routes.js tried to import it.
============================================ */
'use strict';

const mongoose = require('mongoose');

const schoolClassSchema = new mongoose.Schema(
  {
    /* ---- Tenant isolation (MANDATORY) ---- */
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
      /* e.g. "JSS1", "Primary 3", "SS2A", "100 Level", "ND1" */
    },

    /* ---- Category
       Used to group classes by level for structure
       generation, report card formatting, and timetable.
    ---- */
    category: {
      type: String,
      enum: [
        'primary',   /* Primary 1 – Primary 6 */
        'jss',       /* Junior Secondary School */
        'sss',       /* Senior Secondary School */
        'nd',        /* National Diploma */
        'hnd',       /* Higher National Diploma */
        'level',     /* University level e.g. 100, 200 */
        'year',      /* Year-based e.g. Year 1, Year 2 */
        'other'      /* Any other type */
      ],
      default: 'other'
    },

    /* ---- Stream / Arm
       Optional — for schools that split one class
       into multiple streams e.g. JSS1A, JSS1B.
       If populated, name should include the arm
       (e.g. "JSS1A") for clarity.
    ---- */
    arm: {
      type:    String,
      default: ''
      /* e.g. "A", "B", "C", "Science", "Art" */
    },

    /* ---- Form / Class Teacher
       The SchoolUser assigned as form teacher.
       Optional — a class can exist without one.
    ---- */
    formTeacherId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'SchoolUser',
      default: null
    },

    /* ---- Display ---- */
    sortOrder: {
      type:    Number,
      default: 0
      /* Lower = appears first in lists.
         Generated classes use 10, 20, 30... spacing */
    },

    /* ---- Capacity ---- */
    capacity: {
      type:    Number,
      default: 0
      /* 0 = unlimited. Set to enforce max students. */
    },

    /* ---- Status ---- */
    isActive: {
      type:    Boolean,
      default: true
    }
  },
  { timestamps: true }
);

/* ============================================
   INDEXES
   schoolId is always first — every query on
   this model must include schoolId to guarantee
   multi-school data isolation.
============================================ */
schoolClassSchema.index({ schoolId: 1 });
schoolClassSchema.index({ schoolId: 1, name: 1 });
schoolClassSchema.index({ schoolId: 1, category: 1 });
schoolClassSchema.index({ schoolId: 1, isActive: 1 });
schoolClassSchema.index({ schoolId: 1, sortOrder: 1 });

/* Compound unique: one class name per school
   (sparse: false because name is required) */
schoolClassSchema.index(
  { schoolId: 1, name: 1 },
  { unique: true }
);

module.exports = mongoose.model('SchoolClass', schoolClassSchema);