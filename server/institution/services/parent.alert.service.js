'use strict';
/* ============================================
   LATLOMP INSTITUTION — PARENT ALERT SERVICE (E7)

   Computed on-demand. No stored alert model.
   Reads ONLY from authoritative sources.
   Returns current alert status for a linked child.

   4 parallel queries per child call.
   Parent calls this once per child (per alert view).
   NO N+1: each child query is one Promise.all().

   Alert types:
   - new_result:       ScoreSubmission released recently
   - fee_due:          SchoolFeeAssignment pending/partial
   - progression:      classHistory entry within 30 days
   - homework_due:     SchoolHomework due within 3 days
============================================ */
'use strict';

const SchoolStudent = require('../models/SchoolStudent.model');

function getScoreSubmissionModel() {
  try { return require('../models/ScoreSubmission.model'); } catch(e) { return null; }
}
function getFeeAssignmentModel() {
  try { return require('../models/SchoolFeeAssignment.model'); } catch(e) { return null; }
}
function getHomeworkModel() {
  try { return require('../models/SchoolHomework.model'); } catch(e) { return null; }
}

/* ============================================
   getAlertsForChild(studentId, schoolId)
   Returns: [{ type, title, priority, date, metadata }]
   Returns: [] on error (non-fatal — alerts are advisory)
============================================ */
async function getAlertsForChild(studentId, schoolId) {
  var alerts  = [];
  var now     = new Date();
  var ago30   = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  var ahead3  = new Date(now.getTime() + 3  * 24 * 60 * 60 * 1000);
  var ahead7  = new Date(now.getTime() + 7  * 24 * 60 * 60 * 1000);

  /* ---- Load student for classId + classHistory ---- */
  var student;
  try {
    student = await SchoolStudent.findOne({ _id: studentId, schoolId })
      .select('name classId class classHistory status')
      .lean();
  } catch (e) { return []; }
  if (!student) { return []; }

  /* ---- 4 parallel queries ---- */
  var ScoreSubmission = getScoreSubmissionModel();
  var FeeAssignment   = getFeeAssignmentModel();
  var Homework        = getHomeworkModel();

  var [newResults, dueFees, upcomingHomework] = await Promise.all([
    /* 1. New released results in last 30 days */
    ScoreSubmission ? ScoreSubmission.find({
      schoolId,
      classId:           student.classId,
      status:            'approved',
      releasedToStudents:true,
      updatedAt:         { $gte: ago30 }
    }).select('subjectId updatedAt').lean().catch(function() { return []; })
    : Promise.resolve([]),

    /* 2. Pending/partial fee assignments */
    FeeAssignment ? FeeAssignment.find({
      schoolId,
      studentId,
      status: { $in: ['pending','partial'] }
    }).select('amountDue balance status dueDate').lean().catch(function() { return []; })
    : Promise.resolve([]),

    /* 3. Homework due within 3 days for child's class */
    (Homework && student.classId) ? Homework.find({
      schoolId,
      classId:  student.classId,
      status:   'active',
      dueDate:  { $gte: now, $lte: ahead3 }
    }).select('title dueDate subjectName').lean().catch(function() { return []; })
    : Promise.resolve([])
  ]);

  /* ---- Build alerts ---- */

  /* New results */
  if (newResults && newResults.length > 0) {
    alerts.push({
      type:     'new_result',
      title:    newResults.length + ' result' + (newResults.length > 1 ? 's' : '') + ' released for ' + (student.name || 'your child'),
      priority: 'normal',
      date:     newResults[0].updatedAt || null,
      metadata: { count: newResults.length }
    });
  }

  /* Fee due */
  if (dueFees && dueFees.length > 0) {
    var overdueFees  = dueFees.filter(function(f) { return f.dueDate && new Date(f.dueDate) < now; });
    var soonFees     = dueFees.filter(function(f) { return f.dueDate && new Date(f.dueDate) >= now && new Date(f.dueDate) <= ahead7; });
    var totalBalance = dueFees.reduce(function(s, f) { return s + (f.balance || 0); }, 0);

    if (overdueFees.length > 0) {
      alerts.push({
        type:     'fee_overdue',
        title:    overdueFees.length + ' fee payment' + (overdueFees.length > 1 ? 's' : '') + ' overdue',
        priority: 'urgent',
        date:     overdueFees[0].dueDate || null,
        metadata: { count: overdueFees.length, totalBalance }
      });
    } else if (soonFees.length > 0) {
      alerts.push({
        type:     'fee_due',
        title:    'Fee payment due within 7 days',
        priority: 'normal',
        date:     soonFees[0].dueDate || null,
        metadata: { count: soonFees.length, totalBalance }
      });
    }
  }

  /* Upcoming homework */
  if (upcomingHomework && upcomingHomework.length > 0) {
    upcomingHomework.forEach(function(hw) {
      alerts.push({
        type:     'homework_due',
        title:    'Homework due soon: ' + (hw.title || 'Assignment'),
        priority: 'normal',
        date:     hw.dueDate || null,
        metadata: {
          subject:  hw.subjectName || '',
          dueDate:  hw.dueDate
        }
      });
    });
  }

  /* Progression events (class history within 30 days) */
  var progressionActions = ['promoted','graduated','transferred_out','transferred_in','repeated'];
  if (student.classHistory && student.classHistory.length > 0) {
    var recentProgression = student.classHistory.filter(function(h) {
      return progressionActions.includes(h.action) &&
             h.recordedAt && new Date(h.recordedAt) >= ago30;
    });
    if (recentProgression.length > 0) {
      var entry = recentProgression[recentProgression.length - 1];
      var titles = {
        promoted:        'Promoted to ' + (entry.className || 'next level'),
        graduated:       student.name + ' has graduated',
        transferred_out: 'Student transferred',
        transferred_in:  'Transferred in to ' + (entry.className || 'class'),
        repeated:        'Continuing in ' + (entry.className || 'same level')
      };
      alerts.push({
        type:     'progression',
        title:    titles[entry.action] || 'Academic progression update',
        priority: 'normal',
        date:     entry.recordedAt || null,
        metadata: { action: entry.action, className: entry.className || '' }
      });
    }
  }

  /* Sort: urgent first, then by date (most recent first) */
  alerts.sort(function(a, b) {
    if (a.priority === 'urgent' && b.priority !== 'urgent') { return -1; }
    if (b.priority === 'urgent' && a.priority !== 'urgent') { return  1; }
    var ad = a.date ? new Date(a.date).getTime() : 0;
    var bd = b.date ? new Date(b.date).getTime() : 0;
    return bd - ad;
  });

  return alerts;
}

module.exports = { getAlertsForChild };