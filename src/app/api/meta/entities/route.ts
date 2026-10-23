import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth';
import { query } from '@/lib/db';
import { handleError } from '@/lib/http';
import { HttpError } from '@/lib/security';
export async function GET(request: Request) {
  try {
    const w = await requireWorkspace();
    const input = z
      .object({
        level: z.enum(['adset', 'ad']),
        start: z.iso.date(),
        end: z.iso.date(),
        campaign: z.string().optional(),
      })
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    if (input.start > input.end || Date.parse(input.end) - Date.parse(input.start) > 89 * 86400000)
      throw new HttpError(400, 'Período inválido.');
    const field = input.level === 'adset' ? 'adset_id' : 'ad_id',
      table = input.level === 'adset' ? 'adsets' : 'ads';
    const values = [w.id, input.start, input.end, input.campaign || null];
    const [entities, insights, sales] = await Promise.all([
      query(
        `SELECT * FROM ${table} WHERE workspace_id=$1 AND ($2::text IS NULL OR campaign_id=$2) ORDER BY name`,
        [w.id, input.campaign || null],
      ),
      query(
        `SELECT ${field} AS id,sum(spend)::float8 AS spend,sum(clicks)::int AS clicks,sum(impressions)::int AS impressions FROM ad_insights WHERE workspace_id=$1 AND day BETWEEN $2::date AND $3::date AND ($4::text IS NULL OR campaign_id=$4) GROUP BY ${field}`,
        values,
      ),
      query(
        `SELECT ${field} AS id,count(*)::int AS sales,sum(amount)::float8 AS revenue FROM orders WHERE workspace_id=$1 AND is_test=false AND status='approved' AND (COALESCE(purchased_at,occurred_at) AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date AND ($4::text IS NULL OR campaign_id=$4) GROUP BY ${field}`,
        values,
      ),
    ]);
    return NextResponse.json(
      entities.map((e) => {
        const i = insights.find((x) => x.id === e.external_id),
          s = sales.find((x) => x.id === e.external_id);
        return {
          id: e.external_id,
          name: e.name,
          status: e.status,
          dailyBudget: e.daily_budget ? Number(e.daily_budget) : null,
          spend: i?.spend || 0,
          clicks: i?.clicks || 0,
          impressions: i?.impressions || 0,
          sales: s?.sales || 0,
          revenue: s?.revenue || 0,
          adsets: 0,
          accountId: '',
        };
      }),
    );
  } catch (e) {
    return handleError(e);
  }
}
