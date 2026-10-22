import { cookies } from 'next/headers';
import { query, withConnection } from './db';
import { sha256, randomToken, HttpError } from './security';
import type { PoolClient } from 'pg';
export const sessionCookie = 'mt_session';
export type Workspace = {
  id: string;
  user_id: string;
  name: string;
  public_key: string;
  user_name: string;
  email: string;
  allowed_origins: string[];
  cakto_secret: string | null;
  cakto_account_email?: string | null;
  pixel_id: string | null;
  capi_token: string | null;
  test_event_code: string | null;
};
export async function currentWorkspace(client?: PoolClient): Promise<Workspace | null> {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token) return null;
  const sql = `SELECT w.*, u.name AS user_name, u.email FROM sessions s
 JOIN users u ON u.id=s.user_id JOIN workspaces w ON w.user_id=u.id
 WHERE s.token_hash=$1 AND s.expires_at > now()`;
  const params = [sha256(token)];
  const [row] = client
    ? (await client.query<Workspace>(sql, params)).rows
    : await query<Workspace>(sql, params);
  return row || null;
}
export async function requireWorkspace(client?: PoolClient) {
  const w = await currentWorkspace(client);
  if (!w) throw new HttpError(401, 'Entre na sua conta para continuar.');
  return w;
}
export async function withWorkspace<T>(
  fn: (workspace: Workspace, client: PoolClient) => Promise<T>,
) {
  // Reject anonymous requests before opening a database socket.
  if (!(await cookies()).get(sessionCookie)?.value)
    throw new HttpError(401, 'Entre na sua conta para continuar.');
  return withConnection(async (client) => fn(await requireWorkspace(client), client));
}
export async function createSession(userId: string) {
  const token = randomToken();
  await query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
    [sha256(token), userId],
  );
  (await cookies()).set(sessionCookie, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 604800,
  });
}
