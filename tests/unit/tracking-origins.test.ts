import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackingOrigin, trackingOrigins } from '../../src/lib/tracking-origins';

test('tracking origins accept pasted hostnames, HTTPS URLs and trailing slashes', () => {
  const origin = 'https://mundocriativo.joaolucasqueirozag.workers.dev';
  for (const input of [origin, origin + '/', origin.slice(8), '  ' + origin + '  ']) {
    assert.equal(trackingOrigin.parse(input), origin);
  }
  assert.equal(trackingOrigin.parse('http://localhost:3000/'), 'http://localhost:3000');
  assert.deepEqual(trackingOrigins.parse([origin, origin + '/']), [origin]);
});

test('tracking origins reject wildcard, path, query, credentials and insecure remote sites', () => {
  for (const input of [
    '',
    '*',
    'https://*.example.com',
    'https://example.com/page',
    'https://example.com?token=1',
    'https://example.com/#fragment',
    'https://user:pass@example.com',
    'http://example.com',
    'javascript:alert(1)',
    'https://example.com other.com',
  ]) {
    assert.equal(trackingOrigin.safeParse(input).success, false, input);
  }
});
