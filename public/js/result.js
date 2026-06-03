/* ============================================
   LATLOMP CBT — RESULT PAGE JAVASCRIPT
   ============================================ */

/* ============================================
   INITIALIZE RESULT PAGE
   ============================================ */
document.addEventListener('DOMContentLoaded', function () {

  // Get result from localStorage (set by exam.js after submission)
  const resultJSON = localStorage.getItem('latlomp_last_result');

  if (!resultJSON) {
    // No result data — redirect back
    alert('No result data found. Please take an exam first.');
    window.location.href = 'cbt.html';
    return;
  }

  const result = JSON.parse(resultJSON);

  // Render everything
  renderScoreCard(result);
  renderPerformanceMessage(result);
  renderBreakdown(result);

  // Clean up localStorage after displaying
  // (keep it for sharing — remove after 5 min)
  setTimeout(() => localStorage.removeItem('latlomp_last_result'), 5 * 60 * 1000);
});

/* ============================================
   RENDER SCORE CARD
   ============================================ */
function renderScoreCard(result) {
  const scoreCard = document.getElementById('scoreCard');
  const { scorePercent, score, totalQuestions, isPassed, timeTaken, passMark } = result;

  // Trophy emoji based on score
  const trophy = scorePercent >= 90 ? '🏆' :
                 scorePercent >= 70 ? '🥇' :
                 scorePercent >= 50 ? '🎯' : '📚';

  document.getElementById('scoreTrophy').textContent  = trophy;
  document.getElementById('scoreVerdict').textContent =
    isPassed ? `You Passed! 🎉` : `Keep Practicing! 💪`;

  // Animate the percentage counter
  animateCounter('scorePercent', 0, scorePercent, 1200);

  // Score details
  document.getElementById('sdCorrect').textContent = score;
  document.getElementById('sdWrong').textContent   = totalQuestions - score;
  document.getElementById('sdTotal').textContent   = totalQuestions;
  document.getElementById('sdTime').textContent    = `${timeTaken || 0} min`;

  // Pass/Fail tag
  const tagEl = document.getElementById('scoreTag');
  tagEl.textContent  = isPassed ? `✅ PASSED (${passMark || 50}% required)` : `❌ FAILED (${passMark || 50}% required)`;
  tagEl.className    = `score-tag ${isPassed ? 'passed' : 'failed'}`;

  // Card border
  scoreCard.classList.add(isPassed ? 'passed' : 'failed');

  // Animate the ring after a short delay
  setTimeout(() => {
    const circumference = 326.56; // 2π × 52
    const offset = circumference - (scorePercent / 100) * circumference;
    const ringFill = document.getElementById('ringFill');
    ringFill.style.strokeDashoffset = offset;
    ringFill.classList.add(isPassed ? 'passed' : 'failed');
  }, 200);
}

/* ============================================
   ANIMATE COUNTER (number counting up)
   ============================================ */
function animateCounter(elementId, from, to, duration) {
  const el        = document.getElementById(elementId);
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed  = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const eased    = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

/* ============================================
   RENDER PERFORMANCE MESSAGE
   ============================================ */
function renderPerformanceMessage(result) {
  const { scorePercent, isPassed, wasAutoSubmit } = result;
  const msgEl   = document.getElementById('performanceMsg');
  const iconEl  = document.getElementById('perfIcon');
  const titleEl = document.getElementById('perfTitle');
  const bodyEl  = document.getElementById('perfBody');

  msgEl.style.display = 'flex';

  if (wasAutoSubmit) {
    iconEl.textContent  = '⏰';
    titleEl.textContent = 'Time ran out!';
    bodyEl.textContent  = 'Your exam was auto-submitted when the timer ended. Study the breakdown below and try to manage your time better next time.';
  } else if (scorePercent >= 90) {
    iconEl.textContent  = '🌟';
    titleEl.textContent = 'Outstanding Performance!';
    bodyEl.textContent  = `You scored ${scorePercent}%! That's an exceptional result. Keep up this excellent work. You're fully prepared!`;
  } else if (scorePercent >= 70) {
    iconEl.textContent  = '💪';
    titleEl.textContent = 'Great Job!';
    bodyEl.textContent  = `You scored ${scorePercent}%. Very good! Review the questions you missed in the breakdown below to push your score even higher.`;
  } else if (isPassed) {
    iconEl.textContent  = '✅';
    titleEl.textContent = 'You Passed!';
    bodyEl.textContent  = `You scored ${scorePercent}% and met the pass mark. Good work! There's still room to improve — review your wrong answers below.`;
  } else if (scorePercent >= 30) {
    iconEl.textContent  = '📖';
    titleEl.textContent = 'Almost There!';
    bodyEl.textContent  = `You scored ${scorePercent}%. You're making progress! Study the explanations in the breakdown below and take the exam again. You can do this!`;
  } else {
    iconEl.textContent  = '🔄';
    titleEl.textContent = 'Don\'t Give Up!';
    bodyEl.textContent  = `You scored ${scorePercent}%. Every expert was once a beginner. Go through the answer breakdown below, revise, and try again. Consistency is key!`;
  }
}

/* ============================================
   RENDER ANSWER BREAKDOWN
   ============================================ */
function renderBreakdown(result) {
  const list        = document.getElementById('breakdownList');
  const gradedAnswers = result.gradedAnswers;

  if (!gradedAnswers || gradedAnswers.length === 0) {
    list.innerHTML = `<p style="color:var(--text-muted); padding:20px;">No answer data available.</p>`;
    return;
  }

  const optionLetters = ['A', 'B', 'C', 'D'];

  list.innerHTML = gradedAnswers.map((item, index) => {
    // Determine status
    const wasSkipped = item.userAnswer === null || item.userAnswer === undefined;
    const statusClass = wasSkipped ? 'skipped' : item.isCorrect ? 'correct' : 'wrong';
    const statusIcon  = wasSkipped ? '⬜' : item.isCorrect ? '✅' : '❌';
    const badge       = wasSkipped ? 'Skipped' : item.isCorrect ? 'Correct' : 'Wrong';

    // Build options HTML
    const optionsHTML = item.options.map((opt, i) => {
      const isUserAns    = item.userAnswer === i;
      const isCorrectAns = item.correctAnswer === i;
      const isBoth       = isUserAns && isCorrectAns;

      let cls  = 'bi-option';
      let tag  = '';
      if (isBoth)            { cls += ' both'; tag = '✓ Your answer (Correct)'; }
      else if (isCorrectAns) { cls += ' correct-ans'; tag = '✓ Correct answer'; }
      else if (isUserAns)    { cls += ' user-ans'; tag = '✗ Your answer'; }

      return `
        <div class="${cls}">
          <span class="bi-option-letter">${optionLetters[i]}.</span>
          <span style="flex:1;">${opt}</span>
          ${tag ? `<span class="bi-opt-tag">${tag}</span>` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="breakdown-item ${statusClass}" data-status="${statusClass}" id="bi-${index}">
        <div class="bi-header" onclick="toggleBreakdownItem(${index})">
          <span class="bi-question-num">Q${index + 1}</span>
          <span class="bi-status-icon">${statusIcon}</span>
          <span class="bi-question-text">${item.question}</span>
          <span class="bi-badge ${statusClass}">${badge}</span>
        </div>
        <div class="bi-body" id="bi-body-${index}">
          <div class="bi-options">${optionsHTML}</div>
          ${item.explanation
            ? `<div class="bi-explanation"><strong>💡 Explanation:</strong> ${item.explanation}</div>`
            : ''
          }
        </div>
      </div>
    `;
  }).join('');
}

/* ============================================
   TOGGLE BREAKDOWN ITEM OPEN/CLOSED
   ============================================ */
function toggleBreakdownItem(index) {
  const body = document.getElementById(`bi-body-${index}`);
  body.classList.toggle('open');
}

/* ============================================
   FILTER BREAKDOWN ITEMS
   ============================================ */
function filterBreakdown(filter, tabEl) {
  // Update active tab
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  tabEl.classList.add('active');

  // Show/hide items
  document.querySelectorAll('.breakdown-item').forEach(item => {
    const status = item.getAttribute('data-status');
    if (filter === 'all') {
      item.style.display = 'block';
    } else if (filter === 'correct') {
      item.style.display = status === 'correct' ? 'block' : 'none';
    } else if (filter === 'wrong') {
      item.style.display = (status === 'wrong' || status === 'skipped') ? 'block' : 'none';
    }
  });
}

/* ============================================
   SCROLL TO BREAKDOWN
   ============================================ */
function scrollToBreakdown() {
  document.getElementById('breakdownAnchor').scrollIntoView({ behavior: 'smooth' });
}

/* ============================================
   SHARE RESULT
   ============================================ */
function shareResult() {
  const resultJSON = localStorage.getItem('latlomp_last_result');
  if (!resultJSON) return;

  const result = JSON.parse(resultJSON);
  const text = `🎓 I just scored ${result.scorePercent}% on ${result.examTitle || 'a CBT exam'} on LatLomp Platform! ${result.isPassed ? '✅ PASSED!' : '📚 Still practicing!'} #LatLomp #CBT #JAMB`;

  if (navigator.share) {
    navigator.share({ title: 'My LatLomp Exam Result', text });
  } else {
    navigator.clipboard.writeText(text).then(() => {
      alert('✅ Result text copied to clipboard!\n\nYou can now paste it anywhere to share.');
    });
  }
}

console.log('🏆 Result page loaded');