import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient } from "pg";

const globalForDb = globalThis as unknown as {
  dbPool?: Pool;
  dbTxStorage?: AsyncLocalStorage<PoolClient>;
};

export const pool =
  globalForDb.dbPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });

// Ambient transaction client (T1 / 7A): query() inside withTransaction(fn) runs on the
// tx session, so nested service/audit/readiness writes observe uncommitted state.
const txStorage = globalForDb.dbTxStorage ?? new AsyncLocalStorage<PoolClient>();

if (process.env.NODE_ENV !== "production") {
  globalForDb.dbPool = pool;
  globalForDb.dbTxStorage = txStorage;
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = txStorage.getStore();
  const res = await (client ? client.query(text, params as never[]) : pool.query(text, params as never[]));
  return res.rows as T[];
}

// pool.connect → BEGIN / COMMIT; any throw → ROLLBACK + re-raise (spec §14 line 406).
// Nested calls reuse the ambient client (no second BEGIN on the same session).
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const existing = txStorage.getStore();
  if (existing) return fn();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await txStorage.run(client, fn);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // connection already broken — original error wins
    }
    throw err;
  } finally {
    client.release();
  }
}
