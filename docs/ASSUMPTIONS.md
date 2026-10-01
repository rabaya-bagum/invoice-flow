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
