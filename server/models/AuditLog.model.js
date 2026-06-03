/* ============================================
   LATLOMP PLATFORM — AUDIT LOG MODEL
   
   Records every significant action across
   both the main platform and institution portal.
   
   Used for:
   - Security investigation
   - Compliance
   - Suspicious activity detection
   - Admin oversight
============================================ */
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    /* Who performed the action */
    actorId: {
      type:    mongoose.Schema.Types.ObjectId,
      default: null
    },
    actorEmail:  { type: String, default: '' },
    actorRole:   { type: String, default: '' },
    actorType: {
      type:    String,
      enum:    ['platform_user', 'school_user', 'student', 'anonymous', 'system'],
      default: 'anonymous'
    },

    /* Institution context (null for main platform) */
    schoolId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'School',
      default: null
    },

    /* What happened */
    action: {
      type:     String,
      required: true,
      trim:     true
    },

    /* Resource that was affected */
    resource:   { type: String, default: '' },   /* e.g. 'exam', 'result', 'school' */
    resourceId: { type: String, default: '' },   /* MongoDB ID as string */

    /* HTTP context */
    method:     { type: String, default: '' },
    path:       { type: String, default: '' },
    statusCode: { type: Number, default: 0 },

    /* Network */
    ip:        { type: String, default: '' },
    userAgent: { type: String, default: '' },

    /* Outcome */
    success: { type: Boolean, default: true },
    message: { type: String, default: '' },

    /* Extra structured data */
    meta: {
      type:    mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps:  true,
    /* Capped collection — auto-deletes oldest when full
       Max 100,000 documents (~50MB). Prevents unbounded growth. */
    capped: { size: 52428800, max: 100000 }
  }
);

/* Indexes for fast security queries */
auditLogSchema.index({ actorId:   1, createdAt: -1 });
auditLogSchema.index({ schoolId:  1, createdAt: -1 });
auditLogSchema.index({ ip:        1, createdAt: -1 });
auditLogSchema.index({ action:    1 });
auditLogSchema.index({ success:   1, createdAt: -1 });
auditLogSchema.index({ createdAt: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);