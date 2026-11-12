'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP — SCHOOL NOTIFICATION MODEL (P10-A)

   Stores in-app notifications for staff,
   parents, and students.

   claim_submitted        → finance staff
   claim_verified         → payer portal
   claim_rejected         → payer portal
   claim_needs_correction → payer portal
   payment_recorded       → payer portal
   general                → any recipient

   Soft-deleted (isDeleted) so the recipient can
   remove entries from their history without
   affecting audit trails.

   Auto-expires after 90 days via TTL index.
   schoolId enforced on every query — tenant safe.

   MESSAGING B1 (additive): dedupeKey + partial unique index
   so there is at most ONE unread notification per
   (recipient, dedupeKey). Existing documents have no
   dedupeKey and are not covered by that index.
============================================ */
const schoolNotificationSchema = new mongoose.Schema({

  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true,
    index:    true
  },

  /* ── Who receives this ── */
  recipientType: {
    type:     String,
    enum:     ['staff', 'parent', 'student'],
    required: true
  },
  recipientId: {
    type:    mongoose.Schema.Types.ObjectId,
    default: null,
    index:   true
    /* staff   → SchoolUser._id
       parent  → SchoolParent._id
       student → SchoolStudent._id (students AND alumni) */
  },

  /* ── What happened ── */
  type: {
    type:     String,
    required: true,
    enum: [
      'claim_submitted',
      'claim_verified',
      'claim_rejected',
      'claim_needs_correction',
      'payment_recorded',
      'general'
    ],
    index: true
  },

  title: { type: String, required: true, trim: true, maxlength: 200 },
  body:  { type: String, default: '',   trim: true, maxlength: 600 },

  /* ── Linked entity (for deep-linking from the panel) ── */
  entityType: { type: String, default: '' },
  entityId:   { type: mongoose.Schema.Types.ObjectId, default: null },

  /* ── MESSAGING B1: one unread notification per conversation/request ── */
  dedupeKey: { type: String },

  /* ── Extra context shown inside the notification card ── */
  metadata: {
    amount:          { type: Number, default: null },
    currency:        { type: String, default: ''   },
    payerName:       { type: String, default: ''   },
    studentName:     { type: String, default: ''   },
    receiptNumber:   { type: String, default: ''   },
    rejectionReason: { type: String, default: ''   },
    correctionNote:  { type: String, default: ''   }
  },

  /* ── State ── */
  isRead:    { type: Boolean, default: false, index: true },
  readAt:    { type: Date,    default: null  },
  isDeleted: { type: Boolean, default: false, index: true }

}, { timestamps: true });

/* ── Compound indexes ── */
schoolNotificationSchema.index({ schoolId: 1, recipientId: 1, isDeleted: 1, createdAt: -1 });
schoolNotificationSchema.index({ schoolId: 1, recipientId: 1, isRead:    1 });

/* ── MESSAGING B1: at most one UNREAD, non-deleted notification per dedupeKey ── */
schoolNotificationSchema.index(
  { schoolId: 1, recipientType: 1, recipientId: 1, dedupeKey: 1 },
  {
    unique: true,
    partialFilterExpression: { dedupeKey: { $type: 'string' }, isRead: false, isDeleted: false }
  }
);

/* ── Auto-expire after 90 days ── */
schoolNotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

module.exports = mongoose.model('SchoolNotification', schoolNotificationSchema);
