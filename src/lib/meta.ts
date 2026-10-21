import { createHmac } from 'node:crypto';
import { query, transaction } from './db';
import type { PoolClient } from 'pg';
import { decrypt, HttpError } from './security';
import { dateRange } from './format';
import { landingPageViews, type MetaAction } from './meta-insights';
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
export async function graphAll<T>(
  path: string,
  token: string,
  params: Record<string, string>,
  checkpoint?: () => Promise<void>,
) {
  const data: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < 1000; page++) {
    await checkpoint?.();
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
type MetaCampaign = {
  id: string;
  name: string;
  status: string;
  daily_budget?: string;
  objective?: string;
};
type MetaAdset = {
  id: string;
  campaign_id: string;
  name: string;
  status: string;
  daily_budget?: string;
};
type MetaAd = { id: string; campaign_id: string; adset_id: string; name: string; status: string };
type MetaInsight = {
  ad_id: string;
  adset_id: string;
  campaign_id: string;
  date_start: string;
  spend: string;
  inline_link_clicks?: string;
  actions?: MetaAction[];
  impressions: string;
};
export type MetaCheckpoint = (client?: PoolClient) => Promise<void>;
export async function syncMeta(workspaceId: string, checkpoint?: MetaCheckpoint) {
  await checkpoint?.();
  const token = await metaToken(workspaceId);
  const accounts = await query(
    'SELECT * FROM ad_accounts WHERE workspace_id=$1 AND selected=true',
    [workspaceId],
  );
  if (!accounts.length) throw new HttpError(409, 'Selecione pelo menos uma conta de anúncios.');
  const { start, end } = dateRange(90);
  const tick = () => checkpoint?.() || Promise.resolve();
  for (const account of accounts) {
    // Fetch outside the transaction. Network pagination renews the job's lease.
    const campaigns = await graphAll<MetaCampaign>(
      `${account.external_id}/campaigns`,
      token,
      { fields: 'id,name,status,daily_budget,objective' },
      tick,
    );
    const adsets = await graphAll<MetaAdset>(
      `${account.external_id}/adsets`,
      token,
      { fields: 'id,campaign_id,name,status,daily_budget' },
      tick,
    );
    const ads = await graphAll<MetaAd>(
      `${account.external_id}/ads`,
      token,
      { fields: 'id,adset_id,campaign_id,name,status' },
      tick,
    );
    const insights = await graphAll<MetaInsight>(
      `${account.external_id}/insights`,
      token,
      {
        fields: 'ad_id,adset_id,campaign_id,spend,inline_link_clicks,impressions,actions',
        level: 'ad',
        time_increment: '1',
        time_range: JSON.stringify({ since: start, until: end }),
      },
      tick,
    );
    const unique = <T>(rows: T[], key: (row: T) => string) => [
      ...new Map(rows.map((row) => [key(row), row])).values(),
    ];
    const insightRows = unique(insights, (i) => `${i.ad_id}:${i.date_start}`).map((i) => ({
      ad_id: i.ad_id,
      adset_id: i.adset_id,
      campaign_id: i.campaign_id,
      day: i.date_start,
      spend: Math.round(Number(i.spend) * 100),
      clicks: Number(i.inline_link_clicks || 0),
      impressions: Number(i.impressions),
      landing_page_views: landingPageViews(i.actions),
    }));
    await transaction(async (client) => {
      // Lock/check the lease in the same transaction as the writes, fencing obsolete attempts.
      await checkpoint?.(client);
      await client.query(
        `INSERT INTO campaigns(workspace_id,account_id,external_id,name,status,daily_budget,objective)
        SELECT $1,$2,c.id,c.name,c.status,c.daily_budget,c.objective FROM jsonb_to_recordset($3::jsonb) AS c(id text,name text,status text,daily_budget bigint,objective text)
        ON CONFLICT(workspace_id,external_id) DO UPDATE SET name=EXCLUDED.name,status=EXCLUDED.status,daily_budget=EXCLUDED.daily_budget,objective=EXCLUDED.objective,updated_at=now()`,
        [
          workspaceId,
          account.external_id,
          JSON.stringify(
            unique(campaigns, (c) => c.id).map((c) => ({
              ...c,
              daily_budget: c.daily_budget || null,
            })),
          ),
        ],
      );
      await client.query(
        `INSERT INTO adsets(workspace_id,external_id,campaign_id,name,status,daily_budget)
        SELECT $1,a.id,a.campaign_id,a.name,a.status,a.daily_budget FROM jsonb_to_recordset($2::jsonb) AS a(id text,campaign_id text,name text,status text,daily_budget bigint)
        ON CONFLICT(workspace_id,external_id) DO UPDATE SET campaign_id=EXCLUDED.campaign_id,name=EXCLUDED.name,status=EXCLUDED.status,daily_budget=EXCLUDED.daily_budget`,
        [
          workspaceId,
          JSON.stringify(
            unique(adsets, (a) => a.id).map((a) => ({
              ...a,
              daily_budget: a.daily_budget || null,
            })),
          ),
        ],
      );
      await client.query(
        `INSERT INTO ads(workspace_id,external_id,adset_id,campaign_id,name,status)
        SELECT $1,a.id,a.adset_id,a.campaign_id,a.name,a.status FROM jsonb_to_recordset($2::jsonb) AS a(id text,adset_id text,campaign_id text,name text,status text)
        ON CONFLICT(workspace_id,external_id) DO UPDATE SET adset_id=EXCLUDED.adset_id,campaign_id=EXCLUDED.campaign_id,name=EXCLUDED.name,status=EXCLUDED.status`,
        [workspaceId, JSON.stringify(unique(ads, (a) => a.id))],
      );
      // One DB round-trip per batch, rather than one connection/request per ad and day.
      for (let offset = 0; offset < insightRows.length; offset += 500) {
        await checkpoint?.(client);
        await client.query(
          `INSERT INTO ad_insights(workspace_id,ad_id,adset_id,campaign_id,day,spend,clicks,impressions,landing_page_views)
          SELECT $1,i.ad_id,i.adset_id,i.campaign_id,i.day,i.spend,i.clicks,i.impressions,i.landing_page_views
          FROM jsonb_to_recordset($2::jsonb) AS i(ad_id text,adset_id text,campaign_id text,day date,spend bigint,clicks integer,impressions integer,landing_page_views integer)
          ON CONFLICT(workspace_id,ad_id,day) DO UPDATE SET spend=EXCLUDED.spend,clicks=EXCLUDED.clicks,impressions=EXCLUDED.impressions,landing_page_views=EXCLUDED.landing_page_views`,
          [workspaceId, JSON.stringify(insightRows.slice(offset, offset + 500))],
        );
      }
    });
  }
  await transaction(async (client) => {
    await checkpoint?.(client);
    await client.query('UPDATE meta_connections SET last_sync_at=now() WHERE workspace_id=$1', [
      workspaceId,
    ]);
  });
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
