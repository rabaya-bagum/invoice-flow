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

## Invoices (Phase 4)
- **Server is the only calculator of record.** `POST/PUT /v1/invoices` accept line content only
  (quantity in thousandths, unit price in minor units, taxes as name + basis points). Totals, per-line
  tax and discount allocation are computed by `calculateInvoice` and stored; any totals/status/amount
  paid sent by a client are ignored (tested). The app shows a live preview with the same shared function.
- **Statuses:** the full transition table lives in `packages/shared/src/invoice-status.ts`. Users can
  trigger only `draft -> sent` ("mark as sent") and `draft|sent|viewed -> cancelled` (no payments).
  Viewed / partially paid / paid / refunded are driven by tracking and payments in later phases.
  `partially_paid -> cancelled` is not allowed. Partial refunds (`paid -> partially_paid`) are not modelled.
- **Overdue** is derived in one SQL expression (due date before "today" in the business timezone, balance
  > 0, status sent/viewed/partially_paid). It drives both the list filter and `displayStatus`; a test checks
  it agrees with the shared TypeScript rule for every status. A due date equal to today is not overdue.
  The one-time "overdue" notification job is Phase 7.
- **Editing:** allowed while draft/sent/viewed and nothing has been paid. Deleting: drafts only (others are
  cancelled). Updates lock the row (`FOR UPDATE`) and bump `version`; if the client sends a stale `version`
  the API answers 409 `VERSION_CONFLICT`. This is the foundation for offline sync conflict handling.
- **Numbering:** blank number = auto (`next_document_number`, per business prefix/padding) inside the create
  transaction, so a failed create burns no number. If an auto number collides with a manually typed one, the
  next is taken (savepoint + retry). A manual number that already exists is a 409 `NUMBER_EXISTS`.
- **References:** customer must be the caller's and not deleted (else 422 `INVALID_CUSTOMER`); products must
  be the caller's. Items copy description/price/taxes, so later product or tax-rate edits/deletes never change
  an invoice.
- **Due date before issue date** is allowed and returned as a `warnings` entry (`DUE_DATE_BEFORE_ISSUE_DATE`).
- **Search** matches invoice number, customer name/email, and (for numeric input) the exact total in the
  invoice's own currency (`currency_exponent()` in SQL, verified against the shared table). Date filters apply
  to the issue date; the app computes Today/This week/This month in the business timezone (weeks start Monday).
- **Audit and activity:** create/update/delete/transition write `audit_logs` and `invoice_activity` rows in the
  same transaction. `GET /v1/invoices/:id/activity` backs the History tab.
- Tax rates are named reusable rates (`/v1/tax-rates`, one default per business). Multiple taxes per line add
  (no compounding).
- **Preview is basic:** the Preview tab shows saved server totals; the designed preview and PDF are Phase 5.

## Preview, PDF, sending, public page (Phase 5)
- **Pay page is served by the API** (`GET /pay/:token`, server-rendered HTML) instead of a separate `web-pay`
  app: one deploy, no extra toolchain, and Phase 6 adds Stripe.js to the same page. It uses a per-response
  CSP nonce (`default-src 'none'`, one nonce'd script, no inline handlers) and escapes every dynamic value.
- **Share links** are `<invoiceId>.<HMAC-SHA256(PUBLIC_LINK_SECRET, invoiceId:salt)>`. `invoices.public_token`
  holds only a random per-invoice salt, so a database leak alone yields no working links. Revoking clears the
  salt (old link dies, a new one differs). Wrong/forged/revoked/draft links all return the same 404, and the
  view call returns 204 either way, so tokens cannot be probed.
- **View tracking** happens only when the page's script POSTs `/view`, not on GET, so link-preview crawlers and
  email scanners do not mark invoices "viewed". Only `sent -> viewed`, once.
- **Sending** renders the PDF, sends via Resend, and only then marks a draft as sent (a provider failure
  leaves the invoice untouched and returns 502 `EMAIL_FAILED`). Re-sending a sent/viewed/partially paid
  invoice is allowed; cancelled/paid/refunded are not. Sends are rate-limited per user (20 per 10 min).
- **Email content:** the editable default matches the required wording; the HTML copy escapes the message and
  adds a "View invoice" button. Reply-To is the business email.
- **PDF:** server-side with pdfkit, A4 (Letter for US/Canada), classic/modern/minimal templates driven by the
  business template + accent colour, multi-page with repeated table header and "Page X of Y", automatic
  wrapping of long descriptions, tax breakdown, payment instructions, pay link while a balance is due, notes,
  terms, logo and signature. Totals rows come from the same shared function as the app and the web page.
- **Logo/signature** are uploaded as raw PNG/JPEG (`PUT /v1/business/:kind`), type-checked by magic bytes
  (SVG is refused), stored privately in Supabase Storage under `<businessId>/<kind>`. The signature is an
  uploaded image of a signature; there is no draw-your-signature pad yet. The app resizes and re-encodes
  picked images (converting HEIC) before upload.
- **Mobile:** Preview tab = on-screen invoice document + actions. "Preview PDF" uses the native print preview;
  "Share PDF" opens the native share sheet (Save to Files, Messages, Mail...); "Share link" shares the pay-page
  URL via any messaging app; "Pay invoice" opens the pay page. There is no embedded PDF viewer.
- **Not verified end to end:** real Resend delivery, Supabase Storage (tests use an in-memory store), the
  native share sheet / print preview / image picker on a device.
- The pay page shows a disabled "Online payment is not available yet" button until Phase 6.

## Online payments (Phase 6)
- **Model:** Stripe Connect **Express** accounts + **destination charges** with `on_behalf_of`: the PaymentIntent
  lives on the platform account and transfers to the freelancer's account; `application_fee_amount` is the
  platform fee (`PLATFORM_FEE_BPS`, default 0). Refunds use `reverse_transfer` + `refund_application_fee`.
  Stripe's processing fees are borne by the platform. (Direct charges would make the freelancer the merchant
  of record; that is a business decision to revisit before launch.)
- **The webhook is the only source of truth.** Nothing marks an invoice paid except a signature-verified
  `payment_intent.succeeded`. The browser's "payment succeeded" screen only polls our server. Events are
  deduplicated by id in `webhook_events`; the dedupe row commits in the same transaction as its effects, so a
  failure rolls both back and Stripe's retry reprocesses it. Payment rows are locked (`FOR UPDATE`), so two
  different events for one payment apply once, and a late `payment_failed` can never undo a success.
- **Duplicate/over-payment protection:** a partial unique index allows only **one pending payment per invoice**;
  creating a payment locks the invoice row, reuses the open PaymentIntent for the same amount, cancels and
  replaces it when the amount changes, and refuses (409) while one is `processing`/`succeeded`. Amounts above the
  balance are refused. Stripe idempotency keys include a per-invoice attempt counter. While a payment is
  pending the invoice cannot be edited or cancelled.
- **Amounts:** the amount Stripe actually collected (`amount_received`) is what is recorded; a difference from
  what we asked for is audited (`payment.amount_mismatch`). Special currencies: ISK/UGX are sent x100,
  three-decimal currencies (KWD, BHD, JOD, OMR, TND) must be multiples of 0.01 (`toStripeAmount`).
- **Invoice status** after payments is recomputed from the payments table (idempotent): `paid` when net received
  >= total, `partially_paid` when some is received, `refunded` when everything received was refunded. A partial
  refund of a paid invoice moves it back to `partially_paid` (the status table now allows `paid -> partially_paid`).
- **Receipts:** the customer's receipt comes from Stripe (`receipt_email` is set from the customer's email; Stripe
  sends receipts in live mode, not test mode). The owner gets a `notifications` row per event (push delivery is
  Phase 10) and invoice activity entries.
- **Refunds** are requested from the app (`POST /v1/payments/:id/refund`, full or partial, idempotent key) and
  applied when Stripe's `charge.refunded` arrives, never optimistically.
- **Wallets:** Apple Pay and Google Pay come from the Payment Element on the web page (the app does not embed
  Stripe's native SDK, so in-app card entry is not offered). Apple Pay needs the domain verification file.
- **Not built:** manual "record a cash/cheque payment", disputes/chargebacks handling, `account.updated` Connect
  webhook (status is fetched on demand), payouts reporting, and per-business fee overrides.
- **Not verified against real Stripe:** all Stripe calls are exercised through a fake gateway; webhook signature
  verification uses the real SDK. Run an end-to-end test in Stripe test mode (including Apple Pay on a real device
  and domain) before launch.

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
