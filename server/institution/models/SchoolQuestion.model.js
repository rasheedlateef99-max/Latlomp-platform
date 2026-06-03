/* ============================================
   LATLOMP INSTITUTION — SCHOOL QUESTION MODEL
============================================ */
const mongoose = require('mongoose');

const schoolQuestionSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    examId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolExam', required: true },

    questionType: {
      type:    String,
      enum:    ['objective', 'theory', 'fill_in_blank', 'true_false'],
      default: 'objective'
    },

    question:     { type: String, required: true },
    options:      [String],           /* for objective */
    correctAnswer:{ type: Number, default: 0 },  /* index of correct option */
    explanation:  { type: String, default: '' },

    /* Theory question fields */
    modelAnswer:  { type: String, default: '' },
    markScheme:   { type: String, default: '' },

    marks:        { type: Number, default: 1 },
    difficulty:   { type: String, enum: ['easy','medium','hard'], default: 'medium' },
    topic:        { type: String, default: '' },
    imageUrl:     { type: String, default: '' },
    isActive:     { type: Boolean, default: true },
    sortOrder:    { type: Number, default: 0 }
  },
  { timestamps: true }
);

schoolQuestionSchema.index({ examId: 1, isActive: 1 });
schoolQuestionSchema.index({ schoolId: 1 });

module.exports = mongoose.model('SchoolQuestion', schoolQuestionSchema);