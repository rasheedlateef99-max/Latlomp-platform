'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — ALUMNI EVENT (E6)
   Reunions are eventType:'reunion' — no separate model.
============================================ */
var registrationSchema = new mongoose.Schema({
  alumniId:     { type: mongoose.Schema.Types.ObjectId, ref: 'AlumniProfile', required: true },
  alumniName:   { type: String, default: '' },
  registeredAt: { type: Date, default: Date.now },
  status:       { type: String, enum: ['registered','cancelled','waitlisted','attended'], default: 'registered' }
}, { _id: false });

const alumniEventSchema = new mongoose.Schema({
  schoolId:    { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  title:       { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  eventType: {
    type:    String,
    enum:    ['reunion','meeting','career','community','anniversary','other'],
    default: 'other'
  },
  date:    { type: Date, required: true },
  endDate: { type: Date, default: null },
  location: {
    address:    { type: String, default: '' },
    online:     { type: Boolean, default: false },
    onlineLink: { type: String, default: '' }
  },
  capacity: { type: Number, default: null },
  status: {
    type:    String,
    enum:    ['draft','published','cancelled','completed'],
    default: 'draft'
  },
  visibility: {
    type:    String,
    enum:    ['alumni_only','school_community'],
    default: 'alumni_only'
  },
  registrations:   [registrationSchema],
  createdBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
  createdByName:   { type: String, default: '' },
  updatedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  cancelledAt:     { type: Date, default: null },
  cancelReason:    { type: String, default: '' }
}, { timestamps: true });

alumniEventSchema.index({ schoolId: 1, status: 1 });
alumniEventSchema.index({ schoolId: 1, date: 1 });
alumniEventSchema.index({ schoolId: 1, eventType: 1, status: 1 });

module.exports = mongoose.model('AlumniEvent', alumniEventSchema);