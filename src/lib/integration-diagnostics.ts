import { query } from './db';
import type { PoolClient } from 'pg';

export type IntegrationDiagnostics = {
  pageviews: number;
  checkouts: number;
  lastTrackingAt: string | null;
  lastWebhookAt: string | null;
  approvedOrders: number;
  pendingJobs: number;
  delayedJobs: number;
  failedJobs: number;
  lastCompletedAt: string | null;
  acceptedCapi: number;
  lastCapiAt: string | null;
};

export async function integrationDiagnostics(
  workspaceId: string,
  client?: PoolClient,
): Promise<IntegrationDiagnostics> {
  const execute = client
    ? async (sql: string, params: unknown[]) => (await client.query(sql, params)).rows
    : query;
  const [[tracking], [sales], [jobs]] = await Promise.all([
    execute(
      `SELECT count(*) FILTER (WHERE event_name='PageView')::int AS pageviews,
      count(*) FILTER (WHERE event_name='InitiateCheckout')::int AS checkouts,
      max(created_at) AS last_tracking_at FROM tracking_events
      WHERE workspace_id=$1 AND created_at>=now()-interval '7 days'`,
      [workspaceId],
    ),
    execute(
      `SELECT (SELECT max(received_at) FROM webhook_receipts WHERE workspace_id=$1) AS last_webhook_at,
      (SELECT count(*)::int FROM orders WHERE workspace_id=$1 AND status='approved') AS approved_orders`,
      [workspaceId],
    ),
    execute(
      `SELECT count(*) FILTER (WHERE status IN ('pending','running'))::int AS pending_jobs,
      count(*) FILTER (WHERE (status='pending' AND run_at<now()-interval '30 minutes') OR
        (status='running' AND locked_until<now()-interval '30 minutes'))::int AS delayed_jobs,
      count(*) FILTER (WHERE status='failed')::int AS failed_jobs,
      max(completed_at) AS last_completed_at,
      count(*) FILTER (WHERE kind='capi' AND status='completed' AND completed_at>=now()-interval '7 days')::int AS accepted_capi,
      max(completed_at) FILTER (WHERE kind='capi' AND status='completed') AS last_capi_at
      FROM jobs WHERE workspace_id=$1`,
      [workspaceId],
    ),
  ]);
  const iso = (date: unknown) => (date ? new Date(date as string).toISOString() : null);
  return {
    pageviews: tracking.pageviews,
    checkouts: tracking.checkouts,
    lastTrackingAt: iso(tracking.last_tracking_at),
    lastWebhookAt: iso(sales.last_webhook_at),
    approvedOrders: sales.approved_orders,
    pendingJobs: jobs.pending_jobs,
    delayedJobs: jobs.delayed_jobs,
    failedJobs: jobs.failed_jobs,
    lastCompletedAt: iso(jobs.last_completed_at),
    acceptedCapi: jobs.accepted_capi,
    lastCapiAt: iso(jobs.last_capi_at),
  };
}
