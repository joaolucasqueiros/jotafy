import { query, transaction } from './db';
import type { PoolClient } from 'pg';
import { decrypt } from './security';
import { syncMeta, graphRequest } from './meta';
export async function renewJobLease(
  id: string,
  attempt: number,
  client?: PoolClient,
): Promise<void> {
  if (!client) return transaction((c) => renewJobLease(id, attempt, c));
  const {
    rows: [job],
  } = await client.query('SELECT workspace_id,kind FROM jobs WHERE id=$1', [id]);
  if (job?.kind === 'meta_sync')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))', [job.workspace_id]);
  const { rowCount } = await client.query(
    "UPDATE jobs SET locked_until=clock_timestamp()+interval '2 minutes' WHERE id=$1 AND attempts=$2 AND status='running' AND locked_until>clock_timestamp() RETURNING id",
    [id, attempt],
  );
  if (!rowCount)
    throw new Error(
      'A execução perdeu o bloqueio de processamento; aguarde a retomada automática.',
    );
}
export async function scheduleSyncs() {
  const connections = await query(
    "SELECT workspace_id FROM meta_connections mc WHERE EXISTS(SELECT 1 FROM ad_accounts a WHERE a.workspace_id=mc.workspace_id AND a.selected=true) AND expires_at > now() AND (last_sync_at IS NULL OR last_sync_at < now()-interval '15 minutes')",
  );
  for (const c of connections)
    await query(
      "INSERT INTO jobs(workspace_id,kind,dedupe_key) VALUES($1,'meta_sync',$2) ON CONFLICT DO NOTHING",
      [c.workspace_id, `auto:${Math.floor(Date.now() / 900000)}`],
    );
}
export async function runJobs(
  limit = 10,
  scope: { workspaceId: string; jobId: string } | null = null,
) {
  let completed = 0,
    failed = 0;
  for (let i = 0; i < limit; i++) {
    const job = await transaction(async (c) => {
      const {
        rows: [candidate],
      } = await c.query(
        "SELECT * FROM jobs WHERE ((status='pending' AND run_at<=now()) OR (status='running' AND locked_until<now())) AND ($1::uuid IS NULL OR workspace_id=$1) AND ($2::uuid IS NULL OR id=$2) ORDER BY run_at LIMIT 1",
        [scope?.workspaceId || null, scope?.jobId || null],
      );
      if (!candidate) return null;
      // Always acquire the workspace lock before a job row lock (same order as checkpoints).
      if (candidate.kind === 'meta_sync')
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))', [
          candidate.workspace_id,
        ]);
      const {
        rows: [j],
      } = await c.query(
        "SELECT * FROM jobs WHERE id=$1 AND ((status='pending' AND run_at<=clock_timestamp()) OR (status='running' AND locked_until<clock_timestamp())) FOR UPDATE SKIP LOCKED",
        [candidate.id],
      );
      if (!j) return null;
      if (j.kind === 'meta_sync') {
        const { rowCount } = await c.query(
          "SELECT id FROM jobs WHERE workspace_id=$1 AND kind='meta_sync' AND status='running' AND locked_until>clock_timestamp() AND id<>$2 LIMIT 1",
          [j.workspace_id, j.id],
        );
        if (rowCount) return null;
      }
      await c.query(
        "UPDATE jobs SET status='running',attempts=attempts+1,locked_until=clock_timestamp()+interval '2 minutes' WHERE id=$1",
        [j.id],
      );
      return j;
    });
    if (!job) break;
    try {
      const checkpoint = (client?: PoolClient) => renewJobLease(job.id, job.attempts + 1, client);
      await checkpoint();
      if (job.kind === 'meta_sync') await syncMeta(job.workspace_id, checkpoint);
      else if (job.kind === 'capi') {
        const [w] = await query(
          'SELECT pixel_id,capi_token,test_event_code FROM workspaces WHERE id=$1',
          [job.workspace_id],
        );
        if (!w?.pixel_id || !w?.capi_token)
          throw new Error('CAPI não configurada; configure Pixel e token em Integrações.');
        if (
          !job.payload.user_data ||
          !['em', 'ph', 'fbc', 'fbp', 'external_id'].some((k) => job.payload.user_data[k])
        )
          throw new Error('Evento sem identificador de correspondência consentido.');
        if (
          job.payload.action_source === 'website' &&
          (!job.payload.event_source_url || !job.payload.user_data.client_user_agent)
        )
          throw new Error(
            'Evento website sem URL ou user agent do clique; preserve mt_click no checkout.',
          );
        const result = await graphRequest<{ events_received: number }>(
          `${w.pixel_id}/events`,
          decrypt(w.capi_token),
          {
            data: JSON.stringify([job.payload]),
            ...(w.test_event_code ? { test_event_code: w.test_event_code } : {}),
          },
          'POST',
        );
        if (result.events_received !== 1)
          throw new Error('Meta não confirmou o recebimento do evento.');
      } else throw new Error('Tipo de job desconhecido.');
      const done = await query(
        "UPDATE jobs SET status='completed',completed_at=now(),locked_until=NULL,last_error=NULL WHERE id=$1 AND attempts=$2 AND status='running' AND locked_until>clock_timestamp() RETURNING id",
        [job.id, job.attempts + 1],
      );
      if (!done.length) throw new Error('A execução perdeu o bloqueio antes da conclusão.');
      completed++;
    } catch (error) {
      const attempts = job.attempts + 1;
      const message =
        error instanceof Error
          ? error.message.replace(/EA[A-Za-z0-9_-]{20,}/g, '[redacted]').slice(0, 300)
          : 'Falha no provedor';
      await query(
        "UPDATE jobs SET status=$2,last_error=$3,locked_until=NULL,run_at=now()+$4 * interval '1 second' WHERE id=$1 AND attempts=$5 AND status='running'",
        [
          job.id,
          attempts >= 10 ? 'failed' : 'pending',
          message,
          Math.min(21600, 30 * 2 ** attempts),
          attempts,
        ],
      );
      failed++;
    }
  }
  return { completed, failed };
}
export async function cleanup() {
  await query('DELETE FROM sessions WHERE expires_at<now()');
  await query('DELETE FROM rate_limits WHERE expires_at<now()');
  await query("DELETE FROM clicks WHERE created_at<now()-interval '90 days'");
  await query("DELETE FROM tracking_events WHERE created_at<now()-interval '90 days'");
  await query("DELETE FROM webhook_receipts WHERE received_at<now()-interval '180 days'");
  // Purge hashed customer/event matching data; retain accounting fields.
  await query(
    "UPDATE orders SET customer_hash=NULL WHERE occurred_at<now()-interval '90 days' AND customer_hash IS NOT NULL",
  );
  await query(
    "UPDATE jobs SET status='failed',payload='{}',last_error='Payload expirado pela retenção de 30 dias.',locked_until=NULL WHERE status IN ('failed','pending','running') AND created_at<now()-interval '30 days' AND payload<>'{}'::jsonb",
  );
  await query(
    "UPDATE jobs SET payload='{}' WHERE status='completed' AND completed_at<now()-interval '7 days'",
  );
}
