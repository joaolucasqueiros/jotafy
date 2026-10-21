import { createHmac } from 'node:crypto';
import { query } from './db';
import { decrypt, HttpError } from './security';
const graph = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v25.0'}`;
export async function graphRequest<T = Record<string, unknown>>(
  path: string,
  token: string,
  params: Record<string, string> = {},
  method = 'GET',
): Promise<T> {
  if (!/^[a-zA-Z0-9_/-]+$/.test(path)) throw new Error('Invalid Graph path');
  const proof = createHmac('sha256', process.env.META_APP_SECRET || '')
    .update(token)
    .digest('hex');
  const data = new URLSearchParams({ ...params, appsecret_proof: proof });
  const response = await fetch(`${graph()}/${path}${method === 'GET' ? `?${data}` : ''}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(method !== 'GET' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: method === 'GET' ? undefined : data,
    signal: AbortSignal.timeout(25000),
    cache: 'no-store',
  });
  const body = await response.json();
  if (!response.ok || body.error)
    throw new HttpError(
      502,
      `Meta: ${body.error?.error_user_msg || 'operação recusada; verifique permissões, token e limites da API.'} (código ${body.error?.code || response.status})`,
    );
  return body as T;
}
export async function graphAll<T>(path: string, token: string, params: Record<string, string>) {
  const data: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < 1000; page++) {
    const result: { data: T[]; paging?: { next?: string; cursors?: { after?: string } } } =
      await graphRequest(path, token, { ...params, limit: '100', ...(after ? { after } : {}) });
    data.push(...result.data);
    if (!result.paging?.next) return data;
    after = result.paging.cursors?.after;
    if (!after) throw new Error('Meta pagination missing cursor');
  }
  throw new Error('Meta pagination exceeded safety limit; sync incomplete');
}
export async function metaToken(workspaceId: string) {
  const [connection] = await query(
    'SELECT token, expires_at FROM meta_connections WHERE workspace_id=$1',
    [workspaceId],
  );
  if (!connection || new Date(connection.expires_at) <= new Date())
    throw new HttpError(409, 'Conecte novamente sua conta Meta; token ausente ou expirado.');
  return decrypt(connection.token);
}
export async function discoverAccounts(workspaceId: string, token: string) {
  const accounts = await graphAll<{
    id: string;
    name: string;
    currency: string;
    timezone_name: string;
  }>('me/adaccounts', token, { fields: 'id,name,currency,timezone_name' });
  for (const a of accounts)
    await query(
      `INSERT INTO ad_accounts(workspace_id,external_id,name,currency,timezone) VALUES($1,$2,$3,$4,$5)
 ON CONFLICT(workspace_id,external_id) DO UPDATE SET name=$3,currency=$4,timezone=$5`,
      [workspaceId, a.id, a.name, a.currency, a.timezone_name],
    );
  return accounts;
}
export async function syncMeta(workspaceId: string) {
  const token = await metaToken(workspaceId);
  const accounts = await query(
    'SELECT * FROM ad_accounts WHERE workspace_id=$1 AND selected=true',
    [workspaceId],
  );
  if (!accounts.length) throw new HttpError(409, 'Selecione pelo menos uma conta de anúncios.');
  for (const account of accounts) {
    const campaigns = await graphAll<{
      id: string;
      name: string;
      status: string;
      daily_budget?: string;
      objective?: string;
    }>(`${account.external_id}/campaigns`, token, {
      fields: 'id,name,status,daily_budget,objective',
    });
    for (const c of campaigns)
      await query(
        `INSERT INTO campaigns(workspace_id,account_id,external_id,name,status,daily_budget,objective)
   VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(workspace_id,external_id) DO UPDATE SET name=$4,status=$5,daily_budget=$6,objective=$7,updated_at=now()`,
        [
          workspaceId,
          account.external_id,
          c.id,
          c.name,
          c.status,
          c.daily_budget || null,
          c.objective,
        ],
      );
    const adsets = await graphAll<{
      id: string;
      campaign_id: string;
      name: string;
      status: string;
      daily_budget?: string;
    }>(`${account.external_id}/adsets`, token, {
      fields: 'id,campaign_id,name,status,daily_budget',
    });
    for (const a of adsets)
      await query(
        `INSERT INTO adsets(workspace_id,external_id,campaign_id,name,status,daily_budget) VALUES($1,$2,$3,$4,$5,$6)
   ON CONFLICT(workspace_id,external_id) DO UPDATE SET campaign_id=$3,name=$4,status=$5,daily_budget=$6`,
        [workspaceId, a.id, a.campaign_id, a.name, a.status, a.daily_budget || null],
      );
    const ads = await graphAll<{
      id: string;
      adset_id: string;
      campaign_id: string;
      name: string;
      status: string;
    }>(`${account.external_id}/ads`, token, { fields: 'id,adset_id,campaign_id,name,status' });
    for (const a of ads)
      await query(
        `INSERT INTO ads(workspace_id,external_id,adset_id,campaign_id,name,status) VALUES($1,$2,$3,$4,$5,$6)
   ON CONFLICT(workspace_id,external_id) DO UPDATE SET adset_id=$3,campaign_id=$4,name=$5,status=$6`,
        [workspaceId, a.id, a.adset_id, a.campaign_id, a.name, a.status],
      );
    const insights = await graphAll<{
      ad_id: string;
      adset_id: string;
      campaign_id: string;
      date_start: string;
      spend: string;
      clicks: string;
      impressions: string;
    }>(`${account.external_id}/insights`, token, {
      fields: 'ad_id,adset_id,campaign_id,spend,clicks,impressions',
      level: 'ad',
      time_increment: '1',
      date_preset: 'last_90d',
    });
    for (const i of insights)
      await query(
        `INSERT INTO ad_insights(workspace_id,ad_id,adset_id,campaign_id,day,spend,clicks,impressions)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(workspace_id,ad_id,day) DO UPDATE SET spend=$6,clicks=$7,impressions=$8`,
        [
          workspaceId,
          i.ad_id,
          i.adset_id,
          i.campaign_id,
          i.date_start,
          Math.round(Number(i.spend) * 100),
          Number(i.clicks),
          Number(i.impressions),
        ],
      );
  }
  await query('UPDATE meta_connections SET last_sync_at=now() WHERE workspace_id=$1', [
    workspaceId,
  ]);
}
export async function changeMetaEntity(
  workspaceId: string,
  kind: 'campaign' | 'adset',
  id: string,
  action: 'status' | 'budget' | 'duplicate',
  value?: string | number,
) {
  const table = kind === 'campaign' ? 'campaigns' : 'adsets';
  const [entity] = await query(`SELECT * FROM ${table} WHERE workspace_id=$1 AND external_id=$2`, [
    workspaceId,
    id,
  ]);
  if (!entity) throw new HttpError(404, 'Campanha ou conjunto não encontrado.');
  const token = await metaToken(workspaceId);
  if (action === 'duplicate') {
    if (kind !== 'campaign') throw new HttpError(400, 'Duplicação disponível para campanhas.');
    const result = await graphRequest(
      `${id}/copies`,
      token,
      {
        deep_copy: 'true',
        status_option: 'PAUSED',
        rename_options: JSON.stringify({ rename_suffix: ' — cópia' }),
      },
      'POST',
    );
    await query("INSERT INTO jobs(workspace_id,kind,dedupe_key) VALUES($1,'meta_sync',$2)", [
      workspaceId,
      crypto.randomUUID(),
    ]);
    await query('INSERT INTO audit_log(workspace_id,action,target,details) VALUES($1,$2,$3,$4)', [
      workspaceId,
      'duplicate',
      id,
      JSON.stringify(result),
    ]);
    return result;
  }
  const params: Record<string, string> =
    action === 'status' ? { status: String(value) } : { daily_budget: String(value) };
  const result = await graphRequest(id, token, params, 'POST');
  if (action === 'status')
    await query(`UPDATE ${table} SET status=$3 WHERE workspace_id=$1 AND external_id=$2`, [
      workspaceId,
      id,
      value,
    ]);
  else
    await query(`UPDATE ${table} SET daily_budget=$3 WHERE workspace_id=$1 AND external_id=$2`, [
      workspaceId,
      id,
      value,
    ]);
  await query('INSERT INTO audit_log(workspace_id,action,target,details) VALUES($1,$2,$3,$4)', [
    workspaceId,
    action,
    id,
    JSON.stringify(params),
  ]);
  return result;
}
