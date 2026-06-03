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

    /* ✅ FIX: Which exam category this department belongs to */
    examCategory: {
      type:     String,
      enum:     ['jamb', 'waec', 'neco', 'post-utme', 'practice'],
      required: [true, 'Exam category is required']
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