// CristalBags — Catálogo Ultra Premium
// + Carrinho (multi-itens) + Checkout Mercado Pago (Vercel backend)
// WhatsApp (orçamento): 5521972841917

const WHATSAPP_NUMBER = "5521972841917"; // only digits
const CART_STORAGE_KEY = "cb_cart_v2";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatBRLFromCents(cents){
  const n = Number(cents || 0) / 100;
  return BRL.format(n);
}

function waLink(msg){
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
}

function whatsappMessage(product, variantLabel){
  if(!product) return "Olá! Quero pedir orçamento do catálogo Cristal Bags.";
  const v = variantLabel ? ` — ${variantLabel}` : "";
  return `Olá! Quero orçamento do produto: ${product.name}${v} (SKU: ${product.sku}).`;
}

function setWhatsAppLinks(){
  ["ctaTop","ctaFAQ"].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.href = waLink(whatsappMessage());
  });
}

const state = {
  products: [],
  filtered: [],
  active: null,
  cart: { items: [] }
};

function cryptoRandomId(){
  if (window.crypto && crypto.getRandomValues){
    const a = new Uint32Array(2);
    crypto.getRandomValues(a);
    return (a[0].toString(16) + a[1].toString(16));
  }
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function setStatus(message){
  const grid = document.getElementById("grid");
  if(!grid) return;
  let el = document.getElementById("catalogStatus");
  if(!message){
    if(el) el.remove();
    return;
  }
  if(!el){
    el = document.createElement("div");
    el.id = "catalogStatus";
    el.style.padding = "14px 16px";
    el.style.margin = "16px auto";
    el.style.maxWidth = "920px";
    el.style.borderRadius = "16px";
    el.style.background = "rgba(255,255,255,.70)";
    el.style.backdropFilter = "blur(10px)";
    el.style.boxShadow = "0 12px 36px rgba(0,0,0,.10)";
    el.style.textAlign = "center";
    el.style.fontWeight = "600";
    grid.parentElement.insertBefore(el, grid);
  }
  el.textContent = message;
}


function flashStatus(message, ms = 2600){
  try{
    setStatus(message);
    clearTimeout(flashStatus._t);
    flashStatus._t = setTimeout(() => setStatus(""), ms);
  }catch{}
}


/* ---------- Product helpers ---------- */

function getProductBySku(sku){
  return state.products.find(p => p.sku === sku) || null;
}

function getVariant(product, variantId){
  if(!product || !Array.isArray(product.variants)) return null;
  return product.variants.find(v => String(v.id) === String(variantId)) || null;
}


function getAvailableStock(product, variantId){
  const v = getVariant(product, variantId);
  const vs = v && typeof v.stock === "number" ? v.stock : null;
  const ps = product && typeof product.stock === "number" ? product.stock : null;
  const s = vs !== null ? vs : ps;
  return Number.isFinite(Number(s)) ? Number(s) : Infinity;
}

function isSoldOut(product, variantId){
  const s = getAvailableStock(product, variantId);
  return s !== Infinity && s <= 0;
}

function getPriceCents(product, variantId){
  if(!product) return 0;
  if(Array.isArray(product.variants) && product.variants.length){
    const v = getVariant(product, variantId) || getVariant(product, product.default_variant) || product.variants[0];
    return Number(v?.price_cents || 0);
  }
  return Number(product.price_cents || 0);
}

function priceForSort(product){
  if(!product) return 0;
  if(typeof product.price_cents === "number") return product.price_cents;
  if(Array.isArray(product.variants) && product.variants.length){
    return Math.min(...product.variants.map(v => Number(v.price_cents || 0)));
  }
  // fallback: try to parse the first "xx,yy"
  const m = String(product.price || "").match(/(\d+[\.,]\d{2})/);
  if(!m) return 0;
  const s = m[1].replace(".", "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n*100) : 0;
}

/* ---------- Cart ---------- */

function cartItemKey(item){
  return `${item.sku}::${item.variant || ""}`;
}

function loadCart(){
  try{
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      if(parsed && Array.isArray(parsed.items)) state.cart.items = parsed.items;
    }
  }catch(e){}
  normalizeCart();
  updateCartUI();
}

function saveCart(){
  try{
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart));
  }catch(e){}
}

function normalizeCart(){
  // remove invalid entries and clamp quantities
  state.cart.items = (state.cart.items || [])
    .filter(it => it && typeof it.sku === "string")
    .map(it => ({
      sku: it.sku,
      variant: it.variant || null,
      qty: Math.max(1, Math.min(99, parseInt(it.qty, 10) || 1))
    }));
}

function addToCart(product, variantId, qty=1){
  if(!product || !product.sku){
    flashStatus("⚠️ Produto inválido.");
    return false;
  }

  const requested = Math.max(1, Math.min(99, parseInt(qty, 10) || 1));
  const available = getAvailableStock(product, variantId);

  if (available !== Infinity && available <= 0){
    flashStatus("😢 Este item está esgotado.");
    return false;
  }

  const k = cartItemKey({ sku: product.sku, variantId });
  const i = state.cart.items.findIndex(it => cartItemKey(it) === k);
  const current = i >= 0 ? (parseInt(state.cart.items[i].qty, 10) || 0) : 0;

  const desired = Math.max(1, Math.min(99, current + requested));
  const finalQty = (available === Infinity) ? desired : Math.min(desired, Math.floor(available));

  if (i >= 0){
    state.cart.items[i].qty = finalQty;
  } else {
    state.cart.items.push({ sku: product.sku, variantId, qty: finalQty });
  }

  saveCart();
  updateCartUI();

  if (available !== Infinity && finalQty < desired){
    flashStatus(`Ajustei a quantidade para ${finalQty} (estoque disponível).`);
  } else {
    flashStatus("Adicionado ao carrinho ✅", 1400);
  }

  return true;
}

function removeFromCart(key){
  state.cart.items = state.cart.items.filter(it => cartItemKey(it) !== key);
  saveCart();
  updateCartUI();
}

function setQty(itemKey, qty){
  const item = state.cart.items.find(it => cartItemKey(it) === itemKey);
  if(!item) return;

  let n = Math.max(1, Math.min(99, parseInt(qty, 10) || 1));

  const product = getProductBySku(item.sku);
  const available = getAvailableStock(product, item.variantId);

  if (available !== Infinity){
    if (available <= 0){
      removeFromCart(itemKey);
      flashStatus("Item esgotado — removi do carrinho.");
      return;
    }
    if (n > available){
      n = Math.max(1, Math.floor(available));
      flashStatus(`Quantidade ajustada para ${n} (estoque disponível).`);
    }
  }

  item.qty = n;
  saveCart();
  updateCartUI();
}

function cartCount(){
  return state.cart.items.reduce((sum,it)=>sum + (parseInt(it.qty,10)||0), 0);
}

function cartTotalCents(){
  return state.cart.items.reduce((sum,it)=>{
    const p = getProductBySku(it.sku);
    return sum + getPriceCents(p, it.variant) * (parseInt(it.qty,10)||1);
  }, 0);
}

function buildCartWhatsAppMessage(){
  if(!state.cart.items.length) return whatsappMessage();

  const lines = state.cart.items.map(it=>{
    const p = getProductBySku(it.sku);
    const v = p?.variants?.length ? (getVariant(p, it.variant)?.label || it.variant || "") : "";
    const qty = parseInt(it.qty,10)||1;
    const price = formatBRLFromCents(getPriceCents(p, it.variant));
    const title = p ? p.name : it.sku;
    const vTxt = v ? ` (${v})` : "";
    return `• ${qty}x ${title}${vTxt} — ${price}`;
  });

  return `Olá! Quero orçamento dos itens do carrinho:\n\n${lines.join("\n")}\n\nMeu WhatsApp é este mesmo número.`;
}

/* Drawer UI */

const cartBtn = document.getElementById("cartBtn");
const cartCountEl = document.getElementById("cartCount");
const cartDrawer = document.getElementById("cartDrawer");
const cartBackdrop = document.getElementById("cartBackdrop");
const cartClose = document.getElementById("cartClose");
const cartItemsEl = document.getElementById("cartItems");
const cartTotalEl = document.getElementById("cartTotal");
const cartWhatsEl = document.getElementById("cartWhats");
const checkoutBtn = document.getElementById("checkoutBtn");

function openCart(){
  if(!cartDrawer) return;
  cartDrawer.classList.add("isOpen");
  cartDrawer.setAttribute("aria-hidden","false");
  document.body.style.overflow = "hidden";
}
function closeCart(){
  if(!cartDrawer) return;
  cartDrawer.classList.remove("isOpen");
  cartDrawer.setAttribute("aria-hidden","true");
  document.body.style.overflow = "";
}

function renderCart(){
  if(!cartItemsEl) return;
  normalizeCart();

  if(!state.cart.items.length){
    cartItemsEl.innerHTML = `
      <div class="drawer__empty">
        <strong>Seu carrinho está vazio.</strong>
        <div class="muted" style="margin-top:6px">Abra um produto e toque em “Adicionar ao carrinho”.</div>
      </div>
    `;
  }else{
    cartItemsEl.innerHTML = state.cart.items.map(it=>{
      const p = getProductBySku(it.sku);
      const img = p?.image || "";
      const title = p?.name || it.sku;
      const v = p?.variants?.length ? (getVariant(p, it.variant)?.label || it.variant || "") : "";
      const meta = [p?.sku, v].filter(Boolean).join(" • ");
      const key = cartItemKey(it);
      const qty = parseInt(it.qty,10)||1;
      const price = formatBRLFromCents(getPriceCents(p, it.variant));
      return `
        <div class="cartItem" data-key="${key}">
          <img class="cartItem__img" src="${img}" alt="${title}" loading="lazy" />
          <div>
            <p class="cartItem__title">${title}</p>
            <div class="cartItem__meta">${meta}</div>
            <div class="cartItem__row">
              <div class="qty">
                <button type="button" data-act="dec" aria-label="Diminuir">−</button>
                <strong>${qty}</strong>
                <button type="button" data-act="inc" aria-label="Aumentar">+</button>
              </div>
              <div style="font-weight:800">${price}</div>
            </div>
            <button class="cartItem__remove" type="button" data-act="remove">Remover</button>
          </div>
        </div>
      `;
    }).join("");
  }

  if(cartTotalEl) cartTotalEl.textContent = formatBRLFromCents(cartTotalCents());
  if(cartWhatsEl) cartWhatsEl.href = waLink(buildCartWhatsAppMessage());

  // attach handlers
  cartItemsEl.querySelectorAll(".cartItem").forEach(row=>{
    const key = row.getAttribute("data-key");
    row.querySelectorAll("button[data-act]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const act = btn.getAttribute("data-act");
        const it = state.cart.items.find(x => cartItemKey(x) === key);
        if(!it) return;
        if(act==="remove") removeFromCart(key);
        if(act==="inc") setQty(key, (parseInt(it.qty,10)||1) + 1);
        if(act==="dec") setQty(key, (parseInt(it.qty,10)||1) - 1);
      });
    });
  });
}

function updateCartUI(){
  if(cartCountEl) cartCountEl.textContent = String(cartCount());
  renderCart();
}

cartBtn?.addEventListener("click", openCart);
cartBackdrop?.addEventListener("click", closeCart);
cartClose?.addEventListener("click", closeCart);
document.addEventListener("keydown",(e)=>{
  if(e.key==="Escape"){
    if(cartDrawer?.classList.contains("isOpen")) closeCart();
  }
});

/* ---------- Checkout (server-side preference) ---------- */

async function startCheckout(items){
  const payload = { items };
  const res = await fetch("/api/create-preference", {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
  if(!res.ok){
    const t = await res.text().catch(()=> "");
    throw new Error(`Erro ao iniciar pagamento (${res.status}). ${t}`);
  }
  return res.json();
}

async function checkoutCart(){
  if(!state.cart.items.length){
    openCart();
    return;
  }
  checkoutBtn.disabled = true;
  checkoutBtn.textContent = "Indo para o checkout....";
  try{
localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart));

setTimeout(() => {
  window.location.href = "/checkout.html";
}, 50);

  }catch(err){
    alert(err?.message || "Não foi possível iniciar o pagamento.");
  }finally{
    checkoutBtn.disabled = false;
    checkoutBtn.textContent = "Finalizar no Mercado Pago";
  }
}

checkoutBtn?.addEventListener("click", checkoutCart);

/* ---------- Filters + Grid ---------- */

function uniqueCategories(products){
  const set = new Set(products.map(p=>p.category).filter(Boolean));
  return Array.from(set).sort((a,b)=>a.localeCompare(b));
}

function renderCategoryOptions(){
  const sel = document.getElementById("category");
  if(!sel) return;
  // clear old options (keep first two)
  sel.querySelectorAll("option[data-dyn]").forEach(o=>o.remove());
  uniqueCategories(state.products).forEach(cat=>{
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    opt.setAttribute("data-dyn","1");
    sel.appendChild(opt);
  });
}

function applyFilters(){
  const q = (document.getElementById("q")?.value || "").trim().toLowerCase();
  const cat = document.getElementById("category")?.value || "";
  const sort = document.getElementById("sort")?.value || "featured";

  let list = [...state.products];
  if(cat) list = list.filter(p => p.category === cat);
  if(q){
    list = list.filter(p=>{
      const blob = `${p.name} ${p.category} ${p.sku} ${p.desc}`.toLowerCase();
      return blob.includes(q);
    });
  }

  if(sort==="featured"){
    list.sort((a,b)=>{
      const ap = a.premium ? 1 : 0;
      const bp = b.premium ? 1 : 0;
      if(bp!==ap) return bp-ap;
      return a.name.localeCompare(b.name);
    });
  }else if(sort==="name"){
    list.sort((a,b)=>a.name.localeCompare(b.name));
  }else if(sort==="priceAsc"){
    list.sort((a,b)=>priceForSort(a)-priceForSort(b));
  }else if(sort==="priceDesc"){
    list.sort((a,b)=>priceForSort(b)-priceForSort(a));
  }

  state.filtered = list;
  renderGrid();
}

function cardTemplate(p) {
  const cents = getPriceCents(p, p.default_variant || null);
  let priceLabel = "";
  if (cents) {
    priceLabel = formatBRLFromCents(cents);
  } else if (p && p.price != null) {
    const pr = Number(p.price);
    priceLabel = Number.isFinite(pr) && pr > 0 ? formatBRLFromCents(Math.round(pr * 100)) : String(p.price);
  }
  const soldOut = typeof p.stock === "number" && p.stock <= 0;

  return `
    <article class="card" data-sku="${p.sku}">
      ${p.premium ? `<div class="badge badge--premium" title="Premium"><span class="badge__sparkle">✦</span> Premium</div>` : ""}
      ${soldOut ? `<div class="badge badge--soldout" style="left:auto; right:12px;" title="Sem estoque">Esgotado</div>` : ""}
      <img class="thumb" src="${p.image}" alt="${p.name}" />
      <div class="card__title">${p.name}</div>
      <div class="card__meta">${p.dimensions || ""}</div>
      ${typeof p.stock === "number" ? `<div class="card__stock">${p.stock > 0 ? `Estoque: ${p.stock}` : `Sem estoque`}</div>` : ""}
      <div class="price">${priceLabel}</div>
    </article>
  `;
}

function renderGrid(){
  const grid = document.getElementById("grid");
  if(!grid) return;
  grid.innerHTML = "";
  if(!state.filtered.length){
    grid.innerHTML = `<div style="padding:14px;color:rgba(46,51,53,.75)">Nenhum produto encontrado.</div>`;
    return;
  }
  grid.innerHTML = state.filtered.map(cardTemplate).join("");
  grid.querySelectorAll(".card").forEach(el=>{
    const sku = el.getAttribute("data-sku");
    const p = getProductBySku(sku);
    const open = ()=>openModal(p);
    el.addEventListener("click", open);
    el.addEventListener("keydown",(e)=>{
      if(e.key==="Enter" || e.key===" "){ e.preventDefault(); open(); }
    });
  });
}

/* ---------- Modal ---------- */

const modal = document.getElementById("modal");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalClose = document.getElementById("modalClose");
const mVariantsWrap = document.getElementById("mVariantsWrap");
const mVariant = document.getElementById("mVariant");
const mAdd = document.getElementById("mAdd");
const mBuyNow = document.getElementById("mBuyNow");
const M_BUY_LABEL = mBuyNow ? mBuyNow.textContent : "Comprar agora";


function currentVariantId(){
  if(!state.active) return null;
  if(!Array.isArray(state.active.variants) || !state.active.variants.length) return null;
  return mVariant?.value || state.active.default_variant || state.active.variants[0]?.id || null;
}

function syncModalPricing(){
  if(!state.active) return;

  const variantId = mVariant ? mVariant.value : null;
  const cents = getPriceCents(state.active, variantId);
  const v = getVariant(state.active, variantId);
  const dims = v?.dimensions || state.active.dimensions || "-";

  document.getElementById("mPrice").textContent =
    cents ? formatBRLFromCents(cents) : (state.active.price || "-");
  document.getElementById("mDim").textContent = dims || "-";

  const soldOut = isSoldOut(state.active, variantId);
  if (mAdd) mAdd.disabled = soldOut;
  if (mBuyNow){
    mBuyNow.disabled = soldOut;
    mBuyNow.textContent = soldOut ? "Esgotado" : M_BUY_LABEL;
  }

  // WhatsApp helper link (still useful even if sold out)
  const qty = 1;
  const total = cents ? formatBRLFromCents(cents * qty) : "";
  const msg = `Olá! Quero comprar:
• ${state.active.name}${v ? ` (${v.label})` : ""}
• Total: ${total}

Meu nome: 
Endereço: 
`; 
  waBuy.href = `https://wa.me/5511999999999?text=${encodeURIComponent(msg)}`;
}

function openModal(p){
  if(!p) return;
  state.active = p;

  const imgEl = document.getElementById("mImg");
  imgEl.src = p.image || "";
  imgEl.alt = p.name;

  document.getElementById("mCat").textContent = p.category || "Produto";
  document.getElementById("mName").textContent = p.name;
  document.getElementById("mDesc").textContent = p.desc || "";
  document.getElementById("mSku").textContent = p.sku || "-";

  // Variants
  if(mVariantsWrap && mVariant){
    if(Array.isArray(p.variants) && p.variants.length){
      mVariantsWrap.style.display = "";
      mVariant.innerHTML = p.variants.map(v => `<option value="${v.id}">${v.label}</option>`).join("");
      mVariant.value = p.default_variant || p.variants[0].id;
      mVariant.onchange = syncModalPricing;
      syncModalPricing();
    }else{
      mVariantsWrap.style.display = "none";
      mVariant.innerHTML = "";
      document.getElementById("mPrice").textContent = p.price || "-";
    }
  }

  // WhatsApp link
  const w = document.getElementById("mWhats");
  if(!(Array.isArray(p.variants) && p.variants.length)){
    w.href = waLink(whatsappMessage(p));
  }

  modal.classList.add("isOpen");
  modal.setAttribute("aria-hidden","false");
  document.body.style.overflow = "hidden";
}

function closeModal(){
  modal.classList.remove("isOpen");
  modal.setAttribute("aria-hidden","true");
  document.body.style.overflow = "";
  state.active = null;
}

modalBackdrop?.addEventListener("click", closeModal);
modalClose?.addEventListener("click", closeModal);
document.addEventListener("keydown",(e)=>{
  if(e.key==="Escape" && modal.classList.contains("isOpen")) closeModal();
});

mAdd?.addEventListener("click", ()=>{
  if(!state.active) return;
  const ok = addToCart(state.active, currentVariantId(), 1);
  if(!ok) return;
  closeModal();
  openCart();
});

mBuyNow?.addEventListener("click", async ()=>{
  if(!state.active) return;
  // one-click checkout: create preference with this single item
  const item = { sku: state.active.sku, variant: currentVariantId(), qty: 1 };
  mBuyNow.disabled = true;
  mBuyNow.textContent = "Abrindo Mercado Pago...";
  try{
    const data = await startCheckout([item]);
    if(data?.checkout_url){
      window.location.href = data.checkout_url;
      return;
    }
    throw new Error("Resposta inválida do servidor (sem checkout_url).");
  }catch(err){
    alert(err?.message || "Não foi possível iniciar o pagamento.");
  }finally{
    mBuyNow.disabled = false;
    mBuyNow.textContent = M_BUY_LABEL;
    syncModalPricing();
  }
});

/* ---------- Load products ---------- */

async function loadProducts() {
  try {
    setStatus("Carregando catálogo...");

    let data = null;

    // 1) Prefer Supabase-backed API (Vercel)
    try {
      const apiRes = await fetch("/api/products", { cache: "no-store" });
      if (apiRes.ok) {
        const apiData = await apiRes.json();
        if (Array.isArray(apiData) && apiData.length) data = apiData;
      }
    } catch {
      // ignore
    }

    // 2) Fallback to local JSON file (works locally / GitHub Pages)
    if (!data) {
      const urls = ["data/products.json", "./data/products.json", "/data/products.json"];
      for (const url of urls) {
        try {
          const r = await fetch(url, { cache: "no-store" });
          if (!r.ok) continue;
          const j = await r.json();
          if (Array.isArray(j) && j.length) {
            data = j;
            break;
          }
        } catch {
          // try next
        }
      }
    }

    // 3) Fallback to inline (last resort)
    if (!data && Array.isArray(window.__PRODUCTS__)) {
      data = window.__PRODUCTS__;
    }

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("Catálogo vazio (Supabase e products.json não retornaram produtos).");
    }

    state.products = data.map((p) => {
      let price_cents = Number((p && (p.price_cents != null ? p.price_cents : (p.preco_cents != null ? p.preco_cents : NaN))));
      if (!Number.isFinite(price_cents) || price_cents <= 0) {
        const pr = Number((p && (p.price != null ? p.price : (p.preco != null ? p.preco : (p.valor != null ? p.valor : NaN)))));
        if (Number.isFinite(pr) && pr > 0) price_cents = Math.round(pr * 100);
      }
      if (!Number.isFinite(price_cents)) price_cents = 0;

      const stockNum = p.stock === null || p.stock === undefined ? null : Number(p.stock);

      const variants = Array.isArray(p.variants)
        ? p.variants.map((v) => ({
            ...v,
            price_cents: Number(v.price_cents ?? v.preco_cents ?? 0),
            stock: v.stock === null || v.stock === undefined ? undefined : Number(v.stock),
          }))
        : null;

      return {
        ...p,
        sku: p.sku ?? p.id ?? cryptoRandomId(),
        name: p.name ?? p.title ?? p.nome ?? "",
        category: p.category ?? p.categoria ?? "Outros",
        price_cents: Number.isFinite(price_cents) ? price_cents : 0,
        // keep legacy price string as a fallback for UI
        price: (p && p.price != null) ? p.price : (Number.isFinite(price_cents) && price_cents > 0 ? formatBRLFromCents(price_cents) : ""),
        dimensions: p.dimensions ?? p.medidas ?? "",
        desc: p.desc ?? p.description ?? "",
        image: p.image ?? p.imagem ?? "",
        premium: !!(p.premium ?? p.isPremium ?? false),
        featured: !!(p.featured ?? p.destaque ?? false),
        stock: Number.isFinite(stockNum) ? Math.max(0, Math.floor(stockNum)) : null,
        variants,
        default_variant: p.default_variant ?? p.defaultVariant ?? null,
        active: p.active ?? true,
      };
    });

    renderCategoryOptions();
    applyFilters();
    setStatus("");
  } catch (err) {
    console.error(err);
    setStatus(
      "⚠️ Não foi possível carregar o catálogo. Abra o console (F12) para ver o erro."
    );
  }
}

/* ---------- Init ---------- */

document.getElementById("year").textContent = new Date().getFullYear();
setWhatsAppLinks();
loadCart();
loadProducts();

/* ---------- Hero video: fade in when ready ---------- */
(function(){
  const vid = document.querySelector(".heroVideo__media");
  if(!vid) return;
  const wrap = vid.closest(".heroVideo");
  const markReady = () => wrap?.classList.add("is-ready");
  vid.addEventListener("playing", markReady, { once:true });
  vid.addEventListener("loadeddata", markReady, { once:true });
})();


["q","category","sort"].forEach(id=>{
  const el = document.getElementById(id);
  el?.addEventListener("input", applyFilters);
  el?.addEventListener("change", applyFilters);
});
