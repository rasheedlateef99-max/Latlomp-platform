/* ============================================
   LATLOMP INSTITUTION — INVITATION MODEL
============================================ */
const mongoose = require('mongoose');
const crypto   = require('crypto');

const invitationSchema = new mongoose.Schema(
  {
    schoolId:  { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },

    email:     { type: String, required: true, lowercase: true, trim: true },
    name:      { type: String, default: '' },
    role:      { type: String, enum: ['teacher','vice_principal'], default: 'teacher' },
    subjects:  [String],
    classes:   [String],

    token:     { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },

    status: {
      type:    String,
      enum:    ['pending', 'accepted', 'expired', 'cancelled'],
      default: 'pending'
    },

    acceptedAt: { type: Date, default: null },
    message:    { type: String, default: '' }
  },
  { timestamps: true }
);

invitationSchema.index({ token: 1 });
invitationSchema.index({ schoolId: 1, email: 1 });
invitationSchema.index({ expiresAt: 1 });

/* Generate secure token on creation */
invitationSchema.pre('save', function(next) {
  if (!this.token) {
    this.token     = crypto.randomBytes(32).toString('hex');
    this.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); /* 7 days */
  }
  next();
});

module.exports = mongoose.model('Invitation', invitationSchema);