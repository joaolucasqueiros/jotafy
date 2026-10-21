import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth';
import { changeMetaEntity } from '@/lib/meta';
import { sameOrigin, readJson, handleError, rateLimit } from '@/lib/http';
const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('status'),
    kind: z.enum(['campaign', 'adset']),
    id: z.string().regex(/^\d+$/),
    value: z.enum(['ACTIVE', 'PAUSED']),
  }),
  z.object({
    action: z.literal('budget'),
    kind: z.enum(['campaign', 'adset']),
    id: z.string().regex(/^\d+$/),
    value: z.number().int().min(100).max(100000000),
  }),
  z.object({
    action: z.literal('duplicate'),
    kind: z.literal('campaign'),
    id: z.string().regex(/^\d+$/),
  }),
]);
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const w = await requireWorkspace(),
      input = schema.parse(await readJson(request));
    await rateLimit(`manage:${w.id}`, 30, 60);
    const result = await changeMetaEntity(
      w.id,
      input.kind,
      input.id,
      input.action,
      'value' in input ? input.value : undefined,
    );
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return handleError(e);
  }
}
