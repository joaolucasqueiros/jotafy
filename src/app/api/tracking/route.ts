import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query, transaction } from '@/lib/db';
import { handleError, readJson, rateLimit } from '@/lib/http';
import { HttpError } from '@/lib/security';
const schema = z
  .object({
    key: z.string().regex(/^[a-f0-9]{64}$/),
    consent: z.boolean().optional(),
    collectionMode: z.enum(['consented', 'automatic']).default('consented'),
    event: z.enum(['PageView', 'ViewContent', 'InitiateCheckout', 'Purchase']),
    eventId: z.string().uuid(),
    clickId: z.string().uuid(),
    url: z.url().max(3000),
    utm_source: z.string().max(200).optional(),
    utm_medium: z.string().max(200).optional(),
    utm_campaign: z.string().max(100).optional(),
    utm_term: z.string().max(100).optional(),
    utm_content: z.string().max(100).optional(),
    fbc: z.string().max(500).optional(),
    fbp: z.string().max(500).optional(),
  })
  .superRefine((input, ctx) => {
    if (
      (input.collectionMode === 'consented' && input.consent !== true) ||
      input.consent === false
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['consent'],
        message: 'Rastreamento recusado ou consentimento ausente no modo consentido.',
      });
    }
  });
async function cors(request: Request, key: string) {
  const [w] = await query('SELECT id,allowed_origins FROM workspaces WHERE public_key=$1', [key]);
  const origin = request.headers.get('origin');
  if (!w || !origin || !w.allowed_origins.includes(origin))
    throw new HttpError(403, 'Origem não autorizada para o pixel.');
  return {
    workspaceId: w.id,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    },
  };
}
export async function OPTIONS(request: Request) {
  try {
    const key = new URL(request.url).searchParams.get('key') || '',
      c = await cors(request, key);
    return new NextResponse(null, { status: 204, headers: c.headers });
  } catch (e) {
    return handleError(e);
  }
}
export async function POST(request: Request) {
  try {
    const input = schema.parse(await readJson(request, 8192)),
      c = await cors(request, input.key);
    await rateLimit(`pixel:${c.workspaceId}`, 6000, 60);
    const url = new URL(input.url);
    if (url.origin !== request.headers.get('origin'))
      throw new HttpError(400, 'URL de origem inválida.');
    // Store only origin/path: query strings can contain personal data or checkout secrets.
    url.search = '';
    url.hash = '';
    await transaction(async (db) => {
      await db.query(
        `INSERT INTO clicks(id,workspace_id,campaign_id,adset_id,ad_id,utm_source,utm_medium,utm_campaign,utm_content,utm_term,fbc,fbp,landing_url,user_agent)
   VALUES($1,$2,$3,$4,$5,$6,$7,$3,$5,$4,$8,$9,$10,$11) ON CONFLICT(id) DO NOTHING`,
        [
          input.clickId,
          c.workspaceId,
          input.utm_campaign || null,
          input.utm_term || null,
          input.utm_content || null,
          input.utm_source || null,
          input.utm_medium || null,
          input.fbc || null,
          input.fbp || null,
          url.toString(),
          (request.headers.get('user-agent') || '').slice(0, 1024),
        ],
      );
      const {
        rows: [click],
      } = await db.query('SELECT id FROM clicks WHERE id=$1 AND workspace_id=$2', [
        input.clickId,
        c.workspaceId,
      ]);
      if (!click) throw new HttpError(400, 'Identificador de clique inválido.');
      const { rowCount } = await db.query(
        'INSERT INTO tracking_events(workspace_id,event_id,event_name,click_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [c.workspaceId, input.eventId, input.event, input.clickId],
      );
      // Purchase is authoritative only after a provider confirms payment. Never count a browser event as a sale.
      if (rowCount && input.event !== 'Purchase')
        await db.query(
          "INSERT INTO jobs(workspace_id,kind,dedupe_key,payload) VALUES($1,'capi',$2,$3) ON CONFLICT DO NOTHING",
          [
            c.workspaceId,
            input.eventId,
            JSON.stringify({
              event_name: input.event,
              event_id: input.eventId,
              event_time: Math.floor(Date.now() / 1000),
              event_source_url: url.toString(),
              action_source: 'website',
              user_data: {
                client_user_agent: (request.headers.get('user-agent') || '').slice(0, 1024),
                ...(input.fbc ? { fbc: input.fbc } : {}),
                ...(input.fbp ? { fbp: input.fbp } : {}),
              },
            }),
          ],
        );
    });
    return NextResponse.json({ ok: true, clickId: input.clickId }, { headers: c.headers });
  } catch (e) {
    return handleError(e);
  }
}
