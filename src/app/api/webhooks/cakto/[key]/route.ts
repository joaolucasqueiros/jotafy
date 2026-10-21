import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { decrypt, HttpError } from '@/lib/security';
import { normalizeCakto } from '@/lib/cakto';
import { verifyRelaySignature } from '@/lib/signature';
import { ingestCakto } from '@/lib/orders';
import { readBody, handleError, rateLimit } from '@/lib/http';
export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await context.params;
    if (!/^[a-f0-9]{64}$/.test(key)) throw new HttpError(404, 'Integração não encontrada.');
    const [w] = await query('SELECT id,cakto_secret FROM workspaces WHERE public_key=$1', [key]);
    if (!w?.cakto_secret) throw new HttpError(404, 'Integração não configurada.');
    await rateLimit(`webhook:${w.id}`, 600, 60);
    const raw = await readBody(request, 262144);
    if (
      process.env.CAKTO_RELAY_HMAC_SECRET &&
      !verifyRelaySignature(
        raw,
        request.headers.get('x-metatrack-signature'),
        process.env.CAKTO_RELAY_HMAC_SECRET,
      )
    )
      throw new HttpError(401, 'Assinatura do relay inválida.');
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'JSON inválido.');
    }
    const event = normalizeCakto(payload, decrypt(w.cakto_secret));
    if (!event) return NextResponse.json({ accepted: true, ignored: true });
    return NextResponse.json(await ingestCakto(w.id, event));
  } catch (e) {
    return handleError(e);
  }
}
