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

## Environment variables

See `api/.env.example` and `mobile/.env.example`. The Supabase **service-role key** and Stripe **secret
key** are server-only. Only `EXPO_PUBLIC_*` values reach the app bundle, and anyone can read them.

## Status

Phase 1 (architecture, tooling, schema, money library, CI) is complete. See the roadmap in the project
prompt. Next: Phase 2, authentication.
