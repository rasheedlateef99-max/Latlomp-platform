/* ============================================
   LATLOMP INSTITUTION — SCHOOL STUDENT MODEL
============================================ */
const mongoose = require('mongoose');

const schoolStudentSchema = new mongoose.Schema(
  {
    schoolId:     { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },

    /* ---- Identity ---- */
    name:         { type: String, required: true, trim: true },
    admissionNo:  { type: String, default: '' },
    class:        { type: String, default: '' },
    arm:          { type: String, default: '' },   /* e.g. "A", "B", "C" */
    gender:       { type: String, enum: ['male','female','other',''], default: '' },
    dateOfBirth:  { type: Date, default: null },

    /* ---- Contact ---- */
    email:        { type: String, default: '', lowercase: true },
    phone:        { type: String, default: '' },
    parentPhone:  { type: String, default: '' },
    address:      { type: String, default: '' },

    /* ---- Auth (optional — for student portals) ---- */
    pinCode:      { type: String, default: '' },  /* 4-6 digit PIN for portal login */

    /* ---- Status ---- */
    isActive:     { type: Boolean, default: true },

    /* ---- Stats ---- */
    totalExamsTaken: { type: Number, default: 0 },
    averageScore:    { type: Number, default: 0 }
  },
  { timestamps: true }
);

schoolStudentSchema.index({ schoolId: 1 });
schoolStudentSchema.index({ schoolId: 1, class: 1 });
schoolStudentSchema.index({ schoolId: 1, admissionNo: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('SchoolStudent', schoolStudentSchema);