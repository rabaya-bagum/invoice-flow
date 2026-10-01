import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from 'pg';

const ROOT = path.resolve(__dirname, '../..');

function pgBinDir(): string | null {
  const base = '/usr/lib/postgresql';
  if (!existsSync(base)) return null;
  const versions = readdirSync(base).sort((a, b) => Number(a) - Number(b));
  const latest = versions[versions.length - 1];
  return latest ? path.join(base, latest, 'bin') : null;
}

async function applySchema(url: string) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA public;',
    );
    const files = [
      path.join(ROOT, 'supabase/local/bootstrap.sql'),
      ...readdirSync(path.join(ROOT, 'supabase/migrations'))
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .map((f) => path.join(ROOT, 'supabase/migrations', f)),
    ];
    for (const f of files) await client.query(readFileSync(f, 'utf8'));
  } finally {
    await client.end();
  }
}

/**
 * Provides a real Postgres for integration tests.
 *  - TEST_DATABASE_URL set: uses it. WARNING: the public and auth schemas are wiped. Local hosts only.
 *  - otherwise starts a throwaway cluster from the local PostgreSQL binaries.
 *  - SKIP_DB_TESTS=1: skip (DB suites then fail fast; use only for quick unit runs with -t).
 */
export default async function globalSetup() {
  if (process.env.SKIP_DB_TESTS) return;
  const g = globalThis as unknown as { __PG__?: { dir: string; ctl: string[] } };

  let url = process.env.TEST_DATABASE_URL;
  if (url) {
    const host = new URL(url).hostname;
    if (host && !['localhost', '127.0.0.1', '::1'].includes(host)) {
      throw new Error('TEST_DATABASE_URL must point to localhost: its schemas are wiped');
    }
  } else {
    const bin = pgBinDir();
    if (!bin) {
      throw new Error(
        'No PostgreSQL found. Install PostgreSQL, or set TEST_DATABASE_URL to a local empty database.',
      );
    }
    const dir = mkdtempSync(path.join(tmpdir(), 'ifdb-'));
    const asRoot = process.getuid?.() === 0;
    const prefix = asRoot ? ['runuser', '-u', 'postgres', '--'] : [];
    const run = (cmd: string, args: string[]) =>
      execFileSync(
        prefix[0] ?? cmd,
        [...prefix.slice(1), ...(prefix.length ? [cmd] : []), ...args],
        {
          stdio: 'pipe',
        },
      );
    if (asRoot) execFileSync('chown', ['-R', 'postgres', dir]);
    run(path.join(bin, 'initdb'), ['-D', `${dir}/data`, '-A', 'trust', '-U', 'postgres']);
    const port = 54000 + Math.floor(Math.random() * 900);
    run(path.join(bin, 'pg_ctl'), [
      '-D',
      `${dir}/data`,
      '-o',
      `-p ${port} -k ${dir} -c listen_addresses=''`,
      '-l',
      `${dir}/log`,
      '-w',
      'start',
    ]);
    g.__PG__ = {
      dir,
      ctl: [...prefix, path.join(bin, 'pg_ctl'), '-D', `${dir}/data`, '-m', 'immediate', 'stop'],
    };
    url = `postgresql://postgres@localhost/postgres?host=${dir}&port=${port}`;
  }

  await applySchema(url);
  process.env.TEST_DATABASE_URL = url;
}

export function stopCluster() {
  const g = globalThis as unknown as { __PG__?: { dir: string; ctl: string[] } };
  if (!g.__PG__) return;
  const [cmd, ...args] = g.__PG__.ctl;
  try {
    execFileSync(cmd as string, args, { stdio: 'ignore' });
  } finally {
    rmSync(g.__PG__.dir, { recursive: true, force: true });
  }
}
