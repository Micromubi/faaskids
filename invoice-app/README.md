# Invoice App — multi-tenant toolkit for small sellers & makers

Phone-first web app: each business signs up, picks its category, and gets branded
invoices (PDF / image / WhatsApp), 8×8cm package labels, customer records
(tailor measurements included), a sales dashboard — and an admin panel for you.

## Run it (Windows / Mac / Linux)

Requires [Node.js](https://nodejs.org) 18 or newer.

```
npm install
npm start
```

Open http://localhost:3000 — that's it. The database is a single file created
automatically in `data/app.db`.

## First sign-in & admin

- Sign in with your email. **The first account ever created automatically becomes
  the admin.** (Or set the `ADMIN_EMAIL` environment variable to force one.)
- With no email service configured, the sign-in code is shown on screen —
  perfect for local use. To send real emails, set `RESEND_API_KEY`
  (and optionally `MAIL_FROM`) from a free https://resend.com account.
- Admin panel: open **Settings → Open admin panel**, or go to `/admin`.
  Same login — admins just see more.

## How it works

| Piece | What it does |
|---|---|
| `server.js` | Express API: auth, businesses, invoices, customers, records, admin |
| `lib/db.js` | SQLite schema + the category preset bundles (seller, tailor, food, services, other) |
| `lib/auth.js` | Email codes, sticky sessions (~400 days, sliding — sign out is the only way out) |
| `public/index.html` | The whole app: login → onboarding wizard → invoice editor, customers & measurements, history, sales, settings |
| `public/admin.html` | Admin panel: stats, businesses, users (grant/revoke admin), category preset editor |

## Environment variables (all optional)

| Var | Purpose |
|---|---|
| `PORT` | Port to listen on (default 3000) |
| `DATA_DIR` | Where `app.db` lives (default `./data`) |
| `RESEND_API_KEY` | Send real sign-in code emails via Resend |
| `MAIL_FROM` | From address for those emails |
| `ADMIN_EMAIL` | This email becomes admin on first sign-in |

## Notes

- Every business's data is isolated by `business_id` on every query.
- Invoice numbers (`PREFIX-YYMMDD-NNN`) are allocated server-side in a
  transaction — no duplicates even from two phones at once.
- Deploying online later: put it on any Node host (Render, Railway, a VPS).
  For serverless (Vercel), the SQLite layer should be swapped for Postgres —
  the schema is deliberately portable.
