# Security review (Phase 9)

Scope: the API (`api/`), the database (`supabase/`), the mobile app's handling of credentials, and the
public invoice/pay pages. This is a code review plus automated tests, **not** a penetration test.
Get an independent pentest before handling real customers' money.

## What is enforced, and where it is tested

| Area | Control | Test |
| --- | --- | --- |
| Authentication | Every `/v1` route needs a verified Supabase JWT (signature, issuer, audience, expiry; `alg=none` refused). | `auth.test.ts`, `security.test.ts` (sweeps every route declared in `src/routes`, so a new route cannot skip it) |
| Tenant isolation | The business is resolved from the verified user, never from input. Every query is scoped by `business_id`. Another tenant's ids answer 404 (never 403), so ids cannot be probed. Clients get read-only RLS as a second layer. | `security.test.ts` (29 id-based actions across customers, products, tax rates, invoices, estimates, PDF/send/share, payments, refunds, notifications), `invoices.test.ts`, `database` CI job (RLS checks) |
| Mass assignment | Zod schemas strip unknown keys. Ownership, status, totals, amounts paid and share tokens are server-controlled. | `security.test.ts` |
| Money integrity | Integer minor units; server is the only calculator; non-integer, negative and out-of-range amounts are rejected. Invoices with money paid cannot be edited or deleted. | `security.test.ts`, shared money tests |
| Injection | Parameterised SQL only. The one interpolated value (list status) is an enum validated by zod. `LIKE` search terms are escaped. Public pages escape every user field and use a per-response CSP nonce. | `security.test.ts`, `documents.test.ts` |
| Public links | `id.HMAC(secret, id:salt)`, constant-time compare, revocable, rate limited. Viewing is an explicit POST, not a GET. | `documents.test.ts` |
| Payments | Webhook verifies the Stripe signature on the raw body, dedupes event ids in the same transaction, one pending payment per invoice (unique index + row lock + idempotency keys). | `payments.test.ts`, `security.test.ts` |
| Abuse | Rate limits: per IP on `/v1`, tighter on public routes and payment intents, per user on email sending. Body limits: 100 KB JSON, 1 MB images, 2 KB payment-intent body. | `app.test.ts`, `documents.test.ts` |
| Errors and logs | One error envelope; unknown errors become a generic 500 and are logged server-side only. Logs redact `Authorization`, `Cookie`, `Stripe-Signature`, `Set-Cookie`. | `security.test.ts` |
| Transport and browser | `helmet` headers, no `X-Powered-By`, CORS closed by default (`CORS_ORIGINS` allow-list). | `security.test.ts` |
| Mobile secrets | Session tokens live in the OS keychain/keystore (`expo-secure-store`); optional biometric lock; push tokens are removed on sign-out. Only `EXPO_PUBLIC_*` values (Supabase URL and anon key, API URL) are in the bundle. | `secure-storage.test.ts`, `auth-store.test.tsx` |

## Findings and fixes in this phase

1. **Fixed:** `GET /v1/customers/:id/invoices` answered `200` with an empty list for another
   business's customer. No data leaked, but it confirmed nothing and was inconsistent with every other
   route. It now answers `404`.
2. **Fixed:** request logs redacted only `Authorization`. `Cookie`, `Stripe-Signature` and `Set-Cookie`
   are now redacted too.
3. **Fixed:** shutdown could hang on keep-alive connections until the orchestrator killed the process.
   It now closes idle connections and force-exits after 10 s. Unhandled promise rejections are logged.
4. **Documented, not changed:** a push token belongs to whoever registered it last on that device
   (needed when a phone changes hands). Someone who learns another user's Expo push token could
   re-register it and receive that user's notification text. Tokens are long, random and never shown
   by the API, so the risk is low; if it matters, bind tokens to a device id.
5. **Documented, not changed:** `pnpm audit --prod` reports one moderate advisory, `uuid <11.1.1`
   (GHSA-w5hq-g745-h8pq), pulled in by `expo > @expo/config-plugins > xcode`. It is build-time tooling
   that never runs in the API or in the app bundle, and it only matters when a caller passes its own
   output buffer. Revisit when Expo bumps the dependency.

## Not covered (needs your environment or a human)

- Supabase project settings: email confirmation on, password policy, leaked-password protection,
  redirect URL allow-list, JWT expiry, rate limits on auth endpoints (Supabase's own).
- Stripe: live-mode keys, webhook endpoint secret, Connect branding, Apple Pay domain verification.
- TLS and headers at your load balancer; secrets management; backups and point-in-time recovery of the
  database; log retention.
- Dependency monitoring (Dependabot or similar) and an incident contact.
- Privacy: a privacy policy and data-deletion path (account deletion exists: `DELETE /v1/me`).
- Penetration test and App Store / Play data-safety declarations.
