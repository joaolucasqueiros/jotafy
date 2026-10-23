import { NextResponse } from 'next/server';
import { requireWorkspace } from '@/lib/auth';
import { utmTrackingStatus } from '@/lib/utm-status';
import { handleError } from '@/lib/http';
export async function GET() {
  try {
    const w = await requireWorkspace();
    return NextResponse.json(await utmTrackingStatus(w.id), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return handleError(error);
  }
}
