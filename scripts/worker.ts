import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
const required = ['DATABASE_URL', 'ENCRYPTION_KEY', 'META_APP_SECRET'];
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length) {
  console.error('worker_configuration_missing', missing.join(', '));
  process.exit(1);
}
const { assertEncryptionConfigured } = await import('../src/lib/security');
try {
  assertEncryptionConfigured();
} catch {
  console.error(
    'worker_configuration_invalid: ENCRYPTION_KEY deve ser a chave original de 32 bytes em base64.',
  );
  process.exit(1);
}
const { runJobs, scheduleSyncs, cleanup } = await import('../src/lib/jobs');
const { db } = await import('../src/lib/db');
const once = process.argv.includes('--once');
let running = true;
let lastCleanup = 0,
  lastHeartbeat = 0;
console.log(JSON.stringify({ event: 'worker_started', at: new Date().toISOString() }));
process.on('SIGTERM', () => {
  running = false;
});
process.on('SIGINT', () => {
  running = false;
});
while (running) {
  try {
    await scheduleSyncs();
    const result = await runJobs(10);
    if (once || result.completed || result.failed) console.log(result);
    if (once && result.failed) process.exitCode = 1;
    if (Date.now() - lastCleanup >= 3600000) {
      await cleanup();
      lastCleanup = Date.now();
    }
    if (Date.now() - lastHeartbeat >= 60000) {
      console.log(JSON.stringify({ event: 'worker_heartbeat', at: new Date().toISOString() }));
      lastHeartbeat = Date.now();
    }
  } catch (error) {
    console.error('worker_cycle_failed', error instanceof Error ? error.name : 'Unknown');
    if (once) process.exitCode = 1;
  }
  if (once || !running) break;
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
await db.end();
console.log(JSON.stringify({ event: 'worker_stopped', at: new Date().toISOString() }));
