'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — SCHOOL WEBSITE FACILITY (E8B)

   School facilities for public website.
   No existing facility model in architecture tree.
   This is genuinely new domain data.

   Examples: Science Laboratory, Sports Hall,
   Library, Swimming Pool, ICT Centre.

   isPublished controls public visibility.
   displayOrder controls listing order.
============================================ */
const schoolWebsiteFacilitySchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true
  },

  name:        { type: String, required: true, trim: true },
  description: { type: String, default: '' },

  category: {
    type: String,
    enum: ['academic', 'sports', 'accommodation', 'dining',
           'recreation', 'medical', 'transport', 'other'],
    default: 'other'
  },

  /* Image reference — URL from SchoolWebsiteMedia */
  imageUrl: { type: String, default: '' },
  mediaId:  {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolWebsiteMedia',
    default: null
  },

  /* Publication */
  isPublished:  { type: Boolean, default: false },
  displayOrder: { type: Number,  default: 0 },
  publishedAt:  { type: Date,    default: null },

  /* Audit */
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
  createdByName: { type: String, default: '' },
  updatedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null }

}, { timestamps: true });

schoolWebsiteFacilitySchema.index({ schoolId: 1, isPublished: 1, displayOrder: 1 });
schoolWebsiteFacilitySchema.index({ schoolId: 1, category: 1, isPublished: 1 });

module.exports = mongoose.model('SchoolWebsiteFacility', schoolWebsiteFacilitySchema);