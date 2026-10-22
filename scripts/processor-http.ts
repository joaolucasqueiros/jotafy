import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
const required = ['DATABASE_URL', 'ENCRYPTION_KEY', 'META_APP_SECRET', 'CRON_SECRET'];
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length) {
  console.error('processor_configuration_missing', missing.join(', '));
  process.exit(1);
}
const { assertEncryptionConfigured } = await import('../src/lib/security');
try {
  assertEncryptionConfigured();
} catch {
  console.error(
    'processor_configuration_invalid: restaure a ENCRYPTION_KEY original de 32 bytes em base64.',
  );
  process.exit(1);
}
const port = Number(process.env.PORT || '10000');
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('processor_configuration_invalid: PORT inválida.');
  process.exit(1);
}
const { createProcessorServer } = await import('../src/lib/processor-http');
const { scheduleSyncs, runJobs, cleanup } = await import('../src/lib/jobs');
const { db } = await import('../src/lib/db');
const { safeProviderMessage } = await import('../src/lib/provider-errors');
let lastCleanup = 0;
const processor = createProcessorServer({
  secret: process.env.CRON_SECRET!,
  process: async () => {
    await scheduleSyncs();
    const result = await runJobs(10);
    console.log(JSON.stringify({ event: 'processor_cycle_finished', ...result }));
    if (Date.now() - lastCleanup >= 3600000) {
      await cleanup();
      lastCleanup = Date.now();
    }
  },
  onError: (error) =>
    console.error(
      JSON.stringify({
        event: 'processor_cycle_failed',
        message: safeProviderMessage(error instanceof Error ? error.message : null, [
          process.env.DATABASE_URL!,
          process.env.ENCRYPTION_KEY!,
          process.env.META_APP_SECRET!,
          process.env.CRON_SECRET!,
        ]),
      }),
    ),
});
processor.server.listen(port, '0.0.0.0', () =>
  console.log(JSON.stringify({ event: 'processor_http_started', port })),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await new Promise<void>((resolve) => processor.server.close(() => resolve()));
  await processor.waitForIdle();
  await db.end();
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
