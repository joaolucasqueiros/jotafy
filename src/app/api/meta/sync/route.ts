import { NextResponse } from 'next/server';
import { requireWorkspace } from '@/lib/auth';
import { query, transaction } from '@/lib/db';
import { sameOrigin, handleError, rateLimit } from '@/lib/http';
import { HttpError } from '@/lib/security';

type SyncJob = {
  id: string;
  status: string;
  locked_until: Date | null;
  run_at: Date;
  last_error: string | null;
};
function describe(job: SyncJob) {
  const active =
    job.status === 'running' &&
    !!job.locked_until &&
    new Date(job.locked_until).getTime() > Date.now();
  const state = ['completed', 'failed'].includes(job.status)
    ? job.status
    : active
      ? 'running'
      : 'queued';
  return {
    ok: state !== 'failed',
    pending: !['completed', 'failed'].includes(state),
    state,
    jobId: job.id,
    lockedUntil: job.locked_until,
    retryAt: job.run_at,
    lastError: job.last_error,
    message:
      state === 'completed'
        ? 'Meta sincronizada. Cliques e visitas atualizados.'
        : state === 'failed'
          ? 'A sincronização falhou. Confira o último erro.'
          : state === 'running'
            ? 'O serviço está consultando a Meta. Acompanhe a conclusão no painel.'
            : 'Aguardando o serviço de sincronização. Mantenha o processador ativo.',
  };
}
export async function GET(request: Request) {
  try {
    const w = await requireWorkspace();
    const id = new URL(request.url).searchParams.get('jobId') || '';
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))
      throw new HttpError(400, 'Identificador de sincronização inválido.');
    const [job] = await query<SyncJob>(
      "SELECT id,status,locked_until,run_at,last_error FROM jobs WHERE id=$1 AND workspace_id=$2 AND kind='meta_sync'",
      [id, w.id],
    );
    if (!job) throw new HttpError(404, 'Sincronização não encontrada.');
    return NextResponse.json(describe(job), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleError(error);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const w = await requireWorkspace();
    const [connection] = await query(
      'SELECT expires_at>now() AS valid FROM meta_connections WHERE workspace_id=$1',
      [w.id],
    );
    if (!connection?.valid)
      throw new HttpError(409, 'Conecte novamente sua conta Meta; token ausente ou expirado.');
    await rateLimit(`sync:${w.id}`, 5, 60);
    const job = await transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))', [w.id]);
      const {
        rows: [existing],
      } = await client.query<SyncJob>(
        "SELECT id,status,locked_until,run_at,last_error FROM jobs WHERE workspace_id=$1 AND kind='meta_sync' AND status IN ('pending','running') ORDER BY CASE WHEN status='running' AND locked_until>clock_timestamp() THEN 0 ELSE 1 END,run_at LIMIT 1",
        [w.id],
      );
      if (existing) return existing;
      const {
        rows: [created],
      } = await client.query<SyncJob>(
        "INSERT INTO jobs(workspace_id,kind,dedupe_key) VALUES($1,'meta_sync',$2) RETURNING id,status,locked_until,run_at,last_error",
        [w.id, `manual:${crypto.randomUUID()}`],
      );
      return created;
    });
    // The web Worker only enqueues. Graph pagination and DB batches run in Node.
    return NextResponse.json(describe(job), { status: 202 });
  } catch (error) {
    return handleError(error);
  }
}
