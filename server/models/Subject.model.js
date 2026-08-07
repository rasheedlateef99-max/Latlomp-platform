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
