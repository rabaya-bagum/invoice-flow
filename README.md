# InvoiceFlow

Mobile invoicing for freelancers and small businesses. React Native (Expo) app, Node/Express API,
Supabase (Postgres + Auth), Stripe payments.

| Path              | What                                                                  |
| ----------------- | --------------------------------------------------------------------- |
| `mobile/`         | Expo + React Native app (TypeScript)                                  |
| `api/`            | Express REST API                                                      |
| `packages/shared` | Float-free money/invoice calculation, shared by API and app           |
| `supabase/`       | SQL migrations, local Postgres shims, RLS tests                       |
| `docs/`           | Decisions and assumptions ([ASSUMPTIONS.md](docs/ASSUMPTIONS.md))     |

## Quick start

Requires Node 22 and pnpm 10 (`corepack enable`).

```bash
pnpm install
cp api/.env.example api/.env       # fill in Supabase values when you have a project
cp mobile/.env.example mobile/.env

pnpm --filter @invoiceflow/shared build
pnpm --filter @invoiceflow/api dev          # http://localhost:4000/health
pnpm --filter @invoiceflow/mobile start     # Expo dev server
```

### Database

- **Full Supabase stack:** `supabase start` applies `supabase/migrations` automatically.
- **Plain Postgres in Docker:** `docker compose up db` (port 54322) applies shims + migrations.
- **Verify migrations + RLS without Docker:** `pnpm db:check` (needs local PostgreSQL binaries,
  or set `DATABASE_URL` to an empty database).

### Everything

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm db:check
```

## API tests

`pnpm --filter @invoiceflow/api test` needs PostgreSQL. It starts a throwaway cluster from the local
PostgreSQL binaries, or uses `TEST_DATABASE_URL` (localhost only; **its `public` and `auth` schemas are
wiped**). `SKIP_DB_TESTS=1` skips setup for quick runs of the non-DB suites.

## Authentication setup

1. Create a Supabase project and run the migrations (`supabase db push`, or paste `supabase/migrations`
   into the SQL editor).
2. Authentication -> URL Configuration: add `invoiceflow://auth/callback` and `invoiceflow://auth/reset`
   to the redirect allow-list (for Expo Go during development also add the `exp://...` URL it prints).
3. Authentication -> Providers -> Email: keep **Confirm email** on; set minimum password length 10 and
   enable leaked-password protection (Pro plan) and CAPTCHA/rate limits as appropriate.
4. Fill `api/.env` (service-role key) and `mobile/.env` (URL + anon key).

Biometric unlock, SecureStore persistence and deep links need a real device or simulator build:
use a development build (`npx expo run:ios` / `run:android`) rather than relying on Expo Go.

## Email, PDFs and customer links

- **Email:** create a [Resend](https://resend.com) account, verify your sending domain, then set
  `RESEND_API_KEY` and `EMAIL_FROM` in `api/.env`. Without a key the API only logs "would send ..."
  (never the contents).
- **Customer links:** `PUBLIC_APP_URL` must be the URL customers can reach (HTTPS in production).
  `PUBLIC_LINK_SECRET` signs the links; keep it secret and stable.
- **Logo and signature storage:** the API creates a private Supabase Storage bucket named
  `business-assets` on boot (needs the service-role key). Uploads are PNG/JPEG up to 1 MB.
- **PDF fonts:** invoices use the bundled DejaVu Sans (Latin, Greek, Cyrillic and most currency
  symbols). Chinese, Japanese, Korean, Thai and Devanagari text are not supported in PDFs yet.

## Environment variables

See `api/.env.example` and `mobile/.env.example`. The Supabase **service-role key** and Stripe **secret
key** are server-only. Only `EXPO_PUBLIC_*` values reach the app bundle, and anyone can read them.

## Status

Phases 1 (architecture, schema, money library, CI), 2 (authentication), 3 (business profile,
customers, products, tab navigation), 4 (invoices) and 5 (preview, PDF, email/share, public invoice
page) are complete. Next: Phase 6, Stripe payments. The dashboard shows placeholder numbers until Phase 8.
