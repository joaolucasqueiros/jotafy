import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { currentWorkspace } from '@/lib/auth';
import { appUrl, encrypt, randomToken, HttpError } from '@/lib/security';
import { handleError } from '@/lib/http';
export async function GET(request: Request) {
  try {
    if (!process.env.META_APP_ID || !process.env.META_APP_SECRET)
      throw new HttpError(
        503,
        'Configure META_APP_ID, META_APP_SECRET e ENCRYPTION_KEY no servidor.',
      );
    const connect = new URL(request.url).searchParams.get('intent') === 'connect';
    const w = await currentWorkspace();
    if (connect && !w) throw new HttpError(401, 'Entre antes de conectar uma conta.');
    const state = randomToken();
    (await cookies()).set(
      'mt_oauth',
      encrypt(
        JSON.stringify({
          state,
          workspaceId: connect ? w!.id : null,
          expires: Date.now() + 600000,
        }),
      ),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600,
        path: '/',
      },
    );
    const url = new URL(
      `https://www.facebook.com/${process.env.META_GRAPH_VERSION || 'v25.0'}/dialog/oauth`,
    );
    url.search = new URLSearchParams({
      client_id: process.env.META_APP_ID,
      redirect_uri: `${appUrl()}/api/auth/meta/callback`,
      state,
      response_type: 'code',
      scope: connect ? 'public_profile,email,ads_read,ads_management' : 'public_profile,email',
    }).toString();
    return NextResponse.redirect(url);
  } catch (e) {
    return handleError(e);
  }
}
