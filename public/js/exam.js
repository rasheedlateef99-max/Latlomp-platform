/* ============================================
   LATLOMP PLATFORM — EXAM.JS
   
   FIXES IN THIS VERSION:
   1. Timer persists across page refresh
   2. Submission retries gracefully on failure
   3. Duplicate submission prevented
   4. Answer payload verified before sending
============================================ */

var _session      = null;
var _questions    = [];
var _answers      = {};
var _currentIdx   = 0;
var _timerInterval = null;
var _timeLeft     = 0;
var _submitted    = false;
var _startTime    = Date.now();
var _currentSubjectId = null;

/* ✅ FINAL STEP: Component switching state.
   _allQuestions = complete list from session (all types).
   _componentMap = { objective: [...], theory: [...] }
   _activeComponent = currently displayed type. */
var _allQuestions    = [];
var _componentMap    = {};
var _activeComponent = 'objective';
var _isMultiComp     = false;


/* ============================================
   ✅ STEP 2 — ENSURE THEORY TEXTAREA EXISTS

   exam.html may not have the theoryAnswer element
   if Step 2 HTML changes were not applied.
   This function injects it defensively — safe to
   call even when the element already exists.

   Placement: immediately after optionsList so
   the textarea appears in the same DOM position
   where options normally appear.
============================================ */
function _ensureTheoryTextarea() {
  if (document.getElementById('theoryAnswer')) {
    /* Already exists — ensure event listener is attached */
    var existing = document.getElementById('theoryAnswer');
    if (!existing._theoryListenerAttached) {
      existing.addEventListener('input', saveTheoryAnswer);
      existing._theoryListenerAttached = true;
    }
    return;
  }

  var ta       = document.createElement('textarea');
  ta.id        = 'theoryAnswer';
  ta.rows      = 9;
  ta.placeholder =
    'Write your answer here...\n\n' +
    'For multi-part questions:\n' +
    '(a) Answer to part (a)\n' +
    '(b) Answer to part (b)';
  ta.style.cssText = [
    'width:100%',
    'min-height:220px',
    'resize:vertical',
    'background:rgba(255,255,255,0.04)',
    'border:1px solid rgba(255,255,255,0.12)',
    'border-radius:10px',
    'padding:14px 16px',
    'color:#fff',
    'font-size:15px',
    'font-family:inherit',
    'outline:none',
    'line-height:1.7',
    'box-sizing:border-box',
    'display:none',
    'margin-top:8px',
    'transition:border-color 0.2s'
  ].join(';');

  ta.addEventListener('input', saveTheoryAnswer);
  ta.addEventListener('focus', function() { ta.style.borderColor = '#43e97b'; });
  ta.addEventListener('blur',  function() { ta.style.borderColor = 'rgba(255,255,255,0.12)'; });
  ta._theoryListenerAttached = true;

  /* Insert after optionsList — same visual position */
  var ref = document.getElementById('optionsList');
  if (ref && ref.parentNode) {
    ref.parentNode.insertBefore(ta, ref.nextSibling);
  } else {
    /* Fallback: insert into question area or body */
    var area = document.getElementById('questionArea') ||
               document.getElementById('examBody')     ||
               document.getElementById('examApp')      ||
               document.body;
    area.appendChild(ta);
  }
}

/* ============================================
   INIT
============================================ */
document.addEventListener('DOMContentLoaded', function() {
  if (!requireLogin('cbt-start.html')) return;

  var raw = sessionStorage.getItem('cbtSession');

  if (!raw) {
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('noSessionScreen').style.display = 'flex';
    return;
  }

  try {
    _session   = JSON.parse(raw);
    _questions = _session.questions || [];
  } catch (e) {
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('noSessionScreen').style.display = 'flex';
    return;
  }

  /* ✅ FINAL STEP: Initialise component switching.
     Must run before the _questions.length === 0 check
     so _questions is correctly set to the first component. */
  _allQuestions = _questions.slice();
  _initComponents();

  if (_questions.length === 0) {
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('noSessionScreen').style.display = 'flex';
    return;
  }

  /* ✅ STEP 2: Inject theory textarea early — before any renderQuestion()
     call so getElementById('theoryAnswer') always finds the element. */
  _ensureTheoryTextarea();

  /* ✅ FIX: Timer persistence across refresh
     Store { startTime, totalSeconds } in sessionStorage.
     On next load, calculate remaining from elapsed time.
  */
  var timerKey   = 'cbtTimerState_' + (_session.examCategory || 'session');
  var savedTimer = null;
  try { savedTimer = JSON.parse(sessionStorage.getItem(timerKey)); } catch (e) {}

  if (savedTimer && savedTimer.startTime && savedTimer.totalSeconds) {
    var elapsed = Math.floor((Date.now() - savedTimer.startTime) / 1000);
    _timeLeft   = Math.max(0, savedTimer.totalSeconds - elapsed);
    _startTime  = savedTimer.startTime;
  } else {
    _timeLeft  = _session.totalTimeSeconds || 0;
    _startTime = Date.now();
    sessionStorage.setItem(timerKey, JSON.stringify({
      startTime:    _startTime,
      totalSeconds: _timeLeft
    }));
  }

  /* Restore saved answers if page was refreshed */
  var savedAnswers = null;
  try { savedAnswers = JSON.parse(sessionStorage.getItem('cbtAnswers')); } catch (e) {}
  if (savedAnswers && typeof savedAnswers === 'object') {
    _answers = savedAnswers;
  }

  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('examApp').style.display       = 'flex';

  /* If time already ran out (e.g., user came back after session expired) */
  if (_timeLeft <= 0) {
    autoSubmit();
    return;
  }

  /* Show first subject banner */
  showSubjectBanner(0, function() {
    renderQuestion(0);
    startTimer();
    buildQGrid();
    /* ✅ ECE Phase 2: Security Module */
    if (typeof eceSecurityInit    === 'function') { eceSecurityInit();    }
    /* ✅ ECE Phase 3: Rendering Module */
    if (typeof eceRenderingInit   === 'function') { eceRenderingInit();   }
    /* ✅ ECE Phase 4: Navigation Module */
    if (typeof eceNavigationInit === 'function') { eceNavigationInit(); }
    /* ✅ ECE Phase 5: Rules Engine — reads _session.rules for display */
    if (typeof eceRulesInit      === 'function') { eceRulesInit();      }
  });

  /* Prevent accidental navigation */
  window.history.pushState({ exam: true }, '');
  window.addEventListener('popstate', function() {
    if (!_submitted) {
      window.history.pushState({ exam: true }, '');
      confirmQuit();
    }
  });

  window.addEventListener('beforeunload', function(e) {
    if (!_submitted) {
      e.preventDefault();
      e.returnValue = 'Your exam is in progress. Are you sure you want to leave?';
    }
  });
});

/* ============================================
   ✅ FINAL STEP — COMPONENT SWITCHING
   
   _initComponents():
     Partitions _allQuestions by questionType.
     If > 1 type found, builds tab bar and sets
     _questions to the first available component.
     If only 1 type, tab bar stays hidden and
     behavior is identical to the previous version.
   
   switchComponent(type):
     Saves current index per-component, switches
     _questions filter, re-renders from saved index
     (or 0 for first visit).
   
   _buildCompTabs():
     Renders tab buttons into #compTabBar.
     Auto-detects icon and label per type.
============================================ */

/* Per-component index memory — preserves position when switching */
var _compIndex = {};

var _COMP_INFO = {
  objective:     { icon: '🔘', label: 'Objective',     order: 0 },
  theory:        { icon: '📝', label: 'Theory / Essay', order: 1 },
  fill_in_blank: { icon: '✏️', label: 'Fill in Blank', order: 2 },
  true_false:    { icon: '✅', label: 'True / False',  order: 3 },
  practical:     { icon: '🔬', label: 'Practical',     order: 4 },
  oral:          { icon: '🎤', label: 'Oral',           order: 5 }
};

function _initComponents() {
  _componentMap = {};

  /* Partition questions by type */
  _allQuestions.forEach(function(q) {
    /* Normalise: any non-theory type defaults to 'objective' for rendering
       but keeps its original type for the component map */
    var type = q.questionType || 'objective';
    if (!_componentMap[type]) { _componentMap[type] = []; }
    _componentMap[type].push(q);
  });

  var typeKeys = Object.keys(_componentMap);
  _isMultiComp = (typeKeys.length > 1);

  if (!_isMultiComp) {
    /* Single component — no tabs, no change to existing behavior */
    _questions       = _allQuestions;
    _activeComponent = typeKeys[0] || 'objective';
    return;
  }

  /* Multi-component: default to first type in order */
  var orderedTypes = typeKeys.sort(function(a, b) {
    var oa = (_COMP_INFO[a] || { order: 99 }).order;
    var ob = (_COMP_INFO[b] || { order: 99 }).order;
    return oa - ob;
  });

  _activeComponent = orderedTypes[0];
  _questions       = _componentMap[_activeComponent] || [];

  /* Build tab bar UI */
  _buildCompTabs(orderedTypes);
}

function _buildCompTabs(types) {
  var tabBar = document.getElementById('compTabBar');
  if (!tabBar) { return; }

  tabBar.innerHTML = types.map(function(type) {
    var info  = _COMP_INFO[type] || { icon: '📝', label: type };
    var count = (_componentMap[type] || []).length;
    var isActive = (type === _activeComponent);
    return '<button class="comp-tab-btn' + (isActive ? ' active' : '') + '" ' +
      'role="tab" aria-selected="' + isActive + '" ' +
      'data-comp="' + type + '" ' +
      'onclick="switchComponent(\'' + type + '\')">' +
      info.icon + ' ' + info.label +
      '<span class="comp-tab-count">' + count + '</span>' +
    '</button>';
  }).join('');

  tabBar.style.display = 'flex';
}

function switchComponent(type) {
  if (!_componentMap[type]) { return; }
  if (type === _activeComponent) { return; }

  /* Save current position before switching */
  _compIndex[_activeComponent] = _currentIdx;

  /* Switch */
  _activeComponent = type;
  _questions       = _componentMap[type] || [];

  /* Update tab active state */
  document.querySelectorAll('.comp-tab-btn').forEach(function(btn) {
    var isActive = (btn.dataset.comp === type);
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  /* Restore previous position for this component, or start at 0 */
  var restoreIdx = _compIndex[type] !== undefined ? _compIndex[type] : 0;
  _currentIdx    = Math.min(restoreIdx, _questions.length - 1);

  /* Rebuild grid and render */
  buildQGrid();
  renderQuestion(_currentIdx);

  /* Scroll exam body to top */
  var body = document.getElementById('examBody');
  if (body) { body.scrollTop = 0; }
}

/* ============================================
   SUBJECT BANNER
============================================ */
function showSubjectBanner(questionIdx, callback) {
  var q = _questions[questionIdx];
  if (!q) { if (callback) callback(); return; }

  var subjectId   = q._subjectId   || '';
  var subjectName = q._subjectName || '';

  if (subjectId === _currentSubjectId) {
    if (callback) callback();
    return;
  }

  _currentSubjectId = subjectId;

  var subjectInfo = (_session.subjects || []).find(function(s) {
    return s.subjectId.toString() === subjectId;
  });

  var banner = document.createElement('div');
  banner.className = 'subject-banner';
  banner.innerHTML =
    '<span class="subject-banner-icon">📝</span>' +
    '<h2>' + subjectName + '</h2>' +
    '<p>' + (subjectInfo ? subjectInfo.questionCount + ' questions · ' + subjectInfo.timeLimit + ' minutes' : '') + '</p>' +
    (subjectInfo && subjectInfo.instructions ? '<p style="color:var(--text-secondary); max-width:400px; text-align:center; line-height:1.6;">' + subjectInfo.instructions + '</p>' : '') +
    '<p style="color:var(--text-muted); font-size:12px;">Tap anywhere to begin</p>';

  banner.addEventListener('click', function() {
    banner.remove();
    if (callback) callback();
  });

  document.body.appendChild(banner);
}

/* ============================================
   RENDER QUESTION
============================================ */
function renderQuestion(idx) {
  if (idx < 0 || idx >= _questions.length) return;
  _currentIdx = idx;

  var q       = _questions[idx];
  var letters = ['A', 'B', 'C', 'D', 'E'];

  /* Subject changed? Show banner */
  if (q._subjectId && q._subjectId !== _currentSubjectId) {
    showSubjectBanner(idx, function() {
      renderQuestion(idx);
    });
    return;
  }

  /* Counter — shows per-component count when multi-component */
  var counterText = _isMultiComp
    ? 'Question ' + (idx + 1) + ' of ' + _questions.length +
      ' (' + (_COMP_INFO[_activeComponent] || { label: _activeComponent }).label + ')'
    : 'Question ' + (idx + 1) + ' of ' + _questions.length;
  document.getElementById('qCounter').textContent = counterText;

  /* Question text */
  document.getElementById('qText').textContent = q.question || '';

  /* ✅ FINAL STEP: Universal answer renderer.
     Selects the correct input UI based on question type.
     Extensible: add new types by adding cases to renderAnswer(). */
  var listEl      = document.getElementById('optionsList');
  var theoryEl    = document.getElementById('theoryAnswer');
  var qId         = q._id ? q._id.toString() : '';
  var savedAnswer = _answers[qId];

  _ensureTheoryTextarea();   /* defensive: ensure textarea exists in DOM */
  theoryEl = document.getElementById('theoryAnswer');  /* re-read after ensure */

  renderAnswer(q, listEl, theoryEl, qId, savedAnswer, letters);

  /* Question type badge */
  var qTypeBadge = document.getElementById('qTypeBadge');
  if (qTypeBadge) {
    var badgeInfo = {
      theory:        { text: '📝 Theory',      bg: 'rgba(255,165,0,0.1)',    color: '#ffa500' },
      fill_in_blank: { text: '✏️ Fill-In',     bg: 'rgba(67,233,123,0.1)',  color: '#43e97b' },
      true_false:    { text: '✅ True/False',   bg: 'rgba(67,233,123,0.1)',  color: '#43e97b' },
      objective:     { text: '🔘 Objective',   bg: 'rgba(108,99,255,0.12)', color: '#a78bfa' }
    };
    var bi = badgeInfo[q.questionType] || badgeInfo.objective;
    qTypeBadge.textContent       = bi.text;
    qTypeBadge.style.background  = bi.bg;
    qTypeBadge.style.color       = bi.color;
    qTypeBadge.style.display     = 'inline-block';
  }

  /* Subject tag in topbar */
  document.getElementById('examSubjectTag').textContent =
    (q._subjectName || '') + ' · ' + (_session.examCategory || '').toUpperCase();

  /* Progress bar */
  var pct = ((idx + 1) / _questions.length) * 100;
  document.getElementById('progressFill').style.width = pct + '%';

  /* Nav buttons */
  document.getElementById('prevBtn').disabled = idx === 0;
  var isLast = idx === _questions.length - 1;
  document.getElementById('nextBtn').style.display   = isLast ? 'none'  : 'block';
  document.getElementById('submitBtn').style.display = isLast ? 'block' : 'none';

  /* Scroll to top of question area */
  var body = document.getElementById('examBody');
  if (body) body.scrollTop = 0;

  updateQDot(idx);

 /* ✅ ECE Phase 3: Rendering */
  if (typeof eceRenderingApply    === 'function') { eceRenderingApply();     }
  /* ✅ ECE Phase 4: Navigation per-question hook (action bar + state save) */
  if (typeof eceNavigationOnRender === 'function') { eceNavigationOnRender(idx); }

  /* ✅ ECE Phase 4: Navigation dot enhancement (bookmark/flag CSS classes) */
  if (typeof eceNavigationUpdateDot === 'function') { eceNavigationUpdateDot(idx); }
}

/* ============================================
   ✅ FINAL STEP — UNIVERSAL ANSWER RENDERER
   
   Selects the correct input UI based on question type.
   Called by renderQuestion() on every navigation.
   
   Supported types:
     objective     → A/B/C/D buttons
     true_false    → True / False buttons
     fill_in_blank → single-line text input
     theory/essay  → resizable textarea
   
   Adding a new type: add a case to the switch statement.
   All types write to _answers[qId] via the same mechanism.
============================================ */
function renderAnswer(q, listEl, theoryEl, qId, savedAnswer, letters) {
  var type    = q.questionType || 'objective';
  var options = q.options || [];

  /* Reset all input areas */
  if (theoryEl) {
    theoryEl.style.display = 'none';
    theoryEl.value         = '';
    /* Remove fill-in-blank input if present */
    var fibEl = document.getElementById('fibAnswer');
    if (fibEl) { fibEl.style.display = 'none'; fibEl.value = ''; }
  }

  switch (type) {

    /* ---- THEORY / ESSAY ---- */
    case 'theory':
    case 'essay':
      if (listEl) { listEl.innerHTML = ''; listEl.style.display = 'none'; }
      if (theoryEl) {
        theoryEl.style.display = 'block';
        theoryEl.dataset.qid   = qId;
        theoryEl.value         = (typeof savedAnswer === 'string') ? savedAnswer : '';
        theoryEl.placeholder   = 'Write your answer here...\n\n' +
          'For multi-part questions:\n(a) Answer to part (a)\n(b) Answer to part (b)';
        setTimeout(function() { if (theoryEl) theoryEl.focus && theoryEl.focus(); }, 80);
      }
      break;

    /* ---- FILL IN THE BLANK ---- */
    case 'fill_in_blank':
      if (listEl) { listEl.innerHTML = ''; listEl.style.display = 'none'; }
      /* Inject a text input if not present */
      var fibInp = document.getElementById('fibAnswer');
      if (!fibInp) {
        fibInp       = document.createElement('input');
        fibInp.type  = 'text';
        fibInp.id    = 'fibAnswer';
        fibInp.style.cssText =
          'width:100%; padding:16px 18px; border-radius:12px;' +
          'background:rgba(255,255,255,0.04);' +
          'border:2px solid rgba(255,255,255,0.08);' +
          'color:#fff; font-size:16px; font-family:inherit;' +
          'outline:none; box-sizing:border-box; margin-bottom:16px;' +
          'transition:border-color 0.2s;';
        fibInp.addEventListener('focus', function() { fibInp.style.borderColor = 'var(--primary,#6c63ff)'; });
        fibInp.addEventListener('blur',  function() { fibInp.style.borderColor = 'rgba(255,255,255,0.08)'; });
        fibInp.addEventListener('input', function() {
          _answers[fibInp.dataset.qid || ''] = fibInp.value;
          try { sessionStorage.setItem('cbtAnswers', JSON.stringify(_answers)); } catch(e) {}
          updateQDot(_currentIdx);
        });
        if (theoryEl && theoryEl.parentNode) {
          theoryEl.parentNode.insertBefore(fibInp, theoryEl);
        }
      }
      fibInp.dataset.qid   = qId;
      fibInp.value         = (typeof savedAnswer === 'string') ? savedAnswer : '';
      fibInp.placeholder   = 'Type your answer here...';
      fibInp.style.display = 'block';
      setTimeout(function() { fibInp.focus && fibInp.focus(); }, 80);
      break;

    /* ---- TRUE / FALSE ---- */
    case 'true_false':
      if (listEl) {
        listEl.style.display = '';
        var tfOpts = ['True', 'False'];
        listEl.innerHTML = tfOpts.map(function(opt, i) {
          var isSelected = savedAnswer === i;
          return '<button class="option-btn' + (isSelected ? ' selected' : '') + '" ' +
            'onclick="selectAnswer(' + i + ')">' +
            '<span class="option-letter" style="font-size:18px;">' + (i === 0 ? '✓' : '✗') + '</span>' +
            '<span class="option-text" style="font-weight:700;">' + opt + '</span>' +
          '</button>';
        }).join('');
      }
      break;

    /* ---- OBJECTIVE / MCQ (default) ---- */
    case 'objective':
    default:
      if (theoryEl) { theoryEl.style.display = 'none'; }
      if (listEl) {
        listEl.style.display = '';
        if (options.length === 0) {
          listEl.innerHTML = '<div style="padding:20px; color:var(--text-muted,#6b6b8a); font-style:italic;">' +
            'No options available for this question.</div>';
        } else {
          listEl.innerHTML = options.map(function(opt, i) {
            var isSelected = savedAnswer === i;
            return '<button class="option-btn' + (isSelected ? ' selected' : '') + '" ' +
              'onclick="selectAnswer(' + i + ')">' +
              '<span class="option-letter">' + (letters[i] || i) + '</span>' +
              '<span class="option-text">' + opt + '</span>' +
            '</button>';
          }).join('');
        }
      }
      break;
  }
}

/* ============================================
   ANSWER SELECTION
============================================ */
function selectAnswer(optionIdx) {
  var q = _questions[_currentIdx];
  if (!q) return;

  var qId = q._id ? q._id.toString() : '';
  _answers[qId] = optionIdx;

  /* ✅ Persist answers to sessionStorage on each selection */
  try { sessionStorage.setItem('cbtAnswers', JSON.stringify(_answers)); } catch (e) {}

  /* Update option button styles */
  document.querySelectorAll('.option-btn').forEach(function(btn, i) {
    if (i === optionIdx) btn.classList.add('selected');
    else btn.classList.remove('selected');
  });

  updateQDot(_currentIdx);
}

/* ============================================
   THEORY ANSWER SAVE
   ✅ STEP 2: Called by the theory textarea oninput.
   Stores the text in _answers[qId] (same _answers
   map as objective answers — Mixed type in Result schema).
   Persists to sessionStorage identically to selectAnswer().
============================================ */
function saveTheoryAnswer() {
  var el  = document.getElementById('theoryAnswer');
  if (!el) { return; }
  var qId = el.dataset.qid;
  if (!qId) { return; }
  _answers[qId] = el.value;
  try { sessionStorage.setItem('cbtAnswers', JSON.stringify(_answers)); } catch (e) {}
  updateQDot(_currentIdx);
}

/* ============================================
   NAVIGATION
============================================ */
function prevQuestion() {
  if (_currentIdx > 0) renderQuestion(_currentIdx - 1);
}

function nextQuestion() {
  if (_currentIdx < _questions.length - 1) renderQuestion(_currentIdx + 1);
}

function goToQuestion(idx) {
  renderQuestion(idx);
  toggleQGrid();
}

/* ============================================
   QUESTION GRID
============================================ */
function buildQGrid() {
  var container = document.getElementById('qDots');
  if (!container) return;

  container.innerHTML = _questions.map(function(q, i) {
    return '<div class="q-dot" id="qdot_' + i + '" onclick="goToQuestion(' + i + ')">' + (i + 1) + '</div>';
  }).join('');
}

function updateQDot(idx) {
  _questions.forEach(function(q, i) {
    var dot = document.getElementById('qdot_' + i);
    if (!dot) return;
    var qId = q._id ? q._id.toString() : '';
    dot.className = 'q-dot' +
      (i === idx ? ' current' : '') +
      (_answers[qId] !== undefined ? ' answered' : '');
  });
}

function toggleQGrid() {
  var overlay = document.getElementById('qGridOverlay');
  if (overlay) overlay.classList.toggle('open');
}

function handleGridOverlayClick(e) {
  if (e.target.id === 'qGridOverlay') toggleQGrid();
}

/* ============================================
   TIMER
============================================ */
function startTimer() {
  updateTimerDisplay();

  _timerInterval = setInterval(function() {
    _timeLeft--;

    /* ✅ Update persisted timer every 10 seconds */
    if (_timeLeft % 10 === 0) {
      var timerKey = 'cbtTimerState_' + (_session.examCategory || 'session');
      try {
        sessionStorage.setItem(timerKey, JSON.stringify({
          startTime:    _startTime,
          totalSeconds: _session.totalTimeSeconds
        }));
      } catch (e) {}
    }

    updateTimerDisplay();

    if (_timeLeft <= 0) {
      clearInterval(_timerInterval);
      autoSubmit();
    }
  }, 1000);
}

function updateTimerDisplay() {
  var el = document.getElementById('examTimer');
  if (!el) return;

  var mins = Math.floor(Math.max(0, _timeLeft) / 60);
  var secs = Math.max(0, _timeLeft) % 60;
  el.textContent = pad(mins) + ':' + pad(secs);

  el.className = 'exam-timer';
  if (_timeLeft <= 60)       el.classList.add('danger');
  else if (_timeLeft <= 300) el.classList.add('warning');
}

function pad(n) { return n < 10 ? '0' + n : String(n); }

/* ============================================
   SUBMIT
============================================ */
function confirmSubmit() {
  /* ✅ ECE Phase 4: Review mode intercept.
     Returns true if navigation module handled the submit
     (review screen shown). Returns false to proceed normally. */
  if (typeof eceNavigationInterceptSubmit === 'function' &&
      eceNavigationInterceptSubmit()) { return; }

  var answered   = Object.keys(_answers).length;
  var unanswered = _questions.length - answered;

  var msg = 'Submit your exam?\n\n' +
    '✅ Answered: ' + answered + ' / ' + _questions.length + '\n' +
    (unanswered > 0 ? '⬜ Unanswered: ' + unanswered + ' (will be marked wrong)\n' : '') +
    '\nThis cannot be undone.';

  if (confirm(msg)) submitExam(false);
}

function autoSubmit() {
  if (_submitted) return;
  /* Small delay to avoid race with timer */
  setTimeout(function() {
    if (!_submitted) {
      alert('⏰ Time is up! Your exam is being submitted automatically.');
      submitExam(true);
    }
  }, 500);
}

/* ✅ FIX: Graceful retry on network failure */
async function submitExam(wasAuto, retryCount) {
  if (_submitted) return;
  retryCount = retryCount || 0;

  _submitted = true;
  clearInterval(_timerInterval);

  /* Disable buttons */
  ['prevBtn', 'nextBtn', 'submitBtn'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) { el.disabled = true; el.style.opacity = '0.5'; }
  });

  /* Show submitting state */
  var submitBtn = document.getElementById('submitBtn');
  if (submitBtn) submitBtn.textContent = '⏳ Submitting...';

  var timeTaken = Math.round((Date.now() - _startTime) / 1000);

  /* Build answer payload — includes both objective (number) and theory (string).
     ✅ STEP 2: Theory text answers are strings — previously filtered out by
     typeof val === 'number' check which silently dropped them.
     Empty strings are excluded: a blank textarea is not an answer. */
  var answerPayload = {};
  Object.keys(_answers).forEach(function(qId) {
    var val = _answers[qId];
    if (typeof val === 'number') {
      answerPayload[qId] = val;
    } else if (typeof val === 'string' && val.trim()) {
      answerPayload[qId] = val;
    }
  });

  try {
    /* ✅ ECE PHASE 5: Build option mappings for shuffle_options grading.
       When shuffle_options is active, session/start adds _correctAnswerIdx
       to each question. We send it back so session/submit can grade
       against the shuffled order, not the original DB order. */
    var optionMappings = {};
    if (_session && Array.isArray(_session.questions)) {
      _session.questions.forEach(function (q) {
        if (q._id && typeof q._correctAnswerIdx === 'number') {
          optionMappings[q._id.toString()] = q._correctAnswerIdx;
        }
      });
    }

    var res = await apiRequest('/cbt/session/submit', 'POST', {
      examCategory:   _session.examCategory || 'practice',
      subjectIds:     _session.selectedSubjectIds || [],
      answers:        answerPayload,
      optionMappings: optionMappings,
      timeTaken:      timeTaken,
      wasAutoSubmit:  wasAuto || false
    });

    if (res.ok) {
      /* Clean up session storage */
      var timerKey = 'cbtTimerState_' + (_session.examCategory || 'session');
      sessionStorage.removeItem(timerKey);
      sessionStorage.removeItem('cbtAnswers');

      /* Save result for result page */
      sessionStorage.setItem('cbtResult',  JSON.stringify(res.data.result));
      sessionStorage.setItem('cbtSession', JSON.stringify(_session));

      window.location.href = 'result.html';

    } else {
      console.error('Submission failed:', res.data.message);

      /* ✅ Retry once on server error (not on 4xx client errors) */
      if (res.status >= 500 && retryCount < 1) {
        _submitted = false;
        setTimeout(function() { submitExam(wasAuto, retryCount + 1); }, 2000);
        if (submitBtn) submitBtn.textContent = '⏳ Retrying...';
        return;
      }

      /* Final failure — re-enable submit */
      _submitted = false;
      if (submitBtn) { submitBtn.textContent = 'Submit ✓'; submitBtn.disabled = false; submitBtn.style.opacity = '1'; }
      ['prevBtn', 'nextBtn'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) { el.disabled = false; el.style.opacity = '1'; }
      });

      alert('Submission failed: ' + (res.data.message || 'Unknown error.') + '\n\nPlease try again. Your answers are still saved.');
    }

  } catch (networkErr) {
    console.error('Network error during submit:', networkErr.message);

    /* ✅ Retry on network error */
    if (retryCount < 2) {
      _submitted = false;
      setTimeout(function() { submitExam(wasAuto, retryCount + 1); }, 3000);
      if (submitBtn) submitBtn.textContent = '⏳ Retrying (' + (retryCount + 1) + ')...';
      return;
    }

    /* All retries exhausted */
    _submitted = false;
    if (submitBtn) { submitBtn.textContent = 'Submit ✓'; submitBtn.disabled = false; submitBtn.style.opacity = '1'; }
    ['prevBtn', 'nextBtn'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) { el.disabled = false; el.style.opacity = '1'; }
    });

    alert('Network error. Your answers are saved.\n\nPlease check your internet connection and try submitting again.');
  }
}

/* ============================================
   QUIT
============================================ */
function confirmQuit() {
  if (confirm('Quit exam? Your progress will be LOST.')) {
    _submitted = true;
    clearInterval(_timerInterval);
    var timerKey = 'cbtTimerState_' + ((_session && _session.examCategory) || 'session');
    sessionStorage.removeItem(timerKey);
    sessionStorage.removeItem('cbtAnswers');
    sessionStorage.removeItem('cbtSession');
    window.location.href = 'cbt.html';
  }
}