/* ============================================
   EXAMINATION CORE ENGINE — AUDIT LOG MODEL
   Records every ECE configuration change.
============================================ */
'use strict';

var mongoose = require('mongoose');

var eceAuditLogSchema = new mongoose.Schema(
  {
    actor:     { type: String, required: true }, /* email or 'system' */
    actorRole: {
      type: String,
      enum: ['root_admin', 'platform_staff', 'institution_admin', 'teacher', 'system'],
      default: 'system'
    },

    scope:     { type: String, required: true },
    scopeId:   { type: mongoose.Schema.Types.ObjectId, default: null },
    scopeLabel:{ type: String, default: '' },

    action: {
      type: String,
      enum: ['capability_changed', 'config_reset', 'global_availability_changed',
             'scope_enabled', 'scope_disabled', 'config_created'],
      required: true
    },

    /* What was changed */
    field:    { type: String, default: '' },
    oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },

    /* Human-readable summary */
    description: { type: String, default: '' }
  },
  { timestamps: true }
);

eceAuditLogSchema.index({ scope: 1, createdAt: -1 });
eceAuditLogSchema.index({ actor: 1, createdAt: -1 });

/* ---- Static helper to quickly record a change ---- */
eceAuditLogSchema.statics.record = async function (opts) {
  try {
    await this.create({
      actor:       opts.actor       || 'system',
      actorRole:   opts.actorRole   || 'system',
      scope:       opts.scope,
      scopeId:     opts.scopeId     || null,
      scopeLabel:  opts.scopeLabel  || opts.scope,
      action:      opts.action,
      field:       opts.field       || '',
      oldValue:    opts.oldValue    !== undefined ? opts.oldValue : null,
      newValue:    opts.newValue    !== undefined ? opts.newValue : null,
      description: opts.description || ''
    });
  } catch (e) {
    /* Audit failure must never break the primary operation */
    console.warn('[ECE Audit] Log failed:', e.message);
  }
};

module.exports = mongoose.model('ECEAuditLog', eceAuditLogSchema);