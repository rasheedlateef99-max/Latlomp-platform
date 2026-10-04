'use strict';
/* ============================================
   LATLOMP — SCHOOL CONVERSATION (P10-A3)

   One document = one thread, linked to a claim
   via contextType + contextId.

   SchoolMessage (E7 parent↔teacher) is preserved
   untouched — this is a separate model.

   senderType enum: 'parent' | 'student' | 'staff'
   Tenant: schoolId enforced on every query.
   contextId verified to belong to same school
   before any read or write.
============================================ */
const mongoose = require('mongoose');

var threadEntrySchema = new mongoose.Schema({
  senderId:   { type: mongoose.Schema.Types.ObjectId, required: true },
  senderType: { type: String, enum: ['parent','student','staff'], required: true },
  senderName: { type: String, default: '' },
  body:       { type: String, required: true, trim: true, maxlength: 2000 },
  sentAt:     { type: Date, default: Date.now }
}, { _id: true });

const schoolConversationSchema = new mongoose.Schema({
  /* ---- Tenant ---- */
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School', required: true
  },
  /* ---- Context link ---- */
  contextType: {
    type: String, enum: ['payment_claim','general'], default: 'payment_claim'
  },
  contextId: { type: mongoose.Schema.Types.ObjectId, default: null },
  /* ---- Metadata ---- */
  subject:         { type: String, default: '', trim: true, maxlength: 200 },
  status:          { type: String, enum: ['open','closed','resolved'], default: 'open' },
  initiatedBy:     { type: mongoose.Schema.Types.ObjectId, required: true },
  initiatedByType: { type: String, enum: ['parent','student','staff'], required: true },
  /* ---- Thread ---- */
  thread:        { type: [threadEntrySchema], default: [] },
  lastMessageAt: { type: Date, default: Date.now },
  lastMessageBy: { type: String, enum: ['parent','student','staff'], default: 'staff' }
}, { timestamps: true });

/* Primary access: find conversation by claim */
schoolConversationSchema.index({ schoolId: 1, contextType: 1, contextId: 1 });
schoolConversationSchema.index({ schoolId: 1, initiatedBy: 1, status: 1 });
schoolConversationSchema.index({ schoolId: 1, lastMessageAt: -1 });

module.exports = mongoose.model('SchoolConversation', schoolConversationSchema);