import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { currentWorkspace, createSession } from '@/lib/auth';
import { appUrl, decrypt, encrypt, equal, randomToken, HttpError } from '@/lib/security';
import { transaction, query } from '@/lib/db';
import { metaOAuthConfig } from '@/lib/meta-oauth-config';
import { graphRequest, discoverAccounts } from '@/lib/meta';
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams,
      jar = await cookies(),
      raw = jar.get('mt_oauth')?.value;
    jar.delete('mt_oauth');
    if (!raw) throw new HttpError(400, 'Solicitação OAuth expirada.');
    const state = JSON.parse(decrypt(raw));
    if (
      state.expires < Date.now() ||
      !equal(params.get('state') || '', state.state) ||
      !params.get('code')
    )
      throw new HttpError(400, 'OAuth cancelado ou estado inválido.');
    async function exchange(args: Record<string, string>) {
      const url = new URL(
        `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v25.0'}/oauth/access_token`,
      );
      url.search = new URLSearchParams({
        client_id: process.env.META_APP_ID!,
        client_secret: process.env.META_APP_SECRET!,
        ...args,
      }).toString();
      const res = await fetch(url, { signal: AbortSignal.timeout(25000), cache: 'no-store' });
      const body = await res.json();
      if (!res.ok || !body.access_token)
        throw new HttpError(
          502,
          'A Meta recusou a troca de token. Confira o aplicativo e o callback.',
        );
      return body;
    }
    const short = await exchange({
      redirect_uri: metaOAuthConfig().callbackUrl,
      code: params.get('code')!,
    });
    const long = await exchange({
      grant_type: 'fb_exchange_token',
      fb_exchange_token: short.access_token,
    });
    const profile = await graphRequest<{ id: string; name: string; email?: string }>(
      'me',
      long.access_token,
      { fields: 'id,name,email' },
    );
    if (state.workspaceId) {
      const w = await currentWorkspace();
      if (!w || w.id !== state.workspaceId)
        throw new HttpError(403, 'A sessão mudou durante a conexão.');
      await query(
        `INSERT INTO meta_connections(workspace_id,meta_user_id,token,expires_at) VALUES($1,$2,$3,$4)
   ON CONFLICT(workspace_id) DO UPDATE SET meta_user_id=$2,token=$3,expires_at=$4`,
        [
          w.id,
          profile.id,
          encrypt(long.access_token),
          new Date(Date.now() + (long.expires_in || 5184000) * 1000),
        ],
      );
      await discoverAccounts(w.id, long.access_token);
    } else {
      const user = await transaction(async (c) => {
        const {
          rows: [existing],
        } = await c.query('SELECT id FROM users WHERE facebook_id=$1', [profile.id]);
        if (existing) return existing;
        if (!profile.email)
          throw new HttpError(
            400,
            'A Meta não disponibilizou e-mail. Crie sua conta por e-mail e conecte a Meta em Integrações.',
          );
        if (
          process.env.SIGNUP_EMAIL_DOMAIN &&
          profile.email.split('@')[1] !== process.env.SIGNUP_EMAIL_DOMAIN
        )
          throw new HttpError(403, 'Cadastro restrito.');
        const {
          rows: [collision],
        } = await c.query('SELECT id FROM users WHERE email=$1', [profile.email.toLowerCase()]);
        if (collision)
          throw new HttpError(
            409,
            'Já existe uma conta com esse e-mail. Entre com sua senha para conectar a Meta.',
          );
        const {
          rows: [u],
        } = await c.query(
          'INSERT INTO users(email,name,facebook_id) VALUES($1,$2,$3) RETURNING id',
          [profile.email.toLowerCase(), profile.name, profile.id],
        );
        await c.query('INSERT INTO workspaces(user_id,name,public_key) VALUES($1,$2,$3)', [
          u.id,
          `${profile.name} · Workspace`,
          randomToken(),
        ]);
        return u;
      });
      await createSession(user.id);
    }
    return NextResponse.redirect(`${appUrl()}/?tab=integrations&connected=1`);
  } catch (e) {
    const message =
      e instanceof HttpError ? e.message : 'Não foi possível concluir a conexão Meta.';
    return NextResponse.redirect(`${appUrl()}/login?error=${encodeURIComponent(message)}`);
  }
}
