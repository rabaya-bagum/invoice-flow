# Decisions and assumptions

## Architecture
- **Monorepo (pnpm):** `mobile` (Expo), `api` (Express), `packages/shared` (money maths, types).
  `web-pay` (public pay page) arrives in Phase 5.
- **Supabase** provides Postgres, Auth and Storage. Express verifies Supabase access tokens (Phase 2).
- **Write path:** all writes go through Express using the service role, with `business_id`
  scoping enforced in repositories. Signed-in clients only get `SELECT` on their own rows via RLS
  (defence in depth against IDOR). Clients are deliberately *not* granted writes on invoices,
  payments etc., because direct PostgREST writes would bypass server-side total calculation.
- `audit_logs`, `webhook_events`, `document_sequences` have RLS on and no policies: service role only.

## Authentication (Phase 2)
- Supabase Auth owns sign-up, login, email verification, password reset and refresh-token rotation.
  The mobile app uses `supabase-js` with the **PKCE** flow, so email links carry `?code=` and the app
  exchanges it for a session. Opening a link on a different device than the one that started the flow
  will fail the exchange; the user sees "link invalid or expired" and can sign in normally.
- Session storage: chunked `expo-secure-store` entries (Keychain / Keystore-backed,
  `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`) since a session exceeds SecureStore's ~2KB value limit.
- Biometric unlock is a **local gate** over the stored session, not a login method: the lock flag lives
  in SecureStore, applies at cold start and after 30s in the background, and is cleared on sign-out.
  Enabling it requires a successful scan. Failure/cancel leaves the user on the lock screen with a
  "Sign out" escape.
- API verifies access tokens with `jose`: signature (JWKS for asymmetric keys, or HS256 secret for legacy
  projects), `exp`, issuer `<SUPABASE_URL>/auth/v1`, audience `authenticated`, UUID `sub`. All failures
  return one identical 401 body. `jose` is pinned to v5 because v6 is ESM-only and the API is CommonJS.
- Sign-up and password-reset screens give the same message whether or not an account exists.
- Account deletion: `DELETE /v1/me {confirm:"DELETE"}` writes an audit row, then deletes the auth user;
  foreign-key cascades remove business data. Stripe Connect cleanup is added in Phase 6.
- The API's `/v1/me` uses the supabase-js service client. Invoice writes (Phase 4) will use a direct
  Postgres connection for transactions.
- Not verified on a device: Face ID / fingerprint prompts, SecureStore behaviour, deep-link handling,
  and real Supabase email delivery. Unit tests cover the logic around them with mocks.

## Business profile, customers, products (Phase 3)
- API uses a direct Postgres connection (`pg`) for these tables; every query takes `business_id`, which
  comes from the verified user (`requireBusiness`), never from the request. Updates use column
  whitelists, so bodies cannot set `business_id`, totals or Stripe fields. Unknown keys are rejected on
  `PUT /v1/business` and stripped elsewhere.
- Integration tests run against real Postgres with two accounts (IDOR, search injection, SKU scope,
  cascade delete). Validation schemas live in `packages/shared` and are used by both API and app.
- Customers: soft delete (`deleted_at`), because invoices reference them. `PUT` replaces the record
  (omitted fields become null). Search is a case-insensitive substring over name, company, email and
  phone, with LIKE wildcards escaped. Lists use limit/offset (max 100) and return `{items, total}`.
- Products: hard delete (invoice items copy name and price). SKU is unique per business.
  Price is entered in the business's default currency; there is no per-product currency.
- Percent inputs are parsed to basis points with two decimals max (`parsePercent`).
- Customer "history" is a placeholder until invoices exist (Phase 4); `GET /v1/customers/:id/invoices`
  is added then.
- Logo and signature upload are deferred to Phase 8 (they are only needed for preview/PDF); the columns
  exist. Tax-rate management (`tax_rates`) arrives with invoices in Phase 4.
- The dashboard and the "+" quick-create button are deferred: both need invoice data. The tab shell
  (Home, Invoices, Customers, Payments, More) is in place; Invoices and Payments are placeholders.

## Money
- Integer minor units everywhere (`bigint` in Postgres, safe integers in JS). Intermediate maths is `bigint`.
- Rounding: half-up. Quantities are stored with 3 decimals (`numeric(12,3)`, `quantityMilli` in code).
- Rates (tax, percent discount) are basis points: 5% = 500.
- Order of operations: line total -> invoice discount allocated pro rata (largest remainder) ->
  tax per line on the discounted amount, rounded per line and per tax -> fees (untaxed) -> total.
- Tax-inclusive: tax is extracted from the discounted gross, `gross * rate / (1 + rate)`, split across
  taxes by largest remainder so parts sum exactly.
- Multiple taxes on a line are additive (not compounded).
- `balance_due_minor` is a generated column (`total - amount_paid`).

## Statuses
- `overdue` is **derived** (`due_date` passed, balance > 0, status not draft/cancelled/paid/refunded),
  not stored. A daily job (Phase 7) fires the one-time notification.
- Due date earlier than issue date is a validation *warning* in the API, not a DB constraint.

## Numbering
- `next_document_number(business_id, kind)` allocates `PREFIX + zero-padded counter` atomically inside
  the caller's transaction. Unique `(business_id, number)` backs it up.

## Not verified yet
- `docker-compose.yml` and `api/Dockerfile`: no Docker daemon in the build sandbox. CI builds the image.
- `supabase/config.toml` has not been run with the Supabase CLI.
- `expo install` was blocked by the sandbox network policy; Expo-compatible versions were taken from
  `node_modules/expo/bundledNativeModules.json`. Run `npx expo-doctor` on a normal machine.
- `package.json` pins `baseline-browser-mapping@2.11.26` via a pnpm override because the registry
  listed 2.11.27 but served 404 for its tarball. Remove the override once that is fixed.
