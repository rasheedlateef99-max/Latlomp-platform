/* ============================================
   LATLOMP PLATFORM — TEACHER QUESTION MODEL
   ============================================
   Stores questions for teacher-created exams.
   
   Two question types:
   - objective: multiple choice with correct answer
   - theory: written question, optional expected answer
   ============================================ */

const mongoose = require('mongoose');

const teacherQuestionSchema = new mongoose.Schema(
  {
    // Which exam this question belongs to
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TeacherExam',
      required: [true, 'Exam ID is required']
    },

    // The question type
    questionType: {
      type: String,
      enum: ['objective', 'theory'],
      required: [true, 'Question type is required']
    },

    // The question text
    questionText: {
      type: String,
      required: [true, 'Question text is required'],
      trim: true
    },

    // ---- FOR OBJECTIVE QUESTIONS ONLY ----
    // Array of answer options (e.g. ['Paris', 'London', 'Rome', 'Berlin'])
    options: {
      type: [String],
      default: []
      // Validated in the route, not here, because theory questions have no options
    },

    // Index of the correct option (0 = first, 1 = second, etc.)
    correctAnswer: {
      type: Number,
      default: null   // null for theory questions
    },

    // ---- FOR THEORY QUESTIONS ONLY ----
    // Teacher can optionally type the expected/model answer
    expectedAnswer: {
      type: String,
      default: ''
    },

    // How many marks this question carries
    marks: {
      type: Number,
      default: 1,
      min: 1
    },

    // Question order number (so questions stay in the order teacher added them)
    orderNumber: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

// Index for faster queries when loading all questions for an exam
teacherQuestionSchema.index({ examId: 1, orderNumber: 1 });

const TeacherQuestion = mongoose.model('TeacherQuestion', teacherQuestionSchema);
module.exports = TeacherQuestion;