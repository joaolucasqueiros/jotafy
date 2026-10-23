import { query } from './db';
export type UtmTrackingCampaign = {
  id: string;
  name: string;
  campaignStatus: string;
  state: 'receiving' | 'historical' | 'no_events';
  lastReceivedAt: string | null;
  events24h: number;
  checkouts24h: number;
};
export async function utmTrackingStatus(workspaceId: string) {
  const rows = await query(
    `SELECT c.external_id,c.name,c.status,max(e.created_at) AS last_received_at,
    count(e.id) FILTER(WHERE e.created_at>=now()-interval '24 hours')::int AS events_24h,
    count(e.id) FILTER(WHERE e.created_at>=now()-interval '24 hours' AND e.event_name='InitiateCheckout')::int AS checkouts_24h
    FROM campaigns c JOIN ad_accounts a ON a.workspace_id=c.workspace_id AND a.external_id=c.account_id AND a.selected=true
    LEFT JOIN tracking_events e ON e.workspace_id=c.workspace_id AND e.is_test=false AND e.created_at>=now()-interval '90 days'
      AND COALESCE(e.campaign_id,(SELECT cl.campaign_id FROM clicks cl WHERE cl.id=e.click_id AND cl.workspace_id=e.workspace_id))=c.external_id
    WHERE c.workspace_id=$1 GROUP BY c.external_id,c.name,c.status ORDER BY c.name,c.external_id`,
    [workspaceId],
  );
  const campaigns: UtmTrackingCampaign[] = rows.map((row) => ({
    id: row.external_id,
    name: row.name,
    campaignStatus: row.status,
    state: row.events_24h > 0 ? 'receiving' : row.last_received_at ? 'historical' : 'no_events',
    lastReceivedAt: row.last_received_at?.toISOString() || null,
    events24h: row.events_24h,
    checkouts24h: row.checkouts_24h,
  }));
  return { checkedAt: new Date().toISOString(), campaigns };
}
