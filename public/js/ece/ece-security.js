/* ============================================
   LATLOMP PLATFORM — ECE SECURITY MODULE
   Phase 2: Client-side examination security.

   RESPONSIBILITIES:
     - Fullscreen enforcement
     - Tab switch / window blur detection
     - Copy / paste / cut protection
     - Right-click disable
     - Violation counting + warning banner
     - Auto-submit on max violations

   ACTIVATION:
     Called by exam.js: eceSecurityInit()
     Reads config from: GET /api/ece/exam-security
     Calls on auto-submit: submitExam(true) [exam.js global]

   FAILURE SAFETY:
     If config load fails, module exits silently.
     The exam always continues — ECE errors never
     block a student from taking their examination.

   SCOPE:
     CBT Platform only. Institution and Teacher exam
     clients will activate this module independently
     in their own ECE integration phases.
============================================ */

/* Wrap in IIFE to avoid polluting global scope.
   Only window.eceSecurityInit is exposed. */
(function (global) {
  'use strict';

  /* ---- Internal state ---- */
  var _caps = {
    fullscreenEnforcement: false,
    tabSwitchDetection:    false,
    copyProtection:        false,
    rightClickDisable:     false,
    maxViolations:         3
  };

  var _active             = false;
  var _violations         = 0;
  var _lastViolationMs    = 0;   /* debounce timestamp */
  var _fsOverlayEl        = null;
  var _warnBannerEl       = null;
  var _warnDismissTimer   = null;
  var _fsWasActive        = false; /* track whether we entered fullscreen */

  /* ============================================
     PUBLIC: eceSecurityInit
     Called once from exam.js after session is
     loaded and first question has been rendered.
  ============================================ */
  async function eceSecurityInit () {
    if (_active) { return; } /* idempotent */

    var loaded = await _loadConfig();
    if (!loaded) { return; }

    var anyEnabled = _caps.fullscreenEnforcement ||
                     _caps.tabSwitchDetection    ||
                     _caps.copyProtection        ||
                     _caps.rightClickDisable;

    if (!anyEnabled) {
      console.log('[ECE Security] All capabilities disabled — security module inactive.');
      return;
    }

    _active = true;
    _injectUI();

    if (_caps.fullscreenEnforcement) { _initFullscreen(); }
    if (_caps.tabSwitchDetection)    { _initTabDetection(); }
    if (_caps.copyProtection)        { _initCopyProtection(); }
    if (_caps.rightClickDisable)     { _initRightClick(); }

    console.log('[ECE Security] Active.', {
      fullscreen: _caps.fullscreenEnforcement,
      tabDetect:  _caps.tabSwitchDetection,
      copy:       _caps.copyProtection,
      rightClick: _caps.rightClickDisable,
      maxWarnings:_caps.maxViolations
    });
  }

  /* ============================================
     CONFIG LOAD
  ============================================ */
  async function _loadConfig () {
    try {
      /* apiRequest is from main.js — available globally */
      var res = await apiRequest('/ece/exam-security');
      if (!res.ok || !res.data || !res.data.security) { return false; }

      var s = res.data.security;
      _caps.fullscreenEnforcement = !!s.fullscreenEnforcement;
      _caps.tabSwitchDetection    = !!s.tabSwitchDetection;
      _caps.copyProtection        = !!s.copyProtection;
      _caps.rightClickDisable     = !!s.rightClickDisable;
      _caps.maxViolations         = (typeof s.maxViolations === 'number' && s.maxViolations >= 1)
        ? s.maxViolations : 3;
      return true;
    } catch (e) {
      console.warn('[ECE Security] Config load failed — security inactive:', e.message);
      return false;
    }
  }

  /* ============================================
     UI INJECTION
     Creates two elements appended to body:
       1. Fullscreen enforcement overlay (#eceFullscreenOverlay)
       2. Violation warning banner   (#eceViolationBanner)
     Both invisible by default.
  ============================================ */
  function _injectUI () {
    /* ---- 1. Fullscreen overlay ---- */
    if (_caps.fullscreenEnforcement) {
      _fsOverlayEl = document.createElement('div');
      _fsOverlayEl.id = 'eceFullscreenOverlay';
      Object.assign(_fsOverlayEl.style, {
        position:       'fixed',
        inset:          '0',
        background:     'rgba(10,10,20,0.98)',
        zIndex:         '9000',
        display:        'none',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        gap:            '16px',
        fontFamily:     'Inter, sans-serif',
        textAlign:      'center',
        padding:        '32px'
      });
      _fsOverlayEl.innerHTML =
        '<div style="font-size:64px; margin-bottom:4px;">🔒</div>' +
        '<h2 style="font-size:22px; font-weight:800; color:#fff; margin:0;">' +
          'Fullscreen Required' +
        '</h2>' +
        '<p style="font-size:14px; color:rgba(255,255,255,0.55); margin:0; ' +
          'line-height:1.75; max-width:380px;">' +
          'This examination must be taken in fullscreen mode.<br>' +
          'Your timer is paused until you return to fullscreen.' +
        '</p>' +
        '<button id="eceEnterFsBtn" ' +
          'onclick="_eceReturnFullscreen()" ' +
          'style="margin-top:8px; padding:14px 40px; ' +
            'background:linear-gradient(135deg,#43e97b,#38f9d7); ' +
            'color:#0f0f1a; border:none; border-radius:12px; ' +
            'font-size:15px; font-weight:800; cursor:pointer; ' +
            'font-family:inherit; transition:all 0.2s;"' +
          'onmouseover="this.style.transform=\'translateY(-2px)\'" ' +
          'onmouseout="this.style.transform=\'\'">' +
          '⛶ Return to Fullscreen' +
        '</button>' +
        '<p id="eceFsViolationNote" ' +
          'style="font-size:12px; color:rgba(255,101,132,0.8); margin:0; display:none;">' +
        '</p>';
      document.body.appendChild(_fsOverlayEl);
    }

    /* ---- 2. Violation warning banner ---- */
    _warnBannerEl = document.createElement('div');
    _warnBannerEl.id = 'eceViolationBanner';
    Object.assign(_warnBannerEl.style, {
      position:       'fixed',
      top:            '56px',   /* sits directly below the .exam-topbar */
      left:           '0',
      right:          '0',
      background:     'rgba(255,101,132,0.96)',
      color:          '#fff',
      padding:        '11px 18px',
      fontFamily:     'Inter, sans-serif',
      fontSize:       '13px',
      fontWeight:     '700',
      display:        'none',
      alignItems:     'center',
      justifyContent: 'space-between',
      gap:            '12px',
      zIndex:         '8000',
      boxShadow:      '0 4px 20px rgba(255,101,132,0.35)',
      lineHeight:     '1.5'
    });
    _warnBannerEl.innerHTML =
      '<span id="eceViolationMsg">⚠️ Security violation detected.</span>' +
      '<button onclick="_eceDismissWarning()" ' +
        'style="background:rgba(0,0,0,0.18); border:1px solid rgba(255,255,255,0.25); ' +
          'color:#fff; padding:4px 14px; border-radius:6px; font-size:12px; ' +
          'font-weight:700; cursor:pointer; font-family:inherit; flex-shrink:0;">' +
        'Dismiss ✕' +
      '</button>';
    document.body.appendChild(_warnBannerEl);
  }

  /* ============================================
     FULLSCREEN
  ============================================ */
  function _initFullscreen () {
    /* Request fullscreen immediately on exam start */
    _requestFullscreen();

    /* Monitor for fullscreen state changes */
    document.addEventListener('fullscreenchange',       _onFsChange);
    document.addEventListener('webkitfullscreenchange', _onFsChange);
    document.addEventListener('mozfullscreenchange',    _onFsChange);
    document.addEventListener('MSFullscreenChange',     _onFsChange);
  }

  function _requestFullscreen () {
    var el = document.documentElement;
    try {
      var fn = el.requestFullscreen       ||
               el.webkitRequestFullscreen ||
               el.mozRequestFullScreen    ||
               el.msRequestFullscreen;
      if (fn) {
        fn.call(el).then(function () {
          _fsWasActive = true;
        }).catch(function (e) {
          /* User denied or API not available — disable enforcement */
          console.warn('[ECE Security] Fullscreen request denied:', e.message);
          _caps.fullscreenEnforcement = false;
        });
      } else {
        /* API not available (e.g. iOS Safari) */
        _caps.fullscreenEnforcement = false;
      }
    } catch (e) {
      _caps.fullscreenEnforcement = false;
    }
  }

  function _onFsChange () {
    var isFull = !!( document.fullscreenElement       ||
                     document.webkitFullscreenElement ||
                     document.mozFullScreenElement    ||
                     document.msFullscreenElement );

    if (!isFull && _fsWasActive && _active && !_isOver()) {
      /* User exited fullscreen during active exam */
      _pauseTimer();
      _showFsOverlay();
    } else if (isFull) {
      _hideFsOverlay();
      _resumeTimer();
    }
  }

  function _showFsOverlay () {
    if (!_fsOverlayEl) { return; }
    /* Update violation note */
    var noteEl = document.getElementById('eceFsViolationNote');
    if (noteEl) {
      if (_violations > 0) {
        noteEl.textContent = '⚠️ Violation ' + _violations + ' of ' + _caps.maxViolations +
          ' — returning to fullscreen will resume your exam.';
        noteEl.style.display = 'block';
      } else {
        noteEl.style.display = 'none';
      }
    }
    _fsOverlayEl.style.display = 'flex';
  }

  function _hideFsOverlay () {
    if (_fsOverlayEl) { _fsOverlayEl.style.display = 'none'; }
  }

  function _pauseTimer () {
    /* _timerInterval is a global in exam.js */
    if (typeof _timerInterval !== 'undefined' && _timerInterval) {
      clearInterval(_timerInterval);
      /* Write null via the global — safe because exam.js startTimer()
         reassigns _timerInterval when called */
      global._timerInterval = null;
    }
  }

  function _resumeTimer () {
    if (_isOver()) { return; }
    /* Only resume if timer is not already running */
    if (typeof _timerInterval === 'undefined' || !_timerInterval) {
      if (typeof startTimer === 'function') { startTimer(); }
    }
  }

  /* Public — called from the overlay button's onclick */
  global._eceReturnFullscreen = function () {
    _requestFullscreen();
  };

  /* ============================================
     TAB SWITCH / WINDOW BLUR DETECTION
  ============================================ */
  function _initTabDetection () {
    document.addEventListener('visibilitychange', _onVisibilityChange);
    window.addEventListener('blur', _onWindowBlur);
  }

  function _onVisibilityChange () {
    if (document.hidden && !_isOver()) {
      _recordViolation('tab_switch');
    }
  }

  function _onWindowBlur () {
    /* Ignore blur if fullscreen overlay is currently showing — that's
       our own UI, not the user switching away */
    if (_fsOverlayEl && _fsOverlayEl.style.display === 'flex') { return; }
    if (!_isOver()) {
      _recordViolation('window_blur');
    }
  }

  /* ============================================
     COPY PROTECTION
  ============================================ */
  function _initCopyProtection () {
    document.addEventListener('copy',    _blockClipboard);
    document.addEventListener('cut',     _blockClipboard);
    document.addEventListener('paste',   _blockClipboard);
    document.addEventListener('keydown', _blockShortcuts);
  }

  function _blockClipboard (e) {
    if (!_isOver()) { e.preventDefault(); }
  }

  function _blockShortcuts (e) {
    if (_isOver()) { return; }
    var ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) { return; }
    var blocked = ['c','C','x','X','v','V','a','A','p','P','s','S','u','U'];
    if (blocked.indexOf(e.key) !== -1) { e.preventDefault(); }
  }

  /* ============================================
     RIGHT-CLICK DISABLE
  ============================================ */
  function _initRightClick () {
    document.addEventListener('contextmenu', function (e) {
      if (!_isOver()) { e.preventDefault(); }
    });
  }

  /* ============================================
     VIOLATION TRACKING
  ============================================ */
  function _recordViolation (reason) {
    if (_isOver()) { return; }

    /* Debounce: visibilitychange + blur often fire together.
       Treat any violations within 2 seconds as one event. */
    var now = Date.now();
    if (now - _lastViolationMs < 2000) { return; }
    _lastViolationMs = now;

    _violations++;

    var labels = {
      tab_switch:   'Tab switch detected',
      window_blur:  'Window lost focus',
      copy_attempt: 'Copy attempt blocked'
    };
    var label     = labels[reason] || 'Security violation';
    var remaining = _caps.maxViolations - _violations;

    if (_violations >= _caps.maxViolations) {
      _showWarning(
        '🚫 Maximum security violations reached (' + _violations + '/' + _caps.maxViolations + '). ' +
        'Your exam is being submitted automatically.'
      );
      /* Give the student 2 seconds to see the message before submitting */
      setTimeout(function () { _autoSubmit(); }, 2000);
      return;
    }

    _showWarning(
      '⚠️ ' + label + '. ' +
      'Warning ' + _violations + ' of ' + _caps.maxViolations + '. ' +
      remaining + ' warning' + (remaining !== 1 ? 's' : '') + ' left before auto-submit.'
    );
  }

  function _showWarning (msg) {
    if (!_warnBannerEl) { return; }
    var msgEl = document.getElementById('eceViolationMsg');
    if (msgEl) { msgEl.textContent = msg; }
    _warnBannerEl.style.display = 'flex';

    /* Auto-dismiss after 5 seconds unless it's the final warning */
    clearTimeout(_warnDismissTimer);
    if (_violations < _caps.maxViolations) {
      _warnDismissTimer = setTimeout(function () {
        if (_warnBannerEl) { _warnBannerEl.style.display = 'none'; }
      }, 5000);
    }
  }

  global._eceDismissWarning = function () {
    clearTimeout(_warnDismissTimer);
    if (_warnBannerEl) { _warnBannerEl.style.display = 'none'; }
  };

  /* ============================================
     AUTO SUBMIT
  ============================================ */
  function _autoSubmit () {
    /* _submitted is a global in exam.js */
    if (typeof _submitted !== 'undefined' && _submitted) { return; }
    /* submitExam(wasAuto) is the correct function — it skips confirm() */
    if (typeof submitExam === 'function') {
      submitExam(true);
    }
  }

  /* ============================================
     HELPERS
  ============================================ */
  function _isOver () {
    return (typeof _submitted !== 'undefined' && _submitted === true) ||
           (typeof _timeLeft  !== 'undefined' && _timeLeft  <= 0);
  }

  /* ============================================
     PUBLIC API
  ============================================ */
  global.eceSecurityInit = eceSecurityInit;

}(window));