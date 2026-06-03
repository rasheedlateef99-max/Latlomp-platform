/* ============================================
   LATLOMP PLATFORM — EXAM MODEL
============================================ */
const mongoose = require("mongoose");

const examSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Exam title is required"],
      trim: true,
    },

    /* Legacy subject field — kept for backward compatibility */
    subject: {
      type: String,
      trim: true,
      default: "",
    },

    /* Exam category for new CBT system */
    examCategory: {
      type: String,
      enum: ["jamb", "waec", "neco", "post-utme", "practice", "custom"],
      default: "custom",
    },

    /* Legacy type field — kept for backward compatibility */
    type: {
      type: String,
      enum: ["jamb", "waec", "neco", "custom", "mock"],
      default: "custom",
    },

    duration: { type: Number, default: 60 },
    passMark: { type: Number, default: 50 },
    totalQuestions: { type: Number, default: 0 },
    totalAttempts: { type: Number, default: 0 },

    /* ✅ FIX: Added 'Mixed' to enum */
    difficulty: {
      type: String,
      enum: ["Easy", "Medium", "Hard", "Mixed"],
      default: "Mixed",
    },

    description: { type: String, default: "" },
    instructions: { type: String, default: "" },
    isActive: { type: Boolean, default: true },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Exam", examSchema);
