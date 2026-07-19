# Product Plan — Multi-Tenant Business Toolkit for Small Sellers & Makers

A standalone product, built fresh in its own repository. (An earlier single-tenant
invoice app is referenced only as proof of demand and UX patterns that work; no code
or branding from it is carried over.)

**One line:** a phone-first app where a small business picks its category at signup and
gets a ready-made toolkit — branded invoices sent over WhatsApp, package labels,
customer records (including tailor measurements), and a sales dashboard.

**Decisions already made:**
- Preset business categories at signup drive what the app looks like per tenant.
- Login = email + one-time code. Session never expires on the same device until the
  user explicitly signs out.
- WhatsApp OTP login → future phase. Payments/billing → future phase. Everything is
  free while we learn.

---

## 1. Core concept: category presets

At signup the user answers one question — *"What kind of business do you run?"* — and
the answer configures the workspace. A preset bundle = starter catalogue, quick-price
chips, which modules are on, which record templates exist, and wording.

| Category | Catalogue starter | Labels | Records module | Notes |
|---|---|---|---|---|
| **Seller / Retail** (clothes, thrift, skincare…) | generic product slots | ✅ | — | closest to the proven original flow |
| **Tailor / Fashion designer** | sewing services (native wear, gown, senator…) | ✅ | ✅ **Measurements** | measurement templates pre-created |
| **Food vendor / Caterer** | menu items, tray sizes | ✅ | — | invoice noun can read "Order" |
| **Services** (hair, makeup, lessons…) | service list | ❌ | — | receipts more than invoices |
| **Other / General** | empty | ✅ | — | everything manual |

Presets only pre-fill; nothing is locked. A tailor can delete a template, a seller can
later enable records. Categories are rows in a table + a JSON bundle, so adding a new
category is content work, not code work.

### The Measurements module (what makes Tailor distinct)
- **Record templates**: named field lists, e.g. *"Female — Gown"* (bust, waist, hip,
  shoulder, sleeve, top length, gown length…), *"Male — Senator/Kaftan"* (neck,
  shoulder, chest, tummy, sleeve, wrist, top length, trouser waist, thigh, trouser
  length, ankle…). Tailor can rename/add/remove fields and create new templates.
- **Records**: a filled template attached to a **customer**, with date and note.
  Multiple records per customer over time (sizes change) — history is kept, latest
  shown first.
- **Use**: open customer → see measurements instantly; share a measurement card as
  image/WhatsApp (send to the sewing assistant); optionally link a record to an
  invoice ("Agbada for Chief — measurements attached").

This generalizes later: the same template/record machinery gives food vendors
"standing order" records, service providers "client preference" records, etc.

---

## 2. Architecture & stack

- **App:** Next.js (App Router) on Vercel. One deployment, tenancy scoped by login —
  no subdomains. The session decides whose brand, catalogue, and data load.
- **Database:** Postgres (Neon) + Drizzle ORM. Every business-owned table carries
  `business_id`; every query filters on it (enforced in one data-access layer, not
  ad hoc).
- **Email:** Resend (or similar) for login codes. Free tier is plenty at this stage.
- **File storage:** Vercel Blob for tenant logos only. All records/invoices live in
  Postgres.
- **Exports:** keep the proven client-side approach — html2canvas + jsPDF for PDF,
  PNG image, and the 8×8cm thermal label; Web Share API with download fallback.
- **Offline:** PWA (manifest + service worker). Drafts and recent history cached in
  localStorage **namespaced per business id**, background-synced to the API.

### Auth model (email, sticky session)
1. Enter email → 6-digit code sent (codes hashed in DB, 10-min expiry, rate-limited).
2. Verify → create session: random token, hash stored in `sessions`, delivered as an
   httpOnly cookie with ~400-day expiry, **sliding** (every visit re-extends). Result:
   same device stays signed in effectively forever.
3. **Sign out** deletes the session row — the only way a device logs out (plus a
   "sign out other devices" button in settings).
4. Optional 4-digit **device PIN lock** as a privacy screen (kids grabbing the phone),
   purely client-side, separate from auth.

### Schema (first migration set)
```
users          id, email (unique, citext), created_at
login_codes    email, code_hash, expires_at, attempts
sessions       id, user_id, token_hash, created_at, last_seen_at
businesses     id, owner_user_id, name, slogan, category,
               logo_url, theme jsonb (colors), contact_phone, social_handle,
               invoice_prefix, currency (default NGN), country_dial (default 234),
               payment_details jsonb [{account_name, bank, account_number}],
               footer_note, created_at
memberships    user_id, business_id, role     -- 1:1 today; teams later without migration
customers      id, business_id, name, phone, address, note, created_at
catalogue_items id, business_id, name, default_price, sort
invoices       id, business_id, number, customer_id?, customer_snapshot jsonb,
               items jsonb, delivery, discount, subtotal, total, created_at
invoice_counters business_id, day, seq        -- transactional PREFIX-YYMMDD-NNN
record_templates id, business_id, name, fields jsonb [{key,label,unit?}], sort
records        id, business_id, customer_id, template_id, values jsonb, note, created_at
categories     slug, name, preset jsonb       -- the bundles from §1
```

---

## 3. Phase-by-phase, step-by-step

### Phase 0 — Setup (2–3 days)
1. Pick the product name (short; it will sit in a WhatsApp footer and a domain) and
   register the domain.
2. New GitHub repo; scaffold Next.js + TypeScript + Drizzle; connect Vercel project,
   Neon database, Resend account; env wiring for preview vs production.
3. Commit the category preset bundles (§1) as seed data.

✅ *Done when:* an empty branded shell deploys to the production domain.

### Phase 1 — Auth + tenancy + onboarding (~1 week)
1. Migrations for `users`, `login_codes`, `sessions`, `businesses`, `memberships`,
   `categories`.
2. Login screen: email → code → in. Middleware resolves session → user → business on
   every request; sliding cookie renewal; sign-out (this device / all devices).
3. **Onboarding wizard** (the product demo, target < 5 minutes):
   ① pick category → ② business name + logo upload + color preset → ③ contact phone
   + social handle → ④ bank account details → ⑤ starter catalogue prefilled from the
   preset, editable inline → land on the invoice screen ready to sell.
4. Settings page to edit everything later (brand, colors, payment accounts, prefix,
   catalogue).

✅ *Done when:* sign up on a phone, close the browser, come back days later — still
signed in; sign out actually revokes; two test businesses can never see each other's
rows (write the test).

### Phase 2 — Invoicing core (~2 weeks)
1. Port the proven editor UX as tenant-themed components: customer fields, item cards
   (qty stepper, price, quick-price chips from the business's own list), delivery fee,
   discount, note, live invoice preview, sticky total dock.
2. Server-side invoice numbering via `invoice_counters` (transactional — no duplicate
   numbers across devices).
3. Exports: PDF, PNG image, 8×8cm label (grayscale logo pipeline), WhatsApp message
   built from tenant branding + `country_dial`.
4. History: list, reopen, delete; auto-save on every export/send; sales dashboard
   (total revenue, orders, units, average order, items ranked by revenue).
5. Offline-first: draft + history cache per business in localStorage, fire-and-forget
   sync, visible synced/offline indicator.
6. Backup: export/import history as JSON. (Importer accepts the old single-tenant
   backup format too — one-off convenience.)

✅ *Done when:* a seller can do the entire original workflow — build invoice → PDF /
image / label / WhatsApp → see it in history and the dashboard — with *their* brand,
on *their* phone, offline-tolerant.

### Phase 3 — Customers + Measurements (~1 week)
1. **Customer book**: auto-created/updated from invoices, plus manual add; search;
   tapping a customer prefills the invoice form.
2. `record_templates` + `records` CRUD; Tailor preset seeds the default male/female
   garment templates; template editor (add/remove/reorder fields).
3. Customer page shows measurement history; new record defaults to the latest values
   (edit what changed).
4. Share a measurement card as PNG/WhatsApp; optional link from invoice to a record.

✅ *Done when:* the tailor persona works end-to-end — add client, record measurements,
retrieve them a month later, update two fields, send the card to an assistant, invoice
the job.

### Phase 4 — Polish + private beta (~1 week, overlaps 3)
1. PWA install prompt + icons; empty states, error toasts, loading states; basic
   analytics (signups, invoices/week per business).
2. Hand-onboard the known first users — the tailor and the other sellers — each on
   their real phone, watching them use it. Weekly check-in; feature requests become
   the Phase 5+ backlog ordering.
3. Landing page: one screen, category chips, "start free" — enough for word-of-mouth
   signups.

✅ *Done when:* ≥3 real businesses have each sent ≥5 real invoices without help.

### Phase 5+ — Future backlog (explicitly deferred)
In the order they'll likely earn their place:
1. **Paid/receipt status** — mark paid, resend as RECEIPT.
2. **WhatsApp OTP login** (deferred by decision) — added as an *alternative* login,
   email remains.
3. **Billing** (deferred by decision) — Paystack subscriptions; free tier keeps a
   "Made with ___" footer badge, paid removes it. The badge ships **from Phase 2**
   even while everything is free — it's the growth loop and later the upsell.
4. **Order status for tailors** — measured → cutting → sewing → ready → delivered.
5. **Team seats** (`memberships` is already there), payment links inside invoices,
   simple stock counts, new categories as demand shows up.

---

## 4. What to measure from day one
- Activation: % of signups sending an invoice within 24h (the wizard's report card).
- Engagement: invoices/week per business; for tailors, records created/week.
- Retention: week-4 active businesses.
- Manual for now: a weekly note from each beta user — what annoyed them this week.

## 5. Out of scope (so it stays fast)
Public storefronts, accounting/tax, inventory management, multi-currency at launch
(currency is a column, ₦ is the default; expand when a non-Nigerian user actually
appears), native app stores (PWA first).
