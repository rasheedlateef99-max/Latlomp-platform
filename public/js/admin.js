/* ============================================
   LATLOMP PLATFORM — ADMIN DASHBOARD JS
============================================ */

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
    if (!user) { clearTimeout(safetyTimer); showScreen('denied'); return; }

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
    clearTimeout(safetyTimer);
    showScreen('denied');
  }
});

/* ============================================
   SECTION NAVIGATION
============================================ */
function showAdminSection(name) {
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
  if (confirm('Log out of Admin Dashboard?')) logout();
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

console.log('🔧 Admin Dashboard loaded');