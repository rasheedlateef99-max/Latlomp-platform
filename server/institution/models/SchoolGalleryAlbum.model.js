'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — SCHOOL GALLERY ALBUM (E8C)

   Deferred from E8A — now implementing.

   Each album belongs to one school (tenant-isolated).
   Items reference SchoolWebsiteMedia — no binary
   content stored in this document.

   Status: 'draft' | 'published'
   Public renderer reads published albums ONLY.

   Items are embedded for efficient single-query
   album rendering. Max 100 items per album is
   enforced at the route layer.
============================================ */

var galleryItemSchema = new mongoose.Schema({
  mediaId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'SchoolWebsiteMedia',
    required: true
  },
  /* Denormalised for render performance — avoids population per item */
  url:          { type: String, default: '' },
  thumbnailUrl: { type: String, default: '' },
  caption:      { type: String, default: '' },
  altText:      { type: String, default: '' },
  displayOrder: { type: Number, default: 0 }
}, { _id: true }); /* _id: true so items can be referenced by ID for deletion */

const schoolGalleryAlbumSchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true
  },

  title:       { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  slug:        { type: String, default: '' },

  /* Cover image — denormalised URL for listing page */
  coverImageUrl: { type: String, default: '' },
  coverMediaId:  {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolWebsiteMedia',
    default: null
  },

  /* Album items (embedded — max 100 enforced at route) */
  items: { type: [galleryItemSchema], default: [] },

  /* Publication */
  status: {
    type:    String,
    enum:    ['draft', 'published'],
    default: 'draft'
  },
  publishedAt:     { type: Date, default: null },
  publishedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  publishedByName: { type: String, default: '' },

  displayOrder: { type: Number, default: 0 },
  isFeatured:   { type: Boolean, default: false },

  /* Audit */
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
  createdByName: { type: String, default: '' },
  updatedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  updatedByName: { type: String, default: '' }

}, { timestamps: true });

schoolGalleryAlbumSchema.index({ schoolId: 1, status: 1, displayOrder: 1 });
schoolGalleryAlbumSchema.index({ schoolId: 1, isFeatured: 1, status: 1 });
schoolGalleryAlbumSchema.index({ schoolId: 1, slug: 1 });

module.exports = mongoose.model('SchoolGalleryAlbum', schoolGalleryAlbumSchema);