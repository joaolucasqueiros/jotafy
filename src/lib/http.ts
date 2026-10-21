import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { appUrl, HttpError } from './security';
import { query } from './db';
export function handleError(error: unknown) {
  if (error instanceof HttpError)
    return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError)
    return NextResponse.json(
      { error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400 },
    );
  const id = crypto.randomUUID();
  console.error('request_failed', id, error instanceof Error ? error.name : 'UnknownError');
  return NextResponse.json(
    { error: 'Não foi possível concluir. Confira a configuração do serviço.', requestId: id },
    { status: 500 },
  );
}
export function sameOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(appUrl()).origin)
    throw new HttpError(403, 'Origem inválida.');
}
export async function readBody(request: Request, max = 65536): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Corpo vazio.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > max) {
      await reader.cancel();
      throw new HttpError(413, 'Corpo muito grande.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export async function readJson(request: Request, max = 65536): Promise<unknown> {
  const raw = await readBody(request, max);
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}
export async function rateLimit(key: string, max: number, seconds: number) {
  const [row] = await query(
    `INSERT INTO rate_limits(key, expires_at) VALUES ($1, now() + $2 * interval '1 second')
 ON CONFLICT (key) DO UPDATE SET attempts = CASE WHEN rate_limits.expires_at < now() THEN 1 ELSE rate_limits.attempts + 1 END,
 expires_at = CASE WHEN rate_limits.expires_at < now() THEN EXCLUDED.expires_at ELSE rate_limits.expires_at END RETURNING attempts`,
    [key, seconds],
  );
  if (row.attempts > max)
    throw new HttpError(429, 'Muitas tentativas. Tente novamente mais tarde.');
}
