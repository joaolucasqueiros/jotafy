import { Pool, type PoolClient, type QueryResultRow } from 'pg';

const globalDb = globalThis as unknown as { db?: Pool };
function isWorkersRuntime() {
  return typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';
}
function createPool() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: isWorkersRuntime() ? 1 : 10,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', (error) => {
    // workerd's TCP adapter may emit a close notification while Pool.end() is disposing sockets.
    if (!pool.ending) console.error('database_idle_connection_error', error.name);
  });
  return pool;
}

// Node processes can retain a pool. Workers cannot reuse TCP sockets across request contexts.
// Keep scripts/tests compatible with a conventional long-running Node process.
export const db = globalDb.db ?? createPool();
if (process.env.NODE_ENV !== 'production') globalDb.db = db;

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
) {
  const pool = isWorkersRuntime() ? createPool() : db;
  try {
    return (await pool.query<T>(sql, params)).rows;
  } finally {
    if (pool !== db) await pool.end();
  }
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const pool = isWorkersRuntime() ? createPool() : db;
  const client = await pool.connect().catch(async (error: unknown) => {
    if (pool !== db) await pool.end();
    throw error;
  });
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    if (pool !== db) await pool.end();
  }
}
