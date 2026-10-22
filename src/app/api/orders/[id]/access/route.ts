import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withWorkspace } from '@/lib/auth';
import { sameOrigin, rateLimit, handleError } from '@/lib/http';
import { issueDeliveryAccess } from '@/lib/delivery-access';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const id = z.uuid().parse((await context.params).id);
    const result = await withWorkspace(async (workspace, client) => {
      await rateLimit(`delivery-issue:${workspace.id}`, 20, 60);
      return issueDeliveryAccess(client, workspace.id, id);
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleError(error);
  }
}
