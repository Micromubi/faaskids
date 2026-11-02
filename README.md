# FaasKids 🛍️

*Grow with Style.* The invoice tool, plus a new online shop and the back office that runs it.

| Page | What it is |
|---|---|
| `index.html` | **Invoice tool** (main page): invoices, PDF/image, package labels, WhatsApp, sales history. **🛍️ New site** button opens the shop. |
| `shop.html` | **Storefront**: home, categories, search, filters, product pages with photo gallery and sizes, wishlist, bag, combo deals, promo codes, checkout, and order tracking. |
| `admin.html` | **Back office** (PIN): dashboard, orders, products & stock, combos, promo codes, settings. There's a "Staff" link at the bottom of the shop. |

## Shop features
- **Catalogue**: categories, product photos (resized in the browser, stored in Vercel Blob), sizes with stock for each size, "was" prices for sales, bestsellers, hidden products.
- **Inventory**: stock is reserved the moment an order is placed. Cancelling an order puts the stock back. You get low-stock warnings and can do quick ± adjustments. Two people buying the last item at the same moment can't oversell, because updates use Blob ETag compare-and-swap.
- **Smart combos**:
  - Admin-defined bundles (% or ₦ off the set) apply automatically in the bag.
  - Product pages offer "Buy the combo".
  - The bag nudges shoppers who are 1–2 items short ("Add X to save ₦Y").
  - "Frequently bought together" learns from real orders.
- **Promotions**: promo codes (% off, ₦ off, or free delivery; optional minimum spend and expiry). Free-delivery threshold with a progress bar. Delivery zones with fees.
- **Checkout**: guest checkout (no sign-up) with bank transfer. The confirmation page shows the account details and a "send payment proof on WhatsApp" button.
- **Order tracking (no accounts)**: the customer enters their phone number, gets a 6-digit code by SMS, and sees all their orders with a status timeline.
- **Sales dashboard**: combines paid web orders and invoices from the invoice tool. Shows revenue, average order, revenue by day, top sellers, channel split and stock value.
- **Order → invoice**: "Make invoice / label" on any web order opens the invoice tool already filled in.

## Configuration (Vercel → Project → Settings → Environment Variables)
| Variable | Purpose |
|---|---|
| `BLOB_STORE_ID` | Already set (Vercel Blob, private). Stores catalogue, orders, photos and invoices. |
| `APP_PIN` | Admin PIN. Defaults to `1995` — **change it** before the shop goes public. |
| `SESSION_SECRET` | Long random string used to sign customer tracking sessions (recommended). |
| `TERMII_API_KEY`, `TERMII_SENDER_ID` | SMS for the one-time codes ([Termii](https://termii.com)). Until these are set, tracking runs in **test mode** and shows the code on screen. |
| `TERMII_CHANNEL` | Optional: `dnd` (default, reaches DND numbers) or `generic`. |

## Running locally
```bash
npm install
npm run dev   # http://localhost:3000 — data goes to ./.localstore instead of Blob
```
No build step: static HTML/JS plus Vercel functions in `api/`. Pricing logic (`lib/pricing.js`) is shared by the browser and the server, so the bag total and the charged total always match.
