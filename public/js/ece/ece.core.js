/* ============================================
   EXAMINATION CORE ENGINE — CORE LOADER
   Version 1.0 — Phase 1 Foundation

   This file is loaded by exam frontend pages.
   It reads the ECE configuration delivered by
   the server at session/start and activates
   only the capabilities that are enabled.

   USAGE (exam pages):
     <script src="/js/ece/ece-core.js"></script>
     ECE.init(eceConfig);

   WHERE eceConfig comes from:
     The server injects it into the exam session
     response (Phase 7). Until then, ECE.init()
     can be called with a config object or no args
     (all capabilities remain disabled).

   EXTENSION PRINCIPLE:
     ECE.init() is always safe to call even if the
     exam page doesn't use ECE features. If no config
     is provided or all features are disabled, this
     file does nothing and the existing exam works
     exactly as before.
============================================ */

(function (window) {
  'use strict';

  /* ---- Internal state ---- */
  var _config     = {};          /* flat capabilities map from server */
  var _enabled    = false;       /* ECE master switch */
  var _modules    = {};          /* loaded module references */
  var _initialized = false;

  /* ---- Public ECE namespace ---- */
  var ECE = {

    version: '1.0.0',
    phase:   'Phase 1 — Foundation',

    /* ============================================
       ECE.init(config)
       Called once when the exam session starts.
       config = { enabled: bool, capabilities: { key: bool } }
    ============================================ */
    init: function (config) {
      if (_initialized) {
        console.warn('[ECE] Already initialized — ignoring duplicate init call.');
        return;
      }

      if (!config || !config.enabled) {
        console.log('[ECE] Disabled for this scope — running in legacy mode.');
        _enabled = false;
        _initialized = true;
        return;
      }

      _enabled    = true;
      _config     = config.capabilities || {};
      _initialized = true;

      console.log('[ECE] Initialized. Enabled capabilities:', ECE.getEnabledCapabilities());

      /* Activate each enabled module */
      ECE._activateModules();
    },

    /* ============================================
       ECE.isEnabled(capability)
       Returns true if a capability is active.
       Safe to call before init() — returns false.
    ============================================ */
    isEnabled: function (capability) {
      if (!_enabled || !_initialized) { return false; }
      return !!_config[capability];
    },

    /* ============================================
       ECE.getEnabledCapabilities()
       Returns an array of all enabled capability keys.
    ============================================ */
    getEnabledCapabilities: function () {
      if (!_enabled) { return []; }
      return Object.keys(_config).filter(function (k) { return !!_config[k]; });
    },

    /* ============================================
       ECE.getConfig()
       Returns the full flat capabilities map.
    ============================================ */
    getConfig: function () {
      return Object.assign({}, _config);
    },

    /* ============================================
       ECE.register(moduleName, moduleRef)
       Called by each ECE module (security, rendering,
       navigation, rules) to register itself.
       Allows ECE.getModule('security') to work.
    ============================================ */
    register: function (moduleName, moduleRef) {
      _modules[moduleName] = moduleRef;
      console.log('[ECE] Module registered:', moduleName);
    },

    /* ============================================
       ECE.getModule(moduleName)
       Returns a registered module reference.
    ============================================ */
    getModule: function (moduleName) {
      return _modules[moduleName] || null;
    },

    /* ============================================
       ECE._activateModules()
       Internal: activates each enabled module group.
       Each module checks ECE.isEnabled() for its
       own capabilities before activating.
       Phase 2–6 modules are loaded here when available.
    ============================================ */
    _activateModules: function () {

      /* Phase 2: Security */
      if (ECE.isEnabled('fullscreen')       ||
          ECE.isEnabled('tab_switch')       ||
          ECE.isEnabled('copy_protection')  ||
          ECE.isEnabled('paste_protection') ||
          ECE.isEnabled('right_click')      ||
          ECE.isEnabled('session_integrity')) {
        if (typeof ECESecurity !== 'undefined') {
          ECESecurity.init();
          ECE.register('security', ECESecurity);
          console.log('[ECE] Security module activated.');
        } else {
          console.log('[ECE] Security capabilities enabled but ece-security.js not loaded (Phase 2).');
        }
      }

      /* Phase 3: Rendering — always check even if explicit flags are off,
         because the intelligent renderer auto-detects content */
      if (typeof ECERendering !== 'undefined') {
        ECERendering.init(_config);
        ECE.register('rendering', ECERendering);
        console.log('[ECE] Rendering module activated.');
      } else if (ECE.isEnabled('math') || ECE.isEnabled('arabic') ||
                 ECE.isEnabled('chemistry') || ECE.isEnabled('physics') ||
                 ECE.isEnabled('rich_text')) {
        console.log('[ECE] Rendering capabilities enabled but ece-rendering.js not loaded (Phase 3).');
      }

      /* Phase 4: Navigation */
      if (ECE.isEnabled('keyboard_shortcuts') ||
          ECE.isEnabled('question_palette')   ||
          ECE.isEnabled('bookmarking')        ||
          ECE.isEnabled('autosave')           ||
          ECE.isEnabled('resume_session')) {
        if (typeof ECENavigation !== 'undefined') {
          ECENavigation.init(_config);
          ECE.register('navigation', ECENavigation);
          console.log('[ECE] Navigation module activated.');
        } else {
          console.log('[ECE] Navigation capabilities enabled but ece-navigation.js not loaded (Phase 4).');
        }
      }

      /* Phase 5: Rules */
      if (ECE.isEnabled('negative_marking')  ||
          ECE.isEnabled('attempts_limit')    ||
          ECE.isEnabled('shuffle_options')) {
        if (typeof ECERules !== 'undefined') {
          ECERules.init(_config);
          ECE.register('rules', ECERules);
          console.log('[ECE] Rules module activated.');
        } else {
          console.log('[ECE] Rules capabilities enabled but ece-rules.js not loaded (Phase 5).');
        }
      }
    },

    /* ============================================
       ECE.fetchConfig(scope, scopeId)
       Utility: fetch ECE config from server.
       Called by exam pages that want to init ECE
       without waiting for session/start.
       Returns null if ECE is disabled or unavailable.
    ============================================ */
    fetchConfig: async function (scope, scopeId) {
      try {
        var url = '/api/ece/session-config/' + scope;
        if (scopeId) { url += '?scopeId=' + scopeId; }
        var res  = await fetch(url);
        var data = await res.json();
        if (data.success && data.enabled) { return data; }
        return null;
      } catch (e) {
        console.warn('[ECE] Failed to fetch config — running legacy:', e.message);
        return null;
      }
    }
  };

  /* Expose globally */
  window.ECE = ECE;

  console.log('[ECE] ece-core.js loaded — Version ' + ECE.version);

}(window));