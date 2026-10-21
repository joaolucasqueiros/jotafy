import { NextResponse } from 'next/server';
import { equal, HttpError } from '@/lib/security';
import { handleError } from '@/lib/http';
import { runJobs, scheduleSyncs, cleanup } from '@/lib/jobs';
export async function POST(request: Request) {
  try {
    if (
      !process.env.CRON_SECRET ||
      !equal(request.headers.get('authorization') || '', `Bearer ${process.env.CRON_SECRET}`)
    )
      throw new HttpError(401, 'Não autorizado.');
    await scheduleSyncs();
    const result = await runJobs(5);
    await cleanup();
    return NextResponse.json(result);
  } catch (e) {
    return handleError(e);
  }
}
