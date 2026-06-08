/* ============================================
   LATLOMP INSTITUTION — ACADEMIC TERM MODEL
   
   Tracks academic sessions and terms.
   
   Examples:
     Secondary: First Term 2024/2025
     University: First Semester 2024/2025
   
   Only ONE term can be marked as current per school.
   The pre-save hook enforces this automatically.
   
   Exams, results, and reports will reference termId
   for grouping and filtering by academic period.
============================================ */
const mongoose = require('mongoose');

const academicTermSchema = new mongoose.Schema(
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
      /* e.g. "First Term", "Second Semester" */
    },

    session: {
      type:     String,
      required: true,
      trim:     true
      /* e.g. "2024/2025", "2025" */
    },

    term: {
      type:    String,
      enum:    ['first', 'second', 'third', 'semester_1', 'semester_2', 'trimester_1', 'trimester_2', 'trimester_3', 'other'],
      default: 'first'
    },

    /* ---- Schedule ---- */
    startDate: { type: Date, default: null },
    endDate:   { type: Date, default: null },

    /* ---- Status ---- */
    isCurrent: { type: Boolean, default: false },
    isActive:  { type: Boolean, default: true }
  },
  { timestamps: true }
);

academicTermSchema.index({ schoolId: 1, isCurrent: 1 });
academicTermSchema.index({ schoolId: 1, session: 1, term: 1 });

/*
  Enforce single current term per school.
  When a term is set as current, all others for
  that school are automatically unset.
*/
academicTermSchema.pre('save', async function(next) {
  if (this.isCurrent && this.isModified('isCurrent')) {
    await this.constructor.updateMany(
      { schoolId: this.schoolId, _id: { $ne: this._id } },
      { $set: { isCurrent: false } }
    );
  }
  next();
});

module.exports = mongoose.model('AcademicTerm', academicTermSchema);