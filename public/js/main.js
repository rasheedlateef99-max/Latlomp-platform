/* ============================================
   LATLOMP PLATFORM — MAIN.JS
   
   RESTORED: Uses google.accounts.id.prompt()
   NOT renderButton — prompt() shows account
   chooser as overlay on same page (old behavior)
============================================ */

document.addEventListener('DOMContentLoaded', function () {

  var loader = document.getElementById('pageLoader');
  if (loader) {
    setTimeout(function () {
      loader.style.transition = 'opacity 0.4s ease';
      loader.style.opacity    = '0';
      setTimeout(function () { loader.style.display = 'none'; }, 400);
    }, 400);
  }

  updateNavForAuthState();

  var hamburger = document.getElementById('hamburger');
  var navLinks  = document.getElementById('navLinks');

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', function (e) {
      e.stopPropagation();
      navLinks.classList.toggle('open');
      hamburger.classList.toggle('open');
    });
    navLinks.querySelectorAll('a, button').forEach(function (link) {
      link.addEventListener('click', function () {
        navLinks.classList.remove('open');
        hamburger.classList.remove('open');
      });
    });
    document.addEventListener('click', function (e) {
      if (!hamburger.contains(e.target) && !navLinks.contains(e.target)) {
        navLinks.classList.remove('open');
        hamburger.classList.remove('open');
      }
    });
  }
});

/* ============================================
   GOOGLE SIGN IN — PROMPT APPROACH
   
   This initializes Google and stores the callback.
   The actual trigger is google.accounts.id.prompt()
   called when the user clicks the button.
   prompt() shows account chooser as an OVERLAY
   on the same page — no popup, no redirect.
============================================ */
function initGoogleSignIn(callbackFn) {
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) {
    setTimeout(function () { initGoogleSignIn(callbackFn); }, 500);
    return;
  }
  google.accounts.id.initialize({
    client_id:             '804260807914-tl2i27hblh8f3s1g4a5ip12hejosk0ab.apps.googleusercontent.com',
    callback:              callbackFn,
    auto_select:           false,
    cancel_on_tap_outside: true
  });
  /* disableAutoSelect so the stored account is not auto-selected */
  google.accounts.id.disableAutoSelect();
}
window.initGoogleSignIn = initGoogleSignIn;

/* Called by Google button click */
function triggerGooglePrompt() {
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) {
    alert('Google Sign In is still loading. Please wait a moment and try again.');
    return;
  }
  google.accounts.id.disableAutoSelect();
  google.accounts.id.prompt(function (notification) {
    if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
      /* Fallback: Google One Tap was suppressed — this can happen when
         cookies are blocked. Log it silently; the user can try again. */
      console.warn('Google prompt not displayed:', notification.getNotDisplayedReason() || notification.getSkippedReason());
    }
  });
}
window.triggerGooglePrompt = triggerGooglePrompt;

/* ============================================
   MODAL
============================================ */
function showLoginModal() {
  var modal = document.getElementById('authModal');
  if (modal) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  } else {
    window.location.href = 'signin.html';
  }
}
window.showLoginModal = showLoginModal;

function closeModal() {
  var modal = document.getElementById('authModal');
  if (modal) {
    modal.style.display    = 'none';
    document.body.style.overflow = '';
  }
}
window.closeModal = closeModal;

/* ============================================
   SESSION
============================================ */
function clearSession() {
  localStorage.removeItem('latlomp_token');
  localStorage.removeItem('latlomp_user');
  localStorage.removeItem('latlomp_cart');
  localStorage.removeItem('latlomp_inst_token');
  localStorage.removeItem('latlomp_inst_user');
  try { sessionStorage.removeItem('cbtSession');  } catch (e) {}
  try { sessionStorage.removeItem('cbtAnswers');  } catch (e) {}
  try { sessionStorage.removeItem('cbtResult');   } catch (e) {}
}
window.clearSession = clearSession;

/* ============================================
   LOGOUT
============================================ */
function logout(redirectUrl) {
  try {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
      google.accounts.id.disableAutoSelect();
    }
  } catch (e) {}
  clearSession();
  window.location.replace(redirectUrl || 'index.html');
}
window.logout = logout;

function instLogout() {
  try {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
      google.accounts.id.disableAutoSelect();
    }
  } catch (e) {}
  localStorage.removeItem('latlomp_inst_token');
  localStorage.removeItem('latlomp_inst_user');
  window.location.replace('/institution/index.html');
}
window.instLogout = instLogout;

/* ============================================
   AUTH GUARD
============================================ */
function requireLogin(redirectAfter) {
  var user = getCurrentUser();
  if (!user) {
    var dest = 'signin.html';
    if (redirectAfter) dest += '?redirect=' + encodeURIComponent(redirectAfter);
    window.location.href = dest;
    return false;
  }
  return true;
}
window.requireLogin = requireLogin;

/* ============================================
   NAV
============================================ */
function updateNavForAuthState() {
  var user        = getCurrentUser();
  var authNavItem = document.getElementById('authNavItem');
  if (!authNavItem) return;

  if (user && user.name) {
    authNavItem.innerHTML =
      '<span style="display:flex;align-items:center;gap:10px;">' +
        '<span style="font-size:14px;font-weight:600;color:var(--text-primary,#fff);">👤 ' + user.name.split(' ')[0] + '</span>' +
        '<a href="#" onclick="event.preventDefault();logout();" ' +
          'style="background:rgba(255,101,132,0.1);border:1px solid rgba(255,101,132,0.25);' +
          'color:var(--secondary,#ff6584);font-weight:700;padding:8px 14px;border-radius:8px;' +
          'font-size:13px;white-space:nowrap;display:inline-block;text-decoration:none;">Logout</a>' +
      '</span>';
  } else {
    authNavItem.innerHTML =
      '<a href="#" onclick="event.preventDefault();showLoginModal();" ' +
        'style="background:rgba(108,99,255,0.1);border:1px solid rgba(108,99,255,0.2);' +
        'color:var(--primary-light,#a78bfa);font-weight:700;padding:8px 16px;' +
        'border-radius:8px;font-size:14px;white-space:nowrap;display:inline-block;' +
        'text-decoration:none;">Login / Register</a>';
  }
}
window.updateNavForAuthState = updateNavForAuthState;

/* ============================================
   API REQUEST
============================================ */
async function apiRequest(endpoint, method, body) {
  method = method || 'GET';
  var url     = '/api' + endpoint;
  var headers = { 'Content-Type': 'application/json' };
  var token   = localStorage.getItem('latlomp_token');
  if (token) headers['Authorization'] = 'Bearer ' + token;
  var options = { method: method.toUpperCase(), headers: headers };
  if (body && method.toUpperCase() !== 'GET') options.body = JSON.stringify(body);
  try {
    var response = await fetch(url, options);
    var data;
    try { data = await response.json(); } catch (e) { data = { message: 'Unexpected server response.' }; }
    return { ok: response.ok, status: response.status, data: data };
  } catch (networkErr) {
    return { ok: false, status: 0, data: { message: 'Network error. Check your connection.' } };
  }
}
window.apiRequest = apiRequest;

/* ============================================
   AUTH HELPERS
============================================ */
function getCurrentUser() {
  try {
    var raw  = localStorage.getItem('latlomp_user');
    if (!raw) return null;
    var user = JSON.parse(raw);
    return user && user._id ? user : null;
  } catch (e) { return null; }
}
window.getCurrentUser = getCurrentUser;

function getCurrentToken() { return localStorage.getItem('latlomp_token') || null; }
window.getCurrentToken = getCurrentToken;

function saveAuthData(token, user) {
  if (token) localStorage.setItem('latlomp_token', token);
  if (user)  localStorage.setItem('latlomp_user',  JSON.stringify(user));
}
window.saveAuthData = saveAuthData;

function getAuthHeaders() {
  var token   = localStorage.getItem('latlomp_token');
  var headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return headers;
}
window.getAuthHeaders = getAuthHeaders;

function isLoggedIn() { return !!(localStorage.getItem('latlomp_token') && getCurrentUser()); }
function isAdmin()    { var u = getCurrentUser(); return !!(u && u.role === 'admin'); }
window.isLoggedIn = isLoggedIn;
window.isAdmin    = isAdmin;

/* ============================================
   REDIRECT AFTER LOGIN
============================================ */
function getRedirectTarget() {
  try {
    var params   = new URLSearchParams(window.location.search);
    var redirect = params.get('redirect');
    if (redirect) {
      redirect = redirect.replace(/^https?:\/\/[^/]+/, '');
      if (redirect && redirect.charAt(0) !== '/' && !redirect.includes('://')) return redirect;
    }
  } catch (e) {}
  return 'index.html';
}
window.getRedirectTarget = getRedirectTarget;

function redirectAfterLogin() { window.location.replace(getRedirectTarget()); }
window.redirectAfterLogin = redirectAfterLogin;

/* ============================================
   PASSWORD TOGGLE
============================================ */
function togglePw(inputId, btn) {
  var input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') { input.type = 'text';     if (btn) btn.textContent = '🙈'; }
  else                           { input.type = 'password'; if (btn) btn.textContent = '👁';  }
}
window.togglePw = togglePw;

window.addEventListener('unhandledrejection', function (e) {
  console.error('Unhandled promise rejection:', e.reason);
});

console.log('⚡ LatLomp main.js loaded');