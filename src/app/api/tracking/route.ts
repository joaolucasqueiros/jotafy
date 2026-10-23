import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { handleError, readJson, rateLimit } from '@/lib/http';
import { HttpError } from '@/lib/security';
import { ingestTracking } from '@/lib/tracking';
const schema = z.object({
  key: z.string().regex(/^[a-f0-9]{64}$/),
  consent: z.literal(true),
  event: z.enum(['PageView', 'ViewContent', 'InitiateCheckout', 'Purchase']),
  eventId: z.string().uuid(),
  clickId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  isTest: z.boolean().default(false),
  url: z.url().max(3000),
  utm_source: z.string().max(200).optional(),
  utm_medium: z.string().max(200).optional(),
  utm_campaign: z.string().max(100).optional(),
  utm_term: z.string().max(100).optional(),
  utm_content: z.string().max(100).optional(),
  fbc: z.string().max(500).optional(),
  fbp: z.string().max(500).optional(),
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
    const result = await ingestTracking(
      c.workspaceId,
      input,
      url.toString(),
      (request.headers.get('user-agent') || '').slice(0, 1024),
    );
    return NextResponse.json(
      { ok: true, clickId: input.clickId, ...result },
      { headers: c.headers },
    );
  } catch (e) {
    return handleError(e);
  }
}
