import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../../src/lib/client-api';

test('Cloudflare HTML resource errors produce an actionable message instead of a JSON syntax error', async () => {
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('<!DOCTYPE html><h2>Worker exceeded resource limits</h2>', {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      }),
  );
  try {
    await assert.rejects(() => api('/api/meta/sync', {}), /limite de recursos \(1102\)/);
    await assert.rejects(
      () => api('/api/meta/sync?jobId=private-query'),
      (error: Error) =>
        error.message.includes('GET /api/meta/sync') &&
        error.message.includes('processador Node/GitHub Actions') &&
        !error.message.includes('private-query'),
    );
    await assert.rejects(
      () => api('/api/integrations', {}),
      (error: Error) =>
        error.message.includes('POST /api/integrations') &&
        error.message.includes('logs dessa rota') &&
        !error.message.includes('deve ser executado pelo serviço Node'),
    );
  } finally {
    fetchMock.mock.restore();
  }
});
test('unexpected non-JSON responses never expose raw HTML; JSON provider errors remain readable', async () => {
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async () => new Response('<html>private gateway detail</html>', { status: 502 }),
  );
  try {
    await assert.rejects(
      () => api('/api/dashboard'),
      (error: Error) => error.message.includes('HTTP 502') && !error.message.includes('private'),
    );
  } finally {
    fetchMock.mock.restore();
  }
  const jsonMock = mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: 'Token expirado' }, { status: 409 }),
  );
  try {
    await assert.rejects(() => api('/api/meta/sync', {}), /Token expirado/);
  } finally {
    jsonMock.mock.restore();
  }
});
