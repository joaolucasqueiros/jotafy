import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHmac } from 'node:crypto';
import { encrypt, decrypt, hashPassword, verifyPassword, sha256 } from '../../src/lib/security';
import { normalizeCakto, canTransition } from '../../src/lib/cakto';
import { verifyRelaySignature } from '../../src/lib/signature';
import { demoData } from '../../src/lib/demo';
process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
const secret = 'test-webhook-secret-long';
function payload(event = 'purchase_approved') {
  return {
    secret,
    event,
    data: {
      id: 'order-1',
      amount: '197.90',
      createdAt: '2026-01-02T10:00:00Z',
      approvedDate: '2026-01-02T10:02:00Z',
      customer: { email: ' USER@Example.com ' },
      product: { name: 'Curso' },
      utm: { utm_campaign: '123', utm_term: '234', utm_content: '345', utm_source: null },
    },
  };
}
test('encryption authenticates ciphertext and uses fresh nonces', () => {
  const a = encrypt('sensitive');
  assert.equal(decrypt(a), 'sensitive');
  assert.notEqual(encrypt('sensitive'), a);
  const parts = a.split('.');
  parts[2] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => decrypt(parts.join('.')));
});
test('passwords are salted and verified', () => {
  const hash = hashPassword('very secure password');
  assert(verifyPassword('very secure password', hash));
  assert(!verifyPassword('wrong', hash));
  assert.notEqual(hashPassword('very secure password'), hash);
});
test('Cakto normalizes BRL to cents, IDs, nullable UTMs and hashes normalized email', () => {
  const e = normalizeCakto(payload(), secret)!;
  assert.equal(e.amount, 19790);
  assert.equal(e.campaignId, '123');
  assert.equal(e.adsetId, '234');
  assert.equal(e.adId, '345');
  assert.equal(e.customerHash, sha256('user@example.com'));
  assert.equal(e.status, 'approved');
  assert.equal(e.occurredAt.toISOString(), '2026-01-02T10:02:00.000Z');
});
test('Cakto rejects invalid secrets, negative prices, missing timestamps and foreign currencies', () => {
  assert.throws(() => normalizeCakto(payload(), 'incorrect'));
  const p = payload();
  p.data.amount = '-1';
  assert.throws(() => normalizeCakto(p, secret));
  assert.throws(() => normalizeCakto({ ...payload(), data: { id: '1', amount: 100 } }, secret));
  assert.throws(() =>
    normalizeCakto({ ...payload(), data: { ...payload().data, currency: 'USD' } }, secret),
  );
});
test('all supported lifecycle events and unknown events', () => {
  for (const [event, status] of Object.entries({
    purchase_approved: 'approved',
    purchase_pending: 'pending',
    pix_generated: 'pending',
    purchase_refunded: 'refunded',
    chargeback: 'chargeback',
    purchase_chargeback: 'chargeback',
    purchase_refused: 'refused',
  }))
    assert.equal(normalizeCakto(payload(event), secret)?.status, status);
  assert.equal(normalizeCakto(payload('unhandled_event'), secret), null);
});
test('lifecycle cannot regress from approved or terminal states', () => {
  assert(!canTransition('approved', 'pending'));
  assert(!canTransition('approved', 'refused'));
  assert(canTransition('approved', 'refunded'));
  assert(!canTransition('refunded', 'approved'));
  assert(canTransition('refunded', 'chargeback'));
  assert(!canTransition('chargeback', 'refunded'));
});
test('optional HMAC relay authenticates the exact raw payload', () => {
  const raw = '{"event":"test"}',
    key = 'relay-secret';
  const sig = 'sha256=' + createHmac('sha256', key).update(raw).digest('hex');
  assert(verifyRelaySignature(raw, sig, key));
  assert(!verifyRelaySignature(raw + ' ', sig, key));
  assert(!verifyRelaySignature(raw, null, key));
  assert(!verifyRelaySignature(raw, sig, 'wrong'));
});
test('demo revenue, spending and sales reconcile', () => {
  const d = demoData();
  assert.equal(
    d.summary.revenue,
    d.sales.filter((s) => s.status === 'approved').reduce((a, s) => a + s.amount, 0),
  );
  assert.equal(
    d.summary.revenue,
    d.series.reduce((a, s) => a + s.revenue, 0),
  );
  assert.equal(
    d.summary.spend,
    d.series.reduce((a, s) => a + s.spend, 0),
  );
  assert.equal(
    d.summary.spend,
    d.campaigns.reduce((a, c) => a + c.spend, 0),
  );
  assert.equal(d.summary.attributed + d.summary.unattributed, d.summary.sales);
});

test('profit estimates include configured costs without allocating fixed overhead to filtered campaigns', async () => {
  const { estimateCosts } = await import('../../src/lib/costs');
  const config = {
    salesTaxBps: 600,
    feeBps: 500,
    adTaxBps: 1000,
    productCost: 1000,
    dailyExpenses: 500,
  };
  assert.deepEqual(estimateCosts(100000, 20000, 10, 7, config), {
    taxes: 6000,
    fees: 5000,
    adTax: 2000,
    products: 10000,
    expenses: 3500,
    total: 26500,
  });
  assert.equal(estimateCosts(100000, 20000, 10, 7, config, true).total, 23000);
});

test('demo campaign filters reconcile chart, metrics and orders', () => {
  const id = demoData().campaigns[0].id;
  const d = demoData(7, id);
  assert.equal(d.campaigns.length, 1);
  assert(d.sales.every((s) => s.campaignId === id));
  assert.equal(
    d.summary.revenue,
    d.series.reduce((n, p) => n + p.revenue, 0),
  );
  assert.equal(
    d.summary.spend,
    d.series.reduce((n, p) => n + p.spend, 0),
  );
  assert.equal(d.summary.sales, d.campaigns[0].sales);
});
