import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sha256 } from '@/lib/security';
import { sessionCookie } from '@/lib/auth';
import { sameOrigin, handleError } from '@/lib/http';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const jar = await cookies();
    const token = jar.get(sessionCookie)?.value;
    if (token) await query('DELETE FROM sessions WHERE token_hash=$1', [sha256(token)]);
    jar.delete(sessionCookie);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
