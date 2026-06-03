/* ============================================
   LATLOMP INSTITUTION — SCHOOL RESULT MODEL
============================================ */
const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema({
  questionId:    { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolQuestion' },
  questionType:  { type: String, default: 'objective' },
  userAnswer:    { type: mongoose.Schema.Types.Mixed, default: null },
  correctAnswer: { type: Number, default: null },
  isCorrect:     { type: Boolean, default: false },
  marksAwarded:  { type: Number, default: 0 },
  marksAvailable:{ type: Number, default: 1 },
  teacherComment:{ type: String, default: '' }
}, { _id: false });

const schoolResultSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    examId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolExam', required: true },

    /* Student — either linked or anonymous */
    studentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolStudent', default: null },
    studentName: { type: String, required: true },
    studentClass:{ type: String, default: '' },
    admissionNo: { type: String, default: '' },

    /* Scores */
    score:          { type: Number, default: 0 },
    totalMarks:     { type: Number, default: 0 },
    scorePercent:   { type: Number, default: 0 },
    passMark:       { type: Number, default: 50 },
    isPassed:       { type: Boolean, default: false },

    /* Objective */
    objectiveScore: { type: Number, default: 0 },
    objectiveTotal: { type: Number, default: 0 },

    /* Theory */
    theoryScore:    { type: Number, default: 0 },
    theoryTotal:    { type: Number, default: 0 },
    theoryMarked:   { type: Boolean, default: false },
    markedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
    markedAt:       { type: Date, default: null },

    /* Timing */
    timeTaken:      { type: Number, default: 0 },
    wasAutoSubmit:  { type: Boolean, default: false },

    /* Answers array */
    answers:        [answerSchema],

    /* Release control */
    isReleased:     { type: Boolean, default: false },
    releasedAt:     { type: Date, default: null },
    releasedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },

    /* Anti-cheat flags */
    tabSwitchCount: { type: Number, default: 0 },
    flaggedForReview: { type: Boolean, default: false },
    flagReason:     { type: String, default: '' }
  },
  { timestamps: true }
);

schoolResultSchema.index({ schoolId: 1, examId: 1 });
schoolResultSchema.index({ examId: 1, studentName: 1 });

module.exports = mongoose.model('SchoolResult', schoolResultSchema);