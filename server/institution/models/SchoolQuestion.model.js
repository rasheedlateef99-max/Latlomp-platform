/* ============================================
   LATLOMP INSTITUTION — SCHOOL QUESTION MODEL

   ✅ PHASE G: tableHtml + audioUrl added
============================================ */
const mongoose = require('mongoose');

const schoolQuestionSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School',     required: true },
    examId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolExam', required: true },

    questionType: {
      type:    String,
      enum:    ['objective', 'theory', 'fill_in_blank', 'true_false'],
      default: 'objective'
    },

    question:      { type: String, required: true },
    options:       [String],
    correctAnswer: { type: Number, default: 0 },
    explanation:   { type: String, default: '' },

    /* Theory question fields */
    modelAnswer: { type: String, default: '' },
    markScheme:  { type: String, default: '' },

    /* ✅ PHASE G: Rich content fields */
    imageUrl:  { type: String, default: '' },   /* already existed */
    tableHtml: { type: String, default: '' },   /* NEW — HTML table string */
    audioUrl:  { type: String, default: '' },   /* NEW — mp3/wav/ogg URL */

    marks:     { type: Number, default: 1 },
    difficulty:{ type: String, enum: ['easy','medium','hard'], default: 'medium' },
    topic:     { type: String, default: '' },
    isActive:  { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 }
  },
  { timestamps: true }
);

schoolQuestionSchema.index({ examId: 1, isActive: 1 });
schoolQuestionSchema.index({ schoolId: 1 });

module.exports = mongoose.model('SchoolQuestion', schoolQuestionSchema);