import { Pool, types, type QueryResultRow } from 'pg';

// bigint (int8) columns hold money in minor units. Return them as JS numbers, but refuse
// to silently lose precision.
types.setTypeParser(20, (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`bigint out of safe range: ${v}`);
  return n;
});
// date columns stay "YYYY-MM-DD" strings (no timezone shifting through JS Date).
types.setTypeParser(1082, (v) => v);

export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

export interface Database extends Queryable {
  /** Runs `fn` in one transaction: commit on success, rollback on any throw. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    // A stuck query or a forgotten transaction must not hold a connection (and a row lock) forever.
    connectionTimeoutMillis: 5_000,
    statement_timeout: 20_000,
    idle_in_transaction_session_timeout: 30_000,
  });
}

export function createDatabase(pool: Pool): Database {
  return {
    query: (text, values) => pool.query(text, values),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
