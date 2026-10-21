import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { graphRequest, graphAll } from '../../src/lib/meta';
import { db } from '../../src/lib/db';
process.env.META_APP_SECRET = 'app-secret-for-unit-test';
test('Graph client keeps bearer token out of URL, computes proof and serializes POST', async () => {
  const fn = mock.method(
    globalThis,
    'fetch',
    async (input: URL | string | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      assert.equal(url.hostname, 'graph.facebook.com');
      assert(!url.searchParams.has('access_token'));
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer token-test');
      const body = new URLSearchParams(init?.body as URLSearchParams);
      assert.equal(body.get('status'), 'PAUSED');
      assert.equal(
        body.get('appsecret_proof'),
        createHmac('sha256', 'app-secret-for-unit-test').update('token-test').digest('hex'),
      );
      return Response.json({ success: true });
    },
  );
  try {
    assert.deepEqual(await graphRequest('123', 'token-test', { status: 'PAUSED' }, 'POST'), {
      success: true,
    });
    await assert.rejects(() => graphRequest('https://evil.test/path', 'token-test'));
  } finally {
    fn.mock.restore();
  }
});
test('Graph pagination uses cursor on fixed graph host, never arbitrary next URL', async () => {
  let calls = 0;
  const fn = mock.method(globalThis, 'fetch', async (input: URL | string | Request) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'graph.facebook.com');
    calls++;
    if (calls === 1)
      return Response.json({
        data: [{ id: '1' }],
        paging: {
          next: 'https://evil.example/steal?access_token=bad',
          cursors: { after: 'cursor-2' },
        },
      });
    assert.equal(url.searchParams.get('after'), 'cursor-2');
    return Response.json({ data: [{ id: '2' }] });
  });
  try {
    assert.deepEqual(await graphAll('me/adaccounts', 'token-test', {}), [{ id: '1' }, { id: '2' }]);
    assert.equal(calls, 2);
  } finally {
    fn.mock.restore();
  }
});
test('Graph provider errors fail explicitly', async () => {
  const fn = mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: { code: 190 } }, { status: 400 }),
  );
  try {
    await assert.rejects(() => graphRequest('me', 'expired'), /código 190/);
  } finally {
    fn.mock.restore();
  }
});
