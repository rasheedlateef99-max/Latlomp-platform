/* ============================================
   LATLOMP PLATFORM — DEPARTMENT MODEL
   
   Each department belongs to ONE exam category.
   This isolates JAMB/WAEC/NECO/POST-UTME/PRACTICE
   structures from each other.
   
   Example:
     Science (JAMB)    — different from Science (WAEC)
     Commercial (WAEC) — isolated from Commercial (JAMB)
============================================ */
const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema(
  {
    name: {
      type:     String,
      required: [true, 'Department name is required'],
      trim:     true
    },

    /* ✅ STAGE 6: Enum removed — accepts any valid ExamType.key.
       Validated against the ExamType collection at the route level. */
    examCategory: {
      type:      String,
      required:  [true, 'Exam category is required'],
      lowercase: true,
      trim:      true
    },

    description: {
      type:    String,
      default: '',
      trim:    true
    },

    isActive: {
      type:    Boolean,
      default: true
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User'
    }
  },
  { timestamps: true }
);

/* Unique constraint: same name can exist in different categories */
departmentSchema.index({ name: 1, examCategory: 1 }, { unique: true });

module.exports = mongoose.model('Department', departmentSchema);