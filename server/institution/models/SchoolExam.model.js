/* ============================================
   LATLOMP INSTITUTION — SCHOOL EXAM MODEL
   
   ✅ PHASE A CHANGES:
   - classId added (optional ref to SchoolClass)
   - subjectId added (optional ref to SchoolSubject)
   - termId added (optional ref to AcademicTerm)
   All three are nullable — existing exams not broken.
============================================ */
const mongoose = require('mongoose');

const schoolExamSchema = new mongoose.Schema(
  {
    schoolId:  { type: mongoose.Schema.Types.ObjectId, ref: 'School',     required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },

    /* ---- Identity ---- */
    title:       { type: String, required: true, trim: true },
    subject:     { type: String, required: true },
    class:       { type: String, default: '' },
    term:        { type: String, enum: ['first','second','third',''], default: '' },
    session:     { type: String, default: '' },

    /* ---- ✅ PHASE A: Structured references (all optional) ---- */
    classId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'SchoolClass',
      default: null
      /* Links to the Class model. Old exams with class as plain
         string remain valid. New exams can reference the model. */
    },

    subjectId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'SchoolSubject',
      default: null
      /* Links to the Subject model. Old exams with subject as plain
         string remain valid. New exams can reference the model. */
    },

    termId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'AcademicTerm',
      default: null
      /* Links to the AcademicTerm model. Allows grouping
         all exams by term for reports and analytics. */
    },

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
    duration:           { type: Number,  default: 60 },
    totalQuestions:     { type: Number,  default: 0 },
    totalMarks:         { type: Number,  default: 100 },
    passMark:           { type: Number,  default: 50 },
    shuffleQuestions:   { type: Boolean, default: true },
    shuffleOptions:     { type: Boolean, default: false },
    showResultsAfter:   { type: Boolean, default: false },
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
    totalAttempts: { type: Number, default: 0 },
    averageScore:  { type: Number, default: 0 },
    highestScore:  { type: Number, default: 0 },
    lowestScore:   { type: Number, default: 0 }
  },
  { timestamps: true }
);

schoolExamSchema.index({ schoolId: 1, status: 1 });
schoolExamSchema.index({ accessCode: 1 });
/* ✅ PHASE A: New indexes for structure-based filtering */
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