'use strict';
const mongoose = require('mongoose');

const linkedStudentSchema = new mongoose.Schema({
  studentId:    { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolStudent', required: true },
  schoolId:     { type: mongoose.Schema.Types.ObjectId, ref: 'School',        required: true },
  relationship: { type: String, enum: ['parent','guardian','other'], default: 'parent' },
  linkedAt:     { type: Date, default: Date.now }
}, { _id: false });

const schoolParentSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone:    { type: String, default: '' },
  avatar:   { type: String, default: '' },
  /* Google OAuth — no password */
  googleId: { type: String, default: '' },

  linkedStudents: { type: [linkedStudentSchema], default: [] },

  isActive:    { type: Boolean, default: true },
  lastLoginAt: { type: Date,    default: null }
}, { timestamps: true });

schoolParentSchema.index({ email:    1 }, { unique: true });
schoolParentSchema.index({ googleId: 1 });
schoolParentSchema.index({ 'linkedStudents.schoolId':  1 });
schoolParentSchema.index({ 'linkedStudents.studentId': 1 });

module.exports = mongoose.model('SchoolParent', schoolParentSchema);