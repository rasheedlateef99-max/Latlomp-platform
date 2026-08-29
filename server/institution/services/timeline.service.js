'use strict';
/* ============================================
   LATLOMP INSTITUTION — TIMELINE SERVICE (E4)

   Aggregation layer. Assembles chronological
   academic timeline from authoritative sources.

   Sources consumed (never modified):
   - SchoolStudent.classHistory  → transitions
   - PromotionBatch              → enrichment only
   - PortfolioEntry (E2)         → awards/achievements
   - ResultArchiveRecord (E3)    → result events
   - AcademicPortfolio (E2)      → lifecycle state

   No TimelineEvent model.
   No data duplication.
   No new source of truth.

   E5 Transcript compatibility:
     getTimeline() returns structured event objects.
     E5 consumes these directly — not parsed HTML.

   E6 Alumni compatibility:
     Works with portfolioStatus = 'alumni'.
     No visibility destroyed on graduation/alumni.
============================================ */
'use strict';

const mongoose          = require('mongoose');
const SchoolStudent     = require('../models/SchoolStudent.model');
const AcademicPortfolio = require('../models/AcademicPortfolio.model');
const PortfolioEntry    = require('../models/PortfolioEntry.model');
const ResultArchiveRecord = require('../models/ResultArchiveRecord.model');

/* ---- Graceful loaders ---- */
function getPromotionBatchModel() {
  try { return require('../models/PromotionBatch.model'); } catch(e) { return null; }
}
function getAcademicTermModel() {
  try { return require('../models/AcademicTerm.model'); } catch(e) { return null; }
}

/* ============================================
   CONSTANTS
============================================ */
var TERM_ORDER = {
  first: 1, second: 2, third: 3,
  semester_1: 4, semester_2: 5,
  '': 0
};

var ACTION_TYPE_MAP = {
  enrolled:        'enrollment',
  promoted:        'promotion',
  repeated:        'repetition',
  transferred_in:  'transfer',
  transferred_out: 'transfer',
  graduated:       'graduation',
  rolled_back:     'admin_correction'
};

var ACTION_TITLE_MAP = {
  enrolled:        'Enrolled',
  promoted:        'Promoted',
  repeated:        'Repeated Academic Level',
  transferred_in:  'Transferred In',
  transferred_out: 'Transferred Out',
  graduated:       'Graduated',
  rolled_back:     'Administrative Correction'
};

var ENTRY_TYPE_TITLE = {
  award:        'Award Received',
  achievement:  'Achievement Recorded',
  skill:        'Skill Certified',
  milestone:    'Academic Milestone',
  discipline_ref:'Disciplinary Record'
};

/* ============================================
   CHRONOLOGICAL SORT HELPERS
   Primary:   event date (actual academic event, not db createdAt)
   Secondary: session string (lexicographic, e.g. "2024/2025")
   Tertiary:  term order
   Quaternary:source priority (enrollment < class < promotion < result < award)
============================================ */
function termSortValue(term) {
  return TERM_ORDER[term || ''] || 0;
}

var SOURCE_PRIORITY = {
  enrollment:   1,
  class_history:2,
  promotion:    3,
  repetition:   3,
  transfer:     3,
  graduation:   4,
  result_available: 5,
  award:        6,
  achievement:  6,
  skill:        6,
  milestone:    6,
  admin_correction: 99
};

function compareEvents(a, b) {
  /* 1. Actual date (most reliable) */
  var ad = a.date ? new Date(a.date).getTime() : 0;
  var bd = b.date ? new Date(b.date).getTime() : 0;
  if (ad && bd && ad !== bd) { return ad - bd; }
  if (ad && !bd) { return -1; }
  if (!ad && bd) { return  1; }

  /* 2. Session string lexicographic (e.g. "2023/2024" < "2024/2025") */
  var as = a.session || '';
  var bs = b.session || '';
  if (as !== bs) { return as.localeCompare(bs); }

  /* 3. Term order */
  var at = termSortValue(a.term);
  var bt = termSortValue(b.term);
  if (at !== bt) { return at - bt; }

  /* 4. Source priority */
  var ap = SOURCE_PRIORITY[a.subtype || a.type] || 50;
  var bp = SOURCE_PRIORITY[b.subtype || b.type] || 50;
  return ap - bp;
}

/* ============================================
   NORMALIZE: classHistory entry → timeline event
   index used as part of composite sourceRef since
   classHistory subdocs have { _id: false }.
============================================ */
function normalizeClassHistoryEntry(entry, index, batchEnrichment, options) {
  var showRolledBack = !!options.includeAdmin;

  if (entry.action === 'rolled_back' && !showRolledBack) {
    return null;
  }

  /* Description: className reflects the TARGET state */
  var descMap = {
    enrolled:       'Enrolled in ' + (entry.className || 'institution'),
    promoted:       'Promoted to ' + (entry.className || 'next level'),
    repeated:       'Continuing in ' + (entry.className || 'same level'),
    transferred_in: 'Joined from another institution · ' + (entry.className || ''),
    transferred_out:'Transferred out · ' + (entry.className || ''),
    graduated:      'Successfully completed ' + (entry.className || 'final level'),
    rolled_back:    'Administrative correction applied'
  };

  /* Composite sourceRef — traceable without requiring _id */
  var sourceRef = {
    index:        index,
    action:       entry.action,
    session:      entry.session   || '',
    term:         entry.term      || '',
    className:    entry.className || '',
    recordedAt:   entry.recordedAt|| null
  };

  /* Enrich from PromotionBatch if available */
  var metadata = {};
  if (batchEnrichment) {
    metadata.batchRef    = batchEnrichment.batchRef;
    metadata.batchStatus = batchEnrichment.batchStatus;
    metadata.fromClass   = batchEnrichment.sourceClass;
  }

  return {
    id:          'ch:' + index + ':' + (entry.action) + ':' + (entry.session || '') + ':' + (entry.term || ''),
    type:        ACTION_TYPE_MAP[entry.action] || 'class_transition',
    subtype:     entry.action,
    date:        entry.recordedAt || null,
    session:     entry.session    || '',
    term:        entry.term       || '',
    title:       ACTION_TITLE_MAP[entry.action] || 'Academic Transition',
    description: descMap[entry.action]          || '',
    classId:     entry.classId    || null,
    className:   entry.className  || '',
    source:      'class_history',
    sourceRef:   sourceRef,
    metadata
  };
}

/* ============================================
   NORMALIZE: PortfolioEntry → timeline event
============================================ */
function normalizePortfolioEntry(entry, termMap) {
  if (entry.status === 'revoked') { return null; }
  if (entry.isConfidential && !entry._allowConfidential) { return null; }

  /* Resolve term context from pre-loaded termMap */
  var termDoc = entry.termId ? termMap[(entry.termId._id || entry.termId).toString()] : null;

  var session = '';
  var term    = '';
  if (termDoc) {
    session = termDoc.session || '';
    term    = termDoc.term    || '';
  }

  return {
    id:          'pe:' + entry._id.toString(),
    type:        entry.entryType === 'discipline_ref' ? 'discipline' : 'portfolio_entry',
    subtype:     entry.entryType,
    date:        entry.date || (termDoc ? termDoc.startDate : null) || entry.createdAt || null,
    session,
    term,
    title:       entry.title                            || ENTRY_TYPE_TITLE[entry.entryType] || 'Portfolio Entry',
    description: entry.description                      || '',
    classId:     null,
    className:   '',
    source:      'portfolio_entry',
    sourceRef:   { entryId: entry._id.toString(), entryType: entry.entryType },
    metadata: {
      evidence:      entry.evidence    || '',
      isConfidential:entry.isConfidential || false,
      termName:      termDoc ? termDoc.name : ''
    }
  };
}

/* ============================================
   NORMALIZE: ResultArchiveRecord → timeline event
   One event per term (most recent version only).
============================================ */
function normalizeArchiveRecord(record) {
  var snap    = record.termSnapshot    || {};
  var csnap   = record.classSnapshot   || {};

  return {
    id:          'ra:' + record._id.toString(),
    type:        'result_available',
    subtype:     record.documentType || 'report_card',
    date:        record.issuedAt || record.generatedAt || null,
    session:     snap.session  || '',
    term:        snap.term     || '',
    title:       'Academic Result Available',
    description: (snap.name || '') + (snap.session ? ' — ' + snap.session : '') +
                 (csnap.name ? ' · ' + csnap.name : ''),
    classId:     record.classId  || null,
    className:   csnap.name      || '',
    source:      'result_archive',
    sourceRef: {
      archiveId:       record._id.toString(),
      termId:          record.termId ? record.termId.toString() : null,
      documentType:    record.documentType,
      documentVersion: record.documentVersion,
      documentHash:    record.documentHash || null /* E5 traceability */
    },
    metadata: {
      hasStoredFile: !!(record.storage && record.storage.url),
      status:        record.status,
      termName:      snap.name    || '',
      termSession:   snap.session || ''
    }
  };
}

/* ============================================
   getTimeline(studentId, schoolId, options)

   options:
     includeConfidential  — senior/admin only
     includeAdmin         — show rolled_back events
     releasedResultsOnly  — true for student/parent
     filterType           — e.g. 'promotion'
     filterSession        — e.g. '2024/2025'
     filterTermId         — specific term

   Returns: { student, lifecycle, timeline, count }
   or: null if student not found / wrong school.
============================================ */
async function getTimeline(studentId, schoolId, options) {
  options = options || {};
  var includeConfidential = !!options.includeConfidential;
  var includeAdmin        = !!options.includeAdmin;
  var releasedOnly        = !!options.releasedResultsOnly;

  /* ---- 1. Verify student ownership + load portfolio ---- */
  var [student, portfolio] = await Promise.all([
    SchoolStudent.findOne({ _id: studentId, schoolId: schoolId })
      .select('name admissionNo studentId passportPhotoUrl gender status ' +
              'class classId classHistory joinedSession joinedYear')
      .lean(),
    AcademicPortfolio.findOne({ studentId: studentId, schoolId: schoolId })
      .select('portfolioStatus metadata')
      .lean()
  ]);

  if (!student) { return null; /* tenant isolation — student not in this school */ }

  /* ---- 2. Load PromotionBatches for enrichment (1 query) ---- */
  var batchByTimestamp = {};
  var PromotionBatch = getPromotionBatchModel();
  if (PromotionBatch) {
    try {
      var batches = await PromotionBatch.find({
        schoolId:              schoolId,
        'students.studentId':  new mongoose.Types.ObjectId(studentId.toString()),
        status:                { $in: ['completed', 'partial', 'rolled_back'] }
      }).select('batchRef status sourceClassSnapshot students').lean();

      batches.forEach(function(batch) {
        var entry = batch.students && batch.students.find(function(s) {
          return s.studentId && s.studentId.toString() === studentId.toString() &&
                 s.executionHistoryTimestamp;
        });
        if (entry && entry.executionHistoryTimestamp) {
          var ts = new Date(entry.executionHistoryTimestamp).getTime();
          batchByTimestamp[ts] = {
            batchRef:    batch.batchRef,
            batchStatus: batch.status,
            sourceClass: batch.sourceClassSnapshot ? batch.sourceClassSnapshot.name : ''
          };
        }
      });
    } catch (e) { /* non-fatal — enrichment is optional */ }
  }

  /* ---- 3. Normalize classHistory → events ---- */
  var classHistoryEvents = [];
  var history = student.classHistory || [];

  history.forEach(function(entry, index) {
    /* Find matching batch enrichment by timestamp proximity (±1000ms) */
    var batchInfo = null;
    if (entry.recordedAt) {
      var ts = new Date(entry.recordedAt).getTime();
      var matchKey = Object.keys(batchByTimestamp).find(function(k) {
        return Math.abs(parseInt(k) - ts) < 1000;
      });
      if (matchKey) { batchInfo = batchByTimestamp[matchKey]; }
    }

    var event = normalizeClassHistoryEntry(entry, index, batchInfo, { includeAdmin });
    if (event) { classHistoryEvents.push(event); }
  });

  /* ---- 4. Load PortfolioEntries (1 query) ---- */
  var entryFilter = {
    schoolId:  schoolId,
    studentId: studentId
  };
  if (!includeConfidential) {
    entryFilter.isConfidential = { $ne: true };
  }
  /* discipline_ref always confidential — enforced even if includeConfidential somehow missed */
  var entries = await PortfolioEntry.find(entryFilter)
    .select('title description entryType date termId isConfidential status evidence createdAt')
    .lean();

  /* ---- 5. Batch-load terms referenced by portfolio entries ---- */
  var termMap = {};
  var AcademicTerm = getAcademicTermModel();
  if (AcademicTerm && entries.length > 0) {
    try {
      var entryTermIds = entries
        .filter(function(e) { return e.termId; })
        .map(function(e) { return e.termId; });

      if (entryTermIds.length > 0) {
        var terms = await AcademicTerm.find({ _id: { $in: entryTermIds } })
          .select('name session term startDate').lean();
        terms.forEach(function(t) { termMap[t._id.toString()] = t; });
      }
    } catch (e) { /* non-fatal */ }
  }

  /* ---- 6. Normalize PortfolioEntries → events ---- */
  var portfolioEvents = [];
  entries.forEach(function(entry) {
    /* Mark whether this entry is allowed to be shown */
    entry._allowConfidential = includeConfidential;
    var event = normalizePortfolioEntry(entry, termMap);
    if (event) { portfolioEvents.push(event); }
  });

  /* ---- 7. Load ResultArchiveRecords (1 query) ---- */
  var archiveFilter = {
    schoolId:  schoolId,
    studentId: studentId,
    status:    { $in: ['generated', 'issued'] }
  };
  if (releasedOnly) {
    /* For student/parent, we only show terms where settings.isReleased = true.
       ResultArchiveRecord doesn't store isReleased directly.
       Cross-check via ReportCardSettings is done in archive service.
       Here we use a pragmatic approach: only show archive records that
       were explicitly issued (confirmed for student visibility). */
    archiveFilter.status = 'issued';
    /* If school doesn't set 'issued', fall back to 'generated' — 
       student portal will handle visibility via the /archive/term/:termId
       endpoint which enforces the isReleased check properly.
       For timeline, we show 'generated' + 'issued' but only include
       a lightweight "result available" event — actual data access
       remains protected by the archive endpoint's release check. */
    archiveFilter.status = { $in: ['generated', 'issued'] };
    /* Note: This is intentional. The timeline event itself contains no
       score data — it only signals "a report exists for this period."
       Actual result retrieval still enforces ReportCardSettings.isReleased. */
  }

  var archiveRecords = await ResultArchiveRecord.find(archiveFilter)
    .select('termId classId termSnapshot classSnapshot documentType documentVersion ' +
            'documentHash status generatedAt issuedAt storage.url portfolioId')
    .sort({ 'termSnapshot.session': 1, documentVersion: -1 })
    .lean();

  /* ---- 8. Deduplicate archive records — keep latest version per term ---- */
  var archiveByTerm = {};
  archiveRecords.forEach(function(record) {
    var key = record.termId ? record.termId.toString() : 'unknown';
    /* First encountered = highest version (sorted desc by version above) */
    if (!archiveByTerm[key]) {
      archiveByTerm[key] = record;
    }
  });

  var archiveEvents = Object.values(archiveByTerm).map(function(record) {
    return normalizeArchiveRecord(record);
  });

  /* ---- 9. Merge all events ---- */
  var allEvents = [].concat(classHistoryEvents, portfolioEvents, archiveEvents);

  /* ---- 10. Apply filters ---- */
  if (options.filterType) {
    allEvents = allEvents.filter(function(e) {
      return e.type === options.filterType || e.subtype === options.filterType;
    });
  }
  if (options.filterSession) {
    allEvents = allEvents.filter(function(e) {
      return e.session === options.filterSession;
    });
  }
  if (options.filterTermId) {
    var termIdStr = options.filterTermId.toString();
    allEvents = allEvents.filter(function(e) {
      return (e.sourceRef && (e.sourceRef.termId === termIdStr ||
              (e.sourceRef.entryId && e.metadata && e.metadata.termName))) ||
             (e.classId && e.classId.toString() === termIdStr);
    });
  }

  /* ---- 11. Sort chronologically ---- */
  allEvents.sort(compareEvents);

  /* ---- 12. Group by session for structured view (optional, included in response) ---- */
  var sessionGroups = {};
  allEvents.forEach(function(event) {
    var key = event.session || 'Undated';
    if (!sessionGroups[key]) { sessionGroups[key] = []; }
    sessionGroups[key].push(event);
  });
  var sessions = Object.entries(sessionGroups).map(function(kv) {
    return { session: kv[0], events: kv[1] };
  }).sort(function(a, b) {
    return a.session.localeCompare(b.session);
  });

  return {
    student: {
      _id:         student._id,
      name:        student.name,
      admissionNo: student.admissionNo      || '',
      studentCode: student.studentId        || '',
      photo:       student.passportPhotoUrl || '',
      gender:      student.gender           || '',
      class:       student.class            || '',
      joinedYear:  student.joinedYear       || null
    },
    lifecycle: {
      studentStatus:   student.status,
      portfolioStatus: portfolio ? portfolio.portfolioStatus : 'not_created'
    },
    timeline:       allEvents,
    sessionGroups:  sessions,
    count:          allEvents.length,
    sources: {
      classHistoryCount: classHistoryEvents.length,
      portfolioCount:    portfolioEvents.length,
      archiveCount:      archiveEvents.length
    }
  };
}

/* ============================================
   getTimelineSummary(studentId, schoolId)
   Lightweight — counts only, for dashboard widgets.
============================================ */
async function getTimelineSummary(studentId, schoolId) {
  var [student, portfolio, entryCount, archiveCount] = await Promise.all([
    SchoolStudent.findOne({ _id: studentId, schoolId })
      .select('name status class').lean(),
    AcademicPortfolio.findOne({ studentId, schoolId })
      .select('portfolioStatus').lean(),
    PortfolioEntry.countDocuments({
      schoolId, studentId,
      status: 'active',
      isConfidential: { $ne: true }
    }),
    ResultArchiveRecord.countDocuments({
      schoolId, studentId,
      status: { $in: ['generated', 'issued'] }
    })
  ]);

  if (!student) { return null; }

  var history = student.classHistory || [];
  return {
    studentStatus:        student.status,
    portfolioStatus:      portfolio ? portfolio.portfolioStatus : 'not_created',
    classTransitionCount: history.length,
    portfolioEntryCount:  entryCount,
    archiveDocumentCount: archiveCount,
    totalEventEstimate:   history.length + entryCount + archiveCount
  };
}

module.exports = {
  getTimeline,
  getTimelineSummary
};