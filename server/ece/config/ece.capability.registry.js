/* ============================================
   EXAMINATION CORE ENGINE — CAPABILITY REGISTRY

   Single source of truth for all ECE capabilities.
   Mirrors the pattern of permissions.registry.js.

   TO ADD A NEW CAPABILITY:
     1. Add an entry to ECE_CAPABILITIES in the
        appropriate group (or create a new group).
     2. Add it to SCOPE_CAPABILITY_DEFAULTS for
        the relevant scope.
     3. Implement the capability in its phase module.
     4. Nothing else needs to change.

   PHASE VALUES:
     1–8   = planned implementation phase
     'future' = not yet scheduled
============================================ */
'use strict';

var ECE_CAPABILITIES = {

  /* ---- EXAMINATION MODES ---- */
  examination_modes: {
    label: 'Examination Modes',
    icon:  '📋',
    desc:  'Types of examination that can be conducted',
    capabilities: [
      { key: 'objective', label: 'Objective (MCQ)',    phase: 1,        desc: 'Multiple-choice questions with automatic grading' },
      { key: 'theory',    label: 'Theory / Essay',     phase: 5,        desc: 'Free-text answers graded by teacher or AI' },
      { key: 'practical', label: 'Practical',          phase: 'future', desc: 'Practical assessment workflow' },
      { key: 'oral',      label: 'Oral',               phase: 'future', desc: 'Oral examination with recording support' },
      { key: 'audio',     label: 'Audio Questions',    phase: 'future', desc: 'Listening-based questions with audio playback' },
      { key: 'video',     label: 'Video Questions',    phase: 'future', desc: 'Video-based questions and responses' }
    ]
  },

  /* ---- SECURITY ---- */
  security: {
    label: 'Examination Security',
    icon:  '🔒',
    desc:  'Integrity and anti-cheating measures',
    capabilities: [
      { key: 'fullscreen',        label: 'Fullscreen Enforcement',  phase: 2,        desc: 'Force and maintain fullscreen during exam' },
      { key: 'tab_switch',        label: 'Tab Switch Detection',    phase: 2,        desc: 'Warn and optionally auto-submit on tab switching' },
      { key: 'copy_protection',   label: 'Copy Protection',         phase: 2,        desc: 'Disable text selection and copy actions' },
      { key: 'paste_protection',  label: 'Paste Protection',        phase: 2,        desc: 'Block paste events throughout the exam' },
      { key: 'right_click',       label: 'Right-Click Disable',     phase: 2,        desc: 'Disable the right-click context menu' },
      { key: 'session_integrity', label: 'Session Integrity',       phase: 2,        desc: 'Monitor session continuity and detect anomalies' },
      { key: 'dev_tools',         label: 'DevTools Detection',      phase: 'future', desc: 'Detect and respond to browser developer tools' }
    ]
  },

  /* ---- NAVIGATION ---- */
  navigation: {
    label: 'Examination Navigation',
    icon:  '🧭',
    desc:  'How students move through and interact with examinations',
    capabilities: [
      { key: 'keyboard_shortcuts', label: 'Keyboard Shortcuts',   phase: 4, desc: 'A/B/C/D select, N=Next, P=Prev, B=Bookmark' },
      { key: 'question_palette',   label: 'Question Palette',     phase: 4, desc: 'Grid overview showing answered / unanswered / flagged' },
      { key: 'bookmarking',        label: 'Question Bookmarking', phase: 4, desc: 'Mark individual questions for later review' },
      { key: 'flag_review',        label: 'Flag for Review',      phase: 4, desc: 'Flag questions to revisit before submitting' },
      { key: 'autosave',           label: 'Autosave',             phase: 4, desc: 'Save answers to localStorage every 30 seconds' },
      { key: 'resume_session',     label: 'Resume Session',       phase: 4, desc: 'Resume exam from last saved state after accidental close' },
      { key: 'review_mode',        label: 'Review Screen',        phase: 4, desc: 'Show answer review screen before final submission' }
    ]
  },

  /* ---- RENDERING ---- */
  rendering: {
    label: 'Content Rendering',
    icon:  '🎨',
    desc:  'How question content is displayed — auto-detected per question',
    capabilities: [
      { key: 'math',         label: 'Mathematical Rendering', phase: 3,        desc: 'LaTeX / MathJax for equations and formulae (auto-detected)' },
      { key: 'arabic',       label: 'Arabic / RTL Support',   phase: 3,        desc: 'Right-to-left layout and Arabic font loading (auto-detected)' },
      { key: 'chemistry',    label: 'Chemistry Notation',     phase: 3,        desc: 'Chemical formulae and reaction notation (auto-detected)' },
      { key: 'physics',      label: 'Physics Symbols',        phase: 3,        desc: 'Physics unit symbols and notation (auto-detected)' },
      { key: 'rich_text',    label: 'Rich Text (HTML)',       phase: 3,        desc: 'HTML content in question and option bodies' },
      { key: 'images',       label: 'Image Rendering',        phase: 1,        desc: 'Images in questions and answer options' },
      { key: 'audio_render', label: 'Audio Rendering',        phase: 'future', desc: 'Audio file playback in question bodies' },
      { key: 'video_render', label: 'Video Rendering',        phase: 'future', desc: 'Video file playback in question bodies' }
    ]
  },

  /* ---- RULES ENGINE ---- */
  rules: {
    label: 'Examination Rules',
    icon:  '⚙️',
    desc:  'Configurable examination behaviour and scoring rules',
    capabilities: [
      { key: 'negative_marking', label: 'Negative Marking',       phase: 5, desc: 'Deduct fractional marks for incorrect answers' },
      { key: 'attempts_limit',   label: 'Attempts Limit',         phase: 5, desc: 'Restrict the number of allowed exam attempts per student' },
      { key: 'shuffle_options',  label: 'Option Order Shuffle',   phase: 5, desc: 'Randomise option order independently per student' },
      { key: 'late_submission',  label: 'Late Submission Policy', phase: 5, desc: 'Configure behaviour after the time limit expires' },
      { key: 'review_allowed',   label: 'Post-Submit Review',     phase: 5, desc: 'Allow students to review answers after submission' }
    ]
  },

  /* ---- QUESTION INPUT ENGINE ---- */
  qie: {
    label: 'Question Input Engine',
    icon:  '📥',
    desc:  'Import, validate, and manage questions for each system independently',
    capabilities: [
      { key: 'manual_entry', label: 'Manual Entry',       phase: 6, desc: 'Create questions one at a time through a form' },
      { key: 'paste_import', label: 'Paste Import',       phase: 6, desc: 'Paste multiple questions into a large text editor' },
      { key: 'txt_import',   label: 'TXT File Import',    phase: 6, desc: 'Import questions from plain text (.txt) files' },
      { key: 'docx_import',  label: 'DOCX Import',        phase: 6, desc: 'Import questions from Word (.docx) documents' },
      { key: 'csv_import',   label: 'CSV Import',         phase: 6, desc: 'Import questions from comma-separated spreadsheets' },
      { key: 'xlsx_import',  label: 'XLSX Import',        phase: 6, desc: 'Import questions from Excel (.xlsx) workbooks' },
      { key: 'pdf_import',   label: 'Digital PDF Import', phase: 6, desc: 'Import questions from text-based (digital) PDF files' },
      { key: 'validation',   label: 'Import Validation',  phase: 6, desc: 'Automatic field and format validation before saving' },
      { key: 'preview',      label: 'Import Preview',     phase: 6, desc: 'Preview all questions before confirming import' },
      { key: 'templates',    label: 'Import Templates',   phase: 6, desc: 'Downloadable CSV, XLSX, and DOCX question templates' },
      { key: 'export',       label: 'Question Export',    phase: 6, desc: 'Export questions to CSV, XLSX, DOCX, or JSON' }
    ]
  },

  /* ---- FUTURE CAPABILITIES ---- */
  future: {
    label: 'Future Capabilities',
    icon:  '🚀',
    desc:  'Planned capabilities for future phases',
    capabilities: [
      { key: 'ocr',                  label: 'OCR Import',            phase: 'future', desc: 'Import questions from scanned paper documents' },
      { key: 'ai_import',            label: 'AI-Assisted Import',    phase: 'future', desc: 'AI cleanup, formatting correction, and tagging' },
      { key: 'voice_recognition',    label: 'Voice Recognition',     phase: 'future', desc: 'Voice-based examination input and navigation' },
      { key: 'adaptive_testing',     label: 'Adaptive Testing',      phase: 'future', desc: 'AI-driven difficulty adaptation per student' },
      { key: 'difficulty_balancing', label: 'Difficulty Balancing',  phase: 'future', desc: 'Automatic difficulty distribution in exam assembly' },
      { key: 'question_analytics',   label: 'Question Analytics',    phase: 'future', desc: 'Per-question performance and discrimination analytics' },
      { key: 'ai_marking',           label: 'AI Marking',            phase: 'future', desc: 'AI-assisted marking for theory answer responses' }
    ]
  }
};

/* ============================================
   SCOPE DEFAULTS
   Applied when a new ECEConfig is created.
   These represent sensible safe defaults.
   Root Admin can change any of these through
   the ECE administration interface.
============================================ */
var SCOPE_CAPABILITY_DEFAULTS = {
  cbt: {
    examination_modes: { objective: true,  theory: false, practical: false, oral: false, audio: false, video: false },
    security:          { fullscreen: false, tab_switch: false, tab_switch_max_warnings: 3, copy_protection: false, paste_protection: false, right_click: false, session_integrity: false },
    navigation:        { keyboard_shortcuts: false, question_palette: false, bookmarking: false, flag_review: false, autosave: true, resume_session: false, review_mode: true },
    rendering:         { math: false, arabic: false, chemistry: false, physics: false, rich_text: false, images: true, audio_render: false, video_render: false },
    rules:             { negative_marking: false, negative_mark_value: 0.25, attempts_limit: false, attempts_allowed: 1, shuffle_options: false, late_submission: 'auto', review_allowed: false },
    qie:               { manual_entry: false, paste_import: false, txt_import: false, docx_import: false, csv_import: false, xlsx_import: false, pdf_import: false, validation: true, preview: true, templates: true, export: false }
  },
  institution: {
    examination_modes: { objective: true,  theory: false, practical: false, oral: false, audio: false, video: false },
    security:          { fullscreen: false, tab_switch: false, tab_switch_max_warnings: 3, copy_protection: false, paste_protection: false, right_click: false, session_integrity: false },
    navigation:        { keyboard_shortcuts: false, question_palette: false, bookmarking: false, flag_review: false, autosave: true, resume_session: false, review_mode: true },
    rendering:         { math: false, arabic: false, chemistry: false, physics: false, rich_text: false, images: true, audio_render: false, video_render: false },
    rules:             { negative_marking: false, negative_mark_value: 0.25, attempts_limit: false, attempts_allowed: 1, shuffle_options: false, late_submission: 'auto', review_allowed: false },
    qie:               { manual_entry: true,  paste_import: false, txt_import: false, docx_import: false, csv_import: false, xlsx_import: false, pdf_import: false, validation: true, preview: true, templates: true, export: false }
  },
  teacher: {
    examination_modes: { objective: true,  theory: false, practical: false, oral: false, audio: false, video: false },
    security:          { fullscreen: false, tab_switch: false, tab_switch_max_warnings: 3, copy_protection: false, paste_protection: false, right_click: false, session_integrity: false },
    navigation:        { keyboard_shortcuts: false, question_palette: false, bookmarking: false, flag_review: false, autosave: true, resume_session: false, review_mode: true },
    rendering:         { math: false, arabic: false, chemistry: false, physics: false, rich_text: false, images: true, audio_render: false, video_render: false },
    rules:             { negative_marking: false, negative_mark_value: 0.25, attempts_limit: false, attempts_allowed: 1, shuffle_options: false, late_submission: 'auto', review_allowed: false },
    qie:               { manual_entry: true,  paste_import: false, txt_import: false, docx_import: false, csv_import: false, xlsx_import: false, pdf_import: false, validation: true, preview: true, templates: true, export: false }
  }
};

/* ============================================
   HELPER FUNCTIONS
============================================ */

/* Get a flat list of all capability keys */
function getAllKeys() {
  var keys = [];
  Object.values(ECE_CAPABILITIES).forEach(function (group) {
    group.capabilities.forEach(function (cap) { keys.push(cap.key); });
  });
  return keys;
}

/* Get default config for a scope (deep copy) */
function getDefaultConfig(scope) {
  var defaults = SCOPE_CAPABILITY_DEFAULTS[scope];
  if (!defaults) { return {}; }
  return JSON.parse(JSON.stringify(defaults));
}

/* Get all capability keys for a specific group */
function getGroupKeys(groupKey) {
  var group = ECE_CAPABILITIES[groupKey];
  if (!group) { return []; }
  return group.capabilities.map(function (c) { return c.key; });
}

/* Get capability metadata by key */
function getCapabilityMeta(key) {
  var result = null;
  Object.keys(ECE_CAPABILITIES).forEach(function (groupKey) {
    ECE_CAPABILITIES[groupKey].capabilities.forEach(function (cap) {
      if (cap.key === key) { result = Object.assign({ group: groupKey }, cap); }
    });
  });
  return result;
}

module.exports = {
  ECE_CAPABILITIES:          ECE_CAPABILITIES,
  SCOPE_CAPABILITY_DEFAULTS: SCOPE_CAPABILITY_DEFAULTS,
  getAllKeys:                 getAllKeys,
  getDefaultConfig:          getDefaultConfig,
  getGroupKeys:              getGroupKeys,
  getCapabilityMeta:         getCapabilityMeta
};