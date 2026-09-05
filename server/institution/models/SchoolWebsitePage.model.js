'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP — SCHOOL WEBSITE PAGE (E8A)
   
   Structured pages with draft/published content.
   Content stored as plain text/markdown only.
   Raw HTML from schools NEVER stored or rendered.
   
   built_in: about, admissions, contact, alumni
   custom:   school-created pages
============================================ */
var schoolWebsitePageSchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true
  },

  slug:     { type: String, required: true, trim: true, lowercase: true },
  title:    { type: String, required: true, trim: true },
  pageType: {
    type:    String,
    enum:    ['built_in', 'custom'],
    default: 'built_in'
  },

  /* Content as safe plain text/markdown — no raw HTML accepted */
  draftContent:     { type: String, default: '' },
  publishedContent: { type: String, default: '' },

  /* SEO */
  metaTitle: { type: String, default: '' },
  metaDesc:  { type: String, default: '' },

  /* Publication */
  status:       { type: String, enum: ['draft', 'published', 'unpublished'], default: 'draft' },
  isEnabled:    { type: Boolean, default: true },
  displayOrder: { type: Number,  default: 0 },
  showInNav:    { type: Boolean, default: false },

  publishedAt:  { type: Date, default: null },
  publishedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  publishedByName: { type: String, default: '' },
  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
  createdByName:{ type: String, default: '' },
  lastEditedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  lastEditedAt: { type: Date, default: Date.now }

}, { timestamps: true });

schoolWebsitePageSchema.index({ schoolId: 1, slug: 1 }, { unique: true });
schoolWebsitePageSchema.index({ schoolId: 1, status: 1, isEnabled: 1 });
schoolWebsitePageSchema.index({ schoolId: 1, displayOrder: 1 });

module.exports = mongoose.model('SchoolWebsitePage', schoolWebsitePageSchema);