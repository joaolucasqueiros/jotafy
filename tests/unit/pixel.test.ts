import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync('public/pixel.js', 'utf8');
function browser() {
  const requests: Record<string, unknown>[] = [];
  const storage = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
  };
  let now = Date.parse('2026-10-23T15:00:00Z');
  class Clock extends Date {
    constructor() {
      super(now);
    }
    static now() {
      return now;
    }
  }
  const window: {
    MetaTrack?: {
      init: (input: unknown) => void;
      track: (name: string, options?: unknown) => Promise<unknown>;
      revoke: () => void;
    };
  } = {};
  const context = vm.createContext({
    window,
    document: { currentScript: { src: 'https://metatrack.example/pixel.js' }, cookie: '' },
    location: { href: 'https://offer.example/?utm_campaign=123&fbclid=abc' },
    URL,
    crypto,
    Date: Clock,
    localStorage: storage(),
    sessionStorage: storage(),
    fetch: (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(init.body as string));
      return Promise.resolve({ ok: true });
    },
  });
  vm.runInContext(source, context);
  return {
    window,
    requests,
    context,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
test('pixel requires consent, repeated init and duplicate script do not create extra visits', () => {
  const b = browser();
  const api = b.window.MetaTrack!;
  api.init({ key: 'key', consent: false });
  assert.equal(b.requests.length, 0);
  api.init({ key: 'key', consent: true });
  api.init({ key: 'key', consent: true });
  vm.runInContext(source, b.context);
  b.window.MetaTrack!.init({ key: 'key', consent: true });
  assert.equal(b.requests.length, 1);
  assert.equal(b.requests[0].event, 'PageView');
  assert.equal(b.requests[0].occurredAt, '2026-10-23T15:00:00.000Z');
});
test('pixel keeps explicit identity for retries, preserves new actions and expires idle sessions', async () => {
  const b = browser();
  const api = b.window.MetaTrack!;
  api.init({ key: 'key', consent: true });
  const id = crypto.randomUUID();
  await api.track('InitiateCheckout', { eventId: id });
  await api.track('InitiateCheckout', { eventId: id });
  assert.equal(b.requests[1].eventId, id);
  assert.equal(b.requests[2].eventId, id);
  assert.equal(b.requests[0].sessionId, b.requests[2].sessionId);
  await api.track('InitiateCheckout');
  assert.notEqual(b.requests[3].eventId, id);
  b.advance(31 * 60000);
  await api.track('InitiateCheckout');
  assert.notEqual(b.requests[4].sessionId, b.requests[3].sessionId);
  assert.equal(b.requests[4].clickId, b.requests[3].clickId); // attribution is not session identity
  api.revoke();
  await api.track('PageView');
  assert.equal(b.requests.length, 5);
});
