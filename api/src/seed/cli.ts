import { createDatabase, createPool } from '../db';
import { resetBusinessData, seedDemoData, SeedError } from './seed';

export interface SeedArgs {
  email: string;
  reset: boolean;
  yes: boolean;
}

export function parseArgs(argv: string[]): SeedArgs {
  const out: SeedArgs = { email: '', reset: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') out.email = argv[++i] ?? '';
    else if (a?.startsWith('--email=')) out.email = a.slice('--email='.length);
    else if (a === '--reset') out.reset = true;
    else if (a === '--yes') out.yes = true;
    else if (a !== '--') throw new SeedError(`Unknown argument: ${a}`);
  }
  if (!out.email) throw new SeedError('Usage: pnpm seed -- --email <user email> [--reset --yes]');
  if (out.reset && !out.yes) {
    throw new SeedError("--reset deletes ALL of that business's data. Add --yes to confirm.");
  }
  return out;
}

export async function run(argv: string[], databaseUrl: string | undefined): Promise<string> {
  const args = parseArgs(argv);
  if (!databaseUrl) throw new SeedError('DATABASE_URL is required');
  const pool = createPool(databaseUrl);
  try {
    const db = createDatabase(pool);
    const found = await db.query<{ user_id: string; business_id: string }>(
      `SELECT p.id AS user_id, b.id AS business_id
       FROM auth.users u JOIN profiles p ON p.id = u.id JOIN business_profiles b ON b.owner_id = p.id
       WHERE lower(u.email) = lower($1)`,
      [args.email],
    );
    const row = found.rows[0];
    if (!row) throw new SeedError(`No account with email ${args.email}. Sign up in the app first.`);
    if (args.reset) await resetBusinessData(db, row.business_id);
    const s = await seedDemoData(db, { businessId: row.business_id, userId: row.user_id });
    return `Seeded ${s.customers} customers, ${s.products} products, ${s.invoices} invoices, ${s.estimates} estimates and ${s.payments} payments for ${args.email}.`;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  run(process.argv.slice(2), process.env.DATABASE_URL).then(
    (msg) => console.log(msg),
    (err) => {
      console.error(err instanceof SeedError ? err.message : err);
      process.exit(1);
    },
  );
}
