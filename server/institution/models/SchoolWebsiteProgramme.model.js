'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP INSTITUTION — SCHOOL WEBSITE PROGRAMME (E8B)

   Academic programmes for public website (prospectus).
   NOT a duplicate of Class.model.js (which manages
   live class enrolment and academic operations).

   SchoolWebsiteProgramme = public-facing prospectus
   entry describing a programme of study.

   Examples: "B.Sc Computer Science (3 years)",
   "ND Electrical Engineering (2 years)",
   "Primary One — Primary Six".

   departmentId links to existing SchoolDepartment
   for display context — no academic duplication.
============================================ */
const schoolWebsiteProgrammeSchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true
  },

  name:        { type: String, required: true, trim: true },
  description: { type: String, default: '' },

  level: {
    type: String,
    enum: ['primary', 'jss', 'sss', 'nd', 'hnd', 'degree',
           'masters', 'phd', 'certificate', 'diploma', 'other'],
    default: 'other'
  },

  duration:          { type: String, default: '' }, /* "3 years", "4 semesters" */
  subjects:          { type: [String], default: [] },
  entryRequirements: { type: String, default: '' },
  careerProspects:   { type: String, default: '' },

  /* Image reference */
  imageUrl: { type: String, default: '' },
  mediaId:  {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolWebsiteMedia',
    default: null
  },

  /* Links to existing SchoolDepartment for context — not duplicated */
  departmentId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolDepartment',
    default: null
  },

  /* Publication */
  isPublished:  { type: Boolean, default: false },
  isFeatured:   { type: Boolean, default: false },
  displayOrder: { type: Number,  default: 0 },

  /* Audit */
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
  createdByName: { type: String, default: '' },
  updatedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null }

}, { timestamps: true });

schoolWebsiteProgrammeSchema.index({ schoolId: 1, isPublished: 1, displayOrder: 1 });
schoolWebsiteProgrammeSchema.index({ schoolId: 1, level: 1, isPublished: 1 });
schoolWebsiteProgrammeSchema.index({ schoolId: 1, departmentId: 1 });
schoolWebsiteProgrammeSchema.index({ schoolId: 1, isFeatured: 1, isPublished: 1 });

module.exports = mongoose.model('SchoolWebsiteProgramme', schoolWebsiteProgrammeSchema);