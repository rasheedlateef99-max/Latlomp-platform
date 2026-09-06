'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP — SCHOOL WEBSITE VERSION (E8E)

   Each document records a publish event snapshot.
   configSnapshot = what became publishedConfig at
   that point. Enables rollback to any saved version.

   Maximum MAX_VERSIONS (10) kept per school.
   Oldest are pruned by website.publish.service.js
   on each new publish or rollback event.

   source:
     'publish'  — admin clicked Publish
     'rollback' — admin rolled back to a prior version

   rolledBackFromVersion:
     If source === 'rollback', the versionNumber
     that was restored.
============================================ */
const schoolWebsiteVersionSchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true
  },

  /* Sequential per school — 1, 2, 3... */
  versionNumber: { type: Number, required: true },

  /* Full copy of the config that went live */
  configSnapshot: {
    type:     mongoose.Schema.Types.Mixed,
    required: true
  },

  publishedAt:     { type: Date, required: true },
  publishedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
  publishedByName: { type: String, default: '' },

  /* Optional admin label */
  label: { type: String, default: '' },

  source: {
    type:    String,
    enum:    ['publish', 'rollback'],
    default: 'publish'
  },

  /* Populated only when source === 'rollback' */
  rolledBackFromVersion: { type: Number, default: null }

}, { timestamps: true });

schoolWebsiteVersionSchema.index({ schoolId: 1, versionNumber: -1 });
schoolWebsiteVersionSchema.index({ schoolId: 1, publishedAt: -1 });

module.exports = mongoose.model('SchoolWebsiteVersion', schoolWebsiteVersionSchema);