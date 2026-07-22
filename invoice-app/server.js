const path = require('path');
const express = require('express');
const db = require('./lib/db');
const {
  requestCode, deliverCode, verifyCode, setSessionCookie,
  sessionMiddleware, requireAuth, requireBusiness, requireAdmin, signOut, httpErr
} = require('./lib/auth');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const num = v => Math.max(0, Number(v) || 0);
const str = (v, max = 500) => String(v == null ? '' : v).trim().slice(0, max);

/* ============ AUTH ============ */
app.post('/api/auth/request', wrap(async (req, res) => {
  const { email, code } = requestCode(req.body.email);
  const { delivered } = await deliverCode(email, code);
  // Without an email provider configured (dev / first run), surface the code
  // directly so the app is usable out of the box.
  res.json(delivered ? { sent: true } : { sent: true, devCode: code });
}));

app.post('/api/auth/verify', wrap(async (req, res) => {
  const { user, token } = verifyCode(req.body.email, req.body.code);
  setSessionCookie(res, token);
  res.json({ ok: true, isAdmin: !!user.is_admin });
}));

app.post('/api/auth/signout', requireAuth, (req, res) => {
  signOut(req, res, !!req.body.everywhere);
  res.json({ ok: true });
});

/* ============ SESSION / BOOTSTRAP ============ */
const bizPublic = b => b && {
  id: b.id, name: b.name, slogan: b.slogan, category: b.category, theme: b.theme,
  contactPhone: b.contact_phone, socialHandle: b.social_handle,
  invoicePrefix: b.invoice_prefix, currency: b.currency, countryDial: b.country_dial,
  payments: JSON.parse(b.payment_json || '[]'), footerNote: b.footer_note, docNoun: b.doc_noun,
  invoiceTemplate: b.invoice_template || 'classic'
};
const INVOICE_TEMPLATES = ['classic', 'minimal', 'modern', 'technical'];

app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({
    user: { email: req.user.email, isAdmin: !!req.user.is_admin },
    business: bizPublic(req.business),
    catalogue: req.business
      ? db.prepare('SELECT id, name, default_price price, unit FROM catalogue_items WHERE business_id = ? ORDER BY sort, id').all(req.business.id)
      : []
  });
});

app.get('/api/categories', (req, res) => {
  res.json(db.prepare('SELECT slug, name, preset_json FROM categories ORDER BY sort').all()
    .map(c => ({ slug: c.slug, name: c.name, preset: JSON.parse(c.preset_json) })));
});

/* ============ ONBOARDING ============ */
app.post('/api/onboard', requireAuth, wrap(async (req, res) => {
  if (req.business) throw httpErr(409, 'Business already set up');
  const b = req.body || {};
  const name = str(b.name, 60);
  if (!name) throw httpErr(400, 'Business name is required');
  const cat = db.prepare('SELECT * FROM categories WHERE slug = ?').get(str(b.category, 30)) ||
    db.prepare("SELECT * FROM categories WHERE slug = 'other'").get();
  const preset = JSON.parse(cat.preset_json);

  const payments = [];
  if (str(b.accountNumber, 30)) {
    payments.push({
      account_name: str(b.accountName, 80), bank: str(b.bank, 60), account_number: str(b.accountNumber, 30)
    });
  }
  const prefix = (str(b.invoicePrefix, 6).toUpperCase().replace(/[^A-Z0-9]/g, '') ||
    name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'INV');
  const CATEGORY_DEFAULT_TPL = { fabric: 'modern', cakes: 'minimal', food: 'modern', electronics: 'technical', services: 'minimal' };
  const tplChoice = INVOICE_TEMPLATES.includes(b.invoiceTemplate) ? b.invoiceTemplate
    : (INVOICE_TEMPLATES.includes(preset.invoiceTemplate) ? preset.invoiceTemplate
      : (CATEGORY_DEFAULT_TPL[cat.slug] || 'classic'));

  const tx = db.transaction(() => {
    const r = db.prepare(`INSERT INTO businesses
      (owner_user_id, name, slogan, category, theme, contact_phone, social_handle,
       invoice_prefix, payment_json, footer_note, doc_noun, invoice_template, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.user.id, name, str(b.slogan, 80), cat.slug, str(b.theme, 20) || 'rose',
        str(b.contactPhone, 30), str(b.socialHandle, 40), prefix,
        JSON.stringify(payments), str(b.footerNote, 200) || str(preset.footerNote || '', 200), preset.docNoun || 'Invoice', tplChoice, Date.now());
    const bizId = r.lastInsertRowid;
    const insItem = db.prepare('INSERT INTO catalogue_items (business_id, name, default_price, unit, sort) VALUES (?, ?, ?, ?, ?)');
    (Array.isArray(b.catalogue) && b.catalogue.length ? b.catalogue : preset.catalogue)
      .slice(0, 100).forEach((it, i) => {
        const n = str(it.name, 60);
        if (n) insItem.run(bizId, n, num(it.price), str(it.unit, 10), i);
      });
    const insTpl = db.prepare('INSERT INTO record_templates (business_id, name, fields_json, sort) VALUES (?, ?, ?, ?)');
    (preset.templates || []).forEach((t, i) =>
      insTpl.run(bizId, t.name, JSON.stringify(t.fields.map(f => ({ label: f }))), i));
    return bizId;
  });
  tx();
  req.business = db.prepare('SELECT * FROM businesses WHERE owner_user_id = ?').get(req.user.id);
  res.json({ ok: true, business: bizPublic(req.business) });
}));

/* ============ SETTINGS ============ */
app.put('/api/business', requireAuth, requireBusiness, (req, res) => {
  const b = req.body || {};
  const cur = req.business;
  const payments = Array.isArray(b.payments)
    ? b.payments.filter(p => str(p.account_number, 30)).slice(0, 5).map(p => ({
        account_name: str(p.account_name, 80), bank: str(p.bank, 60), account_number: str(p.account_number, 30)
      }))
    : JSON.parse(cur.payment_json);
  const tpl = INVOICE_TEMPLATES.includes(b.invoiceTemplate) ? b.invoiceTemplate : (cur.invoice_template || 'classic');
  db.prepare(`UPDATE businesses SET name=?, slogan=?, theme=?, contact_phone=?, social_handle=?,
    invoice_prefix=?, country_dial=?, payment_json=?, footer_note=?, invoice_template=? WHERE id=?`)
    .run(str(b.name, 60) || cur.name, str(b.slogan, 80),
      str(b.theme, 20) || cur.theme, str(b.contactPhone, 30), str(b.socialHandle, 40),
      (str(b.invoicePrefix, 6).toUpperCase().replace(/[^A-Z0-9]/g, '') || cur.invoice_prefix),
      str(b.countryDial, 4).replace(/\D/g, '') || cur.country_dial,
      JSON.stringify(payments), str(b.footerNote, 200), tpl, cur.id);
  res.json({ ok: true, business: bizPublic(db.prepare('SELECT * FROM businesses WHERE id = ?').get(cur.id)) });
});

app.put('/api/catalogue', requireAuth, requireBusiness, (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 200) : [];
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM catalogue_items WHERE business_id = ?').run(req.business.id);
    const ins = db.prepare('INSERT INTO catalogue_items (business_id, name, default_price, unit, sort) VALUES (?, ?, ?, ?, ?)');
    items.forEach((it, i) => { const n = str(it.name, 60); if (n) ins.run(req.business.id, n, num(it.price), str(it.unit, 10), i); });
  });
  tx();
  res.json({ ok: true });
});

/* ============ INVOICES ============ */
function nextInvoiceNumber(bizId, prefix) {
  const d = new Date();
  const day = d.getFullYear().toString().slice(2) +
    String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO invoice_counters (business_id, day, seq) VALUES (?, ?, 1)
      ON CONFLICT(business_id, day) DO UPDATE SET seq = seq + 1`).run(bizId, day);
    return db.prepare('SELECT seq FROM invoice_counters WHERE business_id = ? AND day = ?').get(bizId, day).seq;
  });
  return `${prefix}-${day}-${String(tx()).padStart(3, '0')}`;
}

function upsertCustomer(bizId, name, phone, addr) {
  if (!name) return null;
  const existing = phone
    ? db.prepare('SELECT * FROM customers WHERE business_id = ? AND phone = ?').get(bizId, phone)
    : db.prepare('SELECT * FROM customers WHERE business_id = ? AND name = ? COLLATE NOCASE').get(bizId, name);
  if (existing) {
    db.prepare('UPDATE customers SET name = ?, phone = CASE WHEN ? != \'\' THEN ? ELSE phone END, address = CASE WHEN ? != \'\' THEN ? ELSE address END WHERE id = ?')
      .run(name, phone, phone, addr, addr, existing.id);
    return existing.id;
  }
  return db.prepare('INSERT INTO customers (business_id, name, phone, address, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(bizId, name, phone, addr, Date.now()).lastInsertRowid;
}

const invPublic = r => ({
  number: r.number, ts: r.created_at, name: r.cust_name, phone: r.cust_phone, addr: r.cust_addr,
  items: JSON.parse(r.items_json), delivery: r.delivery, discount: r.discount,
  subtotal: r.subtotal, total: r.total, notes: r.note
});

app.get('/api/invoices', requireAuth, requireBusiness, (req, res) => {
  res.json(db.prepare('SELECT * FROM invoices WHERE business_id = ? ORDER BY created_at DESC LIMIT 500')
    .all(req.business.id).map(invPublic));
});

app.post('/api/invoices', requireAuth, requireBusiness, (req, res) => {
  const b = req.body || {};
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 100).map(i => ({
    name: str(i.name, 80) || 'Item', unit: str(i.unit, 10), detail: str(i.detail, 120),
    qty: Math.max(0.01, Math.round((num(i.qty) || 1) * 100) / 100), price: num(i.price)
  })).map(i => ({ ...i, amount: Math.round(i.qty * i.price * 100) / 100 }));
  if (!items.length) throw httpErr(400, 'Add at least one item');
  const delivery = num(b.delivery), discount = num(b.discount);
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const total = Math.max(0, subtotal + delivery - discount);
  const name = str(b.name, 80), phone = str(b.phone, 30), addr = str(b.addr, 200);

  const existing = b.number
    ? db.prepare('SELECT * FROM invoices WHERE business_id = ? AND number = ?').get(req.business.id, str(b.number, 30))
    : null;
  const number = existing ? existing.number : nextInvoiceNumber(req.business.id, req.business.invoice_prefix);
  const custId = upsertCustomer(req.business.id, name, phone, addr);

  if (existing) {
    db.prepare(`UPDATE invoices SET customer_id=?, cust_name=?, cust_phone=?, cust_addr=?, items_json=?,
      delivery=?, discount=?, subtotal=?, total=?, note=? WHERE id=?`)
      .run(custId, name, phone, addr, JSON.stringify(items), delivery, discount, subtotal, total, str(b.notes, 500), existing.id);
  } else {
    db.prepare(`INSERT INTO invoices (business_id, number, customer_id, cust_name, cust_phone, cust_addr,
      items_json, delivery, discount, subtotal, total, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(req.business.id, number, custId, name, phone, addr, JSON.stringify(items),
        delivery, discount, subtotal, total, str(b.notes, 500), Date.now());
  }
  res.json({ ok: true, number, subtotal, total });
});

app.delete('/api/invoices/:number', requireAuth, requireBusiness, (req, res) => {
  db.prepare('DELETE FROM invoices WHERE business_id = ? AND number = ?').run(req.business.id, req.params.number);
  res.json({ ok: true });
});

app.get('/api/sales', requireAuth, requireBusiness, (req, res) => {
  const rows = db.prepare('SELECT * FROM invoices WHERE business_id = ?').all(req.business.id);
  let totalSales = 0, unitsSold = 0;
  const itemMap = new Map();
  for (const r of rows) {
    totalSales += r.total;
    for (const i of JSON.parse(r.items_json)) {
      unitsSold += i.qty;
      const cur = itemMap.get(i.name) || { name: i.name, qty: 0, revenue: 0 };
      cur.qty += i.qty; cur.revenue += i.amount;
      itemMap.set(i.name, cur);
    }
  }
  res.json({
    totalSales, orders: rows.length, unitsSold,
    avgOrder: rows.length ? totalSales / rows.length : 0,
    items: [...itemMap.values()].sort((a, b) => b.revenue - a.revenue)
  });
});

/* ============ CUSTOMERS & RECORDS ============ */
app.get('/api/customers', requireAuth, requireBusiness, (req, res) => {
  const q = '%' + str(req.query.q, 60) + '%';
  res.json(db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM records r WHERE r.customer_id = c.id) records,
      (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id) invoices
    FROM customers c WHERE c.business_id = ? AND (c.name LIKE ? OR c.phone LIKE ?)
    ORDER BY c.name COLLATE NOCASE LIMIT 300`).all(req.business.id, q, q));
});

app.post('/api/customers', requireAuth, requireBusiness, (req, res) => {
  const name = str(req.body.name, 80);
  if (!name) throw httpErr(400, 'Name is required');
  const id = upsertCustomer(req.business.id, name, str(req.body.phone, 30), str(req.body.address, 200));
  if (req.body.note != null) db.prepare('UPDATE customers SET note = ? WHERE id = ?').run(str(req.body.note, 300), id);
  res.json({ ok: true, id });
});

app.delete('/api/customers/:id', requireAuth, requireBusiness, (req, res) => {
  db.prepare('DELETE FROM customers WHERE business_id = ? AND id = ?').run(req.business.id, req.params.id);
  res.json({ ok: true });
});

app.get('/api/customers/:id/records', requireAuth, requireBusiness, (req, res) => {
  res.json(db.prepare('SELECT * FROM records WHERE business_id = ? AND customer_id = ? ORDER BY created_at DESC')
    .all(req.business.id, req.params.id)
    .map(r => ({ id: r.id, templateId: r.template_id, templateName: r.template_name,
      values: JSON.parse(r.values_json), note: r.note, ts: r.created_at })));
});

app.post('/api/customers/:id/records', requireAuth, requireBusiness, (req, res) => {
  const cust = db.prepare('SELECT id FROM customers WHERE business_id = ? AND id = ?').get(req.business.id, req.params.id);
  if (!cust) throw httpErr(404, 'Customer not found');
  const tpl = req.body.templateId
    ? db.prepare('SELECT * FROM record_templates WHERE business_id = ? AND id = ?').get(req.business.id, req.body.templateId)
    : null;
  const values = {};
  const src = req.body.values || {};
  for (const k of Object.keys(src).slice(0, 40)) values[str(k, 40)] = str(src[k], 40);
  db.prepare(`INSERT INTO records (business_id, customer_id, template_id, template_name, values_json, note, created_at)
    VALUES (?,?,?,?,?,?,?)`)
    .run(req.business.id, cust.id, tpl ? tpl.id : null,
      tpl ? tpl.name : str(req.body.templateName, 60) || 'Measurements',
      JSON.stringify(values), str(req.body.note, 300), Date.now());
  res.json({ ok: true });
});

app.delete('/api/records/:id', requireAuth, requireBusiness, (req, res) => {
  db.prepare('DELETE FROM records WHERE business_id = ? AND id = ?').run(req.business.id, req.params.id);
  res.json({ ok: true });
});

/* ============ RECORD TEMPLATES ============ */
app.get('/api/templates', requireAuth, requireBusiness, (req, res) => {
  res.json(db.prepare('SELECT * FROM record_templates WHERE business_id = ? ORDER BY sort, id').all(req.business.id)
    .map(t => ({ id: t.id, name: t.name, fields: JSON.parse(t.fields_json) })));
});

app.post('/api/templates', requireAuth, requireBusiness, (req, res) => {
  const name = str(req.body.name, 60);
  if (!name) throw httpErr(400, 'Template name is required');
  const fields = (Array.isArray(req.body.fields) ? req.body.fields : []).slice(0, 40)
    .map(f => ({ label: str(f.label || f, 40) })).filter(f => f.label);
  if (req.body.id) {
    db.prepare('UPDATE record_templates SET name = ?, fields_json = ? WHERE business_id = ? AND id = ?')
      .run(name, JSON.stringify(fields), req.business.id, req.body.id);
  } else {
    db.prepare('INSERT INTO record_templates (business_id, name, fields_json, sort) VALUES (?, ?, ?, 99)')
      .run(req.business.id, name, JSON.stringify(fields));
  }
  res.json({ ok: true });
});

app.delete('/api/templates/:id', requireAuth, requireBusiness, (req, res) => {
  db.prepare('DELETE FROM record_templates WHERE business_id = ? AND id = ?').run(req.business.id, req.params.id);
  res.json({ ok: true });
});

/* ============ ADMIN ============ */
app.get('/api/admin/overview', requireAuth, requireAdmin, (req, res) => {
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  res.json({
    users: db.prepare('SELECT COUNT(*) n FROM users').get().n,
    businesses: db.prepare('SELECT COUNT(*) n FROM businesses').get().n,
    invoices: db.prepare('SELECT COUNT(*) n FROM invoices').get().n,
    invoicesThisWeek: db.prepare('SELECT COUNT(*) n FROM invoices WHERE created_at > ?').get(weekAgo).n,
    revenueTracked: db.prepare('SELECT COALESCE(SUM(total),0) t FROM invoices').get().t
  });
});

app.get('/api/admin/businesses', requireAuth, requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT b.id, b.name, b.category, b.created_at, u.email owner,
      (SELECT COUNT(*) FROM invoices i WHERE i.business_id = b.id) invoices,
      (SELECT COALESCE(SUM(total),0) FROM invoices i WHERE i.business_id = b.id) revenue,
      (SELECT MAX(created_at) FROM invoices i WHERE i.business_id = b.id) last_invoice_at
    FROM businesses b JOIN users u ON u.id = b.owner_user_id ORDER BY b.created_at DESC`).all());
});

app.delete('/api/admin/businesses/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM businesses WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT u.id, u.email, u.is_admin, u.created_at,
      (SELECT name FROM businesses b WHERE b.owner_user_id = u.id) business,
      (SELECT MAX(last_seen_at) FROM sessions s WHERE s.user_id = u.id) last_seen_at
    FROM users u ORDER BY u.created_at DESC`).all());
});

app.put('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) throw httpErr(404, 'User not found');
  if (target.id === req.user.id && !req.body.isAdmin) throw httpErr(400, 'You cannot remove your own admin access');
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(req.body.isAdmin ? 1 : 0, target.id);
  res.json({ ok: true });
});

app.put('/api/admin/categories/:slug', requireAuth, requireAdmin, (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE slug = ?').get(req.params.slug);
  if (!cat) throw httpErr(404, 'Category not found');
  let preset;
  try { preset = JSON.parse(req.body.preset); } catch { throw httpErr(400, 'Preset must be valid JSON'); }
  db.prepare('UPDATE categories SET name = ?, preset_json = ? WHERE slug = ?')
    .run(str(req.body.name, 60) || cat.name, JSON.stringify(preset), cat.slug);
  res.json({ ok: true });
});

/* ============ pages & errors ============ */
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong — try again' : err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Invoice app running → http://localhost:${PORT}`));
