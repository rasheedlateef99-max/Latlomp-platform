'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — ALUMNI MENTORSHIP (E6)
   C2: Alumni can mentor both current students
   AND other alumni. menteeType distinguishes.
   Privacy: menteeStudentId not exposed to alumni
   without proper controls.
============================================ */
const alumniMentorshipSchema = new mongoose.Schema({
  schoolId:       { type: mongoose.Schema.Types.ObjectId, ref: 'School',       required: true },
  mentorAlumniId: { type: mongoose.Schema.Types.ObjectId, ref: 'AlumniProfile', required: true },
  mentorName:     { type: String, default: '' }, /* snapshot */

  /* ---- Mentee can be student OR alumni ---- */
  menteeType:      { type: String, enum: ['student','alumni'], required: true },
  menteeStudentId: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolStudent', default: null },
  menteeAlumniId:  { type: mongoose.Schema.Types.ObjectId, ref: 'AlumniProfile', default: null },
  menteeName:      { type: String, default: '' }, /* snapshot */

  areas:          [String],
  initiatedBy:    { type: String, enum: ['mentor','mentee'], required: true },

  status: {
    type:    String,
    enum:    ['offered','requested','active','completed','cancelled'],
    default: 'requested'
  },

  requestMessage:  { type: String, default: '' },
  responseMessage: { type: String, default: '' },

  startedAt:     { type: Date, default: null },
  completedAt:   { type: Date, default: null },
  cancelledAt:   { type: Date, default: null },
  cancelReason:  { type: String, default: '' },
  cancelledBy:   { type: String, default: '' }, /* 'mentor'|'mentee'|'admin' */

  mentorFeedback: { type: String, default: '' },
  menteeFeedback: { type: String, default: '' }
}, { timestamps: true });

alumniMentorshipSchema.index({ schoolId: 1, mentorAlumniId: 1 });
alumniMentorshipSchema.index({ schoolId: 1, menteeStudentId: 1 });
alumniMentorshipSchema.index({ schoolId: 1, menteeAlumniId: 1 });
alumniMentorshipSchema.index({ schoolId: 1, status: 1 });

module.exports = mongoose.model('AlumniMentorship', alumniMentorshipSchema);