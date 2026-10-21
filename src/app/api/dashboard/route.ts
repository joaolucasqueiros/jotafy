import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth';
import { dashboard } from '@/lib/dashboard';
import { handleError } from '@/lib/http';
import { HttpError } from '@/lib/security';
const schema = z.object({
  start: z.iso.date(),
  end: z.iso.date(),
  campaign: z.string().max(100).optional(),
  adset: z.string().max(100).optional(),
  ad: z.string().max(100).optional(),
});
export async function GET(request: Request) {
  try {
    const w = await requireWorkspace(),
      input = schema.parse(Object.fromEntries(new URL(request.url).searchParams));
    if (input.start > input.end || Date.parse(input.end) - Date.parse(input.start) > 89 * 86400000)
      throw new HttpError(400, 'Selecione um período de até 90 dias.');
    return NextResponse.json(await dashboard(w, input), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return handleError(e);
  }
}
