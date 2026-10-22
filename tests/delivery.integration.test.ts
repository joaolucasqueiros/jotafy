import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { withConnection, query, db } = await import('../src/lib/db');
import { randomToken, sha256 } from '../src/lib/security';
import { normalizeCakto } from '../src/lib/cakto';
const { ingestCakto } = await import('../src/lib/orders');
import {
  issueDeliveryAccess,
  redeemDeliveryAccess,
  checkDeliveryAccess,
  recordDeliveryEvent,
  requireDeliveryService,
} from '../src/lib/delivery-access';

const users: string[] = [];
const originalKey = process.env.DELIVERY_WORKSPACE_PUBLIC_KEY;
const originalSecret = process.env.DELIVERY_SERVICE_SECRET;
process.env.DELIVERY_SERVICE_SECRET = randomToken();
after(async () => {
  for (const id of users) await query('DELETE FROM users WHERE id=$1', [id]);
  if (originalKey === undefined) delete process.env.DELIVERY_WORKSPACE_PUBLIC_KEY;
  else process.env.DELIVERY_WORKSPACE_PUBLIC_KEY = originalKey;
  if (originalSecret === undefined) delete process.env.DELIVERY_SERVICE_SECRET;
  else process.env.DELIVERY_SERVICE_SECRET = originalSecret;
  await db.end();
});
test('approved Cakto orders authorize private delivery, replay/refund/expiration and tenant isolation are enforced', async () => {
  const [user] = await query('INSERT INTO users(email,name) VALUES($1,$2) RETURNING id', [
    `delivery-${randomToken()}@example.com`,
    'Delivery QA',
  ]);
  users.push(user.id);
  const publicKey = randomToken();
  process.env.DELIVERY_WORKSPACE_PUBLIC_KEY = publicKey;
  const [workspace] = await query(
    'INSERT INTO workspaces(user_id,public_key) VALUES($1,$2) RETURNING id',
    [user.id, publicKey],
  );
  const externalId = crypto.randomUUID();
  const webhookSecret = 'qa-only-cakto-secret';
  const event = (status: string) =>
    normalizeCakto(
      {
        secret: webhookSecret,
        event: status,
        data: {
          id: externalId,
          amount: 14.9,
          createdAt: new Date().toISOString(),
          customer: { email: 'qa-buyer@example.com' },
          product: { name: 'Pequenos Construtores — 131 Projetos Criativos' },
        },
      },
      webhookSecret,
    )!;
  assert.throws(() =>
    normalizeCakto(
      {
        secret: 'invalid',
        event: 'purchase_approved',
        data: { id: externalId, amount: 14.9, createdAt: new Date().toISOString() },
      },
      webhookSecret,
    ),
  );
  await ingestCakto(workspace.id, event('purchase_pending'));
  const [order] = await query('SELECT id FROM orders WHERE workspace_id=$1 AND external_id=$2', [
    workspace.id,
    externalId,
  ]);
  await assert.rejects(
    () => withConnection((c) => issueDeliveryAccess(c, workspace.id, order.id)),
    /aprovados/,
  );
  await ingestCakto(workspace.id, event('purchase_approved'));
  const approved = event('purchase_approved');
  await ingestCakto(workspace.id, approved);
  assert.equal((await ingestCakto(workspace.id, approved)).duplicate, true);
  assert.equal(
    (await query('SELECT id FROM orders WHERE workspace_id=$1', [workspace.id])).length,
    1,
  );
  assert.equal(
    (await query("SELECT id FROM jobs WHERE workspace_id=$1 AND kind='capi'", [workspace.id]))
      .length,
    1,
  );
  const link = await withConnection((c) => issueDeliveryAccess(c, workspace.id, order.id));
  const grant = new URLSearchParams(new URL(link.url).hash.slice(1)).get('acesso')!;
  const [stored] = await query('SELECT * FROM delivery_access WHERE order_id=$1', [order.id]);
  assert.equal(stored.grant_hash, sha256(grant));
  assert(!JSON.stringify(stored).includes(grant));
  assert.equal(await withConnection((c) => redeemDeliveryAccess(c, randomToken())), null);
  assert.equal(await withConnection((c) => checkDeliveryAccess(c, randomToken())), null);
  const redemptions = await Promise.all(
    Array.from({ length: 4 }, () => withConnection((c) => redeemDeliveryAccess(c, grant))),
  );
  assert.equal(redemptions.filter(Boolean).length, 1);
  const session = redemptions.find(Boolean)!.session;
  assert.equal(
    (await withConnection((c) => redeemDeliveryAccess(c, grant, session)))?.session,
    session,
  );
  assert.equal(await withConnection((c) => redeemDeliveryAccess(c, grant, randomToken())), null);
  assert.equal((await withConnection((c) => checkDeliveryAccess(c, session)))?.status, 'approved');
  assert.equal((await withConnection((c) => checkDeliveryAccess(c, session)))?.status, 'approved');
  assert.equal(
    await withConnection((c) => recordDeliveryEvent(c, session, 'download_completed')),
    true,
  );
  const [persisted] = await query('SELECT * FROM delivery_access WHERE order_id=$1', [order.id]);
  assert.equal(persisted.session_hash, sha256(session));
  assert(!JSON.stringify(persisted).includes(session));
  process.env.DELIVERY_WORKSPACE_PUBLIC_KEY = randomToken();
  assert.equal(await withConnection((c) => checkDeliveryAccess(c, session)), null);
  await assert.rejects(
    () => withConnection((c) => issueDeliveryAccess(c, workspace.id, order.id)),
    /disponível/,
  );
  process.env.DELIVERY_WORKSPACE_PUBLIC_KEY = publicKey;
  const expired = await withConnection((c) => issueDeliveryAccess(c, workspace.id, order.id));
  const expiredGrant = new URLSearchParams(new URL(expired.url).hash.slice(1)).get('acesso')!;
  await query(
    "UPDATE delivery_access SET grant_expires_at=now()-interval '1 second' WHERE grant_hash=$1",
    [sha256(expiredGrant)],
  );
  assert.equal(await withConnection((c) => redeemDeliveryAccess(c, expiredGrant)), null);
  await query(
    "UPDATE delivery_access SET session_expires_at=now()-interval '1 second' WHERE session_hash=$1",
    [sha256(session)],
  );
  assert.equal(await withConnection((c) => checkDeliveryAccess(c, session)), null);
  await query(
    "UPDATE delivery_access SET session_expires_at=now()+interval '1 day' WHERE session_hash=$1",
    [sha256(session)],
  );
  await ingestCakto(workspace.id, event('purchase_refunded'));
  await ingestCakto(workspace.id, event('purchase_approved'));
  assert.equal(await withConnection((c) => checkDeliveryAccess(c, session)), null);
  assert.equal(
    await withConnection((c) => recordDeliveryEvent(c, session, 'download_started')),
    false,
  );
  await assert.rejects(
    () => withConnection((c) => issueDeliveryAccess(c, workspace.id, order.id)),
    /aprovados/,
  );
  await query("UPDATE orders SET status='approved',product='Outro produto' WHERE id=$1", [
    order.id,
  ]);
  await assert.rejects(
    () => withConnection((c) => issueDeliveryAccess(c, workspace.id, order.id)),
    /outro produto/,
  );
  assert.equal(await withConnection((c) => checkDeliveryAccess(c, session)), null);
  assert.throws(
    () => requireDeliveryService(new Request('https://internal.invalid')),
    /autorizado/,
  );
  assert.doesNotThrow(() =>
    requireDeliveryService(
      new Request('https://internal.invalid', {
        headers: { Authorization: `Bearer ${process.env.DELIVERY_SERVICE_SECRET}` },
      }),
    ),
  );
});
