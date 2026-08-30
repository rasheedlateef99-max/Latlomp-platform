'use strict';
const mongoose = require('mongoose');

const alumniAnnouncementSchema = new mongoose.Schema({
  schoolId:  { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  title:     { type: String, required: true, trim: true },
  body:      { type: String, required: true },
  visibility:{ type: String, enum: ['alumni_only','all'], default: 'alumni_only' },
  status:    { type: String, enum: ['draft','published','archived'], default: 'draft' },
  priority:  { type: String, enum: ['normal','urgent'], default: 'normal' },
  publishedAt:     { type: Date, default: null },
  expiresAt:       { type: Date, default: null },
  createdBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
  createdByName:   { type: String, default: '' },
  publishedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  publishedByName: { type: String, default: '' }
}, { timestamps: true });

alumniAnnouncementSchema.index({ schoolId: 1, status: 1, publishedAt: -1 });
alumniAnnouncementSchema.index({ schoolId: 1, expiresAt: 1 });

module.exports = mongoose.model('AlumniAnnouncement', alumniAnnouncementSchema);