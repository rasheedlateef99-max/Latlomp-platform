/* ============================================
   LATLOMP PLATFORM — ACTIVITY LOG MODEL
   ============================================
   
   This model records important actions that
   happen in the system.
   
   Think of it as a diary that automatically
   writes down what everyone did and when.
   
   ONLY logs actions from logged-in users:
   - Teachers (creating exams, adding questions)
   - Students (submitting exams)
   - Admins (managing data)
   
   Anonymous users (not logged in) are NOT tracked.
   ============================================ */

const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema(
  {
    /* ---- WHO did the action ---- */

    // The database ID of the user who did this
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    // Their name (saved here so we still see it even if user is later deleted)
    userName: {
      type: String,
      required: true,
      trim: true
    },

    // Their email
    userEmail: {
      type: String,
      default: ''
    },

    // Their role at the time of the action
    userRole: {
      type: String,
      enum: ['teacher', 'student', 'admin', 'user'],
      required: true
    },

    /* ---- WHAT happened ---- */

    // A short code describing the action type
    // This makes it easy to filter later
    action: {
      type: String,
      enum: [
        // Teacher actions
        'teacher_registered',
        'teacher_logged_in',
        'teacher_exam_created',
        'teacher_exam_updated',
        'teacher_exam_deleted',
        'teacher_question_added',
        'teacher_question_deleted',

        // Student actions
        'student_exam_accessed',   // Student entered exam code
        'student_exam_submitted',  // Student finished and submitted

        // General user actions
        'user_registered',
        'user_logged_in',

        // Admin actions
        'admin_deleted_teacher',
        'admin_deleted_exam',
        'admin_deleted_user'
      ],
      required: true
    },

    // A human-readable sentence describing what happened
    // Example: "Mr. Adebayo created exam 'Mathematics Mid-Term' [MATH2025]"
    description: {
      type: String,
      required: true,
      maxlength: 300
    },

    /* ---- RELATED DATA (optional extra context) ---- */

    // Store any extra relevant details about the event
    metadata: {
      // Related exam info
      examId:    { type: mongoose.Schema.Types.ObjectId, default: null },
      examTitle: { type: String, default: '' },
      examCode:  { type: String, default: '' },

      // For student submissions
      studentName:   { type: String, default: '' },
      scorePercent:  { type: Number, default: null },
      isPassed:      { type: Boolean, default: null },

      // Any other notes
      notes: { type: String, default: '' }
    },

    /* ---- TECHNICAL INFO ---- */

    // Was this action successful?
    // (e.g. if a teacher tried to create an exam with a duplicate code and failed)
    success: {
      type: Boolean,
      default: true
    }
  },
  {
    // Automatically adds createdAt and updatedAt
    timestamps: true
  }
);

/* ============================================
   INDEXES — Makes searching faster
   ============================================ */

// Fast search by user (to see all actions by one teacher)
activityLogSchema.index({ userId: 1 });

// Fast search by action type (to find all submissions)
activityLogSchema.index({ action: 1 });

// Fast search by date (newest first)
activityLogSchema.index({ createdAt: -1 });

/* ============================================
   STATIC HELPER METHOD
   
   Usage:
   await ActivityLog.record({
     userId: teacher._id,
     userName: teacher.name,
     userEmail: teacher.email,
     userRole: 'teacher',
     action: 'teacher_exam_created',
     description: `${teacher.name} created exam "${exam.title}" [${exam.examCode}]`,
     metadata: { examId: exam._id, examTitle: exam.title, examCode: exam.examCode }
   });
   
   We wrap this in try-catch so if logging fails,
   it NEVER crashes the main operation.
   ============================================ */
activityLogSchema.statics.record = async function(data) {
  try {
    await this.create(data);
  } catch (err) {
    // Logging errors should NEVER break the main feature
    // We just silently note the failure
    console.warn('⚠️  Activity log failed (non-critical):', err.message);
  }
};

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);
module.exports = ActivityLog;