import { Pool, type PoolClient, type QueryResultRow } from 'pg';
const globalDb = globalThis as unknown as { db?: Pool };
export const db =
  globalDb.db ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 30000,
  });
if (process.env.NODE_ENV !== 'production') globalDb.db = db;
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
) {
  return (await db.query<T>(sql, params)).rows;
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await db.connect();
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
  }
}
