/* ============================================
   LATLOMP PLATFORM — STUDENT SUBMISSION MODEL
   ============================================
   Stores a student's completed exam attempt.
   
   Note: Students DON'T need a full account.
   They only need a name and valid exam code.
   This model saves everything about their attempt.
   ============================================ */

const mongoose = require('mongoose');

const studentSubmissionSchema = new mongoose.Schema(
  {
    // Student's name (entered at login — no account needed)
    studentName: {
      type: String,
      required: [true, 'Student name is required'],
      trim: true
    },

    // Which exam they took
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TeacherExam',
      required: true
    },

    // Snapshot of exam title (saved here in case exam is edited later)
    examTitle:   { type: String, default: '' },
    examSubject: { type: String, default: '' },
    examCode:    { type: String, default: '' },

    // Which teacher's exam this was
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    // ---- THE STUDENT'S ANSWERS ----
    // Array of { questionId, questionText, questionType, studentAnswer, correctAnswer, isCorrect, marks }
    answers: [
      {
        questionId:     { type: mongoose.Schema.Types.ObjectId, ref: 'TeacherQuestion' },
        questionText:   String,
        questionType:   String,     // 'objective' or 'theory'

        // For objective: the index they selected (0,1,2,3)
        // For theory: the text they typed
        studentAnswer: mongoose.Schema.Types.Mixed,

        // For objective only — the correct option index
        correctAnswer:  { type: Number, default: null },

        // For objective: auto-graded. For theory: null (teacher grades manually)
        isCorrect:      { type: Boolean, default: null },

        // Marks awarded for this question
        marksAwarded:   { type: Number, default: 0 },
        totalMarks:     { type: Number, default: 1 }
      }
    ],

    // ---- SCORING ----
    // Objective score (auto-calculated)
    objectiveScore:  { type: Number, default: 0 },
    objectiveTotal:  { type: Number, default: 0 },

    // Theory score (filled by teacher manually — Phase 6+)
    theoryScore:     { type: Number, default: null },
    theoryTotal:     { type: Number, default: 0 },

    // Overall percentage
    scorePercent:    { type: Number, default: 0 },
    isPassed:        { type: Boolean, default: false },

    // ---- TIMING ----
    timeTaken:     { type: Number, default: 0 },   // minutes
    wasAutoSubmit: { type: Boolean, default: false },

    // Submission status
    status: {
      type: String,
      enum: ['submitted', 'graded', 'pending_theory'],
      default: 'submitted'
    }
  },
  {
    timestamps: true
  }
);

// Index for fast teacher queries
studentSubmissionSchema.index({ examId:   1 });
studentSubmissionSchema.index({ teacherId: 1 });

const StudentSubmission = mongoose.model('StudentSubmission', studentSubmissionSchema);
module.exports = StudentSubmission;