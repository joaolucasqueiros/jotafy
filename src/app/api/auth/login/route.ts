import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { hashPassword, verifyPassword, HttpError } from '@/lib/security';
import { createSession } from '@/lib/auth';
import { sameOrigin, readJson, rateLimit, handleError } from '@/lib/http';
const dummy = hashPassword('metatrack-nonexistent-user');
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    await rateLimit('login:global', 300, 60);
    const input = z
      .object({ email: z.email().transform((v) => v.toLowerCase()), password: z.string().max(128) })
      .parse(await readJson(request, 4096));
    await rateLimit(`login:${input.email}`, 10, 900);
    const [user] = await query('SELECT id,password_hash FROM users WHERE email=$1', [input.email]);
    const valid = verifyPassword(input.password, user?.password_hash || dummy);
    if (!user?.password_hash || !valid) throw new HttpError(401, 'E-mail ou senha inválidos.');
    await createSession(user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
