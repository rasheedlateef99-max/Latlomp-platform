/* ============================================
   LATLOMP INSTITUTION — SHARED API UTILITY
   Used by all institution pages.
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

/* ---- Guard: redirect if not logged in ---- */
function instRequireAuth(requiredRole) {
  var token = instGetToken();
  var user  = instGetUser();

  if (!token || !user) {
    window.location.href = '/institution/index.html';
    return false;
  }

  if (requiredRole && user.role !== requiredRole) {
    /* Allow school_admin to access admin pages */
    if (requiredRole === 'school_admin' && user.role !== 'school_admin') {
      window.location.href = '/institution/index.html';
      return false;
    }
  }

  return true;
}

/* ---- Core fetch wrapper ---- */
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