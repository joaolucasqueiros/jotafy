import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { currentWorkspace } from '@/lib/auth';
import { encrypt, randomToken, HttpError } from '@/lib/security';
import { metaOAuthConfig } from '@/lib/meta-oauth-config';
import { handleError } from '@/lib/http';
export async function GET(request: Request) {
  let stage = 'configuration';
  try {
    const config = metaOAuthConfig();
    stage = 'session_lookup';
    const connect = new URL(request.url).searchParams.get('intent') === 'connect';
    const w = await currentWorkspace();
    if (connect && !w) throw new HttpError(401, 'Entre antes de conectar uma conta.');
    stage = 'state_cookie';
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
    stage = 'redirect';
    const url = new URL(`https://www.facebook.com/${config.version}/dialog/oauth`);
    url.search = new URLSearchParams({
      client_id: config.appId,
      redirect_uri: config.callbackUrl,
      state,
      response_type: 'code',
      scope: connect ? 'public_profile,email,ads_read,ads_management' : 'public_profile,email',
    }).toString();
    return NextResponse.redirect(url);
  } catch (e) {
    return handleError(e, { operation: 'meta_oauth_start', stage });
  }
}
