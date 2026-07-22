const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_codes (
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  preset_json TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS businesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slogan TEXT DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  theme TEXT NOT NULL DEFAULT 'rose',
  contact_phone TEXT DEFAULT '',
  social_handle TEXT DEFAULT '',
  invoice_prefix TEXT NOT NULL DEFAULT 'INV',
  currency TEXT NOT NULL DEFAULT 'NGN',
  country_dial TEXT NOT NULL DEFAULT '234',
  payment_json TEXT NOT NULL DEFAULT '[]',
  footer_note TEXT DEFAULT '',
  doc_noun TEXT NOT NULL DEFAULT 'Invoice',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'staff',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, business_id)
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_biz ON customers(business_id);
CREATE TABLE IF NOT EXISTS catalogue_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  default_price REAL NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cat_biz ON catalogue_items(business_id);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  cust_name TEXT DEFAULT '',
  cust_phone TEXT DEFAULT '',
  cust_addr TEXT DEFAULT '',
  items_json TEXT NOT NULL DEFAULT '[]',
  delivery REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  note TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE(business_id, number)
);
CREATE INDEX IF NOT EXISTS idx_inv_biz ON invoices(business_id, created_at DESC);
CREATE TABLE IF NOT EXISTS invoice_counters (
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, day)
);
CREATE TABLE IF NOT EXISTS record_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  fields_json TEXT NOT NULL DEFAULT '[]',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES record_templates(id) ON DELETE SET NULL,
  template_name TEXT NOT NULL DEFAULT '',
  values_json TEXT NOT NULL DEFAULT '{}',
  note TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rec_cust ON records(business_id, customer_id, created_at DESC);
`);

/* ---- lightweight migrations for existing databases ---- */
try { db.exec("ALTER TABLE businesses ADD COLUMN invoice_template TEXT NOT NULL DEFAULT 'classic'"); } catch (e) { /* column exists */ }
try { db.exec("ALTER TABLE catalogue_items ADD COLUMN unit TEXT NOT NULL DEFAULT ''"); } catch (e) { /* column exists */ }

/* ---- category presets: starter catalogue, modules, record templates ---- */
const PRESETS = [
  {
    slug: 'seller', name: 'Seller / Retail', sort: 1,
    preset: {
      docNoun: 'Invoice', labels: true, measurements: false, invoiceTemplate: 'classic',
      catalogue: [
        { name: 'Dress', price: 0 }, { name: 'Shoes', price: 0 },
        { name: 'Bag', price: 0 }, { name: 'Accessories', price: 0 }
      ],
      templates: []
    }
  },
  {
    slug: 'tailor', name: 'Tailor / Fashion designer', sort: 2,
    preset: {
      docNoun: 'Invoice', labels: true, measurements: true, invoiceTemplate: 'classic',
      catalogue: [
        { name: 'Native wear (sewing)', price: 0 }, { name: 'Gown (sewing)', price: 0 },
        { name: 'Senator / Kaftan (sewing)', price: 0 }, { name: 'Alteration', price: 0 },
        { name: 'Fabric', price: 0 }
      ],
      templates: [
        { name: 'Female — Gown', fields: ['Bust', 'Waist', 'Hip', 'Shoulder', 'Sleeve length', 'Round sleeve', 'Top length', 'Gown length'] },
        { name: 'Female — Blouse & Skirt', fields: ['Bust', 'Waist', 'Hip', 'Shoulder', 'Sleeve length', 'Blouse length', 'Skirt length'] },
        { name: 'Male — Senator / Kaftan', fields: ['Neck', 'Shoulder', 'Chest', 'Tummy', 'Sleeve length', 'Wrist', 'Top length', 'Trouser waist', 'Thigh', 'Trouser length', 'Ankle'] },
        { name: 'Male — Shirt & Trouser', fields: ['Neck', 'Shoulder', 'Chest', 'Sleeve length', 'Shirt length', 'Trouser waist', 'Hip', 'Thigh', 'Trouser length', 'Ankle'] }
      ]
    }
  },
  {
    slug: 'fabric', name: 'Fabric & Textiles', sort: 3,
    preset: {
      docNoun: 'Invoice', labels: true, measurements: false, invoiceTemplate: 'modern',
      catalogue: [
        { name: 'Ankara', price: 0, unit: 'yd' }, { name: 'Lace', price: 0, unit: 'yd' },
        { name: 'Senator material', price: 0, unit: 'yd' }, { name: 'Atiku', price: 0, unit: 'yd' },
        { name: 'Headtie / Gele', price: 0, unit: 'pcs' }
      ],
      templates: []
    }
  },
  {
    slug: 'cakes', name: 'Cakes & Baking', sort: 4,
    preset: {
      docNoun: 'Invoice', labels: true, measurements: true, invoiceTemplate: 'minimal',
      catalogue: [
        { name: 'Cake — 8 inch', price: 0, unit: 'pcs' }, { name: 'Cake — 10 inch', price: 0, unit: 'pcs' },
        { name: 'Cupcakes', price: 0, unit: 'dozen' }, { name: 'Small chops', price: 0, unit: 'pack' },
        { name: 'Banana bread', price: 0, unit: 'loaf' }
      ],
      templates: [
        { name: 'Cake spec', fields: ['Occasion', 'Size (inches)', 'Tiers', 'Flavour', 'Icing type', 'Colour theme', 'Topper / Inscription', 'Delivery date'] }
      ]
    }
  },
  {
    slug: 'food', name: 'Food vendor / Caterer', sort: 5,
    preset: {
      docNoun: 'Order', labels: true, measurements: false, invoiceTemplate: 'modern',
      catalogue: [
        { name: 'Small tray', price: 0 }, { name: 'Medium tray', price: 0 },
        { name: 'Large tray', price: 0 }, { name: 'Drinks', price: 0 }
      ],
      templates: []
    }
  },
  {
    slug: 'electronics', name: 'Electronics & Gadgets', sort: 6,
    preset: {
      docNoun: 'Invoice', labels: true, measurements: false, invoiceTemplate: 'technical',
      footerNote: '7-day return policy · Warranty as stated per item',
      catalogue: [
        { name: 'Phone', price: 0, unit: 'pcs' }, { name: 'Laptop', price: 0, unit: 'pcs' },
        { name: 'Charger', price: 0, unit: 'pcs' }, { name: 'Earbuds', price: 0, unit: 'pcs' },
        { name: 'Phone case', price: 0, unit: 'pcs' }, { name: 'Screen guard', price: 0, unit: 'pcs' }
      ],
      templates: []
    }
  },
  {
    slug: 'services', name: 'Services (hair, makeup, lessons…)', sort: 7,
    preset: {
      docNoun: 'Receipt', labels: false, measurements: false, invoiceTemplate: 'minimal',
      catalogue: [{ name: 'Home service', price: 0 }],
      templates: []
    }
  },
  {
    slug: 'other', name: 'Other / General', sort: 8,
    preset: { docNoun: 'Invoice', invoiceTemplate: 'classic', labels: true, measurements: false, catalogue: [], templates: [] }
  }
];

const seedCat = db.prepare(
  'INSERT INTO categories (slug, name, preset_json, sort) VALUES (?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET sort = excluded.sort'
);
for (const c of PRESETS) seedCat.run(c.slug, c.name, JSON.stringify(c.preset), c.sort);

/* backfill default invoice design into category rows seeded before it existed,
   without overwriting any other preset customisations */
const getCat = db.prepare('SELECT preset_json FROM categories WHERE slug = ?');
const updCat = db.prepare('UPDATE categories SET preset_json = ? WHERE slug = ?');
for (const c of PRESETS) {
  const row = getCat.get(c.slug);
  if (!row || !c.preset.invoiceTemplate) continue;
  try {
    const p = JSON.parse(row.preset_json);
    if (!p.invoiceTemplate) {
      p.invoiceTemplate = c.preset.invoiceTemplate;
      updCat.run(JSON.stringify(p), c.slug);
    }
  } catch (e) { /* leave malformed rows alone */ }
}

module.exports = db;
