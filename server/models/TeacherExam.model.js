/* ============================================
   LATLOMP PLATFORM — TEACHER EXAM MODEL
   
   ✅ CBT UPGRADE CHANGES:
   - examYear added (e.g. 2025)
   - activatesAt added (code not valid before this)
   - expiresAt added (code not valid after this)
============================================ */
const mongoose = require('mongoose');

const teacherExamSchema = new mongoose.Schema(
  {
    teacherId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'Teacher ID is required']
    },

    title: {
      type:     String,
      required: [true, 'Exam title is required'],
      trim:     true,
      maxlength:[100, 'Title cannot exceed 100 characters']
    },

    subject: {
      type:     String,
      required: [true, 'Subject is required'],
      trim:     true
    },

    examType: {
      type:     String,
      enum:     ['objective', 'theory', 'both'],
      required: [true, 'Exam type is required']
    },

    duration: {
      type:     Number,
      required: [true, 'Duration is required'],
      min:      [1, 'Duration must be at least 1 minute']
    },

    /* ✅ NEW: Dedicated year field */
    examYear: {
      type:    Number,
      default: function() { return new Date().getFullYear(); }
    },

    examCode: {
      type:     String,
      required: [true, 'Exam code is required'],
      unique:   true,
      uppercase:true,
      trim:     true,
      minlength:[4,  'Exam code must be at least 4 characters'],
      maxlength:[20, 'Exam code cannot exceed 20 characters'],
      match:    [/^[A-Z0-9]+$/, 'Exam code can only contain letters and numbers']
    },

    instructions: {
      type:     String,
      default:  'Read all questions carefully before answering.',
      maxlength:[500, 'Instructions cannot exceed 500 characters']
    },

    passMark: {
      type:    Number,
      default: 50,
      min:     0,
      max:     100
    },

    isActive: {
      type:    Boolean,
      default: true
    },

    /* ✅ NEW: Activation window.
       Students cannot use the code before activatesAt
       or after expiresAt. Both are optional — null
       means no restriction in that direction. */
    activatesAt: {
      type:    Date,
      default: null
      /* Example: new Date('2025-06-10T14:00:00') */
    },

    expiresAt: {
      type:    Date,
      default: null
      /* Example: new Date('2025-06-10T14:30:00') */
    },

    totalAttempts: {
      type:    Number,
      default: 0
    }
  },
  { timestamps: true }
);

teacherExamSchema.index({ teacherId: 1 });
teacherExamSchema.index({ examCode: 1 });

const TeacherExam = mongoose.model('TeacherExam', teacherExamSchema);
module.exports = TeacherExam;