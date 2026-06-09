/* ============================================
   LATLOMP INSTITUTION — SCHOOL EXAM MODEL
   
   ✅ CBT UPGRADE CHANGES:
   - examYear added (e.g. 2025)
   - scheduledStart/scheduledEnd now ENFORCED
     in student route (not just stored)
   - shuffleOptions re-enabled with safe
     per-session index mapping approach
============================================ */
const mongoose = require('mongoose');

const schoolExamSchema = new mongoose.Schema(
  {
    schoolId:  { type: mongoose.Schema.Types.ObjectId, ref: 'School',     required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },

    /* ---- Identity ---- */
    title:   { type: String, required: true, trim: true },
    subject: { type: String, required: true },
    class:   { type: String, default: '' },
    term:    { type: String, enum: ['first','second','third',''], default: '' },
    session: { type: String, default: '' },

    /* ✅ NEW: Dedicated exam year field */
    examYear: {
      type:    Number,
      default: function() { return new Date().getFullYear(); }
    },

    /* ---- Phase A structure refs ---- */
    classId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolClass',   default: null },
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolSubject', default: null },
    termId:    { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicTerm',  default: null },

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
    duration:         { type: Number,  default: 60 },
    totalQuestions:   { type: Number,  default: 0 },
    totalMarks:       { type: Number,  default: 100 },
    passMark:         { type: Number,  default: 50 },
    shuffleQuestions: { type: Boolean, default: true },

    /* ✅ FIXED: shuffleOptions re-enabled.
       Options are shuffled per-student session.
       The shuffled index mapping is embedded in
       the session token so correct answer lookup
       always uses the original DB index. */
    shuffleOptions: { type: Boolean, default: false },

    showResultsAfter: { type: Boolean, default: false },
    allowLateEntry:   { type: Boolean, default: false },

    /* ---- ✅ Activation window ----
       Students CANNOT use the access code outside
       this window. Both are optional — if null the
       exam is open from publish until manually ended.
    ---- */
    scheduledStart: { type: Date, default: null },
    scheduledEnd:   { type: Date, default: null },

    /* ---- Status ---- */
    status: {
      type:    String,
      enum:    ['draft', 'published', 'active', 'ended', 'archived'],
      default: 'draft'
    },

    /* ---- Stats ---- */
    totalAttempts: { type: Number, default: 0 },
    averageScore:  { type: Number, default: 0 },
    highestScore:  { type: Number, default: 0 },
    lowestScore:   { type: Number, default: 0 }
  },
  { timestamps: true }
);

schoolExamSchema.index({ schoolId: 1, status: 1 });
schoolExamSchema.index({ accessCode: 1 });
schoolExamSchema.index({ schoolId: 1, classId: 1 });
schoolExamSchema.index({ schoolId: 1, subjectId: 1 });
schoolExamSchema.index({ schoolId: 1, termId: 1 });

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