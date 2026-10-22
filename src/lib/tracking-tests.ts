import { z } from 'zod';
import type { PoolClient } from 'pg';
import type { Workspace } from './auth';
import { HttpError, sha256 } from './security';

export const trackingTestSchema = z.object({
  event: z.enum(['PageView', 'ViewContent', 'InitiateCheckout', 'Purchase']),
  testEventCode: z
    .string()
    .trim()
    .regex(/^TEST[A-Za-z0-9_-]{1,80}$/, 'Copie o código TEST da aba Testar eventos da Meta.'),
  url: z.url().max(3000),
  consent: z.literal(true),
});

export async function enqueueTrackingTest(
  client: PoolClient,
  workspace: Workspace,
  input: z.infer<typeof trackingTestSchema>,
  userAgent: string,
) {
  if (!workspace.pixel_id || !workspace.capi_token)
    throw new HttpError(409, 'Configure Pixel e token CAPI em Integrações antes do teste.');
  const url = new URL(input.url);
  if (!workspace.allowed_origins.includes(url.origin) || url.username || url.password)
    throw new HttpError(
      400,
      'Use uma URL da página cujo domínio esteja autorizado em Integrações.',
    );
  url.search = '';
  url.hash = '';
  const eventId = `test:${crypto.randomUUID()}`;
  const event = {
    event_name: input.event,
    event_id: eventId,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'website',
    event_source_url: url.toString(),
    user_data: { client_user_agent: userAgent.slice(0, 1024), external_id: [sha256(eventId)] },
    ...(['Purchase', 'InitiateCheckout'].includes(input.event)
      ? { custom_data: { currency: 'BRL', value: 14.9, order_id: eventId } }
      : {}),
  };
  const {
    rows: [job],
  } = await client.query(
    "INSERT INTO jobs(workspace_id,kind,dedupe_key,payload) VALUES($1,'capi_test',$2,$3) RETURNING id",
    [
      workspace.id,
      eventId,
      JSON.stringify({ pixel_id: workspace.pixel_id, test_event_code: input.testEventCode, event }),
    ],
  );
  // No tracking_event, click or order: simulation never changes the real funnel or revenue.
  return { jobId: job.id, eventId, state: 'queued', mode: 'test' };
}
