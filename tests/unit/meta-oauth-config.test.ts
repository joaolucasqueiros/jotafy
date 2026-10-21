import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { metaOAuthConfig } from '../../src/lib/meta-oauth-config';
import { HttpError, encrypt, decrypt } from '../../src/lib/security';

function withConfig(run: () => void) {
  const names = [
    'META_APP_ID',
    'META_APP_SECRET',
    'ENCRYPTION_KEY',
    'APP_URL',
    'META_GRAPH_VERSION',
  ];
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    META_APP_ID: '1234567890',
    META_APP_SECRET: 'test-only-app-secret',
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    APP_URL: 'https://panel.example.com',
    META_GRAPH_VERSION: 'v25.0',
  });
  try {
    run();
  } finally {
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  }
}
function failsWith(code: string) {
  assert.throws(
    () => metaOAuthConfig(),
    (error: unknown) => error instanceof HttpError && error.status === 503 && error.code === code,
  );
}
test('Meta OAuth config creates the exact callback without exposing secrets', () =>
  withConfig(() => {
    const result = metaOAuthConfig();
    assert.deepEqual(result, {
      appId: '1234567890',
      callbackUrl: 'https://panel.example.com/api/auth/meta/callback',
      version: 'v25.0',
    });
    assert(!JSON.stringify(result).includes(process.env.META_APP_SECRET!));
    const state = encrypt('opaque OAuth state');
    assert.equal(decrypt(state), 'opaque OAuth state');
  }));
test('Meta OAuth identifies missing or invalid encryption key instead of generic 500', () =>
  withConfig(() => {
    delete process.env.ENCRYPTION_KEY;
    failsWith('ENCRYPTION_KEY_INVALID');
    process.env.ENCRYPTION_KEY = 'wrong-key';
    failsWith('ENCRYPTION_KEY_INVALID');
  }));
test('Meta OAuth identifies app ID, app secret and API version configuration errors', () =>
  withConfig(() => {
    delete process.env.META_APP_ID;
    failsWith('META_APP_ID_MISSING');
    process.env.META_APP_ID = 'APP_ID=123';
    failsWith('META_APP_ID_INVALID');
    process.env.META_APP_ID = '123';
    delete process.env.META_APP_SECRET;
    failsWith('META_APP_SECRET_MISSING');
    process.env.META_APP_SECRET = 'test-only-secret';
    process.env.META_GRAPH_VERSION = '25';
    failsWith('META_GRAPH_VERSION_INVALID');
  }));
test('Meta OAuth rejects callback paths in APP_URL and malformed origins', () =>
  withConfig(() => {
    for (const origin of [
      'not a URL',
      'https://panel.example.com/api/auth/meta/callback',
      'https://panel.example.com?x=1',
      'https://user:password@panel.example.com',
      'http://panel.example.com',
    ]) {
      process.env.APP_URL = origin;
      failsWith('APP_URL_INVALID');
    }
    process.env.APP_URL = 'https://panel.example.com/';
    assert.equal(metaOAuthConfig().callbackUrl, 'https://panel.example.com/api/auth/meta/callback');
  }));
