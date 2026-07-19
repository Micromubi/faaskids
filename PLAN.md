# Multi-Tenant Plan: Turning FaasKids Invoice into a Product

FaasKids Invoice is a mobile-first, WhatsApp-native invoice + package-label tool for a
small social seller. Real users beyond the original one (a tailor, other sellers) are
already asking for it — that's product-market signal. This plan describes how to turn
the single-tenant app into a commercial multi-tenant product **without losing the thing
people love: open phone → invoice sent on WhatsApp in under a minute.**

---

## 1. What people are actually buying

Not "invoicing software." They're buying:

1. **A professional, branded look** for a one-person business (the invoice, the PDF, the
   WhatsApp message, the printed package label all carry their brand).
2. **Speed on a phone** — no login friction, big buttons, quick-price chips, share sheet.
3. **A memory** — invoice history, customer names, and the sales dashboard.

The package-label export (8×8cm thermal PNG for the Xprinter app) is a genuine
differentiator — competitors (Bumpa, Vencru, Zoho Invoice) don't make a printable
delivery label from the same data entry.

**Target customer:** WhatsApp/Instagram sellers in Nigeria (and similar markets):
kids' clothing, tailors, thrift, food vendors, skincare. They price in ₦, get paid by
bank transfer, and close sales in WhatsApp DMs.

---

## 2. Everything that is currently hardcoded (= the tenant config surface)

From reading the code, one "tenant" is exactly this set of values:

| Config | Where it's hardcoded today |
|---|---|
| Brand name, slogan, logo | `index.html` topbar, invoice header, label, lockscreen, `logo.jpg` |
| Brand colors | CSS `:root` variables (`--pink`, `--teal`, `--yellow`, `--cream`) |
| Contact line / social handle | invoice header, label footer, WhatsApp message footer |
| Payment details (account name, bank, number) | `PAY` constant + invoice HTML |
| Item catalogue | `ITEM_TYPES` array |
| Quick-price chips | `QUICK_PRICES` array |
| Invoice number prefix | `FK-` in `makeInvoiceNo()` |
| Currency + locale | `fmt()` (`₦`, `en-NG`), date locales |
| WhatsApp country code | `'234' + phone.slice(1)` in the WhatsApp handler |
| PIN | `const PIN = '1995'` client-side, `APP_PIN` server-side |
| Storage namespace | `faaskids-*` localStorage keys, `faaskids-history` blob prefix |
| Footer / thank-you text | invoice footer, label, WhatsApp message |

The multi-tenant product = this table as a **business profile row in a database**, plus
auth, plus per-tenant invoice storage, plus billing.

---

## 3. Security issues to fix regardless of commercialization

- **The PIN is in the client source.** Anyone can View Source and read `PIN = '1995'`,
  and the API trusts the same value via the `x-pin` header. Server default is also
  `'1995'`. For a paid product, auth must be a real server-side session; the 4-digit
  PIN can survive as an optional *device lock* only (hashed, per-user).
- **One shared blob = one shared dataset.** Anyone who passes the PIN sees *all*
  invoices. There is no user separation at all today.
- **Read-modify-write race.** Every save lists blobs, fetches the newest JSON, rewrites
  the whole 500-entry array, deletes old blobs. Two devices saving at once lose data.
  A real database row per invoice fixes this for free.

---

## 4. Target architecture

Keep the deployment model that already works (Vercel, mobile-first PWA). Change as
little UX as possible.

- **App:** Next.js on Vercel. The existing invoice editor UI is good — port it nearly
  as-is into one page; the surrounding pages (signup, onboarding, settings, billing)
  are what Next.js buys us. The invoice/label templates become components rendered
  from the tenant's profile instead of hardcoded markup.
- **Database:** Postgres (Neon via Vercel). Tables:
  - `users` (phone/email, auth)
  - `businesses` (the tenant: all config from §2, `currency`, `country_code`, `plan`)
  - `memberships` (user ↔ business, role) — day-1 it's 1:1, but this table makes
    "add my sister as staff" a feature, not a migration
  - `invoices` (one row per invoice, JSON `items` column, `business_id` FK — every
    query filters by `business_id`)
  - `catalogue_items` (name, default price, per business)
  - `subscriptions` (Paystack refs, plan, status, period end)
- **Blob storage:** logos only (per-tenant upload replaces `logo.jpg`).
- **Auth:** phone-number OTP delivered over WhatsApp or SMS (Termii/Twilio) — these
  users live on WhatsApp and many don't use email. Email magic link as fallback.
- **Offline:** keep the current localStorage-first pattern with background sync to the
  API — the app already works this way (`cloudPush` is fire-and-forget); formalize it
  and namespace keys per business.
- **Tenancy model:** login-scoped, not subdomain-scoped. This is an internal tool for
  the seller, not a storefront; nobody needs `tailor.app.com`. One app URL, the
  session decides whose brand loads. (Subdomains can come later if a public
  "pay this invoice" page ships.)

---

## 5. Phased roadmap

### Phase 0 — Extract & harden (≈1 week, still single-tenant)
- Pull every §2 value into one `config` object / JSON — the app becomes a template.
- Fix the PIN issue and the blob race (move history to Postgres even for one tenant).
- Result: wife's app unchanged in behavior; codebase ready to fork per tenant.
- *Cheap validation shortcut:* before building real multi-tenancy, hand-deploy 2–3
  configured copies (tailor, the other seller) as separate Vercel projects. A week of
  their real usage tells us more than any spec.

### Phase 1 — Real multi-tenancy (2–3 weeks)
- Signup (WhatsApp OTP) → **onboarding wizard**: business name, logo upload, slogan,
  colors (pick from presets), bank details, starter catalogue, invoice prefix. Target:
  **under 5 minutes from signup to first sent invoice.** This wizard *is* the product
  demo.
- Migrate FaasKids as tenant #1 (import the existing blob history).
- Onboard the tailor + other known sellers free as design partners. A tailor will
  immediately expose the need for **custom fields** (measurements on the label) —
  note it, don't build it yet.

### Phase 2 — Money (≈2 weeks)
- **Paystack subscriptions** (cards, bank transfer, USSD — Stripe doesn't collect
  well in Nigeria).
- **Free plan:** 10 invoices/month, one payment account, "Made with ___" line in the
  invoice footer and WhatsApp message with a signup link.
- **Pro plan (suggest ₦2,500/mo or ₦25,000/yr — validate with the beta users):**
  unlimited invoices, no badge, full branding (colors/slogan/footer), package labels,
  sales dashboard, multi-device sync, backup export.
- Enforce limits server-side; degrade gracefully (never block viewing history).

### Phase 3 — Grow with the sellers
In rough priority order, each driven by beta-user demand:
1. **Receipts / paid status** — mark invoice paid, send a receipt (same template,
   "RECEIPT · PAID" stamp). Sellers ask for this fast.
2. **Customer book** — auto-built from invoice history; tap a customer to prefill.
3. **Custom fields per niche** — the tailor's measurements; makes niche templates
   ("Tailor mode") a marketing angle.
4. **Payment links** — Paystack payment link embedded in the invoice/WhatsApp message
   so the customer pays directly; later this enables transaction-fee revenue instead
   of (or under) subscription.
5. **Team seats** (Business plan) and simple stock counts.

---

## 6. Go-to-market

- **The invoice is the ad.** Every PDF, image, and WhatsApp message a free-tier user
  sends carries the "Made with ___" badge in front of exactly the right audience
  (other sellers). This is the primary growth loop; optimize the badge to be tasteful
  enough that free users keep it.
- **Seed manually.** The wife + tailor + known sellers are the first case studies.
  Each niche (kids' wear, tailoring, thrift) gets a preset template and a 60-second
  demo video shot on a phone.
- **Positioning vs. Bumpa/Vencru:** they're "manage your whole business" apps; this is
  "send a beautiful branded invoice and print the delivery label in 60 seconds." Less
  is the pitch.
- **Naming:** "FaasKids" stays as tenant #1's brand; the product needs a neutral name
  (short, works in a WhatsApp footer). Decide before Phase 1 since it goes into the
  domain, badge, and OTP sender ID.

## 7. What to measure

- Activation: % of signups that send an invoice within 24h (the wizard's job).
- Engagement: invoices/week per business (a seller doing 5+/week will pay).
- Retention: week-4 retention of activated businesses.
- Conversion: free → Pro after hitting the 10-invoice cap.

## 8. Explicitly out of scope (for now)

- Public storefronts / product pages — different product.
- Multi-currency at launch — ship ₦ config-ready (`currency` is already a column),
  expand when a real user outside Nigeria shows up.
- Accounting/tax reports, inventory management — Bumpa's territory; stay fast.
