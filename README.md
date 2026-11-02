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
- **Combo buy doesn't double up**: if the backpack is already in the bag, "Add combo" only adds the missing items, and nothing else in the bag changes. Clicking it again adds a genuine second set.
- **Discounts & coupons** (Admin → Coupons):
  - **Website discount**: e.g. 5% off every website order, applied automatically with no code, and shown in the shop banner. Use it to move customers from WhatsApp to the site.
  - **Coupon generator**: make 1–200 unique codes (e.g. `FK-7QX4ZP`) with % off, ₦ off or free delivery, an optional minimum spend, expiry, total uses and once-per-customer (by phone). Copy them, share each on WhatsApp, or download a CSV.
  - Coupons don't stack with the website discount: the shopper gets the bigger one. A cancelled order gives its coupon use back.
- **Card payments (Paystack)**: card, USSD or bank app at checkout once `PAYSTACK_SECRET_KEY` is set. Orders are marked paid automatically (by the webhook and on return to the shop).
- **New-order alerts**: an SMS to your phone (Settings → "Text me new orders on"). Admin also chimes, shows a notification, and shows a count on the Orders tab while it's open.
- **Reviews**: only customers with a paid order can rate what they bought, from My orders. Stars appear on products, and you can hide or delete reviews in Admin → Reviews.
- **Invoice app ↔ stock**: the item picker lists shop products with sizes and live stock. Invoice sales take stock, and re-exporting the same invoice never double-counts. Deleting an invoice puts its stock back. Invoices made from web orders don't take stock again.
- **Promotions**: free-delivery threshold with a progress bar. Delivery zones with fees.
- **Checkout**: guest checkout (no sign-up) with bank transfer. The confirmation page shows the account details and a "send payment proof on WhatsApp" button.
- **Order tracking (no accounts)**: the customer enters their phone number, gets a 6-digit code by SMS, and sees all their orders with a status timeline.
- **Sales dashboard**: combines paid web orders and invoices from the invoice tool. Shows revenue, average order, revenue by day, top sellers, channel split and stock value.
- **Order → invoice**: "Make invoice / label" on any web order opens the invoice tool already filled in.

## Configuration (Vercel → Project → Settings → Environment Variables)
| Variable | Purpose |
|---|---|
| `BLOB_STORE_ID` | Already set (Vercel Blob, private). Stores catalogue, orders, photos and invoices. |
| `APP_PIN` | Admin + invoice-app PIN, checked by the server (it's no longer written in the page). Defaults to `1995` — **change it** (6+ digits recommended). After changing it, type the new PIN and tap OK once on each phone. |
| `SESSION_SECRET` | Long random string used to sign customer tracking sessions (recommended). |
| `TERMII_API_KEY`, `TERMII_SENDER_ID` | SMS for the one-time codes ([Termii](https://termii.com)). Until these are set, tracking runs in **test mode** and shows the code on screen. |
| `TERMII_CHANNEL` | Optional: `dnd` (default, reaches DND numbers) or `generic`. |
| `PAYSTACK_SECRET_KEY` | Turns on card payments. In Paystack → Settings → API Keys & Webhooks, set the webhook URL to `https://<your-domain>/api/paystack`. |

## Running locally
```bash
npm install
npm run dev   # http://localhost:3000 — data goes to ./.localstore instead of Blob
```
No build step: static HTML/JS plus Vercel functions in `api/`. Pricing logic (`lib/pricing.js`) is shared by the browser and the server, so the bag total and the charged total always match.
