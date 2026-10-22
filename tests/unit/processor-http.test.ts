import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createProcessorServer } from '../../src/lib/processor-http';

test('HTTP processor requires bearer auth and never reports accepted work as delivered', async () => {
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const secret = 'qa-only-scheduler-secret-1234567890';
  const processor = createProcessorServer({
    secret,
    process: async () => {
      calls++;
      await pending;
    },
  });
  processor.server.listen(0, '127.0.0.1');
  await once(processor.server, 'listening');
  const address = processor.server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal((await fetch(base + '/api/jobs')).status, 404);
    assert.equal((await fetch(base + '/api/jobs', { method: 'POST' })).status, 401);
    assert.equal((await fetch(base + '/api/jobs?token=' + secret, { method: 'POST' })).status, 401);
    assert.equal(calls, 0);
    const trigger = () =>
      fetch(base + '/api/jobs', { method: 'POST', headers: { authorization: `Bearer ${secret}` } });
    const first = await trigger();
    assert.equal(first.status, 202);
    assert.deepEqual(await first.json(), { accepted: true, alreadyRunning: false });
    const second = await trigger();
    assert.deepEqual(await second.json(), { accepted: true, alreadyRunning: true });
    assert.equal(calls, 1);
    release();
    await processor.waitForIdle();
    assert.deepEqual(await (await trigger()).json(), { accepted: true, alreadyRunning: false });
    await processor.waitForIdle();
    assert.equal(calls, 2);
  } finally {
    release();
    await processor.waitForIdle();
    await new Promise<void>((resolve) => processor.server.close(() => resolve()));
  }
});

test('HTTP processor recovers after a cycle failure and refuses weak secrets', async () => {
  assert.throws(
    () => createProcessorServer({ secret: '', process: async () => {} }),
    /32 caracteres/,
  );
  let errors = 0;
  const processor = createProcessorServer({
    secret: 'qa-only-scheduler-secret-1234567890',
    process: async () => {
      throw new Error('private provider details');
    },
    onError: () => {
      errors++;
    },
  });
  processor.server.listen(0, '127.0.0.1');
  await once(processor.server, 'listening');
  const address = processor.server.address();
  assert(address && typeof address === 'object');
  try {
    for (let i = 0; i < 2; i++) {
      const response: Response = await fetch(`http://127.0.0.1:${address.port}/api/jobs`, {
        method: 'POST',
        headers: { authorization: 'Bearer qa-only-scheduler-secret-1234567890' },
      });
      assert.equal(response.status, 202);
      assert(!(await response.text()).includes('private provider details'));
      await processor.waitForIdle();
    }
    assert.equal(errors, 2);
  } finally {
    await new Promise<void>((resolve) => processor.server.close(() => resolve()));
  }
});
