/* ============================================
   LATLOMP PLATFORM — TEACHER EXAM MODEL
   ============================================
   This stores exams created by teachers.
   
   Key difference from the CBT exam system:
   - Teachers set their OWN exam code manually
   - Students use this code to enter the exam
   - Supports Objective, Theory, or Both types
   ============================================ */

const mongoose = require('mongoose');

const teacherExamSchema = new mongoose.Schema(
  {
    // Which teacher created this exam
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Teacher ID is required']
    },

    // Basic exam info
    title: {
      type: String,
      required: [true, 'Exam title is required'],
      trim: true,
      maxlength: [100, 'Title cannot exceed 100 characters']
    },

    subject: {
      type: String,
      required: [true, 'Subject is required'],
      trim: true
    },

    // Type of exam
    examType: {
      type: String,
      enum: ['objective', 'theory', 'both'],
      required: [true, 'Exam type is required']
    },

    // How long students have (in minutes)
    duration: {
      type: Number,
      required: [true, 'Duration is required'],
      min: [1, 'Duration must be at least 1 minute']
    },

    // THE EXAM CODE — teacher types this manually
    // Students use this exact code to enter the exam
    examCode: {
      type: String,
      required: [true, 'Exam code is required'],
      unique: true,              // No two exams can share the same code
      uppercase: true,           // Always stored as uppercase (e.g. MATH2025)
      trim: true,
      minlength: [4,  'Exam code must be at least 4 characters'],
      maxlength: [20, 'Exam code cannot exceed 20 characters'],
      match: [
        /^[A-Z0-9]+$/,
        'Exam code can only contain letters and numbers (no spaces)'
      ]
    },

    // Optional instructions shown to students
    instructions: {
      type: String,
      default: 'Read all questions carefully before answering.',
      maxlength: [500, 'Instructions cannot exceed 500 characters']
    },

    // Pass mark percentage
    passMark: {
      type: Number,
      default: 50,
      min: 0,
      max: 100
    },

    // Is this exam open for students to access?
    isActive: {
      type: Boolean,
      default: true
    },

    // Track how many students attempted this exam
    totalAttempts: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true // adds createdAt and updatedAt automatically
  }
);

const TeacherExam = mongoose.model('TeacherExam', teacherExamSchema);
module.exports = TeacherExam;