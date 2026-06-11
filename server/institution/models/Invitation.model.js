/* ============================================
   LATLOMP INSTITUTION — INVITATION MODEL

   ✅ PHASE B: Admin-controlled invitation expiry
   New field: expiryDuration
   Options:   5min | 10min | 30min | 1hr | 24hr | 7days
   Default:   7days (backward-compatible)

   The pre('validate') hook reads expiryDuration
   and computes expiresAt accordingly.
============================================ */
const mongoose = require('mongoose');
const crypto   = require('crypto');

/* Expiry duration → milliseconds map */
var EXPIRY_MS = {
  '5min':  5  * 60 * 1000,
  '10min': 10 * 60 * 1000,
  '30min': 30 * 60 * 1000,
  '1hr':   1  * 60 * 60 * 1000,
  '24hr':  24 * 60 * 60 * 1000,
  '7days': 7  * 24 * 60 * 60 * 1000
};

/* Human-readable labels for emails and UI */
var EXPIRY_LABELS = {
  '5min':  '5 minutes',
  '10min': '10 minutes',
  '30min': '30 minutes',
  '1hr':   '1 hour',
  '24hr':  '24 hours',
  '7days': '7 days'
};

const invitationSchema = new mongoose.Schema(
  {
    schoolId:  { type: mongoose.Schema.Types.ObjectId, ref: 'School',     required: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },

    email:    { type: String, required: true, lowercase: true, trim: true },
    name:     { type: String, default: '' },
    role:     { type: String, enum: ['teacher', 'vice_principal'], default: 'teacher' },
    subjects: [String],
    classes:  [String],

    token:    { type: String, required: true, unique: true },
    expiresAt:{ type: Date,   required: true },

    /* ✅ PHASE B: admin-chosen expiry window */
    expiryDuration: {
      type:    String,
      enum:    ['5min', '10min', '30min', '1hr', '24hr', '7days'],
      default: '7days'
    },

    status: {
      type:    String,
      enum:    ['pending', 'accepted', 'expired', 'cancelled'],
      default: 'pending'
    },

    acceptedAt: { type: Date,   default: null },
    message:    { type: String, default: '' }
  },
  { timestamps: true }
);

invitationSchema.index({ token:    1 });
invitationSchema.index({ schoolId: 1, email: 1 });
invitationSchema.index({ expiresAt: 1 });

/*
  ✅ pre('validate') — runs BEFORE Mongoose validation.
  Sets token and expiresAt on first creation.
  expiresAt is computed from expiryDuration so admin
  controls how long the invite link remains valid.
*/
invitationSchema.pre('validate', function(next) {
  if (!this.token) {
    this.token = crypto.randomBytes(32).toString('hex');
  }
  if (!this.expiresAt) {
    var ms = EXPIRY_MS[this.expiryDuration] || EXPIRY_MS['7days'];
    this.expiresAt = new Date(Date.now() + ms);
  }
  next();
});

/* Static helper: get human-readable label for a duration key */
invitationSchema.statics.getExpiryLabel = function(key) {
  return EXPIRY_LABELS[key] || '7 days';
};

module.exports = mongoose.model('Invitation', invitationSchema);