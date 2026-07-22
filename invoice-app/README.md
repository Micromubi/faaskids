# Invoice App — multi-tenant toolkit for small sellers & makers

Phone-first web app: each business signs up, picks its category, and gets branded
invoices (PDF / image / WhatsApp), 8×8cm package labels, customer records
(tailor measurements, cake specs, and more), a sales dashboard, staff accounts,
and four selectable invoice designs — plus an admin panel for you, the operator.

## Run it (Windows / Mac / Linux)

Requires [Node.js](https://nodejs.org) 18 or newer.

```
npm install
npm start
```

Open http://localhost:3000 — that's it. The database is a single file created
automatically in `data/app.db`. No accounts to configure, no email service, no keys.

## Signing in — business name + code

There are no emails and no passwords to remember beyond a short code.

- **New business:** on the sign-in screen tap **Create a new business**, run the
  short wizard (business type → brand → payment & catalogue), and **choose your
  own sign-in code** at the end. That code makes you the *owner*.
- **Coming back:** enter your **business name** and **your code**. That's the
  whole login. You stay signed in on that device (~400 days, renewed on every
  visit) until you tap Sign out.
- **The first business created on a fresh install becomes the app admin.**

The code *is* the identity: whichever code you type decides whether you sign in
as the owner or as one of the workers, and what you're allowed to do.

## Staff — one workspace, personal codes

A shop with workers (e.g. a tailor with 5 machinists) shares one workspace:

- Owner → **Settings → Team → Add worker** (just their name). The app shows a
  **6-digit temporary code** to hand to that worker.
- The worker signs in with the **business name + temporary code**, and is
  immediately asked to **choose their own personal code** (the temporary one
  then stops working).
- Workers can use **customers, measurements/records, and invoicing**. They
  **cannot** see Sales, change settings/brand/payment/catalogue/templates,
  manage the team, or delete anything — enforced on the server, not just hidden.
- Owner can **Reset code** (issues a fresh temporary code) or **Remove** a
  worker at any time; either instantly invalidates their old code and sessions.

Everyone (owner and staff) can change their own code under **Settings → Account →
Change my sign-in code**.

## Business types (category presets)

Chosen at signup; each pre-fills a starter catalogue, tools, and a fitting
default invoice design. All editable afterwards, and new categories can be added
from the admin panel without code.

| Category | Highlights |
|---|---|
| Seller / Retail | general products |
| Tailor / Fashion designer | garment **measurement templates** per client |
| Fabric & Textiles | priced per **yard** (units + decimal quantities) |
| Cakes & Baking | **Cake spec** record template per customer |
| Food vendor / Caterer | trays, "Order" wording |
| Electronics & Gadgets | per-item **serial/IMEI detail line**, warranty footer |
| Services | receipt-style |
| Other / General | blank slate |

## Invoice designs

Four layouts — **Classic**, **Minimal**, **Modern** (amount-due card),
**Technical** (bold industrial). Chosen during signup (with a smart per-category
default) and changeable anytime in **Settings → Invoice design**. Each business's
choice applies to its live preview and every export.

## How it works

| Piece | What it does |
|---|---|
| `server.js` | Express API: auth, businesses, invoices, customers, records, team, admin |
| `lib/db.js` | SQLite schema, category preset bundles, and one-time data migrations |
| `lib/auth.js` | Business-name + code sign-in, salted code hashing, sticky sessions (~400 days, sliding), rate limiting |
| `public/index.html` | The whole app: login → onboarding → invoice editor, customers & measurements, history, sales, settings, team |
| `public/admin.html` | Admin panel: stats, businesses, members (grant/revoke admin), category preset editor |

### Data model (SQLite)

- `businesses` — one row per tenant (brand, category, theme, invoice design, payment, footer).
- `members` — people who can sign in to a business: `label`, salted `code_hash`,
  `role` (`owner`/`staff`), `is_admin`, `must_change`. The code is unique within a business.
- `sessions` — hashed session tokens tied to a member (sliding ~400-day cookie).
- `customers`, `invoices`, `catalogue_items`, `record_templates`, `records`,
  `invoice_counters` — all scoped by `business_id`.

## Environment variables (all optional)

| Var | Purpose |
|---|---|
| `PORT` | Port to listen on (default 3000) |
| `DATA_DIR` | Where `app.db` lives (default `./data`) |
| `NODE_ENV=production` | Marks the session cookie `Secure` (use behind HTTPS) |

## Upgrading from the old email-login version

Just replace the files and restart — **keep your `data/` folder**. On first
start the database migrates itself:

- Every existing business gets an **owner** member; each old staff member becomes
  a **staff** member. Their old email is kept as the on-screen label so you know who's who.
- Everyone is given the temporary code **`0000`** and is asked to choose a real
  code the first time they sign in (owners included).
- So after upgrading: sign in with your **business name** + code **`0000`**, then
  set your own code.

## Notes

- Every business's data is isolated by `business_id` on every query.
- Codes are never stored in plain text (salted SHA-256); sign-in is rate-limited
  (10 tries per business name per 15 minutes).
- Invoice numbers (`PREFIX-YYMMDD-NNN`) are allocated server-side in a
  transaction — no duplicates even from two phones at once.
- Deploying online later: put it on any Node host (Render, Railway, a VPS).
  For serverless (Vercel), swap the SQLite layer for Postgres — the schema is
  deliberately portable.
