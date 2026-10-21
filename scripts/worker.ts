import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
const { runJobs, scheduleSyncs, cleanup } = await import('../src/lib/jobs');
const { db } = await import('../src/lib/db');
let running = true;
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
    if (result.completed || result.failed) console.log(result);
    await cleanup();
  } catch (error) {
    console.error('worker_cycle_failed', error instanceof Error ? error.name : 'Unknown');
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
await db.end();
