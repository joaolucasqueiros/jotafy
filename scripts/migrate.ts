import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
const { db } = await import('../src/lib/db');
const { readFile, readdir } = await import('node:fs/promises');
const client = await db.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(9714821)');
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz DEFAULT now())',
  );
  const files = (await readdir('db')).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  let applied = 0;
  for (const file of files) {
    const version = file.slice(0, 3);
    const { rowCount } = await client.query(
      'SELECT version FROM schema_migrations WHERE version=$1',
      [version],
    );
    if (rowCount) continue;
    await client.query(await readFile(`db/${file}`, 'utf8'));
    await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [version]);
    console.log(`Migração ${version} aplicada.`);
    applied++;
  }
  await client.query('COMMIT');
  if (!applied) console.log('Banco já atualizado.');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
  await db.end();
}
