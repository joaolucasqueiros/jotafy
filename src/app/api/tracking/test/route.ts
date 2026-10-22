import { NextResponse } from 'next/server';
import { withWorkspace } from '@/lib/auth';
import { sameOrigin, handleError, readJson } from '@/lib/http';
import { enqueueTrackingTest, trackingTestSchema } from '@/lib/tracking-tests';
import { HttpError } from '@/lib/security';

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    return await withWorkspace(async (workspace, client) => {
      const input = trackingTestSchema.parse(await readJson(request, 8192));
      const {
        rows: [limit],
      } = await client.query(
        `INSERT INTO rate_limits(key,expires_at) VALUES($1,now()+interval '1 minute')
        ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.attempts+1 END,
        expires_at=CASE WHEN rate_limits.expires_at<now() THEN EXCLUDED.expires_at ELSE rate_limits.expires_at END RETURNING attempts`,
        [`tracking-test:${workspace.id}`],
      );
      if (limit.attempts > 6)
        throw new HttpError(429, 'Aguarde um minuto para enviar mais testes.');
      return NextResponse.json(
        await enqueueTrackingTest(
          client,
          workspace,
          input,
          request.headers.get('user-agent') || 'MetaTrack test browser',
        ),
        { status: 202 },
      );
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function GET() {
  try {
    return await withWorkspace(async (workspace, client) => {
      const { rows: tests } = await client.query(
        `SELECT id,status,attempts,last_error,created_at,completed_at,payload->'event'->>'event_name' AS event,
        payload->'event'->>'event_id' AS event_id,payload->>'test_event_code' AS test_code,
        (SELECT details FROM audit_log a WHERE a.workspace_id=j.workspace_id AND a.target=j.id::text AND a.action='tracking_test_accepted' ORDER BY a.created_at DESC LIMIT 1) AS receipt
        FROM jobs j WHERE workspace_id=$1 AND kind='capi_test' ORDER BY created_at DESC LIMIT 10`,
        [workspace.id],
      );
      const { rows: events } = await client.query(
        `SELECT e.event_id,e.event_name,e.created_at,c.landing_url,j.status AS delivery_status,j.last_error
        FROM tracking_events e LEFT JOIN clicks c ON c.id=e.click_id AND c.workspace_id=e.workspace_id
        LEFT JOIN jobs j ON j.workspace_id=e.workspace_id AND j.kind='capi' AND j.dedupe_key=e.event_id
        WHERE e.workspace_id=$1 ORDER BY e.created_at DESC LIMIT 20`,
        [workspace.id],
      );
      return NextResponse.json({ tests, events }, { headers: { 'Cache-Control': 'no-store' } });
    });
  } catch (error) {
    return handleError(error);
  }
}
