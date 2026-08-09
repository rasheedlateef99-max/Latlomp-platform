/* ============================================
   LATLOMP PLATFORM — ECE NAVIGATION MODULE
   Phase 4: Examination navigation enhancements.

   RESPONSIBILITIES:
     - Keyboard shortcuts (1/2/3/4, N, P, B, F, R)
     - Enhanced question palette (bookmarks, flags)
     - Question bookmarking
     - Flag for review
     - Autosave (30s interval, additive to per-selection save)
     - Resume session (restore bookmarks/flags/position)
     - Review screen before final submission

   CAPABILITY KEYS (from ece.capability.registry.js):
     keyboard_shortcuts — keyboard navigation + answer selection
     question_palette   — enhanced q-dot grid
     bookmarking        — bookmark questions for reference
     flag_review        — flag questions to revisit
     autosave           — periodic sessionStorage save
     resume_session     — restore state after accidental close
     review_mode        — review screen before final submit

   IMPLICIT DEPENDENCIES ON exam.js GLOBALS (read-only):
     _questions, _currentIdx, _answers, _submitted, _session
   EXAM.JS FUNCTIONS CALLED:
     renderQuestion(idx), submitExam(false), toggleQGrid()

   FAILURE SAFETY:
     eceNavigationInterceptSubmit() returns false on any error
     so confirmSubmit() always falls through to its default.
============================================ */

(function (global) {
  'use strict';

  /* ---- Capability state ---- */
  var _caps = {
    keyboard_shortcuts: false,
    question_palette:   false,
    bookmarking:        false,
    flag_review:        false,
    autosave:           false,
    resume_session:     false,
    review_mode:        false
  };

  var _active           = false;
  var _bookmarks        = {};   /* { questionId: true } */
  var _flags            = {};   /* { questionId: true } */
  var _autosaveInterval = null;

  /* ---- SessionStorage key — isolated from exam.js keys ---- */
  function _navStateKey () {
    if (typeof _session !== 'undefined' && _session && _session.examCategory) {
      return 'eceNavState_' + _session.examCategory;
    }
    return 'eceNavState';
  }

  /* ============================================
     PUBLIC: eceNavigationInit
     Called from exam.js showSubjectBanner callback.
  ============================================ */
  async function eceNavigationInit () {
    if (_active) { return; }

    var loaded = await _loadConfig();
    if (!loaded) { return; }

    var anyEnabled = Object.keys(_caps).some(function (k) { return _caps[k]; });
    if (!anyEnabled) {
      console.log('[ECE Navigation] All capabilities disabled.');
      return;
    }

    _active = true;

    /* Restore saved state before activating features */
    _restoreNavState();

    if (_caps.keyboard_shortcuts) { _initKeyboard();   }
    if (_caps.autosave)           { _initAutosave();   }
    if (_caps.bookmarking || _caps.flag_review) {
      _injectActionBar();
    }
    if (_caps.question_palette)   { _enhancePalette(); }

    /* Resume: navigate to last position if it differs from 0 */
    if (_caps.resume_session) {
      try {
        var saved = JSON.parse(sessionStorage.getItem(_navStateKey()));
        if (saved && typeof saved.lastIdx === 'number' && saved.lastIdx > 0) {
          setTimeout(function () {
            if (!_isOver() && typeof renderQuestion === 'function') {
              renderQuestion(saved.lastIdx);
            }
          }, 400);
        }
      } catch (e) { /* silent */ }
    }

    console.log('[ECE Navigation] Active.', _caps);
  }

  /* ============================================
     PUBLIC: eceNavigationOnRender
     Called by exam.js after every renderQuestion().
     Updates action bar and dot states for current q.
  ============================================ */
  function eceNavigationOnRender (idx) {
    if (!_active) { return; }

    /* Save last viewed position */
    if (_caps.resume_session || _caps.autosave) {
      _saveNavState(idx);
    }

    /* Refresh action bar button states */
    if (_caps.bookmarking || _caps.flag_review) {
      _refreshActionBar(idx);
    }
  }

  /* ============================================
     PUBLIC: eceNavigationUpdateDot
     Called by exam.js after updateQDot() to add
     bookmark and flag CSS classes to q-dot elements.
  ============================================ */
  function eceNavigationUpdateDot (idx) {
    if (!_active) { return; }
    if (!_caps.bookmarking && !_caps.flag_review && !_caps.question_palette) { return; }

    if (typeof _questions === 'undefined') { return; }
    _questions.forEach(function (q, i) {
      var dot = document.getElementById('qdot_' + i);
      if (!dot) { return; }
      var qId = q._id ? q._id.toString() : '';

      /* Remove existing ECE classes then re-add */
      dot.classList.remove('ece-bookmarked', 'ece-flagged');
      if (_bookmarks[qId]) { dot.classList.add('ece-bookmarked'); }
      if (_flags[qId])     { dot.classList.add('ece-flagged');    }

      /* Update tooltip */
      var parts = [String(i + 1)];
      if (_bookmarks[qId]) { parts.push('🔖'); }
      if (_flags[qId])     { parts.push('🚩'); }
      dot.title = parts.join(' ');
    });
  }

  /* ============================================
     PUBLIC: eceNavigationInterceptSubmit
     Called at the top of exam.js confirmSubmit().
     Returns true  → navigation module handled submit
                     (exam.js should return early)
     Returns false → navigation module did not intercept
                     (exam.js continues with confirm())
  ============================================ */
  function eceNavigationInterceptSubmit () {
    if (!_active || !_caps.review_mode) { return false; }
    if (_isOver()) { return false; }

    try {
      _showReviewScreen();
      return true;
    } catch (e) {
      console.warn('[ECE Navigation] Review screen error — falling through to default submit:', e.message);
      return false;
    }
  }

  /* ============================================
     CONFIG LOAD
  ============================================ */
  async function _loadConfig () {
    try {
      var res = await apiRequest('/ece/exam-navigation');
      if (!res.ok || !res.data || !res.data.navigation) { return false; }
      var n = res.data.navigation;
      Object.keys(_caps).forEach(function (k) {
        if (n[k] !== undefined) { _caps[k] = !!n[k]; }
      });
      return true;
    } catch (e) {
      console.warn('[ECE Navigation] Config load failed:', e.message);
      return false;
    }
  }

  /* ============================================
     STATE PERSISTENCE
  ============================================ */
  function _saveNavState (currentIdx) {
    try {
      var idx = (typeof currentIdx === 'number')
        ? currentIdx
        : (typeof _currentIdx !== 'undefined' ? _currentIdx : 0);
      sessionStorage.setItem(_navStateKey(), JSON.stringify({
        bookmarks: _bookmarks,
        flags:     _flags,
        lastIdx:   idx,
        savedAt:   Date.now()
      }));
    } catch (e) { /* sessionStorage full or blocked */ }
  }

  function _restoreNavState () {
    try {
      var raw = sessionStorage.getItem(_navStateKey());
      if (!raw) { return; }
      var saved = JSON.parse(raw);
      if (saved.bookmarks && typeof saved.bookmarks === 'object') {
        _bookmarks = saved.bookmarks;
      }
      if (saved.flags && typeof saved.flags === 'object') {
        _flags = saved.flags;
      }
    } catch (e) { /* corrupt data — start fresh */ }
  }

  /* ============================================
     AUTOSAVE
  ============================================ */
  function _initAutosave () {
    /* exam.js already saves on every answer selection.
       This adds a time-based save of the full nav state
       every 30 seconds as a belt-and-suspenders backup. */
    _autosaveInterval = setInterval(function () {
      if (_isOver()) {
        clearInterval(_autosaveInterval);
        return;
      }
      _saveNavState();
      /* Also sync answers in case selectAnswer hasn't fired recently */
      if (typeof _answers !== 'undefined') {
        try { sessionStorage.setItem('cbtAnswers', JSON.stringify(_answers)); } catch (e) {}
      }
    }, 30000);

    console.log('[ECE Navigation] Autosave active — 30s interval.');
  }

  /* ============================================
     ACTION BAR (bookmark + flag buttons)
     Injected below .q-counter, above .q-text.
  ============================================ */
  function _injectActionBar () {
    /* Avoid double-injection */
    if (document.getElementById('eceActionBar')) { return; }

    /* Inject ECE dot styles into head */
    _injectDotStyles();

    var bar       = document.createElement('div');
    bar.id        = 'eceActionBar';
    Object.assign(bar.style, {
      display:        'flex',
      alignItems:     'center',
      gap:            '8px',
      marginBottom:   '12px',
      flexWrap:       'wrap'
    });

    if (_caps.bookmarking) {
      var bBtn       = document.createElement('button');
      bBtn.id        = 'eceBookmarkBtn';
      bBtn.innerHTML = '🔖 Bookmark';
      bBtn.onclick   = function () { _toggleBookmark(); };
      _styleActionBtn(bBtn, false);
      bar.appendChild(bBtn);
    }

    if (_caps.flag_review) {
      var fBtn       = document.createElement('button');
      fBtn.id        = 'eceFlagBtn';
      fBtn.innerHTML = '🚩 Flag';
      fBtn.onclick   = function () { _toggleFlag(); };
      _styleActionBtn(fBtn, false);
      bar.appendChild(fBtn);
    }

    /* Status label — shows "Bookmarked ✓" etc. */
    var statusLbl   = document.createElement('span');
    statusLbl.id    = 'eceActionStatus';
    Object.assign(statusLbl.style, {
      fontSize:   '12px',
      color:      'var(--text-muted, #6b6b8a)',
      marginLeft: '4px'
    });
    bar.appendChild(statusLbl);

    /* Insert after .q-counter */
    var counter = document.getElementById('qCounter');
    var body    = document.getElementById('examBody');
    if (counter && counter.parentNode) {
      counter.parentNode.insertBefore(bar, counter.nextSibling);
    } else if (body) {
      body.insertBefore(bar, body.firstChild);
    }
  }

  function _styleActionBtn (btn, isActive) {
    Object.assign(btn.style, {
      padding:     '5px 12px',
      borderRadius:'8px',
      fontSize:    '12px',
      fontWeight:  '700',
      cursor:      'pointer',
      fontFamily:  'inherit',
      border:      isActive
        ? '1px solid rgba(167,139,250,0.5)'
        : '1px solid var(--border, rgba(255,255,255,0.08))',
      background:  isActive
        ? 'rgba(167,139,250,0.15)'
        : 'rgba(255,255,255,0.04)',
      color:       isActive ? '#a78bfa' : 'var(--text-secondary, #a0a0c0)',
      transition:  'all 0.15s'
    });
  }

  function _refreshActionBar (idx) {
    if (typeof _questions === 'undefined' || !_questions[idx]) { return; }
    var qId       = (_questions[idx]._id || '').toString();
    var isBookmarked = !!_bookmarks[qId];
    var isFlagged    = !!_flags[qId];

    var bBtn = document.getElementById('eceBookmarkBtn');
    var fBtn = document.getElementById('eceFlagBtn');
    var sLbl = document.getElementById('eceActionStatus');

    if (bBtn) {
      _styleActionBtn(bBtn, isBookmarked);
      bBtn.innerHTML = isBookmarked ? '🔖 Bookmarked' : '🔖 Bookmark';
    }
    if (fBtn) {
      _styleActionBtn(fBtn, isFlagged);
      fBtn.innerHTML = isFlagged ? '🚩 Flagged' : '🚩 Flag';
    }
    if (sLbl) {
      var parts = [];
      if (isBookmarked) { parts.push('Bookmarked'); }
      if (isFlagged)    { parts.push('Flagged for review'); }
      sLbl.textContent = parts.join(' · ');
    }
  }

  function _toggleBookmark () {
    if (typeof _questions === 'undefined' || typeof _currentIdx === 'undefined') { return; }
    var q   = _questions[_currentIdx];
    if (!q) { return; }
    var qId = (q._id || '').toString();
    if (_bookmarks[qId]) { delete _bookmarks[qId]; }
    else                 { _bookmarks[qId] = true; }
    _saveNavState();
    _refreshActionBar(_currentIdx);
    eceNavigationUpdateDot(_currentIdx);
  }

  function _toggleFlag () {
    if (typeof _questions === 'undefined' || typeof _currentIdx === 'undefined') { return; }
    var q   = _questions[_currentIdx];
    if (!q) { return; }
    var qId = (q._id || '').toString();
    if (_flags[qId]) { delete _flags[qId]; }
    else             { _flags[qId] = true; }
    _saveNavState();
    _refreshActionBar(_currentIdx);
    eceNavigationUpdateDot(_currentIdx);
  }

  /* ============================================
     ENHANCED PALETTE CSS
  ============================================ */
  function _injectDotStyles () {
    if (document.getElementById('eceNavStyles')) { return; }
    var style       = document.createElement('style');
    style.id        = 'eceNavStyles';
    style.textContent =
      /* Bookmarked dot: purple tint */
      '.q-dot.ece-bookmarked { ' +
        'background:rgba(167,139,250,0.15) !important; ' +
        'border-color:rgba(167,139,250,0.4) !important; ' +
        'color:#a78bfa !important; ' +
      '}' +
      /* Flagged dot: orange tint */
      '.q-dot.ece-flagged { ' +
        'background:rgba(255,165,0,0.15) !important; ' +
        'border-color:rgba(255,165,0,0.4) !important; ' +
        'color:#ffa500 !important; ' +
      '}' +
      /* Bookmarked + answered: show bookmark wins */
      '.q-dot.ece-bookmarked.answered { ' +
        'background:rgba(167,139,250,0.2) !important; ' +
      '}' +
      /* Flagged + answered: show flag wins */
      '.q-dot.ece-flagged.answered { ' +
        'background:rgba(255,165,0,0.2) !important; ' +
      '}' +
      /* Palette legend additions */
      '#eceNavLegend { ' +
        'margin-top:16px; font-size:12px; ' +
        'color:var(--text-muted,#6b6b8a); line-height:2; ' +
      '}';
    document.head.appendChild(style);
  }

  function _enhancePalette () {
    /* Add legend entries for bookmark and flag to q-grid panel */
    var existing = document.querySelector('.q-grid-panel > div:last-child');
    if (!existing) { return; }

    var legend   = document.createElement('div');
    legend.id    = 'eceNavLegend';
    legend.innerHTML =
      (_caps.bookmarking
        ? '<span style="display:inline-block;width:12px;height:12px;' +
          'background:rgba(167,139,250,0.3);border-radius:3px;margin-right:6px;"></span>Bookmarked<br>'
        : '') +
      (_caps.flag_review
        ? '<span style="display:inline-block;width:12px;height:12px;' +
          'background:rgba(255,165,0,0.3);border-radius:3px;margin-right:6px;"></span>Flagged<br>'
        : '');
    existing.parentNode.insertBefore(legend, existing.nextSibling);
  }

  /* ============================================
     KEYBOARD SHORTCUTS
     1/2/3/4   → select answer option
     N / →     → next question
     P / ←     → previous question
     B         → toggle bookmark
     F         → toggle flag
     R         → open review screen (if enabled)
     G         → toggle question grid
  ============================================ */
  function _initKeyboard () {
    document.addEventListener('keydown', function (e) {
      /* Never fire when focus is inside an input or textarea */
      var tag = document.activeElement ? document.activeElement.tagName : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { return; }

      /* Never fire after exam is over */
      if (_isOver()) { return; }

      /* Never fire when a modal overlay is visible */
      var grid    = document.getElementById('qGridOverlay');
      var review  = document.getElementById('eceReviewOverlay');
      var gridOpen   = grid   && grid.classList.contains('open');
      var reviewOpen = review && review.style.display !== 'none';

      switch (e.key) {
        case '1': _selectOption(0); break;
        case '2': _selectOption(1); break;
        case '3': _selectOption(2); break;
        case '4': _selectOption(3); break;

        case 'ArrowRight':
        case 'n':
        case 'N':
          if (!gridOpen && !reviewOpen) {
            e.preventDefault();
            if (typeof nextQuestion === 'function') { nextQuestion(); }
          }
          break;

        case 'ArrowLeft':
        case 'p':
        case 'P':
          if (!gridOpen && !reviewOpen) {
            e.preventDefault();
            if (typeof prevQuestion === 'function') { prevQuestion(); }
          }
          break;

        case 'b':
        case 'B':
          if (_caps.bookmarking && !gridOpen && !reviewOpen) {
            e.preventDefault();
            _toggleBookmark();
          }
          break;

        case 'f':
        case 'F':
          if (_caps.flag_review && !gridOpen && !reviewOpen) {
            e.preventDefault();
            _toggleFlag();
          }
          break;

        case 'r':
        case 'R':
          if (_caps.review_mode && !gridOpen && !reviewOpen) {
            e.preventDefault();
            _showReviewScreen();
          }
          break;

        case 'g':
        case 'G':
          if (!reviewOpen) {
            e.preventDefault();
            if (typeof toggleQGrid === 'function') { toggleQGrid(); }
          }
          break;

        case 'Escape':
          if (reviewOpen) { _hideReviewScreen(); }
          break;
      }
    });

    console.log('[ECE Navigation] Keyboard shortcuts active. ' +
      '1-4: answer, N/P: navigate, B: bookmark, F: flag, R: review, G: grid.');
  }

  function _selectOption (idx) {
    if (typeof _questions === 'undefined' || typeof _currentIdx === 'undefined') { return; }
    var options = document.querySelectorAll('.option-btn');
    if (idx < options.length && typeof selectAnswer === 'function') {
      selectAnswer(idx);
    }
  }

  /* ============================================
     REVIEW SCREEN
     Full-screen overlay showing all questions
     with their answered/unanswered/bookmark/flag
     status before final submission.
  ============================================ */
  function _showReviewScreen () {
    if (typeof _questions === 'undefined') { return; }

    var overlay = document.getElementById('eceReviewOverlay');
    if (!overlay) { return; }

    /* ---- Calculate stats ---- */
    var answered    = 0;
    var unanswered  = 0;
    var bookmarked  = 0;
    var flagged     = 0;

    _questions.forEach(function (q) {
      var qId = (q._id || '').toString();
      if (typeof _answers !== 'undefined' && _answers[qId] !== undefined) {
        answered++;
      } else {
        unanswered++;
      }
      if (_bookmarks[qId]) { bookmarked++; }
      if (_flags[qId])     { flagged++;    }
    });

    /* ---- Populate stats ---- */
    var statsEl = document.getElementById('eceReviewStats');
    if (statsEl) {
      statsEl.innerHTML =
        _reviewStat('✅', answered,   'Answered',    '#43e97b') +
        _reviewStat('⬜', unanswered, 'Unanswered',  '#ff6584') +
        (bookmarked > 0
          ? _reviewStat('🔖', bookmarked, 'Bookmarked', '#a78bfa')
          : '') +
        (flagged > 0
          ? _reviewStat('🚩', flagged,    'Flagged',    '#ffa500')
          : '');
    }

    /* ---- Populate question grid ---- */
    var gridEl = document.getElementById('eceReviewGrid');
    if (gridEl) {
      gridEl.innerHTML = _questions.map(function (q, i) {
        var qId          = (q._id || '').toString();
        var isAnswered   = typeof _answers !== 'undefined' && _answers[qId] !== undefined;
        var isBookmarked = !!_bookmarks[qId];
        var isFlagged    = !!_flags[qId];

        var bgColor  = isAnswered   ? 'rgba(67,233,123,0.12)'    : 'rgba(255,101,132,0.08)';
        var bdColor  = isAnswered   ? 'rgba(67,233,123,0.3)'     : 'rgba(255,101,132,0.2)';
        var txtColor = isAnswered   ? '#43e97b'                  : '#ff6584';
        if (isBookmarked) { bgColor = 'rgba(167,139,250,0.12)'; bdColor = 'rgba(167,139,250,0.3)'; txtColor = '#a78bfa'; }
        if (isFlagged)    { bgColor = 'rgba(255,165,0,0.12)';   bdColor = 'rgba(255,165,0,0.3)';   txtColor = '#ffa500'; }

        return '<div onclick="eceNavGoTo(' + i + ')" ' +
          'title="Q' + (i + 1) + (isBookmarked ? ' · Bookmarked' : '') + (isFlagged ? ' · Flagged' : '') + '" ' +
          'style="width:40px; height:40px; border-radius:8px; display:flex; ' +
            'align-items:center; justify-content:center; cursor:pointer; ' +
            'font-size:12px; font-weight:800; ' +
            'background:' + bgColor + '; border:1px solid ' + bdColor + '; ' +
            'color:' + txtColor + '; transition:all 0.15s; ' +
            'position:relative; flex-shrink:0;">' +
          (i + 1) +
          (isBookmarked ? '<span style="position:absolute;top:-4px;right:-4px;font-size:9px;">🔖</span>' : '') +
          (isFlagged    ? '<span style="position:absolute;top:-4px;right:-4px;font-size:9px;">🚩</span>' : '') +
        '</div>';
      }).join('');
    }

    overlay.style.display = 'flex';

    /* Keyboard: Escape closes review, handled in _initKeyboard */
  }

  function _hideReviewScreen () {
    var overlay = document.getElementById('eceReviewOverlay');
    if (overlay) { overlay.style.display = 'none'; }
  }

  function _reviewStat (icon, count, label, color) {
    return '<div style="text-align:center; background:rgba(255,255,255,0.03); ' +
      'border-radius:10px; padding:12px 16px;">' +
      '<div style="font-size:22px;">' + icon + '</div>' +
      '<div style="font-size:22px; font-weight:900; color:' + color + '; line-height:1;">' + count + '</div>' +
      '<div style="font-size:11px; color:var(--text-muted,#6b6b8a); text-transform:uppercase; ' +
        'letter-spacing:0.4px; margin-top:3px;">' + label + '</div>' +
    '</div>';
  }

  /* Called from review grid cell onclick (global needed for inline onclick) */
  global.eceNavGoTo = function (idx) {
    _hideReviewScreen();
    setTimeout(function () {
      if (typeof renderQuestion === 'function') { renderQuestion(idx); }
    }, 150);
  };

  /* Final submit from review screen */
  global.eceReviewSubmit = function () {
    _hideReviewScreen();
    setTimeout(function () {
      if (typeof submitExam === 'function') { submitExam(false); }
    }, 150);
  };

  global.eceReviewClose = function () {
    _hideReviewScreen();
  };

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
  global.eceNavigationInit            = eceNavigationInit;
  global.eceNavigationOnRender        = eceNavigationOnRender;
  global.eceNavigationUpdateDot       = eceNavigationUpdateDot;
  global.eceNavigationInterceptSubmit = eceNavigationInterceptSubmit;

  /* ece-core.js compatible interface */
  global.ECENavigation = {
    init: function (flatConfig) {
      if (_active) { return; }
      Object.keys(_caps).forEach(function (k) {
        if (flatConfig[k] !== undefined) { _caps[k] = !!flatConfig[k]; }
      });
      var anyEnabled = Object.keys(_caps).some(function (k) { return _caps[k]; });
      if (!anyEnabled) { return; }
      _active = true;
      _restoreNavState();
      if (_caps.keyboard_shortcuts) { _initKeyboard();  }
      if (_caps.autosave)           { _initAutosave();  }
      if (_caps.bookmarking || _caps.flag_review) { _injectActionBar(); }
      if (_caps.question_palette)   { _enhancePalette(); }
    },
    renderCurrent: eceNavigationOnRender
  };

}(window));