'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP — SCHOOL WEBSITE POST (E8A)
   
   PUBLIC-FACING website news/articles.
   Semantically DISTINCT from SchoolAnnouncement (E7A):
   
   SchoolAnnouncement:
     - Internal school communication
     - Targets authenticated portal users (parents/staff/students)
     - No public URL, no SEO metadata, no featured image URL
     - audience: parents|students|staff|all (all = portal users)
   
   SchoolWebsitePost:
     - Public internet-facing content
     - Accessible to anyone at /school/:slug/news/:postSlug
     - Has URL slug, SEO metadata, featured image, byline
     - status: draft|published|archived (independent of E7A)
   
   Creating a dedicated model avoids semantic corruption of E7A
   and maintains clean architectural boundaries.
   
   Content stored as plain text only — no raw HTML.
============================================ */
var schoolWebsitePostSchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true
  },

  title:   { type: String, required: true, trim: true },
  slug:    { type: String, required: true, trim: true, lowercase: true },

  /* Content — plain text/markdown. Raw HTML NEVER stored or rendered. */
  excerpt: { type: String, default: '', maxlength: 500 },
  content: { type: String, default: '' },

  /* Featured image */
  featuredImageUrl: { type: String, default: '' },
  featuredMediaId:  {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolWebsiteMedia',
    default: null
  },

  /* Public display author (NOT auth identity — display name only) */
  authorDisplayName: { type: String, default: '' },

  /* Publication */
  status:      { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
  isFeatured:  { type: Boolean, default: false },
  publishedAt: { type: Date, default: null },

  /* Organisation */
  category: { type: String, default: 'general', trim: true },
  tags:     { type: [String], default: [] },

  /* SEO */
  metaTitle: { type: String, default: '' },
  metaDesc:  { type: String, default: '' },

  /* Audit */
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
  createdByName: { type: String, default: '' },
  updatedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  updatedByName: { type: String, default: '' }

}, { timestamps: true });

schoolWebsitePostSchema.index({ schoolId: 1, status: 1, publishedAt: -1 });
schoolWebsitePostSchema.index({ schoolId: 1, slug: 1 }, { unique: true });
schoolWebsitePostSchema.index({ schoolId: 1, isFeatured: 1, status: 1 });
schoolWebsitePostSchema.index({ schoolId: 1, category: 1, status: 1 });

module.exports = mongoose.model('SchoolWebsitePost', schoolWebsitePostSchema);