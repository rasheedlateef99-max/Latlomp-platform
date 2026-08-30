'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — ALUMNI CONNECTION (E6)

   Two-level model (Q3):
   Level 1: directory discovery via directoryVisibility
   Level 2: deeper social relationship via connections

   Both alumni must belong to the same school.
   Prevents cross-school identity merging.
   Foundation for future messaging ecosystem.
============================================ */
const alumniConnectionSchema = new mongoose.Schema({
  schoolId:    { type: mongoose.Schema.Types.ObjectId, ref: 'School',       required: true },
  requesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'AlumniProfile', required: true },
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'AlumniProfile', required: true },

  status: {
    type:    String,
    enum:    ['pending', 'accepted', 'rejected', 'withdrawn'],
    default: 'pending'
  },

  message:     { type: String, default: '', maxlength: 300 },
  requestedAt: { type: Date, default: Date.now },
  respondedAt: { type: Date, default: null }
}, { timestamps: true });

/* Prevent duplicate connection requests */
alumniConnectionSchema.index(
  { requesterId: 1, recipientId: 1 },
  { unique: true }
);
alumniConnectionSchema.index({ schoolId: 1, requesterId: 1 });
alumniConnectionSchema.index({ schoolId: 1, recipientId: 1 });
alumniConnectionSchema.index({ schoolId: 1, status: 1 });

module.exports = mongoose.model('AlumniConnection', alumniConnectionSchema);