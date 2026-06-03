/* ============================================
   STUDENT EXAM ENGINE — JAVASCRIPT
   ============================================ */

let sState = {
  exam:          null,
  questions:     [],
  answers:       {},    // { questionId: selectedIndex (obj) OR text (theory) }
  currentIndex:  0,
  totalSeconds:  0,
  timerInterval: null,
  startTime:     null,
  session:       null,
  isSubmitting:  false,
  wasAutoSubmit: false
};

/* ============================================
   INIT
   ============================================ */
document.addEventListener('DOMContentLoaded', function () {
  const loaderEl = document.getElementById('sLoader');

  // Get data saved by student-login.html
  const session   = sessionStorage.getItem('student_session');
  const examJSON  = sessionStorage.getItem('student_exam');
  const qJSON     = sessionStorage.getItem('student_questions');
  const name      = sessionStorage.getItem('student_name');

  if (!session || !examJSON || !qJSON) {
    loaderEl.style.display = 'none';
    alert('Session expired or invalid. Please login again.');
    window.location.href = 'student-login.html';
    return;
  }

  sState.exam      = JSON.parse(examJSON);
  sState.questions = JSON.parse(qJSON);
  sState.session   = session;
  sState.totalSeconds = sState.exam.duration * 60;

  loaderEl.style.display = 'none';
  showStudentInstructions(name);
});

/* ============================================
   INSTRUCTIONS SCREEN
   ============================================ */
function showStudentInstructions(name) {
  const exam = sState.exam;

  document.getElementById('sExamTitle').textContent    = exam.title;
  document.getElementById('sExamSubject').textContent  = `${exam.subject} • Hello, ${name || 'Student'}!`;
  document.getElementById('sInstDuration').textContent = exam.duration;
  document.getElementById('sInstQuestions').textContent = sState.questions.length;
  document.getElementById('sInstPassMark').textContent = `${exam.passMark}%`;
  document.getElementById('sInstText').textContent     = exam.instructions;

  const instrEl = document.getElementById('sInstructions');
  instrEl.style.display = 'flex';
}

/* ============================================
   BEGIN EXAM
   ============================================ */
function beginStudentExam() {
  sState.startTime = Date.now();

  document.getElementById('sInstructions').style.display   = 'none';
  document.getElementById('sExamInterface').style.display  = 'block';

  document.getElementById('sTopbarTitle').textContent  = sState.exam.title;
  document.getElementById('sTotalCount').textContent   = sState.questions.length;
  document.getElementById('sTotalNum').textContent     = sState.questions.length;
  document.getElementById('sNavTotal').textContent     = sState.questions.length;

  buildStudentNavPanel();
  renderStudentQuestion(0);
  startStudentTimer();
}

/* ============================================
   BUILD NAV PANEL
   ============================================ */
function buildStudentNavPanel() {
  const grid = document.getElementById('sNavGrid');
  grid.innerHTML = '';
  sState.questions.forEach((q, i) => {
    const btn    = document.createElement('button');
    btn.className = 's-qnav';
    btn.textContent = i + 1;
    btn.id          = `sqnav-${i}`;
    btn.onclick     = () => renderStudentQuestion(i);
    grid.appendChild(btn);
  });
}

/* ============================================
   RENDER QUESTION
   ============================================ */
function renderStudentQuestion(index) {
  const q = sState.questions[index];
  if (!q) return;

  sState.currentIndex = index;
  const qId = q._id || q.id;
  const total = sState.questions.length;

  // Update question text and counter
  document.getElementById('sQuestionText').textContent = q.question || q.questionText;
  document.getElementById('sCurrentNum').textContent   = index + 1;
  document.getElementById('sNavCurrent').textContent   = index + 1;

  // Question type badge
  const isTheory = q.questionType === 'theory';
  document.getElementById('sQTypeBadge').textContent = isTheory ? '📝 Theory' : '🔘 Objective';
  document.getElementById('sQTypeBadge').style.background = isTheory ? 'rgba(255,165,0,0.12)' : 'rgba(108,99,255,0.12)';
  document.getElementById('sQTypeBadge').style.color = isTheory ? '#ffa500' : 'var(--primary-light)';

  // Show/hide areas
  document.getElementById('sOptionsArea').style.display = isTheory ? 'none' : 'flex';
  document.getElementById('sTheoryArea').style.display  = isTheory ? 'block' : 'none';

  if (isTheory) {
    // Load saved theory answer
    document.getElementById('sTheoryAnswer').value = sState.answers[qId] || '';
  } else {
    // Render objective options
    const savedAnswer = sState.answers[qId];
    const letters = ['A', 'B', 'C', 'D'];
    const options = q.options || [];

    document.getElementById('sOptionsArea').innerHTML = options.map((opt, i) => `
      <div class="s-option ${savedAnswer === i ? 's-selected' : ''}"
        onclick="sSelectAnswer(${i})" data-index="${i}">
        <div class="s-opt-letter">${letters[i]}</div>
        <div style="font-size:15px; color:${savedAnswer === i ? 'var(--text-primary)' : 'var(--text-secondary)'}; font-weight:${savedAnswer === i ? '500' : '400'};">
          ${opt}
        </div>
      </div>
    `).join('');
  }

  // Nav buttons
  document.getElementById('sPrevBtn').disabled = index === 0;
  document.getElementById('sNextBtn').disabled = index === total - 1;

  updateStudentNavPanel();
  updateStudentAnsweredCount();
  document.querySelector('.s-question-area').scrollTop = 0;
}

/* ============================================
   SELECT ANSWER (Objective)
   ============================================ */
function sSelectAnswer(optionIndex) {
  const q  = sState.questions[sState.currentIndex];
  const qId = q._id || q.id;
  sState.answers[qId] = optionIndex;

  // Update visual
  document.querySelectorAll('.s-option').forEach((el, i) => {
    el.classList.toggle('s-selected', i === optionIndex);
    const letterEl = el.querySelector('.s-opt-letter');
    const textEl   = el.querySelector('div:last-child');
    if (i === optionIndex) {
      if (letterEl) { letterEl.style.background = 'var(--primary)'; letterEl.style.borderColor = 'var(--primary)'; letterEl.style.color = 'white'; }
      if (textEl)   { textEl.style.color = 'var(--text-primary)'; textEl.style.fontWeight = '500'; }
    } else {
      if (letterEl) { letterEl.style.background = ''; letterEl.style.borderColor = ''; letterEl.style.color = ''; }
      if (textEl)   { textEl.style.color = 'var(--text-secondary)'; textEl.style.fontWeight = '400'; }
    }
  });

  updateStudentNavPanel();
  updateStudentAnsweredCount();
}

/* ============================================
   SAVE THEORY ANSWER
   ============================================ */
function saveTheoryAnswer() {
  const q   = sState.questions[sState.currentIndex];
  const qId = q._id || q.id;
  sState.answers[qId] = document.getElementById('sTheoryAnswer').value;
  updateStudentNavPanel();
  updateStudentAnsweredCount();
}

/* ============================================
   NAVIGATE
   ============================================ */
function sNavigate(dir) {
  const next = sState.currentIndex + dir;
  if (next >= 0 && next < sState.questions.length) {
    renderStudentQuestion(next);
  }
}

/* ============================================
   UPDATE NAV PANEL
   ============================================ */
function updateStudentNavPanel() {
  sState.questions.forEach((q, i) => {
    const btn = document.getElementById(`sqnav-${i}`);
    if (!btn) return;
    const qId       = q._id || q.id;
    const answered  = sState.answers[qId] !== undefined && sState.answers[qId] !== '';
    const isCurrent = i === sState.currentIndex;
    btn.className = 's-qnav' + (isCurrent ? ' current' : answered ? ' answered' : '');
  });
}

function updateStudentAnsweredCount() {
  const answered = Object.keys(sState.answers).filter(k => {
    const val = sState.answers[k];
    return val !== undefined && val !== null && val !== '';
  }).length;
  document.getElementById('sAnsweredCount').textContent = answered;
}

/* ============================================
   TIMER
   ============================================ */
function startStudentTimer() {
  let secondsLeft = sState.totalSeconds;
  updateTimerDisplay(secondsLeft);

  sState.timerInterval = setInterval(() => {
    secondsLeft--;
    sState.totalSeconds = secondsLeft;
    updateTimerDisplay(secondsLeft);

    const tw = document.getElementById('sTimerWrapper');
    if      (secondsLeft <= 5 * 60)  tw.className = 's-timer danger';
    else if (secondsLeft <= 10 * 60) tw.className = 's-timer warning';

    if (secondsLeft <= 0) {
      clearInterval(sState.timerInterval);
      sState.wasAutoSubmit = true;
      document.getElementById('sAutoNotice').style.display = 'block';
      setTimeout(() => sSubmitExam(), 2000);
    }
  }, 1000);
}

function updateTimerDisplay(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  document.getElementById('sTimerDisplay').textContent =
    `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

/* ============================================
   CONFIRM SUBMIT MODAL
   ============================================ */
function sConfirmSubmit() {
  if (sState.isSubmitting) return;
  const total    = sState.questions.length;
  const answered = Object.keys(sState.answers).filter(k => sState.answers[k] !== undefined && sState.answers[k] !== '').length;
  const left     = total - answered;

  document.getElementById('sSubmitMsg').textContent =
    `You have answered ${answered} of ${total} questions. ${left > 0 ? `${left} question(s) unanswered.` : 'All questions answered!'}`;
  document.getElementById('sSubmitModal').style.display = 'flex';
}

/* ============================================
   SUBMIT EXAM
   ============================================ */
async function sSubmitExam() {
  if (sState.isSubmitting) return;
  sState.isSubmitting = true;

  clearInterval(sState.timerInterval);

  const btn = document.getElementById('sFinalSubmitBtn');
  if (btn) { btn.textContent = 'Submitting...'; btn.disabled = true; }
  document.getElementById('sSubmitModal').style.display = 'none';

  const timeTaken = sState.startTime
    ? Math.floor((Date.now() - sState.startTime) / 1000 / 60)
    : 0;

  try {
    const res = await apiRequest('/student-exam/submit', 'POST', {
      session:       sState.session,
      answers:       sState.answers,
      timeTaken,
      wasAutoSubmit: sState.wasAutoSubmit
    });

    if (res.ok && res.data.result) {
      // Clear session
      sessionStorage.clear();
      showStudentResult(res.data.result);
    } else {
      throw new Error(res.data.message || 'Submission failed');
    }
  } catch (err) {
    sState.isSubmitting = false;
    if (btn) { btn.textContent = 'Yes, Submit →'; btn.disabled = false; }
    alert(`❌ Error: ${err.message}\nPlease try again.`);
  }
}

/* ============================================
   SHOW RESULT SCREEN
   ============================================ */
function showStudentResult(result) {
  document.getElementById('sExamInterface').style.display = 'none';
  document.getElementById('sResultScreen').style.display  = 'block';

  const { scorePercent, isPassed, objectiveScore, objectiveTotal, studentName } = result;

  const trophy = scorePercent >= 90 ? '🏆' : scorePercent >= 70 ? '🥇' : scorePercent >= 50 ? '🎯' : '📚';

  document.getElementById('sResultTrophy').textContent = trophy;
  document.getElementById('sResultTitle').textContent  = `${studentName || 'Well done'}!`;
  document.getElementById('sResultScore').textContent  = `${scorePercent}%`;
  document.getElementById('sResultScore').style.color  = isPassed ? '#43e97b' : 'var(--secondary)';

  const tagEl = document.getElementById('sResultTag');
  tagEl.textContent   = isPassed ? '✅ PASSED' : '❌ FAILED';
  tagEl.style.background = isPassed ? 'rgba(67,233,123,0.15)' : 'rgba(255,101,132,0.15)';
  tagEl.style.color      = isPassed ? '#43e97b' : 'var(--secondary)';
  tagEl.style.border     = `1px solid ${isPassed ? 'rgba(67,233,123,0.3)' : 'rgba(255,101,132,0.3)'}`;

  const messages = {
    high:   `Outstanding! You scored ${scorePercent}% and clearly know your material very well.`,
    good:   `Great job! You scored ${scorePercent}%. Review the questions you missed and you'll be even better next time.`,
    pass:   `You passed with ${scorePercent}%. Good work! Keep studying to improve your score.`,
    close:  `You scored ${scorePercent}%. You were close! Keep practicing and you'll pass next time.`,
    low:    `You scored ${scorePercent}%. Don't give up — review your notes and try again. Every expert was once a beginner!`
  };

  const msg = scorePercent >= 85 ? messages.high :
              scorePercent >= 70 ? messages.good :
              isPassed           ? messages.pass :
              scorePercent >= 35 ? messages.close : messages.low;

  document.getElementById('sResultMsg').textContent = msg;
}

console.log('🎓 Student Exam Engine loaded');