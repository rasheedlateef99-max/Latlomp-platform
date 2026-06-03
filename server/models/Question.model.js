/* ============================================
   LATLOMP PLATFORM — QUESTION MODEL
   
   Questions belong to BOTH:
   - examId   (legacy system — keeps working)
   - subjectId (new CBT system)
   
   Both fields are optional so existing data
   is never broken.
============================================ */
const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema(
  {
    /* Legacy: question belongs to an exam (old system) */
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Exam",
      default: null,
    },

    /* New CBT: question belongs to a subject */
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      default: null,
    },

    question: {
      type: String,
      required: [true, "Question text is required"],
      trim: true,
    },

    options: {
      type: [String],
      required: [true, "Options are required"],
      validate: {
        validator: function (v) {
          return v && v.length >= 2;
        },
        message: "At least 2 options are required",
      },
    },

    correctAnswer: {
      type: Number,
      required: [true, "Correct answer index is required"],
      min: 0,
    },

    explanation: {
      type: String,
      default: "",
      trim: true,
    },

    /* Which exam category this question is for */
    examCategory: {
      type: String,
      enum: ["jamb", "waec", "neco", "post-utme", "practice", "all"],
      default: "all",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    /* Statistics */
    timesAnswered: { type: Number, default: 0 },
    timesCorrect: { type: Number, default: 0 },
  },
  { timestamps: true },
);

/* Index for fast subject-based question fetching */
questionSchema.index({ subjectId: 1, isActive: 1 });
questionSchema.index({ examId: 1, isActive: 1 });

module.exports = mongoose.model("Question", questionSchema);
