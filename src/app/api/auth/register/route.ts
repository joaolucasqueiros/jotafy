import { NextResponse } from 'next/server';
import { z } from 'zod';
import { transaction } from '@/lib/db';
import { hashPassword, randomToken, HttpError } from '@/lib/security';
import { createSession } from '@/lib/auth';
import { handleError, sameOrigin, readJson, rateLimit } from '@/lib/http';
const schema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(12).max(128),
});
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    await rateLimit('register:global', 100, 3600);
    const input = schema.parse(await readJson(request, 4096));
    await rateLimit(`register:${input.email}`, 5, 3600);
    const domain = process.env.SIGNUP_EMAIL_DOMAIN;
    if (domain && input.email.split('@')[1] !== domain)
      throw new HttpError(403, 'Cadastro restrito ao domínio autorizado.');
    const user = await transaction(async (c) => {
      const {
        rows: [u],
      } = await c.query(
        'INSERT INTO users(email,name,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id',
        [input.email, input.name, hashPassword(input.password)],
      );
      if (!u) throw new HttpError(409, 'Não foi possível cadastrar esse e-mail. Tente entrar.');
      await c.query('INSERT INTO workspaces(user_id,name,public_key) VALUES($1,$2,$3)', [
        u.id,
        `${input.name.split(' ')[0]} · Workspace`,
        randomToken(),
      ]);
      return u;
    });
    await createSession(user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
