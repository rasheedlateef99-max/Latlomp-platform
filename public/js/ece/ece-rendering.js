/* ============================================
   LATLOMP PLATFORM — ECE RENDERING MODULE
   Phase 3: Client-side content rendering.

   RESPONSIBILITIES:
     - Mathematical equations via MathJax 3
     - Arabic / RTL text detection and layout
     - Chemistry notation (mhchem via MathJax)
     - Physics symbols (physics via MathJax)
     - Rich text (HTML) in question bodies
     - Per-question re-render on navigation

   CAPABILITY KEYS (from ece.capability.registry.js):
     math        — LaTeX / MathJax equations
     arabic      — RTL layout + Arabic font
     chemistry   — mhchem extension
     physics     — physics extension
     rich_text   — HTML content in questions
     images      — always active (default true)

   ACTIVATION:
     Standalone: eceRenderingInit() called by exam.js
     Via ece-core.js: ECERendering.init(flatConfig)
     Per question: eceRenderingApply() called by exam.js
                   after each renderQuestion() completes

   IMPLICIT DEPENDENCIES ON exam.js GLOBALS:
     _questions    — question array
     _currentIdx   — current question index
   These are window globals set by exam.js.

   FAILURE SAFETY:
     All rendering is non-blocking.
     If MathJax or fonts fail to load, plain text
     is shown and the exam continues normally.
============================================ */

(function (global) {
  'use strict';

  /* ---- Capability state ---- */
  var _caps = {
    math:      false,
    arabic:    false,
    chemistry: false,
    physics:   false,
    rich_text: false,
    images:    true
  };

  var _active          = false;
  var _mathJaxReady    = false;
  var _mathJaxLoading  = false;
  var _arabicFontReady = false;

  /* ---- Detection patterns ---- */

  /* Arabic + Extended Arabic Unicode ranges */
  var ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

  /* LaTeX inline/display delimiters and environments */
  var MATH_RE   = /\$[^$\n]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\\begin\s*\{[^}]+\}/;

  /* Basic HTML tag detection */
  var HTML_RE   = /<[a-zA-Z][^>]*>/;

  /* ============================================
     PUBLIC: eceRenderingInit
     Standalone entry point called from exam.js.
     Loads config from backend then activates.
  ============================================ */
  async function eceRenderingInit () {
    if (_active) { return; }

    var loaded = await _loadConfig();
    if (!loaded) { return; }

    _activate();
  }

  /* ============================================
     PUBLIC: eceRenderingApply
     Called by exam.js after every renderQuestion().
     Applies all enabled rendering to the current
     question DOM. Safe to call when inactive.
  ============================================ */
  function eceRenderingApply () {
    if (!_active) { return; }

    var qTextEl   = document.getElementById('qText');
    var optionsEl = document.getElementById('optionsList');
    if (!qTextEl) { return; }

    /* Get current question from exam.js globals */
    var q = null;
    if (typeof _questions !== 'undefined' &&
        typeof _currentIdx !== 'undefined' &&
        _questions[_currentIdx]) {
      q = _questions[_currentIdx];
    }
    if (!q) { return; }

    /* Order matters: rich_text first (changes DOM),
       then arabic (reads DOM content for detection),
       then math (typesets whatever is in the DOM). */
    if (_caps.rich_text)  { _applyRichText(qTextEl, q, optionsEl); }
    if (_caps.arabic)     { _applyArabic(qTextEl, q, optionsEl);   }
    if (_caps.math || _caps.chemistry || _caps.physics) {
      _applyMath(qTextEl, optionsEl);
    }
  }

  /* ============================================
     CONFIG LOAD
  ============================================ */
  async function _loadConfig () {
    try {
      /* apiRequest is the global from main.js */
      var res = await apiRequest('/ece/exam-rendering');
      if (!res.ok || !res.data || !res.data.rendering) { return false; }

      var r = res.data.rendering;
      _caps.math      = !!r.math;
      _caps.arabic    = !!r.arabic;
      _caps.chemistry = !!r.chemistry;
      _caps.physics   = !!r.physics;
      _caps.rich_text = !!r.rich_text;
      _caps.images    = r.images !== false;
      return true;
    } catch (e) {
      console.warn('[ECE Rendering] Config load failed — inactive:', e.message);
      return false;
    }
  }

  /* ============================================
     ACTIVATION
  ============================================ */
  function _activate () {
    var anyEnabled = _caps.math     || _caps.arabic   || _caps.chemistry ||
                     _caps.physics  || _caps.rich_text;

    if (!anyEnabled) {
      console.log('[ECE Rendering] No rendering capabilities enabled.');
      return;
    }

    _active = true;

    /* Pre-load assets in the background */
    if (_caps.math || _caps.chemistry || _caps.physics) {
      _loadMathJax();
    }
    if (_caps.arabic) {
      _loadArabicFont();
    }

    console.log('[ECE Rendering] Active.', {
      math:      _caps.math,
      arabic:    _caps.arabic,
      chemistry: _caps.chemistry,
      physics:   _caps.physics,
      richText:  _caps.rich_text
    });

    /* Render the question that is already on screen */
    eceRenderingApply();
  }

  /* ============================================
     RICH TEXT
     exam.js sets question text with .textContent
     which HTML-escapes all tags. When rich_text is
     enabled, we read the original question string
     from _questions[] and set innerHTML instead,
     after sanitizing for safe tags only.
  ============================================ */
  function _applyRichText (qTextEl, q, optionsEl) {
    var questionText = q.question || '';

    /* Only switch to innerHTML if HTML tags are detected */
    if (HTML_RE.test(questionText)) {
      qTextEl.innerHTML = _sanitize(questionText);
    }

    /* Options: exam.js builds them as inline HTML strings.
       HTML in option text is already rendered by the browser
       because the option template uses string concatenation.
       No additional action required for options.              */
  }

  /* Minimal sanitizer — strips scripts and event handlers.
     Question content is admin-authored so risk is low, but
     we never allow executable code in exam content. */
  function _sanitize (html) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(/\son\w+\s*=\s*[^\s>]*/gi, '')
      .replace(/javascript\s*:/gi, '');
  }

  /* ============================================
     ARABIC / RTL
     Auto-detects Arabic characters in the question.
     Applies RTL direction and Arabic font only to
     text nodes that actually contain Arabic.
  ============================================ */
  function _applyArabic (qTextEl, q, optionsEl) {
    var questionText = q.question || '';
    var isArabic     = ARABIC_RE.test(questionText);

    if (isArabic) {
      Object.assign(qTextEl.style, {
        direction:  'rtl',
        textAlign:  'right',
        fontFamily: "'Amiri', 'Noto Sans Arabic', 'Arial', serif",
        fontSize:   '18px',
        lineHeight: '2.0'
      });
    } else {
      /* Reset: LTR English/other question */
      Object.assign(qTextEl.style, {
        direction:  '',
        textAlign:  '',
        fontFamily: '',
        fontSize:   '',
        lineHeight: ''
      });
    }

    /* Apply RTL to individual option text nodes that contain Arabic */
    if (optionsEl) {
      optionsEl.querySelectorAll('.option-text').forEach(function (el) {
        var hasArabic = ARABIC_RE.test(el.textContent || '');
        if (hasArabic) {
          Object.assign(el.style, {
            direction:  'rtl',
            textAlign:  'right',
            fontFamily: "'Amiri', 'Noto Sans Arabic', 'Arial', serif",
            fontSize:   '15px'
          });
        } else {
          Object.assign(el.style, {
            direction:  '',
            textAlign:  '',
            fontFamily: '',
            fontSize:   ''
          });
        }
      });
    }
  }

  /* ============================================
     MATH / CHEMISTRY / PHYSICS (MathJax 3)
     Auto-detects LaTeX delimiters in the question.
     Uses MathJax.typesetPromise() on the question
     and options containers.
  ============================================ */
  function _applyMath (qTextEl, optionsEl) {
    if (!_mathJaxReady) {
      /* MathJax not yet loaded — ensure loading started */
      if (!_mathJaxLoading) { _loadMathJax(); }
      /* Will be called again from MathJax startup.ready() */
      return;
    }

    try {
      var targets = [qTextEl];
      if (optionsEl) { targets.push(optionsEl); }

      if (global.MathJax && global.MathJax.typesetPromise) {
        /* Reset previously typeset content so re-render works */
        global.MathJax.typesetClear(targets);
        global.MathJax.typesetPromise(targets).catch(function (e) {
          console.warn('[ECE Rendering] MathJax typeset error:', e.message);
        });
      }
    } catch (e) {
      console.warn('[ECE Rendering] Math rendering error:', e.message);
    }
  }

  /* ============================================
     MATHJAX LOADER
     Loads MathJax 3 from CDN with tex-chtml config.
     Extensions: mhchem (chemistry), physics.
     Config set BEFORE script tag injected — required
     by MathJax 3 initialisation sequence.
  ============================================ */
  function _loadMathJax () {
    if (_mathJaxLoading || _mathJaxReady) { return; }
    _mathJaxLoading = true;

    /* MathJax 3 config — must be set before loading the script */
    global.MathJax = {
      tex: {
        inlineMath:   [['$', '$'], ['\\(', '\\)']],
        displayMath:  [['$$', '$$'], ['\\[', '\\]']],
        packages:     { '[+]': ['mhchem', 'physics'] },
        tags:         'none'
      },
      chtml: {
        scale:        1.0,
        matchFontHeight: true
      },
      options: {
        skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
      },
      startup: {
        ready: function () {
          global.MathJax.startup.defaultReady();
          _mathJaxReady   = true;
          _mathJaxLoading = false;
          console.log('[ECE Rendering] MathJax 3 ready.');
          /* Typeset the question currently on screen */
          eceRenderingApply();
        }
      }
    };

    var script    = document.createElement('script');
    script.id     = 'MathJax-script';
    script.async  = true;
    script.src    = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js';
    script.onerror = function () {
      _mathJaxLoading = false;
      console.warn('[ECE Rendering] Failed to load MathJax from CDN.');
    };
    document.head.appendChild(script);

    console.log('[ECE Rendering] Loading MathJax 3...');
  }

  /* ============================================
     ARABIC FONT LOADER
     Loads Amiri — a high-quality Arabic serif font
     from Google Fonts. Loaded only when arabic
     capability is enabled and Arabic text is present.
  ============================================ */
  function _loadArabicFont () {
    if (_arabicFontReady) { return; }

    /* Check if already loaded (e.g. by CSS) */
    var existing = document.querySelector('link[href*="Amiri"]');
    if (existing) { _arabicFontReady = true; return; }

    var link    = document.createElement('link');
    link.rel    = 'stylesheet';
    link.href   = 'https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&display=swap';
    link.onload = function () {
      _arabicFontReady = true;
      console.log('[ECE Rendering] Arabic font (Amiri) loaded.');
      /* Re-render current question with new font */
      eceRenderingApply();
    };
    link.onerror = function () {
      /* Fallback to system Arabic fonts — no action needed */
      console.warn('[ECE Rendering] Amiri font unavailable — using system Arabic font.');
    };
    document.head.appendChild(link);
  }

  /* ============================================
     PUBLIC API
  ============================================ */

  /* Standalone mode — called directly from exam.js */
  global.eceRenderingInit  = eceRenderingInit;
  global.eceRenderingApply = eceRenderingApply;

  /* ece-core.js compatible interface.
     When ece-core.js is present it calls:
       ECERendering.init(flatConfig)   on exam start
       ECERendering.renderCurrent()    can be called externally */
  global.ECERendering = {
    init: function (flatConfig) {
      if (_active) { return; }
      /* flatConfig is the flat capabilities map from ece-core.js */
      _caps.math      = !!flatConfig.math;
      _caps.arabic    = !!flatConfig.arabic;
      _caps.chemistry = !!flatConfig.chemistry;
      _caps.physics   = !!flatConfig.physics;
      _caps.rich_text = !!flatConfig.rich_text;
      _caps.images    = flatConfig.images !== false;
      _activate();
    },
    renderCurrent: eceRenderingApply
  };

}(window));