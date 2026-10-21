import { NextResponse } from 'next/server';
import { requireWorkspace } from '@/lib/auth';
import { query } from '@/lib/db';
import { sameOrigin, handleError, rateLimit } from '@/lib/http';
import { metaToken } from '@/lib/meta';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const w = await requireWorkspace();
    await metaToken(w.id);
    await rateLimit(`sync:${w.id}`, 5, 60);
    await query(
      "INSERT INTO jobs(workspace_id,kind,dedupe_key) VALUES($1,'meta_sync',$2) ON CONFLICT DO NOTHING",
      [w.id, `manual:${Math.floor(Date.now() / 60000)}`],
    );
    return NextResponse.json(
      {
        ok: true,
        message: 'Sincronização enfileirada. O worker processará as contas selecionadas.',
      },
      { status: 202 },
    );
  } catch (e) {
    return handleError(e);
  }
}
