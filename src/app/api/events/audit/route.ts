import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth';
import { query } from '@/lib/db';
import { handleError } from '@/lib/http';
import { HttpError } from '@/lib/security';
const schema = z.object({
  start: z.iso.date(),
  end: z.iso.date(),
  campaign: z.string().max(100).optional(),
  adset: z.string().max(100).optional(),
  ad: z.string().max(100).optional(),
});
export async function GET(request: Request) {
  try {
    const w = await requireWorkspace();
    const f = schema.parse(Object.fromEntries(new URL(request.url).searchParams));
    if (f.start > f.end || Date.parse(f.end) - Date.parse(f.start) > 89 * 86400000)
      throw new HttpError(400, 'Selecione até 90 dias.');
    const values = [w.id, f.start, f.end, f.campaign || null, f.adset || null, f.ad || null];
    const filter = `e.workspace_id=$1 AND (COALESCE(e.occurred_at,e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date AND ($4::text IS NULL OR COALESCE(e.campaign_id,c.campaign_id)=$4) AND ($5::text IS NULL OR COALESCE(e.adset_id,c.adset_id)=$5) AND ($6::text IS NULL OR COALESCE(e.ad_id,c.ad_id)=$6)`;
    const [summary, events, accounts, metaActions] = await Promise.all([
      query(
        `SELECT e.event_name,e.event_source,e.is_test,count(*)::int AS raw_events,count(DISTINCT e.session_id)::int AS unique_sessions,count(*) FILTER(WHERE e.session_id IS NULL)::int AS events_without_session,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM campaigns ec WHERE ec.workspace_id=e.workspace_id AND ec.external_id=COALESCE(e.campaign_id,c.campaign_id)))::int AS attributed_events FROM tracking_events e LEFT JOIN clicks c ON c.id=e.click_id AND c.workspace_id=e.workspace_id WHERE ${filter} GROUP BY e.event_name,e.event_source,e.is_test`,
        values,
      ),
      query(
        `SELECT e.event_id,e.event_name,e.event_source,e.session_id,e.occurred_at,e.created_at AS received_at,e.is_test,COALESCE(e.campaign_id,c.campaign_id) AS campaign_id,COALESCE(e.adset_id,c.adset_id) AS adset_id,COALESCE(e.ad_id,c.ad_id) AS ad_id,j.status AS capi_status,j.attempts AS capi_attempts,CASE WHEN EXISTS(SELECT 1 FROM campaigns ec WHERE ec.workspace_id=e.workspace_id AND ec.external_id=COALESCE(e.campaign_id,c.campaign_id)) THEN 'utm_snapshot_on_click' ELSE 'unattributed' END AS attribution_source FROM tracking_events e LEFT JOIN clicks c ON c.id=e.click_id AND c.workspace_id=e.workspace_id LEFT JOIN jobs j ON j.workspace_id=e.workspace_id AND j.kind='capi' AND j.dedupe_key=e.event_id WHERE ${filter} ORDER BY COALESCE(e.occurred_at,e.created_at) DESC,e.id LIMIT 200`,
        values,
      ),
      query('SELECT external_id,timezone,selected FROM ad_accounts WHERE workspace_id=$1', [w.id]),
      query(
        `SELECT a.action_type,sum(CASE WHEN a.value ~ '^[0-9]+([.][0-9]+)?$' THEN a.value::numeric ELSE 0 END)::float8 AS value,i.attribution_context,min(i.synced_at) AS oldest_sync,max(i.synced_at) AS newest_sync FROM ad_insights i JOIN campaigns c ON c.workspace_id=i.workspace_id AND c.external_id=i.campaign_id JOIN ad_accounts ac ON ac.workspace_id=c.workspace_id AND ac.external_id=c.account_id CROSS JOIN LATERAL jsonb_to_recordset(COALESCE(i.raw_actions,'[]'::jsonb)) AS a(action_type text,value text) WHERE i.workspace_id=$1 AND ac.selected=true AND i.day BETWEEN $2::date AND $3::date AND ($4::text IS NULL OR i.campaign_id=$4) AND ($5::text IS NULL OR i.adset_id=$5) AND ($6::text IS NULL OR i.ad_id=$6) GROUP BY a.action_type,i.attribution_context`,
        values,
      ),
    ]);
    return NextResponse.json(
      {
        period: f,
        timezone: 'America/Sao_Paulo',
        summary,
        events,
        eventLimit: 200,
        accounts,
        metaActions,
        uniqueUsers: null,
        notes: [
          'raw_events conta event_ids aceitos; sessões excluem históricos sem session_id.',
          'attributed_events exige campanha conhecida por UTM/clique; não reproduz a atribuição Meta.',
          'Valores de action_types distintos podem se sobrepor: não somar checkouts/purchases de famílias diferentes.',
          'occurred_at nulo indica legado; nesse caso o período utiliza received_at.',
        ],
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return handleError(error);
  }
}
