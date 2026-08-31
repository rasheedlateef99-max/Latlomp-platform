'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — SCHOOL MESSAGE (E7)

   D2 confirmed: no existing teacher-parent
   messaging found in parent.routes.js.

   One document = one conversation thread
   concerning a specific student.

   BOTH parties access the same document:
   - Parent: via parentProtect + isLinkedTo()
   - Teacher/Staff: via instProtect + manageGuard

   No duplicate identity. No duplicate messages.
   thread[] is append-only within the document.
   readAt tracks per-message read status.
============================================ */
var messageEntrySchema = new mongoose.Schema({
  senderId:   { type: mongoose.Schema.Types.ObjectId, required: true },
  senderType: { type: String, enum: ['parent','teacher','admin'], required: true },
  senderName: { type: String, default: '' },
  body:       { type: String, required: true, trim: true },
  sentAt:     { type: Date, default: Date.now },
  readAt:     { type: Date, default: null } /* set when OTHER party reads */
}, { _id: false });

const schoolMessageSchema = new mongoose.Schema({
  schoolId:  { type: mongoose.Schema.Types.ObjectId, ref: 'School',       required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolStudent', required: true },
  parentId:  { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolParent',  required: true },

  /* The staff participant (set when staff opens/replies; may be null initially) */
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  teacherName:{ type: String, default: '' },

  subject:     { type: String, default: '', trim: true },
  initiatedBy: { type: String, enum: ['parent','teacher','admin'], required: true },

  status: {
    type:    String,
    enum:    ['open','closed'],
    default: 'open'
  },

  thread:         { type: [messageEntrySchema], default: [] },
  lastMessageAt:  { type: Date, default: Date.now },
  lastMessageBy:  { type: String, default: '' } /* senderType of last message */
}, { timestamps: true });

schoolMessageSchema.index({ schoolId: 1, parentId: 1, status: 1 });
schoolMessageSchema.index({ schoolId: 1, teacherId: 1, status: 1 });
schoolMessageSchema.index({ schoolId: 1, studentId: 1 });
schoolMessageSchema.index({ schoolId: 1, status: 1, lastMessageAt: -1 });

module.exports = mongoose.model('SchoolMessage', schoolMessageSchema);