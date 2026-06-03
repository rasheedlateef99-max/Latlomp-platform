/* ============================================
   TEACHER DASHBOARD — JAVASCRIPT
   ============================================ */

var teacherState = {
  exams:         [],
  currentExamId: null
};

/* ============================================
   SWITCH BETWEEN LOGIN AND REGISTER TABS
   ============================================ */
function switchTeacherTab(tab) {
  var loginForm    = document.getElementById('teacherLoginForm');
  var registerForm = document.getElementById('teacherRegisterForm');
  var loginBtn     = document.getElementById('loginTabBtn');
  var registerBtn  = document.getElementById('registerTabBtn');

  if (!loginForm || !registerForm || !loginBtn || !registerBtn) return;

  if (tab === 'login') {
    loginForm.style.display      = 'block';
    registerForm.style.display   = 'none';
    loginBtn.style.background    = 'linear-gradient(135deg,#43e97b,#38f9d7)';
    loginBtn.style.color         = '#0f0f1a';
    registerBtn.style.background = 'transparent';
    registerBtn.style.color      = 'var(--text-secondary)';
  } else {
    loginForm.style.display      = 'none';
    registerForm.style.display   = 'block';
    registerBtn.style.background = 'linear-gradient(135deg,#43e97b,#38f9d7)';
    registerBtn.style.color      = '#0f0f1a';
    loginBtn.style.background    = 'transparent';
    loginBtn.style.color         = 'var(--text-secondary)';

    var errEl = document.getElementById('teacherRegisterError');
    var sucEl = document.getElementById('teacherRegisterSuccess');
    if (errEl) errEl.style.display = 'none';
    if (sucEl) sucEl.style.display = 'none';
  }
}

/* ============================================
   TEACHER REGISTER
   ============================================ */
async function teacherRegister() {
  var nameEl     = document.getElementById('regTeacherName');
  var emailEl    = document.getElementById('regTeacherEmail');
  var passwordEl = document.getElementById('regTeacherPassword');
  var confirmEl  = document.getElementById('regTeacherConfirm');
  var btnEl      = document.getElementById('teacherRegisterBtn');
  var errEl      = document.getElementById('teacherRegisterError');
  var sucEl      = document.getElementById('teacherRegisterSuccess');

  errEl.style.display = 'none';
  sucEl.style.display = 'none';

  var name     = nameEl.value.trim();
  var email    = emailEl.value.trim();
  var password = passwordEl.value;
  var confirm  = confirmEl.value;

  if (!name) {
    errEl.textContent   = '⚠️ Please enter your full name.';
    errEl.style.display = 'block';
    nameEl.focus();
    return;
  }
  if (!email) {
    errEl.textContent   = '⚠️ Please enter your email address.';
    errEl.style.display = 'block';
    emailEl.focus();
    return;
  }
  if (password.length < 6) {
    errEl.textContent   = '⚠️ Password must be at least 6 characters long.';
    errEl.style.display = 'block';
    passwordEl.focus();
    return;
  }
  if (password !== confirm) {
    errEl.textContent   = '⚠️ Passwords do not match. Please check and try again.';
    errEl.style.display = 'block';
    confirmEl.focus();
    return;
  }

  btnEl.textContent = 'Creating account...';
  btnEl.disabled    = true;

  var result = await apiRequest('/auth/register-teacher', 'POST', { name, email, password });

  btnEl.disabled    = false;
  btnEl.textContent = 'Create Teacher Account →';

  if (!result.ok) {
    errEl.textContent   = result.data.message || 'Registration failed. Please try again.';
    errEl.style.display = 'block';
    return;
  }

  sucEl.innerHTML =
    '<div style="text-align:center;">' +
      '<div style="font-size:48px; margin-bottom:12px;">📧</div>' +
      '<strong style="font-size:16px; display:block; margin-bottom:8px;">Check Your Email!</strong>' +
      result.data.message +
      (result.data.devNote ?
        '<div style="margin-top:12px; background:rgba(255,165,0,0.1); border:1px solid rgba(255,165,0,0.3); border-radius:8px; padding:10px 14px; font-size:12px; color:#ffa500;">🛠️ <strong>Dev Mode:</strong> Check your VS Code terminal for the verification link.</div>'
        : '') +
    '</div>';
  sucEl.style.display = 'block';

  btnEl.style.display = 'none';
  document.getElementById('regTeacherName').disabled     = true;
  document.getElementById('regTeacherEmail').disabled    = true;
  document.getElementById('regTeacherPassword').disabled = true;
  document.getElementById('regTeacherConfirm').disabled  = true;

  saveAuthData(result.data.token, result.data.user);
  setTimeout(function() { window.location.reload(); }, 1500);
}

/* ============================================
   TEACHER LOGIN
   ============================================ */
async function teacherLogin() {
  var emailEl = document.getElementById('teacherLoginEmail');
  var passEl  = document.getElementById('teacherLoginPassword');
  var btnEl   = document.getElementById('teacherLoginBtn');
  var errEl   = document.getElementById('teacherLoginError');

  if (errEl) errEl.style.display = 'none';

  var email    = emailEl ? emailEl.value.trim() : '';
  var password = passEl  ? passEl.value         : '';

  if (!email) {
    if (errEl) { errEl.textContent = '⚠️ Please enter your email address.'; errEl.style.display = 'block'; }
    if (emailEl) emailEl.focus();
    return;
  }
  if (!password) {
    if (errEl) { errEl.textContent = '⚠️ Please enter your password.'; errEl.style.display = 'block'; }
    if (passEl) passEl.focus();
    return;
  }

  if (btnEl) { btnEl.textContent = 'Logging in...'; btnEl.disabled = true; }

  try {
    var result = await apiRequest('/auth/login', 'POST', { email, password });

    if (btnEl) { btnEl.textContent = 'Login →'; btnEl.disabled = false; }

    if (result.ok) {
      var user = result.data.user;

      if (user.role !== 'teacher' && user.role !== 'admin') {
        if (errEl) {
          errEl.textContent   = '⛔ This account is not a teacher account. Please use the main login instead.';
          errEl.style.display = 'block';
        }
        return;
      }

      saveAuthData(result.data.token, user);

      if (btnEl) {
        btnEl.textContent      = '✅ Welcome back! Loading...';
        btnEl.style.background = 'linear-gradient(135deg,#43e97b,#38f9d7)';
      }

      setTimeout(function() { window.location.reload(); }, 600);

    } else {
      if (result.data && result.data.requiresVerification) {
        showTeacherVerificationNotice(email);
      } else if (result.status === 401) {
        if (errEl) { errEl.textContent = '❌ Incorrect email or password. Please check and try again.'; errEl.style.display = 'block'; }
        if (passEl) { passEl.value = ''; passEl.focus(); }
      } else if (result.status === 403) {
        if (errEl) { errEl.textContent = '⛔ ' + (result.data.message || 'This account has been deactivated.'); errEl.style.display = 'block'; }
      } else if (result.status === 0) {
        if (errEl) { errEl.innerHTML = '⚠️ Could not connect to server.'; errEl.style.display = 'block'; }
      } else {
        if (errEl) { errEl.textContent = result.data.message || '❌ Login failed. Please try again.'; errEl.style.display = 'block'; }
      }
    }

  } catch (unexpectedError) {
    console.error('teacherLogin unexpected error:', unexpectedError);
    if (btnEl) { btnEl.textContent = 'Login →'; btnEl.disabled = false; }
    if (errEl) { errEl.textContent = '❌ An unexpected error occurred. Please refresh and try again.'; errEl.style.display = 'block'; }
  }
}

/* ============================================
   PAGE INIT
   ============================================ */
document.addEventListener('DOMContentLoaded', async function() {

  /* Initialize sidebar */
  initSidebarOverlay();
  initSidebarNavLinks();

  /* Initialize Google */
  if (typeof google !== 'undefined' && google.accounts) {
    google.accounts.id.initialize({
      client_id:   '804260807914-tl2i27hblh8f3s1g4a5ip12hejosk0ab.apps.googleusercontent.com',
      callback:    handleTeacherGoogleResponse,
      auto_select: false
    });
  }

  var loaderEl = document.getElementById('teacherLoader');
  var appEl    = document.getElementById('teacherApp');
  var deniedEl = document.getElementById('accessDenied');

  function showScreen(which) {
    if (loaderEl) loaderEl.style.display = 'none';

    if (which === 'app') {
      /* ✅ FIX: Use 'block' not 'flex' — sidebar is position:fixed */
      if (appEl)    appEl.style.display    = 'block';
      if (deniedEl) deniedEl.style.display = 'none';
    } else {
      if (deniedEl) deniedEl.style.display = 'flex';
      if (appEl)    appEl.style.display    = 'none';
    }
  }

  var safetyTimeout = setTimeout(function() {
    console.warn('⚠️ Teacher dashboard: safety timeout triggered');
    showScreen('denied');
  }, 8000);

  try {
    var user = getCurrentUser();

    if (!user) {
      clearTimeout(safetyTimeout);
      showScreen('denied');
      return;
    }

    var meRes = await apiRequest('/auth/me');

    if (!meRes.ok) {
      localStorage.removeItem('latlomp_token');
      localStorage.removeItem('latlomp_user');
      clearTimeout(safetyTimeout);
      showScreen('denied');
      return;
    }

    var serverUser = meRes.data.user;
    if (!serverUser) {
      clearTimeout(safetyTimeout);
      showScreen('denied');
      return;
    }

    if (serverUser.role !== 'teacher' && serverUser.role !== 'admin') {
      clearTimeout(safetyTimeout);
      showScreen('denied');
      return;
    }

    clearTimeout(safetyTimeout);
    showScreen('app');

    var name = serverUser.name || user.name || 'Teacher';

    var nameEls = [
      document.getElementById('teacherName'),
      document.getElementById('overviewTeacherName')
    ];
    nameEls.forEach(function(el) {
      if (el) el.textContent = el.id === 'overviewTeacherName' ? name.split(' ')[0] : name;
    });

    var avatarEl = document.getElementById('teacherAvatar');
    if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();

    var dateEl = document.getElementById('teacherDate');
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('en-NG', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
    }

    await loadTeacherOverview();
    await loadTeacherExams();

  } catch (err) {
    console.error('Teacher dashboard init error:', err);
    clearTimeout(safetyTimeout);
    showScreen('denied');
  }
});

/* ============================================
   SECTION NAVIGATION
   ============================================ */
function showTeacherSection(name) {
  document.querySelectorAll('.teacher-section').forEach(function(s) {
    s.classList.remove('active');
  });

  var section = document.getElementById('ts-' + name);
  if (section) section.classList.add('active');

  document.querySelectorAll('.teacher-nav-link[data-section]').forEach(function(l) {
    l.classList.remove('active');
  });
  var link = document.querySelector('.teacher-nav-link[data-section="' + name + '"]');
  if (link) link.classList.add('active');

  /* ✅ FIX: Correct element ID */
  var mobileSection = document.getElementById('mobileBarSection');
  if (mobileSection) {
    var labels = { overview: 'Overview', exams: 'My Exams', questions: 'Questions', students: 'Students' };
    mobileSection.textContent = labels[name] || name;
  }

  /* Close sidebar on mobile after navigation */
  if (window.innerWidth <= 960) {
    closeSidebar();
  }

  if (name === 'students')  populateStudentExamSelector();
  if (name === 'questions') populateQuestionExamSelector();
}

/* ============================================
   SIDEBAR — MOBILE NAVIGATION
   ============================================ */
var _sidebarOpen = false;

function openSidebar() {
  if (_sidebarOpen) return;
  _sidebarOpen = true;

  var sidebar = document.getElementById('teacherSidebar');
  var overlay = document.getElementById('teacherSidebarOverlay');

  if (sidebar) sidebar.classList.add('open');
  if (overlay) overlay.classList.add('visible');
  document.body.style.overflow = 'hidden';

  if (window.history && window.history.pushState) {
    window.history.pushState({ sidebarOpen: true }, '');
  }
}

function closeSidebar() {
  if (!_sidebarOpen) return;
  _sidebarOpen = false;

  var sidebar = document.getElementById('teacherSidebar');
  var overlay = document.getElementById('teacherSidebarOverlay');

  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('visible');
  document.body.style.overflow = '';
}

function toggleSidebar() {
  if (_sidebarOpen) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

window.addEventListener('popstate', function() {
  if (_sidebarOpen) closeSidebar();
});

window.addEventListener('resize', function() {
  if (window.innerWidth > 960 && _sidebarOpen) {
    _sidebarOpen = false;
    var sidebar = document.getElementById('teacherSidebar');
    var overlay = document.getElementById('teacherSidebarOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
    document.body.style.overflow = '';
  }
});

function initSidebarNavLinks() {
  /* ✅ FIX: Correct class name */
  var links = document.querySelectorAll('.sb-link');
  links.forEach(function(link) {
    link.addEventListener('click', function() {
      if (window.innerWidth <= 960) {
        closeSidebar();
      }
    });
  });
}

function initSidebarOverlay() {
  var overlay = document.getElementById('teacherSidebarOverlay');
  if (overlay) {
    overlay.removeEventListener('click', closeSidebar);
    overlay.addEventListener('click', closeSidebar);
  }
}

function teacherLogout() {
  if (confirm('Log out of Teacher Dashboard?')) logout();
}

/* ============================================
   TOAST
   ============================================ */
function teacherToast(msg, type) {
  type = type || 'info';
  var el = document.getElementById('teacherToast');
  if (!el) return;
  el.textContent   = msg;
  el.style.display = 'block';
  el.style.color   = type === 'success' ? '#43e97b' : type === 'error' ? 'var(--secondary)' : 'var(--primary-light)';
  el.style.borderColor = type === 'success' ? 'rgba(67,233,123,0.4)' : type === 'error' ? 'rgba(255,101,132,0.4)' : 'rgba(108,99,255,0.4)';
  setTimeout(function() { el.style.display = 'none'; }, 3500);
}

/* ============================================
   MODAL HELPERS
   ============================================ */
function closeTeacherModal(id) {
  var el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

document.addEventListener('click', function(e) {
  if (e.target.classList.contains('t-modal-overlay')) {
    e.target.style.display = 'none';
  }
});

/* ============================================
   OVERVIEW — Load stats
   ============================================ */
async function loadTeacherOverview() {
  var res = await apiRequest('/teacher/dashboard');
  if (!res.ok) return;

  var dashboard = res.data.dashboard;

  document.getElementById('ovTotalExams').textContent    = dashboard.totalExams;
  document.getElementById('ovTotalStudents').textContent = dashboard.totalSubmissions;

  var active = dashboard.recentExams.filter(function(e) { return e.isActive; }).length;
  document.getElementById('ovActiveExams').textContent = active;

  var el = document.getElementById('ovRecentExams');
  if (dashboard.recentExams.length === 0) {
    el.innerHTML = '<div class="teacher-empty">No exams yet. Click "+ Create New Exam" to get started!</div>';
    return;
  }

  el.innerHTML = dashboard.recentExams.map(function(e) {
    return '<div style="display:flex; align-items:center; gap:14px; padding:14px 22px; border-top:1px solid var(--border);">' +
      '<div style="flex:1;">' +
        '<div style="font-weight:700; color:var(--text-primary); font-size:14px;">' + e.title + '</div>' +
        '<div style="font-size:12px; color:var(--text-muted); margin-top:3px;">' + e.subject + '</div>' +
      '</div>' +
      '<span class="exam-code">' + e.examCode + '</span>' +
      '<span style="font-size:12px; color:var(--text-muted);">' + e.totalAttempts + ' attempts</span>' +
      '<span style="font-size:11px; padding:3px 10px; border-radius:20px; font-weight:700; background:' + (e.isActive ? 'rgba(67,233,123,0.12)' : 'rgba(255,255,255,0.06)') + '; color:' + (e.isActive ? '#43e97b' : 'var(--text-muted)') + ';">' +
        (e.isActive ? 'Active' : 'Draft') +
      '</span>' +
    '</div>';
  }).join('');
}

/* ============================================
   EXAMS — Load all teacher exams
   ============================================ */
async function loadTeacherExams() {
  var res = await apiRequest('/teacher/exams');
  if (!res.ok) { teacherToast('Failed to load exams', 'error'); return; }

  teacherState.exams = res.data.exams;
  document.getElementById('examsCount').textContent = res.data.exams.length;

  var tbody = document.getElementById('examsTableBody');

  if (res.data.exams.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="teacher-loading">No exams yet. Click "+ Create Exam" to start.</td></tr>';
    return;
  }

  var typeLabels = { objective: 'Objective', theory: 'Theory', both: 'Obj + Theory' };

  tbody.innerHTML = res.data.exams.map(function(e) {
    return '<tr>' +
      '<td style="font-weight:700; color:var(--text-primary);">' + e.title + '</td>' +
      '<td><span style="font-size:12px; background:rgba(108,99,255,0.1); color:var(--primary-light); padding:3px 10px; border-radius:20px; font-weight:700;">' + (typeLabels[e.examType] || e.examType) + '</span></td>' +
      '<td>' + e.duration + ' mins</td>' +
      '<td><span class="exam-code">' + e.examCode + '</span></td>' +
      '<td style="font-weight:700; color:var(--primary-light);">—</td>' +
      '<td>' + e.totalAttempts + '</td>' +
      '<td><span style="font-size:11px; padding:3px 10px; border-radius:20px; font-weight:700; background:' + (e.isActive ? 'rgba(67,233,123,0.12)' : 'rgba(255,255,255,0.06)') + '; color:' + (e.isActive ? '#43e97b' : 'var(--text-muted)') + ';">' + (e.isActive ? 'Active' : 'Draft') + '</span></td>' +
      '<td><div style="display:flex; gap:6px; flex-wrap:wrap;">' +
        '<button class="tbl-btn" onclick="editExam(\'' + e._id + '\')">Edit</button>' +
        '<button class="tbl-btn" onclick="goToExamQuestions(\'' + e._id + '\')">Questions</button>' +
        '<button class="tbl-btn tbl-btn-danger" onclick="deleteTeacherExam(\'' + e._id + '\', \'' + e.title + '\')">🗑</button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}

/* ============================================
   CREATE / EDIT EXAM MODAL
   ============================================ */
function openCreateExamModal(examId) {
  examId = examId || null;
  document.getElementById('createExamForm').reset();
  document.getElementById('editExamId').value = '';

  if (examId) {
    var exam = teacherState.exams.find(function(e) { return e._id === examId; });
    if (!exam) return;
    document.getElementById('examModalHeading').textContent  = 'Edit Exam';
    document.getElementById('saveExamBtn').textContent       = 'Save Changes';
    document.getElementById('editExamId').value              = exam._id;
    document.getElementById('newExamTitle').value            = exam.title;
    document.getElementById('newExamSubject').value          = exam.subject;
    document.getElementById('newExamType').value             = exam.examType;
    document.getElementById('newExamDuration').value         = exam.duration;
    document.getElementById('newExamPassMark').value         = exam.passMark;
    document.getElementById('newExamCode').value             = exam.examCode;
    document.getElementById('newExamInstructions').value     = exam.instructions;
    document.getElementById('newExamActive').value           = String(exam.isActive);
  } else {
    document.getElementById('examModalHeading').textContent  = 'Create New Exam';
    document.getElementById('saveExamBtn').textContent       = 'Create Exam';
  }

  document.getElementById('createExamModal').style.display = 'flex';
}

function editExam(id) { openCreateExamModal(id); }

async function saveTeacherExam(e) {
  e.preventDefault();
  var btn = document.getElementById('saveExamBtn');
  btn.textContent = 'Saving...';
  btn.disabled    = true;

  var examId  = document.getElementById('editExamId').value;
  var payload = {
    title:        document.getElementById('newExamTitle').value,
    subject:      document.getElementById('newExamSubject').value,
    examType:     document.getElementById('newExamType').value,
    duration:     parseInt(document.getElementById('newExamDuration').value),
    passMark:     parseInt(document.getElementById('newExamPassMark').value),
    examCode:     document.getElementById('newExamCode').value.toUpperCase().trim(),
    instructions: document.getElementById('newExamInstructions').value,
    isActive:     document.getElementById('newExamActive').value === 'true'
  };

  var method   = examId ? 'PUT'  : 'POST';
  var endpoint = examId ? '/teacher/exams/' + examId : '/teacher/exams';
  var res      = await apiRequest(endpoint, method, payload);

  btn.disabled    = false;
  btn.textContent = examId ? 'Save Changes' : 'Create Exam';

  if (res.ok) {
    teacherToast(res.data.message, 'success');
    closeTeacherModal('createExamModal');
    await loadTeacherExams();
    await loadTeacherOverview();
    populateStudentExamSelector();
    populateQuestionExamSelector();
  } else {
    teacherToast(res.data.message || 'Save failed', 'error');
  }
}

async function deleteTeacherExam(id, title) {
  if (!confirm('Delete exam "' + title + '"?\n\nThis will also delete all questions and student submissions for this exam.')) return;

  var res = await apiRequest('/teacher/exams/' + id, 'DELETE');
  if (res.ok) {
    teacherToast(res.data.message, 'success');
    loadTeacherExams();
    loadTeacherOverview();
  } else {
    teacherToast(res.data.message || 'Delete failed', 'error');
  }
}

/* ============================================
   QUESTIONS
   ============================================ */
function populateQuestionExamSelector() {
  var sel      = document.getElementById('questionExamSelector');
  var currentVal = sel.value;
  sel.innerHTML = '<option value="">-- Choose an exam --</option>' +
    teacherState.exams.map(function(e) {
      return '<option value="' + e._id + '">' + e.title + ' [' + e.examCode + ']</option>';
    }).join('');
  if (currentVal) sel.value = currentVal;
}

async function loadTeacherQuestions() {
  var examId = document.getElementById('questionExamSelector').value;
  var cardEl = document.getElementById('questionsCardWrapper');
  var addBtn = document.getElementById('addQuestionBtn');

  if (!examId) {
    cardEl.style.display = 'none';
    addBtn.style.display = 'none';
    return;
  }

  cardEl.style.display = 'block';
  addBtn.style.display = 'inline-flex';

  var exam = teacherState.exams.find(function(e) { return e._id === examId; });
  if (exam) {
    document.getElementById('selectedExamType').textContent =
      'Type: ' + exam.examType.charAt(0).toUpperCase() + exam.examType.slice(1);
    document.getElementById('questionsCardTitle').textContent = 'Questions — ' + exam.title;
    teacherState.currentExamId = examId;
  }

  var res = await apiRequest('/teacher/exams/' + examId + '/questions');
  if (!res.ok) { teacherToast('Failed to load questions', 'error'); return; }

  var questions = res.data.questions;
  document.getElementById('questionsCount').textContent = questions.length + ' questions';

  var listEl = document.getElementById('questionsListWrapper');

  if (questions.length === 0) {
    listEl.innerHTML = '<div class="teacher-empty">No questions yet. Click "+ Add Question" to start building this exam.</div>';
    return;
  }

  var optLetters = ['A', 'B', 'C', 'D'];

  listEl.innerHTML = questions.map(function(q, i) {
    var optionsHtml = '';
    if (q.questionType === 'objective') {
      optionsHtml = '<div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:8px;">' +
        q.options.map(function(opt, idx) {
          return '<span style="font-size:12px; padding:3px 10px; border-radius:6px; background:' +
            (idx === q.correctAnswer ? 'rgba(67,233,123,0.15)' : 'rgba(255,255,255,0.04)') +
            '; color:' + (idx === q.correctAnswer ? '#43e97b' : 'var(--text-secondary)') +
            '; border:1px solid ' + (idx === q.correctAnswer ? 'rgba(67,233,123,0.3)' : 'var(--border)') + ';">' +
            optLetters[idx] + ': ' + opt + (idx === q.correctAnswer ? ' ✓' : '') +
          '</span>';
        }).join('') +
      '</div>';
    } else {
      optionsHtml = '<div style="font-size:12px; color:var(--text-muted); font-style:italic; margin-top:6px;">Theory question — written answer required</div>';
    }

    return '<div style="display:flex; align-items:flex-start; gap:14px; padding:16px 22px; border-top:1px solid var(--border);">' +
      '<div style="width:28px; height:28px; border-radius:8px; background:rgba(108,99,255,0.12); color:var(--primary-light); display:flex; align-items:center; justify-content:center; font-weight:800; font-size:13px; flex-shrink:0;">' + (i + 1) + '</div>' +
      '<div style="flex:1; min-width:0;">' +
        '<span style="font-size:11px; font-weight:700; padding:2px 8px; border-radius:20px; margin-bottom:8px; display:inline-block; background:' +
          (q.questionType === 'objective' ? 'rgba(108,99,255,0.12)' : 'rgba(255,165,0,0.12)') +
        '; color:' + (q.questionType === 'objective' ? 'var(--primary-light)' : '#ffa500') + ';">' +
          q.questionType +
        '</span>' +
        '<div style="font-size:14px; font-weight:600; color:var(--text-primary); margin-bottom:4px;">' + q.questionText + '</div>' +
        optionsHtml +
        '<div style="font-size:12px; color:var(--text-muted); margin-top:6px;">Marks: ' + q.marks + '</div>' +
      '</div>' +
      '<button class="tbl-btn tbl-btn-danger" onclick="deleteTeacherQuestion(\'' + q._id + '\')">🗑</button>' +
    '</div>';
  }).join('');
}

function goToExamQuestions(examId) {
  showTeacherSection('questions');
  setTimeout(function() {
    var sel = document.getElementById('questionExamSelector');
    sel.value = examId;
    loadTeacherQuestions();
  }, 150);
}

/* ============================================
   ADD QUESTION MODAL
   ============================================ */
function toggleQuestionType(type) {
  document.getElementById('objectiveFields').style.display = type === 'objective' ? 'grid' : 'none';
  document.getElementById('theoryFields').style.display    = type === 'theory'    ? 'flex' : 'none';
  ['optA', 'optB', 'qCorrectAnswer'].forEach(function(id) {
    document.getElementById(id).required = (type === 'objective');
  });
}

function openAddQuestionModal() {
  document.getElementById('addQuestionForm').reset();
  document.getElementById('editQuestionId').value             = '';
  document.getElementById('questionModalHeading').textContent = 'Add Question';
  document.getElementById('saveQuestionBtn').textContent      = 'Add Question';
  document.getElementById('objectiveFields').style.display    = 'grid';
  document.getElementById('theoryFields').style.display       = 'none';
  ['optA', 'optB', 'qCorrectAnswer'].forEach(function(id) {
    document.getElementById(id).required = true;
  });
  document.getElementById('addQuestionModal').style.display = 'flex';
}

async function saveTeacherQuestion(e) {
  e.preventDefault();
  var btn = document.getElementById('saveQuestionBtn');
  btn.textContent = 'Saving...';
  btn.disabled    = true;

  var examId = teacherState.currentExamId;
  if (!examId) {
    teacherToast('Please select an exam first', 'error');
    btn.disabled = false; btn.textContent = 'Add Question';
    return;
  }

  var qType   = document.querySelector('input[name="qType"]:checked').value;
  var options = [
    document.getElementById('optA').value.trim(),
    document.getElementById('optB').value.trim(),
    document.getElementById('optC').value.trim(),
    document.getElementById('optD').value.trim()
  ].filter(function(o) { return o !== ''; });

  var payload = {
    questionType: qType,
    questionText: document.getElementById('qText').value.trim(),
    marks:        parseInt(document.getElementById('qMarks').value) || 1
  };

  if (qType === 'objective') {
    payload.options       = options;
    payload.correctAnswer = parseInt(document.getElementById('qCorrectAnswer').value);
  } else {
    payload.expectedAnswer = document.getElementById('qExpectedAnswer').value.trim();
  }

  var res = await apiRequest('/teacher/exams/' + examId + '/questions', 'POST', payload);

  btn.disabled    = false;
  btn.textContent = 'Add Question';

  if (res.ok) {
    teacherToast(res.data.message, 'success');
    closeTeacherModal('addQuestionModal');
    loadTeacherQuestions();
  } else {
    teacherToast(res.data.message || 'Failed to add question', 'error');
  }
}

async function deleteTeacherQuestion(id) {
  if (!confirm('Delete this question?')) return;
  var res = await apiRequest('/teacher/questions/' + id, 'DELETE');
  if (res.ok) {
    teacherToast('Question deleted', 'success');
    loadTeacherQuestions();
  } else {
    teacherToast(res.data.message || 'Delete failed', 'error');
  }
}

/* ============================================
   STUDENT MONITORING
   ============================================ */
function populateStudentExamSelector() {
  var sel = document.getElementById('studentExamSelector');
  sel.innerHTML = '<option value="">-- Choose an exam to see its students --</option>' +
    teacherState.exams.map(function(e) {
      return '<option value="' + e._id + '">' + e.title + ' [' + e.examCode + '] — ' + e.totalAttempts + ' attempts</option>';
    }).join('');
}

async function loadStudentSubmissions() {
  var examId = document.getElementById('studentExamSelector').value;
  var cardEl = document.getElementById('studentsCard');

  if (!examId) { cardEl.style.display = 'none'; return; }
  cardEl.style.display = 'block';

  var res = await apiRequest('/teacher/exams/' + examId + '/submissions');
  if (!res.ok) { teacherToast('Failed to load submissions', 'error'); return; }

  var submissions = res.data.submissions;
  var examTitle   = res.data.examTitle;
  var examCode    = res.data.examCode;
  var count       = res.data.count;

  document.getElementById('studentsCardTitle').textContent = examTitle + ' [' + examCode + ']';
  document.getElementById('studentsCount').textContent     = count + ' student' + (count !== 1 ? 's' : '');

  var tbody = document.getElementById('studentsTableBody');

  if (submissions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="teacher-loading">No students have taken this exam yet.</td></tr>';
    return;
  }

  tbody.innerHTML = submissions.map(function(s, i) {
    return '<tr>' +
      '<td style="color:var(--text-muted);">' + (i + 1) + '</td>' +
      '<td style="font-weight:700; color:var(--text-primary);">' + s.studentName + '</td>' +
      '<td style="font-weight:700; color:' + (s.scorePercent >= 50 ? '#43e97b' : 'var(--secondary)') + ';">' +
        s.scorePercent + '% (' + s.objectiveScore + '/' + s.objectiveTotal + ')' +
      '</td>' +
      '<td><span style="font-size:11px; font-weight:700; padding:3px 10px; border-radius:20px; background:' +
        (s.isPassed ? 'rgba(67,233,123,0.12)' : 'rgba(255,101,132,0.12)') +
        '; color:' + (s.isPassed ? '#43e97b' : 'var(--secondary)') + ';">' +
        (s.isPassed ? '✅ PASSED' : '❌ FAILED') +
      '</span></td>' +
      '<td style="color:var(--text-muted);">' + (s.timeTaken || 0) + ' min</td>' +
      '<td style="color:var(--text-muted);">' +
        new Date(s.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) +
      '</td>' +
      '<td><button class="tbl-btn" onclick="viewStudentAnswers(\'' + s._id + '\')">View Answers</button></td>' +
    '</tr>';
  }).join('');
}

async function viewStudentAnswers(submissionId) {
  var examId = document.getElementById('studentExamSelector').value;
  var res    = await apiRequest('/teacher/exams/' + examId + '/submissions');
  if (!res.ok) return;

  var submission = res.data.submissions.find(function(s) { return s._id === submissionId; });
  if (!submission) return;

  document.getElementById('submissionModalTitle').textContent =
    submission.studentName + ' — ' + submission.examTitle;

  var optLetters = ['A', 'B', 'C', 'D'];

  var bodyHTML =
    '<div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom:24px; padding-bottom:20px; border-bottom:1px solid var(--border);">' +
      '<div style="text-align:center; flex:1; min-width:100px;">' +
        '<div style="font-size:28px; font-weight:900; color:' + (submission.scorePercent >= 50 ? '#43e97b' : 'var(--secondary)') + ';">' + submission.scorePercent + '%</div>' +
        '<div style="font-size:12px; color:var(--text-muted);">Score</div>' +
      '</div>' +
      '<div style="text-align:center; flex:1; min-width:100px;">' +
        '<div style="font-size:28px; font-weight:900;">' + submission.objectiveScore + '/' + submission.objectiveTotal + '</div>' +
        '<div style="font-size:12px; color:var(--text-muted);">Correct</div>' +
      '</div>' +
      '<div style="text-align:center; flex:1; min-width:100px;">' +
        '<div style="font-size:28px; font-weight:900;">' + (submission.timeTaken || 0) + ' min</div>' +
        '<div style="font-size:12px; color:var(--text-muted);">Time Taken</div>' +
      '</div>' +
    '</div>' +
    '<div style="display:flex; flex-direction:column; gap:16px;">' +
    submission.answers.map(function(a, i) {
      var answerHtml = '';
      if (a.questionType === 'objective') {
        answerHtml =
          '<div style="font-size:13px; margin-bottom:4px;">' +
            '<span style="color:var(--text-muted);">Student answered: </span>' +
            '<strong style="color:' + (a.isCorrect ? '#43e97b' : 'var(--secondary)') + ';">' +
              (a.studentAnswer !== null && a.studentAnswer !== undefined
                ? optLetters[a.studentAnswer] + ': ' + (a.options && a.options[a.studentAnswer] ? a.options[a.studentAnswer] : '—')
                : 'Not answered') +
            '</strong>' +
          '</div>' +
          (!a.isCorrect && a.correctAnswer !== null
            ? '<div style="font-size:13px; color:#43e97b;">Correct answer: ' + optLetters[a.correctAnswer] + '</div>'
            : '');
      } else {
        answerHtml =
          '<div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:8px; padding:10px 14px; font-size:13px; color:var(--text-secondary);">' +
            (a.studentAnswer || '<em style="color:var(--text-muted);">No answer written</em>') +
          '</div>';
      }

      return '<div style="background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:10px; padding:16px; border-left:3px solid ' +
        (a.isCorrect === null ? '#ffa500' : a.isCorrect ? '#43e97b' : 'var(--secondary)') + ';">' +
        '<div style="font-size:12px; font-weight:700; color:var(--text-muted); margin-bottom:8px;">' +
          'Q' + (i + 1) + ' — ' + (a.questionType === 'theory' ? '📝 Theory' : '🔘 Objective') +
        '</div>' +
        '<div style="font-size:14px; font-weight:600; color:var(--text-primary); margin-bottom:12px;">' + a.questionText + '</div>' +
        answerHtml +
      '</div>';
    }).join('') +
    '</div>';

  document.getElementById('submissionModalBody').innerHTML = bodyHTML;
  document.getElementById('viewSubmissionModal').style.display = 'flex';
}

/* ============================================
   SHOW TEACHER PANEL (login/forgot switcher)
   ============================================ */
function showTeacherPanel(panel) {
  var loginForm   = document.getElementById('teacherLoginForm');
  var forgotPanel = document.getElementById('teacherForgotPanel');

  if (!loginForm || !forgotPanel) return;

  if (panel === 'forgot') {
    loginForm.style.display   = 'none';
    forgotPanel.style.display = 'block';
    var errEl   = document.getElementById('teacherForgotError');
    var sucEl   = document.getElementById('teacherForgotSuccess');
    var emailEl = document.getElementById('teacherForgotEmail');
    if (errEl)   errEl.style.display = 'none';
    if (sucEl)   sucEl.style.display = 'none';
    if (emailEl) { emailEl.value = ''; setTimeout(function() { emailEl.focus(); }, 100); }
  } else {
    loginForm.style.display   = 'block';
    forgotPanel.style.display = 'none';
  }
}

/* ============================================
   SEND TEACHER FORGOT PASSWORD
   ============================================ */
async function sendTeacherForgot() {
  var emailEl = document.getElementById('teacherForgotEmail');
  var errEl   = document.getElementById('teacherForgotError');
  var sucEl   = document.getElementById('teacherForgotSuccess');
  var btn     = document.getElementById('teacherForgotBtn');

  if (errEl) errEl.style.display = 'none';
  if (sucEl) sucEl.style.display = 'none';

  var email = emailEl ? emailEl.value.trim() : '';

  if (!email) {
    if (errEl) { errEl.textContent = '⚠️ Please enter your email address.'; errEl.style.display = 'block'; }
    return;
  }

  btn.textContent = 'Sending...';
  btn.disabled    = true;

  var result = await apiRequest('/auth/forgot-password', 'POST', { email });

  btn.disabled    = false;
  btn.textContent = 'Send Reset Link →';

  if (result.ok) {
    if (sucEl) {
      sucEl.innerHTML = '✅ ' + result.data.message +
        (result.data.devNote ? '<div style="margin-top:8px; font-size:12px; color:#ffa500;">🛠️ Dev Mode: Check your VS Code terminal.</div>' : '');
      sucEl.style.display = 'block';
    }
    if (emailEl) emailEl.value = '';
  } else {
    if (errEl) { errEl.textContent = result.data.message || 'Something went wrong. Please try again.'; errEl.style.display = 'block'; }
  }
}

/* ============================================
   TEACHER VERIFICATION NOTICE
   ============================================ */
function showTeacherVerificationNotice(email) {
  var loginForm   = document.getElementById('teacherLoginForm');
  var forgotPanel = document.getElementById('teacherForgotPanel');
  if (loginForm)   loginForm.style.display   = 'none';
  if (forgotPanel) forgotPanel.style.display = 'none';

  var existing = document.getElementById('teacherVerifyNotice');
  if (existing) existing.remove();

  var notice = document.createElement('div');
  notice.id = 'teacherVerifyNotice';
  notice.innerHTML =
    '<div style="text-align:center; margin-bottom:20px;">' +
      '<div style="font-size:48px; margin-bottom:10px;">📧</div>' +
      '<h3 style="font-size:18px; font-weight:800; color:var(--text-primary); margin:0 0 8px;">Verify Your Email First</h3>' +
      '<p style="font-size:13px; color:var(--text-secondary); line-height:1.6; margin:0;">Your account for <strong style="color:var(--primary-light);">' + email + '</strong> is registered but not yet verified.</p>' +
    '</div>' +
    '<div style="background:rgba(108,99,255,0.07); border:1px solid rgba(108,99,255,0.2); border-radius:10px; padding:16px 18px; margin-bottom:20px;">' +
      '<p style="font-size:13px; font-weight:700; color:var(--primary-light); margin:0 0 10px;">Choose how to verify:</p>' +
      '<div style="font-size:13px; color:var(--text-secondary); margin-bottom:6px;">📬 <strong>Option 1:</strong> Click the verification link in your email.</div>' +
      '<div style="font-size:13px; color:var(--text-secondary);">🔢 <strong>Option 2:</strong> Enter the 6-digit OTP code below.</div>' +
    '</div>' +
    '<div id="teacherOtpSection">' +
      '<div id="teacherOtpError" style="display:none; background:rgba(255,101,132,0.1); border:1px solid rgba(255,101,132,0.3); color:var(--secondary); padding:10px 14px; border-radius:8px; font-size:13px; margin-bottom:12px;"></div>' +
      '<div id="teacherOtpSuccess" style="display:none; background:rgba(67,233,123,0.1); border:1px solid rgba(67,233,123,0.3); color:#43e97b; padding:10px 14px; border-radius:8px; font-size:13px; margin-bottom:12px;"></div>' +
      '<label style="display:block; font-size:12px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px;">Enter OTP Code</label>' +
      '<input id="teacherOtpInput" type="text" maxlength="6" inputmode="numeric" placeholder="6-digit code" ' +
        'style="width:100%; background:rgba(255,255,255,0.04); border:2px solid var(--border); border-radius:10px; padding:14px; color:var(--text-primary); font-size:28px; font-weight:900; font-family:monospace; outline:none; box-sizing:border-box; text-align:center; letter-spacing:8px; margin-bottom:12px;" ' +
        'oninput="this.value=this.value.replace(/[^0-9]/g,\'\')" ' +
        'onkeydown="if(event.key===\'Enter\') submitTeacherOtp(\'' + email + '\')" />' +
      '<button onclick="submitTeacherOtp(\'' + email + '\')" id="teacherOtpBtn" ' +
        'style="width:100%; padding:13px; background:linear-gradient(135deg,#43e97b,#38f9d7); color:#0f0f1a; border:none; border-radius:10px; font-size:15px; font-weight:700; cursor:pointer; font-family:inherit; margin-bottom:12px;">' +
        'Verify Code →' +
      '</button>' +
      '<button onclick="resendTeacherVerification(\'' + email + '\')" id="teacherResendBtn" ' +
        'style="width:100%; padding:12px; background:linear-gradient(135deg,var(--primary),var(--primary-dark)); color:white; border:none; border-radius:8px; font-size:13px; font-weight:700; cursor:pointer; font-family:inherit; margin-bottom:8px;">' +
        '📨 Resend Verification Email' +
      '</button>' +
    '</div>' +
    '<button onclick="backToTeacherLogin()" ' +
      'style="width:100%; padding:10px; background:rgba(255,255,255,0.05); border:1px solid var(--border); color:var(--text-secondary); border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit;">' +
      '← Back to Login' +
    '</button>';

  var card = document.querySelector('#accessDenied > div:last-of-type');
  if (card) {
    card.appendChild(notice);
  } else {
    document.getElementById('accessDenied').appendChild(notice);
  }
}

/* ============================================
   SUBMIT OTP
   ============================================ */
async function submitTeacherOtp(email) {
  var codeEl = document.getElementById('teacherOtpInput');
  var errEl  = document.getElementById('teacherOtpError');
  var sucEl  = document.getElementById('teacherOtpSuccess');
  var btn    = document.getElementById('teacherOtpBtn');

  if (errEl) errEl.style.display = 'none';
  if (sucEl) sucEl.style.display = 'none';

  var code = codeEl ? codeEl.value.trim() : '';

  if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
    if (errEl) { errEl.textContent = '⚠️ Please enter the 6-digit code from your email.'; errEl.style.display = 'block'; }
    if (codeEl) codeEl.focus();
    return;
  }

  if (btn) { btn.textContent = 'Verifying...'; btn.disabled = true; }

  var result = await apiRequest('/auth/verify-otp', 'POST', { email: email, otp: code });

  if (btn) { btn.textContent = 'Verify Code →'; btn.disabled = false; }

  if (result.ok) {
    if (sucEl) { sucEl.textContent = '✅ Email verified! You can now login.'; sucEl.style.display = 'block'; }
    var otpSection = document.getElementById('teacherOtpSection');
    if (otpSection) otpSection.style.display = 'none';
    setTimeout(function() {
      backToTeacherLogin();
      var emailField = document.getElementById('teacherLoginEmail');
      if (emailField) emailField.value = email;
      var loginErr = document.getElementById('teacherLoginError');
      if (loginErr) {
        loginErr.style.background  = 'rgba(67,233,123,0.1)';
        loginErr.style.borderColor = 'rgba(67,233,123,0.3)';
        loginErr.style.color       = '#43e97b';
        loginErr.textContent       = '✅ Email verified! Enter your password to login.';
        loginErr.style.display     = 'block';
      }
    }, 1500);
  } else {
    if (errEl) {
      if (result.data.tooManyAttempts) {
        errEl.innerHTML = '🔒 Too many wrong attempts. Please register again.';
      } else if (result.data.expired) {
        errEl.innerHTML = '⏰ Code expired. Please register again to get a new code.';
      } else {
        errEl.textContent = result.data.message || '❌ Incorrect code. Please try again.';
      }
      errEl.style.display = 'block';
      if (codeEl) {
        codeEl.style.borderColor = 'var(--secondary)';
        codeEl.value = '';
        setTimeout(function() { codeEl.style.borderColor = 'var(--border)'; codeEl.focus(); }, 2000);
      }
    }
  }
}

/* ============================================
   BACK TO TEACHER LOGIN
   ============================================ */
function backToTeacherLogin() {
  var notice = document.getElementById('teacherVerifyNotice');
  if (notice) notice.remove();
  var loginForm = document.getElementById('teacherLoginForm');
  if (loginForm) loginForm.style.display = 'block';
  var forgotPanel = document.getElementById('teacherForgotPanel');
  if (forgotPanel) forgotPanel.style.display = 'none';
  var btn = document.getElementById('teacherLoginBtn');
  if (btn) { btn.textContent = 'Login →'; btn.disabled = false; btn.style.background = ''; }
}

/* ============================================
   RESEND VERIFICATION
   ============================================ */
async function resendTeacherVerification(email) {
  var btn   = document.getElementById('teacherResendBtn');
  var errEl = document.getElementById('teacherOtpError');
  var sucEl = document.getElementById('teacherOtpSuccess');

  if (btn)   { btn.textContent = 'Sending...'; btn.disabled = true; }
  if (errEl)   errEl.style.display = 'none';
  if (sucEl)   sucEl.style.display = 'none';

  var result = await apiRequest('/auth/resend-verification', 'POST', { email: email });

  if (btn) { btn.textContent = '📨 Resend Verification Email'; btn.disabled = false; }

  if (result.ok) {
    if (sucEl) {
      sucEl.innerHTML = '✅ ' + result.data.message +
        (result.data.devNote ? '<div style="margin-top:6px;font-size:11px;color:#ffa500;">🛠️ Dev: Check terminal.</div>' : '');
      sucEl.style.display = 'block';
    }
  } else {
    if (errEl) { errEl.textContent = result.data.message || 'Could not resend. Try again.'; errEl.style.display = 'block'; }
  }
}

/* ============================================
   GOOGLE AUTH — TEACHER
   ============================================ */
function triggerTeacherGoogleAuth() {
  if (typeof google === 'undefined' || !google.accounts) {
    alert('Google Sign In is loading. Please try again.');
    return;
  }
  google.accounts.id.prompt(function(notification) {
    if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
      var errEl = document.getElementById('teacherLoginError');
      if (errEl) { errEl.textContent = 'Google Sign In popup was blocked. Please allow popups for this site.'; errEl.style.display = 'block'; }
    }
  });
}

async function handleTeacherGoogleResponse(response) {
  var credential = response.credential;
  var btn        = document.getElementById('teacherLoginBtn');
  var errEl      = document.getElementById('teacherLoginError');

  if (btn)   { btn.textContent = 'Signing in...'; btn.disabled = true; }
  if (errEl)   errEl.style.display = 'none';

  var result = await apiRequest('/auth/google', 'POST', { credential: credential, role: 'teacher' });

  if (btn) { btn.textContent = 'Login →'; btn.disabled = false; }

  if (result.ok) {
    var user = result.data.user;
    if (user.role !== 'teacher' && user.role !== 'admin') {
      if (errEl) { errEl.textContent = '⛔ This Google account is not registered as a teacher. Please use the main login.'; errEl.style.display = 'block'; }
      return;
    }
    saveAuthData(result.data.token, user);
    if (btn) { btn.textContent = '✅ Welcome! Loading...'; btn.style.background = 'linear-gradient(135deg,#43e97b,#38f9d7)'; }
    setTimeout(function() { window.location.reload(); }, 600);
  } else {
    if (errEl) { errEl.textContent = result.data.message || '❌ Google sign in failed.'; errEl.style.display = 'block'; }
  }
}

console.log('📚 Teacher Dashboard loaded');