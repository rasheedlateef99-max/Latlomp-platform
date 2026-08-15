/* ============================================
   LATLOMP PLATFORM — ADMIN DASHBOARD JS
============================================ */

/* ============================================
   ✅ ARCHITECTURE MIGRATION:
   Platform Staff as Delegated Root Admins.
   These vars are set during DOMContentLoaded
   when a valid platform staff token is found.
   All inline script functions check these before
   deciding how to make API calls.
============================================ */
var _isPlatformStaff    = false;
var _platformStaffPerms = [];
var _platformStaffUser  = null;

/* Which permissions are required to see each admin section.
   Empty array = always visible (no restriction).
   Any single match grants access. */
/* ============================================
   SECTION PERMISSION MAP
   Controls which admin sections are visible to
   platform staff based on their DB permissions.

   HOW TO ADD A NEW MODULE (3 steps):
     1. Add to server/platform/config/permissions.registry.js
     2. Add HTML: <section class="admin-section" id="as-your-key">
        and nav: <button class="sb-link admin-nav-link" data-section="your-key">
     3. Add entry here: 'your-key': ['your_permission_key']

   Empty array = always visible to all staff.
   Any single match from the array grants access.
============================================ */
var SECTION_PERM_MAP = {
  'overview':       [],
  'products':       ['store'],
  'cbt-management': ['cbt', 'practice'],
  'institutions':   ['institutions', 'subscriptions', 'announcements', 'audit_logs'],
  'platform-staff': ['staff'],
  'qms-import':     ['question_import', 'question_bank', 'question_engine', 'question_stats'],
  'ece':            ['ece_admin', 'ece_read']
  /* Future modules — add here when built:
  ,'payment-gateway':  ['payment_gateway']
  ,'school-payments':  ['school_payments']
  */
};

var PS_ROLE_LABELS_ADMIN = {
  platform_admin: 'Platform Administrator',
  support_admin:  'Support Administrator',
  finance_admin:  'Finance Administrator',
  content_admin:  'Content Administrator',
  developer:      'Developer'
};

/* ============================================
   UTILITY — HTML ENTITY ESCAPER
   Prevents XSS when inserting dynamic content
   into innerHTML. Called as esc(str) throughout
   the admin dashboard.
   Defined here so it is available globally to all
   admin.js functions regardless of call order.
============================================ */
function esc(str) {
  if (str === null || str === undefined) { return ''; }
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

/* ============================================
   ADMIN LOGIN
============================================ */
async function submitAdminLogin() {
  var emailEl = document.getElementById('adminLoginEmail');
  var passEl  = document.getElementById('adminLoginPassword');
  var errEl   = document.getElementById('adminLoginErr');
  var btn     = document.getElementById('adminLoginBtn');

  if (errEl) errEl.style.display = 'none';

  var email    = emailEl ? emailEl.value.trim()  : '';
  var password = passEl  ? passEl.value.trim()   : '';

  if (!email)    { if (errEl) { errEl.textContent = '⚠️ Please enter your admin email.';    errEl.style.display = 'block'; } if (emailEl) emailEl.focus(); return; }
  if (!password) { if (errEl) { errEl.textContent = '⚠️ Please enter your admin password.'; errEl.style.display = 'block'; } if (passEl)  passEl.focus();  return; }

  if (btn) { btn.textContent = 'Verifying...'; btn.disabled = true; }

  var result = await apiRequest('/auth/admin-login', 'POST', { email: email, password: password });

  if (btn) { btn.textContent = 'Access Admin Dashboard →'; btn.disabled = false; }

  if (result.ok) {
    saveAuthData(result.data.token, result.data.user);
    if (btn) { btn.textContent = '✅ Loading...'; btn.style.background = 'linear-gradient(135deg,#43e97b,#38f9d7)'; btn.style.color = '#0f0f1a'; }
    setTimeout(function() { window.location.reload(); }, 600);
  } else {
    if (errEl) { errEl.textContent = result.data.message || '❌ Login failed.'; errEl.style.display = 'block'; }
    if (passEl) { passEl.value = ''; passEl.focus(); }
  }
}

/* ============================================
   PAGE INIT
============================================ */
document.addEventListener('DOMContentLoaded', async function() {
  var loaderEl = document.getElementById('adminLoader');
  var appEl    = document.getElementById('adminApp');
  var deniedEl = document.getElementById('adminDenied');

  var passEl = document.getElementById('adminLoginPassword');
  if (passEl) passEl.addEventListener('keydown', function(e) { if (e.key === 'Enter') submitAdminLogin(); });

  function showScreen(which) {
    if (loaderEl) loaderEl.style.display = 'none';
    if (which === 'app') {
      if (appEl)    appEl.style.display    = 'block';
      if (deniedEl) deniedEl.style.display = 'none';
    } else {
      if (deniedEl) deniedEl.style.display = 'flex';
      if (appEl)    appEl.style.display    = 'none';
    }
  }

  var safetyTimer = setTimeout(function() { showScreen('denied'); }, 8000);

  try {
    var user = getCurrentUser();
    if (!user) {
      if (await tryPlatformStaffLogin(safetyTimer, showScreen)) { return; }
      clearTimeout(safetyTimer);
      showScreen('denied');
      return;
    }

    var meRes = await apiRequest('/auth/me');
    if (!meRes.ok) {
      localStorage.removeItem('latlomp_token');
      localStorage.removeItem('latlomp_user');
      clearTimeout(safetyTimer);
      showScreen('denied');
      return;
    }

    var serverUser = meRes.data.user;
   if (!serverUser || serverUser.role !== 'admin') {
      localStorage.removeItem('latlomp_token');
      localStorage.removeItem('latlomp_user');
      /* ✅ Try platform staff before showing denied */
      if (await tryPlatformStaffLogin(safetyTimer, showScreen)) { return; }
      clearTimeout(safetyTimer);
      showScreen('denied');
      return;
    }

    saveAuthData(null, serverUser);
    clearTimeout(safetyTimer);
    showScreen('app');

    var nameEl = document.getElementById('adminName');
    if (nameEl) nameEl.textContent = serverUser.name || 'Admin';
    var avatarEl = document.getElementById('adminAvatar');
    if (avatarEl) avatarEl.textContent = (serverUser.name || 'A').charAt(0).toUpperCase();

    await loadAdminProducts();
    await loadAdminStats();

  } catch (err) {
    console.error('Admin init error:', err);
    try {
      if (await tryPlatformStaffLogin(safetyTimer, showScreen)) { return; }
    } catch (e2) { /* silent */ }
    clearTimeout(safetyTimer);
    showScreen('denied');
  }
});

/* ============================================
   SECTION NAVIGATION
============================================ */
function showAdminSection(name) {
  /* ✅ Permission guard for platform staff */
  if (_isPlatformStaff) {
    var permsNeeded = SECTION_PERM_MAP[name];
    if (permsNeeded && permsNeeded.length > 0) {
      var allowed = permsNeeded.some(function (p) {
        return _platformStaffPerms.indexOf(p) !== -1;
      });
      if (!allowed) {
        adminToast('You do not have permission to access this section.', 'error');
        return;
      }
    }
  }
  document.querySelectorAll('.admin-section').forEach(function(s) { s.classList.remove('active'); });

  var section = document.getElementById('as-' + name);
  if (section) section.classList.add('active');

  document.querySelectorAll('.admin-nav-link').forEach(function(l) { l.classList.remove('active'); });
  var link = document.querySelector('.admin-nav-link[data-section="' + name + '"]');
  if (link) link.classList.add('active');

  var mobileSection = document.getElementById('adminMobileSection');
  if (mobileSection) {
    var labels = { 'overview': 'Overview', 'products': 'Products', 'cbt-management': 'CBT Management' };
    mobileSection.textContent = labels[name] || name;
  }

  if (window.innerWidth <= 960) closeAdminSidebar();

  if (name === 'products')       loadAdminProducts();
  if (name === 'overview')       loadAdminStats();
  if (name === 'cbt-management') loadCbtManagement();
}

/* ============================================
   SIDEBAR
============================================ */
var _adminSidebarOpen = false;

function openAdminSidebar() {
  if (_adminSidebarOpen) return;
  _adminSidebarOpen = true;
  var sb = document.getElementById('adminSidebar');
  var ov = document.getElementById('adminOverlay');
  if (sb) sb.classList.add('open');
  if (ov) ov.classList.add('visible');
  document.body.style.overflow = 'hidden';
  if (window.history && window.history.pushState) window.history.pushState({ adminSidebarOpen: true }, '');
}

function closeAdminSidebar() {
  if (!_adminSidebarOpen) return;
  _adminSidebarOpen = false;
  var sb = document.getElementById('adminSidebar');
  var ov = document.getElementById('adminOverlay');
  if (sb) sb.classList.remove('open');
  if (ov) ov.classList.remove('visible');
  document.body.style.overflow = '';
}

function toggleAdminSidebar() { if (_adminSidebarOpen) closeAdminSidebar(); else openAdminSidebar(); }

window.addEventListener('popstate',  function() { if (_adminSidebarOpen) closeAdminSidebar(); });
window.addEventListener('resize',    function() { if (window.innerWidth > 960 && _adminSidebarOpen) { _adminSidebarOpen = false; var sb = document.getElementById('adminSidebar'); var ov = document.getElementById('adminOverlay'); if (sb) sb.classList.remove('open'); if (ov) ov.classList.remove('visible'); document.body.style.overflow = ''; } });

document.addEventListener('DOMContentLoaded', function() {
  var ov = document.getElementById('adminOverlay');
  if (ov) ov.addEventListener('click', closeAdminSidebar);
});

/* ============================================
   TOAST + MODAL HELPERS
============================================ */
function adminToast(msg, type) {
  type = type || 'info';
  var el = document.getElementById('adminToast');
  if (!el) return;
  el.textContent       = msg;
  el.style.display     = 'block';
  el.style.color       = type === 'success' ? '#43e97b' : type === 'error' ? '#ff6584' : '#a78bfa';
  el.style.borderColor = type === 'success' ? 'rgba(67,233,123,0.4)' : type === 'error' ? 'rgba(255,101,132,0.4)' : 'rgba(108,99,255,0.4)';
  clearTimeout(el._t);
  el._t = setTimeout(function() { el.style.display = 'none'; }, 3500);
}

function closeAdminModal(id) {
  var el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

document.addEventListener('click', function(e) {
  if (e.target.classList.contains('t-modal-overlay')) e.target.style.display = 'none';
});

function adminLogout() {
  if (!confirm('Log out of Admin Dashboard?')) { return; }
  if (_isPlatformStaff) {
    localStorage.removeItem('latlomp_platform_token');
    localStorage.removeItem('latlomp_platform_staff');
    _isPlatformStaff    = false;
    _platformStaffPerms = [];
    _platformStaffUser  = null;
    window.location.replace('/admin.html');
  } else {
    logout();
  }
}

/* ============================================
   OVERVIEW STATS
============================================ */
async function loadAdminStats() {
  var res = await apiRequest('/store/admin/products');
  if (!res.ok) return;
  var products = res.data.products || [];
  function setEl(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }
  setEl('statTotalProducts',  products.length);
  setEl('statActiveProducts', products.filter(function(p) { return p.isActive; }).length);
  setEl('statFeatured',       products.filter(function(p) { return p.isFeatured; }).length);
  setEl('statOutOfStock',     products.filter(function(p) { return (p.stock || 0) === 0; }).length);
}

/* ============================================
   PRODUCTS
============================================ */
var _adminProducts = [];

async function loadAdminProducts() {
  var tbody = document.getElementById('productsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:24px; color:var(--text-muted);">Loading...</td></tr>';

  var res = await apiRequest('/store/admin/products');
  if (!res.ok) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:24px; color:#ff6584;">Failed to load: ' + (res.data.message || 'Error') + '</td></tr>';
    adminToast('Failed to load products', 'error');
    return;
  }

  _adminProducts = res.data.products || [];
  var countEl = document.getElementById('productsCount');
  if (countEl) countEl.textContent = _adminProducts.length + ' products';

  if (_adminProducts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:32px; color:var(--text-muted);">No products yet. Click "+ Add Product".</td></tr>';
    return;
  }

  tbody.innerHTML = _adminProducts.map(function(p) {
    var imgHtml = p.image
      ? '<img src="' + p.image + '" alt="" style="width:44px; height:44px; border-radius:8px; object-fit:cover;" onerror="this.style.display=\'none\'" />'
      : '<div style="width:44px; height:44px; border-radius:8px; background:rgba(108,99,255,0.12); display:flex; align-items:center; justify-content:center; font-size:18px;">🛍️</div>';
    return '<tr>' +
      '<td>' + imgHtml + '</td>' +
      '<td style="font-weight:700; color:#fff;">' + (p.name || '—') + '</td>' +
      '<td><span style="background:rgba(108,99,255,0.1); color:#a78bfa; padding:2px 8px; border-radius:12px; font-weight:700; font-size:12px;">' + (p.category || '—') + '</span></td>' +
      '<td style="color:#43e97b; font-weight:800;">₦' + (p.price || 0).toLocaleString() + '</td>' +
      '<td><span style="font-size:11px; font-weight:700; padding:2px 8px; border-radius:12px; background:' + ((p.stock||0)>0?'rgba(67,233,123,0.12)':'rgba(255,101,132,0.12)') + '; color:' + ((p.stock||0)>0?'#43e97b':'#ff6584') + ';">' + (p.stock||0) + ' in stock</span></td>' +
      '<td><span style="font-size:11px; font-weight:700; padding:2px 8px; border-radius:12px; background:' + (p.isActive?'rgba(67,233,123,0.12)':'rgba(255,255,255,0.06)') + '; color:' + (p.isActive?'#43e97b':'var(--text-muted)') + ';">' + (p.isActive?'Active':'Hidden') + '</span></td>' +
      '<td><div style="display:flex; gap:6px;">' +
        '<button onclick="openEditProduct(\'' + p._id + '\')" style="padding:5px 10px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; font-family:inherit; background:rgba(108,99,255,0.1); border:1px solid rgba(108,99,255,0.25); color:#a78bfa;">Edit</button>' +
        '<button onclick="deleteProduct(\'' + p._id + '\',\'' + (p.name||'').replace(/'/g,'') + '\')" style="padding:5px 10px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; font-family:inherit; background:rgba(255,101,132,0.08); border:1px solid rgba(255,101,132,0.25); color:#ff6584;">Delete</button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}

/* Product modals */
var _editingProductId = null;
var _uploadedImageUrl = '';
var _uploadedPublicId = '';

function openCreateProduct() {
  _editingProductId = null; _uploadedImageUrl = ''; _uploadedPublicId = '';
  var form = document.getElementById('productForm'); if (form) form.reset();
  var h = document.getElementById('productModalHeading'); if (h) h.textContent = 'Add New Product';
  var b = document.getElementById('saveProductBtn');      if (b) b.textContent = 'Create Product';
  var i = document.getElementById('editProductId');       if (i) i.value = '';
  var prev = document.getElementById('imagePreview');     if (prev) prev.style.display = 'none';
  var img  = document.getElementById('imagePreviewImg');  if (img)  img.src = '';
  var url  = document.getElementById('productImageUrl');  if (url)  url.value = '';
  var modal = document.getElementById('productModal');    if (modal) modal.style.display = 'flex';
}

function openEditProduct(productId) {
  var product = _adminProducts.find(function(p) { return p._id === productId; });
  if (!product) { adminToast('Product not found', 'error'); return; }
  _editingProductId = productId;
  _uploadedImageUrl = product.image || '';
  _uploadedPublicId = product.imagePublicId || '';
  var h = document.getElementById('productModalHeading'); if (h) h.textContent = 'Edit Product';
  var b = document.getElementById('saveProductBtn');      if (b) b.textContent = 'Save Changes';
  var i = document.getElementById('editProductId');       if (i) i.value = productId;
  var fields = { 'productName': product.name||'', 'productDescription': product.description||'', 'productCategory': product.category||'', 'productPrice': product.price||'', 'productStock': product.stock!==undefined?product.stock:'', 'productTags': (product.tags||[]).join(', '), 'productImageUrl': product.image||'', 'productActive': String(product.isActive!==false), 'productFeatured': String(product.isFeatured===true) };
  Object.keys(fields).forEach(function(id) { var el = document.getElementById(id); if (el) el.value = fields[id]; });
  if (product.image) { var prev = document.getElementById('imagePreview'); if (prev) prev.style.display='block'; var img = document.getElementById('imagePreviewImg'); if (img) img.src = product.image; }
  var modal = document.getElementById('productModal'); if (modal) modal.style.display = 'flex';
}

function onImageUrlInput() {
  var urlEl = document.getElementById('productImageUrl');
  var prev  = document.getElementById('imagePreview');
  var img   = document.getElementById('imagePreviewImg');
  if (!urlEl) return;
  var url = urlEl.value.trim();
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    _uploadedImageUrl = url;
    if (prev) prev.style.display = 'block';
    if (img)  img.src = url;
  } else {
    _uploadedImageUrl = '';
    if (prev) prev.style.display = 'none';
    if (img)  img.src = '';
  }
}

async function onImageFileChange(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  if (!['image/jpeg','image/jpg','image/png','image/webp'].includes(file.type)) { adminToast('Only JPEG, PNG, or WebP.', 'error'); input.value = ''; return; }
  if (file.size > 5*1024*1024) { adminToast('Image must be under 5MB.', 'error'); input.value = ''; return; }
  var uploadBtn = document.getElementById('uploadImageBtn');
  if (uploadBtn) { uploadBtn.textContent = '⏳ Uploading...'; uploadBtn.disabled = true; }
  try {
    var formData = new FormData();
    formData.append('image', file);
    var token = localStorage.getItem('latlomp_token');
    var response = await fetch('/api/store/upload-image', { method:'POST', headers: token?{'Authorization':'Bearer '+token}:{}, body: formData });
    var data = await response.json();
    if (response.ok && data.imageUrl) {
      _uploadedImageUrl = data.imageUrl; _uploadedPublicId = data.publicId||'';
      var prev = document.getElementById('imagePreview'); if (prev) prev.style.display = 'block';
      var img  = document.getElementById('imagePreviewImg'); if (img)  img.src = data.imageUrl;
      var urlEl = document.getElementById('productImageUrl'); if (urlEl) urlEl.value = data.imageUrl;
      adminToast('✅ Image uploaded!', 'success');
    } else { adminToast(data.message||'Upload failed', 'error'); }
  } catch (err) { adminToast('Upload failed. Paste an image URL instead.', 'error'); }
  finally { if (uploadBtn) { uploadBtn.textContent = '📁 Upload Image'; uploadBtn.disabled = false; } input.value = ''; }
}

async function saveProduct(e) {
  e.preventDefault();
  var btn = document.getElementById('saveProductBtn');
  if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; }
  var imageUrlEl = document.getElementById('productImageUrl');
  var finalImage = (imageUrlEl ? imageUrlEl.value.trim() : '') || _uploadedImageUrl;
  var payload = {
    name:        (document.getElementById('productName')||{}).value||'',
    description: (document.getElementById('productDescription')||{}).value||'',
    category:    (document.getElementById('productCategory')||{}).value||'General',
    price:       parseFloat((document.getElementById('productPrice')||{}).value)||0,
    stock:       parseInt((document.getElementById('productStock')||{}).value)||0,
    tags:        (document.getElementById('productTags')||{}).value||'',
    image:       finalImage, imagePublicId: _uploadedPublicId,
    isActive:    ((document.getElementById('productActive')||{}).value)!=='false',
    isFeatured:  ((document.getElementById('productFeatured')||{}).value)==='true'
  };
  if (!payload.name)  { adminToast('Product name is required.','error'); if(btn){btn.textContent=_editingProductId?'Save Changes':'Create Product';btn.disabled=false;} return; }
  if (!payload.price) { adminToast('A valid price is required.','error'); if(btn){btn.textContent=_editingProductId?'Save Changes':'Create Product';btn.disabled=false;} return; }
  var endpoint = _editingProductId ? '/store/products/'+_editingProductId : '/store/products';
  var method   = _editingProductId ? 'PUT' : 'POST';
  var res = await apiRequest(endpoint, method, payload);
  if (btn) { btn.textContent = _editingProductId?'Save Changes':'Create Product'; btn.disabled = false; }
  if (res.ok) { adminToast(res.data.message||'Product saved!','success'); closeAdminModal('productModal'); await loadAdminProducts(); await loadAdminStats(); }
  else { adminToast(res.data.message||'Failed.','error'); }
}

async function deleteProduct(id, name) {
  if (!confirm('Delete "'+name+'"?\n\nThis cannot be undone.')) return;
  var res = await apiRequest('/store/products/'+id, 'DELETE');
  if (res.ok) { adminToast('Product deleted.','success'); await loadAdminProducts(); await loadAdminStats(); }
  else { adminToast(res.data.message||'Delete failed.','error'); }
}

/* ============================================================
   CBT MANAGEMENT — Unified hierarchical system
   
   Category isolation: departments, subjects and questions are
   filtered by the selected exam category (JAMB/WAEC/etc.)
============================================================ */
var _cbtCat        = 'jamb';
var _cbtDepts      = [];
var _cbtSelDept    = null;
var _cbtSubjects   = [];
var _cbtSelSubj    = null;
var _cbtQuestions  = [];
var _cbtEditDeptId = null;
var _cbtEditSubjId = null;

/* ---- Shared exam types cache (loaded once, reused everywhere) ---- */
var _examTypesCache = null;

async function getExamTypes() {
  if (_examTypesCache) { return _examTypesCache; }
  try {
    var res = await apiRequest('/exams/types');
    if (res.ok && res.data.examTypes) {
      /* Filter out 'all' for most dropdowns — it is a QMS concept,
         not a student-facing exam type */
      _examTypesCache = res.data.examTypes;
      return _examTypesCache;
    }
  } catch (e) {
    console.warn('[ExamType] Failed to load exam types:', e.message);
  }
  /* Fallback: built-in types so UI never breaks */
  return [
    { key:'jamb',     label:'JAMB',      icon:'🎓' },
    { key:'waec',     label:'WAEC',      icon:'📚' },
    { key:'neco',     label:'NECO',      icon:'🏫' },
    { key:'post-utme',label:'POST-UTME', icon:'🏛️' },
    { key:'practice', label:'Practice',  icon:'⚡' }
  ];
}

/* Populate any <select> with exam type options.
   opts.includeAll: include the 'all' type (QMS/admin only)
   opts.placeholder: first option text (e.g. "All Exam Types")
   opts.selectedKey: pre-select this key */
async function populateExamTypeSelect(selectId, opts) {
  var sel = document.getElementById(selectId);
  if (!sel) { return; }
  opts = opts || {};

  var types = await getExamTypes();
  var visible = opts.includeAll ? types : types.filter(function (t) { return t.key !== 'all'; });

  var html = '';
  if (opts.placeholder) {
    html += '<option value="">' + esc(opts.placeholder) + '</option>';
  }
  html += visible.filter(function (t) { return t.isActive !== false; }).map(function (t) {
    var selected = (opts.selectedKey && opts.selectedKey === t.key) ? ' selected' : '';
    return '<option value="' + esc(t.key) + '"' + selected + '>' +
      esc(t.icon || '📝') + ' ' + esc(t.label) +
    '</option>';
  }).join('');

  sel.innerHTML = html;
}

/* Entry point */
async function loadCbtManagement() {
  _cbtSelDept = null;
  _cbtSelSubj = null;

  var subjCard = document.getElementById('cbtSubjCard');
  var qCard    = document.getElementById('cbtQCard');
  if (subjCard) subjCard.style.display = 'none';
  if (qCard)    qCard.style.display    = 'none';

  /* ✅ STAGE 6: Build dynamic exam type pills */
  await loadCbtExamTypePills();

  await loadCbtDepts();
}

async function loadCbtExamTypePills() {
  var container = document.getElementById('cbtCatPillsContainer');
  if (!container) { return; }

  var types = await getExamTypes();
  var visible = types.filter(function (t) { return t.key !== 'all' && t.isActive !== false; });

  if (!visible.length) {
    container.innerHTML = '<div style="color:var(--text-muted); font-size:13px;">No exam types configured.</div>';
    return;
  }

  /* Set _cbtCat to first type if not already set or if current no longer exists */
  var keys = visible.map(function (t) { return t.key; });
  if (!keys.includes(_cbtCat)) { _cbtCat = visible[0].key; }

  container.innerHTML = visible.map(function (t) {
    var isActive = t.key === _cbtCat;
    return '<button class="cbt-cat-pill' + (isActive ? ' active' : '') + '" ' +
      'data-cat="' + esc(t.key) + '" ' +
      'onclick="selectCbtCategory(\'' + esc(t.key) + '\',this)">' +
      esc(t.icon || '📝') + ' ' + esc(t.label) +
    '</button>';
  }).join('');
}

/* ---- Category selection ---- */
function selectCbtCategory(cat, btnEl) {
  _cbtCat     = cat;
  _cbtSelDept = null;
  _cbtSelSubj = null;

  document.querySelectorAll('.cbt-cat-pill').forEach(function(b) { b.classList.remove('active'); });
  if (btnEl) btnEl.classList.add('active');

  var subjCard = document.getElementById('cbtSubjCard');
  var qCard    = document.getElementById('cbtQCard');
  if (subjCard) subjCard.style.display = 'none';
  if (qCard)    qCard.style.display    = 'none';

  loadCbtDepts();
}

/* ---- DEPARTMENTS ---- */
async function loadCbtDepts() {
  var panel = document.getElementById('cbtDeptPanel');
  if (panel) panel.innerHTML = '<div style="color:var(--text-muted); font-size:14px; text-align:center; padding:24px;">Loading...</div>';

  /* ✅ FIX: Filter by current category */
  var res = await apiRequest('/exams/admin/departments?examCategory=' + _cbtCat);
  if (!res.ok) { adminToast('Failed to load departments', 'error'); return; }

  _cbtDepts = res.data.departments || [];

  var badge = document.getElementById('deptCountBadge');
  if (badge) badge.textContent = '(' + _cbtDepts.length + ')';

  if (!panel) return;

  if (_cbtDepts.length === 0) {
    panel.innerHTML =
      '<div style="color:var(--text-muted); font-size:14px; text-align:center; padding:24px; line-height:1.7;">' +
      'No departments for ' + _cbtCat.toUpperCase() + ' yet.<br>' +
      'Click "+ Add" to create one.' +
      '</div>';
    return;
  }

  panel.innerHTML = _cbtDepts.map(function(d) {
    var isSelected = _cbtSelDept && _cbtSelDept._id === d._id;
    return '<div class="cbt-list-item' + (isSelected ? ' selected' : '') + '" ' +
      'onclick="selectCbtDept(\'' + d._id + '\',\'' + (d.name || '').replace(/'/g, '') + '\')">' +
      '<div style="flex:1; min-width:0;">' +
        '<div class="cbt-list-item-name">' + (d.name || '') + '</div>' +
        (d.description ? '<div class="cbt-list-item-meta">' + d.description + '</div>' : '') +
      '</div>' +
      '<div style="display:flex; gap:4px; flex-shrink:0;">' +
        '<button onclick="event.stopPropagation(); openCbtDeptModal(\'' + d._id + '\')" ' +
          'style="padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; font-family:inherit; background:rgba(108,99,255,0.1); border:1px solid rgba(108,99,255,0.25); color:#a78bfa;">Edit</button>' +
        '<button onclick="event.stopPropagation(); deleteCbtDept(\'' + d._id + '\',\'' + (d.name || '').replace(/'/g, '') + '\')" ' +
          'style="padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; font-family:inherit; background:rgba(255,101,132,0.08); border:1px solid rgba(255,101,132,0.25); color:#ff6584;">✕</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function selectCbtDept(id, name) {
  _cbtSelDept = { _id: id, name: name };
  _cbtSelSubj = null;

  var subjCard  = document.getElementById('cbtSubjCard');
  var subjTitle = document.getElementById('cbtSubjCardTitle');
  var qCard     = document.getElementById('cbtQCard');

  if (subjCard)  subjCard.style.display = 'block';
  if (subjTitle) subjTitle.textContent  = 'Subjects — ' + name + ' (' + _cbtCat.toUpperCase() + ')';
  if (qCard)     qCard.style.display    = 'none';

  loadCbtDepts();
  loadCbtSubjects();
}

/* Dept modal */
function openCbtDeptModal(editId) {
  _cbtEditDeptId = editId || null;

  var form = document.getElementById('cbtDeptForm');
  if (form) form.reset();

  var h = document.getElementById('cbtDeptModalTitle');
  var b = document.getElementById('saveCbtDeptBtn');
  var i = document.getElementById('editCbtDeptId');

  if (editId) {
    var dept = _cbtDepts.find(function(d) { return d._id === editId; });
    if (!dept) return;
    if (h) h.textContent = 'Edit Department (' + _cbtCat.toUpperCase() + ')';
    if (b) b.textContent = 'Save Changes';
    if (i) i.value = editId;
    var nameEl = document.getElementById('cbtDeptName');
    var descEl = document.getElementById('cbtDeptDesc');
    if (nameEl) nameEl.value = dept.name        || '';
    if (descEl) descEl.value = dept.description || '';
  } else {
    if (h) h.textContent = 'Add Department — ' + _cbtCat.toUpperCase();
    if (b) b.textContent = 'Create Department';
    if (i) i.value = '';
  }

  var modal = document.getElementById('cbtDeptModal');
  if (modal) modal.style.display = 'flex';
}

async function saveCbtDept(e) {
  e.preventDefault();
  var btn = document.getElementById('saveCbtDeptBtn');
  if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; }

  var editId = ((document.getElementById('editCbtDeptId') || {}).value || '').trim();
  var payload = {
    name:         ((document.getElementById('cbtDeptName') || {}).value || '').trim(),
    description:  ((document.getElementById('cbtDeptDesc') || {}).value || '').trim(),
    examCategory: _cbtCat   /* ✅ FIX: always tag with current category */
  };

  if (!payload.name) {
    adminToast('Department name is required.', 'error');
    if (btn) { btn.textContent = editId ? 'Save Changes' : 'Create Department'; btn.disabled = false; }
    return;
  }

  var endpoint = editId ? '/exams/admin/departments/' + editId : '/exams/admin/departments';
  var method   = editId ? 'PUT' : 'POST';
  var res      = await apiRequest(endpoint, method, payload);

  if (btn) { btn.textContent = editId ? 'Save Changes' : 'Create Department'; btn.disabled = false; }

  if (res.ok) {
    adminToast(res.data.message || 'Department saved!', 'success');
    closeAdminModal('cbtDeptModal');
    await loadCbtDepts();
    refreshSubjDeptDropdown();
  } else {
    adminToast(res.data.message || 'Failed.', 'error');
  }
}

async function deleteCbtDept(id, name) {
  if (!confirm('Delete department "' + name + '" from ' + _cbtCat.toUpperCase() + '?\n\nAll subjects inside must be deleted first.')) return;
  var res = await apiRequest('/exams/admin/departments/' + id, 'DELETE');
  if (res.ok) {
    adminToast('Deleted.', 'success');
    if (_cbtSelDept && _cbtSelDept._id === id) {
      _cbtSelDept = null;
      var subjCard = document.getElementById('cbtSubjCard');
      var qCard    = document.getElementById('cbtQCard');
      if (subjCard) subjCard.style.display = 'none';
      if (qCard)    qCard.style.display    = 'none';
    }
    await loadCbtDepts();
  } else {
    adminToast(res.data.message || 'Delete failed.', 'error');
  }
}

/* ---- SUBJECTS ---- */

async function loadCbtSubjects() {
  var panel = document.getElementById('cbtSubjPanel');
  if (!_cbtSelDept) return;
  if (panel) panel.innerHTML = '<div style="color:var(--text-muted); font-size:14px; text-align:center; padding:24px;">Loading...</div>';

  var res = await apiRequest('/exams/admin/subjects?department=' + _cbtSelDept._id);
  if (!res.ok) { adminToast('Failed to load subjects', 'error'); return; }

  _cbtSubjects = res.data.subjects || [];
  if (!panel) return;

  if (_cbtSubjects.length === 0) {
    panel.innerHTML =
      '<div style="color:var(--text-muted); font-size:14px; text-align:center; padding:24px; line-height:1.7;">' +
      'No subjects yet.<br>Click "+ Add" to create one.</div>';
    return;
  }

  /* ✅ STAGE 1: Fetch Question Pool health for all subjects in one call */
  var poolHealth = {};
  try {
    var subjectIds = _cbtSubjects.map(function(s) { return s._id; });
    var healthRes  = await qmsApi('/blueprint/pool-health-batch', 'POST', { subjectIds: subjectIds });
    if (healthRes.ok) { poolHealth = healthRes.data.health || {}; }
  } catch (e) {
    /* Pool health is non-critical — subject list still renders */
    console.warn('[CBT] Pool health fetch failed:', e.message);
  }

  panel.innerHTML = _cbtSubjects.map(function (s) {
    var isSelected = _cbtSelSubj && _cbtSelSubj._id === s._id;
    var ph         = poolHealth[s._id] || { total: 0 };
    var poolCount  = ph.total || 0;

    var poolBadge = poolCount > 0
      ? '<span style="font-size:10px; font-weight:700; background:rgba(67,233,123,0.1); color:#43e97b; padding:1px 7px; border-radius:20px; margin-left:6px;">' +
          poolCount.toLocaleString() + ' approved' +
        '</span>'
      : '<span style="font-size:10px; color:var(--text-muted); margin-left:6px;">No questions yet</span>';

    var safeName = (s.name || '').replace(/'/g, '');
    var safeDept = (_cbtSelDept ? _cbtSelDept.name : '').replace(/'/g, '');

    return '<div class="cbt-list-item' + (isSelected ? ' selected' : '') + '" ' +
      'onclick="selectCbtSubj(\'' + s._id + '\',\'' + safeName + '\')">' +
      '<div style="flex:1; min-width:0;">' +
        '<div style="display:flex; align-items:center; flex-wrap:wrap;">' +
          '<span class="cbt-list-item-name">' + (s.name || '') + '</span>' +
          poolBadge +
        '</div>' +
        '<div class="cbt-list-item-meta" style="margin-top:3px;">' +
          (s.timeLimit || 0) + ' mins · ' + (s.questionCount || 0) + ' per session' +
        '</div>' +
      '</div>' +
      '<div style="display:flex; gap:4px; flex-shrink:0; flex-wrap:wrap;">' +
        '<button onclick="event.stopPropagation(); openCbtSubjModal(\'' + s._id + '\')" ' +
          'style="padding:3px 7px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; font-family:inherit; background:rgba(108,99,255,0.1); border:1px solid rgba(108,99,255,0.25); color:#a78bfa;">✏ Edit</button>' +
        '<button onclick="event.stopPropagation(); qmsBlueprintOpen(\'' + s._id + '\',\'' + safeName + '\',\'' + safeDept + '\')" ' +
          'style="padding:3px 7px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; font-family:inherit; background:rgba(56,249,215,0.08); border:1px solid rgba(56,249,215,0.25); color:#38f9d7;" ' +
          'title="Configure Examination Blueprint">📋</button>' +
        '<button onclick="event.stopPropagation(); qmsOpenBankForSubject(\'' + s._id + '\',\'' + safeName + '\')" ' +
          'style="padding:3px 7px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; font-family:inherit; background:rgba(67,233,123,0.08); border:1px solid rgba(67,233,123,0.25); color:#43e97b;" ' +
          'title="Manage questions for this subject">📚</button>' +
        '<button onclick="event.stopPropagation(); deleteCbtSubj(\'' + s._id + '\',\'' + safeName + '\')" ' +
          'style="padding:3px 7px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; font-family:inherit; background:rgba(255,101,132,0.08); border:1px solid rgba(255,101,132,0.25); color:#ff6584;">✕</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

/* Navigate to QMS Bank filtered to this subject */
function qmsOpenBankForSubject(subjectId, subjectName) {
  qmsBankFilterBySubject(subjectId, subjectName);
  showAdminSection('qms-import');
  setTimeout(function () {
    qmsSwitchTab('bank');
    qmsBankLoad(1);
  }, 200);
}

function selectCbtSubj(id, name) {
  _cbtSelSubj = { _id: id, name: name };

  var qCard  = document.getElementById('cbtQCard');
  var qTitle = document.getElementById('cbtQCardTitle');
  if (qCard)  qCard.style.display = 'block';
  if (qTitle) qTitle.textContent  = 'Questions — ' + name + ' (' + _cbtCat.toUpperCase() + ')';

  loadCbtSubjects();
  loadCbtQuestions();
}

/* Refresh the dept dropdown in subject modal */
function refreshSubjDeptDropdown() {
  var sel = document.getElementById('cbtSubjDeptSel');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Select Department --</option>' +
    _cbtDepts.map(function(d) {
      return '<option value="' + d._id + '">' + d.name + '</option>';
    }).join('');
}

/* Subject modal */
function openCbtSubjModal(editId) {
  _cbtEditSubjId = editId || null;

  var form = document.getElementById('cbtSubjForm');
  if (form) form.reset();

  refreshSubjDeptDropdown();

  var h = document.getElementById('cbtSubjModalTitle');
  var b = document.getElementById('saveCbtSubjBtn');
  var i = document.getElementById('editCbtSubjId');

  if (editId) {
    var subj = _cbtSubjects.find(function(s) { return s._id === editId; });
    if (!subj) return;
    if (h) h.textContent = 'Edit Subject (' + _cbtCat.toUpperCase() + ')';
    if (b) b.textContent = 'Save Changes';
    if (i) i.value = editId;

    var flds = {
      'cbtSubjName':    subj.name || '',
      'cbtSubjDeptSel': subj.department ? (subj.department._id || '') : (_cbtSelDept ? _cbtSelDept._id : ''),
      'cbtSubjTime':    subj.timeLimit    || 30,
      'cbtSubjQCount':  subj.questionCount || 40,
      'cbtSubjInstr':   subj.instructions || ''
    };
    Object.keys(flds).forEach(function(fid) {
      var el = document.getElementById(fid); if (el) el.value = flds[fid];
    });
  } else {
    if (h) h.textContent = 'Add Subject — ' + _cbtCat.toUpperCase();
    if (b) b.textContent = 'Create Subject';
    if (i) i.value = '';

    if (_cbtSelDept) {
      var deptSel = document.getElementById('cbtSubjDeptSel');
      if (deptSel) deptSel.value = _cbtSelDept._id;
    }

    var tEl = document.getElementById('cbtSubjTime');   if (tEl) tEl.value = '30';
    var qEl = document.getElementById('cbtSubjQCount'); if (qEl) qEl.value = '40';
  }

  var modal = document.getElementById('cbtSubjModal');
  if (modal) modal.style.display = 'flex';
}

async function saveCbtSubj(e) {
  e.preventDefault();
  var btn = document.getElementById('saveCbtSubjBtn');
  if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; }

  var editId = ((document.getElementById('editCbtSubjId') || {}).value || '').trim();
  var payload = {
    name:          ((document.getElementById('cbtSubjName')    || {}).value || '').trim(),
    department:    ((document.getElementById('cbtSubjDeptSel') || {}).value || '').trim(),
    timeLimit:     parseInt((document.getElementById('cbtSubjTime')   || {}).value) || 30,
    questionCount: parseInt((document.getElementById('cbtSubjQCount') || {}).value) || 40,
    instructions:  ((document.getElementById('cbtSubjInstr')   || {}).value || '').trim(),
    /* ✅ FIX: Tag with current category so filtering works */
    examCategories: [_cbtCat === 'practice' ? 'all' : _cbtCat]
  };

  if (!payload.name)       { adminToast('Subject name is required.',   'error'); if (btn) { btn.textContent = editId?'Save Changes':'Create Subject'; btn.disabled=false; } return; }
  if (!payload.department) { adminToast('Please select a department.', 'error'); if (btn) { btn.textContent = editId?'Save Changes':'Create Subject'; btn.disabled=false; } return; }

  var endpoint = editId ? '/exams/admin/subjects/' + editId : '/exams/admin/subjects';
  var method   = editId ? 'PUT' : 'POST';
  var res      = await apiRequest(endpoint, method, payload);

  if (btn) { btn.textContent = editId?'Save Changes':'Create Subject'; btn.disabled = false; }

  if (res.ok) {
    adminToast(res.data.message || 'Subject saved!', 'success');
    closeAdminModal('cbtSubjModal');
    await loadCbtSubjects();
  } else {
    adminToast(res.data.message || 'Failed.', 'error');
  }
}

async function deleteCbtSubj(id, name) {
  if (!confirm('Delete subject "' + name + '"?\n\nAll its questions will be deleted too.')) return;
  var res = await apiRequest('/exams/admin/subjects/' + id, 'DELETE');
  if (res.ok) {
    adminToast('Deleted.', 'success');
    if (_cbtSelSubj && _cbtSelSubj._id === id) {
      _cbtSelSubj = null;
      var qCard = document.getElementById('cbtQCard');
      if (qCard) qCard.style.display = 'none';
    }
    await loadCbtSubjects();
  } else {
    adminToast(res.data.message || 'Delete failed.', 'error');
  }
}

/* ---- QUESTIONS ---- */
async function loadCbtQuestions() {
  var panel   = document.getElementById('cbtQPanel');
  var countEl = document.getElementById('cbtQCount');

  if (!_cbtSelSubj) { return; }
  if (panel) panel.innerHTML =
    '<div style="color:var(--text-muted); font-size:14px; text-align:center; padding:24px;">' +
    '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.2);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:8px;"></span>' +
    'Loading...</div>';

  /* ✅ STAGE 2: Primary path — QMS Question Bank */
  var qs = '?subjectId=' + _cbtSelSubj._id + '&limit=50';
  if (_cbtCat && _cbtCat !== 'all') qs += '&examType=' + _cbtCat;

  var res = await qmsApi('/bank' + qs);

  if (!res.ok) {
    if (panel) panel.innerHTML =
      '<div style="color:#ff6584; font-size:14px; text-align:center; padding:24px;">' +
      'Failed to load questions. ' + (res.data.message || '') + '</div>';
    return;
  }

  var questions = res.data.questions || [];
  var total     = res.data.total     || 0;
  _cbtQuestions = questions; /* keep reference for backward compat */

  if (countEl) countEl.textContent = total.toLocaleString() + ' question' + (total !== 1 ? 's' : '');
  if (!panel) { return; }

  if (questions.length === 0) {
    panel.innerHTML =
      '<div style="color:var(--text-muted); font-size:14px; text-align:center; padding:28px; line-height:1.9;">' +
        '<div style="font-size:28px; margin-bottom:10px;">📭</div>' +
        '<strong style="color:var(--text-secondary,#a0a0c0);">No questions yet for this subject</strong><br>' +
        '<span style="font-size:13px;">Click <strong>+ Add Question</strong> to create the first one,<br>' +
        'or use the <strong>📚 Manage Pool</strong> button to bulk import.</span>' +
      '</div>';
    return;
  }

  var letters = ['A', 'B', 'C', 'D'];

  panel.innerHTML = questions.map(function (q, i) {
    var opts = (q.options || []).map(function (opt, idx) {
      var isCorrect = idx === q.correctAnswer;
      return '<span style="font-size:11px; padding:2px 7px; border-radius:4px; margin-right:4px; margin-bottom:4px; display:inline-block;' +
        'background:' + (isCorrect ? 'rgba(67,233,123,0.15)' : 'rgba(255,255,255,0.04)') + ';' +
        'color:'       + (isCorrect ? '#43e97b'               : 'var(--text-secondary)') + ';' +
        'border:1px solid ' + (isCorrect ? 'rgba(67,233,123,0.3)' : 'var(--border,rgba(255,255,255,0.08))') + ';">' +
        (letters[idx] || idx) + ': ' + opt + (isCorrect ? ' ✓' : '') +
      '</span>';
    }).join('');

    var qtBadge = (q.questionType && q.questionType !== 'objective')
      ? '<span style="font-size:10px; font-weight:700; background:rgba(108,99,255,0.12); color:#a78bfa; padding:1px 6px; border-radius:20px; margin-left:6px;">' + q.questionType + '</span>'
      : '';

    var safeId = (q._id || '').toString();

    return '<div class="cbt-q-item">' +
      '<div style="display:flex; align-items:flex-start; gap:12px;">' +
        '<span style="width:24px; height:24px; border-radius:6px; background:rgba(67,233,123,0.1); color:#43e97b; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:11px; flex-shrink:0; margin-top:2px;">' + (i + 1) + '</span>' +
        '<div style="flex:1; min-width:0;">' +
          '<div style="font-size:13px; font-weight:600; color:#fff; margin-bottom:6px; line-height:1.5;">' +
            q.question + qtBadge +
          '</div>' +
          '<div style="display:flex; flex-wrap:wrap; gap:2px; margin-bottom:4px;">' + opts + '</div>' +
          (q.explanation ? '<div style="font-size:11px; color:var(--text-muted); font-style:italic; margin-top:4px;">💡 ' + q.explanation + '</div>' : '') +
          (q.topic ? '<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">📌 ' + q.topic + '</div>' : '') +
        '</div>' +
        '<div style="display:flex; gap:4px; flex-shrink:0;">' +
          '<button onclick="qmsOpenEdit(\'' + safeId + '\')" ' +
            'style="padding:4px 8px; border-radius:6px; font-size:12px; cursor:pointer; font-family:inherit; background:rgba(108,99,255,0.1); border:1px solid rgba(108,99,255,0.25); color:#a78bfa;" ' +
            'title="Edit this question">✏</button>' +
          '<button onclick="qmsSoftDeleteFromCbt(\'' + safeId + '\')" ' +
            'style="padding:4px 8px; border-radius:6px; font-size:12px; cursor:pointer; font-family:inherit; background:rgba(255,101,132,0.08); border:1px solid rgba(255,101,132,0.25); color:#ff6584;" ' +
            'title="Remove from pool (soft delete)">🗑</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  /* Show "view all" link when pool exceeds display limit */
  if (total > 50) {
    panel.innerHTML +=
      '<div style="padding:10px 16px; font-size:12px; color:var(--text-muted); text-align:center; border-top:1px solid var(--border,rgba(255,255,255,0.06));">' +
        'Showing 50 of <strong style="color:#fff;">' + total.toLocaleString() + '</strong> questions. ' +
        '<button class="a-btn a-btn-secondary a-btn-sm" ' +
          'onclick="qmsOpenBankForSubject(\'' + _cbtSelSubj._id + '\',\'' + (_cbtSelSubj.name || '').replace(/'/g, '') + '\')" ' +
          'style="margin-left:8px;">View all ' + total.toLocaleString() + ' →</button>' +
      '</div>';
  }
}

/* Question modal */
/* ✅ STAGE 2: openCbtQModal() now delegates to the QMS editor.
   The legacy modal (cbtQModal) is kept as emergency fallback only.
   Access via openCbtQModalLegacy() if absolutely needed. */
function openCbtQModal() {
  qmsCreateForSubject();
}

/* ✅ STAGE 5: Legacy question editor archived.
   The cbtQModal HTML was removed in Stage 5.
   This function now shows an informational notice.
   To add questions: use the QMS Question Bank (qmsCreateForSubject). */
function openCbtQModalLegacy() {
  adminToast(
    '📦 Legacy editor archived. Use + Add Question to create questions in the QMS Question Bank.',
    'info'
  );
}

async function saveCbtQuestion(e) {
  e.preventDefault();
  var btn = document.getElementById('saveCbtQBtn');
  if (btn) { btn.textContent = 'Adding...'; btn.disabled = true; }

  var optA = ((document.getElementById('cbtQOptA') || {}).value || '').trim();
  var optB = ((document.getElementById('cbtQOptB') || {}).value || '').trim();
  var optC = ((document.getElementById('cbtQOptC') || {}).value || '').trim();
  var optD = ((document.getElementById('cbtQOptD') || {}).value || '').trim();
  var options = [optA, optB, optC, optD].filter(function(o) { return o !== ''; });

  if (options.length < 2) { adminToast('At least 2 options required.', 'error'); if (btn) { btn.textContent='Add Question'; btn.disabled=false; } return; }

  var correctVal = (document.getElementById('cbtQCorrect') || {}).value;
  if (correctVal === '') { adminToast('Please select the correct answer.', 'error'); if (btn) { btn.textContent='Add Question'; btn.disabled=false; } return; }

  /* ✅ FIX: correctAnswer index must match the options array position */
  var correctIdx = parseInt(correctVal);

  var payload = {
    question:      ((document.getElementById('cbtQText') || {}).value || '').trim(),
    options:       options,
    correctAnswer: correctIdx,
    explanation:   ((document.getElementById('cbtQExpl') || {}).value || '').trim(),
    examCategory:  (document.getElementById('cbtQCat') || {}).value || _cbtCat
  };

  if (!payload.question) { adminToast('Question text is required.', 'error'); if (btn) { btn.textContent='Add Question'; btn.disabled=false; } return; }

  /* Validate that correctAnswer index is within options range */
  if (correctIdx >= options.length) {
    adminToast('Correct answer option does not exist. Please re-select.', 'error');
    if (btn) { btn.textContent='Add Question'; btn.disabled=false; }
    return;
  }

  var res = await apiRequest('/exams/admin/subjects/' + _cbtSelSubj._id + '/questions', 'POST', payload);

  if (btn) { btn.textContent = 'Add Question'; btn.disabled = false; }

  if (res.ok) {
    adminToast('Question added!', 'success');
    closeAdminModal('cbtQModal');
    await loadCbtQuestions();
    await loadCbtSubjects();
  } else {
    adminToast(res.data.message || 'Failed.', 'error');
  }
}

async function deleteCbtQuestion(questionId) {
  if (!confirm('Delete this question? This cannot be undone.')) return;
  var res = await apiRequest('/exams/admin/questions/' + questionId, 'DELETE');
  if (res.ok) {
    adminToast('Question deleted.', 'success');
    await loadCbtQuestions();
    if (_cbtSelSubj) await loadCbtSubjects();
  } else {
    adminToast(res.data.message || 'Delete failed.', 'error');
  }
}

/* ============================================
   ✅ ARCHITECTURE MIGRATION: PLATFORM STAFF
   Core functions for dual-auth admin panel.
============================================ */

/* Attempt to detect and activate a platform staff session.
   Called from DOMContentLoaded when root admin check fails.
   Returns true if platform staff session was activated. */
async function tryPlatformStaffLogin(safetyTimer, showScreen) {
  var pToken = localStorage.getItem('latlomp_platform_token');
  if (!pToken) { return false; }

  try {
    var pRes = await fetch('/api/platform-auth/me', {
      headers: { 'Authorization': 'Bearer ' + pToken, 'Content-Type': 'application/json' }
    });
    if (!pRes.ok) {
      localStorage.removeItem('latlomp_platform_token');
      localStorage.removeItem('latlomp_platform_staff');
      return false;
    }
    var pData = await pRes.json();
    if (!pData.success || !pData.staff) { return false; }

    var staff = pData.staff;

    /* Set global state — these are read by inline script functions */
    _isPlatformStaff    = true;
    _platformStaffUser  = staff;
    _platformStaffPerms = (staff.permissions && staff.permissions.length > 0)
      ? staff.permissions
      : getPlatformStaffDefaultPerms(staff.platformRole);

    localStorage.setItem('latlomp_platform_staff', JSON.stringify(staff));

    clearTimeout(safetyTimer);
    showScreen('app');

    /* Update sidebar identity */
    var nameEl   = document.getElementById('adminName');
    var avatarEl = document.getElementById('adminAvatar');
    var roleEl   = document.getElementById('adminRoleLabel');
    if (nameEl)   nameEl.textContent   = staff.name || 'Platform Staff';
    if (avatarEl) {
      avatarEl.textContent = (staff.name || 'S').charAt(0).toUpperCase();
      avatarEl.style.background = 'linear-gradient(135deg,#6c63ff,#574fd6)';
    }
    if (roleEl) {
      roleEl.textContent = PS_ROLE_LABELS_ADMIN[staff.platformRole] || 'Platform Staff';
      roleEl.style.color = '#a78bfa';
    }

    /* Filter UI based on permissions */
    filterAdminForPlatformStaff(_platformStaffPerms);

    /* Load overview */
    loadAdminStats();
    return true;

  } catch (e) {
    console.warn('[platform-staff] Session check failed:', e.message);
    return false;
  }
}

/* Hide sections + nav items the platform staff cannot access */
function filterAdminForPlatformStaff(permissions) {
  /* Hide unauthorized nav links */
  Object.keys(SECTION_PERM_MAP).forEach(function (sectionName) {
    var permsNeeded = SECTION_PERM_MAP[sectionName];
    if (permsNeeded.length === 0) { return; } /* always visible */

    var hasAccess = permsNeeded.some(function (p) { return permissions.indexOf(p) !== -1; });
    var navLink   = document.querySelector('.admin-nav-link[data-section="' + sectionName + '"]');
    if (navLink) navLink.style.display = hasAccess ? '' : 'none';
  });

  /* Hide institution sub-tabs platform staff can't use */
  var tabPermMap = {
    'instTabPlans':         'subscriptions',
    'instTabAnnouncements': 'announcements',
    'instTabLogs':          'audit_logs'
  };
  Object.keys(tabPermMap).forEach(function (tabId) {
    var el      = document.getElementById(tabId);
    var hasPerm = permissions.indexOf(tabPermMap[tabId]) !== -1;
    if (el) el.style.display = hasPerm ? '' : 'none';
  });

  /* Hide overview stats if no analytics permission */
  if (permissions.indexOf('analytics') === -1) {
    var statsGrid = document.querySelector('.a-stats-grid');
    if (statsGrid) statsGrid.style.display = 'none';
  }

  /* Hide "Add Product" button in overview if no store permission */
  if (permissions.indexOf('store') === -1) {
    document.querySelectorAll('[onclick*="openCreateProduct"]').forEach(function (el) {
      el.style.display = 'none';
    });
  }

/* ✅ ROUTE GUARD FIX: Patch apiRequest to use platform token.
       CBT and Products sections call the global apiRequest() which
       reads latlomp_token. Platform staff have latlomp_platform_token.
       This patch redirects all apiRequest calls through the platform
       token when _isPlatformStaff is true. */
    var _origApiRequest = window.apiRequest;
    window.apiRequest = function (endpoint, method, body) {
      if (_isPlatformStaff) {
        method = (method || 'GET').toUpperCase();
        var url     = '/api' + endpoint;
        var headers = { 'Content-Type': 'application/json' };
        var pToken  = localStorage.getItem('latlomp_platform_token');
        if (pToken) headers['Authorization'] = 'Bearer ' + pToken;
        var opts = { method: method, headers: headers };
        if (body && method !== 'GET') opts.body = JSON.stringify(body);
        return fetch(url, opts).then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, status: res.status, data: data };
          }).catch(function () {
            return { ok: false, status: res.status, data: { message: 'Unexpected server response.' } };
          });
        }).catch(function () {
          return { ok: false, status: 0, data: { message: 'Network error. Check your connection.' } };
        });
      }
      return _origApiRequest(endpoint, method, body);
    };

  /* Navigate to first permitted section */
  var firstPermitted = 'overview';
  var orderedSections = ['institutions', 'cbt-management', 'products', 'platform-staff'];
  for (var i = 0; i < orderedSections.length; i++) {
    var sName       = orderedSections[i];
    var sPerms      = SECTION_PERM_MAP[sName];
    var sHasAccess  = sPerms.some(function (p) { return permissions.indexOf(p) !== -1; });
    if (sHasAccess) { firstPermitted = sName; break; }
  }
  showAdminSection(firstPermitted);
  if (firstPermitted === 'institutions') { setTimeout(instOnActivate, 200); }
}

/* Default permissions fallback for legacy staff without DB permissions */
function getPlatformStaffDefaultPerms(role) {
  var defaults = {
    platform_admin: ['institutions','subscriptions','cbt','staff','analytics','reports','announcements','audit_logs','store'],
    support_admin:  ['institutions','analytics','announcements','audit_logs'],
    finance_admin:  ['institutions','subscriptions','reports','analytics'],
    content_admin:  ['announcements','content'],
    developer:      ['analytics','audit_logs','reports']
  };
  return defaults[role] || [];
}

/* ============================================================
   QUESTION MANAGEMENT SYSTEM (QMS) — PHASE 1
   Import → Validate → Preview → Confirm → History
============================================================ */

var _qmsPreviewData     = null; /* stores validated questions from last preview */
var _qmsCurrentMethod   = 'paste'; /* 'paste' or 'file' */
var _qmsSelectedFile    = null;
var _qmsDeptsLoaded     = false;
/* ✅ STEP 2 FIX: Module-level questionType so qmsGetMeta() never
   defaults to 'objective' just because the DOM element is missing.
   Updated by qmsOnTypeChange() whenever the selector changes. */
var _qmsCurrentQType    = 'objective';

/* ---- API wrapper — uses correct token for root/staff ---- */
async function qmsApi(path, method, body) {
  var token = (typeof _isPlatformStaff !== 'undefined' && _isPlatformStaff)
    ? localStorage.getItem('latlomp_platform_token')
    : localStorage.getItem('latlomp_token');
  var opts = {
    method:  method || 'GET',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
  };
  if (body && (method || 'GET').toUpperCase() !== 'GET') opts.body = JSON.stringify(body);
  try {
    var res  = await fetch('/api/qms' + path, opts);
    var data = await res.json();
    return { ok: res.ok, status: res.status, data: data };
  } catch (e) {
    return { ok: false, status: 0, data: { message: 'Network error: ' + e.message } };
  }
}

/* File upload: uses FormData (not JSON) */
async function qmsFileApi(path, formData) {
  var token = (typeof _isPlatformStaff !== 'undefined' && _isPlatformStaff)
    ? localStorage.getItem('latlomp_platform_token')
    : localStorage.getItem('latlomp_token');
  try {
    var res  = await fetch('/api/qms' + path, {
      method:  'POST',
      headers: { 'Authorization': 'Bearer ' + token },  /* no Content-Type — let browser set boundary */
      body:    formData
    });
    var data = await res.json();
    return { ok: res.ok, status: res.status, data: data };
  } catch (e) {
    return { ok: false, status: 0, data: { message: 'Network error: ' + e.message } };
  }
}

/* ---- Populate all QMS exam type selects from API ---- */
async function qmsPopulateAllExamTypeDropdowns() {
  /* Import form */
  await populateExamTypeSelect('qmsExamType', { selectedKey: 'jamb' });

  /* Bank filter */
  await populateExamTypeSelect('qmsBankFilterExam', { placeholder: 'All Exam Types', includeAll: false });

  /* Engine config */
  await populateExamTypeSelect('qmsEngExamType', { selectedKey: 'jamb', includeAll: true });

  /* Breakdown filter */
  await populateExamTypeSelect('qmsBreakdownFilter', { placeholder: 'All Types', includeAll: true });

  /* Tag manager filter */
  await populateExamTypeSelect('qmsTagFilterExam', { placeholder: 'All Exam Types' });

  /* Integration status filter */
  await populateExamTypeSelect('qmsIntegFilterExam', { selectedKey: 'jamb', includeAll: true });

  /* Orphan filter */
  await populateExamTypeSelect('qmsOrphanFilterExam', { placeholder: 'All Exam Types' });

  /* Bulk move target */
  await populateExamTypeSelect('qmsMoveExamType', { selectedKey: 'jamb' });

  /* Orphan assign */
  await populateExamTypeSelect('qmsOrphanExamType', { selectedKey: 'jamb' });

  /* Sources filter */
  await populateExamTypeSelect('qmsSourceFilterExam', { placeholder: 'Both Sources' });

  /* Blueprint modal */
  await populateExamTypeSelect('bpExamType', { includeAll: true, selectedKey: 'all' });
}

/* ---- Init: called when QMS section becomes active ---- */
async function qmsInit() {
  /* ✅ STEP 2 FIX: Inject questionType selector. Try immediately, then
     retry after dropdowns load in case the panel renders late. */
  _qmsEnsureTypeSelector();

  /* Populate all exam type dropdowns first */
  await qmsPopulateAllExamTypeDropdowns();
  if (!_qmsDeptsLoaded) {
    await qmsLoadDepts();
    _qmsDeptsLoaded = true;
  }
  /* ✅ STEP 2 FIX: Retry injection — panel may not have been in DOM
     on first call if the section was rendered after DOMContentLoaded */
  setTimeout(_qmsEnsureTypeSelector, 200);
}

/* ---- Sub-tab switching ---- */

function qmsSwitchTab(tab) {
  ['import', 'bank', 'sources', 'orphans', 'migration', 'engine', 'history', 'stats'].forEach(function (t) {
    var panel = document.getElementById('qmsPanel' + t.charAt(0).toUpperCase() + t.slice(1));
    if (panel) panel.style.display = (t === tab) ? 'block' : 'none';
    var btn   = document.getElementById('qmsTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn)  btn.classList.toggle('active', t === tab);
  });
  if (tab === 'history') qmsLoadHistory();
  if (tab === 'stats')   qmsLoadStats();
  if (tab === 'bank')    qmsBankLoad(1);
  if (tab === 'sources')   qmsSourceInit();
  if (tab === 'orphans')   qmsOrphanLoad(1);
  if (tab === 'engine')    { qmsEngInit(); }
  if (tab === 'migration') { qmsMigrationLoadStatus(); }
}

/* ---- Toggle paste / file input method ---- */
function qmsSetMethod(method) {
  _qmsCurrentMethod = method;
  var pasteArea = document.getElementById('qmsPasteArea');
  var fileArea  = document.getElementById('qmsFileArea');
  var btnPaste  = document.getElementById('qmsBtnPaste');
  var btnFile   = document.getElementById('qmsBtnFile');
  if (pasteArea) pasteArea.style.display = (method === 'paste') ? 'block' : 'none';
  if (fileArea)  fileArea.style.display  = (method === 'file')  ? 'block' : 'none';
  if (btnPaste)  btnPaste.className = 'a-btn a-btn-sm ' + (method === 'paste' ? 'a-btn-primary' : 'a-btn-secondary');
  if (btnFile)   btnFile.className  = 'a-btn a-btn-sm ' + (method === 'file'  ? 'a-btn-primary' : 'a-btn-secondary');
  /* Reset preview on method change */
  var pp = document.getElementById('qmsPreviewPanel');
  if (pp) pp.style.display = 'none';
  _qmsPreviewData = null;
}

/* Called when file is selected via input */
function qmsFileSelected(input) {
  _qmsSelectedFile = input.files && input.files[0];
  var lbl = document.getElementById('qmsFileLabel');
  if (lbl && _qmsSelectedFile) {
    lbl.textContent = '✅ ' + _qmsSelectedFile.name + ' (' + (_qmsSelectedFile.size / 1024).toFixed(1) + ' KB)';
  }
}

/* ---- Load departments into dropdown ---- */
async function qmsLoadDepts() {
  var examType = (document.getElementById('qmsExamType') || {}).value || 'jamb';
  var res      = await qmsApi('/departments?examCategory=' + examType);
  var sel      = document.getElementById('qmsDepartment');
  if (!sel) { return; }
  if (!res.ok || !res.data.departments.length) {
    sel.innerHTML = '<option value="">— No departments for ' + examType.toUpperCase() + ' —</option>';
    document.getElementById('qmsSubject').innerHTML = '<option value="">— select department first —</option>';
    return;
  }
  sel.innerHTML = '<option value="">— Select Department (optional) —</option>' +
    res.data.departments.map(function (d) {
      return '<option value="' + d._id + '" data-name="' + (d.name || '').replace(/"/g, '&quot;') + '">' + d.name + '</option>';
    }).join('');
  /* Auto-load subjects if a dept was previously selected */
  if (sel.value) { await qmsLoadSubjectsForDept(); }
}

/* ---- Load subjects based on selected department ---- */
async function qmsLoadSubjectsForDept() {
  var deptSel = document.getElementById('qmsDepartment');
  var deptId  = deptSel ? deptSel.value : '';
  var subjSel = document.getElementById('qmsSubject');
  if (!subjSel) { return; }

  if (!deptId) {
    subjSel.innerHTML = '<option value="">— select department first —</option>';
    return;
  }

  subjSel.innerHTML = '<option value="">Loading...</option>';
  var res = await qmsApi('/subjects?departmentId=' + deptId);

  if (!res.ok || !res.data.subjects.length) {
    subjSel.innerHTML = '<option value="">— No subjects for this department —</option>';
    return;
  }
  subjSel.innerHTML = '<option value="">— Select Subject (optional) —</option>' +
    res.data.subjects.map(function (s) {
      return '<option value="' + s._id + '" data-name="' + (s.name || '').replace(/"/g, '&quot;') + '">' + s.name + '</option>';
    }).join('');
}

/* ---- Get selected metadata ---- */
function qmsGetMeta() {
  var examTypeSel    = document.getElementById('qmsExamType');
  var deptSel        = document.getElementById('qmsDepartment');
  var subjSel        = document.getElementById('qmsSubject');
  var qTypeSel       = document.getElementById('qmsQuestionType');
  var deptOpt        = deptSel && deptSel.selectedOptions[0];
  var subjOpt        = subjSel && subjSel.selectedOptions[0];
  return {
    examType:       examTypeSel ? examTypeSel.value : 'jamb',
    /* ✅ STEP 2 FIX: Fall back to _qmsCurrentQType if DOM element missing */
    questionType:   qTypeSel ? (qTypeSel.value || _qmsCurrentQType) : _qmsCurrentQType,
    departmentId:   deptSel ? deptSel.value : '',
    departmentName: deptOpt ? (deptOpt.dataset.name || deptOpt.text || '') : '',
    subjectId:      subjSel ? subjSel.value : '',
    subjectName:    subjOpt ? (subjOpt.dataset.name || subjOpt.text || '') : ''
  };
}

/* ---- Validate & Preview ---- */
async function qmsPreview() {
  var btn    = document.getElementById('qmsValidateBtn');
  var status = document.getElementById('qmsValidateStatus');
  var meta   = qmsGetMeta();
  var pp     = document.getElementById('qmsPreviewPanel');

  if (pp) pp.style.display = 'none';
  _qmsPreviewData = null;

  if (btn) { btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:6px;"></span> Validating...'; btn.disabled = true; }
  if (status) status.textContent = '';

  var res;

  if (_qmsCurrentMethod === 'file') {
    if (!_qmsSelectedFile) {
      instToast('Please select a file first.', 'error');
      if (btn) { btn.innerHTML = '🔍 Validate & Preview'; btn.disabled = false; }
      return;
    }
    var fd = new FormData();
    fd.append('file',           _qmsSelectedFile);
    fd.append('examType',       meta.examType);
    /* ✅ STEP 2 FIX: questionType was never sent — server always got
       undefined → defaulted to 'objective' → theory rejected */
    fd.append('questionType',   meta.questionType || _qmsCurrentQType);
    fd.append('departmentId',   meta.departmentId);
    fd.append('subjectId',      meta.subjectId);
    fd.append('subjectName',    meta.subjectName);
    fd.append('departmentName', meta.departmentName);
    res = await qmsFileApi('/import/preview/file', fd);
  } else {
    var text = (document.getElementById('qmsPasteText') || {}).value || '';
    if (!text.trim()) {
      instToast('Please paste some questions first.', 'error');
      if (btn) { btn.innerHTML = '🔍 Validate & Preview'; btn.disabled = false; }
      return;
    }
    res = await qmsApi('/import/preview', 'POST', {
      text:           text,
      examType:       meta.examType,
      /* ✅ STEP 2 FIX: This was the primary bug. questionType was never
         sent to the server so the parser always ran in objective mode.
         Theory questions were rejected as "Fewer than 2 options". */
      questionType:   meta.questionType || _qmsCurrentQType,
      departmentId:   meta.departmentId,
      subjectId:      meta.subjectId,
      subjectName:    meta.subjectName,
      departmentName: meta.departmentName
    });
  }

  if (btn) { btn.innerHTML = '🔍 Validate & Preview'; btn.disabled = false; }

  if (!res.ok) {
    instToast(res.data.message || 'Validation failed.', 'error');
    return;
  }

  var preview = res.data.preview;
 /* ✅ STEP 2 FIX: Store questionType from server response (echoed back).
     This ensures renderQmsPreview and qmsConfirmImport both get the
     correct type even if meta was read before selector was visible. */
  var resolvedQType = (res.data.preview && res.data.preview.questionType)
    ? res.data.preview.questionType
    : (meta.questionType || _qmsCurrentQType);
  _qmsPreviewData = {
    preview:    preview,
    meta:       Object.assign({}, meta, { questionType: resolvedQType }),
    sourceType: _qmsCurrentMethod === 'file' ? 'file' : 'paste',
    filename:   res.data.filename || ''
  };
  renderQmsPreview(preview, meta);
  if (status) status.textContent = 'Validation complete.';
}

/* ---- Render preview UI ---- */
function renderQmsPreview(preview, meta) {
  var pp = document.getElementById('qmsPreviewPanel');
  if (!pp) { return; }
  pp.style.display = 'block';

  var stats = preview.stats || {};
  var PREVIEW_LIMIT = 20;

  /* Stats bar */
  var statsEl = document.getElementById('qmsPreviewStats');
  if (statsEl) {
    statsEl.innerHTML = [
      ['📋', stats.detected  || 0, 'Detected',   'rgba(255,255,255,0.06)'],
      ['✅', stats.valid      || 0, 'Valid',       'rgba(67,233,123,0.1)'],
      ['🔁', stats.duplicate  || 0, 'Duplicates',  'rgba(255,165,0,0.1)'],
      ['❌', stats.rejected   || 0, 'Rejected',    'rgba(255,101,132,0.1)']
    ].map(function (s) {
      return '<div class="a-stat-card" style="background:' + s[3] + '; border-radius:12px; padding:16px;">' +
        '<div style="font-size:20px; margin-right:12px;">' + s[0] + '</div>' +
        '<div><div style="font-size:24px; font-weight:900; color:#fff;">' + s[1] + '</div>' +
        '<div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">' + s[2] + '</div></div>' +
      '</div>';
    }).join('');
  }

  /* Warnings */
  var wEl = document.getElementById('qmsWarningsPanel');
  if (wEl) {
    var warnings = preview.warnings || [];
    if (warnings.length) {
      wEl.style.display = 'block';
      wEl.innerHTML = '<div style="background:rgba(255,165,0,0.08); border:1px solid rgba(255,165,0,0.2); border-radius:10px; padding:14px 16px;">' +
        '<div style="font-size:12px; font-weight:700; color:#ffa500; margin-bottom:8px;">⚠️ Parse Warnings (' + warnings.length + ')</div>' +
        '<div style="font-size:12px; color:var(--text-secondary); line-height:1.8;">' +
          warnings.slice(0, 10).map(function (w) { return '• ' + w; }).join('<br>') +
          (warnings.length > 10 ? '<br>... and ' + (warnings.length - 10) + ' more.' : '') +
        '</div></div>';
    } else {
      wEl.style.display = 'none';
    }
  }

  /* Valid questions table */
  var validQs = preview.valid || [];
  var titleEl = document.getElementById('qmsPreviewTitle');
  if (titleEl) titleEl.textContent = 'Valid Questions Preview (' + validQs.length + ' ready to import)';

  var confirmBtn = document.getElementById('qmsConfirmBtn');
  if (confirmBtn) {
    if (validQs.length > 0) {
      confirmBtn.style.display = 'inline-flex';
      confirmBtn.textContent   = '✅ Import ' + validQs.length + ' Question' + (validQs.length !== 1 ? 's' : '');
    } else {
      confirmBtn.style.display = 'none';
    }
  }

  var tbody = document.getElementById('qmsPreviewTable');
  var noteEl = document.getElementById('qmsPreviewMoreNote');
  if (tbody) {
    var letters = ['A', 'B', 'C', 'D'];
    var shown   = validQs.slice(0, PREVIEW_LIMIT);
    if (!shown.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:24px; color:var(--text-muted);">No valid questions found. Check warnings above.</td></tr>';
    } else {
      tbody.innerHTML = shown.map(function (q, i) {
        var opts = (q.options || []).map(function (o, idx) {
          return '<span style="font-size:11px; padding:1px 6px; border-radius:4px; margin-right:3px; background:' +
            (idx === q.correctAnswer ? 'rgba(67,233,123,0.15)' : 'rgba(255,255,255,0.04)') + '; color:' +
            (idx === q.correctAnswer ? '#43e97b' : 'var(--text-secondary)') + ';">' +
            letters[idx] + ': ' + o.substring(0, 30) + (o.length > 30 ? '...' : '') +
            (idx === q.correctAnswer ? ' ✓' : '') + '</span>';
        }).join('');
        return '<tr>' +
          '<td style="font-weight:700; color:#a78bfa;">' + (i + 1) + '</td>' +
          '<td style="color:#fff; font-size:13px;">' + q.question.substring(0, 100) + (q.question.length > 100 ? '...' : '') + '</td>' +
          '<td>' + opts + '</td>' +
          '<td><span style="background:rgba(67,233,123,0.12); color:#43e97b; padding:2px 8px; border-radius:20px; font-size:11px; font-weight:700;">' +
            (letters[q.correctAnswer] || '?') + '</span></td>' +
        '</tr>';
      }).join('');
    }
    if (noteEl) {
      noteEl.textContent = validQs.length > PREVIEW_LIMIT
        ? 'Showing ' + PREVIEW_LIMIT + ' of ' + validQs.length + ' valid questions. All ' + validQs.length + ' will be imported on confirmation.'
        : '';
    }
  }

  /* Rejected table */
  var rejEl  = document.getElementById('qmsRejectedPanel');
  var rejTbl = document.getElementById('qmsRejectedTable');
  var rejTtl = document.getElementById('qmsRejectedTitle');
  var rejected = preview.rejected || [];
  if (rejEl) {
    if (rejected.length) {
      rejEl.style.display = 'block';
      if (rejTtl) rejTtl.textContent = 'Rejected Questions (' + rejected.length + ')';
      if (rejTbl) {
        rejTbl.innerHTML = rejected.map(function (r, i) {
          return '<tr><td style="color:#ff6584; font-weight:700;">' + (i + 1) + '</td>' +
            '<td style="font-size:12px;">' + r.question.substring(0, 80) + '</td>' +
            '<td style="font-size:12px; color:#ffa500;">' + r.reason + '</td></tr>';
        }).join('');
      }
    } else {
      rejEl.style.display = 'none';
    }
  }

  /* Duplicates table */
  var dupEl  = document.getElementById('qmsDuplicatesPanel');
  var dupTbl = document.getElementById('qmsDuplicatesTable');
  var dupTtl = document.getElementById('qmsDuplicatesTitle');
  var dupes  = preview.duplicates || [];
  if (dupEl) {
    if (dupes.length) {
      dupEl.style.display = 'block';
      if (dupTtl) dupTtl.textContent = 'Duplicate Questions Skipped (' + dupes.length + ')';
      if (dupTbl) {
        dupTbl.innerHTML = dupes.map(function (d, i) {
          return '<tr><td style="color:#ffa500; font-weight:700;">' + (i + 1) + '</td>' +
            '<td style="font-size:12px;">' + d.question.substring(0, 80) + '</td>' +
            '<td style="font-size:12px; color:var(--text-muted);">' + d.reason + '</td></tr>';
        }).join('');
      }
    } else {
      dupEl.style.display = 'none';
    }
  }
}

/* ---- Confirm Import ---- */
async function qmsConfirmImport() {
  if (!_qmsPreviewData || !_qmsPreviewData.preview || !_qmsPreviewData.preview.valid.length) {
    instToast('No valid questions to import.', 'error');
    return;
  }

  var btn   = document.getElementById('qmsConfirmBtn');
  var count = _qmsPreviewData.preview.valid.length;

  if (!confirm('Import ' + count + ' question' + (count !== 1 ? 's' : '') + ' into the Question Bank?\n\nThis cannot be undone.')) {
    return;
  }

  if (btn) { btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:6px;"></span> Importing...'; btn.disabled = true; }

  var meta     = _qmsPreviewData.meta;
  var preview  = _qmsPreviewData.preview;

  var res = await qmsApi('/import/confirm', 'POST', {
    questions:        preview.valid,
    examType:         meta.examType,
    questionType:     meta.questionType,
    departmentId:     meta.departmentId,
    subjectId:        meta.subjectId,
    subjectName:      meta.subjectName,
    departmentName:   meta.departmentName,
    sourceType:       _qmsPreviewData.sourceType,
    originalFilename: _qmsPreviewData.filename,
    stats:            preview.stats
  });

  if (btn) { btn.innerHTML = '✅ Import ' + count + ' Questions'; btn.disabled = false; }

  if (res.ok) {
    instToast('✅ ' + res.data.imported + ' questions imported successfully!', 'success');
    /* Show success message and link to history */
    var confirmBtn = document.getElementById('qmsConfirmBtn');
    if (confirmBtn) confirmBtn.style.display = 'none';
    var titleEl = document.getElementById('qmsPreviewTitle');
    if (titleEl) {
      titleEl.innerHTML =
        '✅ Import Complete — <span style="color:#43e97b;">' + res.data.imported + ' questions added</span>' +
        ' &nbsp;·&nbsp; <button class="a-btn a-btn-secondary a-btn-sm" onclick="qmsSwitchTab(\'history\')">View History</button>';
    }
    _qmsPreviewData = null;
  } else {
    instToast(res.data.message || 'Import failed.', 'error');
  }
}

/* ---- Reset import form ---- */
function qmsReset() {
  var txt = document.getElementById('qmsPasteText');
  if (txt) txt.value = '';
  _qmsSelectedFile = null;
  _qmsPreviewData  = null;
  /* ✅ FIX: Reset type selector to objective on form reset */
  var typeSel = document.getElementById('qmsQuestionType');
  if (typeSel) { typeSel.value = 'objective'; }
  qmsOnTypeChange('objective');
  var lbl = document.getElementById('qmsFileLabel');
  if (lbl) lbl.textContent = 'Click to upload or drag and drop';
  var pp = document.getElementById('qmsPreviewPanel');
  if (pp) pp.style.display = 'none';
  var status = document.getElementById('qmsValidateStatus');
  if (status) status.textContent = '';
  var fileInput = document.getElementById('qmsFileInput');
  if (fileInput) fileInput.value = '';
}

/* ---- Load import history ---- */
async function qmsLoadHistory() {
  var tbody = document.getElementById('qmsHistoryTable');
  if (!tbody) { return; }
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:28px; color:var(--text-muted);">Loading...</td></tr>';

  var res = await qmsApi('/import/history?limit=30');
  if (!res.ok) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#ff6584; padding:20px;">' + (res.data.message || 'Failed to load.') + '</td></tr>';
    return;
  }

  var jobs = res.data.jobs || [];
  if (!jobs.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:32px; color:var(--text-muted);">No imports yet. Use the Import tab to add questions.</td></tr>';
    return;
  }

  var statusColors = { completed: '#43e97b', partial: '#ffa500', failed: '#ff6584', processing: '#a78bfa' };

  tbody.innerHTML = jobs.map(function (j) {
    var date       = new Date(j.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
    var timeStr    = new Date(j.createdAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
    var statusCol  = statusColors[j.status] || '#fff';
    var skipped    = (j.stats.duplicate || 0) + (j.stats.rejected || 0);
    return '<tr>' +
      '<td style="font-size:12px; color:var(--text-secondary);">' + date + '<br><span style="color:var(--text-muted); font-size:11px;">' + timeStr + '</span></td>' +
      '<td style="font-size:12px;">' + (j.importedBy || '—') + '</td>' +
      '<td><span style="font-size:11px; background:rgba(108,99,255,0.12); color:#a78bfa; padding:2px 8px; border-radius:20px; font-weight:700;">' + (j.examType || '—').toUpperCase() + '</span></td>' +
      '<td style="font-size:12px; color:var(--text-secondary);">' + (j.subjectName || '—') + '</td>' +
      '<td style="font-weight:700; color:#fff;">' + (j.stats.detected || 0) + '</td>' +
      '<td style="font-weight:700; color:#43e97b;">' + (j.stats.imported || 0) + '</td>' +
      '<td style="font-size:12px; color:#ffa500;">' + skipped + '</td>' +
      '<td><span style="font-size:11px; font-weight:700; color:' + statusCol + ';">' + (j.status || '—').toUpperCase() + '</span></td>' +
    '</tr>';
  }).join('');
}

/* ---- Load statistics ---- */
async function qmsLoadStats() {
  var el = document.getElementById('qmsStatsContent');
  if (!el) { return; }
  el.innerHTML = '<div style="text-align:center; padding:32px; color:var(--text-muted);">Loading...</div>';

  var res = await qmsApi('/stats');
  if (!res.ok) {
    el.innerHTML = '<div style="text-align:center; padding:40px; color:#ff6584;">' + (res.data.message || 'Failed to load.') + '</div>';
    return;
  }

  var s    = res.data.stats || {};
  var byET = s.byExamType   || {};
  var etCards = Object.keys(byET).map(function (et) {
    return '<div class="a-stat-card"><div class="a-stat-icon">📝</div><div>' +
      '<div class="a-stat-val">' + Number(byET[et]).toLocaleString() + '</div>' +
      '<div class="a-stat-lbl">' + et.toUpperCase() + '</div>' +
    '</div></div>';
  }).join('');

  el.innerHTML =
    '<div class="a-stats-grid" style="margin-bottom:20px;">' +
      '<div class="a-stat-card"><div class="a-stat-icon">📚</div>' +
        '<div><div class="a-stat-val">' + Number(s.total    || 0).toLocaleString() + '</div><div class="a-stat-lbl">Total Questions</div></div></div>' +
      '<div class="a-stat-card"><div class="a-stat-icon" style="background:rgba(67,233,123,0.1);">✅</div>' +
        '<div><div class="a-stat-val">' + Number(s.approved || 0).toLocaleString() + '</div><div class="a-stat-lbl">Approved</div></div></div>' +
      '<div class="a-stat-card"><div class="a-stat-icon" style="background:rgba(255,165,0,0.1);">⏳</div>' +
        '<div><div class="a-stat-val">' + Number(s.pending  || 0).toLocaleString() + '</div><div class="a-stat-lbl">Pending Review</div></div></div>' +
      '<div class="a-stat-card"><div class="a-stat-icon" style="background:rgba(255,101,132,0.1);">📋</div>' +
        '<div><div class="a-stat-val">' + Number(s.totalJobs|| 0).toLocaleString() + '</div><div class="a-stat-lbl">Import Jobs</div></div></div>' +
    '</div>' +
    (Object.keys(byET).length
      ? '<div style="margin-bottom:8px; font-size:13px; font-weight:700; color:var(--text-secondary); ' +
          'text-transform:uppercase; letter-spacing:0.5px;">Approved by Exam Type</div>' +
        '<div style="display:grid; grid-template-columns:repeat(5,1fr); gap:12px; margin-bottom:4px;">' +
          etCards + '</div>'
      : '');

  /* Load advanced analytics after summary */
  qmsLoadAdvancedStats();
  qmsLoadTags();
}

/* ---- Advanced analytics (charts) ---- */
async function qmsLoadAdvancedStats() {
  var chartIds = [
    'qmsImportTrendChart', 'qmsTopSubjectsChart',
    'qmsDiffDistChart',    'qmsYearDistChart', 'qmsSourceDistChart'
  ];

  var emptyMsg = '<div style="color:var(--text-muted); font-size:13px; text-align:center; padding:16px;">No data yet. Charts will populate as questions are imported.</div>';
  var errMsg   = function (msg) {
    return '<div style="color:var(--text-muted); font-size:12px; text-align:center; padding:12px;">' +
      '⚠️ ' + (msg || 'Could not load chart data.') + '</div>';
  };

  var res = await qmsApi('/analytics');
  if (!res.ok) {
    chartIds.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = errMsg(res.data.message || 'Analytics endpoint returned an error.');
    });
    return;
  }

  var a = res.data.analytics || {};

  /* Wrap each render individually — one chart error must not block others */
  function safeRender(fn, id, data) {
    try { fn(data); }
    catch (e) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = errMsg('Render error: ' + e.message);
      console.warn('[QMS Analytics] render error in', id, ':', e.message);
    }
  }

  safeRender(renderImportTrendChart, 'qmsImportTrendChart', a.importTrend  || []);
  safeRender(renderTopSubjectsChart, 'qmsTopSubjectsChart', a.topSubjects  || []);
  safeRender(renderDiffDistChart,    'qmsDiffDistChart',    a.diffDist     || {});
  safeRender(renderYearDistChart,    'qmsYearDistChart',    a.yearDist     || []);
  safeRender(renderSourceDistChart,  'qmsSourceDistChart',  a.sourceDist   || []);
}

function renderImportTrendChart(trend) {
  var el = document.getElementById('qmsImportTrendChart');
  if (!el) { return; }
  if (!trend.length) { el.innerHTML = '<div style="color:var(--text-muted); font-size:13px; text-align:center;">No import activity in the last 30 days.</div>'; return; }

  var maxImported = Math.max(1, Math.max.apply(null, trend.map(function (d) { return d.imported; })));

  el.innerHTML =
    '<div style="display:flex; align-items:flex-end; gap:3px; height:100px; overflow-x:auto; padding-bottom:6px;">' +
    trend.map(function (d) {
      var h    = Math.max(2, Math.round((d.imported / maxImported) * 90));
      var date = d.date.substring(5); /* MM-DD */
      var isToday = d.date === new Date().toISOString().substring(0, 10);
      return '<div style="display:flex; flex-direction:column; align-items:center; gap:3px; flex:1; min-width:14px;" title="' + d.date + ': ' + d.imported + ' imported">' +
        '<div style="font-size:9px; color:var(--text-muted); white-space:nowrap; writing-mode:vertical-rl; transform:rotate(180deg); max-height:32px; overflow:hidden;">' +
          (d.imported > 0 ? d.imported : '') +
        '</div>' +
        '<div style="width:100%; height:' + h + 'px; border-radius:3px 3px 0 0; background:' +
          (isToday ? 'linear-gradient(180deg,#43e97b,#38f9d7)' : 'rgba(108,99,255,0.5)') + ';' +
          'min-height:2px;"></div>' +
      '</div>';
    }).join('') +
    '</div>' +
    '<div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-muted); margin-top:4px; padding:0 2px;">' +
      '<span>' + trend[0].date.substring(5) + '</span>' +
      '<span>' + trend[trend.length - 1].date.substring(5) + '</span>' +
    '</div>';
}

function renderTopSubjectsChart(subjects) {
  var el = document.getElementById('qmsTopSubjectsChart');
  if (!el) { return; }
  if (!subjects.length) { el.innerHTML = '<div style="color:var(--text-muted); font-size:13px; text-align:center;">No data yet.</div>'; return; }

  var maxCount = Math.max(1, subjects[0].count);
  el.innerHTML = subjects.map(function (s, i) {
    var pct    = Math.round((s.count / maxCount) * 100);
    var color  = i < 3 ? '#43e97b' : i < 6 ? '#6c63ff' : '#a0a0c0';
    return '<div style="margin-bottom:10px;">' +
      '<div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">' +
        '<span style="color:#fff; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:65%;">' + esc(s.subjectName) + '</span>' +
        '<span style="color:' + color + '; font-weight:700;">' + s.count.toLocaleString() + '</span>' +
      '</div>' +
      '<div style="background:rgba(255,255,255,0.06); border-radius:20px; height:7px;">' +
        '<div style="background:' + color + '; width:' + pct + '%; height:100%; border-radius:20px; transition:width 0.6s ease;"></div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function renderDiffDistChart(diff) {
  var el = document.getElementById('qmsDiffDistChart');
  if (!el) { return; }
  var total = (diff.easy || 0) + (diff.medium || 0) + (diff.hard || 0) + (diff.mixed || 0) || 1;
  var rows  = [
    { label:'Easy',   val: diff.easy   || 0, color:'#43e97b' },
    { label:'Medium', val: diff.medium || 0, color:'#ffa500' },
    { label:'Hard',   val: diff.hard   || 0, color:'#ff6584' },
    { label:'Mixed',  val: diff.mixed  || 0, color:'#a78bfa' }
  ];
  el.innerHTML = rows.map(function (r) {
    var pct = Math.round((r.val / total) * 100);
    return '<div style="margin-bottom:14px;">' +
      '<div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:6px;">' +
        '<span style="font-weight:700; color:' + r.color + ';">' + r.label + '</span>' +
        '<span style="color:#fff; font-weight:700;">' + r.val.toLocaleString() + ' &nbsp;<span style="color:var(--text-muted); font-size:11px;">(' + pct + '%)</span></span>' +
      '</div>' +
      '<div style="background:rgba(255,255,255,0.06); border-radius:20px; height:10px;">' +
        '<div style="background:' + r.color + '; width:' + pct + '%; height:100%; border-radius:20px;"></div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function renderYearDistChart(yearDist) {
  var el = document.getElementById('qmsYearDistChart');
  if (!el) { return; }
  if (!yearDist.length) { el.innerHTML = '<div style="color:var(--text-muted); font-size:13px; text-align:center;">No year data available.</div>'; return; }

  var maxCount = Math.max(1, Math.max.apply(null, yearDist.map(function (y) { return y.count; })));
  el.innerHTML =
    '<div style="display:flex; align-items:flex-end; gap:4px; height:90px; overflow-x:auto;">' +
    yearDist.map(function (y) {
      var h = Math.max(4, Math.round((y.count / maxCount) * 80));
      return '<div style="display:flex; flex-direction:column; align-items:center; gap:2px; flex:0 0 auto; min-width:28px;" title="' + y.year + ': ' + y.count + ' questions">' +
        '<div style="font-size:10px; color:var(--text-muted);">' + y.count + '</div>' +
        '<div style="width:22px; height:' + h + 'px; background:rgba(108,99,255,0.6); border-radius:3px 3px 0 0;"></div>' +
        '<div style="font-size:10px; color:var(--text-muted); white-space:nowrap;">' + y.year + '</div>' +
      '</div>';
    }).join('') +
    '</div>';
}

function renderSourceDistChart(sources) {
  var el = document.getElementById('qmsSourceDistChart');
  if (!el) { return; }
  if (!sources.length) { el.innerHTML = '<div style="color:var(--text-muted); font-size:13px; text-align:center;">No import source data yet.</div>'; return; }

  var icons   = { paste:'📋', txt:'📄', csv:'📊', xlsx:'📊', docx:'📝' };
  var maxImported = Math.max(1, Math.max.apply(null, sources.map(function (s) { return s.imported; })));

  el.innerHTML = sources.map(function (s) {
    var icon = icons[s._id] || '📁';
    var pct  = Math.round((s.imported / maxImported) * 100);
    return '<div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">' +
      '<div style="font-size:20px; width:28px; text-align:center; flex-shrink:0;">' + icon + '</div>' +
      '<div style="flex:1;">' +
        '<div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">' +
          '<span style="font-weight:700; color:#fff; text-transform:uppercase;">' + esc(s._id || 'Unknown') + '</span>' +
          '<span style="color:var(--text-secondary);">' + s.imported.toLocaleString() + ' questions · ' + s.jobs + ' job' + (s.jobs !== 1 ? 's' : '') + '</span>' +
        '</div>' +
        '<div style="background:rgba(255,255,255,0.06); border-radius:20px; height:6px;">' +
          '<div style="background:#6c63ff; width:' + pct + '%; height:100%; border-radius:20px;"></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

/* ---- Tag Manager ---- */
async function qmsLoadTags() {
  var cloudEl  = document.getElementById('qmsTagCloud');
  var filterEl = document.getElementById('qmsTagFilterExam');
  var examType = filterEl ? filterEl.value : '';
  if (!cloudEl) { return; }
  cloudEl.innerHTML = '<div style="color:var(--text-muted); font-size:13px;">Loading...</div>';

  var qs  = examType ? '?examType=' + examType : '';
  var res = await qmsApi('/tags' + qs);
  if (!res.ok) { cloudEl.innerHTML = '<div style="color:#ff6584; font-size:13px;">Failed to load tags.</div>'; return; }

  var topics = res.data.topics || [];
  if (!topics.length) {
    cloudEl.innerHTML =
      '<div style="color:var(--text-muted); font-size:13px; padding:8px 0; line-height:1.8;">' +
        '<strong style="color:var(--text-secondary,#a0a0c0);">No topics yet.</strong> Topics appear here when questions have a topic assigned.<br>' +
        '<span style="font-size:12px;">To add topics: ' +
          '① Add a <code style="background:rgba(255,255,255,0.06); padding:1px 5px; border-radius:4px;">topic</code> column to your CSV/XLSX import file, ' +
          '② or edit individual questions in the Question Bank and fill in the Topic field, ' +
          '③ or use Bulk Tag to assign topics to selected questions.' +
        '</span>' +
      '</div>';
    qmsPopulateTopicFilter([]);
    return;
  }

  /* Render tag cloud with size variation */
  var maxCount = topics[0].count || 1;
  cloudEl.innerHTML = topics.map(function (t) {
    var size  = 11 + Math.round((t.count / maxCount) * 6);
    var alpha = 0.1 + (t.count / maxCount) * 0.25;
    return '<button onclick="qmsFilterByTopic(\'' + esc(t.topic).replace(/'/g, "\\'") + '\')" ' +
      'title="' + t.count + ' questions" ' +
      'style="padding:5px 12px; border-radius:20px; font-size:' + size + 'px; font-weight:700; cursor:pointer; ' +
      'font-family:inherit; background:rgba(108,99,255,' + alpha.toFixed(2) + '); ' +
      'border:1px solid rgba(108,99,255,0.3); color:#a78bfa; transition:all 0.15s;">' +
      esc(t.topic) + ' <span style="font-size:10px; opacity:0.7;">(' + t.count + ')</span>' +
    '</button>';
  }).join('');

  qmsPopulateTopicFilter(topics);
}

/* Populate topic dropdown in bank filter */
function qmsPopulateTopicFilter(topics) {
  var sel = document.getElementById('qmsBankFilterTopic');
  if (!sel) { return; }
  var current = sel.value;
  sel.innerHTML = '<option value="">All Topics</option>' +
    topics.map(function (t) {
      return '<option value="' + esc(t.topic) + '">' + esc(t.topic) + ' (' + t.count + ')</option>';
    }).join('');
  if (current) { sel.value = current; }
}

/* Click topic chip → jump to bank tab filtered by that topic */
function qmsFilterByTopic(topic) {
  qmsSwitchTab('bank');
  var topicSel = document.getElementById('qmsBankFilterTopic');
  if (topicSel) { topicSel.value = topic; }
  qmsBankLoad(1);
}


/* ============================================================
   ✅ STEP 2 FIX — QMS QUESTION TYPE SELECTOR (ROBUST VERSION)

   PRIMARY FIX: The type selector must exist before qmsPreview()
   reads it via qmsGetMeta(). Previously, if the injection failed
   (element not found), qmsGetMeta() returned 'objective' always.

   This version:
   1. Targets qmsPanelImport (always exists when QMS section opens)
   2. Updates _qmsCurrentQType module variable on every change
   3. Injects a complete theory/objective UI switcher
   4. Shows/hides a theory-specific paste guide when type changes
============================================================ */
function _qmsEnsureTypeSelector() {
  if (document.getElementById('qmsQuestionType')) { return; }

  /* ✅ FIX: Walk up from a known always-present child element.
     qmsValidateBtn is rendered by admin.html directly (not dynamically)
     so it is reliably in the DOM once the import tab is first opened.
     We insert before the validate button's closest section ancestor. */
  var anchor = document.getElementById('qmsValidateBtn') ||
               document.getElementById('qmsBtnPaste')    ||
               document.getElementById('qmsPasteArea');

  if (!anchor) {
    console.warn('[QMS] Type selector: anchor element not found — will retry.');
    return;
  }

  /* Find the nearest container that is a direct child of the panel
     (not a grandchild) so our wrapper appears at the top level */
  var panel = anchor.parentNode;
  /* Walk up maximum 4 levels looking for the panel div */
  for (var up = 0; up < 4 && panel && panel.tagName !== 'SECTION'; up++) {
    if (panel.id && panel.id.indexOf('Panel') !== -1) { break; }
    if (panel.id && panel.id.indexOf('panel') !== -1) { break; }
    panel = panel.parentNode;
  }
  if (!panel) { panel = anchor.parentNode; }

  var wrapper = document.createElement('div');
  wrapper.id  = '_qmsTypeSelectorWrap';
  wrapper.innerHTML =
    '<div style="' +
      'display:flex; align-items:flex-start; gap:16px; flex-wrap:wrap;' +
      'background:rgba(255,255,255,0.02);' +
      'border:1px solid var(--border,rgba(255,255,255,0.08));' +
      'border-radius:12px; padding:16px 18px; margin-bottom:18px;' +
    '">' +
      '<div style="flex:0 0 auto;">' +
        '<div style="' +
          'font-size:11px; font-weight:700;' +
          'color:var(--text-muted,#6b6b8a);' +
          'text-transform:uppercase; letter-spacing:0.4px; margin-bottom:8px;' +
        '">Question Type</div>' +
        '<select id="qmsQuestionType" onchange="qmsOnTypeChange(this.value)" ' +
          'style="' +
            'background:rgba(255,255,255,0.04);' +
            'border:1px solid var(--border,rgba(255,255,255,0.08));' +
            'border-radius:8px; padding:10px 14px;' +
            'color:#fff; font-size:14px; font-family:inherit;' +
            'outline:none; min-width:230px; cursor:pointer;' +
          '">' +
          '<option value="objective">🔘 Objective / MCQ</option>' +
          '<option value="theory">📝 Theory / Essay</option>' +
        '</select>' +
      '</div>' +
      '<div id="qmsTypeHintEl" style="' +
        'flex:1; font-size:12px;' +
        'color:var(--text-secondary,#a0a0c0);' +
        'line-height:1.7; padding-top:24px;' +
      '"></div>' +
    '</div>' +

    /* ✅ Theory-specific format guide — shown only in theory mode */
    '<div id="qmsTheoryGuideEl" style="' +
      'display:none;' +
      'background:rgba(108,99,255,0.06);' +
      'border:1px solid rgba(108,99,255,0.2);' +
      'border-radius:10px; padding:14px 16px;' +
      'font-size:12px; color:var(--text-secondary,#a0a0c0);' +
      'line-height:1.8; margin-bottom:14px;' +
    '">' +
      '<div style="font-weight:700; color:#a78bfa; margin-bottom:8px;">📐 Theory Paste Format</div>' +
      'Separate questions using <strong style="color:#fff;">QUESTION N</strong> headers, ' +
      '<code style="background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:3px;">---</code> ' +
      'dividers, or double blank lines. ' +
      'Include a <strong style="color:#fff;">DETAILED SOLUTION &amp; MARKING SCHEME</strong> ' +
      'section for model answers. <code style="background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:3px;">ModelAnswer: ...</code> ' +
      'also works inline.<br>' +
      '<span style="color:#43e97b;">✓ No A/B/C/D options needed. No correct-answer index needed.</span><br>' +
      '<strong style="color:#fff;">Example:</strong><br>' +
      '<code style="background:rgba(0,0,0,0.3);display:block;padding:8px 10px;border-radius:6px;white-space:pre;font-size:11px;margin-top:6px;">' +
        'QUESTION 1 [8 MARKS]\n\n' +
        '(a) Without using tables, evaluate:\n' +
        '    (log 27 + log 8 - log 125) / (log 6 - log 5)\n\n' +
        '(b) A trader bought oranges at ₦1,200 per dozen.\n' +
        '    Calculate her percentage profit.\n\n' +
        'DETAILED SOLUTION &amp; MARKING SCHEME\n\n' +
        '(a) = log(27×8/125) / log(6/5) = 3  [M1][A1]\n' +
        '(b) Profit = 400/1200 × 100 = 33.3%  [M1][A1]\n\n' +
        'QUESTION 2 [5 MARKS]\n\n' +
        '(a) Solve: 2x² - 7x + 3 = 0\n\n' +
        'DETAILED SOLUTION &amp; MARKING SCHEME\n\n' +
        '(a) x = 3 or x = ½              [A1]' +
      '</code>' +
    '</div>';

  /* Prepend to panel so it appears at the very top */
  panel.insertBefore(wrapper, panel.firstChild);

  /* Apply initial state */
  qmsOnTypeChange('objective');
}

window.qmsOnTypeChange = function(type) {
  /* ✅ STEP 2 FIX: Always update the module variable FIRST.
     This is the safety net: even if qmsGetMeta() is called before
     the DOM element is read, _qmsCurrentQType has the correct value. */
  _qmsCurrentQType = type || 'objective';

  var hintEl   = document.getElementById('qmsTypeHintEl');
  var guideEl  = document.getElementById('qmsTheoryGuideEl');
  var textArea = document.getElementById('qmsPasteText');
  var btnFile  = document.getElementById('qmsBtnFile');

  if (type === 'theory') {
    if (hintEl) {
      hintEl.innerHTML =
        '<span style="color:#a78bfa; font-weight:700;">📝 Theory / Essay mode.</span><br>' +
        'Questions split on QUESTION N headers, <code style="background:rgba(255,255,255,0.08);padding:1px 4px;border-radius:3px;">---</code> separators, or blank lines.<br>' +
        'See format guide below. No options or correct-answer required.';
    }
    if (guideEl)  { guideEl.style.display  = 'block'; }
    if (textArea) {
      textArea.placeholder =
        'QUESTION 1 [8 MARKS]\n\n' +
        '(a) Without using mathematical tables, evaluate:\n' +
        '    (log₁₀ 27 + log₁₀ 8 - log₁₀ 125) ÷ (log₁₀ 6 - log₁₀ 5)\n\n' +
        '(b) A trader bought oranges at ₦1,200 per dozen...\n\n' +
        'DETAILED SOLUTION & MARKING SCHEME\n\n' +
        '(a) LHS = log(27×8/125) / log(6/5) = 3    [M1][A1]\n' +
        '(b) Selling price per dozen = 3 × 500 = ₦1,500\n' +
        '    Profit % = (300/1200) × 100 = 25%      [M1][A1]\n\n' +
        'QUESTION 2 [8 MARKS]\n\n' +
        '(a) Solve 2x² - 7x + 3 = 0 by completing the square.\n\n' +
        'DETAILED SOLUTION & MARKING SCHEME\n\n' +
        '(a) x = 3 or x = ½                         [A1]';
    }
  } else {
    if (hintEl) {
      hintEl.innerHTML =
        '<span style="color:#a78bfa; font-weight:700;">🔘 Objective / MCQ mode.</span><br>' +
        'Each question needs options A/B/C/D and a correct answer.<br>' +
        'Separate questions with a blank line.';
    }
    if (guideEl)  { guideEl.style.display  = 'none'; }
    if (textArea) {
      textArea.placeholder =
        '1. What is the capital of Nigeria?\n' +
        'A. Lagos\nB. Abuja\nC. Kano\nD. Ibadan\n' +
        'Answer: B\n\n' +
        '2. What is 2 + 2?\n' +
        'A. 3\nB. 4\nC. 5\n' +
        'Answer: B';
    }
  }

  /* Reset preview when type changes */
  _qmsPreviewData = null;
  var pp = document.getElementById('qmsPreviewPanel');
  if (pp) { pp.style.display = 'none'; }
};


window.qmsOnTypeChange = function(type) {
  /* ✅ FIX: Update module-level variable FIRST — this is the safety net */
  _qmsCurrentQType = type || 'objective';

  var hintEl    = document.getElementById('qmsTypeHintEl');
  var guideEl   = document.getElementById('qmsTheoryGuideEl');
  var textArea  = document.getElementById('qmsPasteText');

  /* ✅ FIX: Show/hide a theory-specific instruction banner that appears
     between the type selector and the paste/file controls.
     This makes it visually obvious the mode has changed. */
  var theoryBanner = document.getElementById('_qmsTheoryBannerEl');
  if (!theoryBanner) {
    theoryBanner = document.createElement('div');
    theoryBanner.id = '_qmsTheoryBannerEl';
    theoryBanner.style.cssText =
      'margin-bottom:14px; padding:12px 16px; ' +
      'background:rgba(255,165,0,0.07); ' +
      'border:1px solid rgba(255,165,0,0.25); ' +
      'border-radius:10px; font-size:13px; ' +
      'color:#ffa500; line-height:1.7; display:none;';
    theoryBanner.innerHTML =
      '<strong style="color:#fff;">📝 THEORY / ESSAY MODE ACTIVE</strong><br>' +
      'Options A/B/C/D and correct-answer fields are NOT required for theory.<br>' +
      'Each question must start with <code style="background:rgba(255,255,255,0.1);' +
      'padding:1px 5px;border-radius:3px;">QUESTION N</code> or be separated by ' +
      '<code style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:3px;">---</code>.<br>' +
      'The <strong style="color:#fff;">DETAILED SOLUTION &amp; MARKING SCHEME</strong> ' +
      'section is stored as the model answer — never sent to students.';
    /* Insert after the type selector wrapper */
    var selectorWrap = document.getElementById('_qmsTypeSelectorWrap');
    if (selectorWrap && selectorWrap.parentNode) {
      selectorWrap.parentNode.insertBefore(theoryBanner, selectorWrap.nextSibling);
    } else if (textArea && textArea.parentNode) {
      textArea.parentNode.insertBefore(theoryBanner, textArea);
    }
  }

  if (type === 'theory') {
    /* Show theory banner */
    if (theoryBanner) { theoryBanner.style.display = 'block'; }
    if (hintEl) {
      hintEl.innerHTML =
        '<span style="color:#ffa500; font-weight:700;">📝 Theory / Essay mode.</span><br>' +
        'Paste your WAEC/NECO-style questions below. Each question block ' +
        'starting with <strong>QUESTION N</strong> becomes one Question Bank record.<br>' +
        '<span style="color:#43e97b;">No A/B/C/D or correct-answer required.</span>';
    }
    if (guideEl)  { guideEl.style.display = 'block'; }
    if (textArea) {
      textArea.placeholder =
        'QUESTION 1 [8 MARKS]\n\n' +
        '(a) Without using mathematical tables, evaluate:\n' +
        '    (log₁₀ 27 + log₁₀ 8 − log₁₀ 125) ÷ (log₁₀ 6 − log₁₀ 5)\n\n' +
        '(b) A trader bought oranges at ₦1,200 per dozen and sold them\n' +
        '    in packs of 4 at ₦500 per pack. Calculate her % profit.\n\n' +
        'DETAILED SOLUTION & MARKING SCHEME\n\n' +
        '(a) = log(27×8/125) / log(6/5) = log(1000) / log(1.2)\n' +
        '    = 3 / log(6/5)    [M1]   = 3 / 0.07918 = 3  [A1]\n\n' +
        '(b) Selling price per dozen = 3 × ₦500 = ₦1,500\n' +
        '    Profit = ₦300; Profit % = (300/1200)×100 = 25%   [A1]\n\n' +
        'QUESTION 2 [10 MARKS]\n\n' +
        '(a) Make T the subject of the formula: P = √[R(T−t)/m]\n\n' +
        'DETAILED SOLUTION & MARKING SCHEME\n\n' +
        '(a) P² = R(T−t)/m  → T = mP²/R + t   [M1][A1]';
    }
  } else {
    /* Hide theory banner, restore objective mode */
    if (theoryBanner) { theoryBanner.style.display = 'none'; }
    if (hintEl) {
      hintEl.innerHTML =
        '<span style="color:#a78bfa; font-weight:700;">🔘 Objective / MCQ mode.</span><br>' +
        'Each question requires options A/B/C/D and a correct answer. ' +
        'Separate questions with a blank line.';
    }
    if (guideEl)  { guideEl.style.display = 'none'; }
    if (textArea) {
      textArea.placeholder =
        '1. What is the capital of Nigeria?\nA. Lagos\nB. Abuja\nC. Kano\nD. Ibadan\nAnswer: B\n\n' +
        '2. What is 2 + 2?\nA. 3\nB. 4\nC. 5\nD. 6\nAnswer: B';
    }
  }

  /* Reset preview when type changes — avoids stale objective
     preview being displayed after switching to theory */
  _qmsPreviewData = null;
  var pp = document.getElementById('qmsPreviewPanel');
  if (pp) { pp.style.display = 'none'; }
  var confBtn = document.getElementById('qmsConfirmBtn');
  if (confBtn) { confBtn.style.display = 'none'; }
};

/* ============================================================
   QMS PHASE 2 — QUESTION BANK
============================================================ */

var _qmsBankPage          = 1;
var _qmsBankTotal         = 0;
var _qmsBankSelected      = {}; /* { id: true } */
var _qmsBankSearchTimer   = null;
var _qmsBankSubjectId     = null; /* set when navigated from CBT Management */
var _qmsBankSubjectLabel  = '';

/* ---- Debounced search ---- */
function qmsBankDebounceSearch() {
  if (_qmsBankSearchTimer) { clearTimeout(_qmsBankSearchTimer); }
  _qmsBankSearchTimer = setTimeout(function () { qmsBankLoad(1); }, 380);
}

/* ---- Build query string from filter controls ---- */
function qmsBankBuildQs(page) {
  var search    = ((document.getElementById('qmsBankSearch')       || {}).value || '').trim();
  var exam      = (document.getElementById('qmsBankFilterExam')    || {}).value || '';
  var status    = (document.getElementById('qmsBankFilterStatus')  || {}).value || '';
  var diff      = (document.getElementById('qmsBankFilterDiff')    || {}).value || '';
  /* ✅ PHASE 5: year range + topic */
  var yearFrom  = ((document.getElementById('qmsBankYearFrom')     || {}).value || '').trim();
  var yearTo    = ((document.getElementById('qmsBankYearTo')       || {}).value || '').trim();
  var topic     = (document.getElementById('qmsBankFilterTopic')   || {}).value || '';

  var qs = '?page=' + (page || 1) + '&limit=25';
  if (search)            qs += '&search='     + encodeURIComponent(search);
  if (exam)              qs += '&examType='   + exam;
  if (status)            qs += '&status='     + status;
  if (diff)              qs += '&difficulty=' + diff;
  if (topic)             qs += '&search='     + encodeURIComponent(topic);
  if (yearFrom)          qs += '&yearFrom='   + yearFrom;
  if (yearTo)            qs += '&yearTo='     + yearTo;
  if (_qmsBankSubjectId) qs += '&subjectId='  + _qmsBankSubjectId;
  return qs;
}

/* ---- Load / reload the Question Bank table ---- */
/* ---- Set subject filter from CBT Management ---- */
function qmsBankFilterBySubject(subjectId, subjectLabel) {
  _qmsBankSubjectId    = subjectId;
  _qmsBankSubjectLabel = subjectLabel;
  var banner = document.getElementById('qmsBankSubjectBanner');
  var label  = document.getElementById('qmsBankSubjectLabel');
  if (banner) banner.style.display = _qmsBankSubjectId ? 'flex' : 'none';
  if (label)  label.textContent    = subjectLabel || '';
}

/* ---- Clear subject filter ---- */
function qmsBankClearSubjectFilter() {
  _qmsBankSubjectId    = null;
  _qmsBankSubjectLabel = '';
  var banner = document.getElementById('qmsBankSubjectBanner');
  if (banner) banner.style.display = 'none';
  qmsBankLoad(1);
}

async function qmsBankLoad(page) {
  _qmsBankPage     = page || 1;
  _qmsBankSelected = {};
  qmsUpdateBulkBar();
  /* Sync subject banner visibility */
  var banner = document.getElementById('qmsBankSubjectBanner');
  if (banner) banner.style.display = _qmsBankSubjectId ? 'flex' : 'none';

  var tbody = document.getElementById('qmsBankBody');
  if (!tbody) { return; }
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:28px; color:var(--text-muted);"><span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,0.2);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:8px;"></span>Loading...</td></tr>';

  var res = await qmsApi('/bank' + qmsBankBuildQs(_qmsBankPage));
  if (!res.ok) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#ff6584; padding:24px;">' + (res.data.message || 'Failed to load.') + '</td></tr>';
    return;
  }

  var questions = res.data.questions || [];
  _qmsBankTotal = res.data.total || 0;

  var titleEl = document.getElementById('qmsBankTitle');
  if (titleEl) titleEl.textContent = 'Question Bank (' + _qmsBankTotal.toLocaleString() + ' questions)';

  var statusColors = {
    approved:       '#43e97b',
    pending_review: '#ffa500',
    archived:       '#a0a0c0',
    draft:          '#a78bfa',
    deleted:        '#ff6584'
  };

  if (!questions.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:36px; color:var(--text-muted);">' +
      'No questions found. Adjust filters or import questions using the Import tab.' +
    '</td></tr>';
  } else {
    var letters = ['A', 'B', 'C', 'D'];
    tbody.innerHTML = questions.map(function (q) {
      var optPreview = (q.options || []).map(function (o, idx) {
        return '<span style="font-size:10px; padding:1px 5px; border-radius:3px; margin-right:2px; background:' +
          (idx === q.correctAnswer ? 'rgba(67,233,123,0.15)' : 'rgba(255,255,255,0.04)') + '; color:' +
          (idx === q.correctAnswer ? '#43e97b' : 'var(--text-secondary)') + ';">' +
          (letters[idx] || idx) + ': ' + o.substring(0, 18) + (o.length > 18 ? '…' : '') +
          (idx === q.correctAnswer ? '✓' : '') + '</span>';
      }).join('');
      var statColor  = statusColors[q.status] || '#fff';
      var safeId     = (q._id || '').toString();
      var safeName   = (q.question || '').replace(/'/g, "&#39;").substring(0, 40);
      var isChecked  = _qmsBankSelected[safeId] ? 'checked' : '';
      return '<tr id="qmsBankRow-' + safeId + '">' +
        '<td><input type="checkbox" ' + isChecked + ' onchange="qmsToggleRow(\'' + safeId + '\',this)" style="accent-color:#6c63ff;" /></td>' +
        '<td style="font-size:11px; font-family:monospace; color:#a78bfa; white-space:nowrap;">' + (q.questionId || '—') + '</td>' +
        '<td style="max-width:280px;">' +
          '<div style="font-size:13px; font-weight:600; color:#fff; margin-bottom:4px; line-height:1.4;">' +
            q.question.substring(0, 90) + (q.question.length > 90 ? '…' : '') +
          '</div>' +
          '<div>' + optPreview + '</div>' +
          (q.topic ? '<div style="font-size:11px; color:var(--text-muted); margin-top:3px;">📌 ' + q.topic + '</div>' : '') +
        '</td>' +
        '<td style="font-size:12px; color:var(--text-secondary);">' + (q.subjectName || '—') + '</td>' +
        '<td><span style="font-size:11px; font-weight:700; background:rgba(108,99,255,0.12); color:#a78bfa; padding:2px 8px; border-radius:20px;">' +
          (q.examType || '').toUpperCase() + '</span></td>' +
        '<td style="font-size:12px; color:var(--text-secondary); text-transform:capitalize;">' + (q.difficulty || '—') + '</td>' +
        '<td><span style="font-size:11px; font-weight:700; color:' + statColor + ';">' + (q.status || '—').replace('_',' ').toUpperCase() + '</span></td>' +
        '<td><div style="display:flex; gap:5px; flex-wrap:wrap;">' +
          '<button class="a-btn a-btn-secondary a-btn-sm" onclick="qmsOpenEdit(\'' + safeId + '\')">✏ Edit</button>' +
          '<button class="a-btn a-btn-secondary a-btn-sm" onclick="qmsViewVersions(\'' + safeId + '\')">📜</button>' +
          '<button class="a-btn a-btn-danger a-btn-sm" onclick="qmsSoftDelete(\'' + safeId + '\',\'' + safeName + '\')">🗑</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');
  }

  /* Pagination */
  var pages  = res.data.pages || 1;
  var pagDiv = document.getElementById('qmsBankPagination');
  if (pagDiv) {
    if (pages > 1) {
      var btns = '';
      var start = Math.max(1, _qmsBankPage - 3);
      var end   = Math.min(pages, _qmsBankPage + 3);
      if (start > 1) btns += '<button class="a-btn a-btn-secondary a-btn-sm" onclick="qmsBankLoad(1)">« 1</button>';
      for (var p = start; p <= end; p++) {
        btns += '<button class="a-btn a-btn-sm ' + (p === _qmsBankPage ? 'a-btn-primary' : 'a-btn-secondary') + '" onclick="qmsBankLoad(' + p + ')">' + p + '</button>';
      }
      if (end < pages) btns += '<button class="a-btn a-btn-secondary a-btn-sm" onclick="qmsBankLoad(' + pages + ')">' + pages + ' »</button>';
      pagDiv.innerHTML = btns;
      pagDiv.style.display = 'flex';
    } else {
      pagDiv.style.display = 'none';
    }
  }
}

/* ---- Selection management ---- */
function qmsToggleRow(id, cb) {
  if (cb.checked) { _qmsBankSelected[id] = true; }
  else            { delete _qmsBankSelected[id]; }
  qmsUpdateBulkBar();
}

function qmsToggleSelectAll(masterCb) {
  var cbs = document.querySelectorAll('#qmsBankBody input[type="checkbox"]');
  cbs.forEach(function (cb) {
    var row = cb.closest('tr');
    var id  = row ? row.id.replace('qmsBankRow-', '') : '';
    cb.checked = masterCb.checked;
    if (masterCb.checked && id) { _qmsBankSelected[id] = true; }
    else if (id)                { delete _qmsBankSelected[id]; }
  });
  qmsUpdateBulkBar();
}

function qmsClearSelection() {
  _qmsBankSelected = {};
  document.querySelectorAll('#qmsBankBody input[type="checkbox"]').forEach(function (cb) { cb.checked = false; });
  var master = document.getElementById('qmsSelectAll');
  if (master) master.checked = false;
  qmsUpdateBulkBar();
}

function qmsUpdateBulkBar() {
  var count  = Object.keys(_qmsBankSelected).length;
  var bar    = document.getElementById('qmsBulkBar');
  var countEl = document.getElementById('qmsBulkCount');
  if (!bar) { return; }
  if (count > 0) {
    bar.style.display = 'flex';
    if (countEl) countEl.textContent = count + ' question' + (count !== 1 ? 's' : '') + ' selected';
  } else {
    bar.style.display = 'none';
  }
}

/* ---- Bulk operations ---- */
async function qmsBulkOp(operation) {
  var ids    = Object.keys(_qmsBankSelected);
  var count  = ids.length;
  if (!count) { instToast('No questions selected.', 'error'); return; }

  var opLabels = { approve:'Approve', archive:'Archive', delete:'Delete', restore:'Restore' };
  var opLabel  = opLabels[operation] || operation;

  if (!confirm(opLabel + ' ' + count + ' selected question' + (count !== 1 ? 's' : '') + '?')) { return; }

  var res = await qmsApi('/bank/bulk', 'POST', { operation: operation, ids: ids });
  if (res.ok) {
    instToast(res.data.message, 'success');
    qmsClearSelection();
    qmsBankLoad(_qmsBankPage);
  } else {
    instToast(res.data.message || 'Bulk operation failed.', 'error');
  }
}

/* ---- Soft delete single question ---- */
async function qmsSoftDelete(id, preview) {
  if (!confirm('Delete question "' + preview + '…"?\n\nThe question will be soft-deleted and can be restored.')) { return; }
  var res = await qmsApi('/bank/' + id, 'DELETE');
  if (res.ok) {
    instToast('Question deleted.', 'success');
    qmsBankLoad(_qmsBankPage);
  } else {
    instToast(res.data.message || 'Delete failed.', 'error');
  }
}

/* ============================================================
   ✅ STEP 2 — QMS THEORY EDITOR SUPPORT

   qmsEnsureEditorTheoryFields():
     Injects a Question Type selector and Model Answer textarea
     into the existing QMS edit modal. Idempotent — only runs
     once per page load. Uses insertAdjacentHTML relative to
     known element IDs (qmsEditOptA, qmsEditExpl), so the
     injection is independent of admin.html outer structure.

   qmsToggleEditorForType(type):
     Shows/hides option fields (A-D + correct answer) and the
     model answer block based on the selected question type.
     Hides the PARENT element of each input (which typically
     includes its label) for a cleaner appearance.
============================================================ */
function qmsEnsureEditorTheoryFields () {
  /* Idempotent — inject only once */
  if (document.getElementById('qmsEditQuestionType')) { return; }

  var optAEl = document.getElementById('qmsEditOptA');
  var explEl = document.getElementById('qmsEditExpl');
  if (!optAEl || !explEl) { return; }   /* modal not yet in DOM */

  /* ── Question Type selector — injected as sibling before optA ── */
  optAEl.insertAdjacentHTML('beforebegin',
    '<div id="qmsEditTypeWrap" style="margin-bottom:14px;">' +
      '<label style="display:block; font-size:11px; font-weight:700; ' +
        'color:var(--text-muted,#6b6b8a); text-transform:uppercase; ' +
        'letter-spacing:0.4px; margin-bottom:6px;">Question Type</label>' +
      '<select id="qmsEditQuestionType" ' +
          'onchange="qmsToggleEditorForType(this.value)" ' +
          'style="width:100%; background:rgba(255,255,255,0.04); ' +
          'border:1px solid var(--border,rgba(255,255,255,0.08)); ' +
          'border-radius:8px; padding:10px 12px; color:#fff; ' +
          'font-size:14px; font-family:inherit; outline:none;">' +
        '<option value="objective">🔘 Objective / MCQ</option>' +
        '<option value="theory">📝 Theory / Essay</option>' +
        '<option value="fill_in_blank">✏️ Fill-in-the-Blank</option>' +
        '<option value="true_false">✓ True / False</option>' +
      '</select>' +
    '</div>'
  );

  /* ── Model Answer textarea — injected as sibling before explEl ── */
  explEl.insertAdjacentHTML('beforebegin',
    '<div id="qmsEditModelAnswerWrap" style="display:none; margin-bottom:14px;">' +
      '<label style="display:block; font-size:11px; font-weight:700; ' +
        'color:var(--text-muted,#6b6b8a); text-transform:uppercase; ' +
        'letter-spacing:0.4px; margin-bottom:6px;">' +
        'Expected Answer / Marking Guide' +
      '</label>' +
      '<textarea id="qmsEditModelAnswer" rows="4" ' +
        'placeholder="Enter the model answer or marking guide for this theory question. ' +
        'Visible to administrators and markers only — never shown to students." ' +
        'style="width:100%; background:rgba(255,255,255,0.04); ' +
        'border:1px solid var(--border,rgba(255,255,255,0.08)); ' +
        'border-radius:8px; padding:10px 12px; color:#fff; ' +
        'font-size:14px; font-family:inherit; outline:none; ' +
        'resize:vertical; min-height:90px; box-sizing:border-box;">' +
      '</textarea>' +
    '</div>'
  );
}

function qmsToggleEditorForType (type) {
  var isObjective = (type !== 'theory');

  /* Show/hide objective fields. We hide the PARENT of each input,
     which typically contains both the label and the input as a unit. */
  ['qmsEditOptA', 'qmsEditOptB', 'qmsEditOptC', 'qmsEditOptD', 'qmsEditCorrect']
    .forEach(function (id) {
      var el   = document.getElementById(id);
      var wrap = el ? el.parentElement : null;
      if (wrap) { wrap.style.display = isObjective ? '' : 'none'; }
    });

  /* Show/hide theory model-answer block */
  var maWrap = document.getElementById('qmsEditModelAnswerWrap');
  if (maWrap) { maWrap.style.display = type === 'theory' ? 'block' : 'none'; }
}

/* ---- Open Edit modal ---- */
async function qmsOpenEdit(id) {
  /* ✅ STAGE 2: Reset create mode state — we are editing, not creating */
  _qmsCreateMode = false;
  _qmsCreateOpts = null;

  /* Restore save button and version history button to edit defaults */
  var saveBtn = document.getElementById('qmsEditSaveBtn');
  if (saveBtn) { saveBtn.textContent = 'Save Changes'; }
  var versionBtns = document.querySelectorAll('#qmsEditModal .t-modal-footer .a-btn-secondary');
  versionBtns.forEach(function (btn) {
    if (btn.onclick && btn.onclick.toString().indexOf('qmsViewVersions') !== -1) {
      btn.style.display = 'inline-flex';
    }
  });

  /* Reset modal state */
  var errEl = document.getElementById('qmsEditErrBox');
  if (errEl) errEl.style.display = 'none';
  document.getElementById('qmsEditModal').style.display = 'flex';
  document.getElementById('qmsEditId').value = id;
  document.getElementById('qmsEditTitle').textContent = 'Loading...';

  var res = await qmsApi('/bank/' + id);
  if (!res.ok) {
    if (errEl) { errEl.textContent = res.data.message || 'Failed to load.'; errEl.style.display = 'block'; }
    return;
  }

  var q = res.data.question;
  document.getElementById('qmsEditTitle').textContent =
    'Edit — ' + (q.questionId || 'Question') + (q.subjectName ? ' · ' + q.subjectName : '');

  /* ✅ STEP 2: Guard against empty options array on theory questions */
  var opts = Array.isArray(q.options) ? q.options : [];

  var flds = {
    qmsEditQuestion:  q.question    || '',
    qmsEditOptA:      opts[0]       || '',
    qmsEditOptB:      opts[1]       || '',
    qmsEditOptC:      opts[2]       || '',
    qmsEditOptD:      opts[3]       || '',
    qmsEditTopic:     q.topic       || '',
    qmsEditExpl:      q.explanation || '',
    qmsEditReason:    '',
    qmsEditYear:      q.year        || ''
  };
  Object.keys(flds).forEach(function (id) {
    var el = document.getElementById(id); if (el) el.value = flds[id];
  });
  var correctEl = document.getElementById('qmsEditCorrect');
  /* ✅ STEP 2: correctAnswer is null for theory — default display to 0 */
  if (correctEl) correctEl.value = String(q.correctAnswer !== null && q.correctAnswer !== undefined ? q.correctAnswer : 0);
  var statusEl  = document.getElementById('qmsEditStatus');
  if (statusEl)  statusEl.value  = q.status     || 'approved';
  var diffEl    = document.getElementById('qmsEditDifficulty');
  if (diffEl)    diffEl.value    = q.difficulty || 'medium';

  /* ✅ STEP 2: Inject theory fields (idempotent), set type, load modelAnswer, toggle */
  qmsEnsureEditorTheoryFields();
  var qtSel = document.getElementById('qmsEditQuestionType');
  if (qtSel) { qtSel.value = q.questionType || 'objective'; }
  var maEl  = document.getElementById('qmsEditModelAnswer');
  if (maEl)  { maEl.value  = q.modelAnswer  || ''; }
  qmsToggleEditorForType(q.questionType || 'objective');
}

/* ---- Save Edit / Create ---- */
async function qmsSaveEdit() {
  var id       = (document.getElementById('qmsEditId') || {}).value || '';
  var errEl    = document.getElementById('qmsEditErrBox');
  var btn      = document.getElementById('qmsEditSaveBtn');
  var isCreate = (id === '');  /* empty id = create mode (Stage 2) */

  if (errEl) errEl.style.display = 'none';

  /* ✅ STEP 2: Read question type first — drives all subsequent validation */
  var currentType = (document.getElementById('qmsEditQuestionType') || {}).value || 'objective';
  var isTheory    = (currentType === 'theory');

  var optA = ((document.getElementById('qmsEditOptA') || {}).value || '').trim();
  var optB = ((document.getElementById('qmsEditOptB') || {}).value || '').trim();
  var optC = ((document.getElementById('qmsEditOptC') || {}).value || '').trim();
  var optD = ((document.getElementById('qmsEditOptD') || {}).value || '').trim();
  var opts = [optA, optB, optC, optD].filter(Boolean);

  /* ✅ STEP 2: Only require options for non-theory questions */
  if (!isTheory && opts.length < 2) {
    if (errEl) { errEl.textContent = 'At least 2 options are required for objective questions.'; errEl.style.display = 'block'; }
    return;
  }

  var payload = {
    question:      ((document.getElementById('qmsEditQuestion')  || {}).value || '').trim(),
    /* ✅ STEP 2: Theory stores empty options array */
    options:       isTheory ? [] : opts,
    /* ✅ STEP 2: Theory stores null — not an option index */
    correctAnswer: isTheory ? null : parseInt((document.getElementById('qmsEditCorrect') || {}).value || '0'),
    /* ✅ STEP 2: modelAnswer carries reference answer for theory questions */
    modelAnswer:   ((document.getElementById('qmsEditModelAnswer') || {}).value || '').trim(),
    explanation:   ((document.getElementById('qmsEditExpl')        || {}).value || '').trim(),
    topic:         ((document.getElementById('qmsEditTopic')       || {}).value || '').trim(),
    status:        (document.getElementById('qmsEditStatus')       || {}).value || 'approved',
    difficulty:    (document.getElementById('qmsEditDifficulty')   || {}).value || 'medium',
    year:          parseInt((document.getElementById('qmsEditYear') || {}).value) || null,
    reason:        ((document.getElementById('qmsEditReason')      || {}).value || '').trim()
  };

 /* ✅ STAGE 2: Attach subject/exam context for create mode */
  if (isCreate) {
    if (!_qmsCreateOpts) {
      if (errEl) { errEl.textContent = 'Create context lost — please close and try again.'; errEl.style.display = 'block'; }
      return;
    }
    payload.examType       = _qmsCreateOpts.examType       || 'jamb';
    /* ✅ STEP 2: Use the CURRENT selector value — the user may have changed
       the type via the dropdown after the modal opened. _qmsCreateOpts still
       holds the initial value from qmsCreateForSubject() but the selector
       is authoritative for what the admin actually selected. */
    payload.questionType   = currentType;
    payload.subjectId      = _qmsCreateOpts.subjectId      || null;
    payload.subjectName    = _qmsCreateOpts.subjectName    || '';
    payload.departmentId   = _qmsCreateOpts.departmentId   || null;
    payload.departmentName = _qmsCreateOpts.departmentName || '';
  }

  if (!payload.question) {
    if (errEl) { errEl.textContent = 'Question text is required.'; errEl.style.display = 'block'; }
    return;
  }

  var spinnerHtml = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:6px;"></span>';
  if (btn) {
    btn.innerHTML = spinnerHtml + (isCreate ? 'Creating...' : 'Saving...');
    btn.disabled  = true;
  }

  var res = isCreate
    ? await qmsApi('/bank', 'POST', payload)
    : await qmsApi('/bank/' + id, 'PUT', payload);

  if (btn) {
    btn.innerHTML = isCreate ? 'Create Question' : 'Save Changes';
    btn.disabled  = false;
  }

  if (res.ok) {
    instToast(isCreate ? '✅ Question created and added to pool.' : 'Question updated.', 'success');
    closeAdminModal('qmsEditModal');

    /* Determine which view to refresh */
    var cbtActive = document.getElementById('as-cbt-management') &&
                    document.getElementById('as-cbt-management').classList.contains('active');

    if (isCreate) {
      _qmsCreateMode = false;
      _qmsCreateOpts = null;
      if (cbtActive && _cbtSelSubj) {
        /* Reload both questions and subject list (pool count update) */
        await loadCbtQuestions();
        loadCbtSubjects();
      } else {
        qmsBankLoad(_qmsBankPage);
      }
    } else {
      if (cbtActive && _cbtSelSubj) {
        loadCbtQuestions();
      } else {
        qmsBankLoad(_qmsBankPage);
      }
    }

  } else {
    if (errEl) {
      errEl.textContent  = res.data.message || (isCreate ? 'Create failed.' : 'Save failed.');
      errEl.style.display = 'block';
    }
  }
}

/* ---- View Version History ---- */
async function qmsViewVersions(id) {
  if (!id) { return; }
  document.getElementById('qmsVersionModal').style.display = 'flex';
  var body = document.getElementById('qmsVersionsBody');
  if (body) body.innerHTML = '<div style="text-align:center; padding:24px; color:var(--text-muted);">Loading...</div>';

  var res = await qmsApi('/bank/' + id + '/versions');
  if (!res.ok) {
    if (body) body.innerHTML = '<p style="color:#ff6584;">' + (res.data.message || 'Failed to load.') + '</p>';
    return;
  }

  var versions = res.data.versions || [];
  if (!versions.length) {
    if (body) body.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:20px;">No version history yet. Versions are created automatically when you edit a question.</p>';
    return;
  }

  if (body) {
    body.innerHTML =
      '<div style="margin-bottom:12px; font-size:13px; color:var(--text-secondary);">Current: <strong style="color:#fff;">' +
        res.data.current.substring(0, 80) + (res.data.current.length > 80 ? '…' : '') +
      '</strong></div>' +
      '<div style="display:flex; flex-direction:column; gap:12px;">' +
        versions.map(function (v, idx) {
          var ts = v.createdAt ? new Date(v.createdAt).toLocaleString('en-NG') : '—';
          return '<div style="background:rgba(255,255,255,0.03); border:1px solid var(--border,rgba(255,255,255,0.08)); border-radius:10px; padding:14px;">' +
            '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; flex-wrap:wrap; gap:8px;">' +
              '<div>' +
                '<span style="font-size:12px; font-weight:700; color:#a78bfa;">Version ' + (versions.length - idx) + '</span>' +
                ' <span style="font-size:11px; color:var(--text-muted);">' + ts + '</span>' +
                (v.editedBy ? ' <span style="font-size:11px; color:var(--text-muted);">by ' + v.editedBy + '</span>' : '') +
              '</div>' +
              '<button class="a-btn a-btn-secondary a-btn-sm" onclick="qmsRestoreVersion(\'' + id + '\',' + idx + ')">↺ Restore</button>' +
            '</div>' +
            (v.reason ? '<div style="font-size:11px; color:#ffa500; margin-bottom:6px;">📝 ' + v.reason + '</div>' : '') +
            '<div style="font-size:12px; color:var(--text-secondary); line-height:1.6;">' + v.question.substring(0, 120) + (v.question.length > 120 ? '…' : '') + '</div>' +
          '</div>';
        }).join('') +
      '</div>';
  }
}

/* ---- Restore a version ---- */
async function qmsRestoreVersion(id, versionIdx) {
  if (!confirm('Restore this version? The current version will be automatically saved to history.')) { return; }
  var res = await qmsApi('/bank/' + id + '/restore/' + versionIdx, 'PUT');
  if (res.ok) {
    instToast('Question restored to version ' + versionIdx + '.', 'success');
    closeAdminModal('qmsVersionModal');
    qmsBankLoad(_qmsBankPage);
  } else {
    instToast(res.data.message || 'Restore failed.', 'error');
  }
}

/* ============================================================
   QMS PHASE 3 — QUESTION ENGINE
   Admin interface: configure, check availability,
   assemble preview, view breakdown.
============================================================ */

var _qmsEngDeptsLoaded        = false;
var _qmsEngAvailTimer         = null;
var _qmsEngLastAssembly       = null; /* stores last assembled set */

/* ---- Init: called when Engine tab first opens ---- */
async function qmsEngInit() {
  /* Load health + summary + breakdown concurrently */
  await Promise.all([
    qmsEngLoadHealth(),
    qmsEngLoadSummary(),
    qmsEngLoadDepts(),
    qmsEngLoadBreakdown(),
    qmsEngLoadIntegrationStatus()
  ]);
  _qmsEngDeptsLoaded = true;
  qmsEngCheckAvailability();
}

/* ---- Engine Health Dashboard ---- */
async function qmsEngLoadHealth() {
  var healthRow     = document.getElementById('qmsEngHealthRow');
  var healthDetails = document.getElementById('qmsEngHealthDetails');
  if (!healthRow) { return; }

  var res = await qmsApi('/engine/health');
  if (!res.ok) {
    healthRow.innerHTML = '<div class="a-stat-card" style="grid-column:span 4;"><div style="color:#ff6584; font-size:13px;">Failed to load engine health.</div></div>';
    return;
  }

  var h  = res.data.health  || {};
  var qb = h.questionBank   || {};
  var cv = h.coverage       || {};
  var eg = h.engine         || {};

  /* Top row: key health numbers */
  var engineStatusColor = eg.status === 'operational' ? '#43e97b' : '#ff6584';
  var engineStatusLabel = eg.status === 'operational' ? '✅ Operational' : '⚠️ No Questions';
  var coverageColor     = cv.coveragePct >= 80 ? '#43e97b' : cv.coveragePct >= 40 ? '#ffa500' : '#ff6584';

  healthRow.style.gridTemplateColumns = 'repeat(4, 1fr)';
  healthRow.innerHTML = [
    ['📚', (qb.total || 0).toLocaleString(),           'QMS Questions',          'rgba(108,99,255,0.1)', '#a78bfa'],
    ['✅', (qb.approved || 0).toLocaleString(),         'Approved',               'rgba(67,233,123,0.1)', '#43e97b'],
    ['🎯', (eg.assemblyReadySubjects || 0).toLocaleString(), 'Assembly-Ready Subjects', 'rgba(56,249,215,0.1)', '#38f9d7'],
    ['📁', (qb.legacy || 0).toLocaleString(),           'Legacy Questions',        'rgba(255,165,0,0.1)',  '#ffa500']
  ].map(function (c) {
    return '<div class="a-stat-card" style="background:' + c[3] + ';">' +
      '<div class="a-stat-icon" style="font-size:20px; background:transparent;">' + c[0] + '</div>' +
      '<div>' +
        '<div class="a-stat-val" style="color:' + c[4] + '; font-size:22px;">' + c[1] + '</div>' +
        '<div class="a-stat-lbl">' + c[2] + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  /* Detail cards */
  var lastImportHtml = eg.lastImport
    ? '<div style="font-size:12px; color:var(--text-secondary,#a0a0c0); line-height:1.8;">' +
        '<div>' + eg.lastImport.examType.toUpperCase() + ' · ' + eg.lastImport.imported + ' questions</div>' +
        '<div style="font-size:11px; color:var(--text-muted);">' + new Date(eg.lastImport.date).toLocaleDateString('en-NG') + '</div>' +
        '<div style="font-size:11px; font-weight:700; color:' + (eg.lastImport.status === 'completed' ? '#43e97b' : '#ffa500') + ';">' + eg.lastImport.status.toUpperCase() + '</div>' +
      '</div>'
    : '<div style="font-size:12px; color:var(--text-muted);">No imports yet</div>';

  healthDetails.innerHTML =
    /* Question Health card */
    '<div class="a-card">' +
      '<div class="a-card-head"><h3>🏥 Question Health</h3></div>' +
      '<div style="padding:14px 18px;">' +
        _healthRow('Draft',              qb.draft || 0,               '#ffa500') +
        _healthRow('Archived',           qb.archived || 0,            '#a0a0c0') +
        _healthRow('Missing Topics',     qb.missingTopics || 0,       qb.missingTopics > 0 ? '#ffa500' : '#43e97b') +
        _healthRow('Missing Explanations', qb.missingExplanations || 0, qb.missingExplanations > 0 ? '#ffa500' : '#43e97b') +
      '</div>' +
    '</div>' +

    /* Coverage card */
    '<div class="a-card">' +
      '<div class="a-card-head"><h3>🗺️ Subject Coverage</h3>' +
        '<span style="font-size:13px; font-weight:700; color:' + coverageColor + ';">' + cv.coveragePct + '%</span>' +
      '</div>' +
      '<div style="padding:14px 18px;">' +
        _healthRow('Total Subjects',      cv.totalSubjects || 0,    '#fff') +
        _healthRow('Using QMS Engine',    cv.subjectsWithQMS || 0,  '#43e97b') +
        _healthRow('Remaining (Legacy)',  (cv.totalSubjects || 0) - (cv.subjectsWithQMS || 0), '#a78bfa') +
        '<div style="background:rgba(255,255,255,0.06); border-radius:20px; height:8px; overflow:hidden; margin-top:10px;">' +
          '<div style="background:linear-gradient(90deg,#43e97b,#38f9d7); width:' + cv.coveragePct + '%; height:100%; border-radius:20px;"></div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    /* Engine Status card */
    '<div class="a-card">' +
      '<div class="a-card-head"><h3>⚡ Engine Status</h3>' +
        '<span style="font-size:11px; font-weight:700; color:' + engineStatusColor + ';">' + engineStatusLabel + '</span>' +
      '</div>' +
      '<div style="padding:14px 18px;">' +
        '<div style="font-size:12px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.4px; margin-bottom:10px;">Last Import</div>' +
        lastImportHtml +
        '<div style="font-size:12px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.4px; margin:12px 0 8px;">Randomization</div>' +
        '<div style="font-size:12px; color:#43e97b; font-weight:700;">✅ Enabled (MongoDB $sample)</div>' +
        '<div style="font-size:11px; color:var(--text-muted); margin-top:3px;">Every exam session gets a unique random question set.</div>' +
      '</div>' +
    '</div>';
}

function _healthRow(label, value, color) {
  return '<div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.04);">' +
    '<span style="font-size:13px; color:var(--text-secondary,#a0a0c0);">' + label + '</span>' +
    '<span style="font-size:13px; font-weight:700; color:' + color + ';">' + value.toLocaleString() + '</span>' +
  '</div>';
}

/* ---- Load engine summary stats (top row) ---- */
async function qmsEngLoadSummary() {
  var row = document.getElementById('qmsEngineStatsRow');
  if (!row) { return; }

  var res = await qmsApi('/engine/summary');
  if (!res.ok) {
    row.innerHTML = '<div class="a-stat-card" style="grid-column:span 4;"><div style="color:#ff6584; font-size:13px; padding:8px;">Failed to load summary.</div></div>';
    return;
  }

  var s       = res.data;
  var byET    = s.byExamType  || {};
  var byDiff  = s.byDifficulty || {};
  var etKeys  = Object.keys(byET);

  var etCards = etKeys.map(function (et) {
    return '<div class="a-stat-card" style="min-width:0;">' +
      '<div class="a-stat-icon" style="background:rgba(108,99,255,0.1); font-size:16px;">📝</div>' +
      '<div><div class="a-stat-val" style="font-size:22px;">' + (byET[et] || 0).toLocaleString() + '</div>' +
      '<div class="a-stat-lbl">' + et.toUpperCase() + '</div></div>' +
    '</div>';
  }).join('');

  row.style.gridTemplateColumns = 'repeat(' + Math.max(4, etKeys.length + 1) + ', 1fr)';
  row.innerHTML =
    '<div class="a-stat-card">' +
      '<div class="a-stat-icon" style="background:rgba(67,233,123,0.1);">✅</div>' +
      '<div><div class="a-stat-val">' + (s.totalApproved || 0).toLocaleString() + '</div>' +
      '<div class="a-stat-lbl">Total Approved</div></div>' +
    '</div>' +
    etCards;
}

/* ---- Load departments into engine config dropdown ---- */
async function qmsEngLoadDepts() {
  var examType = (document.getElementById('qmsEngExamType') || {}).value || 'jamb';
  var res      = await qmsApi('/departments?examCategory=' + examType);
  var sel      = document.getElementById('qmsEngDept');
  if (!sel) { return; }
  sel.innerHTML = '<option value="">— All Departments —</option>';
  (res.ok ? (res.data.departments || []) : []).forEach(function (d) {
    var opt = document.createElement('option');
    opt.value              = d._id;
    opt.dataset.name       = d.name || '';
    opt.textContent        = d.name;
    sel.appendChild(opt);
  });
  /* Reset subjects */
  var subjSel = document.getElementById('qmsEngSubject');
  if (subjSel) subjSel.innerHTML = '<option value="">— All Subjects —</option>';
}

/* ---- Load subjects for selected department ---- */
async function qmsEngLoadSubjects() {
  var deptSel = document.getElementById('qmsEngDept');
  var deptId  = deptSel ? deptSel.value : '';
  var subjSel = document.getElementById('qmsEngSubject');
  if (!subjSel) { return; }
  subjSel.innerHTML = '<option value="">— All Subjects —</option>';
  if (!deptId) { return; }
  var res = await qmsApi('/subjects?departmentId=' + deptId);
  (res.ok ? (res.data.subjects || []) : []).forEach(function (s) {
    var opt = document.createElement('option');
    opt.value        = s._id;
    opt.dataset.name = s.name || '';
    opt.textContent  = s.name;
    subjSel.appendChild(opt);
  });
}

/* ---- Get current engine config ---- */
function qmsEngGetConfig() {
  return {
    examType:     (document.getElementById('qmsEngExamType')   || {}).value || '',
    departmentId: (document.getElementById('qmsEngDept')        || {}).value || '',
    subjectId:    (document.getElementById('qmsEngSubject')     || {}).value || '',
    difficulty:   (document.getElementById('qmsEngDifficulty')  || {}).value || '',
    topic:        ((document.getElementById('qmsEngTopic')      || {}).value || '').trim(),
    year:         ((document.getElementById('qmsEngYear')       || {}).value || '').trim() || null,
    count:        parseInt((document.getElementById('qmsEngCount') || {}).value) || 40
  };
}

/* ---- Debounced availability check (for text inputs) ---- */
function qmsEngCheckAvailabilityDebounced() {
  if (_qmsEngAvailTimer) { clearTimeout(_qmsEngAvailTimer); }
  _qmsEngAvailTimer = setTimeout(qmsEngCheckAvailability, 450);
}

/* ---- Check availability with current config ---- */
async function qmsEngCheckAvailability() {
  var cfg     = qmsEngGetConfig();
  var countEl = document.getElementById('qmsEngAvailCount');
  var labelEl = document.getElementById('qmsEngAvailLabel');
  var statEl  = document.getElementById('qmsEngAvailStatus');
  var diffEl  = document.getElementById('qmsEngDiffSplit');

  if (countEl) countEl.textContent = '…';
  if (labelEl) labelEl.textContent = 'Checking…';
  if (statEl)  statEl.innerHTML    = '';

  var qs  = '?examType=' + encodeURIComponent(cfg.examType);
  if (cfg.subjectId)    qs += '&subjectId='    + cfg.subjectId;
  if (cfg.departmentId) qs += '&departmentId=' + cfg.departmentId;
  if (cfg.difficulty)   qs += '&difficulty='   + cfg.difficulty;
  if (cfg.topic)        qs += '&topic='        + encodeURIComponent(cfg.topic);
  if (cfg.year)         qs += '&year='         + cfg.year;

  var res = await qmsApi('/engine/availability' + qs);

  if (!res.ok) {
    if (countEl) countEl.textContent = '—';
    if (labelEl) labelEl.textContent = 'Failed to check availability.';
    return;
  }

  var avail = res.data.available || 0;
  var req   = cfg.count;

  if (countEl) {
    countEl.textContent  = avail.toLocaleString();
    countEl.style.color  = avail === 0 ? '#ff6584'
                         : avail < req  ? '#ffa500'
                         :                '#43e97b';
  }

  if (labelEl) {
    var subjectOpt = document.getElementById('qmsEngSubject');
    var subjectName = subjectOpt && subjectOpt.selectedIndex > 0
      ? subjectOpt.options[subjectOpt.selectedIndex].text
      : '';
    var examType   = cfg.examType.toUpperCase();
    labelEl.textContent = 'approved question' + (avail !== 1 ? 's' : '') +
      ' available' + (subjectName ? ' in ' + subjectName : '') +
      ' for ' + examType;
  }

  if (statEl) {
    if (avail === 0) {
      statEl.innerHTML = '<span style="font-size:12px; color:#ff6584;">⚠️ No questions available. Import questions first.</span>';
    } else if (avail < req) {
      statEl.innerHTML = '<span style="font-size:12px; color:#ffa500;">⚠️ Requesting ' + req + ' but only ' + avail + ' available.</span>';
    } else {
      statEl.innerHTML = '<span style="font-size:12px; color:#43e97b;">✅ ' + avail + ' available — requesting ' + req + '</span>';
    }
  }

  /* Difficulty split: quick per-difficulty counts */
  if (diffEl) {
    var diffs = ['easy', 'medium', 'hard'];
    var diffData = {};

    await Promise.all(diffs.map(async function (d) {
      var dQs = qs + '&difficulty=' + d;
      var dRes = await qmsApi('/engine/availability' + dQs);
      diffData[d] = dRes.ok ? (dRes.data.available || 0) : 0;
    }));

    var total = diffData.easy + diffData.medium + diffData.hard || 1;
    diffEl.innerHTML = ['easy', 'medium', 'hard'].map(function (d) {
      var pct   = Math.round((diffData[d] / total) * 100);
      var color = d === 'easy' ? '#43e97b' : d === 'medium' ? '#ffa500' : '#ff6584';
      return '<div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">' +
        '<div style="font-size:12px; font-weight:700; color:' + color + '; width:50px; text-transform:capitalize;">' + d + '</div>' +
        '<div style="flex:1; background:rgba(255,255,255,0.06); border-radius:20px; height:8px; overflow:hidden;">' +
          '<div style="background:' + color + '; width:' + pct + '%; height:100%; border-radius:20px;"></div>' +
        '</div>' +
        '<div style="font-size:12px; color:#fff; font-weight:700; width:40px; text-align:right;">' + diffData[d] + '</div>' +
      '</div>';
    }).join('');
  }
}

/* ---- Assemble question set (preview) ---- */
async function qmsEngAssemble() {
  var cfg = qmsEngGetConfig();
  var btn = document.getElementById('qmsEngAssembleBtn');
  var resultDiv = document.getElementById('qmsEngAssemblyResult');

  if (!cfg.examType) {
    instToast('Please select an exam type.', 'error');
    return;
  }

  if (btn) {
    btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:6px;"></span> Assembling...';
    btn.disabled  = true;
  }

  var res = await qmsApi('/engine/assemble', 'POST', cfg);

  if (btn) { btn.innerHTML = '🎲 Assemble Question Set'; btn.disabled = false; }

  if (!res.ok) {
    instToast(res.data.message || 'Assembly failed.', 'error');
    if (resultDiv) resultDiv.style.display = 'none';
    return;
  }

  if (!res.data.success) {
    instToast(res.data.message || 'No questions found.', 'error');
    if (resultDiv) resultDiv.style.display = 'none';
    return;
  }

  _qmsEngLastAssembly = res.data;
  renderEngineAssembly(res.data);
}

/* ---- Render assembled question set ---- */
function renderEngineAssembly(data) {
  var questions  = data.questions || [];
  var meta       = data.meta       || {};
  var warning    = data.warning    || null;
  var resultDiv  = document.getElementById('qmsEngAssemblyResult');
  var titleEl    = document.getElementById('qmsEngResultTitle');
  var warnEl     = document.getElementById('qmsEngWarningBox');
  var tbody      = document.getElementById('qmsEngResultTable');
  var noteEl     = document.getElementById('qmsEngResultNote');

  if (!resultDiv) { return; }
  resultDiv.style.display = 'block';

  if (titleEl) {
    titleEl.textContent =
      'Assembled Set — ' + meta.returned + ' question' +
      (meta.returned !== 1 ? 's' : '') +
      ' (' + ((document.getElementById('qmsEngExamType') || {}).value || '').toUpperCase() + ')';
  }

  if (warnEl) {
    if (warning) {
      warnEl.textContent  = '⚠️ ' + warning;
      warnEl.style.display = 'block';
    } else {
      warnEl.style.display = 'none';
    }
  }

  if (noteEl) {
    noteEl.textContent =
      'Requested: ' + meta.requested + '  ·  ' +
      'Available: ' + meta.available + '  ·  ' +
      'Returned: '  + meta.returned  + '  ·  ' +
      'Every reassemble generates a different random set.';
  }

  var letters       = ['A', 'B', 'C', 'D'];
  var PREVIEW_LIMIT = 30;
  var shown         = questions.slice(0, PREVIEW_LIMIT);

  if (!tbody) { return; }

  if (!shown.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--text-muted);">No questions returned.</td></tr>';
    return;
  }

  tbody.innerHTML = shown.map(function (q, i) {
    var correctLetter = letters[q.correctAnswer] || '?';
    var diffColor     = q.difficulty === 'easy' ? '#43e97b' : q.difficulty === 'hard' ? '#ff6584' : '#ffa500';

    return '<tr>' +
      '<td style="font-weight:800; color:#a78bfa;">' + (i + 1) + '</td>' +
      '<td style="font-family:monospace; font-size:11px; color:#a78bfa; white-space:nowrap;">' +
        (q.questionId || '—') +
      '</td>' +
      '<td style="max-width:320px;">' +
        '<div style="font-size:13px; font-weight:600; color:#fff; line-height:1.4; margin-bottom:4px;">' +
          q.question.substring(0, 80) + (q.question.length > 80 ? '…' : '') +
        '</div>' +
        '<div>' +
          (q.options || []).map(function (o, idx) {
            return '<span style="font-size:10px; padding:1px 5px; border-radius:3px; margin-right:3px;' +
              'background:' + (idx === q.correctAnswer ? 'rgba(67,233,123,0.15)' : 'rgba(255,255,255,0.04)') + ';' +
              'color:'      + (idx === q.correctAnswer ? '#43e97b'               : 'var(--text-secondary)') + ';">' +
              letters[idx] + ': ' + o.substring(0, 20) + (o.length > 20 ? '…' : '') +
              (idx === q.correctAnswer ? ' ✓' : '') +
            '</span>';
          }).join('') +
        '</div>' +
        (q.topic ? '<div style="font-size:10px; color:var(--text-muted); margin-top:2px;">📌 ' + q.topic + '</div>' : '') +
      '</td>' +
      '<td style="font-size:12px; color:var(--text-secondary);">' + (q.subjectName || '—') + '</td>' +
      '<td style="font-size:12px; font-weight:700; color:' + diffColor + '; text-transform:capitalize;">' +
        (q.difficulty || '—') +
      '</td>' +
      '<td>' +
        '<span style="font-size:14px; font-weight:900; background:rgba(67,233,123,0.12); ' +
          'color:#43e97b; padding:3px 10px; border-radius:8px;">' +
          correctLetter +
        '</span>' +
      '</td>' +
    '</tr>';
  }).join('');

  if (questions.length > PREVIEW_LIMIT) {
    tbody.innerHTML +=
      '<tr><td colspan="6" style="text-align:center; padding:12px; font-size:12px; color:var(--text-muted);">' +
        '... and ' + (questions.length - PREVIEW_LIMIT) + ' more questions. All ' + questions.length + ' are assembled.' +
      '</td></tr>';
  }

  /* Scroll to result */
  setTimeout(function () {
    var el = document.getElementById('qmsEngAssemblyResult');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

/* ---- Copy assembled question IDs ---- */
function qmsEngExportPreview() {
  if (!_qmsEngLastAssembly || !_qmsEngLastAssembly.questions.length) {
    instToast('No assembly to export.', 'error');
    return;
  }
  var ids = _qmsEngLastAssembly.questions
    .map(function (q) { return q.questionId || q._id; })
    .join('\n');
  navigator.clipboard.writeText(ids)
    .then(function () { instToast('Question IDs copied (' + _qmsEngLastAssembly.questions.length + ' IDs).', 'success'); })
    .catch(function () { instToast('Copy failed.', 'error'); });
}

/* ---- Load breakdown table ---- */
async function qmsEngLoadBreakdown() {
  var tbody    = document.getElementById('qmsBreakdownBody');
  var filterEl = document.getElementById('qmsBreakdownFilter');
  var examType = filterEl ? filterEl.value : 'all';

  if (!tbody) { return; }
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:28px; color:var(--text-muted);">' +
    '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.2);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:8px;"></span>Loading...</td></tr>';

  var res = await qmsApi('/engine/breakdown?examType=' + examType);

  if (!res.ok) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:#ff6584; padding:24px;">' +
      (res.data.message || 'Failed to load breakdown.') + '</td></tr>';
    return;
  }

  var rows = res.data.breakdown || [];

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:36px; color:var(--text-muted);">' +
      'No approved questions in the Question Bank yet. Import and approve questions to see the breakdown.' +
    '</td></tr>';
    return;
  }

  var etColors = { jamb:'#a78bfa', waec:'#43e97b', neco:'#ffa500', 'post-utme':'#ff8e53', practice:'#38f9d7' };

  tbody.innerHTML = rows.map(function (r) {
    var etColor     = etColors[r.examType] || '#fff';
    var totalCount  = r.count || 0;
    var canAssemble = totalCount >= 10;

    return '<tr>' +
      '<td>' +
        '<span style="font-size:11px; font-weight:700; background:rgba(108,99,255,0.12); color:' +
          etColor + '; padding:2px 9px; border-radius:20px;">' +
          r.examType.toUpperCase() +
        '</span>' +
      '</td>' +
      '<td style="font-size:13px; color:var(--text-secondary,#a0a0c0);">' + r.departmentName + '</td>' +
      '<td style="font-weight:700; color:#fff;">' + r.subjectName + '</td>' +
      '<td style="font-weight:900; color:#fff; font-size:15px;">' + totalCount.toLocaleString() + '</td>' +
      '<td style="color:#43e97b; font-weight:700;">' + (r.byDifficulty.easy   || 0) + '</td>' +
      '<td style="color:#ffa500; font-weight:700;">' + (r.byDifficulty.medium || 0) + '</td>' +
      '<td style="color:#ff6584; font-weight:700;">' + (r.byDifficulty.hard   || 0) + '</td>' +
      '<td style="font-size:12px; color:var(--text-secondary,#a0a0c0);">' + (r.latestYear || '—') + '</td>' +
      '<td>' +
        (canAssemble
          ? '<button class="a-btn a-btn-secondary a-btn-sm" onclick="qmsEngQuickAssemble(' +
              "'" + r.examType + "'," +
              "'" + (r.subjectId  || '') + "'," +
              "'" + (r.subjectName || '').replace(/'/g, '') + "'" +
            ')">🎲 40 Qs</button>'
          : '<span style="font-size:11px; color:var(--text-muted,#6b6b8a);">Need ≥10</span>'
        ) +
      '</td>' +
    '</tr>';
  }).join('');
}

/* ---- Quick assemble from breakdown row ---- */
async function qmsEngQuickAssemble(examType, subjectId, subjectName) {
  /* Pre-fill the config panel */
  var etEl = document.getElementById('qmsEngExamType');
  var sjEl = document.getElementById('qmsEngSubject');
  var cnEl = document.getElementById('qmsEngCount');

  if (etEl) { etEl.value = examType; await qmsEngLoadDepts(); }

  /* Quick path: directly assemble without UI config dependency */
  var btn = document.getElementById('qmsEngAssembleBtn');
  if (btn) { btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:6px;"></span> Assembling...'; btn.disabled = true; }

  var res = await qmsApi('/engine/assemble', 'POST', {
    examType:    examType,
    subjectId:   subjectId || null,
    count:       cnEl ? (parseInt(cnEl.value) || 40) : 40
  });

  if (btn) { btn.innerHTML = '🎲 Assemble Question Set'; btn.disabled = false; }

  if (!res.ok || !res.data.success) {
    instToast(res.data.message || 'Assembly failed.', 'error');
    return;
  }

  _qmsEngLastAssembly = res.data;
  renderEngineAssembly(res.data);
  instToast('Assembled ' + res.data.meta.returned + ' questions from ' + subjectName + '.', 'success');
}

/* ============================================================
   QMS PHASE 4 — CBT INTEGRATION STATUS
   Shows per-subject engine vs legacy usage in admin UI.
============================================================ */

/* ---- Load and render integration status table ---- */
async function qmsEngLoadIntegrationStatus() {
  var tbody    = document.getElementById('qmsIntegBody');
  var summary  = document.getElementById('qmsIntegSummary');
  var filterEl = document.getElementById('qmsIntegFilterExam');
  var examType = filterEl ? filterEl.value : 'jamb';

  if (!tbody) { return; }

  tbody.innerHTML =
    '<tr><td colspan="7" style="text-align:center; padding:28px; color:var(--text-muted);">' +
    '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.2);' +
    'border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;' +
    'margin-right:8px;"></span>Checking...</td></tr>';

  /* Load integration status and blueprint health in parallel */
  var res = await qmsApi('/engine/integration-status?examType=' + examType);

  if (!res.ok) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#ff6584; padding:20px;">' +
      esc(res.data.message || 'Failed to load.') + '</td></tr>';
    return;
  }

  var data     = res.data;
  var subjects = data.subjects || [];
  var sm       = data.summary  || {};

  /* Load blueprint health for all subjects in one batch call */
  var blueprintHealth = {};
  if (subjects.length > 0) {
    try {
      var subjectIds = subjects.map(function (s) { return s.subjectId.toString(); });
      var bpRes = await qmsApi('/blueprint/pool-health-batch', 'POST', { subjectIds: subjectIds });
      if (bpRes.ok) { blueprintHealth = bpRes.data.health || {}; }
    } catch (e) {
      /* Non-critical — table still renders without blueprint column */
      console.warn('[QMS] Blueprint health fetch failed:', e.message);
    }
  }

  /* ✅ STAGE 4: Summary pills + Stage 4 active banner */
  if (summary) {
    var pctEngine     = sm.total > 0 ? Math.round((sm.usingQMS / sm.total) * 100) : 0;
    var bpReadyCount  = Object.values(blueprintHealth).filter(function (h) {
      return h._blueprints && h._blueprints.some(function (bp) { return bp.status === 'ready'; });
    }).length;

    summary.innerHTML =
      '<div style="display:flex; flex-direction:column; gap:10px; width:100%;">' +

        /* Stage 4 active banner */
        '<div style="background:rgba(67,233,123,0.08); border:1px solid rgba(67,233,123,0.2); border-radius:8px; padding:8px 14px; font-size:12px; color:#43e97b; font-weight:700; display:flex; align-items:center; gap:8px;">' +
          '⚡ <strong>Stage 4 Active</strong> — Questions are now assembled exclusively from the QMS Question Engine. Legacy fallback is inactive.' +
        '</div>' +

        /* Counts row */
        '<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">' +
          '<span style="font-size:13px; font-weight:700; color:#fff;">' + sm.total + ' subject' + (sm.total !== 1 ? 's' : '') + ' with questions</span>' +
          '<span style="background:rgba(67,233,123,0.12); color:#43e97b; padding:4px 12px; border-radius:20px; font-size:12px; font-weight:700;">🧠 ' + sm.usingQMS + ' Engine</span>' +
          '<span style="background:rgba(108,99,255,0.12); color:#a78bfa; padding:4px 12px; border-radius:20px; font-size:12px; font-weight:700;">📋 ' + bpReadyCount + ' Blueprint Ready</span>' +
          '<span style="font-size:12px; color:var(--text-muted,#6b6b8a);">(' + pctEngine + '% using QMS engine)</span>' +
          '<div style="flex:1; min-width:120px; background:rgba(255,255,255,0.06); border-radius:20px; height:8px; overflow:hidden;">' +
            '<div style="background:linear-gradient(90deg,#43e97b,#38f9d7); width:' + pctEngine + '%; height:100%; border-radius:20px; transition:width 0.5s;"></div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  if (!subjects.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="text-align:center; padding:36px; color:var(--text-muted);">' +
      'No subjects have questions for ' + esc(examType.toUpperCase()) + ' yet.' +
      '</td></tr>';
    return;
  }

  try {
    tbody.innerHTML = subjects.map(function (s) {
      var isEngine = s.source === 'qms';
      var srcLabel = isEngine
        ? '<span style="display:inline-flex; align-items:center; gap:5px; background:rgba(67,233,123,0.1); color:#43e97b; padding:3px 10px; border-radius:20px; font-size:11px; font-weight:800;">🧠 Engine</span>'
        : '<span style="display:inline-flex; align-items:center; gap:5px; background:rgba(255,101,132,0.1); color:#ff6584; padding:3px 10px; border-radius:20px; font-size:11px; font-weight:800;">⚠️ No QMS</span>';

      var qmsColour = s.qmsCount > 0 ? '#43e97b' : 'var(--text-muted,#6b6b8a)';

      /* Blueprint status for this subject */
      var bpHealth  = blueprintHealth[s.subjectId ? s.subjectId.toString() : ''] || {};
      var bpList    = bpHealth._blueprints || [];
      var bpReady   = bpList.some(function (bp) { return bp.status === 'ready'; });
      var bpExists  = bpList.length > 0;
      var bpLabel   = bpReady
        ? '<span style="font-size:10px; font-weight:700; background:rgba(67,233,123,0.1); color:#43e97b; padding:1px 7px; border-radius:20px;">✅ Ready</span>'
        : bpExists
          ? '<span style="font-size:10px; font-weight:700; background:rgba(255,165,0,0.1); color:#ffa500; padding:1px 7px; border-radius:20px;">⚠️ Incomplete</span>'
          : '<span style="font-size:10px; color:var(--text-muted,#6b6b8a);">Not configured</span>';

      var action = !isEngine
        ? '<button class="a-btn a-btn-secondary a-btn-sm" onclick="qmsSwitchTab(\'import\')" style="font-size:11px;">📥 Import</button>'
        : !bpExists
          ? '<button class="a-btn a-btn-secondary a-btn-sm" onclick="qmsOpenBankForSubject(\'' + esc(s.subjectId ? s.subjectId.toString() : '') + '\',\'' + esc(s.subjectName) + '\')" style="font-size:11px;">📋 Add Blueprint</button>'
          : '<span style="font-size:11px; color:#43e97b;">✅ Ready</span>';

      return '<tr>' +
        '<td style="font-weight:700; color:#fff;">'   + esc(s.subjectName) + '</td>' +
        '<td>'                                        + srcLabel + '</td>' +
        '<td>'                                        + bpLabel + '</td>' +
        '<td style="font-weight:700; color:' + qmsColour + ';">' +
          (s.qmsCount > 0 ? s.qmsCount.toLocaleString() : '—') +
        '</td>' +
        '<td style="font-weight:700; color:#fff;">'   + s.total.toLocaleString() + '</td>' +
        '<td>'                                        + action + '</td>' +
      '</tr>';
    }).join('');
  } catch (renderErr) {
    console.error('[QMS] Integration status render error:', renderErr.message);
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#ff6584; padding:20px;">' +
      'Display error: ' + esc(renderErr.message) + '. Please refresh.' +
    '</td></tr>';
  }
}

/* ============================================================
   QMS PHASE 5 — BULK MOVE + BULK TAG MODALS
============================================================ */

/* ---- Open Bulk Move Modal ---- */
async function qmsOpenBulkMoveModal() {
  var count = Object.keys(_qmsBankSelected).length;
  if (!count) { instToast('No questions selected.', 'error'); return; }

  var infoEl = document.getElementById('qmsBulkMoveInfo');
  if (infoEl) {
    infoEl.innerHTML = '<strong style="color:#fff;">' + count +
      ' question' + (count !== 1 ? 's' : '') + ' selected</strong> — choose destination:';
  }

  /* Load departments for default exam type */
  await qmsMoveLoadDepts();
  document.getElementById('qmsBulkMoveModal').style.display = 'flex';
}

async function qmsMoveLoadDepts() {
  var examType = (document.getElementById('qmsMoveExamType') || {}).value || 'jamb';
  var res      = await qmsApi('/departments?examCategory=' + examType);
  var sel      = document.getElementById('qmsMoveDept');
  if (!sel) { return; }
  sel.innerHTML = '<option value="">— Select Department (optional) —</option>' +
    (res.ok ? (res.data.departments || []) : []).map(function (d) {
      return '<option value="' + d._id + '" data-name="' + esc(d.name) + '">' + d.name + '</option>';
    }).join('');
  /* Reset subjects */
  var sj = document.getElementById('qmsMoveSubject');
  if (sj) sj.innerHTML = '<option value="">— Select Department first —</option>';
}

async function qmsMoveLoadSubjects() {
  var deptId  = (document.getElementById('qmsMoveDept')    || {}).value || '';
  var subjSel = document.getElementById('qmsMoveSubject');
  if (!subjSel) { return; }
  subjSel.innerHTML = '<option value="">— All Subjects in Department —</option>';
  if (!deptId) { return; }
  var res = await qmsApi('/subjects?departmentId=' + deptId);
  (res.ok ? (res.data.subjects || []) : []).forEach(function (s) {
    var opt = document.createElement('option');
    opt.value        = s._id;
    opt.dataset.name = s.name;
    opt.textContent  = s.name;
    subjSel.appendChild(opt);
  });
}

async function qmsConfirmBulkMove() {
  var ids    = Object.keys(_qmsBankSelected);
  var count  = ids.length;
  if (!count) { return; }

  var examTypeSel = document.getElementById('qmsMoveExamType');
  var deptSel     = document.getElementById('qmsMoveDept');
  var subjSel     = document.getElementById('qmsMoveSubject');
  var deptOpt     = deptSel && deptSel.selectedOptions[0];
  var subjOpt     = subjSel && subjSel.selectedOptions[0];

  var payload = {
    subjectId:      subjSel  && subjSel.value  ? subjSel.value               : null,
    subjectName:    subjOpt  && subjOpt.value  ? (subjOpt.dataset.name || '') : '',
    departmentId:   deptSel  && deptSel.value  ? deptSel.value               : null,
    departmentName: deptOpt  && deptOpt.value  ? (deptOpt.dataset.name || '') : '',
    examType:       examTypeSel ? examTypeSel.value : 'jamb'
  };

  if (!confirm('Move ' + count + ' question' + (count !== 1 ? 's' : '') + ' to ' +
               (payload.subjectName || 'the selected destination') + '?')) { return; }

  var btn = document.getElementById('qmsBulkMoveConfirmBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:6px;"></span>Moving...'; }

  var res = await qmsApi('/bank/bulk', 'POST', { operation: 'move', ids: ids, payload: payload });

  if (btn) { btn.disabled = false; btn.innerHTML = '📦 Move Questions'; }

  if (res.ok) {
    instToast(res.data.message, 'success');
    closeAdminModal('qmsBulkMoveModal');
    qmsClearSelection();
    qmsBankLoad(_qmsBankPage);
  } else {
    instToast(res.data.message || 'Move failed.', 'error');
  }
}

/* ---- Open Bulk Tag Modal ---- */
function qmsOpenBulkTagModal() {
  var count = Object.keys(_qmsBankSelected).length;
  if (!count) { instToast('No questions selected.', 'error'); return; }

  var infoEl = document.getElementById('qmsBulkTagInfo');
  if (infoEl) {
    infoEl.innerHTML = '<strong style="color:#fff;">' + count +
      ' question' + (count !== 1 ? 's' : '') + ' selected.</strong>' +
      ' Fill in only the fields you want to update. Leave blank to keep existing values.';
  }

  /* Clear inputs */
  ['qmsTagTopic', 'qmsTagYear'].forEach(function (id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  var diffEl = document.getElementById('qmsTagDifficulty');
  if (diffEl) diffEl.value = '';

  document.getElementById('qmsBulkTagModal').style.display = 'flex';
}

async function qmsConfirmBulkTag() {
  var ids    = Object.keys(_qmsBankSelected);
  var count  = ids.length;
  if (!count) { return; }

  var topic    = ((document.getElementById('qmsTagTopic')      || {}).value || '').trim();
  var diff     = (document.getElementById('qmsTagDifficulty')  || {}).value || '';
  var yearVal  = ((document.getElementById('qmsTagYear')       || {}).value || '').trim();

  if (!topic && !diff && !yearVal) {
    instToast('Fill in at least one field to apply tags.', 'error');
    return;
  }

  var payload = {};
  if (topic)   payload.topic      = topic;
  if (diff)    payload.difficulty = diff;
  if (yearVal) payload.year       = parseInt(yearVal) || null;

  if (!confirm('Apply tags to ' + count + ' question' + (count !== 1 ? 's' : '') + '?')) { return; }

  var btn = document.getElementById('qmsBulkTagConfirmBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:6px;"></span>Tagging...'; }

  var res = await qmsApi('/bank/bulk', 'POST', { operation: 'tag', ids: ids, payload: payload });

  if (btn) { btn.disabled = false; btn.innerHTML = '🏷️ Apply Tags'; }

  if (res.ok) {
    instToast(res.data.message, 'success');
    closeAdminModal('qmsBulkTagModal');
    qmsClearSelection();
    qmsBankLoad(_qmsBankPage);
  } else {
    instToast(res.data.message || 'Tagging failed.', 'error');
  }
}

/* ============================================================
   EXAMINATION CORE ENGINE — ADMIN INTERFACE
   Phase 1: Foundation, Dashboard, Registry, CBT Config, Audit
============================================================ */

var _eceCbtConfig   = null;   /* current CBT ECEConfig from server */
var _eceRegistry    = null;   /* capability registry from server */
var _eceAvailData   = {};     /* global availability state */
var _eceCbtSubTab   = 'security'; /* which CBT sub-tab is active */
var _eceAuditPage   = 1;

/* API wrapper */
async function eceApi(path, method, body) {
  var token = (typeof _isPlatformStaff !== 'undefined' && _isPlatformStaff)
    ? localStorage.getItem('latlomp_platform_token')
    : localStorage.getItem('latlomp_token');
  var opts = {
    method:  method || 'GET',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
  };
  if (body && (method || 'GET').toUpperCase() !== 'GET') opts.body = JSON.stringify(body);
  try {
    var res  = await fetch('/api/ece' + path, opts);
    var data = await res.json();
    return { ok: res.ok, status: res.status, data: data };
  } catch (e) {
    return { ok: false, status: 0, data: { message: 'Network error: ' + e.message } };
  }
}

/* ---- Init: called when ECE section opens ---- */
async function eceAdminInit() {
  await Promise.all([eceLoadRegistry(), eceLoadDashboard()]);
}

/* ---- Sub-tab switching ---- */
function eceSwitchTab(tab) {
  ['dashboard', 'registry', 'cbt', 'availability', 'audit'].forEach(function (t) {
    var panel = document.getElementById('ecePanel' + t.charAt(0).toUpperCase() + t.slice(1));
    if (panel) panel.style.display = (t === tab) ? 'block' : 'none';
    var btn   = document.getElementById('eceTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn)  btn.classList.toggle('active', t === tab);
  });
  if (tab === 'audit')        { eceLoadAuditLog(); }
  if (tab === 'cbt')          { eceLoadCbtConfig(); }
  if (tab === 'availability') { eceLoadAvailability(); }
}

/* ---- DASHBOARD ---- */
async function eceLoadDashboard() {
  var el = document.getElementById('eceDashboardContent');
  if (!el) { return; }
  el.innerHTML = '<div style="text-align:center; padding:32px; color:var(--text-muted);">Loading...</div>';

  var res = await eceApi('/dashboard');
  if (!res.ok) {
    el.innerHTML = '<div style="text-align:center; color:#ff6584; padding:24px;">' +
      (res.data.message || 'Failed to load dashboard.') + '</div>';
    return;
  }

  var d       = res.data.dashboard || {};
  var systems = d.systems || [];

  var systemCards = systems.map(function (s) {
    var statusColor = s.enabled !== false ? '#43e97b' : '#ff6584';
    var statusLabel = s.enabled !== false ? 'Active' : 'Disabled';
    return '<div class="a-stat-card" style="flex-direction:column; align-items:flex-start; gap:8px;">' +
      '<div style="display:flex; align-items:center; justify-content:space-between; width:100%;">' +
        '<div style="font-weight:800; font-size:14px; color:#fff;">' + esc(s.label) + '</div>' +
        '<span style="font-size:11px; font-weight:700; color:' + statusColor + ';">' + statusLabel + '</span>' +
      '</div>' +
      '<div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.4px;">Scope: ' + esc(s.scope) + '</div>' +
      (s.enabledCapabilities !== undefined
        ? '<div style="font-size:13px; color:var(--text-secondary);">' + s.enabledCapabilities + ' capabilities enabled</div>'
        : '<div style="font-size:12px; color:var(--text-muted);">' + (s.configuredCount || 0) + ' instances configured</div>') +
    '</div>';
  }).join('');

  var recentChanges = d.recentChanges || [];
  var changesHtml = recentChanges.length
    ? recentChanges.map(function (r) {
        return '<div style="padding:10px 0; border-bottom:1px solid var(--border,rgba(255,255,255,0.06)); font-size:13px;">' +
          '<div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:6px;">' +
            '<span style="color:#fff; font-weight:600;">' + esc(r.description || r.action) + '</span>' +
            '<span style="font-size:11px; color:var(--text-muted);">' + new Date(r.createdAt).toLocaleString('en-NG') + '</span>' +
          '</div>' +
          '<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">by ' + esc(r.actor) + ' · ' + esc(r.scope) + '</div>' +
        '</div>';
      }).join('')
    : '<div style="color:var(--text-muted); font-size:13px; padding:8px 0;">No configuration changes yet.</div>';

  el.innerHTML =
    '<div style="display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-bottom:24px;">' +
      systemCards +
    '</div>' +
    '<div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">' +
      '<div class="a-card">' +
        '<div class="a-card-head"><h3>📋 Recent Changes</h3>' +
          '<button class="a-btn a-btn-secondary a-btn-sm" onclick="eceSwitchTab(\'audit\')">View All</button></div>' +
        '<div style="padding:16px 20px;">' + changesHtml + '</div>' +
      '</div>' +
      '<div class="a-card">' +
        '<div class="a-card-head"><h3>ℹ️ Engine Status</h3></div>' +
        '<div style="padding:20px; font-size:13px; color:var(--text-secondary); line-height:1.8;">' +
          '<div>Version: <strong style="color:#fff;">' + esc(d.version || '1.0.0') + '</strong></div>' +
          '<div>Phase: <strong style="color:#a78bfa;">' + esc(d.phase || 'Phase 1 — Foundation') + '</strong></div>' +
          '<div style="margin-top:14px; font-size:12px; color:var(--text-muted); line-height:1.7;">' +
            'The Examination Core Engine provides shared examination capabilities to all three examination systems. ' +
            'Each system configures only its own examination environment.' +
          '</div>' +
          '<div style="margin-top:12px; display:flex; flex-wrap:wrap; gap:8px;">' +
            '<button class="a-btn a-btn-secondary a-btn-sm" onclick="eceSwitchTab(\'cbt\')">⚡ Configure CBT</button>' +
            '<button class="a-btn a-btn-secondary a-btn-sm" onclick="eceSwitchTab(\'registry\')">📋 View Registry</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
}

/* ---- CAPABILITY REGISTRY ---- */
async function eceLoadRegistry() {
  if (_eceRegistry) { renderEceRegistry(); return; }
  var res = await eceApi('/registry');
  if (!res.ok) { return; }
  _eceRegistry = res.data.registry || {};
  renderEceRegistry();
}

function renderEceRegistry() {
  var el = document.getElementById('eceRegistryContent');
  if (!el || !_eceRegistry) { return; }

  var phaseColors = {
    1: '#43e97b', 2: '#43e97b', 3: '#43e97b', 4: '#43e97b',
    5: '#ffa500', 6: '#ffa500', 7: '#ffa500', 8: '#ffa500',
    'future': '#6b6b8a'
  };

  el.innerHTML = Object.keys(_eceRegistry).map(function (groupKey) {
    var group = _eceRegistry[groupKey];
    return '<div class="a-card" style="margin-bottom:16px;">' +
      '<div class="a-card-head">' +
        '<h3>' + esc(group.icon) + ' ' + esc(group.label) + '</h3>' +
        '<span style="font-size:12px; color:var(--text-muted);">' + group.capabilities.length + ' capabilities</span>' +
      '</div>' +
      '<div style="padding:14px 20px; font-size:12px; color:var(--text-muted); margin-bottom:4px; border-bottom:1px solid var(--border,rgba(255,255,255,0.06));">' +
        esc(group.desc) +
      '</div>' +
      '<div style="padding:12px;">' +
        group.capabilities.map(function (cap) {
          var isFuture = cap.phase === 'future';
          var phaseNum = typeof cap.phase === 'number' ? cap.phase : null;
          var pColor   = phaseColors[cap.phase] || '#6b6b8a';
          var phaseLabel = isFuture ? 'Future'
                         : phaseNum ? 'Phase ' + phaseNum
                         : 'Phase 1';
          var pClass = isFuture ? 'ece-phase-future'
                     : phaseNum && phaseNum > 4 ? 'ece-phase-soon'
                     : 'ece-phase-live';
          return '<div class="ece-cap-row' + (isFuture ? ' future-cap' : '') + '">' +
            '<div style="flex:1;">' +
              '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">' +
                '<span style="font-size:14px; font-weight:700; color:#fff;">' + esc(cap.label) + '</span>' +
                '<span class="ece-phase-badge ' + pClass + '">' + phaseLabel + '</span>' +
                '<span style="font-family:monospace; font-size:10px; color:#a78bfa; background:rgba(108,99,255,0.1); padding:1px 6px; border-radius:4px;">' + esc(cap.key) + '</span>' +
              '</div>' +
              '<div style="font-size:12px; color:var(--text-secondary); margin-top:3px;">' + esc(cap.desc) + '</div>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';
  }).join('');
}

/* ---- CBT CONFIGURATION ---- */
async function eceLoadCbtConfig() {
  var formEl = document.getElementById('eceCbtConfigForm');
  if (!formEl) { return; }
  if (!_eceRegistry) { await eceLoadRegistry(); }
  formEl.innerHTML = '<div style="text-align:center; padding:24px; color:var(--text-muted);">Loading...</div>';

  var res = await eceApi('/config/cbt');
  if (!res.ok) {
    formEl.innerHTML = '<div style="color:#ff6584; padding:16px;">' + (res.data.message || 'Failed.') + '</div>';
    return;
  }
  _eceCbtConfig = res.data.config;
  renderEceCbtSubTab(_eceCbtSubTab);
}

function eceCbtSubTab(tab) {
  _eceCbtSubTab = tab;
  ['security', 'rendering', 'navigation', 'rules', 'modes'].forEach(function (t) {
    var btn = document.getElementById('eceCbtTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) btn.classList.toggle('active', t === tab);
  });
  renderEceCbtSubTab(tab);
}

/* Map sub-tab names to ECEConfig capability group keys */
var ECE_TAB_GROUP_MAP = {
  security:   'security',
  rendering:  'rendering',
  navigation: 'navigation',
  rules:      'rules',
  modes:      'examination_modes'
};

function renderEceCbtSubTab(tab) {
  var formEl   = document.getElementById('eceCbtConfigForm');
  if (!formEl || !_eceCbtConfig || !_eceRegistry) { return; }

  var groupKey = ECE_TAB_GROUP_MAP[tab];
  var group    = _eceRegistry[groupKey] || { capabilities: [] };
  var caps     = (_eceCbtConfig.capabilities || {})[groupKey] || {};

  var phaseColors = { 1:'#43e97b', 2:'#43e97b', 3:'#43e97b', 4:'#43e97b', 5:'#ffa500', 6:'#ffa500' };

  formEl.innerHTML =
    '<div style="font-size:13px; color:var(--text-muted); margin-bottom:14px; line-height:1.7;">' +
      esc(group.desc || '') +
    '</div>' +
    group.capabilities.map(function (cap) {
      var isFuture  = cap.phase === 'future';
      var isEnabled = caps[cap.key] === true;
      var pColor    = phaseColors[cap.phase] || '#6b6b8a';
      var pLabel    = isFuture ? 'Future' : (typeof cap.phase === 'number' ? 'Phase ' + cap.phase : 'Phase 1');
      var pClass    = isFuture ? 'ece-phase-future' : (typeof cap.phase === 'number' && cap.phase > 4 ? 'ece-phase-soon' : 'ece-phase-live');
      return '<div class="ece-cap-row' + (isEnabled ? ' enabled' : '') + (isFuture ? ' future-cap' : '') +
             '" id="ece-row-' + cap.key + '" onclick="' + (isFuture ? '' : 'eceToggleCap(\'' + groupKey + '\',\'' + cap.key + '\')') + '">' +
        '<input type="checkbox" id="ece-cb-' + cap.key + '" ' + (isEnabled ? 'checked' : '') +
               (isFuture ? ' disabled' : '') +
               ' onclick="event.stopPropagation(); eceToggleCap(\'' + groupKey + '\',\'' + cap.key + '\')" ' +
               'style="margin-top:3px; accent-color:#6c63ff; width:16px; height:16px; flex-shrink:0; cursor:pointer;" />' +
        '<div style="flex:1;">' +
          '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:3px;">' +
            '<span style="font-size:14px; font-weight:700; color:#fff;">' + esc(cap.label) + '</span>' +
            '<span class="ece-phase-badge ' + pClass + '">' + pLabel + '</span>' +
          '</div>' +
          '<div style="font-size:12px; color:var(--text-secondary);">' + esc(cap.desc) + '</div>' +
          (isFuture ? '<div style="font-size:11px; color:var(--text-muted); margin-top:2px; font-style:italic;">This capability is planned for a future phase and cannot be enabled yet.</div>' : '') +
        '</div>' +
      '</div>';
    }).join('');
}

function eceToggleCap(group, key) {
  if (!_eceCbtConfig || !_eceCbtConfig.capabilities) { return; }
  if (!_eceCbtConfig.capabilities[group]) { _eceCbtConfig.capabilities[group] = {}; }
  _eceCbtConfig.capabilities[group][key] = !(_eceCbtConfig.capabilities[group][key]);
  var cb  = document.getElementById('ece-cb-' + key);
  var row = document.getElementById('ece-row-' + key);
  if (cb)  cb.checked = _eceCbtConfig.capabilities[group][key];
  if (row) row.classList.toggle('enabled', _eceCbtConfig.capabilities[group][key]);
}

async function eceAdminSaveCbtConfig() {
  if (!_eceCbtConfig) { instToast('Load configuration first.', 'error'); return; }
  var statusEl = document.getElementById('eceCbtSaveStatus');
  if (statusEl) statusEl.textContent = 'Saving...';

  var res = await eceApi('/config/cbt', 'PUT', { capabilities: _eceCbtConfig.capabilities });
  if (res.ok) {
    instToast('CBT ECE configuration saved.', 'success');
    if (statusEl) statusEl.textContent = 'Saved at ' + new Date().toLocaleTimeString('en-NG');
    _eceCbtConfig = res.data.config;
  } else {
    instToast(res.data.message || 'Save failed.', 'error');
    if (statusEl) statusEl.textContent = '';
  }
}

async function eceAdminResetCbt() {
  if (!confirm('Reset CBT ECE configuration to factory defaults?\n\nAll custom capability settings will be lost.')) { return; }
  var res = await eceApi('/config/cbt/reset', 'POST');
  if (res.ok) {
    instToast('CBT configuration reset to defaults.', 'success');
    _eceCbtConfig = res.data.config;
    renderEceCbtSubTab(_eceCbtSubTab);
  } else {
    instToast(res.data.message || 'Reset failed.', 'error');
  }
}

/* ---- GLOBAL AVAILABILITY ---- */
async function eceLoadAvailability() {
  var el = document.getElementById('eceAvailabilityContent');
  if (!el) { return; }
  if (!_eceRegistry) { await eceLoadRegistry(); }
  el.innerHTML = '<div style="text-align:center; padding:24px; color:var(--text-muted);">Loading...</div>';

  var res = await eceApi('/availability');
  if (!res.ok) { el.innerHTML = '<div style="color:#ff6584; padding:16px;">' + (res.data.message || 'Failed.') + '</div>'; return; }
  _eceAvailData = res.data.availability || {};
  renderAvailabilityUI();
}

function renderAvailabilityUI() {
  var el = document.getElementById('eceAvailabilityContent');
  if (!el || !_eceRegistry) { return; }

  /* Show only capabilities relevant for institution and teacher (not cbt-only) */
  var showGroups = ['security', 'navigation', 'rendering', 'rules', 'qie', 'examination_modes'];

  el.innerHTML = showGroups.map(function (groupKey) {
    var group = _eceRegistry[groupKey];
    if (!group) { return ''; }
    return '<div class="a-card" style="margin-bottom:14px;">' +
      '<div class="a-card-head"><h3>' + esc(group.icon) + ' ' + esc(group.label) + '</h3></div>' +
      '<div style="padding:12px;">' +
        group.capabilities.filter(function (c) { return c.phase !== 'future'; }).map(function (cap) {
          var isAvail = _eceAvailData[cap.key] !== false; /* default: available */
          return '<div class="ece-cap-row' + (isAvail ? ' enabled' : '') +
                 '" id="ecea-row-' + cap.key + '" onclick="eceToggleAvail(\'' + cap.key + '\')">' +
            '<input type="checkbox" id="ecea-cb-' + cap.key + '" ' + (isAvail ? 'checked' : '') +
                   ' onclick="event.stopPropagation(); eceToggleAvail(\'' + cap.key + '\')" ' +
                   'style="margin-top:3px; accent-color:#6c63ff; width:16px; height:16px; flex-shrink:0; cursor:pointer;" />' +
            '<div style="flex:1;">' +
              '<div style="font-size:14px; font-weight:700; color:#fff; margin-bottom:2px;">' + esc(cap.label) + '</div>' +
              '<div style="font-size:12px; color:var(--text-secondary);">' + esc(cap.desc) + '</div>' +
              '<div style="font-size:11px; color:' + (isAvail ? '#43e97b' : '#ff6584') + '; margin-top:3px; font-weight:700;">' +
                (isAvail ? '✅ Available to Institution & Teacher systems' : '⛔ Blocked — Institution & Teacher cannot enable this') +
              '</div>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';
  }).join('');
}

function eceToggleAvail(key) {
  _eceAvailData[key] = !(_eceAvailData[key] !== false);
  var cb  = document.getElementById('ecea-cb-' + key);
  var row = document.getElementById('ecea-row-' + key);
  if (cb)  cb.checked = _eceAvailData[key];
  if (row) row.classList.toggle('enabled', _eceAvailData[key]);
  var info = row && row.querySelector('div:last-child div:last-child');
  if (info) {
    info.style.color    = _eceAvailData[key] ? '#43e97b' : '#ff6584';
    info.textContent    = _eceAvailData[key]
      ? '✅ Available to Institution & Teacher systems'
      : '⛔ Blocked — Institution & Teacher cannot enable this';
  }
}

async function eceAdminSaveAvailability() {
  var res = await eceApi('/availability', 'PUT', _eceAvailData);
  if (res.ok) {
    instToast('Global availability settings saved.', 'success');
    _eceAvailData = res.data.availability;
  } else {
    instToast(res.data.message || 'Save failed.', 'error');
  }
}

/* ---- AUDIT LOG ---- */
async function eceLoadAuditLog() {
  var tbody    = document.getElementById('eceAuditBody');
  var filterEl = document.getElementById('eceAuditScopeFilter');
  var scope    = filterEl ? filterEl.value : '';
  if (!tbody) { return; }
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--text-muted);">Loading...</td></tr>';

  var qs  = '?page=' + _eceAuditPage + '&limit=20';
  if (scope) qs += '&scope=' + scope;

  var res = await eceApi('/audit' + qs);
  if (!res.ok) { tbody.innerHTML = '<tr><td colspan="5" style="color:#ff6584; text-align:center; padding:16px;">Failed to load.</td></tr>'; return; }

  var logs  = res.data.logs  || [];
  var total = res.data.total || 0;
  var pages = res.data.pages || 1;

  if (!logs.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:32px; color:var(--text-muted);">No ECE configuration changes recorded yet.</td></tr>';
    return;
  }

  var actionColors = {
    capability_changed:           '#a78bfa',
    config_reset:                 '#ffa500',
    global_availability_changed:  '#ff8e53',
    scope_enabled:                '#43e97b',
    scope_disabled:               '#ff6584',
    config_created:               '#38f9d7'
  };

  tbody.innerHTML = logs.map(function (l) {
    var color = actionColors[l.action] || '#fff';
    return '<tr>' +
      '<td style="font-size:12px; color:var(--text-secondary);">' +
        new Date(l.createdAt).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' }) +
        '<br><span style="color:var(--text-muted); font-size:11px;">' +
        new Date(l.createdAt).toLocaleTimeString('en-NG') + '</span>' +
      '</td>' +
      '<td style="font-size:12px;"><span style="color:#fff; font-weight:600;">' + esc(l.actor) + '</span>' +
        '<br><span style="font-size:11px; color:var(--text-muted);">' + esc(l.actorRole || '') + '</span>' +
      '</td>' +
      '<td><span style="font-size:11px; font-weight:700; background:rgba(108,99,255,0.12); color:#a78bfa; padding:2px 8px; border-radius:20px;">' +
        esc(l.scope) + (l.scopeLabel && l.scopeLabel !== l.scope ? ' · ' + esc(l.scopeLabel) : '') +
      '</span></td>' +
      '<td style="font-size:12px; font-weight:700; color:' + color + '; white-space:nowrap;">' +
        esc((l.action || '').replace(/_/g, ' ').toUpperCase()) +
      '</td>' +
      '<td style="font-size:12px; color:var(--text-secondary);">' + esc(l.description || '—') + '</td>' +
    '</tr>';
  }).join('');

  /* Pagination */
  var pagDiv = document.getElementById('eceAuditPagination');
  if (pagDiv && pages > 1) {
    var btns = '';
    for (var p = 1; p <= Math.min(pages, 8); p++) {
      btns += '<button class="a-btn a-btn-sm ' + (p === _eceAuditPage ? 'a-btn-primary' : 'a-btn-secondary') +
              '" onclick="_eceAuditPage=' + p + '; eceLoadAuditLog();">' + p + '</button>';
    }
    pagDiv.innerHTML = btns;
    pagDiv.style.display = 'flex';
  } else if (pagDiv) {
    pagDiv.style.display = 'none';
  }
}

/* ============================================================
   ✅ STEP 2 FIX — THEORY-AWARE PREVIEW RENDERER

   Replaces the original renderQmsPreview + its stabilization patch.
   Detects whether the preview contains theory or objective questions
   and renders appropriate columns for each type.

   Theory columns:   # | Question | Marks | Model Answer | Type
   Objective columns:# | Question | Options | Correct | Explanation
============================================================ */
var _origRenderQmsPreview = renderQmsPreview;

renderQmsPreview = function(preview, meta) {
  /* ✅ FIX: Determine type BEFORE calling original so we can
     skip the original's table rendering when in theory mode. */
  var qType    = (preview && preview.questionType)
               ? preview.questionType
               : (meta && meta.questionType ? meta.questionType : _qmsCurrentQType);
  var isTheory = (qType === 'theory');

  if (isTheory) {
    /* ---- Theory mode: call original ONLY for stats/warnings/rejected.
       We immediately overwrite the tbody ourselves so there is no
       double-render conflict. ---- */
    _origRenderQmsPreview(preview, meta);

    var validQs   = preview.valid || [];
    var tbody     = document.getElementById('qmsPreviewTable');
    var titleEl   = document.getElementById('qmsPreviewTitle');
    var confBtn   = document.getElementById('qmsConfirmBtn');
    var noteEl    = document.getElementById('qmsPreviewMoreNote');
    var LIMIT     = 20;
    var shown     = validQs.slice(0, LIMIT);

    if (titleEl) {
      titleEl.textContent =
        '📝 Theory Questions (' + validQs.length + ' ready to import)';
    }

    if (tbody) {
      if (!shown.length) {
        tbody.innerHTML =
          '<tr><td colspan="5" style="text-align:center; padding:24px; ' +
          'color:var(--text-muted);">No valid theory questions detected. ' +
          'Check the format guide and warnings above.</td></tr>';
      } else {
        tbody.innerHTML = shown.map(function(q, i) {
          var qPreview = (q.question || '').substring(0, 120) +
            ((q.question || '').length > 120 ? '…' : '');
          var marksVal = q.marks || '—';
          var rawModel = (q.modelAnswer || q.explanation || '');
          /* Strip marking notation for preview */
          var modelPreview = rawModel
            .replace(/\[M\d\]/gi, '').replace(/\[A\d\]/gi, '')
            .replace(/\[B\d\]/gi, '').trim()
            .substring(0, 80);
          var hasModel = rawModel.trim().length > 0;

          return '<tr>' +
            '<td style="font-weight:700;color:#a78bfa;width:32px;">' + (i+1) + '</td>' +
            '<td style="color:#fff;font-size:13px;max-width:260px;line-height:1.5;">' +
              qPreview + '</td>' +
            '<td style="text-align:center;">' +
              '<span style="background:rgba(67,233,123,0.12);color:#43e97b;' +
              'padding:2px 10px;border-radius:20px;font-size:12px;font-weight:700;">' +
              marksVal + (marksVal !== '—' ? ' mk' : '') + '</span></td>' +
            '<td style="font-size:12px;color:var(--text-secondary);max-width:200px;">' +
              (hasModel
                ? '<span style="color:#43e97b;">✓ </span>' + modelPreview +
                  (rawModel.trim().length > 80 ? '…' : '')
                : '<span style="color:var(--text-muted);font-style:italic;">—</span>'
              ) + '</td>' +
            '<td><span style="background:rgba(255,165,0,0.1);color:#ffa500;' +
              'padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;">' +
              'Theory</span></td>' +
          '</tr>';
        }).join('');
      }
    }

    if (confBtn) {
      if (validQs.length > 0) {
        confBtn.style.display = 'inline-flex';
        confBtn.textContent   = '✅ Import ' + validQs.length +
          ' Theory Question' + (validQs.length !== 1 ? 's' : '');
      } else {
        confBtn.style.display = 'none';
      }
    }
    if (noteEl) {
      noteEl.textContent = validQs.length > LIMIT
        ? 'Showing ' + LIMIT + ' of ' + validQs.length +
          ' theory questions. All will be imported on confirmation.'
        : '';
    }

  } else {
    /* ---- Objective mode: call original, then add explanation column ---- */
    _origRenderQmsPreview(preview, meta);

    var objValidQs = preview.valid || [];
    var objTbody   = document.getElementById('qmsPreviewTable');
    var LIMIT2     = 20;
    if (!objTbody || !objValidQs.length) { return; }

    var letters = ['A', 'B', 'C', 'D'];
    objTbody.innerHTML = objValidQs.slice(0, LIMIT2).map(function(q, i) {
      var opts = (q.options || []).map(function(o, idx) {
        return '<span style="font-size:11px;padding:1px 6px;border-radius:4px;' +
          'margin-right:3px;background:' +
          (idx===q.correctAnswer ? 'rgba(67,233,123,0.15)' : 'rgba(255,255,255,0.04)') +
          ';color:' +
          (idx===q.correctAnswer ? '#43e97b' : 'var(--text-secondary)') + ';">' +
          letters[idx] + ': ' + o.substring(0,30) + (o.length>30?'...':'') +
          (idx===q.correctAnswer?' ✓':'') + '</span>';
      }).join('');
      var explHtml = q.explanation
        ? '<span style="font-size:11px;color:#43e97b;">✓ ' +
            q.explanation.substring(0,60) + (q.explanation.length>60?'...':'') +
          '</span>'
        : '<span style="font-size:11px;color:var(--text-muted);">—</span>';
      return '<tr>' +
        '<td style="font-weight:700;color:#a78bfa;">' + (i+1) + '</td>' +
        '<td style="color:#fff;font-size:13px;">' +
          q.question.substring(0,100) + (q.question.length>100?'...':'') + '</td>' +
        '<td>' + opts + '</td>' +
        '<td><span style="background:rgba(67,233,123,0.12);color:#43e97b;' +
          'padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;">' +
          (letters[q.correctAnswer]||'?') + '</span></td>' +
        '<td>' + explHtml + '</td>' +
      '</tr>';
    }).join('');
  }
};





/* ============================================================
   QMS STABILIZATION — QUESTION SOURCES (UNIFIED VIEW)
   Shows both QMS and Legacy questions in one interface.
============================================================ */

var _qmsSourcePage    = 1;
var _qmsSourceTimer   = null;
var _qmsSourceInited  = false;

function qmsSourceDebounce() {
  if (_qmsSourceTimer) { clearTimeout(_qmsSourceTimer); }
  _qmsSourceTimer = setTimeout(function () { qmsSourceLoad(1); }, 380);
}

async function qmsSourceInit() {
  if (!_qmsSourceInited) {
    await qmsSourceLoadSummary();
    _qmsSourceInited = true;
  }
  qmsSourceLoad(1);
}

/* Load summary counts for the two source cards */
async function qmsSourceLoadSummary() {
  var res = await qmsApi('/engine/health');
  if (!res.ok) { return; }
  var qb = (res.data.health || {}).questionBank || {};
  var qmsEl    = document.getElementById('qmsSourceQmsCount');
  var legacyEl = document.getElementById('qmsSourceLegacyCount');
  if (qmsEl)    qmsEl.textContent    = (qb.approved || 0).toLocaleString() + ' approved';
  if (legacyEl) legacyEl.textContent = (qb.legacy   || 0).toLocaleString() + ' active';
}

/* Load the unified question list */
async function qmsSourceLoad(page) {
  _qmsSourcePage = page || 1;
  var tbody     = document.getElementById('qmsSourceBody');
  var titleEl   = document.getElementById('qmsSourceTitle');
  if (!tbody) { return; }

  var filterType = (document.getElementById('qmsSourceFilterType') || {}).value || 'all';
  var filterExam = (document.getElementById('qmsSourceFilterExam') || {}).value || 'all';
  var search     = ((document.getElementById('qmsSourceSearch')    || {}).value || '').trim();

  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:28px; color:var(--text-muted);">' +
    '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.2);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:8px;"></span>Loading...</td></tr>';

  /* Fetch from one or both sources in parallel */
  var qmsQs     = [];
  var legacyQs  = [];
  var qmsTotal  = 0;
  var legTotal  = 0;

  var qsBankQs = '?page=' + _qmsSourcePage + '&limit=25';
  if (filterExam !== 'all') qsBankQs += '&examType=' + filterExam;
  if (search)               qsBankQs += '&search=' + encodeURIComponent(search);

  var qsLeg = '?page=' + _qmsSourcePage + '&limit=25';
  if (filterExam !== 'all') qsLeg += '&examCategory=' + filterExam;
  if (search)               qsLeg += '&search=' + encodeURIComponent(search);

  try {
    var fetches = [];
    if (filterType === 'all' || filterType === 'qms') {
      fetches.push(qmsApi('/bank' + qsBankQs).then(function (r) {
        if (r.ok) { qmsQs = r.data.questions || []; qmsTotal = r.data.total || 0; }
      }));
    }
    if (filterType === 'all' || filterType === 'legacy') {
      fetches.push(qmsApi('/bank/legacy' + qsLeg).then(function (r) {
        if (r.ok) { legacyQs = r.data.questions || []; legTotal = r.data.total || 0; }
      }));
    }
    await Promise.all(fetches);
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#ff6584; padding:20px;">Failed to load. ' + e.message + '</td></tr>';
    return;
  }

  var combined = [];
  qmsQs.forEach(function    (q) { combined.push(Object.assign({}, q, { _source: 'qms' }));    });
  legacyQs.forEach(function (q) { combined.push(Object.assign({}, q, { _source: 'legacy' })); });

  var total = qmsTotal + legTotal;
  if (titleEl) {
    titleEl.textContent = 'All Questions — ' + total.toLocaleString() + ' total (' +
      qmsTotal.toLocaleString() + ' QMS + ' + legTotal.toLocaleString() + ' Legacy)';
  }

  if (!combined.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:36px; color:var(--text-muted);">No questions found.</td></tr>';
    document.getElementById('qmsSourcePagination').style.display = 'none';
    return;
  }

  var letters = ['A', 'B', 'C', 'D'];
  tbody.innerHTML = combined.map(function (q) {
    var isQms    = q._source === 'qms';
    var srcBadge = isQms
      ? '<span style="font-size:10px; font-weight:800; background:rgba(67,233,123,0.1); color:#43e97b; padding:2px 8px; border-radius:20px; white-space:nowrap;">🧠 QMS</span>'
      : '<span style="font-size:10px; font-weight:800; background:rgba(108,99,255,0.1); color:#a78bfa; padding:2px 8px; border-radius:20px; white-space:nowrap;">📁 Legacy</span>';
    var examLabel  = (q.examType || q.examCategory || 'all').toUpperCase();
    var correctLet = letters[q.correctAnswer] !== undefined ? letters[q.correctAnswer] : '?';
    var explHtml   = q.explanation
      ? '<span style="font-size:11px; color:#43e97b;">✓ ' + q.explanation.substring(0, 50) + (q.explanation.length > 50 ? '...' : '') + '</span>'
      : '<span style="font-size:11px; color:var(--text-muted);">—</span>';
    return '<tr>' +
      '<td>' + srcBadge + '</td>' +
      '<td style="max-width:280px; font-size:13px; font-weight:600; color:#fff; line-height:1.4;">' +
        (q.question || '').substring(0, 90) + (q.question && q.question.length > 90 ? '…' : '') +
      '</td>' +
      '<td style="font-size:12px; color:var(--text-secondary);">' + (q.subjectName || '—') + '</td>' +
      '<td><span style="font-size:11px; font-weight:700; background:rgba(108,99,255,0.12); color:#a78bfa; padding:2px 8px; border-radius:20px;">' + examLabel + '</span></td>' +
      '<td><span style="font-size:13px; font-weight:900; background:rgba(67,233,123,0.12); color:#43e97b; padding:2px 10px; border-radius:8px;">' + correctLet + '</span></td>' +
      '<td>' + explHtml + '</td>' +
    '</tr>';
  }).join('');

  /* Simple pagination for QMS portion */
  var pages  = Math.ceil(Math.max(qmsTotal, legTotal) / 25);
  var pagDiv = document.getElementById('qmsSourcePagination');
  if (pagDiv && pages > 1) {
    var btns = '';
    for (var p = 1; p <= Math.min(pages, 8); p++) {
      btns += '<button class="a-btn a-btn-sm ' + (p === _qmsSourcePage ? 'a-btn-primary' : 'a-btn-secondary') +
              '" onclick="qmsSourceLoad(' + p + ')">' + p + '</button>';
    }
    pagDiv.innerHTML    = btns;
    pagDiv.style.display = 'flex';
  } else if (pagDiv) {
    pagDiv.style.display = 'none';
  }
}

/* ============================================================
   ✅ STAGE 1 — EXAMINATION BLUEPRINT ADMIN FUNCTIONS
============================================================ */

var _bpSubjectId   = null;
var _bpSubjectName = '';
var _bpDeptName    = '';
var _bpHealthData  = null;   /* pool health for current subject */
var _bpCurrentType = 'objective';
var _bpBlueprintMap = {};    /* { 'examType_questionType': blueprint } */

/* ---- Open the blueprint modal for a subject ---- */
async function qmsBlueprintOpen(subjectId, subjectName, deptName) {
  _bpSubjectId   = subjectId;
  _bpSubjectName = subjectName;
  _bpDeptName    = deptName;
  _bpBlueprintMap = {};
  _bpCurrentType = 'objective';

  document.getElementById('bpSubjectId').value    = subjectId;
  document.getElementById('bpCurrentType').value  = 'objective';
  document.getElementById('bpCurrentBlueprintId').value = '';
  document.getElementById('qmsBlueprintTitle').textContent =
    'Blueprint — ' + subjectName + ' (' + deptName + ')';
  document.getElementById('qmsBlueprintSubjectInfo').innerHTML =
    '<span style="color:#fff; font-weight:700;">' + esc(subjectName) + '</span>' +
    ' in <span style="color:var(--text-muted);">' + esc(deptName) + '</span>' +
    '<div style="font-size:12px; margin-top:4px; color:var(--text-muted); line-height:1.7;">' +
      'Configure examination parameters for each question type. ' +
      'Blueprints are used by the Question Engine during Stage 4 activation.' +
    '</div>';

  document.getElementById('qmsBlueprintModal').style.display = 'flex';

  /* Load pool health + existing blueprints in parallel */
  await qmsBlueprintLoadForExamType();
}

/* ---- Load blueprints for the selected exam type ---- */
async function qmsBlueprintLoadForExamType() {
  var examType = (document.getElementById('bpExamType') || {}).value || 'all';
  var infoEl   = document.getElementById('bpPoolStatusDisplay');
  if (infoEl) infoEl.innerHTML = '<span style="color:var(--text-muted); font-size:12px;">Loading pool...</span>';

  var [healthRes, bpRes] = await Promise.all([
    qmsApi('/blueprint/pool-health/' + _bpSubjectId),
    qmsApi('/blueprint/subject/' + _bpSubjectId)
  ]);

  _bpHealthData = healthRes.ok ? healthRes.data : null;

  if (bpRes.ok) {
    _bpBlueprintMap = {};
    (bpRes.data.blueprints || []).forEach(function (bp) {
      var key = bp.examType + '_' + bp.questionType;
      _bpBlueprintMap[key] = bp;
    });
  }

  var totalApproved = _bpHealthData ? (_bpHealthData.total || 0) : 0;
  if (infoEl) {
    infoEl.innerHTML = totalApproved > 0
      ? '<span style="color:#43e97b; font-weight:700; font-size:13px;">✅ ' + totalApproved.toLocaleString() + ' approved questions in pool</span>'
      : '<span style="color:var(--text-muted); font-size:13px;">No approved questions yet — import first.</span>';
  }

  qmsBlueprintSwitchType(_bpCurrentType);
}

/* ---- Switch between question type tabs ---- */
function qmsBlueprintSwitchType(type) {
  _bpCurrentType = type;
  document.getElementById('bpCurrentType').value = type;
  ['objective','theory','practical','oral'].forEach(function (t) {
    var btn = document.getElementById('bpTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) btn.classList.toggle('active', t === type);
  });

  var examType = (document.getElementById('bpExamType') || {}).value || 'all';
  var key      = examType + '_' + type;
  var existing = _bpBlueprintMap[key] || null;

  /* Pool availability for this type */
  var available = _bpHealthData && _bpHealthData.typeHealth
    ? (_bpHealthData.typeHealth[type] ? _bpHealthData.typeHealth[type].available : 0)
    : (_bpHealthData ? (_bpHealthData.poolCounts || {})[type] || 0 : 0);

  /* Populate form fields */
  var count    = existing ? existing.count    : 40;
  var duration = existing ? existing.duration : 30;
  var passMark = existing ? existing.passMark : 50;
  var dd       = existing ? (existing.difficultyDistribution || {}) : {};
  var easy     = dd.easy   !== undefined ? dd.easy   : 33;
  var medium   = dd.medium !== undefined ? dd.medium : 34;
  var hard     = dd.hard   !== undefined ? dd.hard   : 33;
  var randomize     = existing ? String(existing.randomize !== false) : 'true';
  var instructions  = existing ? (existing.instructions || '') : '';
  var blueprintId   = existing ? (existing._id || '') : '';

  function setVal(id, val) { var el = document.getElementById(id); if (el) el.value = val; }
  setVal('bpCount',        count);
  setVal('bpDuration',     duration);
  setVal('bpPassMark',     passMark);
  setVal('bpDiffEasy',     easy);
  setVal('bpDiffMedium',   medium);
  setVal('bpDiffHard',     hard);
  setVal('bpRandomize',    randomize);
  setVal('bpInstructions', instructions);
  document.getElementById('bpCurrentBlueprintId').value = blueprintId;

  /* Status and delete button */
  var statusColor = existing
    ? (existing.status === 'ready'      ? '#43e97b'
     : existing.status === 'incomplete' ? '#ffa500'
     :                                    'var(--text-muted)')
    : 'var(--text-muted)';
  var statusLabel = existing
    ? existing.status.charAt(0).toUpperCase() + existing.status.slice(1)
    : 'Not configured';

  var deleteBtn = document.getElementById('bpDeleteBtn');
  if (deleteBtn) deleteBtn.style.display = blueprintId ? 'inline-flex' : 'none';

  /* Show availability below form */
  var warn = document.getElementById('bpDiffWarning');
  if (warn) warn.style.display = 'none';

  /* Show pool count beside the type tab */
  var formWrap = document.getElementById('qmsBlueprintFormWrap');
  if (formWrap) {
    formWrap.style.opacity = type === 'theory' || type === 'practical' || type === 'oral'
      ? '0.9' : '1';
  }
}

/* ---- Validate difficulty distribution ---- */
function qmsBpDiffCheck() {
  var easy   = parseInt((document.getElementById('bpDiffEasy')   || {}).value) || 0;
  var medium = parseInt((document.getElementById('bpDiffMedium') || {}).value) || 0;
  var hard   = parseInt((document.getElementById('bpDiffHard')   || {}).value) || 0;
  var sum    = easy + medium + hard;
  var warn   = document.getElementById('bpDiffWarning');
  var warnTxt = document.getElementById('bpDiffWarnText');
  if (!warn) return;
  if (sum !== 100) {
    warn.style.display = 'block';
    if (warnTxt) warnTxt.textContent = 'Easy + Medium + Hard = ' + sum + '%. Total must equal 100%.';
  } else {
    warn.style.display = 'none';
  }
}

/* ---- Save the blueprint ---- */
async function qmsBlueprintSave() {
  var subjectId    = document.getElementById('bpSubjectId').value;
  var examType     = (document.getElementById('bpExamType') || {}).value || 'all';
  var questionType = document.getElementById('bpCurrentType').value || 'objective';
  var btn          = document.getElementById('bpSaveBtn');

  var easy   = parseInt((document.getElementById('bpDiffEasy')   || {}).value) || 0;
  var medium = parseInt((document.getElementById('bpDiffMedium') || {}).value) || 0;
  var hard   = parseInt((document.getElementById('bpDiffHard')   || {}).value) || 0;

  if (easy + medium + hard !== 100) {
    instToast('Difficulty distribution must total 100%.', 'error');
    return;
  }

  if (btn) { btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:6px;"></span> Saving...'; btn.disabled = true; }

  var payload = {
    examType:     examType,
    questionType: questionType,
    count:        parseInt((document.getElementById('bpCount')       || {}).value) || 40,
    duration:     parseInt((document.getElementById('bpDuration')    || {}).value) || 30,
    passMark:     parseInt((document.getElementById('bpPassMark')    || {}).value) || 50,
    randomize:    (document.getElementById('bpRandomize') || {}).value !== 'false',
    instructions: ((document.getElementById('bpInstructions') || {}).value || '').trim(),
    difficultyDistribution: { easy: easy, medium: medium, hard: hard }
  };

  var res = await qmsApi('/blueprint/subject/' + subjectId, 'PUT', payload);

  if (btn) { btn.innerHTML = '💾 Save Blueprint'; btn.disabled = false; }

  if (res.ok) {
    var bp = res.data.blueprint;
    var key = examType + '_' + questionType;
    _bpBlueprintMap[key] = bp;
    document.getElementById('bpCurrentBlueprintId').value = bp._id;

    var statusColors = { ready:'#43e97b', incomplete:'#ffa500', draft:'var(--text-muted)' };
    var statusColor  = statusColors[bp.status] || 'var(--text-muted)';

    instToast('Blueprint saved — Status: ' +
      '<span style="color:' + statusColor + '; font-weight:700;">' +
      bp.status.toUpperCase() + '</span>', 'success');

    var deleteBtn = document.getElementById('bpDeleteBtn');
    if (deleteBtn) deleteBtn.style.display = 'inline-flex';

    /* Refresh pool health display */
    await qmsBlueprintLoadForExamType();
  } else {
    instToast(res.data.message || 'Failed to save blueprint.', 'error');
  }
}

/* ---- Delete current blueprint ---- */
async function qmsBlueprintDelete() {
  var blueprintId = document.getElementById('bpCurrentBlueprintId').value;
  if (!blueprintId) { instToast('No blueprint to delete.', 'error'); return; }
  if (!confirm('Delete this blueprint?\n\nThe question pool is not affected — only the configuration is removed.')) { return; }

  var res = await qmsApi('/blueprint/' + blueprintId, 'DELETE');
  if (res.ok) {
    var examType     = (document.getElementById('bpExamType') || {}).value || 'all';
    var questionType = document.getElementById('bpCurrentType').value;
    var key          = examType + '_' + questionType;
    delete _bpBlueprintMap[key];
    document.getElementById('bpCurrentBlueprintId').value = '';
    document.getElementById('bpDeleteBtn').style.display  = 'none';
    instToast('Blueprint deleted.', 'success');
    qmsBlueprintSwitchType(questionType);
  } else {
    instToast(res.data.message || 'Delete failed.', 'error');
  }
}

/* ============================================================
   ✅ STAGE 1 — ORPHAN CLEANUP FUNCTIONS
   Questions without a Subject assignment.
============================================================ */

var _qmsOrphanPage     = 1;
var _qmsOrphanSelected = {};

function qmsOrphanToggleAll(masterCb) {
  document.querySelectorAll('#qmsOrphanBody input[type="checkbox"]').forEach(function (cb) {
    var row = cb.closest('tr');
    var id  = row ? row.id.replace('qmsOrphanRow-', '') : '';
    cb.checked = masterCb.checked;
    if (masterCb.checked && id) { _qmsOrphanSelected[id] = true; }
    else if (id)                { delete _qmsOrphanSelected[id]; }
  });
  qmsOrphanUpdateBtn();
}

function qmsOrphanToggleRow(id, cb) {
  if (cb.checked) { _qmsOrphanSelected[id] = true; }
  else            { delete _qmsOrphanSelected[id]; }
  qmsOrphanUpdateBtn();
}

function qmsOrphanUpdateBtn() {
  var count = Object.keys(_qmsOrphanSelected).length;
  var btn   = document.getElementById('qmsOrphanAssignBtn');
  if (btn)  {
    btn.style.display = count > 0 ? 'inline-flex' : 'none';
    btn.textContent   = count > 0 ? '📌 Assign ' + count + ' Selected' : '📌 Assign Selected';
  }
}

async function qmsOrphanLoad(page) {
  _qmsOrphanPage     = page || 1;
  _qmsOrphanSelected = {};
  qmsOrphanUpdateBtn();

  var tbody    = document.getElementById('qmsOrphanBody');
  var countEl  = document.getElementById('qmsOrphanCount');
  var titleEl  = document.getElementById('qmsOrphanTitle');
  if (!tbody) { return; }

  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:28px; color:var(--text-muted);">' +
    '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.2);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:8px;"></span>Scanning...</td></tr>';

  var filterExam = (document.getElementById('qmsOrphanFilterExam') || {}).value || '';
  var qs = '?page=' + _qmsOrphanPage + '&limit=25';
  if (filterExam) qs += '&examType=' + filterExam;

  var res = await qmsApi('/bank/orphans' + qs);
  if (!res.ok) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#ff6584; padding:20px;">' +
      (res.data.message || 'Failed to load.') + '</td></tr>';
    return;
  }

  var questions = res.data.questions || [];
  var total     = res.data.total     || 0;

  if (countEl) countEl.textContent = total > 0 ? total + ' unassigned question' + (total !== 1 ? 's' : '') + ' found' : '';
  if (titleEl) titleEl.textContent = total > 0 ? 'Unassigned Questions (' + total + ')' : 'Unassigned Questions';

  if (!questions.length) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align:center; padding:36px;">' +
        '<div style="font-size:28px; margin-bottom:10px;">✅</div>' +
        '<div style="font-size:15px; font-weight:700; color:#43e97b;">All questions are assigned!</div>' +
        '<div style="font-size:13px; color:var(--text-muted); margin-top:6px;">Every question in the bank has a Subject.</div>' +
      '</td></tr>';
    document.getElementById('qmsOrphanPagination').style.display = 'none';
    return;
  }

  var letters = ['A','B','C','D'];
  tbody.innerHTML = questions.map(function (q) {
    var safeId   = q._id.toString();
    var isChecked = _qmsOrphanSelected[safeId] ? 'checked' : '';
    var qtBadge  = '<span style="font-size:10px; font-weight:700; background:rgba(108,99,255,0.12); color:#a78bfa; padding:1px 7px; border-radius:20px;">' +
      (q.questionType || 'objective').toUpperCase() + '</span>';
    var etBadge  = '<span style="font-size:10px; font-weight:700; background:rgba(255,165,0,0.1); color:#ffa500; padding:1px 7px; border-radius:20px;">' +
      (q.examType || '?').toUpperCase() + '</span>';
    return '<tr id="qmsOrphanRow-' + safeId + '">' +
      '<td><input type="checkbox" ' + isChecked + ' onchange="qmsOrphanToggleRow(\'' + safeId + '\',this)" style="accent-color:#6c63ff;" /></td>' +
      '<td style="max-width:320px; font-size:13px; font-weight:600; color:#fff; line-height:1.4;">' +
        (q.question || '').substring(0, 90) + (q.question && q.question.length > 90 ? '…' : '') +
      '</td>' +
      '<td>' + etBadge + '</td>' +
      '<td>' + qtBadge + '</td>' +
      '<td style="font-size:12px; text-transform:capitalize; color:var(--text-secondary);">' + (q.difficulty || '—') + '</td>' +
      '<td style="font-size:11px; color:var(--text-muted);">' +
        (q.createdAt ? new Date(q.createdAt).toLocaleDateString('en-NG') : '—') +
      '</td>' +
    '</tr>';
  }).join('');

  /* Pagination */
  var pages  = res.data.pages || 1;
  var pagDiv = document.getElementById('qmsOrphanPagination');
  if (pagDiv && pages > 1) {
    var btns = '';
    for (var p = 1; p <= Math.min(pages, 8); p++) {
      btns += '<button class="a-btn a-btn-sm ' + (p === _qmsOrphanPage ? 'a-btn-primary' : 'a-btn-secondary') +
              '" onclick="qmsOrphanLoad(' + p + ')">' + p + '</button>';
    }
    pagDiv.innerHTML    = btns;
    pagDiv.style.display = 'flex';
  } else if (pagDiv) {
    pagDiv.style.display = 'none';
  }
}

/* ---- Open Assign modal ---- */
async function qmsOrphanOpenAssign() {
  var count = Object.keys(_qmsOrphanSelected).length;
  if (!count) { instToast('Select questions first.', 'error'); return; }

  var infoEl = document.getElementById('qmsOrphanAssignInfo');
  if (infoEl) infoEl.innerHTML =
    '<strong style="color:#fff;">' + count + ' question' + (count !== 1 ? 's' : '') + ' selected.</strong> ' +
    'Choose the Department and Subject to assign them to. ' +
    '<strong style="color:#ffa500;">The Subject must already exist in CBT Management.</strong>';

  var errEl = document.getElementById('qmsOrphanAssignErr');
  if (errEl) errEl.style.display = 'none';

  await qmsOrphanLoadAssignDepts();
  document.getElementById('qmsOrphanAssignModal').style.display = 'flex';
}

async function qmsOrphanLoadAssignDepts() {
  var examType = (document.getElementById('qmsOrphanExamType') || {}).value || 'jamb';
  var sel      = document.getElementById('qmsOrphanDept');
  if (!sel) { return; }
  sel.innerHTML = '<option value="">Loading...</option>';

  var res = await qmsApi('/departments?examCategory=' + examType);
  var depts = res.ok ? (res.data.departments || []) : [];
  sel.innerHTML = '<option value="">— Select Department —</option>' +
    depts.map(function (d) {
      return '<option value="' + d._id + '" data-name="' + esc(d.name) + '">' + d.name + '</option>';
    }).join('');

  var sj = document.getElementById('qmsOrphanSubject');
  if (sj) sj.innerHTML = '<option value="">— Select Department first —</option>';
}

async function qmsOrphanLoadAssignSubjects() {
  var deptSel  = document.getElementById('qmsOrphanDept');
  var deptId   = deptSel ? deptSel.value : '';
  var subjSel  = document.getElementById('qmsOrphanSubject');
  if (!subjSel) { return; }
  subjSel.innerHTML = '<option value="">— All Subjects in Department —</option>';
  if (!deptId) { return; }
  var res = await qmsApi('/subjects?departmentId=' + deptId);
  (res.ok ? (res.data.subjects || []) : []).forEach(function (s) {
    var opt = document.createElement('option');
    opt.value        = s._id;
    opt.dataset.name = s.name;
    opt.textContent  = s.name;
    subjSel.appendChild(opt);
  });
}

async function qmsOrphanConfirmAssign() {
  var ids    = Object.keys(_qmsOrphanSelected);
  if (!ids.length) { return; }

  var examTypeSel = document.getElementById('qmsOrphanExamType');
  var qtypeSel    = document.getElementById('qmsOrphanQType');
  var deptSel     = document.getElementById('qmsOrphanDept');
  var subjSel     = document.getElementById('qmsOrphanSubject');
  var errEl       = document.getElementById('qmsOrphanAssignErr');
  var btn         = document.getElementById('qmsOrphanConfirmAssignBtn');

  var subjId   = subjSel ? subjSel.value : '';
  var subjOpt  = subjSel && subjSel.selectedOptions[0];
  var deptOpt  = deptSel && deptSel.selectedOptions[0];
  var examType = examTypeSel ? examTypeSel.value : 'jamb';
  var qType    = qtypeSel ? qtypeSel.value : 'objective';

  if (errEl) errEl.style.display = 'none';

  if (!subjId) {
    if (errEl) { errEl.textContent = 'Please select a Subject.'; errEl.style.display = 'block'; }
    return;
  }

  if (btn) { btn.disabled = true; btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:6px;"></span>Assigning...'; }

  var payload = {
    ids:            ids,
    subjectId:      subjId,
    subjectName:    subjOpt ? (subjOpt.dataset.name || subjOpt.text || '') : '',
    departmentId:   deptSel ? deptSel.value : '',
    departmentName: deptOpt ? (deptOpt.dataset.name || deptOpt.text || '') : '',
    examType:       examType,
    questionType:   qType
  };

  var res = await qmsApi('/bank/orphans/assign', 'POST', payload);

  if (btn) { btn.disabled = false; btn.innerHTML = '📌 Assign Questions'; }

  if (res.ok) {
    instToast(res.data.message, 'success');
    closeAdminModal('qmsOrphanAssignModal');
    _qmsOrphanSelected = {};
    qmsOrphanUpdateBtn();
    qmsOrphanLoad(1);
  } else {
    if (errEl) { errEl.textContent = res.data.message || 'Assignment failed.'; errEl.style.display = 'block'; }
  }
}

/* ============================================================
   ✅ STAGE 2 — QUESTION EDITOR CONSOLIDATION
   Single QMS question editor for CBT Management.
   Legacy model is preserved but no longer the default path.
============================================================ */

/* Global create-mode state — set by qmsOpenCreate(), cleared by qmsSaveEdit() */
var _qmsCreateMode = false;
var _qmsCreateOpts = null;

/* ---- Called from CBT Management "Add Question" button ---- */
function qmsCreateForSubject() {
  if (!_cbtSelSubj) {
    adminToast('Select a subject first.', 'error');
    return;
  }
  qmsOpenCreate({
    subjectId:      _cbtSelSubj._id,
    subjectName:    _cbtSelSubj.name,
    examType:       _cbtCat   || 'jamb',
    questionType:   'objective',
    departmentId:   _cbtSelDept ? _cbtSelDept._id  : '',
    departmentName: _cbtSelDept ? _cbtSelDept.name : ''
  });
}

/* ---- Open qmsEditModal in create mode ---- */
function qmsOpenCreate(opts) {
  _qmsCreateMode = true;
  _qmsCreateOpts = opts;

  /* Clear any previous error */
  var errEl = document.getElementById('qmsEditErrBox');
  if (errEl) errEl.style.display = 'none';

  /* Empty all fields */
  ['qmsEditQuestion', 'qmsEditOptA', 'qmsEditOptB', 'qmsEditOptC', 'qmsEditOptD',
   'qmsEditTopic', 'qmsEditExpl', 'qmsEditReason', 'qmsEditYear'].forEach(function (fid) {
    var el = document.getElementById(fid);
    if (el) el.value = '';
  });

  /* Set sensible defaults */
  var correctEl = document.getElementById('qmsEditCorrect');
  if (correctEl) correctEl.value = '0';
  var statusEl = document.getElementById('qmsEditStatus');
  if (statusEl) statusEl.value = 'approved';
  var diffEl = document.getElementById('qmsEditDifficulty');
  if (diffEl) diffEl.value = 'medium';

  /* Clear ID — this signals create mode to qmsSaveEdit() */
  var idEl = document.getElementById('qmsEditId');
  if (idEl) idEl.value = '';

  /* Update modal title and save button */
  var titleEl = document.getElementById('qmsEditTitle');
  if (titleEl) {
    titleEl.textContent = 'Create Question — ' + esc(opts.subjectName || '') +
      (opts.examType ? ' (' + opts.examType.toUpperCase() + ')' : '');
  }
  var saveBtn = document.getElementById('qmsEditSaveBtn');
  if (saveBtn) saveBtn.textContent = 'Create Question';

  /* Hide "Version History" button — does not apply to new questions */
  var footerBtns = document.querySelectorAll('#qmsEditModal .t-modal-footer button');
  footerBtns.forEach(function (btn) {
    if (btn.getAttribute('onclick') && btn.getAttribute('onclick').indexOf('qmsViewVersions') !== -1) {
      btn.style.display = 'none';
    }
  });

  document.getElementById('qmsEditModal').style.display = 'flex';

  /* ✅ STEP 2: Inject theory fields (idempotent), set initial type, toggle */
  qmsEnsureEditorTheoryFields();
  var qtSel = document.getElementById('qmsEditQuestionType');
  if (qtSel) { qtSel.value = opts.questionType || 'objective'; }
  var maEl  = document.getElementById('qmsEditModelAnswer');
  if (maEl)  { maEl.value  = ''; }
  qmsToggleEditorForType(opts.questionType || 'objective');

  /* Focus the question textarea */
  setTimeout(function () {
    var ta = document.getElementById('qmsEditQuestion');
    if (ta) ta.focus();
  }, 120);
}

/* ---- Soft delete a question from CBT Management view ---- */
async function qmsSoftDeleteFromCbt(id) {
  if (!confirm(
    'Remove this question from the pool?\n\n' +
    'The question will be soft-deleted and can be restored from the Question Bank tab.'
  )) { return; }

  var res = await qmsApi('/bank/' + id, 'DELETE');
  if (res.ok) {
    instToast('Question removed from pool.', 'success');
    /* Refresh both question panel and subject pool count */
    loadCbtQuestions();
    loadCbtSubjects();
  } else {
    instToast(res.data.message || 'Delete failed.', 'error');
  }
}

/* ---- Emergency: load legacy questions from the old Question model ----
   Only accessible via the 📁 Legacy button in CBT Management.
   Does not modify any data. Read-only display.            */
async function loadCbtQuestionsLegacy() {
  var panel   = document.getElementById('cbtQPanel');
  var countEl = document.getElementById('cbtQCount');

  if (!_cbtSelSubj) { return; }
  if (panel) panel.innerHTML =
    '<div style="color:var(--text-muted); font-size:14px; text-align:center; padding:24px;">Loading legacy questions...</div>';

  var res = await apiRequest('/exams/admin/subjects/' + _cbtSelSubj._id + '/questions');
  if (!res.ok) { adminToast('Failed to load legacy questions.', 'error'); return; }

  var questions = res.data.questions || [];
  if (countEl) countEl.textContent = questions.length + ' legacy question' + (questions.length !== 1 ? 's' : '');

  if (!panel) { return; }

  var backBtn = '<button class="a-btn a-btn-secondary a-btn-sm" onclick="loadCbtQuestions()" style="margin-left:auto;">← Back to QMS Questions</button>';

  if (!questions.length) {
    panel.innerHTML =
      '<div style="background:rgba(67,233,123,0.08); border-bottom:1px solid rgba(67,233,123,0.2); padding:10px 16px; font-size:12px; color:#43e97b; display:flex; align-items:center; gap:8px;">' +
        '<span>✅ No legacy questions remain for this subject. All questions are in the QMS Question Pool.</span>' + backBtn +
      '</div>';
    return;
  }

  var letters = ['A', 'B', 'C', 'D'];

  panel.innerHTML =
    '<div style="background:rgba(255,165,0,0.08); border-bottom:1px solid rgba(255,165,0,0.2); padding:10px 16px; font-size:12px; color:#ffa500; display:flex; align-items:center; flex-wrap:wrap; gap:8px;">' +
      '<span>📦 <strong>Stage 5 — Legacy Archive</strong> — ' + questions.length + ' legacy question' + (questions.length !== 1 ? 's' : '') + ' remain. ' +
      'Delete individually to complete cleanup. No new questions can be added here.</span>' +
      backBtn +
    '</div>' +
    questions.map(function (q, i) {
      var opts = (q.options || []).map(function (opt, idx) {
        var isCorrect = idx === q.correctAnswer;
        return '<span style="font-size:11px; padding:2px 7px; border-radius:4px; margin-right:4px; margin-bottom:4px; display:inline-block;' +
          'background:' + (isCorrect ? 'rgba(67,233,123,0.15)' : 'rgba(255,255,255,0.04)') + ';' +
          'color:'       + (isCorrect ? '#43e97b'               : 'var(--text-secondary)') + ';">' +
          (letters[idx] || idx) + ': ' + opt + (isCorrect ? ' ✓' : '') +
        '</span>';
      }).join('');

      return '<div class="cbt-q-item" style="opacity:0.85;">' +
        '<div style="display:flex; align-items:flex-start; gap:12px;">' +
          '<span style="width:24px; height:24px; border-radius:6px; background:rgba(255,165,0,0.1); color:#ffa500; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:11px; flex-shrink:0;">' + (i + 1) + '</span>' +
          '<div style="flex:1; min-width:0;">' +
            '<div style="font-size:13px; font-weight:600; color:#fff; margin-bottom:6px; line-height:1.5;">' + q.question + '</div>' +
            '<div style="display:flex; flex-wrap:wrap; gap:2px; margin-bottom:4px;">' + opts + '</div>' +
            (q.explanation ? '<div style="font-size:11px; color:var(--text-muted); font-style:italic; margin-top:4px;">💡 ' + q.explanation + '</div>' : '') +
          '</div>' +
          '<button onclick="deleteCbtQuestion(\'' + q._id + '\')" ' +
            'style="padding:4px 8px; border-radius:6px; font-size:12px; cursor:pointer; font-family:inherit; background:rgba(255,101,132,0.08); border:1px solid rgba(255,101,132,0.25); color:#ff6584; flex-shrink:0;" ' +
            'title="Delete legacy question permanently">🗑</button>' +
        '</div>' +
      '</div>';
    }).join('');
}

/* ============================================================
   ✅ STAGE 3 — LEGACY MIGRATION TOOL
   Dry-run analysis → verify → commit.
   Legacy model never deleted. Idempotent.
============================================================ */

var _migDryRunData = null; /* stores last dry-run result */

/* ---- Load and render migration status ---- */
async function qmsMigrationLoadStatus() {
  var el = document.getElementById('qmsMigStatusContent');
  if (!el) { return; }
  el.innerHTML = '<div style="text-align:center; padding:12px; color:var(--text-muted);">Loading...</div>';

  var res = await qmsApi('/migrate/status');
  if (!res.ok) {
    el.innerHTML = '<div style="color:#ff6584; font-size:13px; padding:8px;">' +
      (res.data.message || 'Failed to load status.') + '</div>';
    return;
  }

  var s       = res.data.status;
  var legacy  = s.legacy   || {};
  var qms     = s.qms      || {};
  var jobs    = s.jobs     || [];
  var migPct  = legacy.total > 0
    ? Math.round((qms.migrated / legacy.total) * 100)
    : 0;

  var statusColor = s.isMigrated ? '#43e97b' : '#ffa500';
  var statusLabel = s.isMigrated ? '✅ Migration Completed' : '⏳ Not Yet Migrated';

  el.innerHTML =
    '<div style="display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-bottom:16px;">' +
      _migStatCard('📁', legacy.total.toLocaleString(),    'Legacy Questions (Total)', 'rgba(255,165,0,0.1)',  '#ffa500') +
      _migStatCard('✅', legacy.active.toLocaleString(),   'Legacy Active',            'rgba(108,99,255,0.1)', '#a78bfa') +
      _migStatCard('🧠', qms.migrated.toLocaleString(),    'Migrated to QMS',          'rgba(67,233,123,0.1)', '#43e97b') +
    '</div>' +

    '<div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">' +
      '<div style="background:rgba(255,255,255,0.03); border:1px solid var(--border,rgba(255,255,255,0.08)); border-radius:12px; padding:16px;">' +
        '<div style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.4px; margin-bottom:10px;">Migration Progress</div>' +
        '<div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">' +
          '<div style="font-size:28px; font-weight:900; color:' + statusColor + ';">' + migPct + '%</div>' +
          '<div style="font-size:13px; font-weight:700; color:' + statusColor + ';">' + statusLabel + '</div>' +
        '</div>' +
        '<div style="background:rgba(255,255,255,0.06); border-radius:20px; height:10px; overflow:hidden;">' +
          '<div style="background:linear-gradient(90deg,#43e97b,#38f9d7); width:' + migPct + '%; height:100%; border-radius:20px; transition:width 0.5s;"></div>' +
        '</div>' +
        '<div style="font-size:12px; color:var(--text-muted); margin-top:8px;">' +
          qms.migrated.toLocaleString() + ' of ' + legacy.total.toLocaleString() + ' legacy questions in QMS' +
        '</div>' +
      '</div>' +

      '<div style="background:rgba(255,255,255,0.03); border:1px solid var(--border,rgba(255,255,255,0.08)); border-radius:12px; padding:16px;">' +
        '<div style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.4px; margin-bottom:10px;">QMS Question Bank</div>' +
        _migInfoRow('Total in Bank',  qms.total.toLocaleString(),    '#fff') +
        _migInfoRow('Approved',       qms.approved.toLocaleString(), '#43e97b') +
        _migInfoRow('From Migration', qms.migrated.toLocaleString(), '#a78bfa') +
      '</div>' +
    '</div>' +

    (jobs.length
      ? '<div style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.4px; margin-bottom:8px;">Migration History</div>' +
        '<div style="background:rgba(255,255,255,0.02); border-radius:10px; overflow:hidden;">' +
        jobs.map(function (j) {
          var jColor = j.status === 'completed' ? '#43e97b' : j.status === 'partial' ? '#ffa500' : '#ff6584';
          return '<div style="display:flex; align-items:center; gap:12px; padding:10px 14px; border-bottom:1px solid var(--border,rgba(255,255,255,0.06)); flex-wrap:wrap;">' +
            '<span style="font-size:11px; color:var(--text-muted); white-space:nowrap;">' + new Date(j.createdAt).toLocaleString('en-NG') + '</span>' +
            '<span style="font-size:12px; color:#fff; font-weight:700;">By: ' + esc(j.importedBy || '—') + '</span>' +
            '<span style="font-size:12px; color:#43e97b; margin-left:auto; font-weight:700;">' + (j.stats.imported || 0).toLocaleString() + ' migrated</span>' +
            '<span style="font-size:11px; font-weight:700; color:' + jColor + ';">' + (j.status || '').toUpperCase() + '</span>' +
          '</div>';
        }).join('') + '</div>'
      : '<div style="font-size:13px; color:var(--text-muted); padding:8px 0;">No migration runs yet.</div>');
}

function _migStatCard(icon, val, label, bg, color) {
  return '<div style="background:' + bg + '; border-radius:12px; padding:16px; display:flex; align-items:center; gap:12px;">' +
    '<div style="font-size:22px;">' + icon + '</div>' +
    '<div>' +
      '<div style="font-size:22px; font-weight:900; color:' + color + '; line-height:1;">' + val + '</div>' +
      '<div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.4px; margin-top:3px;">' + label + '</div>' +
    '</div>' +
  '</div>';
}

function _migInfoRow(label, val, color) {
  return '<div style="display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid rgba(255,255,255,0.04);">' +
    '<span style="font-size:12px; color:var(--text-secondary);">' + label + '</span>' +
    '<span style="font-size:12px; font-weight:700; color:' + color + ';">' + val + '</span>' +
  '</div>';
}

/* ---- Run Dry-Run Analysis ---- */
async function qmsMigrationDryRun() {
  var btn     = document.getElementById('qmsMigDryRunBtn');
  var content = document.getElementById('qmsMigDryRunContent');
  if (!content) { return; }

  if (btn) {
    btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:6px;"></span> Analysing...';
    btn.disabled  = true;
  }

  content.innerHTML =
    '<div style="text-align:center; padding:20px; color:var(--text-muted);">' +
    '<span style="display:inline-block;width:18px;height:18px;border:2px solid rgba(255,255,255,0.2);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:8px;"></span>' +
    'Scanning legacy questions — this may take a moment...</div>';

  /* ✅ FIX: Add a 45-second timeout. Without this, if the backend
     hangs (e.g. MongoDB Atlas slow query), the UI freezes forever.
     The qmsApi catch handles network errors; this handles hangs. */
  var timeoutPromise = new Promise(function (resolve) {
    setTimeout(function () {
      resolve({ ok: false, status: 0, data: { message: 'Request timed out after 45 seconds. Please check the server logs and try again.' } });
    }, 45000);
  });

  var res = await Promise.race([qmsApi('/migrate/dry-run'), timeoutPromise]);

 if (btn) { btn.innerHTML = '🔍 Run Analysis'; btn.disabled = false; }

  if (!res.ok) {
    content.innerHTML =
      '<div style="background:rgba(255,101,132,0.08); border:1px solid rgba(255,101,132,0.25); ' +
      'border-radius:10px; padding:16px; font-size:13px; color:#ff6584; line-height:1.7;">' +
      '❌ <strong>Analysis failed:</strong> ' + esc(res.data.message || 'Unknown error.') + '<br>' +
      '<span style="font-size:12px; color:var(--text-muted);">Check the Railway server logs for more details. ' +
      'Common causes: MongoDB connection timeout, missing permissions.</span>' +
      '</div>';
    return;
  }

  /* ✅ FIX: Guard against undefined analysis (edge case where server
     returns ok:true but no analysis object). */
  if (!res.data || !res.data.analysis) {
    content.innerHTML =
      '<div style="color:#ffa500; padding:16px; font-size:13px;">' +
      '⚠️ Analysis returned no data. Please check server logs and try again.</div>';
    return;
  }

  _migDryRunData = res.data.analysis;

  try {
    qmsMigrationRenderDryRun(_migDryRunData);
  } catch (renderErr) {
    console.error('[Migration] Render error:', renderErr.message);
    content.innerHTML =
      '<div style="color:#ff6584; padding:16px; font-size:13px;">' +
      'Display error: ' + esc(renderErr.message) + '</div>';
    return;
  }

  try {
    _migrationUnlockCommit(_migDryRunData);
  } catch (unlockErr) {
    console.error('[Migration] Unlock error:', unlockErr.message);
  }

  /* Highlight step badges */
  var s1 = document.getElementById('migStep1Badge');
  var s2 = document.getElementById('migStep2Badge');
  if (s1) { s1.style.background = 'rgba(67,233,123,0.12)'; s1.style.borderColor = 'rgba(67,233,123,0.3)'; s1.querySelector('span:first-child').style.color = '#43e97b'; s1.querySelector('span:last-child').style.color = '#43e97b'; }
  if (s2) { s2.style.background = 'rgba(255,165,0,0.1)';   s2.style.borderColor = 'rgba(255,165,0,0.3)';   s2.querySelector('span:first-child').style.color = '#ffa500'; s2.querySelector('span:last-child').style.color = '#ffa500'; }
}

/* ---- Render dry-run report ---- */
function qmsMigrationRenderDryRun(analysis) {
  var content = document.getElementById('qmsMigDryRunContent');
  if (!content || !analysis) { return; }

  var s   = analysis.summary;
  var rows = analysis.bySubject || [];

  /* Status colour helper */
  var statusColors = { ready: '#43e97b', partial: '#ffa500', all_duplicate: '#a0a0c0', no_subject: '#ff6584' };
  var statusLabels = { ready: '✅ Ready', partial: '⚠️ Partial', all_duplicate: '🔁 All Duplicate', no_subject: '❌ No Subject' };

  var orphanHtml = '';
  if (analysis.orphans && analysis.orphans.count > 0) {
    var sample = analysis.orphans.sample || [];
    orphanHtml =
      '<div style="background:rgba(255,101,132,0.08); border:1px solid rgba(255,101,132,0.2); border-radius:10px; padding:14px 16px; margin-bottom:16px;">' +
        '<div style="font-size:13px; font-weight:700; color:#ff6584; margin-bottom:6px;">' +
          '⚠️ ' + analysis.orphans.count + ' Orphan Question' + (analysis.orphans.count !== 1 ? 's' : '') +
          ' — will NOT be migrated (no Subject assigned)' +
        '</div>' +
        '<div style="font-size:12px; color:var(--text-secondary); line-height:1.7;">' +
          'These questions exist in the legacy model but have no Subject assigned. ' +
          'Use the <strong style="color:#fff;">🔗 Unassigned</strong> tab to assign legacy questions before migration, ' +
          'or migrate after using the orphan cleanup tool.' +
        '</div>' +
        (sample.length
          ? '<div style="margin-top:10px; font-size:11px; color:var(--text-muted);">Sample: ' +
              sample.slice(0, 3).map(function (q) { return '"' + esc(q.question) + '"'; }).join(', ') +
            (analysis.orphans.count > 3 ? '... and more' : '') + '</div>'
          : '') +
      '</div>';
  }

  content.innerHTML =

    /* Summary row */
    '<div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:20px;">' +
      _migStatCard('📋', s.totalLegacy.toLocaleString(),  'Legacy Total',    'rgba(255,255,255,0.04)', '#fff') +
      _migStatCard('✅', s.toMigrate.toLocaleString(),    'Will Migrate',    'rgba(67,233,123,0.1)',  '#43e97b') +
      _migStatCard('🔁', s.alreadyInQMS.toLocaleString(), 'Already in QMS',  'rgba(255,165,0,0.1)',   '#ffa500') +
      _migStatCard('⚠️', s.orphanCount.toLocaleString(),  'No Subject',      'rgba(255,101,132,0.1)', '#ff6584') +
    '</div>' +

    orphanHtml +

    /* Exam type breakdown */
    (Object.keys(analysis.examTypeBreakdown || {}).length
      ? '<div style="background:rgba(255,255,255,0.03); border:1px solid var(--border,rgba(255,255,255,0.08)); border-radius:10px; padding:12px 16px; margin-bottom:16px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">' +
          '<span style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.4px;">By Exam Type:</span>' +
          Object.keys(analysis.examTypeBreakdown).map(function (et) {
            return '<span style="font-size:12px; font-weight:700; background:rgba(108,99,255,0.12); color:#a78bfa; padding:2px 10px; border-radius:20px;">' +
              et.toUpperCase() + ': ' + analysis.examTypeBreakdown[et] + '</span>';
          }).join('') +
        '</div>'
      : '') +

    /* Subject breakdown table */
    '<div class="a-card">' +
      '<div class="a-card-head"><h3>Subject Breakdown (' + rows.length + ' subjects)</h3></div>' +
      '<div class="a-table-wrap">' +
        '<table class="admin-table">' +
          '<thead><tr>' +
            '<th>Subject</th><th>Department</th><th>Legacy</th>' +
            '<th>Will Migrate</th><th>Already in QMS</th><th>Inactive</th><th>Status</th>' +
          '</tr></thead>' +
          '<tbody>' +
          (rows.length
            ? rows.map(function (r) {
                var sc = statusColors[r.status] || '#fff';
                var sl = statusLabels[r.status] || r.status;
                return '<tr>' +
                  '<td style="font-weight:700; color:#fff;">' + esc(r.subjectName) + '</td>' +
                  '<td style="font-size:12px; color:var(--text-secondary);">' + esc(r.departmentName) + '</td>' +
                  '<td style="font-weight:700; color:#fff;">'   + r.legacyCount + '</td>' +
                  '<td style="font-weight:700; color:#43e97b;">' + r.toMigrate   + '</td>' +
                  '<td style="color:#ffa500;">'                  + r.alreadyInQMS + '</td>' +
                  '<td style="color:var(--text-muted);">'        + r.inactive    + '</td>' +
                  '<td><span style="font-size:11px; font-weight:700; color:' + sc + ';">' + sl + '</span></td>' +
                '</tr>';
              }).join('')
            : '<tr><td colspan="7" style="text-align:center; padding:28px; color:var(--text-muted);">No legacy questions with subjects found.</td></tr>'
          ) +
          '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>';
}

/* ---- Unlock commit step after dry-run ---- */
function _migrationUnlockCommit(analysis) {
  var commitContent = document.getElementById('qmsMigCommitContent');
  var lockEl        = document.getElementById('qmsMigCommitLock');
  var step3         = document.getElementById('migStep3Badge');

  /* ✅ FIX: Guard against null/undefined analysis */
  if (!analysis || !analysis.summary) {
    if (commitContent) {
      commitContent.innerHTML =
        '<div style="color:var(--text-muted); font-size:13px; padding:16px; text-align:center;">' +
        'Run the dry-run analysis to unlock this step.</div>';
    }
    return;
  }

  if (lockEl) lockEl.style.display = 'none';
  if (step3) {
    step3.style.background   = 'rgba(255,165,0,0.1)';
    step3.style.borderColor  = 'rgba(255,165,0,0.3)';
    step3.querySelector('span:first-child').style.color = '#ffa500';
    step3.querySelector('span:last-child').style.color  = '#ffa500';
  }

  if (!commitContent) { return; }

  var s         = analysis.summary;
  var canMigrate = s.toMigrate > 0;

  commitContent.innerHTML =
    '<div style="background:rgba(255,255,255,0.03); border:1px solid var(--border,rgba(255,255,255,0.08)); border-radius:12px; padding:18px; margin-bottom:16px;">' +
      '<div style="font-size:14px; font-weight:700; color:#fff; margin-bottom:12px;">Migration Summary</div>' +
      _migInfoRow('Questions to migrate',       s.toMigrate.toLocaleString(),    '#43e97b') +
      _migInfoRow('Already in QMS (will skip)', s.alreadyInQMS.toLocaleString(), '#ffa500') +
      _migInfoRow('Orphans (will skip)',         s.orphanCount.toLocaleString(),  '#ff6584') +
      _migInfoRow('Missing subjects (will skip)',String(s.missingSubjects),       '#ff6584') +
      '<div style="margin-top:14px; font-size:12px; color:var(--text-muted); line-height:1.7;">' +
        '• The legacy Question model will <strong style="color:#fff;">NOT be modified or deleted</strong>.<br>' +
        '• Migrated questions get <code style="background:rgba(255,255,255,0.06); padding:0 4px; border-radius:3px;">source: \'legacy_migration\'</code>.<br>' +
        '• You can run the migration multiple times safely — duplicates are always skipped.<br>' +
        '• After migration, run the dry-run again to verify the result.' +
      '</div>' +
    '</div>' +

    (canMigrate
      ? '<div id="qmsMigConfirmRow" style="background:rgba(255,101,132,0.06); border:1px solid rgba(255,101,132,0.2); border-radius:10px; padding:14px 16px; margin-bottom:14px;">' +
          '<div style="font-size:13px; color:#ff6584; font-weight:700; margin-bottom:6px;">⚠️ Confirm Before Proceeding</div>' +
          '<div style="font-size:12px; color:var(--text-secondary); margin-bottom:10px; line-height:1.7;">' +
            'You are about to migrate <strong style="color:#fff;">' + s.toMigrate.toLocaleString() + ' questions</strong> ' +
            'into the QMS Question Bank. This is safe and reversible through the legacy model, but may take a moment.' +
          '</div>' +
          '<label style="display:flex; align-items:center; gap:8px; cursor:pointer;">' +
            '<input type="checkbox" id="qmsMigConfirmCheck" style="accent-color:#ff6584; width:16px; height:16px;" />' +
            '<span style="font-size:13px; font-weight:700; color:#fff;">I have reviewed the dry-run report and want to proceed</span>' +
          '</label>' +
        '</div>' +
        '<button class="a-btn a-btn-primary" id="qmsMigCommitBtn" onclick="qmsMigrationCommit()" ' +
          'style="width:100%; font-size:15px; padding:14px;">' +
          '⚡ Commit Migration (' + s.toMigrate.toLocaleString() + ' questions)' +
        '</button>'
      : '<div style="text-align:center; padding:20px; font-size:14px; color:#43e97b; font-weight:700;">' +
          '✅ All legacy questions are already in QMS. No migration needed.' +
        '</div>');
}

/* ---- Execute the migration ---- */
async function qmsMigrationCommit() {
  var checkEl = document.getElementById('qmsMigConfirmCheck');
  if (!checkEl || !checkEl.checked) {
    instToast('Please check the confirmation checkbox to proceed.', 'error');
    return;
  }

  if (!confirm(
    'BEGIN MIGRATION?\n\n' +
    'This will copy ' + (_migDryRunData ? _migDryRunData.summary.toMigrate.toLocaleString() : 'all eligible') + ' legacy questions into the QMS Question Bank.\n\n' +
    'The legacy model will NOT be modified.\n\n' +
    'Continue?'
  )) { return; }

  var btn     = document.getElementById('qmsMigCommitBtn');
  var content = document.getElementById('qmsMigCommitContent');

  if (btn) {
    btn.innerHTML = '<span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:8px;"></span> Migrating — please wait...';
    btn.disabled  = true;
  }

  var res = await qmsApi('/migrate/commit', 'POST', { confirm: true });

  if (btn) { btn.innerHTML = '⚡ Commit Migration'; btn.disabled = false; }

  if (!res.ok) {
    instToast(res.data.message || 'Migration failed.', 'error');
    return;
  }

  var r = res.data.results;
  qmsMigrationRenderCommitResult(res.data);

  /* Step 3 badge: complete */
  var step3 = document.getElementById('migStep3Badge');
  if (step3) {
    step3.style.background  = 'rgba(67,233,123,0.12)';
    step3.style.borderColor = 'rgba(67,233,123,0.3)';
    step3.querySelector('span:first-child').style.color = '#43e97b';
    step3.querySelector('span:last-child').style.color  = '#43e97b';
  }

  instToast('✅ Migration complete — ' + r.migrated.toLocaleString() + ' questions migrated.', 'success');

  /* Refresh status card */
  setTimeout(qmsMigrationLoadStatus, 800);
}

/* ---- Render commit result ---- */
function qmsMigrationRenderCommitResult(data) {
  var content = document.getElementById('qmsMigCommitContent');
  if (!content) { return; }

  var r  = data.results || {};
  var by = data.bySubject || [];

  var statusColor = r.status === 'completed' ? '#43e97b' : r.status === 'partial' ? '#ffa500' : '#ff6584';

  content.innerHTML =
    '<div style="background:rgba(67,233,123,0.08); border:1px solid rgba(67,233,123,0.25); border-radius:12px; padding:18px; margin-bottom:16px;">' +
      '<div style="font-size:16px; font-weight:800; color:#43e97b; margin-bottom:12px;">✅ Migration ' + (r.status === 'completed' ? 'Complete' : r.status === 'partial' ? 'Partially Complete' : 'Complete') + '</div>' +
      '<div style="display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:12px;">' +
        _migStatCard('✅', r.migrated.toLocaleString(),  'Migrated',        'rgba(67,233,123,0.1)',  '#43e97b') +
        _migStatCard('🔁', r.duplicate.toLocaleString(), 'Skipped (Dup)',   'rgba(255,165,0,0.1)',   '#ffa500') +
        _migStatCard('⚠️', (r.orphan + r.noSubject).toLocaleString(), 'Skipped (No Sub)', 'rgba(255,101,132,0.1)', '#ff6584') +
      '</div>' +
      '<div style="font-size:12px; color:var(--text-muted); line-height:1.8;">' +
        'Job ID: <code style="color:#a78bfa;">' + (r.jobId || '—') + '</code>' +
        ' &nbsp;·&nbsp; Processing time: ' + Math.round((r.processingMs || 0) / 1000) + 's' +
        ' &nbsp;·&nbsp; Status: <strong style="color:' + statusColor + ';">' + (r.status || '').toUpperCase() + '</strong>' +
      '</div>' +
    '</div>' +

    (by.length
      ? '<div class="a-card">' +
          '<div class="a-card-head"><h3>Migration Results by Subject</h3></div>' +
          '<div class="a-table-wrap">' +
            '<table class="admin-table">' +
              '<thead><tr><th>Subject</th><th>Migrated</th><th>Skipped (Dup)</th><th>Skipped (No Sub)</th><th>Errors</th></tr></thead>' +
              '<tbody>' +
              by.map(function (r) {
                return '<tr>' +
                  '<td style="font-weight:700; color:#fff;">' + esc(r.subjectName) + '</td>' +
                  '<td style="color:#43e97b; font-weight:700;">' + r.migrated   + '</td>' +
                  '<td style="color:#ffa500;">'                  + r.duplicate  + '</td>' +
                  '<td style="color:var(--text-muted);">'        + (r.noSubject || 0) + '</td>' +
                  '<td style="color:' + (r.errors > 0 ? '#ff6584' : 'var(--text-muted)') + ';">' + r.errors + '</td>' +
                '</tr>';
              }).join('') +
              '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>'
      : '') +

    '<div style="margin-top:16px; display:flex; gap:10px; flex-wrap:wrap;">' +
      '<button class="a-btn a-btn-secondary a-btn-sm" onclick="qmsMigrationDryRun()">🔍 Run Dry-Run Again (verify)</button>' +
      '<button class="a-btn a-btn-secondary a-btn-sm" onclick="qmsSwitchTab(\'bank\')">📚 View Question Bank</button>' +
    '</div>';
}

/* ============================================================
   ✅ STAGE 6 — EXAM TYPE MANAGEMENT FUNCTIONS
   CBT-only. Dynamic exam types replace hardcoded enums.
============================================================ */

/* ---- Open ExamType management modal ---- */
async function openExamTypeModal() {
  document.getElementById('examTypeModal').style.display = 'flex';
  await examTypeLoadTable();
  /* Clear create form */
  ['etNewKey','etNewLabel','etNewIcon','etNewDesc'].forEach(function (id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  var err = document.getElementById('examTypeCreateErr');
  if (err) err.style.display = 'none';
}

/* ---- Load exam types table in modal ---- */
async function examTypeLoadTable() {
  var tbody = document.getElementById('examTypeTableBody');
  if (!tbody) { return; }
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-muted);">Loading...</td></tr>';

  var res = await apiRequest('/exams/admin/exam-types');
  if (!res.ok) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:#ff6584; text-align:center; padding:16px;">' +
      esc(res.data.message || 'Failed.') + '</td></tr>';
    return;
  }

  var types = res.data.examTypes || [];
  if (!types.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--text-muted);">No exam types. Loading defaults...</td></tr>';
    return;
  }

  tbody.innerHTML = types.map(function (t) {
    var isBuiltIn   = t.isBuiltIn;
    var activeBadge = t.isActive
      ? '<span class="badge badge-active">Active</span>'
      : '<span class="badge badge-expired">Inactive</span>';
    var typeBadge = isBuiltIn
      ? '<span style="font-size:10px; font-weight:700; background:rgba(67,233,123,0.1); color:#43e97b; padding:1px 7px; border-radius:20px;">Built-in</span>'
      : '<span style="font-size:10px; font-weight:700; background:rgba(108,99,255,0.1); color:#a78bfa; padding:1px 7px; border-radius:20px;">Custom</span>';

    return '<tr>' +
      '<td style="font-size:18px;">' + esc(t.icon || '📝') + '</td>' +
      '<td style="font-family:monospace; font-size:12px; color:#a78bfa;">' + esc(t.key) + '</td>' +
      '<td style="font-weight:700; color:#fff;">' + esc(t.label) + '</td>' +
      '<td>' + typeBadge + '</td>' +
      '<td>' + activeBadge + '</td>' +
      '<td><div style="display:flex; gap:5px; flex-wrap:wrap;">' +
        (!isBuiltIn
          ? '<button class="a-btn a-btn-secondary a-btn-sm" onclick="examTypeToggle(\'' + t._id + '\',' + t.isActive + ')">' +
              (t.isActive ? 'Disable' : 'Enable') +
            '</button>' +
            '<button class="a-btn a-btn-danger a-btn-sm" onclick="examTypeDelete(\'' + t._id + '\',\'' + esc(t.label) + '\')">' +
              '🗑 Delete' +
            '</button>'
          : '<span style="font-size:11px; color:var(--text-muted);">Protected</span>'
        ) +
      '</div></td>' +
    '</tr>';
  }).join('');
}

/* ---- Create new exam type ---- */
async function examTypeCreate() {
  var key   = (document.getElementById('etNewKey')   || {}).value || '';
  var label = (document.getElementById('etNewLabel') || {}).value || '';
  var icon  = ((document.getElementById('etNewIcon')  || {}).value || '📝').trim() || '📝';
  var desc  = (document.getElementById('etNewDesc')  || {}).value || '';
  var errEl = document.getElementById('examTypeCreateErr');

  if (errEl) errEl.style.display = 'none';

  if (!key || !label) {
    if (errEl) { errEl.textContent = 'Key and label are required.'; errEl.style.display = 'block'; }
    return;
  }

  var res = await apiRequest('/exams/admin/exam-types', 'POST', {
    key: key, label: label, icon: icon, description: desc, isActive: true
  });

  if (res.ok) {
    instToast('Exam type "' + label + '" created.', 'success');
    /* Clear form */
    ['etNewKey','etNewLabel','etNewIcon','etNewDesc'].forEach(function (id) {
      var el = document.getElementById(id); if (el) el.value = '';
    });
    /* Refresh table and invalidate cache */
    _examTypesCache = null;
    await examTypeLoadTable();
    /* Refresh CBT pills */
    await loadCbtExamTypePills();
    /* Refresh QMS dropdowns */
    await qmsPopulateAllExamTypeDropdowns();
  } else {
    if (errEl) { errEl.textContent = res.data.message || 'Failed to create.'; errEl.style.display = 'block'; }
  }
}

/* ---- Toggle active state ---- */
async function examTypeToggle(id, currentlyActive) {
  var res = await apiRequest('/exams/admin/exam-types/' + id, 'PUT', {
    isActive: !currentlyActive
  });
  if (res.ok) {
    instToast('Exam type ' + (!currentlyActive ? 'enabled' : 'disabled') + '.', 'success');
    _examTypesCache = null;
    await examTypeLoadTable();
    await loadCbtExamTypePills();
    await qmsPopulateAllExamTypeDropdowns();
  } else {
    instToast(res.data.message || 'Failed.', 'error');
  }
}

/* ---- Delete exam type ---- */
async function examTypeDelete(id, label) {
  if (!confirm('Delete exam type "' + label + '"?\n\nThis cannot be undone. Any subjects or questions using this type will need to be reassigned.')) {
    return;
  }
  var res = await apiRequest('/exams/admin/exam-types/' + id, 'DELETE');
  if (res.ok) {
    instToast('Exam type deleted.', 'success');
    _examTypesCache = null;
    await examTypeLoadTable();
    await loadCbtExamTypePills();
    await qmsPopulateAllExamTypeDropdowns();
  } else {
    instToast(res.data.message || 'Failed.', 'error');
  }
}

console.log('🔧 Admin Dashboard loaded');