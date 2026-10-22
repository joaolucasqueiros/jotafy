import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth';
import { sameOrigin, rateLimit, handleError } from '@/lib/http';
import { retryJob } from '@/lib/retry-job';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const workspace = await requireWorkspace();
    const id = z.uuid().parse((await context.params).id);
    await rateLimit(`job-retry:${workspace.id}`, 20, 60);
    return NextResponse.json(await retryJob(workspace.id, id));
  } catch (error) {
    return handleError(error);
  }
}
