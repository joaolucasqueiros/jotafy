import { NextResponse } from 'next/server';
import { requireWorkspace } from '@/lib/auth';
import { query } from '@/lib/db';
import { sameOrigin, handleError, rateLimit } from '@/lib/http';
import { runJobs } from '@/lib/jobs';
import { HttpError } from '@/lib/security';
import { metaToken } from '@/lib/meta';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const w = await requireWorkspace();
    await metaToken(w.id);
    await rateLimit(`sync:${w.id}`, 5, 60);
    const [active] = await query(
      "SELECT id FROM jobs WHERE workspace_id=$1 AND kind='meta_sync' AND status='running' AND locked_until>now() LIMIT 1",
      [w.id],
    );
    if (active)
      return NextResponse.json(
        {
          ok: true,
          pending: true,
          message: 'Sincronização em andamento. O painel acompanha a conclusão.',
        },
        { status: 202 },
      );
    const [job] = await query(
      "INSERT INTO jobs(workspace_id,kind,dedupe_key) VALUES($1,'meta_sync',$2) ON CONFLICT(workspace_id,kind,dedupe_key) DO UPDATE SET dedupe_key=EXCLUDED.dedupe_key RETURNING id",
      [w.id, `manual:${Math.floor(Date.now() / 60000)}`],
    );
    // Process only this authenticated workspace's job, including on Cloudflare.
    await runJobs(1, { workspaceId: w.id, jobId: job.id });
    const [result] = await query(
      'SELECT status,last_error FROM jobs WHERE id=$1 AND workspace_id=$2',
      [job.id, w.id],
    );
    if (result.last_error) throw new HttpError(502, result.last_error);
    const pending = result.status !== 'completed';
    return NextResponse.json(
      {
        ok: true,
        pending,
        message: pending
          ? 'Sincronização em andamento. O painel acompanha a conclusão.'
          : 'Meta sincronizada. Cliques e visitas atualizados.',
      },
      { status: pending ? 202 : 200 },
    );
  } catch (e) {
    return handleError(e);
  }
}
