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
  'qms-import':     ['question_import', 'question_bank', 'question_engine', 'question_stats']
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

/* Entry point */
async function loadCbtManagement() {
  _cbtSelDept = null;
  _cbtSelSubj = null;

  var subjCard = document.getElementById('cbtSubjCard');
  var qCard    = document.getElementById('cbtQCard');
  if (subjCard) subjCard.style.display = 'none';
  if (qCard)    qCard.style.display    = 'none';

  await loadCbtDepts();
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

  panel.innerHTML = _cbtSubjects.map(function(s) {
    var isSelected = _cbtSelSubj && _cbtSelSubj._id === s._id;
    return '<div class="cbt-list-item' + (isSelected ? ' selected' : '') + '" ' +
      'onclick="selectCbtSubj(\'' + s._id + '\',\'' + (s.name || '').replace(/'/g, '') + '\')">' +
      '<div style="flex:1; min-width:0;">' +
        '<div class="cbt-list-item-name">' + (s.name || '') + '</div>' +
        '<div class="cbt-list-item-meta">' +
          (s.totalQuestions || 0) + ' questions · ' +
          (s.timeLimit || 0) + ' mins · ' +
          (s.questionCount || 0) + ' per session' +
        '</div>' +
      '</div>' +
      '<div style="display:flex; gap:4px; flex-shrink:0;">' +
        '<button onclick="event.stopPropagation(); openCbtSubjModal(\'' + s._id + '\')" ' +
          'style="padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; font-family:inherit; background:rgba(108,99,255,0.1); border:1px solid rgba(108,99,255,0.25); color:#a78bfa;">Edit</button>' +
        '<button onclick="event.stopPropagation(); deleteCbtSubj(\'' + s._id + '\',\'' + (s.name || '').replace(/'/g, '') + '\')" ' +
          'style="padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; font-family:inherit; background:rgba(255,101,132,0.08); border:1px solid rgba(255,101,132,0.25); color:#ff6584;">✕</button>' +
      '</div>' +
    '</div>';
  }).join('');
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

  if (!_cbtSelSubj) return;
  if (panel) panel.innerHTML = '<div style="color:var(--text-muted); font-size:14px; text-align:center; padding:24px;">Loading...</div>';

  var res = await apiRequest('/exams/admin/subjects/' + _cbtSelSubj._id + '/questions');
  if (!res.ok) { adminToast('Failed to load questions', 'error'); return; }

  _cbtQuestions = res.data.questions || [];
  if (countEl) countEl.textContent = _cbtQuestions.length + ' question' + (_cbtQuestions.length !== 1 ? 's' : '');
  if (!panel) return;

  if (_cbtQuestions.length === 0) {
    panel.innerHTML = '<div style="color:var(--text-muted); font-size:14px; text-align:center; padding:24px; line-height:1.7;">No questions yet.<br>Click "+ Add Question".</div>';
    return;
  }

  var letters = ['A', 'B', 'C', 'D'];

  panel.innerHTML = _cbtQuestions.map(function(q, i) {
    var opts = (q.options || []).map(function(opt, idx) {
      var isCorrect = idx === q.correctAnswer;
      return '<span style="font-size:11px; padding:2px 7px; border-radius:4px; margin-right:4px; margin-bottom:4px; display:inline-block;' +
        'background:' + (isCorrect ? 'rgba(67,233,123,0.15)' : 'rgba(255,255,255,0.04)') + ';' +
        'color:' + (isCorrect ? '#43e97b' : 'var(--text-secondary)') + ';' +
        'border:1px solid ' + (isCorrect ? 'rgba(67,233,123,0.3)' : 'var(--border,rgba(255,255,255,0.08))') + ';">' +
        letters[idx] + ': ' + opt + (isCorrect ? ' ✓' : '') +
      '</span>';
    }).join('');

    /* Category badge */
    var catBadge = q.examCategory && q.examCategory !== 'all'
      ? '<span style="font-size:10px; font-weight:700; padding:1px 6px; border-radius:10px; background:rgba(108,99,255,0.12); color:#a78bfa; margin-left:6px;">' + q.examCategory.toUpperCase() + '</span>'
      : '';

    return '<div class="cbt-q-item">' +
      '<div style="display:flex; align-items:flex-start; gap:12px;">' +
        '<span style="width:24px; height:24px; border-radius:6px; background:rgba(67,233,123,0.1); color:#43e97b; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:11px; flex-shrink:0;">' + (i+1) + '</span>' +
        '<div style="flex:1; min-width:0;">' +
          '<div style="font-size:13px; font-weight:600; color:#fff; margin-bottom:6px; line-height:1.5;">' + q.question + catBadge + '</div>' +
          '<div style="display:flex; flex-wrap:wrap; gap:2px; margin-bottom:4px;">' + opts + '</div>' +
          (q.explanation ? '<div style="font-size:11px; color:var(--text-muted); font-style:italic; margin-top:4px;">💡 ' + q.explanation + '</div>' : '') +
        '</div>' +
        '<button onclick="deleteCbtQuestion(\'' + q._id + '\')" ' +
          'style="padding:4px 8px; border-radius:6px; font-size:12px; cursor:pointer; font-family:inherit; background:rgba(255,101,132,0.08); border:1px solid rgba(255,101,132,0.25); color:#ff6584; flex-shrink:0;">🗑</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

/* Question modal */
function openCbtQModal() {
  if (!_cbtSelSubj) { adminToast('Select a subject first.', 'error'); return; }

  var form = document.getElementById('cbtQForm');
  if (form) form.reset();

  var h = document.getElementById('cbtQModalTitle');
  if (h) h.textContent = 'Add Question — ' + (_cbtSelSubj.name || '') + ' (' + _cbtCat.toUpperCase() + ')';

  /* Pre-select current category */
  var catEl = document.getElementById('cbtQCat');
  if (catEl) catEl.value = _cbtCat === 'practice' ? 'all' : _cbtCat;

  var modal = document.getElementById('cbtQModal');
  if (modal) modal.style.display = 'flex';

  setTimeout(function() {
    var el = document.getElementById('cbtQText'); if (el) el.focus();
  }, 100);
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

/* ---- Init: called when QMS section becomes active ---- */
async function qmsInit() {
  if (!_qmsDeptsLoaded) {
    await qmsLoadDepts();
    _qmsDeptsLoaded = true;
  }
}

/* ---- Sub-tab switching ---- */
function qmsSwitchTab(tab) {
  ['import', 'bank', 'engine', 'history', 'stats'].forEach(function (t) {
    var panel = document.getElementById('qmsPanel' + t.charAt(0).toUpperCase() + t.slice(1));
    if (panel) panel.style.display = (t === tab) ? 'block' : 'none';
    var btn   = document.getElementById('qmsTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn)  btn.classList.toggle('active', t === tab);
  });
  if (tab === 'history') qmsLoadHistory();
  if (tab === 'stats')   qmsLoadStats();
  if (tab === 'bank')    qmsBankLoad(1);
  if (tab === 'engine')  { qmsEngInit(); qmsEngLoadIntegrationStatus(); }
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
  var examTypeSel  = document.getElementById('qmsExamType');
  var deptSel      = document.getElementById('qmsDepartment');
  var subjSel      = document.getElementById('qmsSubject');
  var deptOpt      = deptSel && deptSel.selectedOptions[0];
  var subjOpt      = subjSel && subjSel.selectedOptions[0];
  return {
    examType:       examTypeSel ? examTypeSel.value : 'jamb',
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
  _qmsPreviewData = { preview: preview, meta: meta, sourceType: _qmsCurrentMethod === 'file' ? 'file' : 'paste', filename: res.data.filename || '' };
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
    questions:       preview.valid,
    examType:        meta.examType,
    departmentId:    meta.departmentId,
    subjectId:       meta.subjectId,
    subjectName:     meta.subjectName,
    departmentName:  meta.departmentName,
    sourceType:      _qmsPreviewData.sourceType,
    originalFilename: _qmsPreviewData.filename,
    stats:           preview.stats
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
  el.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">Loading...</div>';

  var res = await qmsApi('/stats');
  if (!res.ok) {
    el.innerHTML = '<div style="text-align:center; padding:40px; color:#ff6584;">' + (res.data.message || 'Failed to load stats.') + '</div>';
    return;
  }

  var s    = res.data.stats || {};
  var byET = s.byExamType || {};
  var etCards = Object.keys(byET).map(function (et) {
    return '<div class="a-stat-card"><div class="a-stat-icon">📝</div><div>' +
      '<div class="a-stat-val">' + byET[et] + '</div>' +
      '<div class="a-stat-lbl">' + et.toUpperCase() + '</div>' +
    '</div></div>';
  }).join('');

  el.innerHTML =
    '<div class="a-stats-grid" style="margin-bottom:20px;">' +
      '<div class="a-stat-card"><div class="a-stat-icon">📚</div><div><div class="a-stat-val">' + (s.total || 0) + '</div><div class="a-stat-lbl">Total Questions</div></div></div>' +
      '<div class="a-stat-card"><div class="a-stat-icon" style="background:rgba(67,233,123,0.1);">✅</div><div><div class="a-stat-val">' + (s.approved || 0) + '</div><div class="a-stat-lbl">Approved</div></div></div>' +
      '<div class="a-stat-card"><div class="a-stat-icon" style="background:rgba(255,165,0,0.1);">⏳</div><div><div class="a-stat-val">' + (s.pending || 0) + '</div><div class="a-stat-lbl">Pending Review</div></div></div>' +
      '<div class="a-stat-card"><div class="a-stat-icon" style="background:rgba(255,101,132,0.1);">📋</div><div><div class="a-stat-val">' + (s.totalJobs || 0) + '</div><div class="a-stat-lbl">Import Jobs</div></div></div>' +
    '</div>' +
    (etCards ? '<div style="margin-bottom:8px; font-size:13px; font-weight:700; color:var(--text-secondary,#a0a0c0); text-transform:uppercase; letter-spacing:0.5px;">By Exam Type</div>' +
    '<div style="display:grid; grid-template-columns:repeat(5,1fr); gap:12px; flex-wrap:wrap;">' + etCards + '</div>' : '');
}

/* ============================================================
   QMS PHASE 2 — QUESTION BANK
============================================================ */

var _qmsBankPage       = 1;
var _qmsBankTotal      = 0;
var _qmsBankSelected   = {}; /* { id: true } */
var _qmsBankSearchTimer = null;

/* ---- Debounced search ---- */
function qmsBankDebounceSearch() {
  if (_qmsBankSearchTimer) { clearTimeout(_qmsBankSearchTimer); }
  _qmsBankSearchTimer = setTimeout(function () { qmsBankLoad(1); }, 380);
}

/* ---- Build query string from filter controls ---- */
function qmsBankBuildQs(page) {
  var search = ((document.getElementById('qmsBankSearch')      || {}).value || '').trim();
  var exam   = (document.getElementById('qmsBankFilterExam')   || {}).value || '';
  var status = (document.getElementById('qmsBankFilterStatus') || {}).value || '';
  var diff   = (document.getElementById('qmsBankFilterDiff')   || {}).value || '';
  var qs     = '?page=' + (page || 1) + '&limit=25';
  if (search) qs += '&search=' + encodeURIComponent(search);
  if (exam)   qs += '&examType=' + exam;
  if (status) qs += '&status='  + status;
  if (diff)   qs += '&difficulty=' + diff;
  return qs;
}

/* ---- Load / reload the Question Bank table ---- */
async function qmsBankLoad(page) {
  _qmsBankPage    = page || 1;
  _qmsBankSelected = {};
  qmsUpdateBulkBar();

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

/* ---- Open Edit modal ---- */
async function qmsOpenEdit(id) {
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

  var flds = {
    qmsEditQuestion:   q.question     || '',
    qmsEditOptA:      (q.options[0]   || ''),
    qmsEditOptB:      (q.options[1]   || ''),
    qmsEditOptC:      (q.options[2]   || ''),
    qmsEditOptD:      (q.options[3]   || ''),
    qmsEditTopic:      q.topic        || '',
    qmsEditExpl:       q.explanation  || '',
    qmsEditReason:     '',
    qmsEditYear:       q.year         || ''
  };
  Object.keys(flds).forEach(function (id) {
    var el = document.getElementById(id); if (el) el.value = flds[id];
  });
  var correctEl = document.getElementById('qmsEditCorrect');
  if (correctEl) correctEl.value = String(q.correctAnswer || 0);
  var statusEl  = document.getElementById('qmsEditStatus');
  if (statusEl)  statusEl.value  = q.status     || 'approved';
  var diffEl    = document.getElementById('qmsEditDifficulty');
  if (diffEl)    diffEl.value    = q.difficulty || 'medium';
}

/* ---- Save Edit ---- */
async function qmsSaveEdit() {
  var id     = (document.getElementById('qmsEditId')       || {}).value || '';
  var errEl  = document.getElementById('qmsEditErrBox');
  var btn    = document.getElementById('qmsEditSaveBtn');
  if (!id) { return; }

  if (errEl) errEl.style.display = 'none';

  var optA = ((document.getElementById('qmsEditOptA') || {}).value || '').trim();
  var optB = ((document.getElementById('qmsEditOptB') || {}).value || '').trim();
  var optC = ((document.getElementById('qmsEditOptC') || {}).value || '').trim();
  var optD = ((document.getElementById('qmsEditOptD') || {}).value || '').trim();
  var opts = [optA, optB, optC, optD].filter(Boolean);

  if (opts.length < 2) {
    if (errEl) { errEl.textContent = 'At least 2 options are required.'; errEl.style.display = 'block'; }
    return;
  }

  var payload = {
    question:      ((document.getElementById('qmsEditQuestion')   || {}).value || '').trim(),
    options:       opts,
    correctAnswer: parseInt((document.getElementById('qmsEditCorrect')    || {}).value || '0'),
    explanation:   ((document.getElementById('qmsEditExpl')               || {}).value || '').trim(),
    topic:         ((document.getElementById('qmsEditTopic')              || {}).value || '').trim(),
    status:        (document.getElementById('qmsEditStatus')              || {}).value || 'approved',
    difficulty:    (document.getElementById('qmsEditDifficulty')          || {}).value || 'medium',
    year:          parseInt((document.getElementById('qmsEditYear')       || {}).value) || null,
    reason:        ((document.getElementById('qmsEditReason')             || {}).value || '').trim()
  };

  if (!payload.question) {
    if (errEl) { errEl.textContent = 'Question text is required.'; errEl.style.display = 'block'; }
    return;
  }

  if (btn) { btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:6px;"></span> Saving...'; btn.disabled = true; }

  var res = await qmsApi('/bank/' + id, 'PUT', payload);

  if (btn) { btn.innerHTML = 'Save Changes'; btn.disabled = false; }

  if (res.ok) {
    instToast('Question updated.', 'success');
    closeAdminModal('qmsEditModal');
    qmsBankLoad(_qmsBankPage);
  } else {
    if (errEl) { errEl.textContent = res.data.message || 'Save failed.'; errEl.style.display = 'block'; }
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
  await Promise.all([
    qmsEngLoadSummary(),
    qmsEngLoadDepts(),
    qmsEngLoadBreakdown()
  ]);
  _qmsEngDeptsLoaded = true;
  qmsEngCheckAvailability();
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
  var tbody   = document.getElementById('qmsIntegBody');
  var summary = document.getElementById('qmsIntegSummary');
  var filterEl = document.getElementById('qmsIntegFilterExam');
  var examType = filterEl ? filterEl.value : 'jamb';

  if (!tbody) { return; }

  tbody.innerHTML =
    '<tr><td colspan="6" style="text-align:center; padding:28px; color:var(--text-muted);">' +
    '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.2);' +
    'border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;' +
    'margin-right:8px;"></span>Checking...</td></tr>';

  var res = await qmsApi('/engine/integration-status?examType=' + examType);

  if (!res.ok) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#ff6584; padding:20px;">' +
      (res.data.message || 'Failed to load.') + '</td></tr>';
    return;
  }

  var data     = res.data;
  var subjects = data.subjects || [];
  var s        = data.summary  || {};

  /* Summary pills */
  if (summary) {
    var pctEngine = s.total > 0 ? Math.round((s.usingQMS / s.total) * 100) : 0;
    summary.innerHTML =
      '<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">' +
        '<span style="font-size:13px; font-weight:700; color:#fff;">' + s.total + ' subject' + (s.total !== 1 ? 's' : '') + ' with questions</span>' +
        '<span style="background:rgba(67,233,123,0.12); color:#43e97b; padding:4px 12px; border-radius:20px; font-size:12px; font-weight:700;">🧠 ' + s.usingQMS + ' Engine</span>' +
        '<span style="background:rgba(108,99,255,0.12); color:#a78bfa; padding:4px 12px; border-radius:20px; font-size:12px; font-weight:700;">📁 ' + s.usingLegacy + ' Legacy</span>' +
        '<span style="font-size:12px; color:var(--text-muted,#6b6b8a);">(' + pctEngine + '% migrated to engine)</span>' +
        '<div style="flex:1; min-width:120px; background:rgba(255,255,255,0.06); border-radius:20px; height:8px; overflow:hidden;">' +
          '<div style="background:linear-gradient(90deg,#43e97b,#38f9d7); width:' + pctEngine + '%; height:100%; border-radius:20px; transition:width 0.5s ease;"></div>' +
        '</div>' +
      '</div>';
  }

  if (!subjects.length) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align:center; padding:36px; color:var(--text-muted);">' +
      'No subjects have questions for ' + examType.toUpperCase() + ' yet.' +
      '</td></tr>';
    return;
  }

  tbody.innerHTML = subjects.map(function (s) {
    var isEngine  = s.source === 'qms';
    var isLegacy  = s.source === 'legacy';
    var srcLabel  = isEngine
      ? '<span style="display:inline-flex; align-items:center; gap:5px; background:rgba(67,233,123,0.1); color:#43e97b; padding:3px 10px; border-radius:20px; font-size:11px; font-weight:800;">🧠 Engine</span>'
      : isLegacy
        ? '<span style="display:inline-flex; align-items:center; gap:5px; background:rgba(108,99,255,0.1); color:#a78bfa; padding:3px 10px; border-radius:20px; font-size:11px; font-weight:800;">📁 Legacy</span>'
        : '<span style="color:var(--text-muted,#6b6b8a); font-size:11px;">—</span>';

    var qmsColour    = s.qmsCount    > 0 ? '#43e97b' : 'var(--text-muted,#6b6b8a)';
    var legacyColour = s.legacyCount > 0 ? '#a78bfa' : 'var(--text-muted,#6b6b8a)';

    var action = isLegacy
      ? '<button class="a-btn a-btn-secondary a-btn-sm" onclick="qmsSwitchTab(\'import\'); instToast(\'Use the Import tab to add QMS questions for this subject.\', \'info\')" style="font-size:11px;">📥 Import</button>'
      : isEngine
        ? '<span style="font-size:11px; color:#43e97b;">✅ Migrated</span>'
        : '—';

    return '<tr>' +
      '<td style="font-weight:700; color:#fff;">' + esc(s.subjectName) + '</td>' +
      '<td>' + srcLabel + '</td>' +
      '<td style="font-weight:700; color:' + qmsColour + ';">' +
        (s.qmsCount > 0 ? s.qmsCount.toLocaleString() : '—') +
      '</td>' +
      '<td style="font-weight:700; color:' + legacyColour + ';">' +
        (s.legacyCount > 0 ? s.legacyCount.toLocaleString() : '—') +
      '</td>' +
      '<td style="font-weight:700; color:#fff;">' + s.total.toLocaleString() + '</td>' +
      '<td>' + action + '</td>' +
    '</tr>';
  }).join('');
}

console.log('🔧 Admin Dashboard loaded');