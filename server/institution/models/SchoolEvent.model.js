'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — SCHOOL EVENT (E7A)

   Separate from AlumniEvent (E6) per D3.
   AlumniEvent = alumni lifecycle domain.
   SchoolEvent = institutional operational events
   (parent-teacher meetings, open days, etc.)

   visibility: 'parents'|'all'|'students'|'staff'
   Parent portal only sees 'parents'|'all'.

   ✅ E8A ADDITION:
   showOnWebsite, websiteDisplayOrder, websiteFeatured
   are orthogonal to the visibility field.
   visibility = internal portal audience targeting.
   showOnWebsite = explicit opt-in for public website.
   An event can be visible to parents (internal) without
   appearing on the public school website, and vice versa.
   E7A parent portal behaviour is completely unchanged.
============================================ */
var eventRegistrationSchema = new mongoose.Schema({
  parentId:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolParent', required: true },
  parentName:   { type: String, default: '' },
  studentId:    { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolStudent', default: null },
  registeredAt: { type: Date, default: Date.now },
  status: {
    type:    String,
    enum:    ['registered','cancelled','attended','waitlisted'],
    default: 'registered'
  }
}, { _id: false });

const schoolEventSchema = new mongoose.Schema({
  schoolId:    { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  title:       { type: String, required: true, trim: true },
  description: { type: String, default: '' },

  eventType: {
    type:    String,
    enum:    ['parent_meeting','open_day','graduation','sports','cultural','general','other'],
    default: 'general'
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

  /* ✅ E7A: Internal portal audience selector.
     'all' means all authenticated portal users — NOT the public internet.
     The parent portal filters by: visibility in ['parents','all']. */
  visibility: {
    type:    String,
    enum:    ['parents','all','students','staff'],
    default: 'parents'
  },

  registrations: { type: [eventRegistrationSchema], default: [] },

  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
  createdByName: { type: String, default: '' },
  updatedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  cancelledAt:   { type: Date, default: null },
  cancelReason:  { type: String, default: '' },

  /* ✅ E8A: Public school website display controls.
     Orthogonal to visibility — both can be set independently.
     Public website renderer queries: showOnWebsite === true.
     E7A parent portal queries are unaffected. */
  showOnWebsite:       { type: Boolean, default: false },
  websiteDisplayOrder: { type: Number,  default: 0 },
  websiteFeatured:     { type: Boolean, default: false }

}, { timestamps: true });

/* ---- E7A indexes (unchanged) ---- */
schoolEventSchema.index({ schoolId: 1, status: 1, date: 1 });
schoolEventSchema.index({ schoolId: 1, visibility: 1, status: 1 });
schoolEventSchema.index({ schoolId: 1, eventType: 1, status: 1 });

/* ---- E8A index — public website queries ---- */
schoolEventSchema.index({ schoolId: 1, showOnWebsite: 1, status: 1, date: 1 });

module.exports = mongoose.model('SchoolEvent', schoolEventSchema);