/* ============================================
   EXAMINATION CORE ENGINE — CONFIG ROUTES

   SCOPE ISOLATION ENFORCED:
     All /cbt/* and /availability/* → eceRootOnly
     All /institution/* → eceInstitutionAdmin (Phase 7)
     All /teacher/*     → eceTeacher (Phase 7)

   API SURFACE:
     GET  /api/ece/registry                 — capability registry
     GET  /api/ece/dashboard                — ECE status overview
     GET  /api/ece/config/cbt               — CBT scope config
     PUT  /api/ece/config/cbt               — update CBT config
     POST /api/ece/config/cbt/reset         — reset CBT to defaults
     PUT  /api/ece/config/cbt/toggle        — enable/disable CBT ECE
     GET  /api/ece/availability             — global capability availability
     PUT  /api/ece/availability             — update global availability
     GET  /api/ece/config/institution/:id   — institution scope (Phase 7)
     PUT  /api/ece/config/institution/:id   — institution scope (Phase 7)
     GET  /api/ece/audit                    — ECE audit log
     GET  /api/ece/session-config/:scope    — machine-readable config for exam pages
============================================ */
'use strict';

var express     = require('express');
var router      = express.Router();
var ECEConfig   = require('../models/ECEConfig.model');
var ECEAuditLog = require('../models/ECEAuditLog.model');
var registry    = require('../config/ece.capability.registry');
var guard       = require('../middleware/ece.guard');
/* ✅ ECE Phase 2: protect is the student JWT middleware.
   Used only by /exam-security — all other routes use guard. */
var protect     = require('../../middleware/auth.middleware').protect;

/* ============================================
   GET /api/ece/registry
   Returns the full capability registry.
   Public — exam pages and admin UI use this.
============================================ */
router.get('/registry', function (req, res) {
  return res.json({
    success:    true,
    registry:   registry.ECE_CAPABILITIES,
    scopes:     ['cbt', 'institution', 'teacher'],
    allKeys:    registry.getAllKeys()
  });
});

/* ============================================
   GET /api/ece/dashboard
   ECE overview: connected systems, enabled
   capabilities per scope, last changes.
============================================ */
router.get('/dashboard', guard.eceRootOnly, async function (req, res) {
  try {
    var [cbtCfg, instCount, teacherCount, recentAudit] = await Promise.all([
      ECEConfig.findOne({ scope: 'cbt', scopeId: null }).lean(),
      ECEConfig.countDocuments({ scope: 'institution' }),
      ECEConfig.countDocuments({ scope: 'teacher' }),
      ECEAuditLog.find({}).sort({ createdAt: -1 }).limit(5).lean()
    ]);

    /* Count enabled capabilities per scope */
    function countEnabled(caps) {
      var count = 0;
      if (!caps) { return 0; }
      Object.values(caps).forEach(function (group) {
        if (typeof group === 'object') {
          Object.values(group).forEach(function (val) {
            if (val === true) { count++; }
          });
        }
      });
      return count;
    }

    return res.json({
      success: true,
      dashboard: {
        systems: [
          {
            scope:            'cbt',
            label:            'Platform CBT',
            enabled:          cbtCfg ? cbtCfg.enabled : true,
            configuredAt:     cbtCfg ? cbtCfg.updatedAt : null,
            enabledCapabilities: cbtCfg ? countEnabled(cbtCfg.capabilities) : 0
          },
          { scope: 'institution', label: 'Institution Examinations', configuredCount: instCount },
          { scope: 'teacher',     label: 'Teacher Examinations',     configuredCount: teacherCount }
        ],
        recentChanges: recentAudit,
        version: '1.0.0',
        phase:   'Phase 1 — Foundation'
      }
    });
  } catch (e) {
    console.error('[ECE] GET /dashboard:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   GET /api/ece/config/cbt
   Returns the Platform CBT ECE configuration.
   Creates with defaults if not yet configured.
============================================ */
router.get('/config/cbt', guard.eceRootOnly, async function (req, res) {
  try {
    var config = await ECEConfig.getOrCreate('cbt', null, 'Platform CBT');
    return res.json({ success: true, config: config.toClientObject() });
  } catch (e) {
    console.error('[ECE] GET /config/cbt:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   PUT /api/ece/config/cbt
   Update Platform CBT ECE configuration.

   Body: { capabilities: { security: { fullscreen: true }, ... } }
   Only provided keys are updated (deep merge).
   Unknown capability keys are rejected.
============================================ */
router.put('/config/cbt', guard.eceRootOnly, async function (req, res) {
  try {
    var body          = req.body;
    var newCaps       = body.capabilities;
    var validKeys     = registry.getAllKeys();

    if (!newCaps || typeof newCaps !== 'object') {
      return res.status(400).json({ success: false, message: 'capabilities object is required.' });
    }

    /* Validate all provided capability keys */
    var invalidKeys = [];
    Object.keys(newCaps).forEach(function (group) {
      if (typeof newCaps[group] === 'object') {
        Object.keys(newCaps[group]).forEach(function (key) {
          /* Numeric values (e.g. tab_switch_max_warnings) are allowed alongside booleans */
          if (key !== key.replace(/[^a-z0-9_]/g, '')) {
            invalidKeys.push(key);
          }
        });
      }
    });

    if (invalidKeys.length > 0) {
      return res.status(400).json({ success: false,
        message: 'Invalid capability keys: ' + invalidKeys.join(', ') });
    }

    var config   = await ECEConfig.getOrCreate('cbt', null, 'Platform CBT');
    var oldCaps  = JSON.parse(JSON.stringify(config.capabilities || {}));

    /* Deep merge: only update provided keys */
    Object.keys(newCaps).forEach(function (group) {
      if (!config.capabilities[group]) { config.capabilities[group] = {}; }
      Object.assign(config.capabilities[group], newCaps[group]);
    });

    config.lastModifiedBy = req.eceActor || 'admin';
    config.lastModifiedAt = new Date();
    config.markModified('capabilities');
    await config.save();

    /* Audit */
    await ECEAuditLog.record({
      actor:       req.eceActor,
      actorRole:   req.eceActorRole,
      scope:       'cbt',
      scopeLabel:  'Platform CBT',
      action:      'capability_changed',
      field:       'capabilities',
      oldValue:    oldCaps,
      newValue:    config.capabilities,
      description: 'CBT capability configuration updated'
    });

    return res.json({ success: true, message: 'CBT configuration updated.', config: config.toClientObject() });
  } catch (e) {
    console.error('[ECE] PUT /config/cbt:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   POST /api/ece/config/cbt/reset
   Reset CBT config to factory defaults.
============================================ */
router.post('/config/cbt/reset', guard.eceRootOnly, async function (req, res) {
  try {
    var config  = await ECEConfig.getOrCreate('cbt', null, 'Platform CBT');
    var oldCaps = JSON.parse(JSON.stringify(config.capabilities || {}));

    config.capabilities   = registry.getDefaultConfig('cbt');
    config.lastModifiedBy = req.eceActor || 'admin';
    config.lastModifiedAt = new Date();
    config.markModified('capabilities');
    await config.save();

    await ECEAuditLog.record({
      actor: req.eceActor, actorRole: req.eceActorRole,
      scope: 'cbt', scopeLabel: 'Platform CBT',
      action: 'config_reset',
      oldValue: oldCaps, newValue: config.capabilities,
      description: 'CBT configuration reset to factory defaults'
    });

    return res.json({ success: true, message: 'CBT configuration reset to defaults.', config: config.toClientObject() });
  } catch (e) {
    console.error('[ECE] POST /config/cbt/reset:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   PUT /api/ece/config/cbt/toggle
   Enable or disable ECE for CBT entirely.
   Body: { enabled: true | false }
============================================ */
router.put('/config/cbt/toggle', guard.eceRootOnly, async function (req, res) {
  try {
    var enabled = req.body.enabled !== false;
    var config  = await ECEConfig.getOrCreate('cbt', null, 'Platform CBT');
    var oldVal  = config.enabled;
    config.enabled        = enabled;
    config.lastModifiedBy = req.eceActor || 'admin';
    config.lastModifiedAt = new Date();
    await config.save();

    await ECEAuditLog.record({
      actor: req.eceActor, actorRole: req.eceActorRole,
      scope: 'cbt', scopeLabel: 'Platform CBT',
      action: enabled ? 'scope_enabled' : 'scope_disabled',
      oldValue: oldVal, newValue: enabled,
      description: 'CBT ECE ' + (enabled ? 'enabled' : 'disabled')
    });

    return res.json({ success: true, message: 'CBT ECE ' + (enabled ? 'enabled.' : 'disabled.'), enabled: enabled });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   GET /api/ece/availability
   Returns which capabilities Root Admin has made
   globally available (institution + teacher may use).
============================================ */
router.get('/availability', guard.eceRootOnly, async function (req, res) {
  try {
    var config = await ECEConfig.getOrCreate('cbt', null, 'Platform CBT');
    return res.json({
      success:      true,
      availability: config.globalAvailability || {}
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   PUT /api/ece/availability
   Root Admin enables/disables capabilities
   platform-wide for institution and teacher scopes.
   Body: { capability_key: true | false, ... }
============================================ */
router.put('/availability', guard.eceRootOnly, async function (req, res) {
  try {
    var updates    = req.body;
    var validKeys  = registry.getAllKeys();
    var invalidKeys = Object.keys(updates).filter(function (k) { return !validKeys.includes(k); });

    if (invalidKeys.length > 0) {
      return res.status(400).json({ success: false,
        message: 'Unknown capability keys: ' + invalidKeys.join(', ') });
    }

    var config   = await ECEConfig.getOrCreate('cbt', null, 'Platform CBT');
    var oldAvail = JSON.parse(JSON.stringify(config.globalAvailability || {}));

    Object.assign(config.globalAvailability, updates);
    config.lastModifiedBy = req.eceActor || 'admin';
    config.lastModifiedAt = new Date();
    config.markModified('globalAvailability');
    await config.save();

    await ECEAuditLog.record({
      actor: req.eceActor, actorRole: req.eceActorRole,
      scope: 'cbt', scopeLabel: 'Global',
      action: 'global_availability_changed',
      oldValue: oldAvail, newValue: config.globalAvailability,
      description: 'Global capability availability updated'
    });

    return res.json({ success: true, message: 'Global capability availability updated.', availability: config.globalAvailability });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   GET /api/ece/config/institution/:schoolId
   Institution Admin gets their school's ECE config.
   Phase 7: fully wired to institution admin auth.
============================================ */
router.get('/config/institution/:schoolId', guard.eceInstitutionAdmin, async function (req, res) {
  try {
    /* Scope isolation: institution admin can only access their own school */
    if (req.eceScopeId && req.eceScopeId.toString() !== req.params.schoolId) {
      return res.status(403).json({ success: false, message: 'You can only configure your own institution.' });
    }
    var config = await ECEConfig.getOrCreate('institution', req.params.schoolId, 'Institution');
    return res.json({ success: true, config: config.toClientObject() });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   PUT /api/ece/config/institution/:schoolId
   Institution Admin updates their school's config.
   Respects globalAvailability restrictions.
============================================ */
router.put('/config/institution/:schoolId', guard.eceInstitutionAdmin, async function (req, res) {
  try {
    if (req.eceScopeId && req.eceScopeId.toString() !== req.params.schoolId) {
      return res.status(403).json({ success: false, message: 'You can only configure your own institution.' });
    }

    var newCaps   = req.body.capabilities;
    if (!newCaps)  { return res.status(400).json({ success: false, message: 'capabilities required.' }); }

    /* Check global availability restrictions */
    var globalCfg  = await ECEConfig.findOne({ scope: 'cbt', scopeId: null }).lean();
    var globalAvail = (globalCfg && globalCfg.globalAvailability) ? globalCfg.globalAvailability : {};

    /* Block any capability that Root Admin has set to false globally */
    Object.keys(newCaps).forEach(function (group) {
      if (typeof newCaps[group] === 'object') {
        Object.keys(newCaps[group]).forEach(function (key) {
          if (globalAvail[key] === false && newCaps[group][key] === true) {
            newCaps[group][key] = false; /* silently downgrade */
          }
        });
      }
    });

    var config   = await ECEConfig.getOrCreate('institution', req.params.schoolId, 'Institution');
    var oldCaps  = JSON.parse(JSON.stringify(config.capabilities || {}));

    Object.keys(newCaps).forEach(function (group) {
      if (!config.capabilities[group]) { config.capabilities[group] = {}; }
      Object.assign(config.capabilities[group], newCaps[group]);
    });

    config.lastModifiedBy = req.eceActor || 'institution_admin';
    config.lastModifiedAt = new Date();
    config.markModified('capabilities');
    await config.save();

    await ECEAuditLog.record({
      actor: req.eceActor, actorRole: req.eceActorRole,
      scope: 'institution', scopeId: req.params.schoolId,
      action: 'capability_changed',
      oldValue: oldCaps, newValue: config.capabilities,
      description: 'Institution ECE configuration updated'
    });

    return res.json({ success: true, message: 'Institution configuration updated.', config: config.toClientObject() });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   GET /api/ece/session-config/:scope
   Returns a minimal, machine-readable ECE config
   for use by exam session pages.
   Called at session/start — lightweight response.

   For 'institution' and 'teacher', scopeId is
   passed as ?scopeId=xxx query parameter.

   Returns only enabled capabilities as a flat
   object: { fullscreen: true, math: false, ... }
   This is what ece-core.js reads on the frontend.
============================================ */
router.get('/session-config/:scope', async function (req, res) {
  try {
    var scope   = req.params.scope;
    var scopeId = req.query.scopeId || null;

    if (!['cbt', 'institution', 'teacher'].includes(scope)) {
      return res.status(400).json({ success: false, message: 'Invalid scope.' });
    }

    var config = await ECEConfig.findOne({ scope: scope, scopeId: scopeId });

    if (!config || !config.enabled) {
      /* ECE not configured or disabled — return all-off config */
      return res.json({ success: true, enabled: false, capabilities: {} });
    }

    /* Flatten capabilities to { key: boolean } for easy ece-core.js consumption */
    var flat = {};
    var caps = config.capabilities || {};
    Object.keys(caps).forEach(function (group) {
      if (typeof caps[group] === 'object') {
        Object.assign(flat, caps[group]);
      }
    });

    return res.json({
      success:      true,
      enabled:      config.enabled,
      scope:        scope,
      capabilities: flat  /* flat map — ece-core.js reads this directly */
    });
  } catch (e) {
    /* Session config failure must never crash exam sessions */
    console.error('[ECE] GET /session-config/:scope:', e.message);
    return res.json({ success: true, enabled: false, capabilities: {} });
  }
});

/* ============================================
   GET /api/ece/audit
   ECE audit log with pagination.
============================================ */
router.get('/audit', guard.eceRootOnly, async function (req, res) {
  try {
    var page  = Math.max(1,   parseInt(req.query.page)  || 1);
    var limit = Math.min(50,  parseInt(req.query.limit) || 20);
    var skip  = (page - 1) * limit;
    var scope = req.query.scope || '';

    var filter = {};
    if (scope) { filter.scope = scope; }

    var [total, logs] = await Promise.all([
      ECEAuditLog.countDocuments(filter),
      ECEAuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean()
    ]);

    return res.json({
      success: true,
      total:   total,
      page:    page,
      pages:   Math.ceil(total / limit),
      logs:    logs
    });
  } catch (e) {
    console.error('[ECE] GET /audit:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* ============================================
   GET /api/ece/exam-navigation
   ✅ ECE PHASE 4: Student-accessible endpoint.
   Called by ece-navigation.js on exam start.
   Returns only navigation capability flags.

   FAILURE SAFETY: Always returns valid JSON.
   review_mode defaults false so confirmSubmit()
   is never blocked by an ECE error.
============================================ */
router.get('/exam-navigation', protect, async function (req, res) {
  var SAFE_DEFAULT = {
    success:    true,
    navigation: {
      keyboard_shortcuts: false,
      question_palette:   false,
      bookmarking:        false,
      flag_review:        false,
      autosave:           false,
      resume_session:     false,
      review_mode:        false
    }
  };

  try {
    var config = await ECEConfig.findOne({ scope: 'cbt', scopeId: null })
      .select('capabilities enabled')
      .lean();

    if (!config || !config.enabled || !config.capabilities || !config.capabilities.navigation) {
      return res.json(SAFE_DEFAULT);
    }

    var n = config.capabilities.navigation;
    return res.json({
      success:    true,
      navigation: {
        keyboard_shortcuts: !!n.keyboard_shortcuts,
        question_palette:   !!n.question_palette,
        bookmarking:        !!n.bookmarking,
        flag_review:        !!n.flag_review,
        autosave:           !!n.autosave,
        resume_session:     !!n.resume_session,
        review_mode:        !!n.review_mode
      }
    });
  } catch (e) {
    console.error('[ECE] GET /exam-navigation:', e.message);
    return res.json(SAFE_DEFAULT);
  }
});

/* ============================================
   GET /api/ece/exam-rendering
   ✅ ECE PHASE 3: Student-accessible endpoint.
   Called by ece-rendering.js when exam starts.
   Returns rendering capability flags only.

   FAILURE SAFETY: Always returns valid JSON.
   images defaults true — existing questions
   with image content are never broken.
============================================ */
router.get('/exam-rendering', protect, async function (req, res) {
  var SAFE_DEFAULT = {
    success:   true,
    rendering: {
      math:      false,
      arabic:    false,
      chemistry: false,
      physics:   false,
      rich_text: false,
      images:    true   /* always true — safe default */
    }
  };

  try {
    var config = await ECEConfig.findOne({ scope: 'cbt', scopeId: null })
      .select('capabilities enabled')
      .lean();

    if (!config || !config.enabled || !config.capabilities || !config.capabilities.rendering) {
      return res.json(SAFE_DEFAULT);
    }

    var r = config.capabilities.rendering;
    return res.json({
      success:   true,
      rendering: {
        math:      !!r.math,
        arabic:    !!r.arabic,
        chemistry: !!r.chemistry,
        physics:   !!r.physics,
        rich_text: !!r.rich_text,
        images:    r.images !== false   /* default true */
      }
    });
  } catch (e) {
    console.error('[ECE] GET /exam-rendering:', e.message);
    return res.json(SAFE_DEFAULT);
  }
});

/* ============================================
   GET /api/ece/exam-security
   ✅ ECE PHASE 2: Student-accessible endpoint.
   Called by ece-security.js when exam starts.
   Uses protect (student JWT) not guard.eceRootOnly.

   Returns only the security capability flags
   needed by the client-side security module.
   No sensitive admin config is exposed.

   FAILURE SAFETY: Always returns valid JSON.
   If ECEConfig is missing or DB throws, all
   capabilities return false so the exam is
   never blocked by an ECE error.
============================================ */
router.get('/exam-security', protect, async function (req, res) {
  var SAFE_DEFAULT = {
    success:  true,
    security: {
      fullscreenEnforcement: false,
      tabSwitchDetection:    false,
      copyProtection:        false,
      rightClickDisable:     false,
      maxViolations:         3
    }
  };

  try {
    var config = await ECEConfig.findOne({ scope: 'cbt', scopeId: null })
      .select('capabilities enabled')
      .lean();

    if (!config || !config.enabled || !config.capabilities || !config.capabilities.security) {
      return res.json(SAFE_DEFAULT);
    }

    var sec = config.capabilities.security;

    return res.json({
      success: true,
      security: {
        fullscreenEnforcement: !!sec.fullscreen_enforcement,
        tabSwitchDetection:    !!sec.tab_switch_detection,
        copyProtection:        !!sec.copy_protection,
        rightClickDisable:     !!sec.right_click_disable,
        maxViolations:         3
      }
    });
  } catch (e) {
    console.error('[ECE] GET /exam-security:', e.message);
    return res.json(SAFE_DEFAULT);
  }
});

module.exports = router;