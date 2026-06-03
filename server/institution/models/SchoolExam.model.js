/* ============================================
   LATLOMP INSTITUTION — SCHOOL EXAM MODEL
============================================ */
const mongoose = require('mongoose');

const schoolExamSchema = new mongoose.Schema(
  {
    schoolId:  { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },

    /* ---- Identity ---- */
    title:       { type: String, required: true, trim: true },
    subject:     { type: String, required: true },
    class:       { type: String, default: '' },
    term:        { type: String, enum: ['first','second','third',''], default: '' },
    session:     { type: String, default: '' },   /* e.g. "2024/2025" */

    /* ---- Type ---- */
    examType: {
      type:    String,
      enum:    ['objective', 'theory', 'mixed'],
      default: 'objective'
    },

    /* ---- Access ---- */
    accessCode:   { type: String, required: true, unique: true },
    instructions: { type: String, default: '' },

    /* ---- Settings ---- */
    duration:           { type: Number, default: 60 },    /* minutes */
    totalQuestions:     { type: Number, default: 0 },
    totalMarks:         { type: Number, default: 100 },
    passMark:           { type: Number, default: 50 },
    shuffleQuestions:   { type: Boolean, default: true },
    shuffleOptions:     { type: Boolean, default: false }, /* NOT shuffled to avoid answer index mismatch */
    showResultsAfter:   { type: Boolean, default: false }, /* admin-controlled */
    allowLateEntry:     { type: Boolean, default: false },

    /* ---- Schedule ---- */
    scheduledStart: { type: Date, default: null },
    scheduledEnd:   { type: Date, default: null },

    /* ---- Status ---- */
    status: {
      type:    String,
      enum:    ['draft', 'published', 'active', 'ended', 'archived'],
      default: 'draft'
    },

    /* ---- Stats ---- */
    totalAttempts:    { type: Number, default: 0 },
    averageScore:     { type: Number, default: 0 },
    highestScore:     { type: Number, default: 0 },
    lowestScore:      { type: Number, default: 0 }
  },
  { timestamps: true }
);

schoolExamSchema.index({ schoolId: 1, status: 1 });
schoolExamSchema.index({ accessCode: 1 });

/* Auto-generate access code */
schoolExamSchema.pre('save', function(next) {
  if (!this.accessCode) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var code  = '';
    for (var i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    this.accessCode = code;
  }
  next();
});

module.exports = mongoose.model('SchoolExam', schoolExamSchema);