import { transaction } from './db';
import { HttpError } from './security';

export async function retryJob(workspaceId: string, jobId: string) {
  return transaction(async (client) => {
    const {
      rows: [job],
    } = await client.query(
      'SELECT kind,status,payload FROM jobs WHERE id=$1 AND workspace_id=$2 FOR UPDATE',
      [jobId, workspaceId],
    );
    if (!job) throw new HttpError(404, 'Trabalho não encontrado.');
    if (job.status !== 'failed')
      throw new HttpError(409, 'Somente trabalhos com falha definitiva podem ser reagendados.');
    if (!['capi', 'capi_test', 'meta_sync'].includes(job.kind))
      throw new HttpError(409, 'Tipo de trabalho não suportado.');
    if (job.kind === 'capi' || job.kind === 'capi_test') {
      const payload = job.kind === 'capi_test' ? job.payload?.event : job.payload;
      const timestamp = Number(payload?.event_time) * 1000;
      if (
        !Number.isFinite(timestamp) ||
        timestamp > Date.now() ||
        timestamp <= Date.now() - 7 * 86400000 ||
        !payload?.event_id
      ) {
        throw new HttpError(
          409,
          'Evento expirado ou sem payload válido. Não é possível alterar sua data para reenviar.',
        );
      }
    }
    await client.query(
      "UPDATE jobs SET status='pending',attempts=0,run_at=now(),locked_until=NULL,last_error=NULL WHERE id=$1 AND workspace_id=$2",
      [jobId, workspaceId],
    );
    await client.query(
      "INSERT INTO audit_log(workspace_id,action,target,details) VALUES($1,'job_retry',$2,$3)",
      [workspaceId, jobId, JSON.stringify({ kind: job.kind })],
    );
    return { ok: true, state: 'queued' };
  });
}
