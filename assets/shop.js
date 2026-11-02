// FaasKids storefront — hash-routed single page app, no build step.
import { fmt, priceCart, productStock, isOnSale, salePercent, activeBundles, bundleOffer, recommend, normalizePhone, comboMissing } from '../lib/pricing.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');

/* ---------- local state (this device) ---------- */
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('fk-' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('fk-' + k, JSON.stringify(v)); } catch {} }
};
let bag = store.get('bag', []);           // [{productId, variantId, qty}]
let saved = store.get('saved', []);       // [productId]
let viewed = store.get('viewed', []);     // [productId] most recent first
let promoCode = store.get('promo', '');
let promoRule = null;                     // promo fetched from server for the preview
let catalog = null;

const saveBag = () => { store.set('bag', bag); updateBadges(); };

/* ---------- data ---------- */
async function loadCatalog() {
  const r = await fetch('/api/catalog');
  if (!r.ok) throw new Error('Could not load the shop');
  catalog = await r.json();
  catalog.products ||= [];
  catalog.categories ||= [];
  catalog.settings ||= {};
  // drop bag lines whose product disappeared
  bag = bag.filter(l => catalog.products.some(p => p.id === l.productId));
  if (promoCode) await fetchPromo(promoCode);
}
async function fetchPromo(code) {
  try {
    const r = await fetch('/api/catalog?promo=' + encodeURIComponent(code));
    promoRule = (await r.json()).promo;
  } catch { promoRule = null; }
}
const product = id => catalog.products.find(p => p.id === id);
const category = id => catalog.categories.find(c => c.id === id);
const quote = (zoneId) => priceCart(catalog, bag, { promoCode, zoneId, promos: [...(catalog.promos || []), ...(promoRule ? [promoRule] : [])] });
const inBag = pid => bag.some(l => l.productId === pid);
/** Combo state against the current bag: which items are still needed. */
function comboState(b) {
  const items = b.items.map(product).filter(Boolean);
  const missing = new Set(comboMissing(catalog, bag, b));
  return { items, missing, have: items.filter(p => !missing.has(p.id)) };
}
const comboBtnLabel = (st, total) => st.missing.size === total ? `Add all ${total}` : `Add ${st.missing.size} missing item${st.missing.size > 1 ? 's' : ''}`;

/* ---------- small UI bits ---------- */
function toast(msg) {
  const t = $('#toast');
  t.innerHTML = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}
function updateBadges() {
  const n = bag.reduce((s, l) => s + l.qty, 0);
  $('#bagCount').textContent = n || '';
  $('#savedCount').textContent = saved.length || '';
}
function placeholder(p, cls = '') {
  const c = category(p?.category);
  return `<div class="ph ${cls}" data-cat="${esc(p?.category || '')}"><span>${esc(c?.emoji || '🎈')}</span></div>`;
}
function img(p, i = 0, cls = '') {
  const src = (p.images || [])[i];
  return src ? `<img class="${cls}" src="${esc(src)}" alt="${esc(p.name)}" loading="lazy">` : placeholder(p, cls);
}
function priceHtml(p) {
  return isOnSale(p)
    ? `<span class="now sale">${fmt(p.price)}</span> <s>${fmt(p.compareAt)}</s>`
    : `<span class="now">${fmt(p.price)}</span>`;
}
function stockNote(p, v) {
  const s = v ? v.stock : productStock(p);
  const low = catalog.settings.lowStockAt || 3;
  if (s <= 0) return '<span class="stock out">Sold out</span>';
  if (s <= low) return `<span class="stock low">Only ${s} left</span>`;
  return '<span class="stock ok">In stock</span>';
}
let ratings = {}; // productId → { avg, count }
const stars = (avg, cls = '') => `<span class="stars ${cls}" aria-label="${avg} out of 5 stars"><i style="width:${avg / 5 * 100}%"></i></span>`;
const ratingHtml = id => ratings[id]?.count ? `<span class="rating">${stars(ratings[id].avg)} <small>${ratings[id].avg} (${ratings[id].count})</small></span>` : '';
const heart = id => `<button class="heart ${saved.includes(id) ? 'on' : ''}" data-save="${esc(id)}" aria-label="Save item"><svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg></button>`;

function card(p) {
  const out = productStock(p) <= 0;
  const badges = [
    isOnSale(p) ? `<i class="tag sale">-${salePercent(p)}%</i>` : '',
    activeBundles(catalog).some(b => b.items.includes(p.id)) ? '<i class="tag combo">Combo deal</i>' : '',
    out ? '<i class="tag out">Sold out</i>' : ''
  ].join('');
  return `<article class="card ${out ? 'is-out' : ''}">
    <a href="#/p/${esc(p.id)}" class="card-img">${img(p)}<div class="tags">${badges}</div></a>
    ${heart(p.id)}
    <a href="#/p/${esc(p.id)}" class="card-txt">
      <h3>${esc(p.name)}</h3>
      <div class="price">${priceHtml(p)}</div>
      ${ratingHtml(p.id)}
      ${p.variants.length > 1 ? `<div class="sizes">${p.variants.length} sizes</div>` : ''}
    </a>
  </article>`;
}
const grid = list => list.length ? `<div class="grid">${list.map(card).join('')}</div>` : '<p class="empty">Nothing here yet — check back soon.</p>';
const visible = () => catalog.products.filter(p => p.active !== false);

/* ---------- bag actions ---------- */
function addToBag(productId, variantId, qty = 1, silent = false) {
  const p = product(productId);
  const v = p?.variants.find(x => x.id === variantId) || p?.variants[0];
  if (!p || !v) return false;
  const line = bag.find(l => l.productId === p.id && l.variantId === v.id);
  const have = line ? line.qty : 0;
  if (have + qty > v.stock) {
    toast(v.stock > 0 ? `Only ${v.stock} available${v.label ? ' in ' + esc(v.label) : ''}` : 'Sorry, that’s sold out');
    return false;
  }
  if (line) line.qty += qty; else bag.push({ productId: p.id, variantId: v.id, qty });
  saveBag();
  if (!silent) toast(`Added <b>${esc(p.name)}</b>${v.label ? ' · ' + esc(v.label) : ''} — <a href="#" data-open-bag>View bag</a>`);
  return true;
}
function setQty(productId, variantId, qty) {
  const line = bag.find(l => l.productId === productId && l.variantId === variantId);
  if (!line) return;
  const v = product(productId)?.variants.find(x => x.id === variantId);
  line.qty = Math.max(0, Math.min(qty, v?.stock ?? qty));
  bag = bag.filter(l => l.qty > 0);
  saveBag();
}
function toggleSaved(id) {
  saved = saved.includes(id) ? saved.filter(x => x !== id) : [id, ...saved];
  store.set('saved', saved);
  updateBadges();
  $$(`[data-save="${CSS.escape(id)}"]`).forEach(b => b.classList.toggle('on', saved.includes(id)));
}

/* ---------- bag contents (drawer + page share this) ---------- */
function bagHtml(full = false) {
  if (!bag.length) {
    return `<div class="bag-empty"><div class="emoji-xl">🛍️</div><p>Your bag is empty.</p><a class="btn" href="#/">Start shopping</a></div>`;
  }
  const q = quote();
  const lines = q.lines.map(l => {
    const p = product(l.productId);
    return `<div class="line">
      <a href="#/p/${esc(l.productId)}" class="line-img">${img(p)}</a>
      <div class="line-info">
        <a href="#/p/${esc(l.productId)}" class="line-name">${esc(l.name)}</a>
        ${l.variantLabel ? `<div class="muted">Size: ${esc(l.variantLabel)}</div>` : ''}
        <div class="line-row">
          <div class="stepper" data-line="${esc(l.productId)}|${esc(l.variantId)}">
            <button data-d="-1" aria-label="Fewer">−</button><span>${l.qty}</span><button data-d="1" aria-label="More" ${l.qty >= l.stock ? 'disabled' : ''}>+</button>
          </div>
          <b>${fmt(l.amount)}</b>
        </div>
        ${l.error ? `<div class="err">${esc(l.error)}</div>` : ''}
      </div>
      <button class="line-x" data-remove="${esc(l.productId)}|${esc(l.variantId)}" aria-label="Remove">✕</button>
    </div>`;
  }).join('');

  const hints = q.hints.slice(0, 2).map(h => {
    const one = h.missing.length === 1 && product(h.missing[0].id).variants.length === 1;
    return `<div class="hint">
      <div>💡 Add <b>${h.missing.map(m => esc(m.name)).join(' + ')}</b> to complete the <b>${esc(h.name)}</b> and save <b>${fmt(h.saving)}</b></div>
      ${one ? `<button class="btn sm" data-add="${esc(h.missing[0].id)}">Add ${fmt(h.missing[0].price)}</button>` : `<a class="btn sm" href="#/p/${esc(h.missing[0].id)}">Choose size</a>`}
    </div>`;
  }).join('');

  const threshold = catalog.settings.freeDeliveryOver || 0;
  const merch = q.subtotal - q.totalSaving;
  const ship = threshold ? `<div class="ship">
      ${q.freeDeliveryGap > 0 ? `You’re <b>${fmt(q.freeDeliveryGap)}</b> away from free delivery` : '🎉 You’ve unlocked <b>free delivery</b>'}
      <div class="bar"><i style="width:${Math.min(100, merch / threshold * 100)}%"></i></div>
    </div>` : '';

  return `${ship}
    <div class="lines">${lines}</div>
    ${hints}
    <div class="promo">
      <form id="promoForm"><input id="promoInput" placeholder="Promo code" value="${esc(promoCode)}" autocapitalize="characters"><button class="btn ghost">Apply</button></form>
      ${q.promoError ? `<div class="err">${esc(q.promoError)}</div>` : ''}
      ${q.promo && !q.promo.auto ? `<div class="ok">✓ ${esc(q.promo.code)} applied <a href="#" data-clear-promo>remove</a></div>` : ''}
      ${q.promo?.auto ? `<div class="ok">✓ ${esc(q.promo.label || 'Website discount')} applied automatically</div>` : ''}
    </div>
    ${summaryHtml(q)}
    <a class="btn block primary" href="#/checkout" ${q.errors.length ? 'aria-disabled="true"' : ''}>Checkout securely</a>
    ${full ? '' : '<a class="btn block ghost" href="#/bag">View full bag</a>'}
    <p class="tiny">Pay by bank transfer · Delivery across Nigeria · Track with your phone number</p>`;
}
function summaryHtml(q, withDelivery = false) {
  return `<dl class="sum">
    <div><dt>Subtotal (${q.itemCount} item${q.itemCount === 1 ? '' : 's'})</dt><dd>${fmt(q.subtotal)}</dd></div>
    ${q.bundles.map(b => `<div class="save"><dt>🎁 ${esc(b.name)}${b.sets > 1 ? ' ×' + b.sets : ''}</dt><dd>−${fmt(b.saving)}</dd></div>`).join('')}
    ${q.promo && q.promo.saving ? `<div class="save"><dt>${q.promo.auto ? esc(q.promo.label || 'Website discount') : 'Promo ' + esc(q.promo.code)}</dt><dd>−${fmt(q.promo.saving)}</dd></div>` : ''}
    ${withDelivery ? `<div><dt>Delivery${q.zone ? ' · ' + esc(q.zone.name) : ''}</dt><dd>${q.zone ? (q.freeDelivery ? '<span class="free">FREE</span>' : fmt(q.deliveryFee)) : 'Choose below'}</dd></div>` : ''}
    <div class="tot"><dt>${withDelivery ? 'Total' : 'Total before delivery'}</dt><dd>${fmt(q.total)}</dd></div>
    ${q.totalSaving ? `<div class="saving-note">You’re saving ${fmt(q.totalSaving)} 🎉</div>` : ''}
  </dl>`;
}

function openBag() {
  $('#toast').classList.remove('show');
  $('#drawerBody').innerHTML = bagHtml();
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#scrim').classList.add('open');
  document.body.classList.add('locked');
}
function closeBag() {
  $('#drawer').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#scrim').classList.remove('open');
  document.body.classList.remove('locked');
}
function refreshBagViews(full = false) {
  if ($('#drawer').classList.contains('open')) $('#drawerBody').innerHTML = bagHtml();
  // combo & "bought together" blocks depend on what's in the bag
  const page = (location.hash.slice(2) || '').split(/[/?]/)[0];
  if (['p', 'combos', ''].includes(page)) { const y = scrollY; render(); scrollTo(0, y); }
  if (location.hash.startsWith('#/bag')) render();
  if (location.hash.startsWith('#/checkout')) render();
}

/* ---------- pages ---------- */
function pageHome() {
  const s = catalog.settings;
  const featured = visible().filter(p => p.featured && productStock(p) > 0);
  const sale = visible().filter(isOnSale);
  const fresh = [...visible()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 8);
  const combos = activeBundles(catalog);
  return `
  <section class="hero">
    <div class="hero-txt">
      <p class="eyebrow">New season · Back to school</p>
      <h1>Everything they need to <em>grow with style</em></h1>
      <p>Backpacks, lunch gear, clothing and shoes for little ones — bundle up and save with our combo deals.</p>
      <div class="hero-cta"><a class="btn primary" href="#/all">Shop all</a>${combos.length ? '<a class="btn ghost" href="#/combos">See combo deals</a>' : ''}</div>
    </div>
    <div class="hero-art" aria-hidden="true"><img src="logo.jpg" alt=""></div>
  </section>

  <section class="sec">
    <h2>Shop by category</h2>
    <div class="cats">${catalog.categories.map(c => `<a class="cat" href="#/c/${esc(c.id)}"><span class="cat-ic" data-cat="${esc(c.id)}">${c.image ? `<img src="${esc(c.image)}" alt="">` : esc(c.emoji || '🎈')}</span><b>${esc(c.name)}</b></a>`).join('')}</div>
  </section>

  ${combos.length ? `<section class="sec"><div class="sec-hd"><h2>Combo deals</h2><a href="#/combos">All combos →</a></div>${combosHtml(combos.slice(0, 3))}</section>` : ''}

  ${featured.length ? `<section class="sec"><div class="sec-hd"><h2>Bestsellers</h2><a href="#/all">Shop all →</a></div>${grid(featured.slice(0, 8))}</section>` : ''}

  ${sale.length ? `<section class="sec sale-band"><div class="sec-hd"><h2>On sale now</h2><a href="#/sale">All sale →</a></div>${grid(sale.slice(0, 4))}</section>` : ''}

  <section class="sec"><div class="sec-hd"><h2>New in</h2></div>${grid(fresh)}</section>

  ${recentHtml()}

  <section class="perks">
    <div><b>🚚 Nationwide delivery</b><span>${s.freeDeliveryOver ? 'Free over ' + fmt(s.freeDeliveryOver) : 'Fast & tracked'}</span></div>
    <div><b>🎁 Combo savings</b><span>Bundle and save automatically</span></div>
    <div><b>📱 Track by phone</b><span>No account needed</span></div>
    <div><b>💬 Real people</b><span>Chat with us on WhatsApp</span></div>
  </section>`;
}

function combosHtml(list) {
  return `<div class="combos">${list.map(b => {
    const o = bundleOffer(catalog, b);
    const st = comboState(b);
    const needSize = st.items.find(p => st.missing.has(p.id) && p.variants.length > 1);
    const out = st.items.some(p => st.missing.has(p.id) && productStock(p) <= 0);
    return `<div class="combo">
      <div class="combo-imgs">${st.items.map(p => `<a href="#/p/${esc(p.id)}" class="${st.missing.has(p.id) ? '' : 'have'}">${img(p)}${st.missing.has(p.id) ? '' : '<i class="have-tick">✓ In bag</i>'}</a>`).join('<span class="plus">+</span>')}</div>
      <div class="combo-txt">
        <h3>${esc(b.name)}</h3>
        ${b.description ? `<p>${esc(b.description)}</p>` : ''}
        <div class="price"><span class="now sale">${fmt(o.price)}</span> <s>${fmt(o.sum)}</s> <i class="tag sale">Save ${fmt(o.saving)}</i></div>
        ${out ? '<button class="btn" disabled>Part of this combo is sold out</button>'
          : needSize ? `<a class="btn primary" href="#/p/${esc(needSize.id)}">Choose sizes</a>`
          : `<button class="btn primary" data-add-combo="${esc(b.id)}">${st.have.length ? comboBtnLabel(st, st.items.length) : 'Add combo to bag'}</button>`}
      </div>
    </div>`;
  }).join('')}</div>`;
}

function recentHtml(excludeId) {
  const list = viewed.filter(id => id !== excludeId).map(product).filter(p => p && p.active !== false).slice(0, 4);
  return list.length ? `<section class="sec"><div class="sec-hd"><h2>Recently viewed</h2></div>${grid(list)}</section>` : '';
}

function pageList(kind, arg, params) {
  let title, list = visible(), crumb = '';
  if (kind === 'c') {
    const c = category(arg);
    title = c ? c.name : 'Category';
    list = list.filter(p => p.category === arg);
  } else if (kind === 'sale') {
    title = 'Sale'; list = list.filter(isOnSale);
  } else if (kind === 'search') {
    const q = (params.get('q') || '').toLowerCase().trim();
    title = `Results for “${esc(params.get('q') || '')}”`;
    const words = q.split(/\s+/).filter(Boolean);
    list = list.filter(p => {
      const hay = [p.name, p.description, category(p.category)?.name, ...(p.tags || [])].join(' ').toLowerCase();
      return words.every(w => hay.includes(w));
    });
  } else if (kind === 'saved') {
    title = 'Saved items'; list = saved.map(product).filter(Boolean);
  } else {
    title = 'All products';
  }

  const sort = params.get('sort') || 'featured';
  const size = params.get('size') || '';
  const instock = params.get('instock') === '1';
  const sizes = [...new Set(list.flatMap(p => p.variants.map(v => v.label).filter(Boolean)))];
  let shown = list.filter(p => (!size || p.variants.some(v => v.label === size && v.stock > 0)) && (!instock || productStock(p) > 0));
  const sorters = {
    featured: (a, b) => (b.featured - a.featured) || (productStock(b) > 0) - (productStock(a) > 0),
    new: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    low: (a, b) => a.price - b.price,
    high: (a, b) => b.price - a.price,
    sale: (a, b) => salePercent(b) - salePercent(a)
  };
  shown = [...shown].sort(sorters[sort] || sorters.featured);
  const link = (k, v) => { const p = new URLSearchParams(params); v ? p.set(k, v) : p.delete(k); return '#' + location.hash.slice(1).split('?')[0] + (p.toString() ? '?' + p : ''); };

  return `<section class="sec list">
    <nav class="crumbs"><a href="#/">Home</a> / <span>${title}</span></nav>
    <div class="list-hd"><h1>${title}</h1><span class="muted">${shown.length} item${shown.length === 1 ? '' : 's'}</span></div>
    <div class="filters">
      <label class="sel">Sort <select data-nav>
        ${[['featured', 'Recommended'], ['new', 'Newest'], ['low', 'Price: low to high'], ['high', 'Price: high to low'], ['sale', 'Biggest discount']].map(([v, l]) => `<option value="${link('sort', v)}" ${sort === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select></label>
      ${sizes.length ? `<label class="sel">Size <select data-nav><option value="${link('size', '')}">All sizes</option>${sizes.map(s => `<option value="${link('size', s)}" ${size === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>` : ''}
      <a class="chip ${instock ? 'on' : ''}" href="${link('instock', instock ? '' : '1')}">In stock only</a>
    </div>
    ${kind === 'saved' && !list.length ? '<p class="empty">Tap the ♡ on any product to save it here.</p>' : grid(shown)}
  </section>`;
}

function pageCombos() {
  const combos = activeBundles(catalog);
  return `<section class="sec"><nav class="crumbs"><a href="#/">Home</a> / <span>Combo deals</span></nav>
    <h1>Combo deals</h1><p class="muted lead">Buy the set and the discount applies automatically in your bag.</p>
    ${combos.length ? combosHtml(combos) : '<p class="empty">No combos running right now.</p>'}</section>`;
}

let pdpState = {};
function pageProduct(id) {
  const p = product(id);
  if (!p || p.active === false) return pageNotFound();
  viewed = [id, ...viewed.filter(x => x !== id)].slice(0, 12);
  store.set('viewed', viewed);
  const c = category(p.category);
  const multi = p.variants.length > 1;
  const firstAvail = p.variants.find(v => v.stock > 0);
  pdpState = { id, variantId: multi ? (pdpState.id === id ? pdpState.variantId : null) : p.variants[0].id, qty: 1 };
  const v = p.variants.find(x => x.id === pdpState.variantId);
  const imgs = p.images?.length ? p.images : [null];
  const combos = activeBundles(catalog).filter(b => b.items.includes(id));
  const fbt = recommend(catalog, id, 3);

  return `<section class="sec pdp">
    <nav class="crumbs"><a href="#/">Home</a> / ${c ? `<a href="#/c/${esc(c.id)}">${esc(c.name)}</a> / ` : ''}<span>${esc(p.name)}</span></nav>
    <div class="pdp-grid">
      <div class="gallery">
        <div class="g-main" id="gMain">${imgs.map((src, i) => `<div class="g-slide">${src ? `<img src="${esc(src)}" alt="${esc(p.name)} photo ${i + 1}" ${i ? 'loading="lazy"' : ''}>` : placeholder(p, 'big')}</div>`).join('')}</div>
        ${imgs.length > 1 ? `<div class="g-thumbs">${imgs.map((src, i) => `<button data-thumb="${i}" class="${i ? '' : 'on'}" aria-label="Photo ${i + 1}"><img src="${esc(src)}" alt=""></button>`).join('')}</div>` : ''}
        ${heart(p.id)}
      </div>
      <div class="buybox">
        <h1>${esc(p.name)}</h1>
        <div class="price big">${priceHtml(p)} ${isOnSale(p) ? `<i class="tag sale">Save ${salePercent(p)}%</i>` : ''}</div>
        ${ratings[p.id]?.count ? `<a href="#reviews" class="rating-link" data-scroll="reviews">${ratingHtml(p.id)}</a>` : ''}
        ${multi ? `<div class="opt"><div class="opt-hd"><b>Size</b><span id="sizeSel">${v ? esc(v.label) : 'Please select'}</span></div>
          <div class="sizes-pick">${p.variants.map(x => `<button data-variant="${esc(x.id)}" class="${x.id === pdpState.variantId ? 'on' : ''}" ${x.stock <= 0 ? 'disabled' : ''}>${esc(x.label)}</button>`).join('')}</div></div>` : ''}
        <div id="stockLine">${stockNote(p, v || (multi ? null : p.variants[0]))}</div>
        <div class="buy-row">
          <div class="stepper big" id="pdpQty"><button data-d="-1" aria-label="Fewer">−</button><span>1</span><button data-d="1" aria-label="More">+</button></div>
          <button class="btn primary grow" id="addBtn" ${!firstAvail ? 'disabled' : ''}>${firstAvail ? 'Add to bag' : 'Sold out'}</button>
        </div>
        <p class="tiny">🚚 ${catalog.settings.freeDeliveryOver ? 'Free delivery over ' + fmt(catalog.settings.freeDeliveryOver) : 'Nationwide delivery'} · 💳 Pay by transfer · 📱 Track with your phone</p>
        ${p.description ? `<div class="desc"><h2>Details</h2><p>${esc(p.description).replace(/\n/g, '<br>')}</p></div>` : ''}
        ${combos.map(b => comboBlock(b, id)).join('')}
      </div>
    </div>
    ${fbt.length ? fbtHtml(p, fbt) : ''}
    <section class="reviews" id="reviews"></section>
  </section>
  ${(() => { const more = visible().filter(x => x.category === p.category && x.id !== id).slice(0, 4); return more.length ? `<section class="sec"><div class="sec-hd"><h2>More ${esc(c?.name || '')}</h2></div>${grid(more)}</section>` : ''; })()}
  ${recentHtml(id)}`;
}

function comboBlock(b, currentId) {
  const o = bundleOffer(catalog, b);
  const st = comboState(b);
  return `<div class="combo-box" data-combo="${esc(b.id)}">
    <div class="combo-box-hd"><b>🎁 ${esc(b.name)}</b><i class="tag sale">Save ${fmt(o.saving)}</i></div>
    ${b.description ? `<p class="muted">${esc(b.description)}</p>` : ''}
    <ul>${st.items.map(p => {
      const need = st.missing.has(p.id);
      return `<li class="${need ? '' : 'have'}">
      <span class="mini">${img(p)}</span>
      <span class="nm">${p.id === currentId ? '<b>This item:</b> ' : ''}${esc(p.name)}${need ? '' : '<small class="ok-txt">✓ Already in your bag</small>'}</span>
      ${need && p.variants.length > 1 ? `<select data-combo-variant="${esc(p.id)}" aria-label="Size for ${esc(p.name)}"><option value="">Size</option>${p.variants.map(v => `<option value="${esc(v.id)}" ${v.stock <= 0 ? 'disabled' : ''} ${p.id === pdpState.id && v.id === pdpState.variantId ? 'selected' : ''}>${esc(v.label)}${v.stock <= 0 ? ' (sold out)' : ''}</option>`).join('')}</select>` : ''}
      <span class="pr">${fmt(p.price)}</span>
    </li>`;
    }).join('')}</ul>
    <div class="combo-box-ft"><span>Combo price <b>${fmt(o.price)}</b> <s>${fmt(o.sum)}</s></span><button class="btn primary sm" data-add-combo="${esc(b.id)}">${comboBtnLabel(st, st.items.length)}</button></div>
  </div>`;
}

function fbtHtml(p, recs) {
  const all = [p, ...recs];
  const pick = all.filter(x => !inBag(x.id));
  return `<section class="fbt" id="fbt">
    <h2>Frequently bought together</h2>
    <div class="fbt-row">
      <div class="fbt-imgs">${all.map(x => `<a href="#/p/${esc(x.id)}">${img(x)}</a>`).join('<span class="plus">+</span>')}</div>
      <div class="fbt-list">
        ${all.map((x, i) => `<label><input type="checkbox" data-fbt="${esc(x.id)}" data-price="${x.price}" ${inBag(x.id) ? '' : 'checked'}> ${i ? '' : '<b>This item:</b> '}${esc(x.name)} <span class="pr">${fmt(x.price)}</span>${inBag(x.id) ? ' <small class="ok-txt">✓ in your bag</small>' : x.variants.length > 1 ? ' <span class="muted">(choose size)</span>' : ''}</label>`).join('')}
        <div class="fbt-ft"><span>Total: <b id="fbtTotal">${fmt(pick.reduce((s, x) => s + x.price, 0))}</b></span><button class="btn primary sm" id="fbtAdd">Add selected to bag</button></div>
      </div>
    </div>
  </section>`;
}

function pageBag() {
  return `<section class="sec narrow"><h1>Your bag</h1><div class="bag-page">${bagHtml(true)}</div></section>`;
}

const NG_STATES = ['Abia', 'Abuja (FCT)', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'];
let checkout = store.get('checkout', { name: '', phone: '', email: '', address: '', city: '', state: 'Lagos', zoneId: '', note: '' });

function pageCheckout() {
  if (!bag.length) return pageBag();
  const q = quote(checkout.zoneId);
  const zones = catalog.settings.zones || [];
  const f = (k, label, attrs = '') => `<label class="fld"><span>${label}</span><input name="${k}" value="${esc(checkout[k] || '')}" ${attrs}></label>`;
  return `<section class="sec checkout">
    <nav class="crumbs"><a href="#/bag">Bag</a> / <span>Checkout</span></nav>
    <h1>Checkout</h1>
    <div class="co-grid">
      <form id="coForm" class="co-form" novalidate>
        <fieldset><legend>1. Your details</legend>
          ${f('name', 'Full name', 'autocomplete="name" required')}
          ${f('phone', 'Phone (WhatsApp preferred)', 'type="tel" inputmode="tel" autocomplete="tel" required placeholder="0803 000 0000"')}
          <p class="tiny">We’ll use this number to send your order updates — and you’ll use it with a one-time code to track your orders. No account needed.</p>
          ${f('email', 'Email (optional)', 'type="email" autocomplete="email"')}
        </fieldset>
        <fieldset><legend>2. Delivery</legend>
          <div class="zones">${zones.map(z => `<label class="zone ${checkout.zoneId === z.id ? 'on' : ''}"><input type="radio" name="zoneId" value="${esc(z.id)}" ${checkout.zoneId === z.id ? 'checked' : ''}><span>${esc(z.name)}</span><b>${z.fee ? (q.freeDeliveryGap <= 0 && catalog.settings.freeDeliveryOver ? '<s>' + fmt(z.fee) + '</s> FREE' : fmt(z.fee)) : 'Free'}</b></label>`).join('')}</div>
          <div id="addrBlock" ${checkout.zoneId === 'pickup' ? 'hidden' : ''}>
            ${f('address', 'Street address', 'autocomplete="street-address"')}
            <div class="two">${f('city', 'Area / City', 'autocomplete="address-level2"')}
              <label class="fld"><span>State</span><select name="state">${NG_STATES.map(s => `<option ${checkout.state === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div>
          </div>
          <label class="fld"><span>Note for us (optional)</span><textarea name="note" rows="2" placeholder="e.g. Gift wrap please, deliver after 4pm">${esc(checkout.note || '')}</textarea></label>
        </fieldset>
        <fieldset><legend>3. Payment</legend>
          ${catalog.settings.cardPayments ? `<label class="pay-opt ${checkout.payment === 'card' ? 'on' : ''}"><input type="radio" name="payment" value="card" ${checkout.payment === 'card' ? 'checked' : ''}><b>💳 Card, USSD or bank app</b><span>Pay securely with Paystack. Needs your email for the receipt.</span></label>` : ''}
          <label class="pay-opt ${checkout.payment !== 'card' || !catalog.settings.cardPayments ? 'on' : ''}"><input type="radio" name="payment" value="transfer" ${checkout.payment !== 'card' || !catalog.settings.cardPayments ? 'checked' : ''}><b>🏦 Bank transfer</b><span>After you place your order we’ll show the account details. Your items are reserved for you.</span></label>
        </fieldset>
        <div class="err" id="coErr" role="alert"></div>
        <button class="btn primary block big" id="placeBtn">Place order · ${fmt(q.total)}</button>
      </form>
      <aside class="co-sum">
        <h2>Order summary</h2>
        <div class="co-lines">${q.lines.map(l => `<div class="co-line"><span class="mini">${img(product(l.productId))}<i>${l.qty}</i></span><span class="nm">${esc(l.name)}${l.variantLabel ? `<small>${esc(l.variantLabel)}</small>` : ''}</span><b>${fmt(l.amount)}</b></div>`).join('')}</div>
        ${summaryHtml(q, true)}
        <a href="#/bag" class="tiny">Edit bag</a>
      </aside>
    </div>
  </section>`;
}

function pageOrderDone(no) {
  const last = store.get('lastOrder', null);
  if (!last || last.order.no !== no) return `<section class="sec narrow"><h1>Order ${esc(no)}</h1><p>Track this order any time from <a href="#/track">My orders</a>.</p></section>`;
  const { order, bank, whatsapp } = last;
  const msg = `Hello FaasKids 👋 I just placed order *${order.no}* (${fmt(order.total)}). Here is my payment proof:`;
  const paid = order.status && order.status !== 'pending';
  return `<section class="sec narrow done">
    <div class="done-hd"><div class="emoji-xl">🎉</div><h1>Thank you, ${esc(order.customer.name.split(' ')[0])}!</h1><p>${paid ? `Payment received — order <b>${esc(order.no)}</b> is confirmed. We’ll text you when it ships.` : `Your order <b>${esc(order.no)}</b> is reserved. Complete payment to confirm it.`}</p></div>
    ${paid ? '<div class="paybox paid"><h2>✅ Paid</h2><p class="muted">Thank you! A receipt is on its way to your email.</p></div>' : `
    ${last.payUrl ? `<a class="btn primary block big" href="${esc(last.payUrl)}">💳 Pay ${fmt(order.total)} by card</a><p class="tiny center">or pay by bank transfer:</p>` : ''}
    <div class="paybox">
      <h2>Pay ${fmt(order.total)} by bank transfer</h2>
      <dl>
        <div><dt>Account name</dt><dd>${esc(bank?.name)}</dd></div>
        <div><dt>Bank</dt><dd>${esc(bank?.bank)}</dd></div>
        <div><dt>Account number</dt><dd class="acct">${esc(bank?.number)} <button class="btn sm ghost" data-copy="${esc(bank?.number)}">Copy</button></dd></div>
        <div><dt>Reference</dt><dd>${esc(order.no)} <button class="btn sm ghost" data-copy="${esc(order.no)}">Copy</button></dd></div>
      </dl>
      <a class="btn block wa" target="_blank" rel="noopener" href="https://wa.me/${esc(whatsapp)}?text=${encodeURIComponent(msg)}">📲 Send payment proof on WhatsApp</a>
    </div>`}
    <div class="recap">${order.lines.map(l => `<div><span>${esc(l.name)}${l.variantLabel ? ' · ' + esc(l.variantLabel) : ''} ×${l.qty}</span><b>${fmt(l.amount)}</b></div>`).join('')}
      ${order.bundleSaving ? `<div class="save"><span>Combo savings</span><b>−${fmt(order.bundleSaving)}</b></div>` : ''}
      ${order.promo?.saving ? `<div class="save"><span>${order.promo.auto ? esc(order.promo.label || 'Website discount') : 'Promo ' + esc(order.promo.code)}</span><b>−${fmt(order.promo.saving)}</b></div>` : ''}
      <div><span>Delivery · ${esc(order.zone?.name)}</span><b>${order.deliveryFee ? fmt(order.deliveryFee) : 'FREE'}</b></div>
      <div class="tot"><span>Total</span><b>${fmt(order.total)}</b></div></div>
    <p class="muted">Track it any time at <a href="#/track">My orders</a> using your phone number <b>${esc(order.customer.phoneRaw)}</b> — we’ll text you a one-time code.</p>
    <a class="btn ghost" href="#/">Continue shopping</a>
  </section>`;
}

/* ---------- track orders: phone + one-time code ---------- */
const STATUS = {
  pending: ['Awaiting payment', '⏳'], paid: ['Payment confirmed', '✅'], packed: ['Packed', '📦'],
  shipped: ['On its way', '🚚'], delivered: ['Delivered', '🏠'], cancelled: ['Cancelled', '✕']
};
const FLOW = ['pending', 'paid', 'packed', 'shipped', 'delivered'];
let track = { step: store.get('session', null) ? 'orders' : 'phone', phone: '', msg: '', testCode: null, orders: null };

function pageTrack() {
  const session = store.get('session', null);
  if (track.step === 'orders' && session) {
    if (!track.orders) { loadMyOrders(); return `<section class="sec narrow"><h1>My orders</h1><p class="muted">Loading your orders…</p></section>`; }
    return `<section class="sec narrow"><div class="list-hd"><h1>My orders</h1><button class="btn sm ghost" id="signOut">Sign out</button></div>
      <p class="muted">Orders for ${esc(session.phone)}</p>
      ${track.orders.length ? track.orders.map(orderCard).join('') : '<p class="empty">No orders on this number yet.</p>'}</section>`;
  }
  return `<section class="sec narrow track">
    <h1>Track my orders</h1>
    <p class="muted lead">No account or password — enter the phone number you ordered with and we’ll text you a one-time code.</p>
    ${track.step === 'phone' ? `<form id="otpPhone" class="otp">
        <label class="fld"><span>Phone number</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${esc(track.phone || checkout.phone || '')}" placeholder="0803 000 0000" required></label>
        <button class="btn primary block">Text me a code</button>
      </form>`
    : `<form id="otpCode" class="otp">
        <p>${esc(track.msg)}</p>
        ${track.testCode ? `<p class="test">🧪 Test mode (SMS not connected yet): your code is <b>${esc(track.testCode)}</b></p>` : ''}
        <label class="fld"><span>6-digit code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required class="code"></label>
        <button class="btn primary block">Verify & show my orders</button>
        <button type="button" class="btn ghost block" id="otpBack">Use a different number</button>
      </form>`}
    <div class="err" id="otpErr" role="alert"></div>
  </section>`;
}
function orderCard(o) {
  const [label, icon] = STATUS[o.status] || [o.status, '•'];
  const at = FLOW.indexOf(o.status);
  return `<article class="ocard">
    <div class="ocard-hd"><div><b>${esc(o.no)}</b><span class="muted"> · ${new Date(o.ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div><span class="st st-${esc(o.status)}">${icon} ${label}</span></div>
    ${o.status !== 'cancelled' ? `<ol class="steps">${FLOW.map((s, i) => `<li class="${i <= at ? 'on' : ''}">${STATUS[s][0]}</li>`).join('')}</ol>` : ''}
    ${o.tracking ? `<p class="tiny">Tracking: <b>${esc(o.tracking)}</b></p>` : ''}
    <div class="recap">${o.lines.map(l => `<div><span>${esc(l.name)}${l.variantLabel ? ' · ' + esc(l.variantLabel) : ''} ×${l.qty}${track.canReview?.includes(l.productId) ? ` <button class="rate-btn" data-rate="${esc(l.productId)}">★ Rate it</button>` : track.reviewed?.includes(l.productId) ? ' <small class="ok-txt">✓ Reviewed</small>' : ''}</span><b>${fmt(l.amount)}</b></div>`).join('')}<div class="tot"><span>Total</span><b>${fmt(o.total)}</b></div></div>
    ${o.status === 'pending' ? `<p class="tiny">Awaiting your transfer to ${esc(catalog.settings.bank?.bank)} ${esc(catalog.settings.bank?.number)} — reference ${esc(o.no)}.</p>` : ''}
  </article>`;
}
async function loadMyOrders() {
  const session = store.get('session', null);
  try {
    const r = await fetch('/api/account', { headers: { Authorization: 'Bearer ' + session.token } });
    if (r.status === 401) { store.set('session', null); track = { step: 'phone' }; return render(); }
    track.orders = (await r.json()).orders || [];
    const rv = await fetch('/api/reviews?mine=1', { headers: { Authorization: 'Bearer ' + session.token } }).then(x => x.json()).catch(() => ({}));
    track.canReview = rv.canReview || [];
    track.reviewed = rv.reviewed || [];
  } catch { track.orders = []; }
  if (location.hash.startsWith('#/track')) render();
}
async function otpCall(body) {
  const r = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function openRateForm(productId, anchor) {
  $('.rate-form')?.remove();
  const p = product(productId);
  const f = document.createElement('form');
  f.className = 'rate-form';
  f.innerHTML = `<b>Rate ${esc(p?.name || 'this item')}</b>
    <div class="star-pick">${[5, 4, 3, 2, 1].map(n => `<input type="radio" name="rating" value="${n}" id="st${n}"><label for="st${n}" title="${n} stars">★</label>`).join('')}</div>
    <textarea name="text" rows="2" maxlength="1000" placeholder="What did you and your little one think?"></textarea>
    <input name="name" maxlength="40" placeholder="Your first name (shown with the review)" value="${esc((checkout.name || '').split(' ')[0])}">
    <div class="err" role="alert"></div>
    <button class="btn primary sm">Post review</button>`;
  anchor.closest('.ocard').appendChild(f);
  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    if (!d.rating) return ($('.err', f).textContent = 'Tap the stars to rate');
    const r = await fetch('/api/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + store.get('session', {}).token }, body: JSON.stringify({ productId, ...d }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return ($('.err', f).textContent = data.error || 'Could not post');
    track.canReview = track.canReview.filter(x => x !== productId);
    track.reviewed = [...(track.reviewed || []), productId];
    toast('Thank you for your review! 💛');
    loadRatings();
    render();
  });
}
async function loadRatings() {
  try { ratings = (await fetch('/api/reviews').then(r => r.json())).summary || {}; } catch {}
}

function pageNotFound() {
  return `<section class="sec narrow"><h1>Page not found</h1><p>That page has moved or no longer exists.</p><a class="btn primary" href="#/">Back to the shop</a></section>`;
}

/* ---------- router ---------- */
function render() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  let html;
  switch (parts[0]) {
    case undefined: html = pageHome(); break;
    case 'c': html = pageList('c', parts[1], params); break;
    case 'all': html = pageList('all', null, params); break;
    case 'sale': html = pageList('sale', null, params); break;
    case 'search': html = pageList('search', null, params); break;
    case 'saved': html = pageList('saved', null, params); break;
    case 'combos': html = pageCombos(); break;
    case 'p': html = pageProduct(parts[1]); break;
    case 'bag': html = pageBag(); break;
    case 'checkout': html = pageCheckout(); break;
    case 'order': html = pageOrderDone(parts[1]); break;
    case 'track': html = pageTrack(); break;
    default: html = pageNotFound();
  }
  app.innerHTML = html;
  $$('#catnav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + path));
  $('#searchInput').value = parts[0] === 'search' ? params.get('q') || '' : '';
  afterRender(parts[0]);
}
let lastPath = '';
window.addEventListener('hashchange', () => {
  const path = location.hash.split('?')[0];
  closeBag();
  render();
  if (path !== lastPath) window.scrollTo(0, 0);
  lastPath = path;
});

function afterRender(page) {
  if (page === 'p') wirePdp();
  if (page === 'checkout') wireCheckout();
  if (page === 'track') wireTrack();
}

/* ---------- page wiring ---------- */
async function loadReviews(id) {
  const box = $('#reviews');
  if (!box) return;
  const data = await fetch('/api/reviews?product=' + encodeURIComponent(id)).then(r => r.json()).catch(() => ({}));
  const list = data.reviews || [];
  if (!list.length || pdpState.id !== id || !$('#reviews')) { if ($('#reviews')) $('#reviews').innerHTML = ''; return; }
  const avg = Math.round(list.reduce((s, r) => s + r.rating, 0) / list.length * 10) / 10;
  $('#reviews').innerHTML = `<h2>Reviews</h2>
    <div class="rv-sum">${stars(avg, 'big')} <b>${avg}</b> <span class="muted">from ${list.length} verified buyer${list.length > 1 ? 's' : ''}</span></div>
    ${list.slice(0, 20).map(r => `<article class="rv">${stars(r.rating)}<p>${esc(r.text)}</p><small class="muted">${esc(r.name)} · ✓ Verified purchase · ${new Date(r.ts).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</small></article>`).join('')}`;
}
function wirePdp() {
  const p = product(pdpState.id);
  loadReviews(p.id);
  const qtyEl = $('#pdpQty span');
  const gMain = $('#gMain');
  const syncStock = () => {
    const v = p.variants.find(x => x.id === pdpState.variantId);
    $('#stockLine').innerHTML = stockNote(p, v || (p.variants.length > 1 ? null : p.variants[0]));
    if ($('#sizeSel')) $('#sizeSel').textContent = v ? v.label : 'Please select';
  };
  $$('[data-variant]').forEach(b => b.addEventListener('click', () => {
    pdpState.variantId = b.dataset.variant;
    $$('[data-variant]').forEach(x => x.classList.toggle('on', x === b));
    $('.sizes-pick').classList.remove('need');
    syncStock();
  }));
  $$('#pdpQty button').forEach(b => b.addEventListener('click', () => {
    pdpState.qty = Math.max(1, Math.min(20, pdpState.qty + Number(b.dataset.d)));
    qtyEl.textContent = pdpState.qty;
  }));
  $('#addBtn')?.addEventListener('click', () => {
    if (!pdpState.variantId) {
      $('.sizes-pick')?.classList.add('need');
      toast('Please choose a size');
      return;
    }
    if (addToBag(p.id, pdpState.variantId, pdpState.qty)) refreshBagViews();
  });
  $$('[data-thumb]').forEach(b => b.addEventListener('click', () => {
    gMain.scrollTo({ left: gMain.clientWidth * Number(b.dataset.thumb), behavior: 'smooth' });
  }));
  gMain?.addEventListener('scroll', () => {
    const i = Math.round(gMain.scrollLeft / gMain.clientWidth);
    $$('[data-thumb]').forEach(b => b.classList.toggle('on', Number(b.dataset.thumb) === i));
  }, { passive: true });
  // frequently bought together
  const fbtTotal = () => {
    const sum = $$('[data-fbt]:checked').reduce((s, c) => s + Number(c.dataset.price), 0);
    $('#fbtTotal').textContent = fmt(sum);
  };
  $$('[data-fbt]').forEach(c => c.addEventListener('change', fbtTotal));
  $('#fbtAdd')?.addEventListener('click', () => {
    const picks = $$('[data-fbt]:checked').map(c => product(c.dataset.fbt));
    if (!picks.length) { toast('Tick the items you’d like to add'); return; }
    const needSize = picks.find(x => x.variants.length > 1 && !(x.id === p.id && pdpState.variantId));
    if (needSize) { toast(`Choose a size for <b>${esc(needSize.name)}</b> first`); if (needSize.id !== p.id) location.hash = '#/p/' + needSize.id; return; }
    let n = 0;
    picks.forEach(x => { if (addToBag(x.id, x.id === p.id ? pdpState.variantId : x.variants[0].id, 1, true)) n++; });
    if (n) { toast(`Added ${n} item${n > 1 ? 's' : ''} to your bag — <a href="#" data-open-bag>View bag</a>`); refreshBagViews(); }
  });
}

function addCombo(id, root = document) {
  const b = (catalog.bundles || []).find(x => x.id === id);
  if (!b) return;
  const box = root.querySelector?.(`[data-combo="${CSS.escape(id)}"]`);
  // Only add what's missing: items already in the bag (and not already used by
  // another combo) count towards this one, and nothing else in the bag changes.
  const st = comboState(b);
  const picks = [];
  for (const p of st.items.filter(x => st.missing.has(x.id))) {
    let vid = p.variants.length === 1 ? p.variants[0].id : null;
    const sel = box?.querySelector(`[data-combo-variant="${CSS.escape(p.id)}"]`);
    if (!vid && sel?.value) vid = sel.value;
    if (!vid && p.id === pdpState.id && pdpState.variantId) vid = pdpState.variantId;
    if (!vid) {
      if (sel) { sel.classList.add('need'); sel.focus(); toast(`Choose a size for <b>${esc(p.name)}</b>`); }
      else { toast(`Choose a size for <b>${esc(p.name)}</b>`); location.hash = '#/p/' + p.id; }
      return;
    }
    picks.push([p.id, vid]);
  }
  for (const [pid, vid] of picks) {
    const v = product(pid).variants.find(x => x.id === vid);
    const have = bag.find(l => l.productId === pid && l.variantId === vid)?.qty || 0;
    if (have + 1 > v.stock) { toast(`Sorry — not enough <b>${esc(product(pid).name)}</b> in stock`); return; }
  }
  picks.forEach(([pid, vid]) => addToBag(pid, vid, 1, true));
  const kept = st.have.length;
  toast(`🎁 ${esc(b.name)} complete${kept ? ` — used the ${kept === 1 ? esc(st.have[0].name) : kept + ' items'} already in your bag` : ''}. Discount applied! <a href="#" data-open-bag>View bag</a>`);
  refreshBagViews(true);
}

function wireCheckout() {
  const form = $('#coForm');
  const persist = () => {
    const d = Object.fromEntries(new FormData(form));
    checkout = { ...checkout, ...d };
    store.set('checkout', checkout);
  };
  form.addEventListener('input', persist);
  $$('input[name=zoneId], input[name=payment]', form).forEach(r => r.addEventListener('change', () => { persist(); render(); }));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    persist();
    const err = $('#coErr');
    err.textContent = '';
    if (!checkout.name.trim()) return (err.textContent = 'Please enter your name');
    if (normalizePhone(checkout.phone).length < 10) return (err.textContent = 'Please enter a valid phone number');
    if (!checkout.zoneId) return (err.textContent = 'Please choose a delivery option');
    if (checkout.zoneId !== 'pickup' && !checkout.address.trim()) return (err.textContent = 'Please enter your delivery address');
    const payment = catalog.settings.cardPayments && checkout.payment === 'card' ? 'card' : 'transfer';
    if (payment === 'card' && !/^\S+@\S+\.\S+$/.test(checkout.email || '')) return (err.textContent = 'Please enter your email for the card receipt');
    const btn = $('#placeBtn');
    btn.disabled = true;
    btn.textContent = 'Placing your order…';
    try {
      const r = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: bag, promoCode, zoneId: checkout.zoneId, payment,
          customer: { ...checkout, address: checkout.zoneId === 'pickup' ? '' : checkout.address, state: checkout.zoneId === 'pickup' ? '' : checkout.state }
        })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 409) await loadCatalog(); // stock moved — refresh so the bag shows what's left
        throw new Error(data.error || 'Could not place the order');
      }
      store.set('lastOrder', data);
      bag = []; saveBag();
      promoCode = ''; promoRule = null; store.set('promo', '');
      track.orders = null;
      loadCatalog().catch(() => {});
      if (data.payUrl) { location.href = data.payUrl; return; } // off to Paystack
      location.hash = '#/order/' + data.order.no;
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
      btn.textContent = 'Place order';
    }
  });
}

function wireTrack() {
  $('#otpPhone')?.addEventListener('submit', async e => {
    e.preventDefault();
    const phone = new FormData(e.target).get('phone');
    try {
      const r = await otpCall({ action: 'send', phone });
      track = { step: 'code', phone, msg: r.message, testCode: r.testCode };
      render();
      $('[name=code]')?.focus();
    } catch (ex) { $('#otpErr').textContent = ex.message; }
  });
  $('#otpCode')?.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const r = await otpCall({ action: 'verify', phone: track.phone, code: new FormData(e.target).get('code') });
      store.set('session', { token: r.token, phone: track.phone });
      track = { step: 'orders', orders: null };
      render();
    } catch (ex) { $('#otpErr').textContent = ex.message; }
  });
  $('#otpBack')?.addEventListener('click', () => { track = { step: 'phone', phone: track.phone }; render(); });
  $('#signOut')?.addEventListener('click', () => { store.set('session', null); track = { step: 'phone' }; render(); });
}

/* ---------- global delegated events ---------- */
document.addEventListener('click', async e => {
  const rate = e.target.closest('[data-rate]');
  if (rate) { openRateForm(rate.dataset.rate, rate); return; }
  const t = e.target.closest('[data-save],[data-open-bag],[data-add],[data-add-combo],[data-remove],[data-line] button,[data-clear-promo],[data-copy]');
  if (!t) return;
  if (t.dataset.save) { e.preventDefault(); toggleSaved(t.dataset.save); }
  else if (t.hasAttribute('data-open-bag')) { e.preventDefault(); openBag(); }
  else if (t.dataset.add) { const p = product(t.dataset.add); if (addToBag(p.id, p.variants[0].id, 1)) refreshBagViews(); }
  else if (t.dataset.addCombo) addCombo(t.dataset.addCombo);
  else if (t.dataset.remove) { const [pid, vid] = t.dataset.remove.split('|'); setQty(pid, vid, 0); refreshBagViews(); }
  else if (t.closest('[data-line]')) {
    const [pid, vid] = t.closest('[data-line]').dataset.line.split('|');
    const line = bag.find(l => l.productId === pid && l.variantId === vid);
    if (line) { setQty(pid, vid, line.qty + Number(t.dataset.d)); refreshBagViews(); }
  }
  else if (t.hasAttribute('data-clear-promo')) { e.preventDefault(); promoCode = ''; promoRule = null; store.set('promo', ''); refreshBagViews(); }
  else if (t.dataset.copy) {
    try { await navigator.clipboard.writeText(t.dataset.copy); toast('Copied ✓'); } catch { toast(esc(t.dataset.copy)); }
  }
});
document.addEventListener('submit', async e => {
  if (e.target.id !== 'promoForm') return;
  e.preventDefault();
  promoCode = $('#promoInput', e.target).value.trim().toUpperCase();
  store.set('promo', promoCode);
  if (promoCode) await fetchPromo(promoCode);
  refreshBagViews();
});
document.addEventListener('change', e => {
  if (e.target.matches('select[data-nav]')) location.hash = e.target.value;
  if (e.target.matches('[data-combo-variant]')) e.target.classList.remove('need');
});
$('#bagBtn').addEventListener('click', openBag);
$('#drawerClose').addEventListener('click', closeBag);
$('#scrim').addEventListener('click', closeBag);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeBag(); });
$('#searchForm').addEventListener('submit', e => {
  e.preventDefault();
  const q = $('#searchInput').value.trim();
  location.hash = q ? '#/search?q=' + encodeURIComponent(q) : '#/all';
  $('#searchInput').blur();
});
// keep bag in sync across tabs
window.addEventListener('storage', e => { if (e.key === 'fk-bag') { bag = store.get('bag', []); updateBadges(); refreshBagViews(); } });

/* ---------- chrome ---------- */
function renderChrome() {
  const s = catalog.settings;
  const auto = (catalog.promos || []).filter(p => p.auto).sort((a, b) => (b.value || 0) - (a.value || 0))[0];
  const autoTxt = auto ? `🎉 ${auto.type === 'percent' ? auto.value + '% off' : auto.type === 'fixed' ? fmt(auto.value) + ' off' : 'Free delivery on'} every website order${auto.minSubtotal ? ' over ' + fmt(auto.minSubtotal) : ''} — no code needed` : '';
  const ann = [autoTxt, s.announcement].filter(Boolean).join(' · ');
  $('#announce').textContent = ann;
  $('#announce').hidden = !ann;
  const hasSale = visible().some(isOnSale);
  $('#catnav').innerHTML = `<a href="#/all">All</a>` +
    catalog.categories.map(c => `<a href="#/c/${esc(c.id)}">${esc(c.name)}</a>`).join('') +
    (activeBundles(catalog).length ? '<a href="#/combos">Combo deals</a>' : '') +
    (hasSale ? '<a href="#/sale" class="sale">Sale</a>' : '');
  $('#footer').innerHTML = `<div class="ftr-in">
    <div><div class="logo"><img src="logo.jpg" alt=""><span><b class="b1">Faas</b><b class="b2">Kids</b></span></div><p class="muted">Grow with Style 💛</p></div>
    <div><h4>Shop</h4>${catalog.categories.map(c => `<a href="#/c/${esc(c.id)}">${esc(c.name)}</a>`).join('')}</div>
    <div><h4>Help</h4><a href="#/track">Track my orders</a><a href="#/combos">Combo deals</a>${s.whatsapp ? `<a href="https://wa.me/${esc(s.whatsapp)}" target="_blank" rel="noopener">WhatsApp us</a>` : ''}</div>
    <div><h4>Contact</h4>${s.phoneDisplay ? `<span>📞 ${esc(s.phoneDisplay)}</span>` : ''}${s.instagram ? `<a href="https://instagram.com/${esc(s.instagram)}" target="_blank" rel="noopener">@${esc(s.instagram)}</a>` : ''}<span>Nationwide delivery</span></div>
  </div><p class="copy">© ${new Date().getFullYear()} FaasKids · <a href="admin.html">Staff</a></p>`;
}

/* ---------- back from Paystack: /shop.html?paid=FK-…&reference=… ---------- */
async function returnFromPaystack() {
  const qs = new URLSearchParams(location.search);
  const no = qs.get('paid');
  if (!no) return;
  history.replaceState(null, '', location.pathname + '#/order/' + encodeURIComponent(no));
  try {
    const r = await fetch('/api/paystack?reference=' + encodeURIComponent(qs.get('reference') || no));
    const data = await r.json();
    const last = store.get('lastOrder', null);
    if (last?.order?.no === no && data.status) { last.order.status = data.status; store.set('lastOrder', last); }
    if (data.status === 'paid') toast('✅ Payment received — thank you!');
  } catch {}
}

/* ---------- boot ---------- */
(async function boot() {
  app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  updateBadges();
  try {
    await loadCatalog();
  } catch (e) {
    app.innerHTML = `<section class="sec narrow"><h1>We’ll be right back</h1><p class="muted">${esc(e.message)}. Please refresh in a moment.</p></section>`;
    return;
  }
  saveBag();
  renderChrome();
  await returnFromPaystack();
  loadRatings().then(() => { if (Object.keys(ratings).length) render(); });
  lastPath = location.hash.split('?')[0];
  render();
})();
