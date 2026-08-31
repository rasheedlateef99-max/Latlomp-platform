'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — SCHOOL HOMEWORK (E7)

   D4 confirmed: Teacher creates per class.
   Parent reads for their child's class.
   Every query MUST scope by classId — never
   schoolId alone to prevent class-leakage.

   No existing homework model found in codebase.
   This model genuinely owns new domain data.
============================================ */
const schoolHomeworkSchema = new mongoose.Schema({
  schoolId:    { type: mongoose.Schema.Types.ObjectId, ref: 'School',      required: true },
  classId:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolClass', required: true },
  subjectId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolSubject', default: null },
  termId:      { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicTerm',  default: null },

  title:       { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  instructions:{ type: String, default: '' },

  dueDate:     { type: Date, required: true },

  attachmentUrl:  { type: String, default: '' }, /* optional file/link */
  estimatedMins:  { type: Number, default: null }, /* optional time estimate */

  status: {
    type:    String,
    enum:    ['active','completed','cancelled'],
    default: 'active'
  },

  /* Snapshot for display without extra population */
  subjectName: { type: String, default: '' },
  className:   { type: String, default: '' },

  assignedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
  assignedByName: { type: String, default: '' }
}, { timestamps: true });

/* Primary scope indexes — classId always included */
schoolHomeworkSchema.index({ schoolId: 1, classId: 1, status: 1 });
schoolHomeworkSchema.index({ schoolId: 1, classId: 1, dueDate: 1 });
schoolHomeworkSchema.index({ schoolId: 1, classId: 1, termId: 1 });
schoolHomeworkSchema.index({ schoolId: 1, assignedBy: 1 });

module.exports = mongoose.model('SchoolHomework', schoolHomeworkSchema);