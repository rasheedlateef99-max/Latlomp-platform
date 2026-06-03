/* ============================================
   LATLOMP PLATFORM — STORE + PAYSTACK CHECKOUT
   FIXED: All element IDs now match store.html
============================================ */

var _paystackKey = "";

/* ============================================
   PAYSTACK CONFIG
============================================ */
async function loadPaystackConfig() {
  try {
    var res = await apiRequest("/store/config");
    if (res.ok && res.data.publicKey) {
      _paystackKey = res.data.publicKey;
    }
  } catch (err) {
    console.warn("Could not load Paystack config:", err.message);
  }
}

/* ============================================
   CART — DATA LAYER
============================================ */
function getCart() {
  try {
    return JSON.parse(localStorage.getItem("latlomp_cart") || "[]");
  } catch (e) {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem("latlomp_cart", JSON.stringify(cart));
}

function clearCart() {
  localStorage.removeItem("latlomp_cart");
  updateCartUI();
  renderCart();
}

function getCartCount() {
  return getCart().reduce(function (sum, item) {
    return sum + (item.quantity || 1);
  }, 0);
}

function getCartTotal() {
  return getCart().reduce(function (sum, item) {
    return sum + (item.price || 0) * (item.quantity || 1);
  }, 0);
}

/* ============================================
   CART — ACTIONS
============================================ */
function addToCart(product) {
  if (!product || !product._id) return;

  var cart = getCart();
  var existing = cart.find(function (i) {
    return i._id === product._id;
  });

  if (existing) {
    existing.quantity = (existing.quantity || 1) + 1;
  } else {
    cart.push({
      _id: product._id,
      name: product.name,
      price: product.price,
      image: product.image || "",
      category: product.category || "",
      quantity: 1,
    });
  }

  saveCart(cart);
  updateCartUI();
  storeToast(
    "✅ " + (product.name || "Product") + " added to cart!",
    "success",
  );
}

function removeFromCart(productId) {
  var cart = getCart().filter(function (i) {
    return i._id !== productId;
  });
  saveCart(cart);
  updateCartUI();
  renderCart();
}

function updateCartQuantity(productId, delta) {
  var cart = getCart();
  var item = cart.find(function (i) {
    return i._id === productId;
  });
  if (!item) return;

  item.quantity = (item.quantity || 1) + delta;

  if (item.quantity <= 0) {
    removeFromCart(productId);
    return;
  }

  saveCart(cart);
  updateCartUI();
  renderCart();
}

/* ============================================
   CART — UI
   FIX: uses correct IDs from store.html
        cartSidebar, cartOverlay, cartSubtotal,
        cartFooter, cartEmptyMsg
============================================ */
function updateCartUI() {
  var count = getCartCount();
  var countEl = document.getElementById("cartCount");
  if (countEl) {
    countEl.textContent = count;
    countEl.style.display = count > 0 ? "flex" : "none";
  }
}

function toggleCart() {
  /* FIX: use cartSidebar and cartOverlay (actual IDs in store.html) */
  var sidebar = document.getElementById("cartSidebar");
  var overlay = document.getElementById("cartOverlay");
  if (!sidebar) return;

  var isOpen = sidebar.classList.contains("open");

  if (isOpen) {
    sidebar.classList.remove("open");
    if (overlay) overlay.style.display = "none";
    document.body.style.overflow = "";
  } else {
    renderCart();
    sidebar.classList.add("open");
    if (overlay) overlay.style.display = "block";
    document.body.style.overflow = "hidden";
  }
}

function openCart() {
  var sidebar = document.getElementById("cartSidebar");
  var overlay = document.getElementById("cartOverlay");
  if (!sidebar) return;
  renderCart();
  sidebar.classList.add("open");
  if (overlay) overlay.style.display = "block";
  document.body.style.overflow = "hidden";
}

function closeCart() {
  var sidebar = document.getElementById("cartSidebar");
  var overlay = document.getElementById("cartOverlay");
  if (sidebar) sidebar.classList.remove("open");
  if (overlay) overlay.style.display = "none";
  document.body.style.overflow = "";
}

function renderCart() {
  var listEl = document.getElementById("cartItemsList");
  var emptyMsg = document.getElementById("cartEmptyMsg");
  var footerEl = document.getElementById("cartFooter"); /* FIX: was missing */
  var totalEl =
    document.getElementById("cartSubtotal"); /* FIX: was 'cartTotal' */
  var checkoutBtn = document.getElementById("checkoutBtn");

  if (!listEl) return;

  var cart = getCart();

  if (cart.length === 0) {
    /* Show empty state */
    if (emptyMsg) emptyMsg.style.display = "block";
    if (footerEl) footerEl.style.display = "none";
    if (checkoutBtn) checkoutBtn.disabled = true;

    /* Remove any rendered items (keep emptyMsg) */
    var items = listEl.querySelectorAll(".cart-item-row");
    items.forEach(function (el) {
      el.remove();
    });
    return;
  }

  /* Hide empty state, show footer */
  if (emptyMsg) emptyMsg.style.display = "none";
  if (footerEl) footerEl.style.display = "block";
  if (checkoutBtn) checkoutBtn.disabled = false;

  /* Clear old items */
  var oldItems = listEl.querySelectorAll(".cart-item-row");
  oldItems.forEach(function (el) {
    el.remove();
  });

  /* Render items */
  cart.forEach(function (item) {
    var div = document.createElement("div");
    div.className = "cart-item-row";
    div.style.cssText =
      "display:flex; align-items:center; gap:12px; padding:14px 0; border-bottom:1px solid var(--border, rgba(255,255,255,0.06));";
    div.innerHTML =
      (item.image
        ? '<img src="' +
          item.image +
          '" alt="' +
          (item.name || "") +
          '" style="width:52px; height:52px; border-radius:8px; object-fit:cover; flex-shrink:0;" />'
        : '<div style="width:52px; height:52px; border-radius:8px; background:rgba(108,99,255,0.12); display:flex; align-items:center; justify-content:center; font-size:20px; flex-shrink:0;">🛍️</div>') +
      '<div style="flex:1; min-width:0;">' +
      '<div style="font-size:13px; font-weight:700; color:var(--text-primary,#fff); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' +
      (item.name || "Product") +
      "</div>" +
      '<div style="font-size:12px; color:#43e97b; font-weight:700; margin-top:2px;">₦' +
      ((item.price || 0) * (item.quantity || 1)).toLocaleString() +
      "</div>" +
      "</div>" +
      '<div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">' +
      "<button onclick=\"updateCartQuantity('" +
      item._id +
      "', -1)\" " +
      'style="width:28px; height:28px; border-radius:6px; border:1px solid var(--border,rgba(255,255,255,0.08)); background:rgba(255,255,255,0.04); color:var(--text-secondary,#a0a0c0); cursor:pointer; font-size:14px; display:flex; align-items:center; justify-content:center; font-family:inherit;">−</button>' +
      '<span style="font-size:13px; font-weight:700; color:var(--text-primary,#fff); min-width:20px; text-align:center;">' +
      (item.quantity || 1) +
      "</span>" +
      "<button onclick=\"updateCartQuantity('" +
      item._id +
      "', 1)\" " +
      'style="width:28px; height:28px; border-radius:6px; border:1px solid var(--border,rgba(255,255,255,0.08)); background:rgba(255,255,255,0.04); color:var(--text-secondary,#a0a0c0); cursor:pointer; font-size:14px; display:flex; align-items:center; justify-content:center; font-family:inherit;">+</button>' +
      "<button onclick=\"removeFromCart('" +
      item._id +
      "')\" " +
      'style="width:28px; height:28px; border-radius:6px; border:1px solid rgba(255,101,132,0.25); background:rgba(255,101,132,0.08); color:var(--secondary,#ff6584); cursor:pointer; font-size:13px; display:flex; align-items:center; justify-content:center; font-family:inherit;">✕</button>' +
      "</div>";
    listEl.appendChild(div);
  });

  /* Update total */
  var total = getCartTotal();
  if (totalEl) totalEl.textContent = "₦" + total.toLocaleString();
}

/* ============================================
   PRODUCTS — Load and render
   FIX: uses 'productGrid' (matches store.html)
============================================ */
async function loadProducts(category) {
  /* FIX: correct element ID */
  var gridEl = document.getElementById("productGrid");
  var countEl = document.getElementById("productCountText");
  var emptyEl = document.getElementById("storeEmpty");

  if (!gridEl) return;

  /* Show loading skeletons */
  gridEl.innerHTML =
    '<div class="product-card skeleton-card"></div>' +
    '<div class="product-card skeleton-card"></div>' +
    '<div class="product-card skeleton-card"></div>' +
    '<div class="product-card skeleton-card"></div>';

  if (emptyEl) emptyEl.style.display = "none";
  if (countEl) countEl.textContent = "Loading products...";

  var query = "";
  if (category && category !== "all") {
    query = "?category=" + encodeURIComponent(category);
  }

  try {
    var res = await apiRequest("/store/products" + query);

    if (!res.ok) {
      gridEl.innerHTML =
        '<div style="grid-column:1/-1; text-align:center; padding:48px; color:var(--text-muted);">' +
        '<div style="font-size:36px; margin-bottom:12px;">⚠️</div>' +
        "<div>Failed to load products. Please refresh.</div>" +
        "</div>";
      if (countEl) countEl.textContent = "";
      return;
    }

    var products = res.data.products || [];

    if (products.length === 0) {
      gridEl.innerHTML = "";
      if (emptyEl) emptyEl.style.display = "block";
      if (countEl) countEl.textContent = "No products found";
      return;
    }

    if (countEl)
      countEl.textContent =
        products.length +
        " product" +
        (products.length !== 1 ? "s" : "") +
        " found";
    renderProducts(products);
  } catch (err) {
    console.error("loadProducts error:", err);
    gridEl.innerHTML =
      '<div style="grid-column:1/-1; text-align:center; padding:48px; color:var(--text-muted);">Something went wrong. Please refresh.</div>';
  }
}

function renderProducts(products) {
  /* FIX: correct element ID */
  var gridEl = document.getElementById("productGrid");
  if (!gridEl) return;

  gridEl.innerHTML = products
    .map(function (p) {
      var inStock = p.stock === undefined || p.stock === null || p.stock > 0;
      var productJson = JSON.stringify({
        _id: p._id,
        name: p.name,
        price: p.price,
        image: p.image || "",
        category: p.category || "",
      }).replace(/"/g, "&quot;");

      return (
        '<div class="product-card" ' +
        "onmouseover=\"this.style.transform='translateY(-4px)'; this.style.boxShadow='0 8px 32px rgba(0,0,0,0.3)'\" " +
        "onmouseout=\"this.style.transform=''; this.style.boxShadow=''\">" +
        '<div style="position:relative; padding-top:60%; background:rgba(255,255,255,0.03); overflow:hidden; border-radius:12px 12px 0 0;">' +
        (p.image
          ? '<img src="' +
            p.image +
            '" alt="' +
            (p.name || "") +
            '" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover;" />'
          : '<div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:48px;">🛍️</div>') +
        (!inStock
          ? '<div style="position:absolute; top:10px; left:10px; background:rgba(255,101,132,0.9); color:#fff; font-size:11px; font-weight:700; padding:3px 10px; border-radius:20px; text-transform:uppercase;">Out of Stock</div>'
          : "") +
        "</div>" +
        '<div style="padding:16px; flex:1; display:flex; flex-direction:column;">' +
        (p.category
          ? '<div style="font-size:11px; font-weight:700; color:var(--primary-light,#a78bfa); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">' +
            p.category +
            "</div>"
          : "") +
        '<div style="font-size:15px; font-weight:800; color:var(--text-primary,#fff); margin-bottom:6px; line-height:1.3;">' +
        (p.name || "Product") +
        "</div>" +
        (p.description
          ? '<div style="font-size:12px; color:var(--text-muted,#6b6b8a); line-height:1.5; flex:1; margin-bottom:14px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">' +
            p.description +
            "</div>"
          : '<div style="flex:1; margin-bottom:14px;"></div>') +
        '<div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">' +
        '<div style="font-size:18px; font-weight:900; color:#43e97b;">₦' +
        (p.price || 0).toLocaleString() +
        "</div>" +
        (inStock
          ? '<button onclick="addToCart(' +
            productJson +
            ')" ' +
            'style="padding:9px 16px; background:linear-gradient(135deg,#43e97b,#38f9d7); color:#0f0f1a; border:none; border-radius:8px; font-size:13px; font-weight:700; cursor:pointer; font-family:inherit; white-space:nowrap;">' +
            "Add to Cart" +
            "</button>"
          : '<button disabled style="padding:9px 16px; background:rgba(255,255,255,0.06); color:var(--text-muted); border:1px solid var(--border); border-radius:8px; font-size:13px; font-weight:700; cursor:not-allowed; font-family:inherit;">Unavailable</button>') +
        "</div>" +
        "</div>" +
        "</div>"
      );
    })
    .join("");
}

/* ============================================
   CATEGORY FILTER
   FIX: function renamed to filterProducts
        to match store.html onclick calls
============================================ */
function filterProducts(category, btnEl) {
  document.querySelectorAll(".filter-btn").forEach(function (b) {
    b.classList.remove("active");
  });

  if (btnEl) btnEl.classList.add("active");

  loadProducts(category === "all" ? null : category);
}

/* Keep old name as alias in case anything else uses it */
function filterByCategory(category, btnEl) {
  filterProducts(category, btnEl);
}

/* ============================================
   SEARCH
============================================ */
function handleStoreSearch(event) {
  if (event.key === "Enter") {
    var query = event.target.value.trim();
    if (query) searchProducts(query);
  }
}

async function searchProducts(query) {
  var gridEl = document.getElementById("productGrid"); /* FIX */
  var countEl = document.getElementById("productCountText");

  if (!gridEl) return;

  gridEl.innerHTML =
    '<div style="grid-column:1/-1; text-align:center; padding:48px; color:var(--text-muted);">' +
    '<div style="width:36px; height:36px; border:3px solid rgba(108,99,255,0.2); border-top-color:var(--primary); border-radius:50%; animation:spin 0.8s linear infinite; margin:0 auto 16px;"></div>' +
    "Searching..." +
    "</div>";

  try {
    var res = await apiRequest(
      "/store/products?search=" + encodeURIComponent(query),
    );
    if (!res.ok) return;

    var products = res.data.products || [];

    if (countEl)
      countEl.textContent =
        products.length +
        " result" +
        (products.length !== 1 ? "s" : "") +
        ' for "' +
        query +
        '"';

    if (products.length === 0) {
      gridEl.innerHTML =
        '<div style="grid-column:1/-1; text-align:center; padding:48px; color:var(--text-muted);">' +
        '<div style="font-size:36px; margin-bottom:12px;">🔍</div>' +
        '<div>No products found for "' +
        query +
        '"</div>' +
        "</div>";
    } else {
      renderProducts(products);
    }
  } catch (err) {
    console.error("searchProducts error:", err);
  }
}

/* ============================================
   CHECKOUT
   FIX: added handleCheckout() alias
        store.html calls handleCheckout()
============================================ */

/* Alias — store.html button calls handleCheckout() */
function handleCheckout() {
  checkoutNow();
}

async function checkoutNow() {
  var user = getCurrentUser();
  var btn = document.getElementById("checkoutBtn");

  if (!user) {
    storeToast("Please sign in to complete your purchase.", "error");
    setTimeout(function () {
      closeCart();
      window.location.href = "signin.html?redirect=store.html";
    }, 1200);
    return;
  }

  var cart = getCart();

  if (!cart || cart.length === 0) {
    storeToast("Your cart is empty.", "error");
    return;
  }

  if (btn) {
    btn.textContent = "⏳ Preparing payment...";
    btn.disabled = true;
  }

  try {
    var items = cart.map(function (item) {
      return { productId: item._id, quantity: item.quantity || 1 };
    });

    var res = await apiRequest("/payment/initialize", "POST", {
      items: items,
      email: user.email || "",
    });

    if (!res.ok) {
      storeToast(
        res.data.message || "Could not start payment. Please try again.",
        "error",
      );
      if (btn) {
        btn.textContent = "Checkout → Pay Now";
        btn.disabled = false;
      }
      return;
    }

    var paymentData = res.data;

    if (btn) {
      btn.textContent = "Checkout → Pay Now";
      btn.disabled = false;
    }

    if (window.PaystackPop && _paystackKey) {
      _openPaystackPopup({
        key: _paystackKey,
        email: user.email,
        amount: Math.round(paymentData.totalAmount * 100),
        ref: paymentData.reference,
        firstName: (user.name || "").split(" ")[0] || "",
        lastName: (user.name || "").split(" ").slice(1).join(" ") || "",
      });
    } else if (paymentData.paymentUrl) {
      window.location.href = paymentData.paymentUrl;
    } else {
      storeToast(
        "Payment could not be started. Please refresh and try again.",
        "error",
      );
    }
  } catch (err) {
    console.error("checkoutNow error:", err);
    storeToast("An error occurred. Please try again.", "error");
    if (btn) {
      btn.textContent = "Checkout → Pay Now";
      btn.disabled = false;
    }
  }
}

function _openPaystackPopup(config) {
  var handler = window.PaystackPop.setup({
    key: config.key,
    email: config.email,
    amount: config.amount,
    ref: config.ref,
    firstname: config.firstName,
    lastname: config.lastName,
    currency: "NGN",
    label: "LatLomp Platform",
    callback: function (response) {
      clearCart();
      closeCart();
      window.location.href = "order-confirm.html?ref=" + response.reference;
    },
    onClose: function () {
      storeToast("Payment cancelled. Your cart is still saved.", "info");
    },
  });
  handler.openIframe();
}

/* ============================================
   TOAST
============================================ */
function storeToast(msg, type) {
  type = type || "info";
  var el = document.getElementById("storeToast");

  if (!el) {
    el = document.createElement("div");
    el.id = "storeToast";
    el.style.cssText =
      "position:fixed; bottom:28px; left:50%; transform:translateX(-50%); z-index:9999; " +
      "border-radius:10px; padding:12px 24px; font-size:14px; font-weight:700; " +
      "box-shadow:0 8px 32px rgba(0,0,0,0.4); white-space:nowrap;";
    document.body.appendChild(el);
  }

  el.textContent = msg;
  el.style.display = "block";
  el.style.background = "var(--dark-2, #1a1a2e)";
  el.style.border =
    "1px solid " +
    (type === "success"
      ? "rgba(67,233,123,0.4)"
      : type === "error"
        ? "rgba(255,101,132,0.4)"
        : "rgba(108,99,255,0.4)");
  el.style.color =
    type === "success" ? "#43e97b" : type === "error" ? "#ff6584" : "#a78bfa";

  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(function () {
    el.style.display = "none";
  }, 3500);
}

/* ============================================
   PAGE INIT
============================================ */
document.addEventListener("DOMContentLoaded", async function () {
  /* ---- AUTH GUARD: store requires login ---- */
  if (!requireLogin("store.html")) return;

  await loadPaystackConfig();
  updateCartUI();
  loadProducts();

  var checkoutBtn = document.getElementById("checkoutBtn");
  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", checkoutNow);
  }

  console.log("🛒 Store initialized");
});
