import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
import type { Workspace } from '../src/lib/auth';
import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
const { db, query } = await import('../src/lib/db');
const { encrypt, randomToken } = await import('../src/lib/security');
const { normalizeCakto } = await import('../src/lib/cakto');
const { ingestCakto } = await import('../src/lib/orders');
const { ingestTracking } = await import('../src/lib/tracking');
const { dashboard } = await import('../src/lib/dashboard');
const { runJobs, renewJobLease } = await import('../src/lib/jobs');
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
    "INSERT INTO ad_accounts(workspace_id,external_id,name,currency,timezone,selected) VALUES($1,'act_1','Account','BRL','America/Sao_Paulo',true)",
    [w.id],
  );
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
  await t.test(
    'scoped Meta job refreshes link clicks and landing views without processing other workspaces',
    async () => {
      const sw = await workspace(),
        foreign = await workspace();
      await query(
        "INSERT INTO ad_accounts(workspace_id,external_id,name,currency,timezone,selected) VALUES($1,'act_123','Account','BRL','America/Sao_Paulo',true)",
        [sw.id],
      );
      await query(
        "INSERT INTO meta_connections(workspace_id,meta_user_id,token,expires_at) VALUES($1,'meta-user',$2,now()+interval '1 day')",
        [sw.id, encrypt('sync-test-token')],
      );
      const [foreignJob] = await query(
        "INSERT INTO jobs(workspace_id,kind,dedupe_key) VALUES($1,'capi','foreign') RETURNING id",
        [foreign.id],
      );
      let linkClicks = 11,
        visits = 8;
      const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const fetchMock = mock.method(globalThis, 'fetch', async (input: URL | Request | string) => {
        const url = new URL(String(input));
        assert.equal(url.hostname, 'graph.facebook.com');
        if (url.pathname.endsWith('/campaigns'))
          return Response.json({ data: [{ id: '997', name: 'Campaign', status: 'ACTIVE' }] });
        if (url.pathname.endsWith('/adsets'))
          return Response.json({
            data: [{ id: '998', campaign_id: '997', name: 'Adset', status: 'ACTIVE' }],
          });
        if (url.pathname.endsWith('/ads'))
          return Response.json({
            data: [
              { id: '999', campaign_id: '997', adset_id: '998', name: 'Ad', status: 'ACTIVE' },
            ],
          });
        assert(url.pathname.endsWith('/insights'));
        assert(url.searchParams.get('fields')!.includes('inline_link_clicks'));
        assert(url.searchParams.get('fields')!.includes('actions'));
        assert.equal(url.searchParams.get('action_report_time'), 'impression');
        assert.equal(url.searchParams.get('use_unified_attribution_setting'), 'true');
        assert.equal(JSON.parse(url.searchParams.get('time_range')!).until, day);
        return Response.json({
          data: [
            {
              ad_id: '999',
              adset_id: '998',
              campaign_id: '997',
              date_start: day,
              spend: '12.34',
              inline_link_clicks: String(linkClicks),
              impressions: '100',
              actions: [{ action_type: 'landing_page_view', value: String(visits) }],
            },
          ],
        });
      });
      try {
        for (let i = 0; i < 2; i++) {
          const [job] = await query(
            "INSERT INTO jobs(workspace_id,kind,dedupe_key) VALUES($1,'meta_sync',$2) RETURNING id",
            [sw.id, `scoped-${i}`],
          );
          assert.deepEqual(await runJobs(1, { workspaceId: sw.id, jobId: foreignJob.id }), {
            completed: 0,
            failed: 0,
          });
          assert.deepEqual(await runJobs(1, { workspaceId: sw.id, jobId: job.id }), {
            completed: 1,
            failed: 0,
          });
          const result = await dashboard(
            { ...sw, user_name: 'Sync', email: 'sync@example.com' },
            { start: day, end: day },
          );
          assert.equal(result.summary.clicks, linkClicks);
          assert.equal(result.summary.pageviews, visits);
          assert.equal(result.summary.spend, 1234);
          assert(result.lastSync);
          linkClicks = 14;
          visits = 10;
        }
        const [snapshot] = await query(
          'SELECT raw_actions,attribution_context FROM ad_insights WHERE workspace_id=$1',
          [sw.id],
        );
        assert.equal(snapshot.raw_actions[0].action_type, 'landing_page_view');
        assert.equal(snapshot.attribution_context.action_report_time, 'impression');
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => Response.json({ error: { code: 2 } }, { status: 503 });
        try {
          const [failedJob] = await query(
            "INSERT INTO jobs(workspace_id,kind,dedupe_key) VALUES($1,'meta_sync','provider-failure') RETURNING id",
            [sw.id],
          );
          assert.deepEqual(await runJobs(1, { workspaceId: sw.id, jobId: failedJob.id }), {
            completed: 0,
            failed: 1,
          });
          const unchanged = await dashboard(
            { ...sw, user_name: 'Sync', email: 'sync@example.com' },
            { start: day, end: day },
          );
          assert.equal(unchanged.summary.clicks, 14);
          assert.equal(unchanged.summary.pageviews, 10);
          await query('DELETE FROM jobs WHERE id=$1', [failedJob.id]);
        } finally {
          globalThis.fetch = originalFetch;
        }

        await query('UPDATE ad_accounts SET selected=false WHERE workspace_id=$1', [sw.id]);
        const hidden = await dashboard(
          { ...sw, user_name: 'Sync', email: 'sync@example.com' },
          { start: day, end: day },
        );
        assert.equal(hidden.summary.clicks, 0);
        await query('UPDATE ad_accounts SET selected=true WHERE workspace_id=$1', [sw.id]);
        assert.equal(
          (await query('SELECT status FROM jobs WHERE id=$1', [foreignJob.id]))[0].status,
          'pending',
        );
        assert.equal(
          (
            await query('SELECT count(*)::int AS count FROM ad_insights WHERE workspace_id=$1', [
              sw.id,
            ])
          )[0].count,
          1,
        );
      } finally {
        fetchMock.mock.restore();
        await query('DELETE FROM jobs WHERE workspace_id=$1', [foreign.id]);
      }
    },
  );
  await t.test(
    'leases renew only for the current owner and expired leases cannot be revived',
    async () => {
      const lw = await workspace();
      const [job] = await query(
        "INSERT INTO jobs(workspace_id,kind,dedupe_key,status,attempts,locked_until) VALUES($1,'meta_sync','lease','running',2,now()+interval '30 seconds') RETURNING id",
        [lw.id],
      );
      await assert.rejects(() => renewJobLease(job.id, 1), /perdeu o bloqueio/);
      await renewJobLease(job.id, 2);
      const [fresh] = await query(
        'SELECT EXTRACT(EPOCH FROM (locked_until-now()))::float8 AS seconds FROM jobs WHERE id=$1',
        [job.id],
      );
      assert(fresh.seconds > 110 && fresh.seconds <= 120);
      await query("UPDATE jobs SET locked_until=now()-interval '1 second' WHERE id=$1", [job.id]);
      await assert.rejects(() => renewJobLease(job.id, 2), /perdeu o bloqueio/);
      await query('DELETE FROM jobs WHERE id=$1', [job.id]);
    },
  );
  await t.test(
    'expired sync recovers, writes paginated insights in batches and fences obsolete attempts',
    async () => {
      const sw = await workspace();
      await query(
        "INSERT INTO ad_accounts(workspace_id,external_id,name,currency,timezone,selected) VALUES($1,'act_456','Bulk Account','BRL','America/Sao_Paulo',true)",
        [sw.id],
      );
      await query(
        "INSERT INTO meta_connections(workspace_id,meta_user_id,token,expires_at) VALUES($1,'bulk-user',$2,now()+interval '1 day')",
        [sw.id, encrypt('bulk-test-token')],
      );
      const [job] = await query(
        "INSERT INTO jobs(workspace_id,kind,dedupe_key,status,attempts,locked_until) VALUES($1,'meta_sync','recover','running',1,now()-interval '1 second') RETURNING id",
        [sw.id],
      );
      const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      let obsolete: string | null = null;
      const fetchMock = mock.method(globalThis, 'fetch', async (input: URL | Request | string) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/campaigns'))
          return Response.json({
            data: [
              { id: '777', name: obsolete ? 'Obsolete name' : 'Bulk campaign', status: 'ACTIVE' },
            ],
          });
        if (url.pathname.endsWith('/adsets') || url.pathname.endsWith('/ads'))
          return Response.json({ data: [] });
        assert(url.pathname.endsWith('/insights'));
        if (obsolete) {
          await query(
            "UPDATE jobs SET attempts=attempts+1,locked_until=now()+interval '2 minutes' WHERE id=$1",
            [obsolete],
          );
          return Response.json({ data: [] });
        }
        const offset = Number(url.searchParams.get('after') || '0');
        const rows = Array.from({ length: Math.min(100, 601 - offset) }, (_, index) => ({
          ad_id: `ad-${index + offset}`,
          adset_id: 'set',
          campaign_id: '777',
          date_start: day,
          spend: '1.00',
          inline_link_clicks: '11',
          impressions: '100',
          actions: [{ action_type: 'landing_page_view', value: '8' }],
        }));
        // A provider page may overlap; the batch upsert must not count a row twice.
        if (offset === 600) rows.push({ ...rows[0], ad_id: 'ad-0' });
        return Response.json({
          data: rows,
          ...(offset + 100 < 601
            ? {
                paging: {
                  next: 'https://graph.facebook.com/next',
                  cursors: { after: String(offset + 100) },
                },
              }
            : {}),
        });
      });
      try {
        assert.deepEqual(await runJobs(1, { workspaceId: sw.id, jobId: job.id }), {
          completed: 1,
          failed: 0,
        });
        const [finished] = await query('SELECT attempts,status FROM jobs WHERE id=$1', [job.id]);
        assert.equal(finished.attempts, 2);
        assert.equal(finished.status, 'completed');
        const [totals] = await query(
          'SELECT count(*)::int AS count,sum(clicks)::int AS clicks,sum(landing_page_views)::int AS visits FROM ad_insights WHERE workspace_id=$1',
          [sw.id],
        );
        assert.deepEqual(totals, { count: 601, clicks: 6611, visits: 4808 });
        const [next] = await query(
          "INSERT INTO jobs(workspace_id,kind,dedupe_key) VALUES($1,'meta_sync','obsolete') RETURNING id",
          [sw.id],
        );
        obsolete = next.id;
        assert.deepEqual(await runJobs(1, { workspaceId: sw.id, jobId: next.id }), {
          completed: 0,
          failed: 1,
        });
        const [newOwner] = await query('SELECT attempts,status,last_error FROM jobs WHERE id=$1', [
          next.id,
        ]);
        assert.equal(newOwner.attempts, 2);
        assert.equal(newOwner.status, 'running');
        assert.equal(newOwner.last_error, null);
        assert.equal(
          (await query('SELECT name FROM campaigns WHERE workspace_id=$1', [sw.id]))[0].name,
          'Bulk campaign',
        );
        await query('DELETE FROM jobs WHERE id=$1', [next.id]);
      } finally {
        fetchMock.mock.restore();
      }
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
    const [httpWorkspace] = await query('SELECT id FROM workspaces WHERE user_id=$1', [u.id]);
    // The web route must not decrypt tokens or run Graph work: even this opaque token can enqueue.
    await query(
      "INSERT INTO meta_connections(workspace_id,meta_user_id,token,expires_at) VALUES($1,'http-meta','opaque-token-only-node-may-decrypt',now()+interval '1 day')",
      [httpWorkspace.id],
    );
    const queuedResponse = await call('/api/meta/sync', {}, cookie);
    assert.equal(queuedResponse.status, 202);
    const queued = await queuedResponse.json();
    assert.equal(queued.state, 'queued');
    const again = await (await call('/api/meta/sync', {}, cookie)).json();
    assert.equal(again.jobId, queued.jobId);
    assert.equal(
      (
        await query(
          "SELECT count(*)::int AS count FROM jobs WHERE workspace_id=$1 AND kind='meta_sync'",
          [httpWorkspace.id],
        )
      )[0].count,
      1,
    );
    const progress = await (
      await call(`/api/meta/sync?jobId=${queued.jobId}`, undefined, cookie)
    ).json();
    assert.equal(progress.pending, true);
    assert.equal(progress.state, 'queued');
    const foreignWorkspace = await workspace();
    const [foreignJob] = await query(
      "INSERT INTO jobs(workspace_id,kind,dedupe_key) VALUES($1,'meta_sync','foreign-http') RETURNING id",
      [foreignWorkspace.id],
    );
    assert.equal(
      (await call(`/api/meta/sync?jobId=${foreignJob.id}`, undefined, cookie)).status,
      404,
    );
    assert.equal(
      (await call('/api/meta/sync?jobId=------------------------------------', undefined, cookie))
        .status,
      400,
    );
    await query("UPDATE jobs SET status='completed',completed_at=now() WHERE id=$1", [
      queued.jobId,
    ]);
    const done = await (
      await call(`/api/meta/sync?jobId=${queued.jobId}`, undefined, cookie)
    ).json();
    assert.equal(done.pending, false);
    assert.equal(done.state, 'completed');
    await query('DELETE FROM jobs WHERE id=$1', [foreignJob.id]);
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
    await query(
      "INSERT INTO ad_accounts(workspace_id,external_id,name,currency,timezone,selected) VALUES($1,'act_77','Audit Account','BRL','America/Sao_Paulo',true)",
      [httpWorkspace.id],
    );
    await query(
      "INSERT INTO campaigns(workspace_id,account_id,external_id,name,status) VALUES($1,'act_77','77','Audit Campaign','ACTIVE')",
      [httpWorkspace.id],
    );
    await query(
      "INSERT INTO ad_insights(workspace_id,ad_id,adset_id,campaign_id,day,raw_actions,attribution_context,synced_at) VALUES($1,'79','78','77',$2,$3,$4,now())",
      [
        httpWorkspace.id,
        new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }),
        JSON.stringify([
          { action_type: 'initiate_checkout', value: '5' },
          { action_type: 'omni_initiated_checkout', value: '5' },
        ]),
        JSON.stringify({ action_report_time: 'impression' }),
      ],
    );
    const auditPath = `/api/events/audit?start=${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })}&end=${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })}`;
    assert.equal((await call(auditPath)).status, 401);
    const auditRes = await call(auditPath, undefined, cookie);
    assert.equal(auditRes.status, 200);
    const audit = await auditRes.json();
    assert.equal(
      audit.summary.find((r: { event_name: string }) => r.event_name === 'PageView').raw_events,
      1,
    );
    assert.equal(audit.events[0].event_id, eventId);
    assert.equal(audit.metaActions.length, 2);
    assert(audit.metaActions.every((a: { value: number }) => a.value === 5));
    assert.equal(audit.metaActions[0].attribution_context.action_report_time, 'impression');
    assert(!JSON.stringify(audit).includes('do-not-store@example.com'));
    assert.equal((await call('/api/jobs', {})).status, 401);
    await call('/api/auth/logout', {}, cookie);
    assert.equal((await call('/api/integrations', undefined, cookie)).status, 401);
  },
);

test('event audit: identity, sessions, test isolation, purchase authority and timezone', async () => {
  const w = await workspace();
  await query(
    "INSERT INTO ad_accounts(workspace_id,external_id,name,currency,timezone,selected) VALUES($1,'act_audit','Audit Account','BRL','America/Sao_Paulo',true)",
    [w.id],
  );
  await query(
    "INSERT INTO campaigns(workspace_id,account_id,external_id,name,status) VALUES($1,'act_audit','123','Audit Campaign','ACTIVE')",
    [w.id],
  );
  const clickId = crypto.randomUUID(),
    sessionId = crypto.randomUUID(),
    eventId = crypto.randomUUID();
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const input = {
    event: 'InitiateCheckout',
    eventId,
    clickId,
    sessionId,
    utm_campaign: '123',
    isTest: false,
    occurredAt: `${day}T03:10:00Z`,
    fbp: 'fb.1.123.456',
  };
  const send = (data: typeof input) =>
    ingestTracking(w.id, data, 'https://example.com/offer', 'test-browser');
  const duplicate = await Promise.all([send(input), send(input)]);
  assert.equal(duplicate.filter((r) => r.duplicate).length, 1);
  let rows = await query('SELECT * FROM jobs WHERE workspace_id=$1', [w.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.event_id, eventId);
  assert.equal(rows[0].payload.event_time, Math.floor(Date.parse(input.occurredAt) / 1000));
  await assert.rejects(() => send({ ...input, event: 'PageView' }), /outro evento/);
  await send({ ...input, eventId: crypto.randomUUID() }); // second legitimate action, same session
  await send({ ...input, eventId: crypto.randomUUID(), sessionId: crypto.randomUUID() });
  await send({ ...input, event: 'PageView', eventId: crypto.randomUUID() });
  await send({ ...input, event: 'Purchase', eventId: crypto.randomUUID() });
  await send({ ...input, eventId: crypto.randomUUID(), isTest: true });
  await send({ ...input, eventId: crypto.randomUUID(), occurredAt: `${day}T02:59:00Z` }); // prior São Paulo day
  const data = await dashboard(
    { ...w, user_name: 'Audit', email: 'audit@example.com' },
    { start: day, end: day },
  );
  assert.equal(data.summary.checkouts, 3);
  assert.equal(data.summary.sales, 0);
  assert.equal(data.summary.clicks, 0);
  assert.equal(data.summary.pageviews, 0); // internal pageview != Meta insight
  const metric = data.eventMetrics!.find((e) => e.name === 'InitiateCheckout')!;
  assert.equal(metric.rawEvents, 3);
  assert.equal(metric.uniqueSessions, 2);
  assert.equal(metric.eventsWithoutSession, 0);
  assert.equal(metric.uniqueUsers, null);
  assert.equal(metric.attributedEvents, 3);
  assert.equal(
    (await query('SELECT * FROM jobs WHERE workspace_id=$1 AND dedupe_key=$2', [w.id, eventId]))
      .length,
    1,
  );
  const testId = crypto.randomUUID();
  await query("UPDATE workspaces SET test_event_code='TEST_AUDIT' WHERE id=$1", [w.id]);
  await send({ ...input, eventId: testId });
  const [job] = await query('SELECT * FROM jobs WHERE workspace_id=$1 AND dedupe_key=$2', [
    w.id,
    testId,
  ]);
  assert.equal(job.is_test, true);
  assert.equal(job.test_event_code, 'TEST_AUDIT');
  const [e] = await query('SELECT * FROM tracking_events WHERE workspace_id=$1 AND event_id=$2', [
    w.id,
    testId,
  ]);
  assert.equal(e.is_test, true);
  await query("UPDATE workspaces SET test_event_code='' WHERE id=$1", [w.id]);
  const retryAfterModeChange = await send({ ...input, eventId: testId });
  assert.equal(retryAfterModeChange.duplicate, true);
  assert.equal(retryAfterModeChange.isTest, true);
  await assert.rejects(
    () =>
      send({
        ...input,
        eventId: crypto.randomUUID(),
        occurredAt: new Date(Date.now() + 600000).toISOString(),
      }),
    /Horário/,
  );
  await query('DELETE FROM clicks WHERE id=$1', [clickId]);
  const retained = await dashboard(
    { ...w, user_name: 'Audit', email: 'audit@example.com' },
    { start: day, end: day, campaign: '123' },
  );
  assert.equal(retained.summary.checkouts, 3);
  await query('DELETE FROM jobs WHERE workspace_id=$1', [w.id]);
});

test('Cakto test orders never affect production finance; actual paid time is preserved', async () => {
  const w = await workspace();
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const test = normalizeCakto(
    {
      secret,
      event: 'purchase_approved',
      is_test: true,
      data: { id: 'sandbox', amount: 90, createdAt: `${day}T12:00:00Z` },
    },
    secret,
  )!;
  await ingestCakto(w.id, test);
  await ingestCakto(w.id, test);
  let data = await dashboard(
    { ...w, user_name: 'Audit', email: 'audit@example.com' },
    { start: day, end: day },
  );
  assert.equal(data.summary.revenue, 0);
  assert.equal(data.financials!.gross, 0);
  assert.equal(data.sales.length, 0);
  assert.equal((await query('SELECT * FROM orders WHERE workspace_id=$1', [w.id])).length, 1);
  assert.equal((await query('SELECT * FROM jobs WHERE workspace_id=$1', [w.id])).length, 0);
  const paid = normalizeCakto(
    {
      secret,
      event: 'purchase_approved',
      data: { id: 'paid', amount: 90, paidAt: `${day}T02:50:00Z`, updatedAt: `${day}T12:00:00Z` },
    },
    secret,
  )!;
  await ingestCakto(w.id, paid);
  const [order] = await query(
    "SELECT purchased_at FROM orders WHERE workspace_id=$1 AND external_id='paid'",
    [w.id],
  );
  assert.equal(order.purchased_at.toISOString(), `${day}T02:50:00.000Z`);
  data = await dashboard(
    { ...w, user_name: 'Audit', email: 'audit@example.com' },
    { start: day, end: day },
  );
  assert.equal(data.summary.sales, 0); // paid on previous local day, not on notification day
  await query('DELETE FROM jobs WHERE workspace_id=$1', [w.id]);
});

test('CAPI retries preserve browser event ID and test routing captured at ingestion', async () => {
  const w = await workspace();
  await query(
    "UPDATE workspaces SET pixel_id='1234567890',capi_token=$2,test_event_code='TEST_CAPTURED' WHERE id=$1",
    [w.id, encrypt('audit-mocked-capi-token')],
  );
  const eventId = crypto.randomUUID();
  await ingestTracking(
    w.id,
    {
      event: 'InitiateCheckout',
      eventId,
      clickId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      isTest: true,
      fbp: 'fb.1.123.456',
    },
    'https://example.com',
    'test-agent',
  );
  const [job] = await query('SELECT id FROM jobs WHERE workspace_id=$1', [w.id]);
  await query("UPDATE workspaces SET test_event_code='' WHERE id=$1", [w.id]);
  let calls = 0;
  const fn = mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
    const body = new URLSearchParams(init!.body as URLSearchParams);
    assert.equal(body.get('test_event_code'), 'TEST_CAPTURED');
    const [data] = JSON.parse(body.get('data')!);
    assert.equal(data.event_id, eventId);
    assert.equal(data.event_name, 'InitiateCheckout');
    calls++;
    return calls === 1
      ? Response.json({ error: { code: 2 } }, { status: 503 })
      : Response.json({ events_received: 1 });
  });
  try {
    assert.deepEqual(await runJobs(1, { workspaceId: w.id, jobId: job.id }), {
      completed: 0,
      failed: 1,
    });
    await query('UPDATE jobs SET run_at=now() WHERE id=$1', [job.id]);
    assert.deepEqual(await runJobs(1, { workspaceId: w.id, jobId: job.id }), {
      completed: 1,
      failed: 0,
    });
    assert.equal(calls, 2);
    assert.equal(
      (await query('SELECT * FROM tracking_events WHERE workspace_id=$1', [w.id])).length,
      1,
    );
  } finally {
    fn.mock.restore();
  }
});

test('campaign funnel excludes organic, unknown and foreign UTM checkouts without deleting evidence', async () => {
  const w = await workspace(),
    foreign = await workspace();
  await query(
    "INSERT INTO ad_accounts(workspace_id,external_id,name,currency,timezone,selected) VALUES($1,'act_utm','UTM Account','BRL','America/Sao_Paulo',true)",
    [w.id],
  );
  await query(
    "INSERT INTO campaigns(workspace_id,account_id,external_id,name,status) VALUES($1,'act_utm','utm-campaign','Campaign','ACTIVE'),($2,'act_other','foreign-campaign','Other','ACTIVE')",
    [w.id, foreign.id],
  );
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  for (const campaign of [
    'utm-campaign',
    'utm-campaign',
    'utm-campaign',
    'utm-campaign',
    'utm-campaign',
    undefined,
    'unknown-campaign',
    'foreign-campaign',
  ]) {
    await ingestTracking(
      w.id,
      {
        event: 'InitiateCheckout',
        eventId: crypto.randomUUID(),
        clickId: crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
        isTest: false,
        utm_campaign: campaign,
      },
      'https://offer.example',
      'test-agent',
    );
  }
  const identity = { ...w, user_name: 'UTM Test', email: 'utm@example.com' };
  const result = await dashboard(identity, { start: day, end: day });
  assert.equal(result.summary.checkouts, 5);
  assert.equal(result.eventMetrics!.find((e) => e.name === 'InitiateCheckout')!.uniqueSessions, 5);
  assert.equal(
    (
      await query('SELECT count(*)::int AS count FROM tracking_events WHERE workspace_id=$1', [
        w.id,
      ])
    )[0].count,
    8,
  );
  assert.equal(
    (await dashboard(identity, { start: day, end: day, campaign: 'unknown-campaign' })).summary
      .checkouts,
    0,
  );
  assert.equal(
    (await dashboard(identity, { start: day, end: day, campaign: 'utm-campaign' })).summary
      .checkouts,
    5,
  );
  await query('UPDATE ad_accounts SET selected=false WHERE workspace_id=$1', [w.id]);
  assert.equal((await dashboard(identity, { start: day, end: day })).summary.checkouts, 0);
  await query('DELETE FROM jobs WHERE workspace_id=$1', [w.id]);
});
