/* ============================================
   LATLOMP PLATFORM — EXAM TYPE MODEL (CBT)

   Dynamic CBT examination types.
   Replaces hardcoded enum values across:
     QMSQuestion.examType
     ExaminationBlueprint.examType
     Subject.examCategories

   BUILT-IN TYPES (seeded on first access):
     jamb, waec, neco, post-utme, practice, all
     isBuiltIn: true — these cannot be deleted.

   CUSTOM TYPES (admin-created):
     scholarship-exam, mock-test, etc.
     isBuiltIn: false — can be deleted when empty.

   KEY FORMAT: lowercase, hyphens (e.g. 'post-utme')
   LABEL:      display name (e.g. 'POST-UTME')
============================================ */
'use strict';

var mongoose = require('mongoose');

var examTypeSchema = new mongoose.Schema(
  {
    key: {
      type:      String,
      required:  true,
      unique:    true,
      trim:      true,
      lowercase: true,
      match:     [/^[a-z0-9-]+$/, 'Key must be lowercase letters, numbers and hyphens only.']
    },

    label: {
      type:     String,
      required: true,
      trim:     true
    },

    description: {
      type:    String,
      default: '',
      trim:    true
    },

    icon: {
      type:    String,
      default: '📝'
    },

    isActive: {
      type:    Boolean,
      default: true,
      index:   true
    },

    /* Built-in types (jamb, waec, neco, post-utme, practice, all)
       cannot be deleted — they underpin existing data. */
    isBuiltIn: {
      type:    Boolean,
      default: false
    },

    sortOrder: {
      type:    Number,
      default: 0
    },

    createdBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'User',
      default: null
    }
  },
  { timestamps: true }
);

examTypeSchema.index({ isActive: 1, sortOrder: 1 });

/* ============================================
   STATIC: seedBuiltIn
   Called on first GET /api/exams/types request.
   Idempotent — safe to call repeatedly.
   Does NOT overwrite existing built-in types.
============================================ */
examTypeSchema.statics.seedBuiltIn = async function () {
  var builtIns = [
    { key: 'jamb',     label: 'JAMB',      icon: '🎓', description: 'Joint Admissions and Matriculation Board',    sortOrder: 1 },
    { key: 'waec',     label: 'WAEC',      icon: '📚', description: 'West African Examinations Council',            sortOrder: 2 },
    { key: 'neco',     label: 'NECO',      icon: '🏫', description: 'National Examinations Council',                sortOrder: 3 },
    { key: 'post-utme',label: 'POST-UTME', icon: '🏛️', description: 'Post Unified Tertiary Matriculation Examination',sortOrder: 4 },
    { key: 'practice', label: 'Practice',  icon: '⚡', description: 'Practice examinations and revision',           sortOrder: 5 },
    { key: 'all',      label: 'All Types', icon: '🌐', description: 'Questions available across all examination types', sortOrder: 99 }
  ];

  for (var i = 0; i < builtIns.length; i++) {
    var bt = builtIns[i];
    await this.findOneAndUpdate(
      { key: bt.key },
      { $setOnInsert: Object.assign({ isBuiltIn: true, isActive: true }, bt) },
      { upsert: true, new: false }
    );
  }
};

module.exports = mongoose.model('ExamType', examTypeSchema);