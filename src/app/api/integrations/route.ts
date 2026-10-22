import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth';
import { query } from '@/lib/db';
import { encrypt, appUrl, randomToken } from '@/lib/security';
import { sameOrigin, readJson, handleError } from '@/lib/http';
import { trackingOrigins } from '@/lib/tracking-origins';
import { integrationDiagnostics } from '@/lib/integration-diagnostics';
export async function GET() {
  try {
    const w = await requireWorkspace();
    const [connection] = await query(
      'SELECT expires_at,last_sync_at FROM meta_connections WHERE workspace_id=$1',
      [w.id],
    );
    const accounts = await query(
      'SELECT external_id,name,currency,timezone,selected FROM ad_accounts WHERE workspace_id=$1 ORDER BY name',
      [w.id],
    );
    const jobs = await query(
      'SELECT id,kind,status,attempts,last_error,created_at FROM jobs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 20',
      [w.id],
    );
    return NextResponse.json({
      publicKey: w.public_key,
      webhookUrl: `${appUrl()}/api/webhooks/cakto/${w.public_key}`,
      pixelUrl: `${appUrl()}/pixel.js`,
      connection: connection || null,
      accounts,
      jobs,
      allowedOrigins: w.allowed_origins,
      caktoAccountEmail: w.cakto_account_email || '',
      caktoConfigured: !!w.cakto_secret,
      pixelId: w.pixel_id,
      capiConfigured: !!w.capi_token,
      testEventCode: w.test_event_code,
      diagnostics: await integrationDiagnostics(w.id),
    });
  } catch (e) {
    return handleError(e);
  }
}
const schema = z.object({
  caktoAccountEmail: z.union([z.email(), z.literal('')]).optional(),
  caktoSecret: z.string().min(16).max(512).optional(),
  pixelId: z
    .string()
    .regex(/^\d{5,30}$/)
    .optional(),
  capiToken: z.string().min(20).max(4096).optional(),
  testEventCode: z.string().max(100).optional(),
  allowedOrigins: trackingOrigins.optional(),
  generateSecret: z.boolean().optional(),
});
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const w = await requireWorkspace(),
      input = schema.parse(await readJson(request));
    const generated = input.generateSecret ? randomToken() : undefined;
    await query(
      `UPDATE workspaces SET cakto_secret=COALESCE($2,cakto_secret),pixel_id=COALESCE($3,pixel_id),capi_token=COALESCE($4,capi_token),test_event_code=COALESCE($5,test_event_code),allowed_origins=COALESCE($6,allowed_origins),cakto_account_email=COALESCE($7,cakto_account_email) WHERE id=$1`,
      [
        w.id,
        input.caktoSecret || generated ? encrypt(input.caktoSecret || generated!) : null,
        input.pixelId || null,
        input.capiToken ? encrypt(input.capiToken) : null,
        input.testEventCode ?? null,
        input.allowedOrigins ?? null,
        input.caktoAccountEmail?.trim().toLowerCase() ?? null,
      ],
    );
    return NextResponse.json({ ok: true, ...(generated ? { generatedSecret: generated } : {}) });
  } catch (e) {
    return handleError(e);
  }
}
