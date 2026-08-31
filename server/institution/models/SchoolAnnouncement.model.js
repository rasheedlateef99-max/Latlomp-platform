'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — SCHOOL ANNOUNCEMENT (E7)

   General school-to-audience announcements.
   Separate from AlumniAnnouncement (E6, alumni-only).
   Separate from Announcement.model (tried in parent.routes
   GET /notifications — confirmed does not exist).

   targetAudience: controls which portal sees it.
   GET /notifications in parent.routes will remain
   untouched (returns empty — backward compatible).
   New GET /announcements endpoint uses this model.
============================================ */
const schoolAnnouncementSchema = new mongoose.Schema({
  schoolId:  { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  title:     { type: String, required: true, trim: true },
  body:      { type: String, required: true },

  targetAudience: {
    type:    String,
    enum:    ['all', 'parents', 'students', 'staff'],
    default: 'parents'
  },

  status:   { type: String, enum: ['draft','published','archived'], default: 'draft' },
  priority: { type: String, enum: ['normal','urgent'], default: 'normal' },

  publishedAt:     { type: Date, default: null },
  expiresAt:       { type: Date, default: null },

  createdBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
  createdByName:   { type: String, default: '' },
  publishedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  publishedByName: { type: String, default: '' }
}, { timestamps: true });

schoolAnnouncementSchema.index({ schoolId: 1, status: 1, publishedAt: -1 });
schoolAnnouncementSchema.index({ schoolId: 1, targetAudience: 1, status: 1 });
schoolAnnouncementSchema.index({ schoolId: 1, expiresAt: 1 });

module.exports = mongoose.model('SchoolAnnouncement', schoolAnnouncementSchema);