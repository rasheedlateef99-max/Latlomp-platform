/* ============================================
   LATLOMP PLATFORM — RESULT MODEL
   
   Stores results for both:
   - Legacy exam system (examId populated)
   - New CBT system (examCategory populated)
   
   Both examId and examCategory are optional
   so both systems can save without validation errors.
============================================ */
const mongoose = require('mongoose');

/* Single graded answer */
const gradedAnswerSchema = new mongoose.Schema({
  questionId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Question', default: null },
  question:      { type: String, default: '' },
  options:       [String],
  userAnswer:    { type: mongoose.Schema.Types.Mixed, default: null },
  correctAnswer: { type: Number, default: 0 },
  isCorrect:     { type: Boolean, default: false },
  explanation:   { type: String, default: '' },
  subjectId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', default: null }
}, { _id: false });

const resultSchema = new mongoose.Schema(
  {
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'User ID is required']
    },

    /* Legacy system — populated when using old exam flow */
    examId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Exam',
      default: null
    },

    /* New CBT system — populated when using dept/subject flow */
    examCategory: {
      type:    String,
      enum:    ['jamb', 'waec', 'neco', 'post-utme', 'practice', 'custom', ''],
      default: ''
    },

    examTitle:   { type: String, default: '' },
    examType:    { type: String, default: '' },
    examSubject: { type: String, default: '' },

    score:          { type: Number, default: 0,  min: 0 },
    totalQuestions: { type: Number, default: 0,  min: 0 },
    scorePercent:   { type: Number, default: 0,  min: 0, max: 100 },
    passMark:       { type: Number, default: 50, min: 0, max: 100 },
    isPassed:       { type: Boolean, default: false },

    timeTaken:     { type: Number, default: 0 }, /* seconds */
    timeAllowed:   { type: Number, default: 0 }, /* seconds */
    wasAutoSubmit: { type: Boolean, default: false },

    answers: {
      type:    [gradedAnswerSchema],
      default: []
    }
  },
  { timestamps: true }
);

/* Indexes for fast history queries */
resultSchema.index({ userId: 1, createdAt: -1 });
resultSchema.index({ examId: 1 });

module.exports = mongoose.model('Result', resultSchema);