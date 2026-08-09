/* ============================================
   LATLOMP PLATFORM — ECE RULES ENGINE MODULE
   Phase 5: Client-side rules display.

   RESPONSIBILITIES:
     - Negative marking warning indicator
     - Review allowed flag for result.html
     - ece-core.js compatible interface

   NOTE: Core rules enforcement is server-side.
     negative_marking  → applied in cbt.routes.js session/submit
     attempts_limit    → enforced in cbt.routes.js session/start
     shuffle_options   → applied in cbt.routes.js session/start
     review_allowed    → read by result.html from sessionStorage

   This module handles DISPLAY only:
     Shows a persistent negative marking banner
     so students are always aware during the exam.

   ACTIVATION:
     Standalone: eceRulesInit() called by exam.js
     Via ece-core.js: ECERules.init(flatConfig)
============================================ */

(function (global) {
  'use strict';

  var _rules = {
    negativeMarking:   false,
    negativeMarkValue: 0.25,
    reviewAllowed:     true   /* default: show review (backward compat) */
  };

  var _active = false;

  /* ============================================
     PUBLIC: eceRulesInit
     Called from exam.js showSubjectBanner callback.
     Reads rules from _session.rules first (fast path),
     falls back to API if session is missing rules.
  ============================================ */
  async function eceRulesInit () {
    if (_active) { return; }

    /* Fast path: read rules from session already in memory */
    if (typeof _session !== 'undefined' && _session && _session.rules) {
      var r = _session.rules;
      _rules.negativeMarking   = !!r.negativeMarking;
      _rules.negativeMarkValue = typeof r.negativeMarkValue === 'number'
        ? r.negativeMarkValue : 0.25;
      _rules.reviewAllowed     = r.reviewAllowed !== false;  /* default true */
    } else {
      /* Fallback: fetch from API (handles old sessions without rules field) */
      try {
        var res = await apiRequest('/ece/exam-rules');
        if (res.ok && res.data && res.data.rules) {
          var rf = res.data.rules;
          _rules.negativeMarking   = !!rf.negative_marking;
          _rules.negativeMarkValue = typeof rf.negative_mark_value === 'number'
            ? rf.negative_mark_value : 0.25;
          _rules.reviewAllowed     = !!rf.review_allowed;
        }
      } catch (e) {
        console.warn('[ECE Rules] Config load failed — defaults used:', e.message);
      }
    }

    if (!_rules.negativeMarking) {
      console.log('[ECE Rules] No active display rules — module inactive.');
      return;
    }

    _active = true;
    _showNegativeMarkingBadge();

    console.log('[ECE Rules] Active.', {
      negativeMarking:   _rules.negativeMarking,
      negativeMarkValue: _rules.negativeMarkValue,
      reviewAllowed:     _rules.reviewAllowed
    });
  }

  /* ============================================
     NEGATIVE MARKING BADGE
     Persistent indicator shown throughout the exam.
     Positioned above the footer so it never
     overlaps question content.
     Fades to subtle opacity after 8 seconds.
  ============================================ */
  function _showNegativeMarkingBadge () {
    if (document.getElementById('eceNegMarkBadge')) { return; }

    var badge = document.createElement('div');
    badge.id  = 'eceNegMarkBadge';
    Object.assign(badge.style, {
      position:    'fixed',
      bottom:      '68px',         /* just above .exam-footer (60px) */
      left:        '50%',
      transform:   'translateX(-50%)',
      background:  'rgba(255,165,0,0.15)',
      border:      '1px solid rgba(255,165,0,0.35)',
      color:       '#ffa500',
      padding:     '6px 16px',
      borderRadius:'20px',
      fontSize:    '12px',
      fontWeight:  '700',
      fontFamily:  'Inter, sans-serif',
      zIndex:      '7000',
      whiteSpace:  'nowrap',
      pointerEvents:'none',
      transition:  'opacity 1s ease',
      userSelect:  'none'
    });
    badge.textContent = '⚠️ Negative marking: −' + _rules.negativeMarkValue + ' per wrong answer';
    document.body.appendChild(badge);

    /* Fade to subtle after 8 seconds — student has been informed */
    setTimeout(function () {
      badge.style.opacity = '0.4';
    }, 8000);
  }

  /* ============================================
     PUBLIC API
  ============================================ */
  global.eceRulesInit = eceRulesInit;

  /* ece-core.js compatible interface.
     Called as: ECERules.init(flatConfig) */
  global.ECERules = {
    init: function (flatConfig) {
      if (_active) { return; }
      _rules.negativeMarking   = !!flatConfig.negative_marking;
      _rules.negativeMarkValue = typeof flatConfig.negative_mark_value === 'number'
        ? flatConfig.negative_mark_value : 0.25;
      _rules.reviewAllowed     = !!flatConfig.review_allowed;
      if (!_rules.negativeMarking) { return; }
      _active = true;
      _showNegativeMarkingBadge();
    }
  };

}(window));