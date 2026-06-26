/* ============================================
   LATLOMP INSTITUTION — SHARED API UTILITY
   Used by all institution pages.

   ✅ FOUNDATION FIX: instRequireAuth role check
      rewritten to correctly guard all role types.

   ✅ FOUNDATION FIX: instApi() now detects 403
      SUBSCRIPTION_EXPIRED responses and redirects
      to the Subscription Center page automatically.
      Every dashboard section that was silently
      stuck on "Loading..." will now redirect the
      school admin to renew their subscription.
============================================ */

var INST_TOKEN_KEY = 'latlomp_inst_token';
var INST_USER_KEY  = 'latlomp_inst_user';

/* ---- Auth helpers ---- */
function instGetToken() {
  return localStorage.getItem(INST_TOKEN_KEY) || null;
}

function instGetUser() {
  try {
    var raw = localStorage.getItem(INST_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function instSaveAuth(token, user) {
  if (token) localStorage.setItem(INST_TOKEN_KEY, token);
  if (user)  localStorage.setItem(INST_USER_KEY,  JSON.stringify(user));
}

function instLogout() {
  localStorage.removeItem(INST_TOKEN_KEY);
  localStorage.removeItem(INST_USER_KEY);
  window.location.href = '/institution/index.html';
}

/* ============================================
   ✅ FOUNDATION FIX: instRequireAuth

   Previous version had a logic error: the inner
   if-check was identical to the outer if-check,
   meaning only school_admin role was ever guarded.
   Teachers accessing admin pages would pass through.

   New version:
   - No role required → just check logged in
   - Role required AND user has that role → allow
   - Role required AND user does NOT have that role:
     - If user is school_admin trying a teacher page → allow
       (school admins can access all pages)
     - Otherwise → redirect to login
============================================ */
function instRequireAuth(requiredRole) {
  var token = instGetToken();
  var user  = instGetUser();

  if (!token || !user) {
    window.location.href = '/institution/index.html';
    return false;
  }

  if (requiredRole) {
    /* school_admin can access any page */
    if (user.role === 'school_admin') {
      return true;
    }
    /* Teacher or vice_principal can access teacher pages */
    if (requiredRole === 'teacher') {
      var teacherRoles = ['teacher', 'vice_principal', 'class_teacher',
                          'subject_teacher', 'lecturer', 'instructor',
                          'hod', 'dean'];
      if (teacherRoles.indexOf(user.role) === -1) {
        window.location.href = '/institution/index.html';
        return false;
      }
      return true;
    }
    /* Strict role match for everything else */
    if (user.role !== requiredRole) {
      window.location.href = '/institution/index.html';
      return false;
    }
  }

  return true;
}

/* ============================================
   ✅ FOUNDATION FIX: instApi

   Added automatic subscription expiry detection.
   When any API call returns:
     HTTP 403 + { code: 'SUBSCRIPTION_EXPIRED' }
   the user is redirected to the Subscription
   Center page instead of silently failing.

   This is why dashboard sections were stuck on
   "Loading..." — every protected endpoint was
   returning 403 but the frontend was not handling
   it, just leaving spinners forever.

   Exception: if the user is already on the
   Subscription Center page, no redirect loop.
============================================ */
async function instApi(endpoint, method, body) {
  method = method || 'GET';

  var headers = { 'Content-Type': 'application/json' };
  var token   = instGetToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  var options = { method: method.toUpperCase(), headers: headers };
  if (body && method.toUpperCase() !== 'GET') {
    options.body = JSON.stringify(body);
  }

  try {
    var res  = await fetch('/api/institution' + endpoint, options);
    var data = await res.json();

    /* ✅ Subscription expiry detection */
    if (res.status === 403 && data && data.code === 'SUBSCRIPTION_EXPIRED') {
      var currentPath = window.location.pathname;
      var isOnSubCenter = currentPath.indexOf('subscription-center') !== -1;
      if (!isOnSubCenter) {
        window.location.href = '/institution/school/subscription-center.html';
        return { ok: false, status: 403, data: data };
      }
    }

    /* ✅ Token expired or invalid — redirect to login */
    if (res.status === 401) {
      var currentPath2 = window.location.pathname;
      var isOnLogin = currentPath2.indexOf('index.html') !== -1 ||
                      currentPath2 === '/institution/' ||
                      currentPath2 === '/institution';
      if (!isOnLogin) {
        localStorage.removeItem(INST_TOKEN_KEY);
        localStorage.removeItem(INST_USER_KEY);
        window.location.href = '/institution/index.html';
        return { ok: false, status: 401, data: data };
      }
    }

    return { ok: res.ok, status: res.status, data: data };
  } catch (err) {
    console.error('instApi error:', err.message);
    return { ok: false, status: 0, data: { message: 'Network error. Check your connection.' } };
  }
}

/* ---- Toast notification ---- */
function instToast(msg, type) {
  type = type || 'info';
  var existing = document.getElementById('instToast');
  if (existing) existing.remove();

  var el = document.createElement('div');
  el.id  = 'instToast';
  el.style.cssText =
    'position:fixed; bottom:24px; right:24px; z-index:9999;' +
    'background:#1a1a2e; border-radius:12px; padding:14px 20px;' +
    'font-size:14px; font-weight:600; font-family:Inter,sans-serif;' +
    'box-shadow:0 8px 32px rgba(0,0,0,0.5); max-width:340px;' +
    'display:flex; align-items:center; gap:10px;' +
    'animation:slideUp 0.3s ease; border:1px solid ' +
    (type === 'success' ? 'rgba(67,233,123,0.4)' :
     type === 'error'   ? 'rgba(255,101,132,0.4)' :
     type === 'warning' ? 'rgba(255,165,0,0.4)'   : 'rgba(108,99,255,0.4)');

  var icon  = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
  var color = type === 'success' ? '#43e97b' : type === 'error' ? '#ff6584' : type === 'warning' ? '#ffa500' : '#a78bfa';

  el.innerHTML =
    '<span style="font-size:18px;">' + icon + '</span>' +
    '<span style="color:' + color + ';">' + msg + '</span>';

  document.body.appendChild(el);
  setTimeout(function() { if (el.parentNode) el.remove(); }, 4000);
}

/* ---- Format date ---- */
function instFmtDate(dateStr, opts) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-NG',
    opts || { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ---- Days remaining ---- */
function instDaysLeft(expiryDate) {
  if (!expiryDate) return 0;
  return Math.max(0, Math.ceil((new Date(expiryDate) - new Date()) / 86400000));
}

console.log('⚡ Institution API utility loaded');