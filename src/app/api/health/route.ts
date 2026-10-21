import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const rows = await query("SELECT version FROM schema_migrations WHERE version='005'");
    if (!rows.length) throw new Error('Migration missing');
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
