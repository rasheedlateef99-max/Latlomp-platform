/* ============================================
   LATLOMP INSTITUTION — SCHOOL MODEL
   ✅ PHASE O: Added attendanceMode field.
   'daily'  — one mark per student per day
   'period' — one mark per student per period
   Defaults to 'daily' for all existing schools
   with no migration required.
============================================ */
'use strict';

const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema(
  {
    /* ---- Identity ---- */
    name:  { type: String, required: true },
    email: { type: String, required: true, unique: true },
    slug:  { type: String, default: '', unique: true, sparse: true },

    /* ---- Branding ---- */
    logo:           { type: String, default: '' },
    primaryColor:   { type: String, default: '#6c63ff' },
    secondaryColor: { type: String, default: '#574fd6' },

    /* ---- Institution type ---- */
    type: {
      type:    String,
      default: 'secondary',
      enum:    ['primary', 'secondary', 'college',
                'polytechnic', 'university', 'other']
    },

    /* ---- Location ---- */
    address: { type: String, default: '' },
    city:    { type: String, default: '' },
    state:   { type: String, default: '' },
    country: { type: String, default: 'Nigeria' },
    phone:   { type: String, default: '' },
    website: { type: String, default: '' },

    /* ---- Institutional identity ---- */
    motto:             { type: String, default: '' },
    vision:            { type: String, default: '' },
    mission:           { type: String, default: '' },
    principalName:     { type: String, default: '' },
    vicePrincipalName: { type: String, default: '' },

    /* ---- Ownership ---- */
    ownerEmail:    { type: String, default: '' },
    ownerGoogleId: { type: String, default: '' },
    ownerId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'SchoolUser',
      default: null
    },

    /* ---- License ---- */
    licenseKey: { type: String, default: '' },
    isVerified: { type: Boolean, default: false },

    /* ---- Onboarding ---- */
    onboardingDone: { type: Boolean, default: false },

    /* ---- Subscription ---- */
    status: {
      type:    String,
      default: 'trial',
      enum:    ['trial', 'active', 'expired', 'suspended']
    },
    subscriptionPlan:   { type: String, default: 'trial' },
    subscriptionExpiry: { type: Date,   default: null },
    trialUsed:          { type: Boolean, default: false },
    trialStartDate:     { type: Date,   default: null },

    /* ---- Access control ---- */
    isSuspended:   { type: Boolean, default: false },
    suspendReason: { type: String,  default: '' },

    /* ---- Denormalized counters ---- */
    totalStudents: { type: Number, default: 0 },
    totalTeachers: { type: Number, default: 0 },

    /* ---- School settings ---- */
    settings: {
      allowStudentRegistration: { type: Boolean, default: false },
      requireApproval:          { type: Boolean, default: true  },
      allowParentPortal:        { type: Boolean, default: false },
      timezone:                 { type: String,  default: 'Africa/Lagos' },
      language:                 { type: String,  default: 'en' }
    },

    /* ---- Phase N: Timetable period config ---- */
    timetablePeriods: { type: Array, default: [] },

    /* ---- ✅ Phase O: Attendance mode ---- */
    attendanceMode: {
      type:    String,
      enum:    ['daily', 'period'],
      default: 'daily'
    }
  },
  { timestamps: true }
);

/* ============================================
   Virtual: subscription active check
   Called by requireActiveSubscription middleware.
============================================ */
schoolSchema.virtual('isSubscriptionActive').get(function () {
  if (this.isSuspended) { return false; }
  if (this.status === 'active' || this.status === 'trial') {
    if (!this.subscriptionExpiry) { return false; }
    return new Date() < new Date(this.subscriptionExpiry);
  }
  return false;
});

module.exports = mongoose.model('School', schoolSchema);