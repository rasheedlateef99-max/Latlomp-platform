'use strict';
const mongoose = require('mongoose');
const crypto   = require('crypto');

const schoolParentInvitationSchema = new mongoose.Schema({
  schoolId:  { type: mongoose.Schema.Types.ObjectId, ref: 'School',     required: true },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },

  /* Parent identity — email must match at registration */
  parentEmail: { type: String, required: true, lowercase: true, trim: true },
  parentName:  { type: String, default: '' },

  /* Students this parent is authorized to see.
     School staff explicitly selects which student(s).
     Parent cannot add or change these after accepting. */
  studentIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref:  'SchoolStudent'
  }],

  token:     { type: String, required: true, unique: true },
  expiresAt: { type: Date,   required: true },

  status: {
    type:    String,
    enum:    ['pending', 'accepted', 'expired', 'cancelled'],
    default: 'pending'
  },

  acceptedAt: { type: Date, default: null }
}, { timestamps: true });

schoolParentInvitationSchema.index({ token:    1 });
schoolParentInvitationSchema.index({ schoolId: 1, parentEmail: 1 });
schoolParentInvitationSchema.index({ expiresAt: 1 });

schoolParentInvitationSchema.pre('validate', function (next) {
  if (!this.token) {
    this.token = crypto.randomBytes(32).toString('hex');
  }
  if (!this.expiresAt) {
    /* Default 7-day expiry — matches existing invitation pattern */
    this.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }
  next();
});

module.exports = mongoose.model('SchoolParentInvitation', schoolParentInvitationSchema);