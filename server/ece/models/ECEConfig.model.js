/* ============================================
   EXAMINATION CORE ENGINE — CONFIG MODEL

   Stores the capability configuration for each
   examination system scope.

   SCOPE ISOLATION:
     scope:'cbt'         → Root Admin only
     scope:'institution' → Institution Admin only (scopeId = schoolId)
     scope:'teacher'     → Teacher only (scopeId = teacherId / userId)

   The compound index (scope + scopeId) ensures
   one config per system. scopeId is null for 'cbt'.

   FLEXIBILITY:
     capabilities uses Mixed type so new capabilities
     can be added in future phases without schema migration.
     getOrCreate() populates defaults automatically.
============================================ */
'use strict';

var mongoose = require('mongoose');
var registry = require('../config/ece.capability.registry');

var eceConfigSchema = new mongoose.Schema(
  {
    /* Which examination system this config belongs to */
    scope: {
      type:     String,
      enum:     ['cbt', 'institution', 'teacher'],
      required: true,
      index:    true
    },

    /* Null for 'cbt'. schoolId for 'institution'. userId for 'teacher'. */
    scopeId: {
      type:    mongoose.Schema.Types.ObjectId,
      default: null,
      index:   true
    },

    /* Human-readable label — auto-generated */
    scopeLabel: {
      type:    String,
      default: ''
    },

    /* Whether ECE is active for this scope (master switch) */
    enabled: {
      type:    Boolean,
      default: true
    },

    /* ============================================
       CAPABILITIES
       Nested document — one sub-object per group.
       Uses Mixed type for future extensibility.
       Shape mirrors SCOPE_CAPABILITY_DEFAULTS.
    ============================================ */
    capabilities: {
      type:    mongoose.Schema.Types.Mixed,
      default: {}
    },

    /* ============================================
       GLOBAL AVAILABILITY (Root Admin only)
       Governs which capabilities institution and
       teacher scopes are PERMITTED to enable.
       Keys are capability keys (e.g. 'fullscreen').
       true = available, false = blocked platform-wide.
       Institution/teacher cannot override this.
    ============================================ */
    globalAvailability: {
      type:    mongoose.Schema.Types.Mixed,
      default: {}
    },

    /* Audit */
    lastModifiedBy:    { type: String, default: 'system' },
    lastModifiedAt:    { type: Date,   default: Date.now }
  },
  { timestamps: true }
);

/* Unique compound index — one config per scope+scopeId */
eceConfigSchema.index({ scope: 1, scopeId: 1 }, { unique: true });

/* ============================================
   STATIC: getOrCreate
   Returns the ECEConfig for a scope.
   Creates it with defaults if it doesn't exist.
   This is the primary access method.
============================================ */
eceConfigSchema.statics.getOrCreate = async function (scope, scopeId, scopeLabel) {
  scopeId    = scopeId    || null;
  scopeLabel = scopeLabel || scope;

  var config = await this.findOne({ scope: scope, scopeId: scopeId });

  if (!config) {
    config = await this.create({
      scope:              scope,
      scopeId:            scopeId,
      scopeLabel:         scopeLabel,
      enabled:            true,
      capabilities:       registry.getDefaultConfig(scope),
      globalAvailability: {},
      lastModifiedBy:     'system'
    });
  }

  return config;
};

/* ============================================
   INSTANCE: toClientObject
   Returns a clean object safe to send to the
   frontend, including merged capability metadata.
============================================ */
eceConfigSchema.methods.toClientObject = function () {
  return {
    _id:                this._id,
    scope:              this.scope,
    scopeId:            this.scopeId,
    scopeLabel:         this.scopeLabel,
    enabled:            this.enabled,
    capabilities:       this.capabilities,
    globalAvailability: this.globalAvailability,
    lastModifiedBy:     this.lastModifiedBy,
    lastModifiedAt:     this.lastModifiedAt,
    updatedAt:          this.updatedAt
  };
};

/* ============================================
   INSTANCE: isCapabilityEnabled
   Checks if a specific capability key is
   enabled in this config.
============================================ */
eceConfigSchema.methods.isCapabilityEnabled = function (capabilityKey) {
  var caps = this.capabilities || {};
  /* Search through all groups */
  for (var group in caps) {
    if (caps[group] && caps[group][capabilityKey] !== undefined) {
      return !!caps[group][capabilityKey];
    }
  }
  return false;
};

module.exports = mongoose.model('ECEConfig', eceConfigSchema);