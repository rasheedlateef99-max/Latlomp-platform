/* ============================================
   LATLOMP PLATFORM — SUBJECT MODEL
   
   A subject belongs to a department and holds
   questions. Admin sets time limit, question
   count, and instructions per subject.
   
   Examples:
     Science → Mathematics, Physics, Chemistry
     Commercial → Economics, Accounting, Commerce
============================================ */
const mongoose = require("mongoose");

const subjectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Subject name is required"],
      trim: true,
    },

    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: [true, "Department is required"],
    },

   /* ✅ STAGE 6: Enum replaced by dynamic ExamType collection.
       Any valid ExamType.key values are accepted. */
    examCategories: {
      type:    [String],
      default: ['all']
    },

    /* Time limit IN MINUTES for this subject in an exam */
    timeLimit: {
      type: Number,
      default: 30,
      min: 1,
    },

    /* How many questions to pull per session */
    questionCount: {
      type: Number,
      default: 40,
      min: 1,
    },

    instructions: {
      type: String,
      default: "",
      trim: true,
    },

    totalQuestions: {
      type: Number,
      default: 0,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    /* ✅ FINAL STEP: Component-level ON/OFF controls.
       Admin decides which examination components are available
       to CBT students for this subject.
       Institution and Teacher systems ignore these — they use
       their own exam.examType to determine components. */
    objectiveEnabled: {
      type:    Boolean,
      default: true
    },
    theoryEnabled: {
      type:    Boolean,
      default: false
    },
    /* Questions per session for each component.
       Used when both components are enabled.
       Falls back to questionCount / blueprint if not set. */
    objectiveCount: {
      type:    Number,
      default: 40,
      min:     1
    },
    theoryCount: {
      type:    Number,
      default: 5,
      min:     1
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

/* Compound index: unique subject name per department */
subjectSchema.index({ name: 1, department: 1 }, { unique: true });

module.exports = mongoose.model("Subject", subjectSchema);
