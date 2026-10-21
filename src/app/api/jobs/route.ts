import { NextResponse } from 'next/server';
import { equal, HttpError } from '@/lib/security';
import { handleError } from '@/lib/http';
import { isWorkersRuntime } from '@/lib/db';
import { runJobs, scheduleSyncs, cleanup } from '@/lib/jobs';
export async function POST(request: Request) {
  try {
    if (
      !process.env.CRON_SECRET ||
      !equal(request.headers.get('authorization') || '', `Bearer ${process.env.CRON_SECRET}`)
    )
      throw new HttpError(401, 'Não autorizado.');
    if (isWorkersRuntime())
      throw new HttpError(
        503,
        'Execute o processamento no serviço Node dedicado; esta implantação Cloudflare apenas recebe e consulta os dados.',
      );
    await scheduleSyncs();
    const result = await runJobs(5);
    await cleanup();
    return NextResponse.json(result);
  } catch (e) {
    return handleError(e);
  }
}
