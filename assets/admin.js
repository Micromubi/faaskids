// FaasKids admin — orders, products & inventory, combos, promos, settings, sales.
import { fmt, productStock, bundleOffer } from '../lib/pricing.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const PIN_KEY = 'fk-admin-pin';
let pin = sessionStorage.getItem(PIN_KEY) || localStorage.getItem('faaskids-pin') || '';
let catalog = null, orders = null, invoices = null;

/* ---------- api ---------- */
async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const r = await fetch(path, {
    method,
    headers: { 'x-pin': pin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw || (body ? JSON.stringify(body) : undefined)
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { showLogin('Wrong PIN'); throw new Error('wrong pin'); }
  if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
  return data;
}
const op = async (name, args) => {
  const r = await api('/api/catalog', { method: 'POST', body: { op: name, ...args } });
  catalog = r.catalog;
  return r;
};
const loadCatalog = async () => { catalog = await api('/api/catalog'); };
const loadOrders = async () => { orders = await api('/api/orders'); };
const loadInvoices = async () => { try { invoices = await api('/api/invoices'); } catch { invoices = []; } };

function toast(msg) {
  const t = $('#toast');
  t.innerHTML = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2400);
}
async function busy(btn, fn) {
  const txt = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try { await fn(); } catch (e) { if (e.message !== 'wrong pin') alert(e.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = txt; } }
}
const product = id => catalog.products.find(p => p.id === id);
const catName = id => catalog.categories.find(c => c.id === id)?.name || id || '—';
const thumb = p => (p?.images || [])[0] ? `<img src="${esc(p.images[0])}" alt="">` : `<span class="ph">${esc(catalog.categories.find(c => c.id === p?.category)?.emoji || '🎈')}</span>`;
const date = ts => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const lowAt = () => catalog.settings.lowStockAt || 3;

/* ---------- modal ---------- */
function openModal(html, wide = false) {
  $('#modalBody').innerHTML = html;
  $('.modal-card').classList.toggle('wide', wide);
  $('#modal').hidden = false;
  document.body.classList.add('locked');
}
function closeModal() { $('#modal').hidden = true; document.body.classList.remove('locked'); }
$('#modalX').addEventListener('click', closeModal);
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ---------- login ---------- */
function showLogin(msg = '') {
  $('#login').hidden = false;
  $('#loginErr').textContent = msg;
  $('#pinInput').value = '';
  setTimeout(() => $('#pinInput').focus(), 50);
}
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  pin = $('#pinInput').value.trim();
  try {
    await api('/api/catalog', { method: 'POST', body: { op: 'auth' } });
    sessionStorage.setItem(PIN_KEY, pin);
    $('#login').hidden = true;
    boot();
  } catch (ex) { if (ex.message !== 'wrong pin') $('#loginErr').textContent = ex.message; }
});
$('#logout').addEventListener('click', () => { sessionStorage.removeItem(PIN_KEY); localStorage.removeItem('faaskids-pin'); localStorage.removeItem('faaskids-unlocked'); pin = ''; showLogin(); });

/* =========================================================
   DASHBOARD
   ========================================================= */
const PAID = ['paid', 'packed', 'shipped', 'delivered'];
let period = 30;

function salesRows() {
  // unify web orders + invoices from the invoice tool into one list of sales
  const web = (orders || []).filter(o => PAID.includes(o.status)).map(o => ({
    ts: o.paidAt || o.ts, total: o.total, channel: 'Website',
    items: o.lines.map(l => ({ key: l.productId, name: l.name, qty: l.qty, amount: l.amount }))
  }));
  const inv = (invoices || []).map(e => ({
    ts: e.ts, total: e.total || 0, channel: 'Invoice',
    items: (e.items || []).map(i => ({ key: 'inv:' + i.name, name: i.name, qty: i.qty || 0, amount: i.amount || (i.qty || 0) * (i.price || 0) }))
  }));
  return [...web, ...inv];
}

function pageDashboard() {
  const since = period ? Date.now() - period * 864e5 : 0;
  const rows = salesRows().filter(r => r.ts >= since);
  const revenue = rows.reduce((s, r) => s + r.total, 0);
  const units = rows.reduce((s, r) => s + r.items.reduce((a, i) => a + i.qty, 0), 0);
  const pending = (orders || []).filter(o => o.status === 'pending');
  const toShip = (orders || []).filter(o => o.status === 'paid' || o.status === 'packed');
  const low = catalog.products.flatMap(p => p.variants.filter(v => v.stock <= lowAt()).map(v => ({ p, v })));
  const byChannel = ['Website', 'Invoice'].map(ch => ({ ch, total: rows.filter(r => r.channel === ch).reduce((s, r) => s + r.total, 0), n: rows.filter(r => r.channel === ch).length }));
  const top = new Map();
  rows.forEach(r => r.items.forEach(i => {
    const cur = top.get(i.name) || { name: i.name, qty: 0, amount: 0 };
    cur.qty += i.qty; cur.amount += i.amount; top.set(i.name, cur);
  }));
  const topList = [...top.values()].sort((a, b) => b.amount - a.amount).slice(0, 8);
  const stockValue = catalog.products.reduce((s, p) => s + productStock(p) * p.price, 0);

  return `<div class="a-head"><h1>Dashboard</h1>
    <div class="seg">${[[7, '7 days'], [30, '30 days'], [90, '90 days'], [0, 'All time']].map(([d, l]) => `<button data-period="${d}" class="${period === d ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    ${catalog.demo ? '<div class="notice">👋 This is the <b>starter catalogue</b>. Edit products, prices, stock and photos under <a href="#/products">Products & stock</a> — the first save makes it yours.</div>' : ''}
    <div class="tiles">
      <div class="tile"><span>Revenue</span><b>${fmt(revenue)}</b><small>${rows.length} paid sale${rows.length === 1 ? '' : 's'}</small></div>
      <div class="tile"><span>Average order</span><b>${fmt(rows.length ? revenue / rows.length : 0)}</b><small>${units} items sold</small></div>
      <a class="tile warn" href="#/orders?status=pending"><span>Awaiting payment</span><b>${pending.length}</b><small>${fmt(pending.reduce((s, o) => s + o.total, 0))} reserved</small></a>
      <a class="tile go" href="#/orders?status=paid"><span>To pack & ship</span><b>${toShip.length}</b><small>paid, not yet shipped</small></a>
    </div>
    <div class="a-grid">
      <section class="panel span2"><h2>Revenue by day</h2>${chartHtml(rows)}</section>
      <section class="panel"><h2>Sales channels</h2>
        ${byChannel.map(c => `<div class="kv"><span>${c.ch === 'Website' ? '🛍️ Website orders' : '🧾 Invoices (WhatsApp / in person)'}</span><b>${fmt(c.total)}</b></div><div class="kv sub"><span>${c.n} sale${c.n === 1 ? '' : 's'}</span><span>${revenue ? Math.round(c.total / revenue * 100) : 0}%</span></div>`).join('')}
        <div class="kv" style="margin-top:14px"><span>Stock on hand (retail value)</span><b>${fmt(stockValue)}</b></div>
      </section>
      <section class="panel"><h2>Top sellers</h2>
        ${topList.length ? `<ol class="rank">${topList.map(t => `<li><span>${esc(t.name)}</span><small>×${t.qty}</small><b>${fmt(t.amount)}</b></li>`).join('')}</ol>` : '<p class="muted">No sales in this period yet.</p>'}
      </section>
      <section class="panel"><h2>Low stock <small class="muted">(≤ ${lowAt()})</small></h2>
        ${low.length ? `<ul class="lowlist">${low.slice(0, 12).map(({ p, v }) => `<li><a href="#/products?edit=${esc(p.id)}">${esc(p.name)}${v.label ? ' · ' + esc(v.label) : ''}</a><b class="${v.stock <= 0 ? 'out' : 'low'}">${v.stock <= 0 ? 'Sold out' : v.stock + ' left'}</b></li>`).join('')}</ul>${low.length > 12 ? `<a class="tiny" href="#/products?filter=low">+${low.length - 12} more</a>` : ''}` : '<p class="muted">Everything is well stocked ✓</p>'}
      </section>
    </div>`;
}

function chartHtml(rows) {
  const days = period || Math.min(180, Math.max(14, Math.ceil((Date.now() - Math.min(...rows.map(r => r.ts), Date.now())) / 864e5) + 1));
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - days + 1);
  const buckets = Array.from({ length: days }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return { d, v: 0, n: 0 }; });
  rows.forEach(r => { const i = Math.floor((r.ts - start) / 864e5); if (buckets[i]) { buckets[i].v += r.total; buckets[i].n++; } });
  const max = Math.max(...buckets.map(b => b.v), 1);
  const nice = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))); return Math.ceil(max / p) * p; })();
  const W = 720, H = 220, L = 52, B = 22, T = 8;
  const bw = (W - L) / days;
  const gap = Math.min(2, bw * 0.25);
  const y = v => T + (H - T - B) * (1 - v / nice);
  const ticks = [0, nice / 2, nice];
  const short = v => v >= 1e6 ? '₦' + (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + 'm' : v >= 1e3 ? '₦' + Math.round(v / 1e3) + 'k' : '₦' + v;
  const labelEvery = Math.ceil(days / 8);
  return `<div class="chart" id="chart">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenue per day for the selected period">
      ${ticks.map(t => `<line x1="${L}" x2="${W}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L - 8}" y="${y(t) + 4}" class="axis" text-anchor="end">${short(t)}</text>`).join('')}
      ${buckets.map((b, i) => {
        const h = Math.max(0, y(0) - y(b.v));
        const x = L + i * bw + gap / 2, w = Math.max(1, bw - gap);
        const r = Math.min(4, w / 2, h);
        const path = h > 0 ? `M${x},${y(0)} V${y(b.v) + r} Q${x},${y(b.v)} ${x + r},${y(b.v)} H${x + w - r} Q${x + w},${y(b.v)} ${x + w},${y(b.v) + r} V${y(0)} Z` : '';
        return `<g class="bar" data-i="${i}"><rect x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}" class="hit"/>${path ? `<path d="${path}"/>` : ''}${i % labelEvery === 0 ? `<text x="${x + w / 2}" y="${H - 6}" class="axis" text-anchor="middle">${b.d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</text>` : ''}</g>`;
      }).join('')}
    </svg>
    <div class="tip" id="tip" hidden></div>
    <script type="application/json" id="chartData">${JSON.stringify(buckets.map(b => [b.d.toDateString(), b.v, b.n]))}</script>
  </div>
  <details class="tbl"><summary>Show as table</summary><table><thead><tr><th>Day</th><th>Sales</th><th>Revenue</th></tr></thead><tbody>${buckets.filter(b => b.n).map(b => `<tr><td>${b.d.toLocaleDateString('en-GB')}</td><td>${b.n}</td><td>${fmt(b.v)}</td></tr>`).join('') || '<tr><td colspan="3">No sales</td></tr>'}</tbody></table></details>`;
}
function wireChart() {
  const chart = $('#chart');
  if (!chart) return;
  const data = JSON.parse($('#chartData').textContent);
  const tip = $('#tip');
  $$('.bar', chart).forEach(g => {
    const show = () => {
      const [d, v, n] = data[g.dataset.i];
      tip.innerHTML = `<b>${fmt(v)}</b><span>${new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · ${n} sale${n === 1 ? '' : 's'}</span>`;
      tip.hidden = false;
      const r = g.getBoundingClientRect(), c = chart.getBoundingClientRect();
      tip.style.left = Math.min(c.width - 150, Math.max(0, r.left - c.left + r.width / 2 - 75)) + 'px';
      $$('.bar', chart).forEach(x => x.classList.toggle('on', x === g));
    };
    g.addEventListener('mouseenter', show);
    g.addEventListener('click', show);
  });
  chart.addEventListener('mouseleave', () => { tip.hidden = true; $$('.bar', chart).forEach(x => x.classList.remove('on')); });
}

/* =========================================================
   ORDERS
   ========================================================= */
const STATUS = { pending: 'Awaiting payment', paid: 'Paid', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };
const NEXT = { pending: ['paid', 'cancelled'], paid: ['packed', 'shipped', 'cancelled'], packed: ['shipped', 'cancelled'], shipped: ['delivered'], delivered: [], cancelled: ['pending'] };

function pageOrders(params) {
  const status = params.get('status') || 'all';
  const q = (params.get('q') || '').toLowerCase();
  const counts = Object.fromEntries(Object.keys(STATUS).map(s => [s, orders.filter(o => o.status === s).length]));
  const list = orders.filter(o => (status === 'all' || o.status === status) &&
    (!q || [o.no, o.customer.name, o.customer.phoneRaw, o.customer.phone].join(' ').toLowerCase().includes(q)));
  return `<div class="a-head"><h1>Orders</h1><button class="btn sm ghost" data-reload>↻ Refresh</button></div>
    <div class="toolbar">
      <div class="seg wrap"><a href="#/orders" class="${status === 'all' ? 'on' : ''}">All ${orders.length}</a>${Object.entries(STATUS).map(([s, l]) => `<a href="#/orders?status=${s}" class="${status === s ? 'on' : ''}">${l} ${counts[s] || ''}</a>`).join('')}</div>
      <input class="a-search" id="orderSearch" placeholder="Search name, phone or order no." value="${esc(params.get('q') || '')}">
    </div>
    ${list.length ? `<div class="olist">${list.map(o => `
      <button class="orow" data-order="${esc(o.no)}">
        <span class="o-no">${esc(o.no)}<small>${date(o.ts)} · ${new Date(o.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</small></span>
        <span class="o-cust">${esc(o.customer.name)}<small>${esc(o.customer.phoneRaw)}${o.zone ? ' · ' + esc(o.zone.name) : ''}</small></span>
        <span class="o-items">${o.lines.reduce((s, l) => s + l.qty, 0)} item(s)</span>
        <b class="o-tot">${fmt(o.total)}</b>
        <span class="st st-${esc(o.status)}">${STATUS[o.status]}</span>
      </button>`).join('')}</div>` : '<p class="empty">No orders here yet.</p>'}`;
}

function orderModal(no) {
  const o = orders.find(x => x.no === no);
  if (!o) return;
  const c = o.customer;
  const wa = c.phone;
  const msgs = {
    pending: `Hello ${c.name.split(' ')[0]} 👋 Thanks for your FaasKids order ${o.no} (${fmt(o.total)}). Please pay to ${catalog.settings.bank?.bank} ${catalog.settings.bank?.number} (${catalog.settings.bank?.name}) and send the receipt here 💛`,
    paid: `Hi ${c.name.split(' ')[0]}, we’ve received your payment for order ${o.no} ✅ We’re getting it ready!`,
    shipped: `Good news ${c.name.split(' ')[0]} 🚚 Your FaasKids order ${o.no} is on its way!${o.tracking ? ' Tracking: ' + o.tracking : ''}`,
    delivered: `Hi ${c.name.split(' ')[0]}, your order ${o.no} has been delivered 🎉 Thank you for shopping with FaasKids!`
  };
  const msg = msgs[o.status] || msgs.paid;
  openModal(`<h2>Order ${esc(o.no)}</h2>
    <p class="muted">${new Date(o.ts).toLocaleString('en-GB')} · <span class="st st-${esc(o.status)}">${STATUS[o.status]}</span> · ${o.payment?.method === 'card' ? `💳 Paystack${o.payment.reference ? ' ✓ ' + esc(o.payment.channel || '') : ''}` : o.source === 'web' ? '🏦 Bank transfer' : ''}</p>
    <div class="cols2">
      <div>
        <h3>Customer</h3>
        <p><b>${esc(c.name)}</b><br>${esc(c.phoneRaw)}${c.email ? '<br>' + esc(c.email) : ''}</p>
        <h3>Delivery · ${esc(o.zone?.name || '')}</h3>
        <p>${c.address ? esc(c.address) + '<br>' + esc([c.city, c.state].filter(Boolean).join(', ')) : 'Pick up'}</p>
        ${c.note ? `<p class="note">📝 ${esc(c.note)}</p>` : ''}
      </div>
      <div>
        <h3>Items</h3>
        <div class="recap">${o.lines.map(l => `<div><span>${esc(l.name)}${l.variantLabel ? ' · ' + esc(l.variantLabel) : ''} ×${l.qty}</span><b>${fmt(l.amount)}</b></div>`).join('')}
          ${(o.bundles || []).map(b => `<div class="save"><span>🎁 ${esc(b.name)}</span><b>−${fmt(b.saving)}</b></div>`).join('')}
          ${o.promo?.saving ? `<div class="save"><span>${o.promo.auto ? 'Website discount' : 'Coupon ' + esc(o.promo.code)}</span><b>−${fmt(o.promo.saving)}</b></div>` : ''}
          <div><span>Delivery</span><b>${o.deliveryFee ? fmt(o.deliveryFee) : 'FREE'}</b></div>
          <div class="tot"><span>Total</span><b>${fmt(o.total)}</b></div></div>
      </div>
    </div>
    <h3>Update status</h3>
    <div class="status-btns">${NEXT[o.status].map(s => `<button class="btn sm ${s === 'cancelled' ? 'ghost danger' : 'primary'}" data-status="${s}">${s === 'cancelled' ? 'Cancel order (restock)' : s === 'pending' ? 'Re-open order' : 'Mark ' + STATUS[s].toLowerCase()}</button>`).join('') || '<span class="muted">Complete ✓</span>'}</div>
    <div class="cols2">
      <label class="fld"><span>Tracking / rider info</span><input id="oTracking" value="${esc(o.tracking || '')}" placeholder="e.g. GIG 12345 or rider’s number"></label>
      <label class="fld"><span>Private note</span><input id="oNote" value="${esc(o.adminNote || '')}" placeholder="Only you see this"></label>
    </div>
    <div class="modal-ft">
      <button class="btn ghost" id="oSave">Save notes</button>
      <a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/${esc(wa)}?text=${encodeURIComponent(msg)}">📲 WhatsApp customer</a>
      <button class="btn ghost" id="oInvoice">🧾 Make invoice / label</button>
    </div>
    <p class="tiny">History: ${(o.history || []).map(h => `${STATUS[h.status]} ${date(h.ts)}`).join(' → ')}</p>`, true);

  const patch = async (body, btn) => busy(btn, async () => {
    const r = await api('/api/orders', { method: 'PATCH', body: { no: o.no, ...body } });
    orders[orders.findIndex(x => x.no === o.no)] = r.order;
    if (body.status) await loadCatalog(); // stock may have moved
    toast('Saved ✓');
    orderModal(o.no);
    render();
  });
  $$('[data-status]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.status === 'cancelled' && !confirm(`Cancel ${o.no}? Its items go back into stock.`)) return;
    patch({ status: b.dataset.status }, b);
  }));
  $('#oSave').addEventListener('click', e => patch({ tracking: $('#oTracking').value, adminNote: $('#oNote').value }, e.target));
  $('#oInvoice').addEventListener('click', () => {
    // hand the order to the invoice tool (index.html) which picks it up on load
    localStorage.setItem('faaskids-handoff', JSON.stringify({
      name: c.name, phone: c.phoneRaw,
      addr: [c.address, c.city, c.state].filter(Boolean).join(', '),
      delivery: o.deliveryFee,
      discount: (o.bundleSaving || 0) + (o.promo?.saving || 0),
      notes: `Web order ${o.no}`,
      items: o.lines.map(l => ({ name: l.name + (l.variantLabel ? ` (${l.variantLabel})` : ''), qty: l.qty, price: l.unitPrice }))
    }));
    location.href = 'index.html';
  });
}

/* =========================================================
   PRODUCTS & STOCK
   ========================================================= */
function pageProducts(params) {
  const q = (params.get('q') || '').toLowerCase();
  const cat = params.get('cat') || '';
  const filter = params.get('filter') || '';
  const list = catalog.products.filter(p =>
    (!q || (p.name + ' ' + (p.tags || []).join(' ')).toLowerCase().includes(q)) &&
    (!cat || p.category === cat) &&
    (filter !== 'low' || p.variants.some(v => v.stock <= lowAt())) &&
    (filter !== 'hidden' || p.active === false));
  return `<div class="a-head"><h1>Products & stock</h1><button class="btn primary" data-new-product>+ Add product</button></div>
    <div class="toolbar">
      <input class="a-search" id="prodSearch" placeholder="Search products" value="${esc(params.get('q') || '')}">
      <select id="prodCat"><option value="">All categories</option>${catalog.categories.map(c => `<option value="${esc(c.id)}" ${cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <div class="seg"><a href="#/products" class="${!filter ? 'on' : ''}">All</a><a href="#/products?filter=low" class="${filter === 'low' ? 'on' : ''}">Low stock</a><a href="#/products?filter=hidden" class="${filter === 'hidden' ? 'on' : ''}">Hidden</a></div>
    </div>
    <div class="plist">${list.map(p => {
      const total = productStock(p);
      return `<div class="prow ${p.active === false ? 'off' : ''}">
        <button class="p-main" data-edit="${esc(p.id)}">
          <span class="p-img">${thumb(p)}</span>
          <span class="p-name">${esc(p.name)}<small>${esc(catName(p.category))}${p.active === false ? ' · Hidden' : ''}${p.featured ? ' · ★ Bestseller' : ''}</small></span>
          <span class="p-price">${fmt(p.price)}${p.compareAt > p.price ? `<s>${fmt(p.compareAt)}</s>` : ''}</span>
        </button>
        <div class="p-stock">${p.variants.map(v => `<span class="vs ${v.stock <= 0 ? 'out' : v.stock <= lowAt() ? 'low' : ''}">
            ${v.label ? `<i>${esc(v.label)}</i>` : ''}
            <button data-adj="${esc(p.id)}|${esc(v.id)}|-1" aria-label="Remove one">−</button><b>${v.stock}</b><button data-adj="${esc(p.id)}|${esc(v.id)}|1" aria-label="Add one">+</button>
          </span>`).join('')}<span class="p-total">${total} total</span></div>
      </div>`;
    }).join('') || '<p class="empty">No products match.</p>'}</div>`;
}

const SIZE_PRESETS = { 'Kids ages': ['2-3Y', '4-5Y', '6-7Y', '8-9Y', '10-12Y'], 'Shoe sizes': ['EU 24', 'EU 26', 'EU 28', 'EU 30', 'EU 32', 'EU 34'], 'Baby': ['0-6M', '6-12M', '12-18M', '18-24M'], 'One size': [''] };
let draft = null;

function productModal(id) {
  const p = id ? product(id) : null;
  draft = p ? structuredClone(p) : { name: '', category: catalog.categories[0]?.id || '', price: 0, compareAt: 0, description: '', images: [], variants: [{ id: 'std', label: '', stock: 0 }], tags: [], featured: false, active: true };
  draft.variants.forEach(v => { v._base = v.stock; });
  drawProductModal();
}
function drawProductModal() {
  const d = draft;
  openModal(`<h2>${d.id ? 'Edit product' : 'New product'}</h2>
    <form id="pForm" class="pform">
      <label class="fld"><span>Name</span><input name="name" value="${esc(d.name)}" required></label>
      <div class="cols3">
        <label class="fld"><span>Category</span><select name="category">${catalog.categories.map(c => `<option value="${esc(c.id)}" ${d.category === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="fld"><span>Price (₦)</span><input name="price" type="number" min="0" inputmode="numeric" value="${d.price || ''}" required></label>
        <label class="fld"><span>Was price (₦) — for sales</span><input name="compareAt" type="number" min="0" inputmode="numeric" value="${d.compareAt || ''}" placeholder="leave empty if not on sale"></label>
      </div>
      <label class="fld"><span>Description</span><textarea name="description" rows="3">${esc(d.description)}</textarea></label>

      <h3>Photos <small class="muted">first photo is the main one</small></h3>
      <div class="imgs">${d.images.map((src, i) => `<div class="imgbox"><img src="${esc(src)}" alt=""><div class="img-acts">${i ? `<button type="button" data-img-first="${i}" title="Make main photo">★</button>` : '<span class="main">Main</span>'}<button type="button" data-img-del="${i}" title="Remove">✕</button></div></div>`).join('')}
        <label class="imgadd"><input type="file" accept="image/*" multiple id="imgFile" hidden><span>📷<br>Add photos</span></label></div>
      <div class="tiny" id="upMsg"></div>

      <h3>Sizes & stock</h3>
      <div class="presets">Quick fill: ${Object.keys(SIZE_PRESETS).map(k => `<button type="button" class="chip" data-preset="${esc(k)}">${esc(k)}</button>`).join('')}</div>
      <div class="vrows">${d.variants.map((v, i) => `<div class="vrow">
          <input data-v="${i}" data-k="label" value="${esc(v.label)}" placeholder="${d.variants.length > 1 ? 'Size e.g. 4-5Y' : 'Size (leave empty for one size)'}">
          <input data-v="${i}" data-k="stock" type="number" inputmode="numeric" min="0" value="${v.stock}" aria-label="Stock">
          <button type="button" data-vdel="${i}" ${d.variants.length < 2 ? 'disabled' : ''} aria-label="Remove size">✕</button></div>`).join('')}</div>
      <button type="button" class="btn sm ghost" id="vAdd">+ Add size</button>

      <div class="cols3 checks">
        <label><input type="checkbox" name="active" ${d.active !== false ? 'checked' : ''}> Visible in shop</label>
        <label><input type="checkbox" name="featured" ${d.featured ? 'checked' : ''}> Bestseller (home page)</label>
        <label class="fld"><span>Search tags (comma separated)</span><input name="tags" value="${esc((d.tags || []).join(', '))}" placeholder="school, birthday"></label>
      </div>
      <div class="modal-ft">
        ${d.id ? '<button type="button" class="btn ghost danger" id="pDel">Delete</button>' : ''}
        <span class="grow"></span>
        <button type="button" class="btn ghost" id="pCancel">Cancel</button>
        <button class="btn primary" id="pSave">Save product</button>
      </div>
    </form>`, true);

  const form = $('#pForm');
  const sync = () => {
    const f = new FormData(form);
    Object.assign(d, {
      name: f.get('name'), category: f.get('category'), price: Number(f.get('price')) || 0, compareAt: Number(f.get('compareAt')) || 0,
      description: f.get('description'), tags: String(f.get('tags') || '').split(',').map(s => s.trim()).filter(Boolean),
      active: f.get('active') === 'on', featured: f.get('featured') === 'on'
    });
    $$('[data-v]', form).forEach(inp => {
      const v = d.variants[inp.dataset.v];
      v[inp.dataset.k] = inp.dataset.k === 'stock' ? Math.max(0, Number(inp.value) || 0) : inp.value.trim();
    });
  };
  form.addEventListener('input', sync);
  form.addEventListener('change', sync);
  $('#vAdd').addEventListener('click', () => { sync(); d.variants.push({ id: '', label: '', stock: 0 }); drawProductModal(); });
  $$('[data-vdel]').forEach(b => b.addEventListener('click', () => { sync(); d.variants.splice(Number(b.dataset.vdel), 1); drawProductModal(); }));
  $$('[data-preset]').forEach(b => b.addEventListener('click', () => {
    sync();
    const labels = SIZE_PRESETS[b.dataset.preset];
    const have = new Map(d.variants.map(v => [v.label, v]));
    d.variants = labels.map(l => have.get(l) || { id: '', label: l, stock: 0 });
    drawProductModal();
  }));
  $$('[data-img-del]').forEach(b => b.addEventListener('click', () => { sync(); d.images.splice(Number(b.dataset.imgDel), 1); drawProductModal(); }));
  $$('[data-img-first]').forEach(b => b.addEventListener('click', () => { sync(); const [x] = d.images.splice(Number(b.dataset.imgFirst), 1); d.images.unshift(x); drawProductModal(); }));
  $('#imgFile').addEventListener('change', async e => {
    sync();
    const files = [...e.target.files];
    const msg = $('#upMsg');
    for (const [i, file] of files.entries()) {
      msg.textContent = `Uploading photo ${i + 1} of ${files.length}…`;
      try {
        const blob = await shrink(file);
        const r = await api('/api/upload', { method: 'POST', raw: blob, headers: { 'Content-Type': 'application/octet-stream', 'x-image-type': 'image/jpeg' } });
        d.images.push(r.url);
      } catch (ex) { alert(`Couldn’t upload ${file.name}: ${ex.message}`); }
    }
    drawProductModal();
  });
  $('#pCancel').addEventListener('click', closeModal);
  $('#pDel')?.addEventListener('click', e => {
    if (!confirm(`Delete “${d.name}”? It will disappear from the shop and from any combos.`)) return;
    busy(e.target, async () => { await op('deleteProduct', { id: d.id }); closeModal(); toast('Deleted'); render(); });
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    sync();
    if (!d.name.trim()) return alert('Please enter a name');
    if (!d.price) return alert('Please enter a price');
    if (d.variants.length > 1 && d.variants.some(v => !v.label)) return alert('Give every size a name, or remove the empty ones');
    busy($('#pSave'), async () => {
      const r = await op('saveProduct', { product: d });
      closeModal();
      toast(`Saved <b>${esc(r.saved.name)}</b>`);
      render();
    });
  });
}

/** Resize to max 1600px and re-encode as JPEG so uploads stay small. */
async function shrink(file, max = 1600) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('not an image this browser can read');
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
}

/* =========================================================
   COMBOS
   ========================================================= */
function pageCombos() {
  const list = catalog.bundles || [];
  return `<div class="a-head"><h1>Combo deals</h1><button class="btn primary" data-new-combo>+ New combo</button></div>
    <p class="muted lead">When a shopper’s bag contains every item of a combo, the discount is applied automatically. Product pages show “Buy the combo”, and the bag nudges shoppers who are one or two items short.</p>
    <div class="cards">${list.map(b => {
      const o = bundleOffer(catalog, b);
      return `<button class="ccard ${b.active === false ? 'off' : ''}" data-combo="${esc(b.id)}">
        <div class="c-imgs">${b.items.map(id => `<span class="p-img">${thumb(product(id))}</span>`).join('')}</div>
        <b>${esc(b.name)}</b>
        <small>${b.items.map(id => esc(product(id)?.name || '?')).join(' + ')}</small>
        <span>${fmt(o.price)} <s>${fmt(o.sum)}</s> · save ${fmt(o.saving)}${b.active === false ? ' · <em>Off</em>' : ''}</span>
      </button>`;
    }).join('') || '<p class="empty">No combos yet.</p>'}</div>`;
}
function comboModal(id) {
  const b = id ? structuredClone(catalog.bundles.find(x => x.id === id)) : { name: '', description: '', items: [], type: 'percent', value: 10, active: true };
  const draw = () => {
    const o = b.items.length >= 2 ? bundleOffer(catalog, b) : null;
    openModal(`<h2>${b.id ? 'Edit combo' : 'New combo'}</h2>
      <form id="cForm">
        <label class="fld"><span>Name</span><input name="name" value="${esc(b.name)}" placeholder="e.g. Back-to-School Combo" required></label>
        <label class="fld"><span>Short description</span><input name="description" value="${esc(b.description)}"></label>
        <div class="cols3">
          <label class="fld"><span>Discount type</span><select name="type"><option value="percent" ${b.type === 'percent' ? 'selected' : ''}>% off the set</option><option value="fixed" ${b.type === 'fixed' ? 'selected' : ''}>₦ off the set</option></select></label>
          <label class="fld"><span>${b.type === 'fixed' ? 'Amount (₦)' : 'Percent'}</span><input name="value" type="number" min="0" value="${b.value}"></label>
          <label class="checks"><input type="checkbox" name="active" ${b.active !== false ? 'checked' : ''}> Active</label>
        </div>
        <h3>Products in this combo <small class="muted">(pick 2 or more)</small></h3>
        <div class="pick">${catalog.products.map(p => `<label class="${b.items.includes(p.id) ? 'on' : ''}"><input type="checkbox" value="${esc(p.id)}" ${b.items.includes(p.id) ? 'checked' : ''}><span class="p-img">${thumb(p)}</span><span>${esc(p.name)}<small>${fmt(p.price)}</small></span></label>`).join('')}</div>
        <p class="preview">${o ? `Shoppers pay <b>${fmt(o.price)}</b> instead of <s>${fmt(o.sum)}</s> — they save <b>${fmt(o.saving)}</b>` : 'Pick at least two products to preview the price.'}</p>
        <div class="modal-ft">${b.id ? '<button type="button" class="btn ghost danger" id="cDel">Delete</button>' : ''}<span class="grow"></span><button class="btn primary" id="cSave">Save combo</button></div>
      </form>`, true);
    const form = $('#cForm');
    form.addEventListener('change', () => {
      const f = new FormData(form);
      Object.assign(b, { name: f.get('name'), description: f.get('description'), type: f.get('type'), value: Number(f.get('value')) || 0, active: f.get('active') === 'on', items: $$('.pick input:checked', form).map(i => i.value) });
      draw();
    });
    form.addEventListener('input', e => { if (e.target.name === 'name' || e.target.name === 'description') b[e.target.name] = e.target.value; });
    $('#cDel')?.addEventListener('click', e => { if (confirm('Delete this combo?')) busy(e.target, async () => { await op('deleteBundle', { id: b.id }); closeModal(); render(); }); });
    form.addEventListener('submit', e => { e.preventDefault(); busy($('#cSave'), async () => { await op('saveBundle', { bundle: b }); closeModal(); toast('Combo saved'); render(); }); });
  };
  draw();
}

/* =========================================================
   PROMOS & COUPON GENERATOR
   ========================================================= */
const promoLabel = p => p.type === 'percent' ? `${p.value}% off` : p.type === 'fixed' ? `${fmt(p.value)} off` : 'Free delivery';
const shopUrl = () => location.origin + '/shop.html';
function shareText(p) {
  if (p.auto) return `🛍️ FaasKids is now online! Get ${promoLabel(p).replace('Free delivery', 'free delivery')} on every order${p.minSubtotal ? ' over ' + fmt(p.minSubtotal) : ''} when you shop on our website — no code needed 💛\n${shopUrl()}`;
  return `🎁 Here’s a FaasKids treat: use code *${p.code}* for ${promoLabel(p).toLowerCase()}${p.minSubtotal ? ' on orders over ' + fmt(p.minSubtotal) : ''} when you order on our website${p.expires ? ' (valid till ' + new Date(p.expires).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ')' : ''} 💛\n${shopUrl()}`;
}
let lastBatch = null;

function pagePromos() {
  const list = [...(catalog.promos || [])].sort((a, b) => (b.auto - a.auto) || (b.createdAt || 0) - (a.createdAt || 0));
  const autos = list.filter(p => p.auto);
  const codes = list.filter(p => !p.auto);
  const usage = p => `${p.used || 0}${p.maxUses ? ' / ' + p.maxUses : ''} used`;
  return `<div class="a-head"><h1>Discounts & coupons</h1><div class="row-btns"><button class="btn ghost" data-new-promo>+ Single code</button><button class="btn primary" data-gen-promo>✨ Generate coupons</button></div></div>
    <section class="panel promo-hero">
      <div><h2>🌐 Website discount</h2><p class="muted">Applied automatically to every order on the website — the easiest way to move customers from WhatsApp to the site. Shown in the shop’s top banner.</p></div>
      ${autos.length ? autos.map(p => `<div class="auto-row ${p.active === false ? 'off' : ''}"><b>${promoLabel(p)}${p.minSubtotal ? ` over ${fmt(p.minSubtotal)}` : ''}</b><span class="muted">${p.active === false ? 'Paused' : 'Live'} · ${usage(p)}</span>
        <button class="btn sm ghost" data-share="${esc(p.code)}">📲 Share</button><button class="btn sm ghost" data-promo="${esc(p.code)}">Edit</button></div>`).join('')
        : '<button class="btn primary" data-new-auto>Turn on a website discount</button>'}
    </section>
    ${lastBatch ? batchHtml(lastBatch) : ''}
    <h2 class="sub-h">Coupon codes</h2>
    <div class="plist">${codes.map(p => `<div class="prow promo-row ${p.active === false ? 'off' : ''}">
      <button class="p-main" data-promo="${esc(p.code)}"><code>${esc(p.code)}</code><span>${promoLabel(p)}${p.minSubtotal ? ` · min ${fmt(p.minSubtotal)}` : ''}${p.expires ? ` · until ${esc(p.expires)}` : ''}${p.onePerCustomer ? ' · once per customer' : ''}${p.note ? ` · <i>${esc(p.note)}</i>` : ''}</span></button>
      <span class="muted">${usage(p)}</span>
      <span class="row-btns"><button class="btn sm ghost" data-share="${esc(p.code)}">📲 Share</button><span class="st ${p.active === false || (p.maxUses && p.used >= p.maxUses) ? 'st-cancelled' : 'st-delivered'}">${p.active === false ? 'Off' : p.maxUses && p.used >= p.maxUses ? 'Used up' : 'Active'}</span></span>
    </div>`).join('') || '<p class="empty">No coupon codes yet — generate a batch for your WhatsApp customers.</p>'}</div>`;
}
function batchHtml(b) {
  const all = b.codes.join('\n');
  return `<section class="panel batch"><div class="a-head"><h2>✨ ${b.codes.length} new coupon${b.codes.length > 1 ? 's' : ''} — ${esc(b.label)}</h2><button class="x" data-close-batch aria-label="Dismiss">✕</button></div>
    <p class="muted">Send one code to each customer. ${b.codes.length > 1 ? 'Each one works for a single customer.' : ''}</p>
    <div class="codes">${b.codes.map(c => `<span class="code-chip"><code>${c}</code><button data-copy="${c}" title="Copy">⧉</button><button data-share="${c}" title="Share on WhatsApp">📲</button></span>`).join('')}</div>
    <div class="row-btns"><button class="btn sm ghost" data-copy="${esc(all)}">Copy all codes</button><button class="btn sm ghost" data-csv>⬇️ Download list (CSV)</button></div>
  </section>`;
}
function shareModal(code) {
  const p = catalog.promos.find(x => x.code === code);
  if (!p) return;
  const text = shareText(p);
  openModal(`<h2>Share ${p.auto ? 'your website discount' : esc(p.code)}</h2>
    <label class="fld"><span>Message (edit if you like)</span><textarea id="shareTxt" rows="5">${esc(text)}</textarea></label>
    <div class="modal-ft">
      <a class="btn wa" id="shareWa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">📲 WhatsApp</a>
      <button class="btn ghost" id="shareCopy">Copy message</button>
      ${navigator.share ? '<button class="btn ghost" id="shareNative">More…</button>' : ''}
    </div>
    <p class="tiny">Tip: post it as your WhatsApp Status or Instagram story too.</p>`);
  const msg = () => $('#shareTxt').value;
  $('#shareTxt').addEventListener('input', () => { $('#shareWa').href = 'https://wa.me/?text=' + encodeURIComponent(msg()); });
  $('#shareCopy').addEventListener('click', async () => { await navigator.clipboard.writeText(msg()).catch(() => {}); toast('Copied ✓'); });
  $('#shareNative')?.addEventListener('click', () => navigator.share({ text: msg() }).catch(() => {}));
}
function promoFields(p, { code = true } = {}) {
  return `<div class="cols3">
      ${code ? `<label class="fld"><span>Code</span><input name="code" value="${esc(p.code)}" required style="text-transform:uppercase" placeholder="SCHOOL15"></label>` : ''}
      <label class="fld"><span>Discount</span><select name="type"><option value="percent" ${p.type === 'percent' ? 'selected' : ''}>% off</option><option value="fixed" ${p.type === 'fixed' ? 'selected' : ''}>₦ off</option><option value="freeship" ${p.type === 'freeship' ? 'selected' : ''}>Free delivery</option></select></label>
      <label class="fld"><span>Value (% or ₦)</span><input name="value" type="number" min="0" value="${p.value}"></label>
      <label class="fld"><span>Minimum spend (₦)</span><input name="minSubtotal" type="number" min="0" value="${p.minSubtotal || ''}" placeholder="none"></label>
      <label class="fld"><span>Expires</span><input name="expires" type="date" value="${esc(p.expires || '')}"></label>
      <label class="fld"><span>Total uses allowed</span><input name="maxUses" type="number" min="0" value="${p.maxUses || ''}" placeholder="unlimited"></label>
    </div>
    <div class="checks wrap-checks">
      <label><input type="checkbox" name="onePerCustomer" ${p.onePerCustomer ? 'checked' : ''}> Once per customer (phone number)</label>
      <label><input type="checkbox" name="active" ${p.active !== false ? 'checked' : ''}> Active</label>
    </div>`;
}
const readPromo = f => ({
  code: f.get('code') || '', type: f.get('type'), value: Number(f.get('value')) || 0, minSubtotal: Number(f.get('minSubtotal')) || 0,
  expires: f.get('expires') || '', maxUses: Number(f.get('maxUses')) || 0, onePerCustomer: f.get('onePerCustomer') === 'on',
  active: f.get('active') === 'on', note: f.get('note') || '', label: f.get('label') || ''
});
function promoModal(code, auto = false) {
  const p = code ? structuredClone(catalog.promos.find(x => x.code === code)) : { code: auto ? 'WEBSITE' : '', type: 'percent', value: auto ? 5 : 10, minSubtotal: 0, expires: '', active: true, auto };
  const isAuto = Boolean(p.auto);
  openModal(`<h2>${isAuto ? '🌐 Website discount' : code ? 'Edit code' : 'New coupon code'}</h2>
    ${isAuto ? '<p class="muted">Every website order gets this automatically. Customers can still enter a coupon — they get whichever is bigger.</p>' : ''}
    <form id="prForm">
      ${isAuto ? `<input type="hidden" name="code" value="${esc(p.code)}">` : ''}
      ${promoFields(p, { code: !isAuto })}
      ${isAuto ? `<label class="fld"><span>Label shown to shoppers</span><input name="label" value="${esc(p.label || '')}" placeholder="Website discount"></label>`
        : `<label class="fld"><span>Note for you (who it’s for)</span><input name="note" value="${esc(p.note || '')}" placeholder="e.g. Mrs Ade, Instagram giveaway"></label>`}
      ${code ? `<p class="tiny">Used ${p.used || 0} time(s).</p>` : ''}
      <div class="modal-ft">${code ? '<button type="button" class="btn ghost danger" id="prDel">Delete</button>' : ''}<span class="grow"></span><button class="btn primary" id="prSave">Save</button></div>
    </form>`, true);
  $('#prDel')?.addEventListener('click', e => { if (confirm('Delete this discount?')) busy(e.target, async () => { await op('deletePromo', { code }); closeModal(); render(); }); });
  $('#prForm').addEventListener('submit', e => {
    e.preventDefault();
    const promo = { ...readPromo(new FormData(e.target)), auto: isAuto };
    busy($('#prSave'), async () => { await op('savePromo', { promo, previousCode: code }); closeModal(); toast('Saved'); render(); });
  });
}
function generatorModal() {
  const t = { type: 'percent', value: 10, minSubtotal: 0, expires: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), maxUses: 1, onePerCustomer: true, active: true };
  openModal(`<h2>✨ Coupon generator</h2>
    <p class="muted">Make unique codes to send to customers — e.g. one each for your WhatsApp regulars to try the website.</p>
    <form id="genForm">
      <div class="cols3">
        <label class="fld"><span>How many codes</span><input name="count" type="number" min="1" max="200" value="10"></label>
        <label class="fld"><span>Code starts with</span><input name="prefix" value="FK" maxlength="12" style="text-transform:uppercase"></label>
        <label class="fld"><span>Note (who they’re for)</span><input name="note" placeholder="e.g. WhatsApp customers Nov"></label>
      </div>
      ${promoFields(t, { code: false })}
      <p class="tiny">Each code: “Total uses allowed” applies per code. Leave it at 1 for one-time codes.</p>
      <div class="modal-ft"><span class="grow"></span><button class="btn primary" id="genGo">Generate codes</button></div>
    </form>`, true);
  $('#genForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const template = readPromo(f);
    busy($('#genGo'), async () => {
      const r = await op('generatePromos', { template, count: Number(f.get('count')) || 1, prefix: f.get('prefix') });
      lastBatch = { codes: r.codes, label: `${promoLabel(template)}${template.note ? ' · ' + template.note : ''}` };
      closeModal();
      location.hash = '#/promos';
      render();
      toast(`Created ${r.codes.length} code(s)`);
    });
  });
}

/* =========================================================
   REVIEWS
   ========================================================= */
let reviews = null;
function pageReviews() {
  if (!reviews) { api('/api/reviews?all=1').then(r => { reviews = r.reviews || []; render(); }).catch(() => {}); return '<div class="loading"><div class="spinner"></div></div>'; }
  const list = [...reviews].sort((a, b) => b.ts - a.ts);
  return `<div class="a-head"><h1>Reviews</h1></div>
    <p class="muted lead">Only customers with a paid order can review what they bought (they sign in with their phone code). Hide anything you don’t want shown.</p>
    <div class="plist">${list.map(r => `<div class="prow rv-row ${r.hidden ? 'off' : ''}">
      <div><b>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</b> <span class="muted">${esc(product(r.productId)?.name || r.productId)}</span><p>${esc(r.text) || '<i class="muted">No comment</i>'}</p><small class="muted">${esc(r.name)} · ${esc(r.phone)} · ${date(r.ts)}</small></div>
      <div class="row-btns"><button class="btn sm ghost" data-rv-hide="${esc(r.id)}">${r.hidden ? 'Show' : 'Hide'}</button><button class="btn sm ghost danger" data-rv-del="${esc(r.id)}">Delete</button></div>
    </div>`).join('') || '<p class="empty">No reviews yet. Customers can leave one from “My orders” after paying.</p>'}</div>`;
}

/* =========================================================
   SETTINGS
   ========================================================= */
function pageSettings() {
  const s = catalog.settings;
  return `<div class="a-head"><h1>Settings</h1></div>
  <div class="a-grid">
    <form class="panel span2" id="sForm">
      <h2>Shop</h2>
      <label class="fld"><span>Announcement bar</span><input name="announcement" value="${esc(s.announcement)}"></label>
      <div class="cols3">
        <label class="fld"><span>Free delivery over (₦, 0 = never)</span><input name="freeDeliveryOver" type="number" min="0" value="${s.freeDeliveryOver || 0}"></label>
        <label class="fld"><span>Low-stock warning at</span><input name="lowStockAt" type="number" min="0" value="${s.lowStockAt || 3}"></label>
        <label class="fld"><span>WhatsApp number (234…)</span><input name="whatsapp" value="${esc(s.whatsapp)}"></label>
        <label class="fld"><span>Phone (display)</span><input name="phoneDisplay" value="${esc(s.phoneDisplay)}"></label>
        <label class="fld"><span>Instagram</span><input name="instagram" value="${esc(s.instagram)}"></label>
        <label class="fld"><span>Text me new orders on (phone)</span><input name="alertPhone" value="${esc(s.alertPhone || '')}" placeholder="0809… (needs SMS set up)"></label>
      </div>
      <h2>Bank transfer details</h2>
      <div class="cols3">
        <label class="fld"><span>Account name</span><input name="bank.name" value="${esc(s.bank?.name)}"></label>
        <label class="fld"><span>Bank</span><input name="bank.bank" value="${esc(s.bank?.bank)}"></label>
        <label class="fld"><span>Account number</span><input name="bank.number" value="${esc(s.bank?.number)}"></label>
      </div>
      <h2>Delivery options</h2>
      <div id="zones">${(s.zones || []).map(z => zoneRow(z)).join('')}</div>
      <button type="button" class="btn sm ghost" id="zAdd">+ Add delivery option</button>
      <p class="tiny">Tip: an option with the id <code>pickup</code> doesn’t ask for an address.</p>
      <div class="modal-ft"><span class="grow"></span><button class="btn primary" id="sSave">Save settings</button></div>
    </form>
    <form class="panel" id="catForm">
      <h2>Categories</h2>
      <div id="cats">${catalog.categories.map(catRow).join('')}</div>
      <button type="button" class="btn sm ghost" id="catAdd">+ Add category</button>
      <div class="modal-ft"><span class="grow"></span><button class="btn primary" id="catSave">Save categories</button></div>
    </form>
  </div>`;
}
const zoneRow = z => `<div class="zrow"><input data-z="name" value="${esc(z.name)}" placeholder="e.g. Lagos Island"><input data-z="fee" type="number" min="0" value="${z.fee}" aria-label="Fee"><input data-z="id" type="hidden" value="${esc(z.id || '')}"><button type="button" class="x" data-rm>✕</button></div>`;
const catRow = c => `<div class="zrow"><input data-c="emoji" value="${esc(c.emoji || '')}" class="emo" aria-label="Emoji"><input data-c="name" value="${esc(c.name)}" placeholder="Category name"><input data-c="id" type="hidden" value="${esc(c.id || '')}"><button type="button" class="x" data-rm>✕</button></div>`;
function wireSettings() {
  $('#zAdd').addEventListener('click', () => $('#zones').insertAdjacentHTML('beforeend', zoneRow({ name: '', fee: 0 })));
  $('#catAdd').addEventListener('click', () => $('#cats').insertAdjacentHTML('beforeend', catRow({ name: '', emoji: '🎈' })));
  $('#sForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const settings = {
      announcement: f.get('announcement'), freeDeliveryOver: Number(f.get('freeDeliveryOver')) || 0, lowStockAt: Number(f.get('lowStockAt')) || 0,
      whatsapp: f.get('whatsapp'), phoneDisplay: f.get('phoneDisplay'), instagram: f.get('instagram'), alertPhone: f.get('alertPhone'),
      bank: { name: f.get('bank.name'), bank: f.get('bank.bank'), number: f.get('bank.number') },
      zones: $$('#zones .zrow').map(r => ({ id: $('[data-z=id]', r).value, name: $('[data-z=name]', r).value, fee: Number($('[data-z=fee]', r).value) || 0 }))
    };
    busy($('#sSave'), async () => { await op('saveSettings', { settings }); toast('Settings saved'); render(); });
  });
  $('#catForm').addEventListener('submit', e => {
    e.preventDefault();
    const categories = $$('#cats .zrow').map(r => ({ id: $('[data-c=id]', r).value, name: $('[data-c=name]', r).value, emoji: $('[data-c=emoji]', r).value }));
    busy($('#catSave'), async () => { await op('saveCategories', { categories }); toast('Categories saved'); render(); });
  });
}

/* =========================================================
   ROUTER
   ========================================================= */
function render() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(qs || '');
  const page = path.split('/').filter(Boolean)[0] || '';
  $$('#tabs a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#/' + page));
  const pages = { '': pageDashboard, orders: pageOrders, products: pageProducts, combos: pageCombos, promos: pagePromos, reviews: pageReviews, settings: pageSettings };
  app.innerHTML = (pages[page] || pageDashboard)(params);
  if (page === '') wireChart();
  if (page === 'settings') wireSettings();
  if (page === 'products' && params.get('edit') && $('#modal').hidden) productModal(params.get('edit'));
  const search = (id, base) => $(id)?.addEventListener('change', e => {
    const p = new URLSearchParams(params); e.target.value ? p.set('q', e.target.value) : p.delete('q');
    location.hash = base + (p.toString() ? '?' + p : '');
  });
  search('#orderSearch', '#/orders');
  search('#prodSearch', '#/products');
  $('#prodCat')?.addEventListener('change', e => { const p = new URLSearchParams(params); e.target.value ? p.set('cat', e.target.value) : p.delete('cat'); location.hash = '#/products?' + p; });
}
window.addEventListener('hashchange', render);
app.addEventListener('click', e => { if (e.target.matches('[data-rm]')) e.target.parentElement.remove(); });

app.addEventListener('click', async e => {
  const t = e.target.closest('[data-period],[data-order],[data-edit],[data-new-product],[data-adj],[data-combo],[data-new-combo],[data-promo],[data-new-promo],[data-new-auto],[data-gen-promo],[data-share],[data-copy],[data-csv],[data-close-batch],[data-rv-hide],[data-rv-del],[data-reload]');
  if (!t) return;
  if (t.dataset.period !== undefined) { period = Number(t.dataset.period); render(); }
  else if (t.dataset.order) orderModal(t.dataset.order);
  else if (t.dataset.edit) productModal(t.dataset.edit);
  else if (t.hasAttribute('data-new-product')) productModal(null);
  else if (t.dataset.adj) {
    const [productId, variantId, delta] = t.dataset.adj.split('|');
    t.disabled = true;
    try { await op('adjustStock', { productId, variantId, delta: Number(delta) }); render(); }
    catch (ex) { alert(ex.message); t.disabled = false; }
  }
  else if (t.dataset.combo) comboModal(t.dataset.combo);
  else if (t.hasAttribute('data-new-combo')) comboModal(null);
  else if (t.dataset.promo) promoModal(t.dataset.promo);
  else if (t.hasAttribute('data-new-promo')) promoModal(null);
  else if (t.hasAttribute('data-new-auto')) promoModal(null, true);
  else if (t.hasAttribute('data-gen-promo')) generatorModal();
  else if (t.dataset.share) shareModal(t.dataset.share);
  else if (t.dataset.copy) { await navigator.clipboard.writeText(t.dataset.copy).catch(() => {}); toast('Copied ✓'); }
  else if (t.hasAttribute('data-close-batch')) { lastBatch = null; render(); }
  else if (t.hasAttribute('data-csv')) {
    const rows = [['code', 'discount', 'note', 'expires'], ...lastBatch.codes.map(c => { const p = catalog.promos.find(x => x.code === c) || {}; return [c, promoLabel(p), p.note || '', p.expires || '']; })];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }));
    a.download = `faaskids-coupons-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }
  else if (t.dataset.rvHide || t.dataset.rvDel) {
    const del = Boolean(t.dataset.rvDel);
    if (del && !confirm('Delete this review?')) return;
    await api('/api/reviews?id=' + encodeURIComponent(t.dataset.rvHide || t.dataset.rvDel), { method: del ? 'DELETE' : 'PATCH' });
    reviews = null; render();
  }
  else if (t.hasAttribute('data-reload')) { await loadOrders(); render(); toast('Up to date'); }
});

/* ---------- new-order alerts while the admin is open ---------- */
let knownOrders = null;
function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1320].forEach((f, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f; g.gain.setValueAtTime(.15, ctx.currentTime + i * .18); g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + i * .18 + .3); o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + i * .18); o.stop(ctx.currentTime + i * .18 + .3); });
  } catch {}
}
function updateTitle() {
  const n = (orders || []).filter(o => o.status === 'pending' || o.status === 'paid').length;
  document.title = (n ? `(${n}) ` : '') + 'FaasKids Admin';
  const tab = $('#tabs a[href="#/orders"]');
  if (tab) tab.dataset.count = n || '';
}
async function poll() {
  if (document.hidden || !pin) return;
  try {
    const before = new Set((orders || []).map(o => o.no + o.status));
    await loadOrders();
    const fresh = orders.filter(o => !knownOrders.has(o.no));
    const changed = orders.some(o => !before.has(o.no + o.status));
    fresh.forEach(o => knownOrders.add(o.no));
    if (fresh.length) {
      chime();
      toast(`🛍️ New order ${esc(fresh[0].no)} — ${fmt(fresh[0].total)} from ${esc(fresh[0].customer.name)}`);
      if (window.Notification?.permission === 'granted') new Notification('New FaasKids order', { body: `${fresh[0].no} · ${fmt(fresh[0].total)} · ${fresh[0].customer.name}`, icon: 'logo.jpg' });
    }
    updateTitle();
    if (changed && $('#modal').hidden && !document.activeElement?.matches('input,textarea,select')) render();
  } catch {}
}

async function boot() {
  app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    await Promise.all([loadCatalog(), loadOrders(), loadInvoices()]);
    knownOrders = new Set(orders.map(o => o.no));
    updateTitle();
    render();
    if (!boot.polling) { boot.polling = setInterval(poll, 45000); document.addEventListener('visibilitychange', () => !document.hidden && poll()); }
    if (window.Notification && Notification.permission === 'default') document.addEventListener('click', () => Notification.requestPermission().catch(() => {}), { once: true });
  } catch (e) {
    if (e.message !== 'wrong pin') app.innerHTML = `<div class="notice">Couldn’t load: ${esc(e.message)}</div>`;
  }
}
if (pin) boot(); else showLogin();
