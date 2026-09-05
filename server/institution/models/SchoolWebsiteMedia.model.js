'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP — SCHOOL WEBSITE MEDIA (E8A)
   
   Media library for each school's website.
   Binary content NEVER stored in MongoDB.
   storageRef = Cloudinary public_id or local path.
   url = public CDN/server URL for rendering.
   
   Every record stamped with schoolId from JWT.
   School A cannot access School B's media.
============================================ */
var schoolWebsiteMediaSchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true
  },

  /* Original upload metadata */
  originalName:  { type: String, default: '' },
  filename:      { type: String, default: '' },   /* sanitized */
  mimeType:      { type: String, required: true },
  fileSize:      { type: Number, required: true },  /* bytes */
  width:         { type: Number, default: null },
  height:        { type: Number, default: null },

  /* Storage reference — never store binary in Mongo */
  storageProvider: {
    type:     String,
    enum:     ['cloudinary', 'local'],
    required: true
  },
  storageRef:    { type: String, required: true },  /* Cloudinary public_id or path */
  url:           { type: String, required: true },  /* public CDN or server URL */
  thumbnailUrl:  { type: String, default: '' },
  secureUrl:     { type: String, default: '' },

  /* Display metadata */
  altText:      { type: String, default: '' },
  caption:      { type: String, default: '' },
  usageContext: {
    type:    String,
    enum:    ['logo', 'favicon', 'gallery', 'news', 'staff', 'hero', 'general', 'event'],
    default: 'general'
  },

  /* Visibility */
  isPublic:  { type: Boolean, default: true },
  /* Soft delete — referenced media never hard-deleted */
  isActive:  { type: Boolean, default: true },
  deletedAt: { type: Date,    default: null },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },

  uploadedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
  uploadedByName: { type: String, default: '' }

}, { timestamps: true });

schoolWebsiteMediaSchema.index({ schoolId: 1, isActive: 1, usageContext: 1 });
schoolWebsiteMediaSchema.index({ schoolId: 1, createdAt: -1 });
schoolWebsiteMediaSchema.index({ storageRef: 1 }, { sparse: true });

module.exports = mongoose.model('SchoolWebsiteMedia', schoolWebsiteMediaSchema);