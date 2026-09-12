'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP COMMUNITY — SETTINGS (E9A)

   One settings document per school.
   isEnabled defaults to FALSE — school admin
   must explicitly enable the community.

   Does NOT store school identity (that is in
   School.model). Only community-specific config.
============================================ */
const communitySettingsSchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true,
    unique:   true
  },

  /* ---- Activation ---- */
  isEnabled:     { type: Boolean, default: false },
  communityName: { type: String,  default: 'School Community', trim: true },
  welcomeMessage:{ type: String,  default: '' },
  rules:         { type: String,  default: '' },

  /* ---- Post controls ---- */
  requirePostApproval: { type: Boolean, default: false },
  allowStudentPosts:   { type: Boolean, default: true  },
  allowParentPosts:    { type: Boolean, default: true  },
  allowAlumniPosts:    { type: Boolean, default: true  },
  allowStaffPosts:     { type: Boolean, default: true  },

  /* ---- Media controls ---- */
  allowMediaUploads:   { type: Boolean, default: true  },
  allowVideoUploads:   { type: Boolean, default: false }, /* Enabled in E9D */
  maxMediaPerPost:     { type: Number,  default: 4     },

  /* ---- Content limits ---- */
  maxPostLength:    { type: Number, default: 2000  },
  maxCommentLength: { type: Number, default: 500   },

  /* ---- Designated moderators (SchoolUser refs) ---- */
  moderators: [{
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'SchoolUser',
    default: []
  }],

  /* ---- Audit ---- */
  updatedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  updatedByName: { type: String, default: '' }

}, { timestamps: true });

communitySettingsSchema.index({ schoolId: 1 }, { unique: true });

module.exports = mongoose.model('CommunitySettings', communitySettingsSchema);