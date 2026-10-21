import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
import type { Workspace } from '../src/lib/auth';
import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
const { db, query } = await import('../src/lib/db');
const { encrypt, randomToken } = await import('../src/lib/security');
const { normalizeCakto } = await import('../src/lib/cakto');
const { ingestCakto } = await import('../src/lib/orders');
const { dashboard } = await import('../src/lib/dashboard');
const { runJobs } = await import('../src/lib/jobs');
const { rateLimit } = await import('../src/lib/http');
const { verifyRelaySignature } = await import('../src/lib/signature');
const ids: string[] = [];
after(async () => {
  for (const id of ids) await query('DELETE FROM users WHERE id=$1', [id]);
  await db.end();
});
async function workspace() {
  const [u] = await query('INSERT INTO users(email,name) VALUES($1,$2) RETURNING id', [
    `test-${crypto.randomUUID()}@example.com`,
    'Test User',
  ]);
  ids.push(u.id);
  const [w] = await query<Workspace>(
    'INSERT INTO workspaces(user_id,public_key) VALUES($1,$2) RETURNING *',
    [u.id, randomToken()],
  );
  return w;
}
const secret = 'integration-test-secret';
function event(id: string, status = 'purchase_approved', extra: Record<string, unknown> = {}) {
  return normalizeCakto(
    {
      secret,
      event: status,
      data: {
        id,
        amount: 197,
        createdAt: new Date().toISOString(),
        customer: { email: 'test@example.com' },
        product: { name: 'Test Product' },
        utm_campaign: '100',
        utm_term: '200',
        utm_content: '300',
        ...extra,
      },
    },
    secret,
  )!;
}
test('PostgreSQL: idempotent lifecycle, attribution, metrics, isolation and job retries', async (t) => {
  const w = await workspace(),
    other = await workspace();
  await query(
    "INSERT INTO campaigns(workspace_id,account_id,external_id,name,status) VALUES($1,'act_1','100','Campaign','ACTIVE')",
    [w.id],
  );
  await query(
    "INSERT INTO adsets(workspace_id,external_id,campaign_id,name,status) VALUES($1,'200','100','Adset','ACTIVE')",
    [w.id],
  );
  await query(
    "INSERT INTO ads(workspace_id,external_id,adset_id,campaign_id,name,status) VALUES($1,'300','200','100','Ad','ACTIVE')",
    [w.id],
  );
  await t.test('concurrent duplicate deliveries create one order and one CAPI job', async () => {
    const e = event('concurrent');
    await Promise.all(Array.from({ length: 8 }, () => ingestCakto(w.id, e)));
    assert.equal((await query('SELECT * FROM orders WHERE workspace_id=$1', [w.id])).length, 1);
    assert.equal((await query('SELECT * FROM jobs WHERE workspace_id=$1', [w.id])).length, 1);
    const [order] = await query('SELECT * FROM orders WHERE workspace_id=$1', [w.id]);
    assert.equal(order.attribution, 'utm');
    assert.equal(order.ad_id, '300');
  });
  await t.test('known click supplies IDs; foreign workspace click cannot be used', async () => {
    const click = crypto.randomUUID();
    await query(
      "INSERT INTO clicks(id,workspace_id,campaign_id,adset_id,ad_id,landing_url) VALUES($1,$2,'100','200','300','https://example.com')",
      [click, w.id],
    );
    await ingestCakto(
      w.id,
      event('click', 'purchase_approved', {
        utm_campaign: undefined,
        utm_term: undefined,
        utm_content: undefined,
        metadata: { mt_click: click },
      }),
    );
    const [o] = await query("SELECT * FROM orders WHERE workspace_id=$1 AND external_id='click'", [
      w.id,
    ]);
    assert.equal(o.attribution, 'click');
    await ingestCakto(
      other.id,
      event('foreign', 'purchase_approved', { metadata: { mt_click: click } }),
    );
    const [foreign] = await query('SELECT * FROM orders WHERE workspace_id=$1', [other.id]);
    assert.equal(foreign.attribution, 'unattributed');
    assert.equal(foreign.campaign_id, null);
  });
  await t.test(
    'pending cannot regress approval; refunds win even if provider repeats original creation date',
    async () => {
      await ingestCakto(w.id, event('concurrent', 'purchase_pending'));
      assert.equal(
        (
          await query(
            "SELECT status FROM orders WHERE workspace_id=$1 AND external_id='concurrent'",
            [w.id],
          )
        )[0].status,
        'approved',
      );
      await ingestCakto(
        w.id,
        event('concurrent', 'purchase_refunded', { createdAt: '2020-01-01T00:00:00Z' }),
      );
      assert.equal(
        (
          await query(
            "SELECT status FROM orders WHERE workspace_id=$1 AND external_id='concurrent'",
            [w.id],
          )
        )[0].status,
        'refunded',
      );
      await ingestCakto(w.id, event('concurrent'));
      assert.equal(
        (
          await query(
            "SELECT status FROM orders WHERE workspace_id=$1 AND external_id='concurrent'",
            [w.id],
          )
        )[0].status,
        'refunded',
      );
    },
  );
  await t.test(
    'dashboard reconciles approved orders and zero-division metrics; filters isolate workspaces',
    async () => {
      const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      await query(
        "INSERT INTO ad_insights(workspace_id,ad_id,adset_id,campaign_id,day,spend,clicks,impressions,landing_page_views) VALUES($1,'300','200','100',$2,5000,100,1000,72)",
        [w.id, day],
      );
      const data = await dashboard(
        { ...w, user_name: 'Test', email: 'test@example.com' },
        { start: day, end: day },
      );
      assert.equal(data.summary.revenue, 19700);
      assert.equal(data.summary.spend, 5000);
      assert.equal(data.summary.pageviews, 72);
      assert.equal(data.summary.roas, 3.94);
      assert.equal(data.summary.sales, 1);
      assert.equal(data.campaigns[0].revenue, 19700);
      assert(!data.sales.some((s) => s.externalId === 'foreign'));
      const empty = await dashboard(
        { ...other, user_name: 'Other', email: 'other@example.com' },
        { start: day, end: day, campaign: '100' },
      );
      assert.equal(empty.summary.sales, 0);
      assert.equal(empty.summary.roas, 0);
      assert.equal(empty.summary.pageviews, 0);
    },
  );
  await t.test(
    'Cakto financial receipts remain idempotent and refunds exclude net proceeds',
    async () => {
      const fw = await workspace();
      const e = event('financial', 'purchase_approved', {
        fees: 10,
        commissions: [{ user: 'owner@example.com', type: 'producer', totalAmount: 150 }],
      });
      await ingestCakto(fw.id, e);
      await ingestCakto(fw.id, e);
      const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const filters = { start: day, end: day };
      const identity = {
        ...fw,
        user_name: 'Owner',
        email: 'owner@example.com',
        cakto_account_email: 'owner@example.com',
      };
      const data = await dashboard(identity, filters);
      assert.equal(data.financials?.gross, 19700);
      assert.equal(data.financials?.net, 15000);
      assert.equal(data.financials?.fees, 1000);
      assert.equal(data.financials?.netEstimated, false);
      assert.equal(data.summary.profit, 15000);
      await ingestCakto(fw.id, event('financial', 'purchase_refunded'));
      const refund = await dashboard(identity, filters);
      assert.equal(refund.financials?.gross, 19700);
      assert.equal(refund.financials?.net, 0);
      assert.equal(refund.financials?.refunded, 19700);
      const [row] = await query(
        'SELECT provider_fees,commission_breakdown FROM orders WHERE workspace_id=$1',
        [fw.id],
      );
      assert.equal(Number(row.provider_fees), 1000);
      assert(!JSON.stringify(row.commission_breakdown).includes('owner@example.com'));
      // Keep this independent fixture from the worker-delivery tests below.
      await query('DELETE FROM jobs WHERE workspace_id=$1', [fw.id]);
    },
  );
  await t.test('unconfigured CAPI is retried and never marked delivered', async () => {
    await runJobs(5);
    const jobs = await query('SELECT status,attempts,last_error FROM jobs WHERE workspace_id=$1', [
      w.id,
    ]);
    assert(jobs.every((j) => j.status === 'pending' && j.attempts === 1));
    assert(jobs.every((j) => j.last_error.includes('CAPI não configurada')));
  });
  await t.test('CAPI marks delivered only after an acknowledged provider response', async () => {
    const capiWorkspace = await workspace();
    await query('UPDATE workspaces SET pixel_id=$2,capi_token=$3 WHERE id=$1', [
      capiWorkspace.id,
      '1234567890',
      encrypt('unit-test-capi-token'),
    ]);
    await query(
      "INSERT INTO jobs(workspace_id,kind,dedupe_key,payload) VALUES($1,'capi','acknowledged',$2)",
      [
        capiWorkspace.id,
        JSON.stringify({
          event_name: 'Purchase',
          event_id: 'acknowledged',
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'website',
          event_source_url: 'https://example.com',
          user_data: { fbp: 'fb.1.123.456', client_user_agent: 'test-browser' },
          custom_data: { value: 197, currency: 'BRL' },
        }),
      ],
    );
    const fn = mock.method(globalThis, 'fetch', async () => Response.json({ events_received: 1 }));
    try {
      await runJobs(1);
      const [job] = await query('SELECT status FROM jobs WHERE workspace_id=$1', [
        capiWorkspace.id,
      ]);
      assert.equal(job.status, 'completed');
      assert.equal(fn.mock.callCount(), 1);
    } finally {
      fn.mock.restore();
    }
    await query(
      "INSERT INTO jobs(workspace_id,kind,dedupe_key,payload) VALUES($1,'capi','unacknowledged',$2)",
      [
        capiWorkspace.id,
        JSON.stringify({
          event_name: 'Purchase',
          event_id: 'unacknowledged',
          action_source: 'website',
          event_source_url: 'https://example.com',
          user_data: { fbp: 'fb.1.123.456', client_user_agent: 'test-browser' },
        }),
      ],
    );
    const denied = mock.method(globalThis, 'fetch', async () =>
      Response.json({ events_received: 0 }),
    );
    try {
      await runJobs(1);
      const [job] = await query(
        "SELECT status,last_error FROM jobs WHERE workspace_id=$1 AND dedupe_key='unacknowledged'",
        [capiWorkspace.id],
      );
      assert.equal(job.status, 'pending');
      assert.match(job.last_error, /não confirmou/);
    } finally {
      denied.mock.restore();
    }
  });
  await t.test('DB rate limit blocks beyond threshold', async () => {
    const key = 'test:' + crypto.randomUUID();
    await rateLimit(key, 2, 60);
    await rateLimit(key, 2, 60);
    await assert.rejects(() => rateLimit(key, 2, 60));
    await query('DELETE FROM rate_limits WHERE key=$1', [key]);
  });
});
const base = process.env.TEST_BASE_URL;
test(
  'HTTP: sessions, CSRF, webhook authentication, CORS and tenant boundaries',
  { skip: !base },
  async () => {
    async function call(path: string, body?: unknown, cookie?: string, origin = base!) {
      return fetch(base + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          ...(body ? { 'Content-Type': 'application/json', origin } : {}),
          ...(cookie ? { cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    }
    assert.equal((await call('/api/dashboard?start=2026-01-01&end=2026-01-02')).status, 401);
    const email = `http-${crypto.randomUUID()}@example.com`,
      password = 'integration-password-123';
    const reg = await call('/api/auth/register', { name: 'HTTP User', email, password });
    assert.equal(reg.status, 200);
    const cookie = reg.headers.get('set-cookie')!.split(';')[0];
    const [u] = await query('SELECT id FROM users WHERE email=$1', [email]);
    ids.push(u.id);
    assert.equal((await call('/api/integrations', {}, cookie, 'https://evil.example')).status, 403);
    assert.equal((await call('/api/auth/login', { email, password: 'wrong' })).status, 401);
    assert.equal((await call('/api/auth/login', { email, password })).status, 200);
    const save = await call(
      '/api/integrations',
      { caktoSecret: secret, allowedOrigins: ['https://store.example'] },
      cookie,
    );
    assert.equal(save.status, 200);
    const integration = await (await call('/api/integrations', undefined, cookie)).json();
    assert(!JSON.stringify(integration).includes(secret));
    const costs = {
      salesTaxBps: 600,
      feeBps: 500,
      adTaxBps: 1000,
      productCost: 1000,
      dailyExpenses: 500,
    };
    assert.equal(
      (await call('/api/settings', { name: 'Updated Test Workspace', costs }, cookie)).status,
      200,
    );
    const settings = await (await call('/api/settings', undefined, cookie)).json();
    assert.deepEqual(settings.costs, costs);
    assert.equal(settings.name, 'Updated Test Workspace');
    const webhook = `/api/webhooks/cakto/${integration.publicKey}`;
    const payload = {
      secret,
      event: 'purchase_approved',
      data: {
        id: 'http-order',
        amount: 297,
        createdAt: new Date().toISOString(),
        product: { name: 'HTTP Product' },
      },
    };
    assert.equal((await call(webhook, { ...payload, secret: 'wrong-secret' })).status, 401);
    assert.equal((await call(webhook, payload)).status, 200);
    assert.equal((await (await call(webhook, payload)).json()).duplicate, true);
    const eventId = crypto.randomUUID(),
      clickId = crypto.randomUUID();
    const pixel = {
      key: integration.publicKey,
      consent: true,
      event: 'PageView',
      eventId,
      clickId,
      url: 'https://store.example/offer?email=do-not-store@example.com',
    };
    assert.equal(
      (await call('/api/tracking', pixel, undefined, 'https://evil.example')).status,
      403,
    );
    const pixelRes = await call('/api/tracking', pixel, undefined, 'https://store.example');
    assert.equal(pixelRes.status, 200);
    assert.equal(pixelRes.headers.get('access-control-allow-origin'), 'https://store.example');
    assert.equal(
      (
        await call(
          '/api/tracking',
          { ...pixel, consent: false },
          undefined,
          'https://store.example',
        )
      ).status,
      400,
    );
    const [click] = await query('SELECT landing_url FROM clicks WHERE id=$1', [clickId]);
    assert.equal(click.landing_url, 'https://store.example/offer');
    assert.equal((await call('/api/jobs', {})).status, 401);
    await call('/api/auth/logout', {}, cookie);
    assert.equal((await call('/api/integrations', undefined, cookie)).status, 401);
  },
);
