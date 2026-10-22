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
const { integrationDiagnostics } = await import('../src/lib/integration-diagnostics');
const { retryJob } = await import('../src/lib/retry-job');
const { enqueueTrackingTest, trackingTestSchema } = await import('../src/lib/tracking-tests');
const { withConnection } = await import('../src/lib/db');
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

test('diagnostics and retry stay scoped and preserve conversion identity', async () => {
  const w = await workspace(),
    other = await workspace();
  const initial = await integrationDiagnostics(w.id);
  assert.equal(initial.pendingJobs, 0);
  assert.equal(initial.lastWebhookAt, null);
  await ingestCakto(w.id, event('diagnostics'));
  const [job] = await query(
    "UPDATE jobs SET status='failed',attempts=10 WHERE workspace_id=$1 RETURNING id,payload",
    [w.id],
  );
  await assert.rejects(() => retryJob(other.id, job.id), /não encontrado/);
  await retryJob(w.id, job.id);
  const [retried] = await query('SELECT payload,status,attempts FROM jobs WHERE id=$1', [job.id]);
  assert.deepEqual(retried.payload, job.payload);
  assert.equal(retried.attempts, 0);
  assert.equal(retried.status, 'pending');
  await assert.rejects(() => retryJob(w.id, job.id), /falha definitiva/);
  const state = await integrationDiagnostics(w.id);
  assert.equal(state.approvedOrders, 1);
  assert.equal(state.pendingJobs, 1);
  assert(state.lastWebhookAt);
  assert.equal((await integrationDiagnostics(other.id)).approvedOrders, 0);
  const oldPayload = { ...job.payload, event_time: Math.floor(Date.now() / 1000) - 8 * 86400 };
  await query("UPDATE jobs SET status='failed',payload=$2 WHERE id=$1", [
    job.id,
    JSON.stringify(oldPayload),
  ]);
  await assert.rejects(() => retryJob(w.id, job.id), /expirado/);
});

test('CAPI rejection retains safe Meta details and retries the same event with the Pixel token', async () => {
  const w = await workspace();
  const token = 'qa-private-capi-token';
  await query('UPDATE workspaces SET pixel_id=$2,capi_token=$3 WHERE id=$1', [
    w.id,
    '1234567890',
    encrypt(token),
  ]);
  const event = {
    event_name: 'PageView',
    event_id: crypto.randomUUID(),
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'website',
    event_source_url: 'https://store.example/',
    user_data: { fbp: 'fb.1.1234567890123.12345', client_user_agent: 'QA browser' },
  };
  const [job] = await query(
    "INSERT INTO jobs(workspace_id,kind,dedupe_key,payload) VALUES($1,'capi',$2,$3) RETURNING id",
    [w.id, event.event_id, JSON.stringify(event)],
  );
  const logs: string[] = [];
  const logger = mock.method(console, 'error', (value: string) => {
    logs.push(value);
  });
  let calls = 0;
  const provider = mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    calls++;
    assert.equal((options.headers as Record<string, string>).Authorization, `Bearer ${token}`);
    const body = new URLSearchParams(String(options.body));
    assert.equal(body.has('appsecret_proof'), false);
    assert.deepEqual(JSON.parse(body.get('data')!), [event]);
    return calls === 1
      ? Response.json(
          {
            error: {
              code: 100,
              error_subcode: 999,
              message: `Invalid parameter; access_token=${token}`,
            },
          },
          { status: 400 },
        )
      : Response.json({ events_received: 1 });
  });
  try {
    const scope = { workspaceId: w.id, jobId: job.id };
    assert.deepEqual(await runJobs(1, scope), { completed: 0, failed: 1 });
    const [failed] = await query('SELECT status,last_error,payload FROM jobs WHERE id=$1', [
      job.id,
    ]);
    assert.equal(failed.status, 'pending');
    assert.match(failed.last_error, /código 100, subcódigo 999/);
    assert.match(failed.last_error, /Invalid parameter/);
    assert(!failed.last_error.includes(token));
    assert.deepEqual(failed.payload, event);
    const log = JSON.parse(logs[0]);
    assert.equal(log.event, 'processor_job_failed');
    assert.equal(log.job_id, job.id);
    assert.equal(log.attempt, 1);
    assert.equal(log.retry_scheduled, true);
    assert(!logs[0].includes(token));
    assert(!logs[0].includes('QA browser'));
    await query('UPDATE jobs SET run_at=now() WHERE id=$1', [job.id]);
    assert.deepEqual(await runJobs(1, scope), { completed: 1, failed: 0 });
    const [delivered] = await query('SELECT status,last_error,attempts FROM jobs WHERE id=$1', [
      job.id,
    ]);
    assert.equal(delivered.status, 'completed');
    assert.equal(delivered.last_error, null);
    assert.equal(delivered.attempts, 2);
    assert.equal(calls, 2);
  } finally {
    logger.mock.restore();
    provider.mock.restore();
  }
});

test('simulated events require test mode, isolate metrics and retain the Meta receipt', async () => {
  const raw = await workspace();
  const w = {
    ...raw,
    pixel_id: '1234567890',
    capi_token: encrypt('qa-test-token'),
    allowed_origins: ['https://store.example'],
  };
  await query('UPDATE workspaces SET pixel_id=$2,capi_token=$3,allowed_origins=$4 WHERE id=$1', [
    w.id,
    w.pixel_id,
    w.capi_token,
    w.allowed_origins,
  ]);
  const enqueue = (event: string) =>
    withConnection((client) =>
      enqueueTrackingTest(
        client,
        w,
        trackingTestSchema.parse({
          event,
          testEventCode: 'TEST12345',
          url: 'https://store.example/offer?email=do-not-send',
          consent: true,
        }),
        'QA browser',
      ),
    );
  const pageView = await enqueue('PageView');
  const purchase = await enqueue('Purchase');
  const requests: URLSearchParams[] = [];
  const accepted = mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    requests.push(new URLSearchParams(String(options.body)));
    return Response.json({ events_received: 1, fbtrace_id: 'qa_meta_trace' });
  });
  try {
    for (const testJob of [pageView, purchase])
      assert.equal((await runJobs(1, { workspaceId: w.id, jobId: testJob.jobId })).completed, 1);
  } finally {
    accepted.mock.restore();
  }
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.has('appsecret_proof'), false);
    assert.equal(request.get('test_event_code'), 'TEST12345');
    const event = JSON.parse(request.get('data')!)[0];
    assert.match(event.event_id, /^test:/);
    assert.equal(event.event_source_url, 'https://store.example/offer');
    assert.equal(event.user_data.external_id[0].length, 64);
  }
  const [receipt] = await query(
    "SELECT details FROM audit_log WHERE workspace_id=$1 AND target=$2 AND action='tracking_test_accepted'",
    [w.id, purchase.jobId],
  );
  assert.deepEqual(receipt.details, { events_received: 1, fbtrace_id: 'qa_meta_trace' });
  const stats = await integrationDiagnostics(w.id);
  assert.equal(stats.pageviews, 0);
  assert.equal(stats.checkouts, 0);
  assert.equal(stats.approvedOrders, 0);
  assert.equal(stats.acceptedCapi, 0);
  const content = await enqueue('ViewContent');
  const refused = mock.method(globalThis, 'fetch', async () =>
    Response.json({ events_received: 0 }),
  );
  try {
    assert.equal((await runJobs(1, { workspaceId: w.id, jobId: content.jobId })).failed, 1);
  } finally {
    refused.mock.restore();
  }
  assert.equal(
    (
      await query(
        "SELECT * FROM audit_log WHERE workspace_id=$1 AND target=$2 AND action='tracking_test_accepted'",
        [w.id, content.jobId],
      )
    ).length,
    0,
  );
  const checkout = await enqueue('InitiateCheckout');
  await query("UPDATE jobs SET payload=payload-'test_event_code' WHERE id=$1", [checkout.jobId]);
  const forbidden = mock.method(globalThis, 'fetch', async () => {
    throw new Error('test must not reach Meta without code');
  });
  try {
    await runJobs(1, { workspaceId: w.id, jobId: checkout.jobId });
    assert.equal(forbidden.mock.callCount(), 0);
  } finally {
    forbidden.mock.restore();
  }
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
      { caktoSecret: secret, allowedOrigins: ['store.example/', 'https://store.example'] },
      cookie,
    );
    assert.equal(save.status, 200);
    const integration = await (await call('/api/integrations', undefined, cookie)).json();
    assert(!JSON.stringify(integration).includes(secret));
    assert.deepEqual(integration.allowedOrigins, ['https://store.example']);
    const capiToken = 'qa-capi-token-' + 'x'.repeat(4000);
    const savePixel = await call(
      '/api/integrations',
      { pixelId: '1309619167932261', capiToken },
      cookie,
    );
    assert.equal(savePixel.status, 200);
    const configured = await (await call('/api/integrations', undefined, cookie)).json();
    assert.equal(configured.pixelId, '1309619167932261');
    assert.equal(configured.capiConfigured, true);
    assert(!JSON.stringify(configured).includes(capiToken));
    const [savedWorkspace] = await query('SELECT capi_token FROM workspaces WHERE user_id=$1', [
      u.id,
    ]);
    const { decrypt } = await import('../src/lib/security');
    assert.equal(decrypt(savedWorkspace.capi_token), capiToken);
    assert.notEqual(savedWorkspace.capi_token, capiToken);
    assert.equal(integration.diagnostics.pageviews, 0);
    assert.equal(
      (await call('/api/integrations', { allowedOrigins: ['https://store.example/path'] }, cookie))
        .status,
      400,
    );
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
    const checkoutEvent = {
      ...pixel,
      event: 'InitiateCheckout',
      eventId: crypto.randomUUID(),
      fbp: 'fb.1.1234567890123.12345',
    };
    assert.equal(
      (await call('/api/tracking', checkoutEvent, undefined, 'https://store.example')).status,
      200,
    );
    assert.equal(
      (await call('/api/tracking', checkoutEvent, undefined, 'https://store.example')).status,
      200,
    );
    const diagnostic = await (await call('/api/integrations', undefined, cookie)).json();
    assert.equal(diagnostic.diagnostics.pageviews, 1);
    assert.equal(diagnostic.diagnostics.checkouts, 1);
    assert.equal(diagnostic.diagnostics.approvedOrders, 1);
    assert(diagnostic.diagnostics.lastWebhookAt);
    assert.equal(diagnostic.diagnostics.acceptedCapi, 0);
    const testInput = {
      event: 'Purchase',
      testEventCode: 'TEST12345',
      url: 'https://store.example/offer',
      consent: true,
    };
    assert.equal(
      (await call('/api/tracking/test', testInput, cookie, 'https://evil.example')).status,
      403,
    );
    assert.equal(
      (await call('/api/tracking/test', { ...testInput, testEventCode: '' }, cookie)).status,
      400,
    );
    const testResponse = await call('/api/tracking/test', testInput, cookie);
    assert.equal(testResponse.status, 202);
    const testResult = await testResponse.json();
    const monitoring = await (await call('/api/tracking/test', undefined, cookie)).json();
    assert.equal(monitoring.tests.length, 1);
    assert.equal(monitoring.tests[0].id, testResult.jobId);
    assert.equal(monitoring.tests[0].status, 'pending');
    assert(monitoring.events.some((e: { event_name: string }) => e.event_name === 'PageView'));
    assert.equal((await integrationDiagnostics(httpWorkspace.id)).approvedOrders, 1);
    const { consent: _consent, ...automatic } = pixel;
    assert.equal(
      (
        await call(
          '/api/tracking',
          { ...automatic, collectionMode: 'automatic', eventId: crypto.randomUUID() },
          undefined,
          'https://store.example',
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          '/api/tracking',
          {
            ...automatic,
            consent: false,
            collectionMode: 'automatic',
            eventId: crypto.randomUUID(),
          },
          undefined,
          'https://store.example',
        )
      ).status,
      400,
    );
    const [failedJob] = await query(
      "UPDATE jobs SET status='failed' WHERE workspace_id=$1 AND kind='capi' RETURNING id,payload",
      [httpWorkspace.id],
    );
    const retryPath = `/api/jobs/${failedJob.id}/retry`;
    assert.equal((await call(retryPath, {}, cookie, 'https://evil.example')).status, 403);
    assert.equal((await call(retryPath, {}, cookie)).status, 200);
    assert.equal((await call(retryPath, {}, cookie)).status, 409);
    const [retriedJob] = await query('SELECT payload,status,attempts FROM jobs WHERE id=$1', [
      failedJob.id,
    ]);
    assert.equal(retriedJob.status, 'pending');
    assert.deepEqual(retriedJob.payload, failedJob.payload);
    const [click] = await query('SELECT landing_url FROM clicks WHERE id=$1', [clickId]);
    assert.equal(click.landing_url, 'https://store.example/offer');
    assert.equal((await call('/api/jobs', {})).status, 401);
    await call('/api/auth/logout', {}, cookie);
    assert.equal((await call('/api/integrations', undefined, cookie)).status, 401);
  },
);
