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

## Notifications, overdue job, timeline (Phase 7)
- **Outbox:** every event writes a `notifications` row in the same transaction as the event itself; delivery is a
  separate step (`push_sent_at` is null until delivered or deliberately skipped). A push outage therefore can
  never roll back a payment or a send. Rows are claimed with `FOR UPDATE SKIP LOCKED`, so parallel dispatchers
  never send twice. After a commit the API "kicks" a dispatch for promptness; a 30 s loop retries failures.
- **Retries:** a provider outage leaves rows queued (attempts counted); after 5 attempts a row is marked as given
  up. Expo's `DeviceNotRegistered` deletes that device token. No registered device is not an error (row is marked
  `no_devices`).
- **Who gets pushed:** the business owner's devices only (`push_tokens` -> `business_profiles.owner_id`). A device
  token belongs to whoever registered it last, and the app unregisters it on sign-out (before the session ends).
  There are no per-event preference toggles yet, only one on/off switch per device.
- **Content:** exactly the required wording where specified ("Invoice INV-0034 has been viewed by John Smith.",
  "Payment of $1,250.00 received for INV-0034."). Messages carry only the invoice id and notification id as data;
  tapping opens the invoice (also on cold start).
- **Overdue job:** hourly, per business timezone, using the same overdue rule as the list filter. It claims and
  flags invoices in one statement and notifies **once per due date** (`overdue_notified_due_date`); changing the
  due date to another past date notifies again. It also writes an `overdue` activity entry. Idempotent across
  instances and restarts. It does not email customers (no reminder emails yet).
- **Timeline:** the History tab groups activity by day with local time, an icon per event type, and readable
  fallbacks for unknown types. Activity rows use `clock_timestamp()` so events in one transaction keep their order.
- **Not built:** notification preferences per event type, badge counts, silent/background updates, and checking
  Expo push receipts (only the immediate ticket result is used).
- **Not verified on a device:** permission prompts, token registration, delivery and tap-to-open need a physical
  device with an EAS build; tests mock the native modules and the Expo service.

## Dashboard, quick create, seed data (Phase 8)
- `GET /v1/dashboard?period=all|this_month|this_year` returns everything the home screen needs in one
  call. Totals are **per currency** and never summed across currencies; the business's default currency
  is always the first row (zero-filled when empty).
- *Outstanding* = balance on sent/viewed/partially-paid invoices (overdue included). *Overdue* is the
  subset past due in the business timezone, using the same rule as the list's `overdue` filter (a test
  keeps them equal). *Draft* sums draft totals.
- *Paid* is money actually received: successful payments minus refunds, taken from the `payments`
  table (not invoice totals), so partial payments count and refunds reduce it. The period filters on
  `paid_at` in the business timezone and applies to Paid only; the other cards are always current.
  Payments marked paid by hand (no payment row) are not counted yet, since the app has no manual
  payment recording until later.
- The invoice list gained an `outstanding` status filter so the Outstanding card opens a list that
  adds up to the card. Tapping a card opens Invoices pre-filtered.
- The "+" menu offers New invoice and New customer. Estimate arrives with estimates (Phase 11);
  expenses are not in v1.
- Seed (`pnpm --filter @invoiceflow/api seed`) goes through the real invoice service, so totals are the
  server's own calculation, then back-dates status timestamps and inserts matching payment rows
  directly. It refuses non-empty businesses; `--reset --yes` wipes customers, products, tax rates,
  invoices, payments, notifications and numbering for that one business.
- The dashboard is invalidated by any invoice/payment mutation in the app (its query key is nested
  under `invoices`). A payment arriving through Stripe while the app is open shows after pull-to-refresh
  or the next push-notification refresh.

## Hardening (Phase 9)
- See `docs/SECURITY.md` for the review, the fixes and the gaps. Isolation is tested by sweeping every
  route declared in `src/routes/*.ts` (the test reads the route files, so a new route is covered the
  moment it is added) and by id-probing 29 actions as a second tenant.
- Cross-tenant ids answer 404 everywhere, including `GET /customers/:id/invoices` (previously an empty
  200). Soft-deleted customers still resolve so their invoice history stays reachable.
- Maestro flows are written but unrun; the Jest drift guard only checks labels, not behaviour.
- Tests that insert notification rows directly must set `push_sent_at`, otherwise another test file's
  push dispatch can claim them (the outbox claims across all businesses).

## Launch readiness (Phase 10)
- Phase 10 was scoped as launch readiness (build config, API docs, store paperwork), not new product
  features. Estimates, offline drafts with sync and template-customization UI remain unbuilt.
- `eas.json` takes `EXPO_PUBLIC_*` values from EAS environments rather than hard-coding URLs, so no
  placeholder hostnames ship by accident. Over-the-air updates (`expo-updates`) are not installed.
- Bundle id `com.invoiceflow.app`, the icons and the app name are placeholders. A test checks the
  iOS and Android ids match and that the Maestro flows use the same id.
- The OpenAPI file is generated from a hand-kept operation table; request bodies for the main resources
  are described, many response bodies are intentionally loose. A drift test covers routes, not fields.
- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` was documented in `mobile/.env.example` but never read (the web pay
  page gets its key from the API). It was removed; a test now keeps the file in step with the code.
- The privacy policy and store answers are drafts from what the code does, not legal advice.

## Estimates (Phase 11)
- An estimate prices exactly like an invoice (same shared calculator, same line/discount/tax rules);
  `dueDate` becomes `expiryDate`. Numbering is a separate `EST-0001` sequence (the schema already had
  one per business and kind).
- Statuses: draft -> sent -> viewed -> accepted | declined (`rejected` in the API). The customer can answer
  on the public page (Phase 12), or the owner records the answer by hand ("Mark accepted / declined").
- "Expired" is derived (sent/viewed with an expiry date before today in the business timezone), like
  "overdue"; it is filterable but never stored. An expired estimate can still be accepted or converted,
  because a customer may say yes late and the owner decides.
- Editable until accepted, declined or converted. Only drafts can be deleted.
- **Convert** creates a DRAFT invoice (issue date today, due date = today + the business's default
  payment terms) in the same transaction that locks the estimate row and stamps `converted_invoice_id`,
  so concurrent taps create exactly one invoice and a failure rolls both back. A declined estimate cannot
  be converted. The estimate stays as a record and is read-only afterwards. The accepted estimate is not
  automatically converted; that is a deliberate owner action.
- The estimate PDF reuses the invoice renderer (`kind: 'estimate'`: "ESTIMATE", "Valid until", no
  paid/balance rows, no payment information or pay link). The email attaches the PDF and, since Phase 12,
  links to the customer page.
- No activity timeline or push notifications for estimates yet (those tables are invoice-specific);
  changes are written to the audit log.
- Mobile: estimates live in the Invoices stack (More > Estimates, the "+" menu, and the Convert flow
  jumps to the new invoice). The invoice form and document components are reused through a `kind` prop.

## Customer-facing estimates (Phase 12)
- Links work like invoice links: `<estimateId>.<HMAC(secret, "estimate:" id:salt)>`, salt in
  `estimates.public_token`, revocable (clear the salt). The `estimate:` prefix is domain separation, so an
  invoice link can never open an estimate or the reverse (tested). Routes: `/estimate/:token` (page),
  `/public/estimates/:token[/pdf|/view|/respond]`. Drafts are never public. Every bad link is the same 404.
- Viewing is recorded by an explicit POST from the page's script (not by fetching it, so link-preview bots
  change nothing): sent -> viewed once, owner notified once.
- **Respond** (`accept` | `decline`, optional typed name <= 100 chars): the estimate row is locked. The same
  answer twice is a no-op (first name and time stand, one notification); the opposite answer after a
  decision is `409 ALREADY_DECIDED`; an expired (`ESTIMATE_EXPIRED`) or converted estimate is refused. The
  owner can still record a late yes by hand on an expired one; customers cannot.
- This is a **click-to-accept, not a legal e-signature**: the typed name is not verified, and the record is
  the time, the typed name and the IP in the audit log. If you need signatures that hold up (contracts,
  large jobs), use a dedicated e-signature service.
- Accepting never converts or charges anything; the owner converts. Owner gets an `estimate_viewed` /
  `estimate_accepted` / `estimate_declined` notification (push + centre); tapping opens the estimate.
- Abuse limits: public routes per IP (`PUBLIC_RATE_LIMIT_PER_MINUTE`), answers per IP
  (`RESPOND_RATE_LIMIT_PER_MINUTE`, default 10), 2 KB body cap, strict nonce CSP with no third-party hosts.

## Invoice appearance (Phase 13)
- Owners choose a layout (Classic, Modern, Minimal), an accent colour and six on/off switches (logo, tax
  column, payment information, notes, terms, signature) under More > Invoice appearance, with a live
  preview of a sample invoice. The choice applies to PDFs (invoices and estimates), the in-app preview and
  both customer pages. The app does not offer per-invoice overrides.
- The accent is used as text on white and as a band under white text, so colours with contrast below 3:1
  against white are refused (server and app share `isReadableAccent`). Presets are all >= 4.5:1.
- `displayOptions` is now a strict set of the six known keys (it was a free-form map). Anything else
  already stored is ignored when read. Saving replaces the whole set; "shown unless set to false" stays
  the rule, so new switches added later default to on.
- Tax column off hides the per-line tax names; the tax lines in the totals stay, because a tax-inclusive
  total that hides its tax would be misleading. Switching off payment information hides the owner's typed
  instructions but never the online pay form.
- Customer pages use light template styling (modern = coloured header, minimal = plain rules); the PDF
  differences are larger. Fonts and logo placement are not customisable.
- Not covered: custom fonts, invoice title wording ("Tax invoice"), colours per document, a logo-size
  setting, multiple saved themes.

## Offline drafts and sync (Phase 14)
**Scope.** You can create invoice drafts, edit existing *drafts*, and delete drafts with no connection.
Everything else (sending, payments, customers, products, estimates, viewing other invoices) still needs
the network. Estimates are not queued yet.

**How it works.**
- The app tries the server first. Only a *connection* failure (no network, timeout) queues the change;
  validation errors, conflicts and 5xx are shown as before. Nothing changes for an online user.
- A new invoice gets its id **on the phone** (`POST /v1/invoices` accepts an optional `id`). The server
  never reuses an id (`409 ID_TAKEN`, same answer for "yours" and "someone else's"), so a retry can never
  create two invoices, even when the first request reached the server and only the reply was lost.
- The queue holds **one op per invoice** (edits coalesce; the *first* base version is kept, so a
  conflict is judged against what the user originally saw). It is a JSON file in the app's private
  documents folder, **one file per user**.
- Uploads run oldest first when the app comes to the front, every 30 s while something is waiting, and on
  "Sync now". A connection or server problem stops the run (the rest would fail the same way); a problem
  with one draft does not block the others. There is no connectivity library: "offline" means "the request
  failed", which is also what a captive portal or dead Wi-Fi looks like.
- The form works offline from a **saved copy** of business settings, tax rates, and the first 100
  customers and 100 active products (refreshed at most every 10 minutes). A bigger catalogue is only
  partly available offline.

**Conflict policy (no silent overwrites).**
- Server version moved on, content differs -> *conflict*: "Keep my version" (re-base on the server's
  current version and upload) or "Use server version" (discard mine). Never decided automatically.
- Server already has exactly my content (the save worked, the reply was lost) -> counted as done, not a
  conflict (compared field by field).
- Draft was sent/paid elsewhere, or deleted -> *conflict*: only "Save as new draft" (fresh id, automatic
  number) or discard. A sent invoice is never edited by an old offline copy.
- Server refuses the content (number taken, customer/product deleted) -> *failed* with a plain reason; the
  user edits and saves again, or discards.
- Editing an **already sent** invoice is never queued: payments may have happened, so it needs the network.
- Numbers: offline drafts leave the number blank, so the server assigns the next one at upload (invoice
  numbers may therefore not follow the order drafts were written in). A typed number that is taken becomes
  a *failed* draft.
- Deleting a never-uploaded draft still sends a delete (404 counts as done), because its create may have
  reached the server.
- If the user edits a draft *while* its previous version is uploading, the newer edit is kept and follows
  the upload without a version check against its own upload.

**Privacy and limits.**
- Drafts and the saved lists sit **unencrypted** in the app sandbox (customer names, emails, prices).
  They are removed on sign-out, session end, and account deletion, and signing out with unsynced drafts
  asks first. Device-level encryption and the optional biometric lock are the protection beyond that.
- Edits queued on two devices for the same draft are resolved by the conflict flow above, not merged.
- Not covered: offline estimates, offline customers/products, background upload while the app is closed
  (the app must be opened), per-field merges.

## Polish and hardening (Phase 15)
- **Contrast (WCAG AA, 4.5:1) is now tested**, light and dark: text/muted/primary/danger on both
  backgrounds, button text, and every status badge on its own tint. It found real failures: badge colours
  were light-mode colours reused in dark mode (down to 2.4:1), `muted` text on cards was 4.43:1, and
  `danger` on cards was 4.4999:1. Badge colours are now a per-scheme palette (`src/theme/status-colors.ts`),
  `muted` and `danger` were darkened slightly in light mode.
- **Structural accessibility audit** renders 18 screens and fails on an unnamed button, an unlabelled
  text field/switch/image, or a tappable element without a role. It also proves it can fail (negative
  controls). It checks *structure*, not behaviour: it cannot replace a screen-reader pass on a device
  (VoiceOver/TalkBack focus order, large text, reduced motion), which is on the launch checklist.
- **Error messages**: a test cross-checks every error code the API can send against the app's plain-language
  list, in both directions (no missing message, no dead message). It found 15 codes with no message, so
  estimate, offline and payment errors fell back to "Something went wrong". An explicit allowlist records
  the codes that are intentionally not translated and why. `VERSION_CONFLICT` no longer says "invoice".
- **Performance smoke test** (20,000 invoices, 40,000 lines, one business) over list, deep paging, status
  filters (including derived overdue/outstanding), search, date range, dashboard, detail and payments:
  every call ran in tens of milliseconds locally; the bounds in the test are 0.8-2.5 s so it catches a
  full scan or an N+1, not small regressions. It cleans up after itself.
- **Overdue sweep**: it was one-by-one per invoice (6 s for ~10,000 newly overdue invoices, and one push each).
  It now writes timeline entries in a tight loop and sends **one summary notification per business per batch
  when more than 5 go overdue at once** (after downtime or a first deploy); a few overdue invoices still
  notify individually. Tapping the summary opens the Overdue list. 6 s -> 0.24 s on the same data.
- **Database pool** now has a 20 s statement timeout, 30 s idle-in-transaction timeout and 5 s connection
  wait, so a stuck query or forgotten transaction cannot hold a connection and row locks forever.
- Not done: image caching/downsizing review, list item memoisation (rows take inline callbacks, so memo
  would not help), bundle-size analysis, startup-time profiling on a low-end Android phone. Those need a
  device.

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
