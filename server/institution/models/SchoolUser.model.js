/* ============================================
   LATLOMP INSTITUTION — SCHOOL USER MODEL
   
   Represents school admins and teachers.
   Separate from main platform User model.
   Multi-tenant: every record scoped to schoolId.
============================================ */
const mongoose = require('mongoose');

const schoolUserSchema = new mongoose.Schema(
  {
    /* ---- Tenant isolation ---- */
    schoolId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'School',
      required: true
    },

    /* ---- Identity ---- */
    name:    { type: String, required: true, trim: true },
    email:   { type: String, required: true, lowercase: true, trim: true },
    phone:   { type: String, default: '' },
    avatar:  { type: String, default: '' },

    /* ---- Role ---- */
    role: {
      type:    String,
      enum:    ['school_admin', 'teacher', 'vice_principal', 'bursar'],
      default: 'teacher'
    },

    /* ---- Teacher-specific ---- */
    subjects:      [String],
    classes:       [String],
    qualification: { type: String, default: '' },
    employeeId:    { type: String, default: '' },

    /* ---- Auth ---- */
    googleId:     { type: String, default: '' },
    authProvider: { type: String, default: 'google' },
    lastLoginAt:  { type: Date, default: null },

    /* ---- Status ---- */
    isActive:     { type: Boolean, default: true },
    isVerified:   { type: Boolean, default: false },

    /* ---- Invitation ---- */
    invitedBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'SchoolUser',
      default: null
    },
    invitedAt:   { type: Date, default: null },
    joinedAt:    { type: Date, default: null }
  },
  { timestamps: true }
);

/* Compound unique: one email per school */
schoolUserSchema.index({ schoolId: 1, email: 1 }, { unique: true });
schoolUserSchema.index({ schoolId: 1, role: 1 });

module.exports = mongoose.model('SchoolUser', schoolUserSchema);