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

## Online payments (Stripe)

Customers pay on the invoice page (`/pay/<token>`) with the Stripe Payment Element: card, Apple Pay and
Google Pay. The freelancer is paid through **Stripe Connect Express**; the money flow is a *destination
charge* (the platform account creates the PaymentIntent and transfers to the freelancer, minus the optional
`PLATFORM_FEE_BPS`).

1. Create a Stripe account, enable **Connect** and finish the platform profile.
2. Set `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` (use `sk_test_` / `pk_test_` while developing).
3. Dashboard -> Developers -> Webhooks: add `https://<your API>/v1/payments/webhook` with the events
   `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`;
   copy the signing secret into `STRIPE_WEBHOOK_SECRET`. Locally:
   `stripe listen --forward-to localhost:4000/v1/payments/webhook`.
4. In the app: More -> Online payments -> set up (Stripe's hosted onboarding). A business can take payments
   once Stripe reports `charges_enabled`.
5. **Apple Pay:** Dashboard -> Settings -> Payment method domains: add your API's domain, download the
   association file, and put its contents in `APPLE_PAY_DOMAIN_ASSOCIATION` (served at
   `/.well-known/apple-developer-merchantid-domain-association`). **Google Pay** needs no extra setup.
6. Test with card `4242 4242 4242 4242` (any future date / CVC); `4000 0000 0000 0002` is declined.

Stripe's fees on destination charges are paid by the platform account, so set `PLATFORM_FEE_BPS` high enough
to cover them if you want to break even.

## Push notifications

The app registers its Expo push token after sign-in; the API queues a notification for each event (invoice
sent, viewed, paid, partial payment, payment failed, overdue) and delivers it through Expo's push service.

1. Run `eas init` (creates the EAS project) and set `EXPO_PUBLIC_EAS_PROJECT_ID` in `mobile/.env`.
2. Push needs a **physical device and a development/production build** (not Expo Go, not a simulator).
   Configure credentials with EAS: an APNs key for iOS and FCM v1 credentials for Android
   (`eas credentials`).
3. On the API set `PUSH_ENABLED=true` (default in production). Without it pushes are only logged.
4. The API runs two background jobs on its own: an hourly **overdue sweep** and a 30-second **push
   retry loop**. Both are safe to run in several instances at once.
5. Test a token by sending to it from <https://expo.dev/notifications>.

## End-to-end flows (Maestro)

`mobile/.maestro/` holds three device flows: sign in, dashboard cards and quick-create menu, and
creating a customer then an invoice. They need a development build on a simulator/emulator and a
verified test account (seed it first; see below):

```bash
curl -Ls https://get.maestro.mobile.dev | bash        # install Maestro once
cd mobile && maestro test -e E2E_EMAIL=qa@example.com -e E2E_PASSWORD=... .maestro
```

They have **not been run** in this build environment (no device). A Jest test
(`api/test/maestro-flows.test.ts`) fails if a flow references a label that no longer exists in the app.

## Demo data

Sign up in the app first, then fill that account with 5 customers, 10 products/services and 20
invoices (draft, sent, viewed, paid, partially paid, overdue; one in EUR):

```bash
export DATABASE_URL=postgresql://...        # the same connection string the API uses
pnpm --filter @invoiceflow/api seed -- --email you@example.com
# start over (deletes ALL of that business's customers, products, invoices, payments):
pnpm --filter @invoiceflow/api seed -- --email you@example.com --reset --yes
```

It refuses to run on a business that already has data. Dates are relative to today, so the overdue
and due-soon invoices stay that way whenever you seed.

## Environment variables

See `api/.env.example` and `mobile/.env.example`. The Supabase **service-role key** and Stripe **secret
key** are server-only. Only `EXPO_PUBLIC_*` values reach the app bundle, and anyone can read them.

## Status

Phases 1 (architecture, schema, money library, CI), 2 (authentication), 3 (business profile,
customers, products, tab navigation), 4 (invoices), 5 (preview, PDF, email/share, public invoice
page), 6 (Stripe payments), 7 (push notifications, overdue job, activity timeline) and 8 (dashboard,
quick-create menu, demo seed data) and 9 (security review, isolation/abuse tests, Maestro flows) are
complete. See `docs/SECURITY.md` for the review and what it does not cover.
Next: remaining roadmap (estimates, offline drafts + sync, template customization), API docs, and
store-readiness (EAS build profiles, icons, privacy policy).
