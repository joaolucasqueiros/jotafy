import { transaction } from './db';
import { HttpError } from './security';
export type TrackingInput = {
  event: string;
  eventId: string;
  clickId: string;
  sessionId?: string;
  occurredAt?: string;
  isTest: boolean;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  utm_source?: string;
  utm_medium?: string;
  fbc?: string;
  fbp?: string;
};
export async function ingestTracking(
  workspaceId: string,
  input: TrackingInput,
  url: string,
  userAgent: string,
) {
  const receivedAt = new Date();
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : null;
  if (
    occurredAt &&
    (!Number.isFinite(occurredAt.getTime()) ||
      occurredAt.getTime() > receivedAt.getTime() + 300000 ||
      occurredAt.getTime() < receivedAt.getTime() - 7 * 86400000)
  )
    throw new HttpError(
      400,
      'Horário do evento fora do intervalo permitido (7 dias / 5 minutos futuros).',
    );
  const result = await transaction(async (db) => {
    await db.query(
      `INSERT INTO clicks(id,workspace_id,campaign_id,adset_id,ad_id,utm_source,utm_medium,utm_campaign,utm_content,utm_term,fbc,fbp,landing_url,user_agent)
       VALUES($1,$2,$3,$4,$5,$6,$7,$3,$5,$4,$8,$9,$10,$11) ON CONFLICT(id) DO NOTHING`,
      [
        input.clickId,
        workspaceId,
        input.utm_campaign || null,
        input.utm_term || null,
        input.utm_content || null,
        input.utm_source || null,
        input.utm_medium || null,
        input.fbc || null,
        input.fbp || null,
        url,
        userAgent,
      ],
    );
    const {
      rows: [click],
    } = await db.query('SELECT * FROM clicks WHERE id=$1 AND workspace_id=$2', [
      input.clickId,
      workspaceId,
    ]);
    if (!click) throw new HttpError(400, 'Identificador de clique inválido.');
    const {
      rows: [w],
    } = await db.query('SELECT test_event_code FROM workspaces WHERE id=$1', [workspaceId]);
    const isTest = input.isTest || !!w.test_event_code;
    const { rowCount } = await db.query(
      `INSERT INTO tracking_events(workspace_id,event_id,event_name,click_id,session_id,occurred_at,is_test,campaign_id,adset_id,ad_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(workspace_id,event_id) DO NOTHING`,
      [
        workspaceId,
        input.eventId,
        input.event,
        input.clickId,
        input.sessionId || null,
        occurredAt,
        isTest,
        click.campaign_id,
        click.adset_id,
        click.ad_id,
      ],
    );
    if (!rowCount) {
      const {
        rows: [previous],
      } = await db.query(
        'SELECT event_name,click_id,session_id,is_test FROM tracking_events WHERE workspace_id=$1 AND event_id=$2',
        [workspaceId, input.eventId],
      );
      if (
        previous.event_name !== input.event ||
        previous.click_id !== input.clickId ||
        previous.session_id !== (input.sessionId || null)
      )
        throw new HttpError(409, 'eventId já utilizado por outro evento.');
      return { duplicate: true, isTest: previous.is_test };
    }
    // Browser Purchase is never a paid order. Test events must never reach production CAPI.
    if (input.event !== 'Purchase' && (!isTest || w.test_event_code))
      await db.query(
        `INSERT INTO jobs(workspace_id,kind,dedupe_key,payload,is_test,test_event_code) VALUES($1,'capi',$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [
          workspaceId,
          input.eventId,
          JSON.stringify({
            event_name: input.event,
            event_id: input.eventId,
            event_time: Math.floor((occurredAt || receivedAt).getTime() / 1000),
            event_source_url: url,
            action_source: 'website',
            user_data: {
              client_user_agent: userAgent,
              ...(input.fbc ? { fbc: input.fbc } : {}),
              ...(input.fbp ? { fbp: input.fbp } : {}),
            },
          }),
          isTest,
          isTest ? w.test_event_code : '',
        ],
      );
    return { duplicate: false, isTest };
  });
  console.info(
    JSON.stringify({
      operation: 'tracking_ingest',
      workspaceId,
      eventId: input.eventId,
      eventName: input.event,
      sessionId: input.sessionId || null,
      source: 'browser',
      occurredAt: occurredAt?.toISOString() || null,
      receivedAt: receivedAt.toISOString(),
      status: result.duplicate ? 'duplicate' : 'accepted',
      isTest: result.isTest,
    }),
  );
  return result;
}
