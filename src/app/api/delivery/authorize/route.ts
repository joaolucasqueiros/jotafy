import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withConnection } from '@/lib/db';
import { handleError, readJson } from '@/lib/http';
import {
  checkDeliveryAccess,
  redeemDeliveryAccess,
  recordDeliveryEvent,
  requireDeliveryService,
  deliveryEvents,
} from '@/lib/delivery-access';

const token = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('redeem'), grant: token, session: token }),
  z.object({ action: z.literal('status'), session: token }),
  z.object({ action: z.literal('record'), session: token, event: z.enum(deliveryEvents) }),
]);
export async function POST(request: Request) {
  try {
    requireDeliveryService(request);
    const input = schema.parse(await readJson(request, 2048));
    const result = await withConnection(async (client) => {
      if (input.action === 'redeem') {
        const redeemed = await redeemDeliveryAccess(client, input.grant, input.session);
        return redeemed ? { status: 'approved', ...redeemed } : { status: 'unconfirmed' };
      }
      if (input.action === 'record')
        return { recorded: await recordDeliveryEvent(client, input.session, input.event) };
      const access = await checkDeliveryAccess(client, input.session);
      return access
        ? {
            status: access.status,
            ...(access.status === 'approved' ? { expiresAt: access.expiresAt } : {}),
          }
        : { status: 'unconfirmed' };
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleError(error);
  }
}
