import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeProviderMessage } from '../../src/lib/provider-errors';

test('provider diagnostics redact credentials and connection URLs before storage or logging', () => {
  const secret = 'private+secret/with=characters';
  const token = 'EAA' + 'x'.repeat(80);
  const input =
    `Invalid parameter. ${secret} ${encodeURIComponent(secret)} ${token} Bearer hidden-token\n` +
    'access_token=other-token appsecret_proof=other-proof client_secret=other-secret password=other-password ' +
    'postgresql://user:db-password@host/db https://example.test?token=private';
  const message = safeProviderMessage(input, [secret]);
  assert.match(message, /Invalid parameter/);
  for (const value of [
    secret,
    encodeURIComponent(secret),
    token,
    'hidden-token',
    'other-token',
    'other-proof',
    'other-secret',
    'other-password',
    'db-password',
    'token=private',
  ]) {
    assert(!message.includes(value), value);
  }
  assert(!message.includes('\n'));
  assert(safeProviderMessage('x'.repeat(1000)).length <= 300);
  assert.equal(safeProviderMessage(null), 'Falha no provedor');
});
