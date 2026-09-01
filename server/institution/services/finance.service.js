'use strict';
/* ============================================
   LATLOMP — FINANCE SERVICE (E7B)

   Pure aggregation over authoritative models.
   Never creates duplicate financial records.
   Never stores a second ledger.

   Sources consumed (never modified):
   - SchoolFeePayment    → confirmed transactions
   - SchoolFeeAssignment → obligations/outstanding
   - SchoolFeeStructure  → fee categories
   - SchoolDonation      → donation records
   - SchoolFeeRefund     → refund records

   All aggregation uses MongoDB pipelines.
   No N+1 query patterns.
============================================ */
'use strict';

const mongoose = require('mongoose');

/* ---- Require existing authoritative models ---- */
function getSchoolFeePayment() {
  try { return require('../models/SchoolFeePayment.model'); } catch(e) { return null; }
}
function getSchoolFeeAssignment() {
  try { return require('../models/SchoolFeeAssignment.model'); } catch(e) { return null; }
}
function getSchoolFeeStructure() {
  try { return require('../models/SchoolFeeStructure.model'); } catch(e) { return null; }
}
function getAcademicTerm() {
  try { return require('../models/AcademicTerm.model'); } catch(e) { return null; }
}
function getSchoolStudent() {
  try { return require('../models/SchoolStudent.model'); } catch(e) { return null; }
}
function getSchoolDonation() {
  try { return require('../models/SchoolDonation.model'); } catch(e) { return null; }
}
function getSchoolFeeRefund() {
  try { return require('../models/SchoolFeeRefund.model'); } catch(e) { return null; }
}
function getSchoolDonationCampaign() {
  try { return require('../models/SchoolDonationCampaign.model'); } catch(e) { return null; }
}

function toObjectId(id) {
  if (!id) return null;
  try { return new mongoose.Types.ObjectId(id.toString()); } catch(e) { return null; }
}

/* ============================================
   buildPeriodMatch(schoolId, period)
   Returns MongoDB $match conditions for SchoolFeePayment.
   Period: { type:'today'|'week'|'month'|'term'|'session'|'custom'|'all',
             from?, to?, termId?, session? }
============================================ */
async function buildPeriodMatch(schoolId, period) {
  var sid       = toObjectId(schoolId);
  var baseMatch = { schoolId: sid, status: 'confirmed' };
  if (!period || period.type === 'all') { return baseMatch; }

  var now = new Date();

  if (period.type === 'today') {
    var s = new Date(now); s.setHours(0,0,0,0);
    var e = new Date(now); e.setHours(23,59,59,999);
    return Object.assign({}, baseMatch, { recordedAt: { $gte: s, $lte: e } });
  }

  if (period.type === 'week') {
    var weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0,0,0,0);
    return Object.assign({}, baseMatch, { recordedAt: { $gte: weekStart, $lte: now } });
  }

  if (period.type === 'month') {
    var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return Object.assign({}, baseMatch, { recordedAt: { $gte: monthStart, $lte: now } });
  }

  if (period.type === 'term') {
    var AcademicTerm = getAcademicTerm();
    if (AcademicTerm) {
      var termId = period.termId;
      if (!termId) {
        var ct = await AcademicTerm.findOne({ schoolId, isCurrent: true }).select('_id').lean();
        if (ct) termId = ct._id;
      }
      if (termId) {
        return Object.assign({}, baseMatch, { termId: toObjectId(termId) });
      }
    }
    return baseMatch;
  }

  if (period.type === 'session') {
    var AcademicTerm2 = getAcademicTerm();
    if (AcademicTerm2) {
      var session = period.session;
      if (!session) {
        var ct2 = await AcademicTerm2.findOne({ schoolId, isCurrent: true }).select('session').lean();
        if (ct2) session = ct2.session;
      }
      if (session) {
        var termIds = await AcademicTerm2.distinct('_id', { schoolId, session });
        if (termIds.length) {
          return Object.assign({}, baseMatch, { termId: { $in: termIds } });
        }
      }
    }
    return baseMatch;
  }

  if (period.type === 'custom') {
    var df = {};
    if (period.from) df.$gte = new Date(period.from);
    if (period.to)   df.$lte = new Date(period.to);
    if (Object.keys(df).length) {
      return Object.assign({}, baseMatch, { recordedAt: df });
    }
  }

  return baseMatch;
}

/* ============================================
   getFinanceSummary(schoolId, period)
   Dashboard summary statistics.
   6 parallel queries via Promise.all().
   No N+1.
============================================ */
async function getFinanceSummary(schoolId, period) {
  var match         = await buildPeriodMatch(schoolId, period);
  var sid           = toObjectId(schoolId);
  var Payment       = getSchoolFeePayment();
  var Assignment    = getSchoolFeeAssignment();
  var Donation      = getSchoolDonation();
  var Refund        = getSchoolFeeRefund();

  if (!Payment) {
    return { error: 'Fee payment system not available.' };
  }

  var [payStats, outstandingStats, donationStats, refundStats, pendingCount, failedCount] = await Promise.all([
    /* 1. Confirmed payment aggregate */
    Payment.aggregate([
      { $match: match },
      { $group: {
        _id:             null,
        totalCollected:  { $sum: '$amount' },
        totalGross:      { $sum: '$totalCharged' },
        totalPlatformFee:{ $sum: '$platformFeeAmount' },
        count:           { $sum: 1 },
        minAmount:       { $min: '$amount' },
        maxAmount:       { $max: '$amount' },
        avgAmount:       { $avg: '$amount' }
      }}
    ]),

    /* 2. Outstanding balance aggregate */
    Assignment ? Assignment.aggregate([
      { $match: { schoolId: sid, status: { $in: ['pending','partial'] } } },
      { $group: {
        _id:              null,
        totalOutstanding: { $sum: '$balance' },
        count:            { $sum: 1 }
      }}
    ]) : Promise.resolve([]),

    /* 3. Donation aggregate */
    Donation ? Donation.aggregate([
      { $match: { schoolId: sid, paymentStatus: 'completed' } },
      { $group: {
        _id:            null,
        totalDonations: { $sum: '$amount' },
        count:          { $sum: 1 }
      }}
    ]) : Promise.resolve([]),

    /* 4. Refund aggregate */
    Refund ? Refund.aggregate([
      { $match: { schoolId: sid, status: 'processed' } },
      { $group: {
        _id:           null,
        totalRefunded: { $sum: '$amount' },
        count:         { $sum: 1 }
      }}
    ]) : Promise.resolve([]),

    /* 5. Pending count */
    Payment.countDocuments({ schoolId, status: 'pending' }),

    /* 6. Failed count */
    Payment.countDocuments({ schoolId, status: 'failed' })
  ]);

  var ps = payStats[0]       || { totalCollected:0, totalGross:0, totalPlatformFee:0, count:0, minAmount:0, maxAmount:0, avgAmount:0 };
  var os = outstandingStats[0]|| { totalOutstanding:0, count:0 };
  var ds = donationStats[0]  || { totalDonations:0, count:0 };
  var rs = refundStats[0]    || { totalRefunded:0, count:0 };

  return {
    period:           period,
    totalCollected:   ps.totalCollected   || 0,
    totalGross:       ps.totalGross       || 0,
    platformFees:     ps.totalPlatformFee || 0,
    netCollected:     (ps.totalCollected  || 0) - (rs.totalRefunded || 0),
    transactionCount: ps.count            || 0,
    minAmount:        ps.minAmount        || 0,
    maxAmount:        ps.maxAmount        || 0,
    avgAmount:        ps.avgAmount ? Math.round((ps.avgAmount) * 100) / 100 : 0,
    outstanding:      os.totalOutstanding || 0,
    outstandingCount: os.count            || 0,
    totalRefunded:    rs.totalRefunded    || 0,
    refundCount:      rs.count            || 0,
    totalDonations:   ds.totalDonations   || 0,
    donationCount:    ds.count            || 0,
    pendingPayments:  pendingCount,
    failedPayments:   failedCount
  };
}

/* ============================================
   getTransactions(schoolId, filters, page, limit)
   Paginated transaction list.
   Populates student + fee structure info.
   No N+1: single query + populate.
============================================ */
async function getTransactions(schoolId, filters, page, limit) {
  var Payment  = getSchoolFeePayment();
  if (!Payment) { return { transactions: [], total: 0, page: 1, pages: 0 }; }

  filters = filters || {};
  var pageNum  = Math.max(1, parseInt(page)  || 1);
  var limitNum = Math.min(50, parseInt(limit) || 20);
  var skip     = (pageNum - 1) * limitNum;

  /* Build match */
  var match = { schoolId: toObjectId(schoolId) };

  /* Status filter */
  if (filters.status) { match.status = filters.status; }

  /* Date range */
  if (filters.from || filters.to) {
    match.recordedAt = {};
    if (filters.from) match.recordedAt.$gte = new Date(filters.from);
    if (filters.to)   match.recordedAt.$lte = new Date(filters.to);
  }

  /* Amount range */
  if (filters.minAmount || filters.maxAmount) {
    match.amount = {};
    if (filters.minAmount) match.amount.$gte = parseFloat(filters.minAmount);
    if (filters.maxAmount) match.amount.$lte = parseFloat(filters.maxAmount);
  }

  /* Student filter */
  if (filters.studentId) match.studentId = toObjectId(filters.studentId);

  /* Term filter */
  if (filters.termId) match.termId = toObjectId(filters.termId);

  /* Method filter */
  if (filters.method) match.method = filters.method;

  /* Reference search */
  if (filters.ref) {
    match.$or = [
      { paystackRef:  { $regex: filters.ref, $options: 'i' } },
      { receiptNumber:{ $regex: filters.ref, $options: 'i' } },
      { externalRef:  { $regex: filters.ref, $options: 'i' } }
    ];
  }

  var [total, transactions] = await Promise.all([
    Payment.countDocuments(match),
    Payment.find(match)
      .populate('studentId',    'name admissionNo class passportPhotoUrl')
      .populate('feeStructureId','name category')
      .populate('termId',        'name session term')
      .sort({ recordedAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean()
  ]);

  /* Name search post-populate (can't use $match on populate) */
  if (filters.studentName) {
    var rx = new RegExp(filters.studentName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    transactions = transactions.filter(function(t) {
      return t.studentId && rx.test(t.studentId.name || '');
    });
  }

  return {
    transactions,
    total,
    page:  pageNum,
    pages: Math.ceil(total / limitNum),
    limit: limitNum
  };
}

/* ============================================
   getOutstandingBalances(schoolId, filters)
   Outstanding fee balances with student context.
============================================ */
async function getOutstandingBalances(schoolId, filters) {
  var Assignment = getSchoolFeeAssignment();
  if (!Assignment) { return { assignments: [], total: 0, totalBalance: 0 }; }

  filters = filters || {};
  var match = {
    schoolId: toObjectId(schoolId),
    status:   { $in: ['pending','partial'] }
  };

  if (filters.studentId) match.studentId = toObjectId(filters.studentId);
  if (filters.termId)    match.termId    = toObjectId(filters.termId);
  if (filters.classId) {
    /* Need to join via student — use aggregate */
  }

  var pageNum  = Math.max(1, parseInt(filters.page)  || 1);
  var limitNum = Math.min(50, parseInt(filters.limit) || 25);
  var skip     = (pageNum - 1) * limitNum;

  var [assignments, totals] = await Promise.all([
    Assignment.find(match)
      .populate('studentId',     'name admissionNo class classId passportPhotoUrl')
      .populate('feeStructureId','name category')
      .populate('termId',         'name session')
      .sort({ balance: -1 })
      .skip(skip).limit(limitNum)
      .lean(),
    Assignment.aggregate([
      { $match: match },
      { $group: {
        _id:          null,
        total:        { $sum: 1 },
        totalBalance: { $sum: '$balance' },
        totalDue:     { $sum: '$amountDue' }
      }}
    ])
  ]);

  var t = totals[0] || { total:0, totalBalance:0, totalDue:0 };

  /* Name search post-populate */
  if (filters.studentName) {
    var rx = new RegExp(filters.studentName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    assignments = assignments.filter(function(a) {
      return a.studentId && rx.test(a.studentId.name || '');
    });
  }

  return {
    assignments,
    total:        t.total,
    totalBalance: t.totalBalance,
    totalDue:     t.totalDue
  };
}

/* ============================================
   getAnalyticsTrends(schoolId, period)
   Charts data for analytics section.
   4 parallel aggregations — no N+1.
============================================ */
async function getAnalyticsTrends(schoolId, period) {
  var Payment = getSchoolFeePayment();
  if (!Payment) { return {}; }

  var sid  = toObjectId(schoolId);
  var now  = new Date();
  var ago30= new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  var ago12= new Date(now.getFullYear() - 1, now.getMonth(), 1);

  var [dailyTrend, byCategory, byMethod, byMonth] = await Promise.all([
    /* 1. Daily trend (last 30 days) */
    Payment.aggregate([
      { $match: { schoolId: sid, status: 'confirmed', recordedAt: { $gte: ago30 } } },
      { $group: {
        _id:   { $dateToString: { format: '%Y-%m-%d', date: '$recordedAt' } },
        total: { $sum: '$amount' },
        count: { $sum: 1 }
      }},
      { $sort: { _id: 1 } }
    ]),

    /* 2. By fee category (join via feeStructureId) */
    Payment.aggregate([
      { $match: { schoolId: sid, status: 'confirmed' } },
      { $lookup: {
        from:         'schoolfeestructures',
        localField:   'feeStructureId',
        foreignField: '_id',
        as:           'structure'
      }},
      { $unwind: { path: '$structure', preserveNullAndEmpty: true } },
      { $group: {
        _id:   { $ifNull: ['$structure.category', 'general'] },
        total: { $sum: '$amount' },
        count: { $sum: 1 }
      }},
      { $sort: { total: -1 } }
    ]),

    /* 3. By payment method */
    Payment.aggregate([
      { $match: { schoolId: sid, status: 'confirmed' } },
      { $group: {
        _id:   { $ifNull: ['$method', 'unknown'] },
        total: { $sum: '$amount' },
        count: { $sum: 1 }
      }},
      { $sort: { total: -1 } }
    ]),

    /* 4. Monthly collection (last 12 months) */
    Payment.aggregate([
      { $match: { schoolId: sid, status: 'confirmed', recordedAt: { $gte: ago12 } } },
      { $group: {
        _id: {
          year:  { $year:  '$recordedAt' },
          month: { $month: '$recordedAt' }
        },
        total: { $sum: '$amount' },
        count: { $sum: 1 }
      }},
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ])
  ]);

  /* Format daily labels for charts */
  var dailyLabels  = dailyTrend.map(function(d) { return d._id; });
  var dailyAmounts = dailyTrend.map(function(d) { return Math.round(d.total * 100) / 100; });
  var dailyCounts  = dailyTrend.map(function(d) { return d.count; });

  var monthLabels = byMonth.map(function(m) {
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[(m._id.month || 1) - 1] + ' ' + m._id.year;
  });
  var monthAmounts= byMonth.map(function(m) { return Math.round(m.total * 100) / 100; });

  return {
    dailyTrend:  { labels: dailyLabels, amounts: dailyAmounts, counts: dailyCounts },
    byCategory:  byCategory.map(function(c) { return { category: c._id, total: c.total, count: c.count }; }),
    byMethod:    byMethod.map(function(m)   { return { method: m._id, total: m.total, count: m.count }; }),
    byMonth:     { labels: monthLabels, amounts: monthAmounts }
  };
}

/* ============================================
   getTransactionById(schoolId, paymentId)
   Full transaction detail with enrichment.
============================================ */
async function getTransactionById(schoolId, paymentId) {
  var Payment = getSchoolFeePayment();
  if (!Payment) { return null; }

  var payment = await Payment.findOne({
    _id: toObjectId(paymentId), schoolId: toObjectId(schoolId)
  })
  .populate('studentId',     'name admissionNo class passportPhotoUrl gender dateOfBirth parentName parentPhone')
  .populate('feeStructureId','name category amount description')
  .populate('assignmentId',  'amountDue amountPaid balance status discount dueDate')
  .populate('termId',        'name session term')
  .lean();

  if (!payment) { return null; }

  /* Attach refund history for this payment */
  var Refund = getSchoolFeeRefund();
  var refunds = [];
  if (Refund) {
    refunds = await Refund.find({ paymentId: toObjectId(paymentId), schoolId: toObjectId(schoolId) })
      .select('amount status reason requestedAt processedAt refundMethod providerRefundRef requestedByName')
      .lean();
  }

  return Object.assign({}, payment, { refunds });
}

/* ============================================
   assembleStatementData(schoolId, period, school)
   Assembles data payload for statement PDF/Excel.
============================================ */
async function assembleStatementData(schoolId, period, school) {
  var match    = await buildPeriodMatch(schoolId, period);
  var Payment  = getSchoolFeePayment();
  if (!Payment) { return null; }

  var [summary, transactions, refundSummary] = await Promise.all([
    getFinanceSummary(schoolId, period),
    Payment.find(match)
      .populate('studentId',    'name admissionNo class')
      .populate('feeStructureId','name category')
      .populate('termId',        'name session')
      .sort({ recordedAt: -1 })
      .lean(),
    getSchoolFeeRefund() ? getSchoolFeeRefund().aggregate([
      { $match: { schoolId: toObjectId(schoolId), status: 'processed' } },
      { $group: { _id: null, totalRefunded: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]) : Promise.resolve([])
  ]);

  var refunds = refundSummary[0] || { totalRefunded: 0, count: 0 };

  var statementRef = 'STM-' + Date.now().toString(36).toUpperCase() + '-' +
                     schoolId.toString().slice(-4).toUpperCase();

  return {
    statementRef,
    generatedAt:  new Date(),
    period,
    school:       school || {},
    summary,
    transactions,
    refundSummary:refunds,
    netCollected: (summary.totalCollected || 0) - (refunds.totalRefunded || 0)
  };
}

module.exports = {
  buildPeriodMatch,
  getFinanceSummary,
  getTransactions,
  getOutstandingBalances,
  getAnalyticsTrends,
  getTransactionById,
  assembleStatementData
};