import { test } from 'node:test';
import assert from 'node:assert/strict';
const base = process.env.TEST_BASE_URL || 'http://localhost:8787';
test('Workers serves the dashboard and tracking asset without an authenticated session', async () => {
  const response = await fetch(base);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert(html.includes('Visão geral'));
  assert(html.includes('DEMONSTRAÇÃO'));
  const pixel = await fetch(base + '/pixel.js');
  assert.equal(pixel.status, 200);
  assert((await pixel.text()).includes('MetaTrack'));
  const privateRoute = await fetch(base + '/api/dashboard?start=2026-10-01&end=2026-10-02');
  assert.equal(privateRoute.status, 401);
});
test(
  'Workers closes PostgreSQL sockets before the next request',
  { skip: process.env.WORKERS_DATABASE_TEST !== '1' },
  async () => {
    // A global pg.Pool succeeds once and then hangs when reusing another request's TCP socket.
    for (let i = 0; i < 5; i++) {
      const response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200, `database request ${i + 1}`);
      assert.deepEqual(await response.json(), { ok: true });
    }
  },
);
