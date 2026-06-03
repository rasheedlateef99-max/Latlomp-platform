/* ============================================
   LATLOMP PLATFORM — CBT DASHBOARD
   
   This page is the portal to the CBT system.
   The actual exam flow is in cbt-start.html.
============================================ */

document.addEventListener('DOMContentLoaded', async function() {

  /* Auth guard */
  if (!requireLogin('cbt.html')) return;

  var user = getCurrentUser();
  if (!user) return;

  /* Fill user greeting */
  var greetEl = document.getElementById('userGreeting');
  var initEl  = document.getElementById('userInitial');
  if (greetEl) greetEl.textContent = 'Welcome back, ' + user.name.split(' ')[0] + '!';
  if (initEl)  initEl.textContent  = user.name.charAt(0).toUpperCase();

  /* Load stats and history in parallel */
  await Promise.all([ loadUserStats(), loadResultHistory() ]);
});

/* ============================================
   USER STATS
============================================ */
async function loadUserStats() {
  var res = await apiRequest('/auth/me');
  if (!res.ok) return;

  var stats   = (res.data.user || {}).stats || {};
  var examsEl = document.getElementById('statExams');
  var avgEl   = document.getElementById('statAvg');
  var bestEl  = document.getElementById('statBest');

  if (examsEl) examsEl.textContent = stats.totalExamsTaken || 0;
  if (avgEl)   avgEl.textContent   = (stats.averageScore   || 0) + '%';
  if (bestEl)  bestEl.textContent  = (stats.bestScore      || 0) + '%';
}

/* ============================================
   RESULT HISTORY
============================================ */
async function loadResultHistory() {
  var res    = await apiRequest('/exams/results/history');
  var tbody  = document.getElementById('historyTableBody');
  var noMsg  = document.getElementById('noHistoryMsg');
  var contEl = document.getElementById('historyContainer');

  if (contEl) contEl.style.display = 'block';

  if (!res.ok || !res.data.results || res.data.results.length === 0) {
    if (noMsg)  noMsg.style.display  = 'block';
    if (tbody)  tbody.innerHTML      = '';
    return;
  }

  if (noMsg) noMsg.style.display = 'none';

  if (tbody) {
    tbody.innerHTML = res.data.results.map(function(r, i) {
      var color = r.isPassed ? '#43e97b' : '#ff6584';
      return '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td style="font-weight:700; color:var(--text-primary,#fff);">' + (r.examTitle || 'Exam') + '</td>' +
        '<td style="font-weight:800; color:' + color + ';">' + r.scorePercent + '%</td>' +
        '<td><span style="font-size:12px; font-weight:700; padding:3px 10px; border-radius:20px; background:' +
          (r.isPassed ? 'rgba(67,233,123,0.12)' : 'rgba(255,101,132,0.12)') +
          '; color:' + color + ';">' +
          (r.isPassed ? '✅ PASSED' : '❌ FAILED') +
        '</span></td>' +
        '<td style="color:var(--text-muted); font-size:13px;">' +
          new Date(r.createdAt).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' }) +
        '</td>' +
      '</tr>';
    }).join('');
  }
}

console.log('📝 CBT Dashboard loaded');