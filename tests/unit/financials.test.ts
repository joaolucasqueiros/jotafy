import { test } from 'node:test';
import assert from 'node:assert/strict';
import { financialSummary } from '../../src/lib/financials';
import { normalizeCakto } from '../../src/lib/cakto';
import { sha256 } from '../../src/lib/security';

test('Cakto monetary fields use cents and paidAt; commission emails are hashed', () => {
  const event = normalizeCakto(
    {
      secret: 'secret',
      event: 'purchase_approved',
      data: {
        id: '1',
        amount: 100,
        fees: 10.25,
        createdAt: '2026-01-01T00:00:00Z',
        paidAt: '2026-01-02T00:00:00Z',
        commissions: [{ user: 'owner@example.com', type: 'producer', totalAmount: 60.5 }],
      },
    },
    'secret',
  )!;
  assert.equal(event.providerFees, 1025);
  assert.equal(event.occurredAt.toISOString(), '2026-01-02T00:00:00.000Z');
  assert.deepEqual(event.commissions, [
    { userHash: sha256('owner@example.com'), type: 'producer', amount: 6050 },
  ]);
});
test('own commission is net already; fees and other participants are never subtracted twice', () => {
  const result = financialSummary(
    [
      {
        amount: 10000,
        provider_fees: 1000,
        commission_breakdown: [
          { userHash: sha256('owner@example.com'), type: 'producer', amount: 6000 },
          { userHash: sha256('affiliate@example.com'), type: 'affiliate', amount: 3000 },
        ],
      },
    ],
    'OWNER@example.com',
    500,
  );
  assert.equal(result.net, 6000);
  assert.equal(result.fees, 1000);
  assert.equal(result.estimated, false);
});
test('mixed coverage estimates only missing rows; explicit zero commissions remain confirmed', () => {
  const orders = [
    { amount: 10000, provider_fees: 1200, commission_breakdown: null },
    { amount: 5000, provider_fees: null, commission_breakdown: null },
    {
      amount: 1000,
      provider_fees: 100,
      commission_breakdown: [
        { userHash: sha256('owner@example.com'), type: 'producer', amount: 0 },
      ],
    },
  ];
  const result = financialSummary(orders, 'owner@example.com', 1000);
  assert.equal(result.net, 8800 + 4500);
  assert.equal(result.fees, 1800);
  assert.equal(result.confirmed, 1);
  assert.equal(result.estimated, true);
  assert.equal(financialSummary([], null, 0).estimated, true);
});
