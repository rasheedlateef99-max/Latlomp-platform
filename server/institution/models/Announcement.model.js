/* ============================================
   LATLOMP INSTITUTION — ANNOUNCEMENT MODEL
   Used by Main Admin to send notices to schools
============================================ */
const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema(
  {
    /* null = sent to ALL schools */
    schoolId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'School',
      default: null
    },

    title:   { type: String, required: true, trim: true },
    message: { type: String, required: true },

    type: {
      type:    String,
      enum:    ['info', 'warning', 'success', 'maintenance'],
      default: 'info'
    },

    sentBy:  { type: String, default: 'admin' },
    isRead:  { type: Boolean, default: false }
  },
  { timestamps: true }
);

announcementSchema.index({ schoolId: 1, createdAt: -1 });

module.exports = mongoose.model('Announcement', announcementSchema);