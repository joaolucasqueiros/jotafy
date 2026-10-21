import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth';
import { transaction } from '@/lib/db';
import { HttpError } from '@/lib/security';
import { sameOrigin, readJson, handleError } from '@/lib/http';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const w = await requireWorkspace(),
      input = z
        .object({ ids: z.array(z.string().regex(/^act_\d+$/)).max(30) })
        .parse(await readJson(request));
    await transaction(async (c) => {
      const { rows } = await c.query(
        'SELECT external_id,currency,timezone FROM ad_accounts WHERE workspace_id=$1 AND external_id=ANY($2::text[])',
        [w.id, input.ids],
      );
      if (rows.length !== input.ids.length)
        throw new HttpError(400, 'Conta não disponível neste workspace.');
      if (rows.some((a) => a.currency !== 'BRL' || a.timezone !== 'America/Sao_Paulo'))
        throw new HttpError(
          422,
          'A versão 1 exige contas BRL no fuso America/Sao_Paulo para evitar misturar moedas e dias contábeis.',
        );
      await c.query(
        'UPDATE ad_accounts SET selected=(external_id=ANY($2::text[])) WHERE workspace_id=$1',
        [w.id, input.ids],
      );
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
