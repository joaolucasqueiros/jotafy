import { estimateCosts, defaultCosts } from './costs';
import { financialSummary } from './financials';
import { query } from './db';
import type { Workspace } from './auth';
import type { DashboardData, Sale, Campaign } from './types';
export type Filters = {
  start: string;
  end: string;
  campaign?: string;
  adset?: string;
  ad?: string;
};
export async function dashboard(w: Workspace, f: Filters): Promise<DashboardData> {
  const values = [w.id, f.start, f.end, f.campaign || null, f.adset || null, f.ad || null];
  const orderFilter = `workspace_id=$1 AND is_test=false AND (COALESCE(purchased_at,occurred_at) AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date AND ($4::text IS NULL OR campaign_id=$4) AND ($5::text IS NULL OR adset_id=$5) AND ($6::text IS NULL OR ad_id=$6)`;
  const insightFilter = `workspace_id=$1 AND EXISTS(SELECT 1 FROM campaigns ic JOIN ad_accounts ia ON ia.workspace_id=ic.workspace_id AND ia.external_id=ic.account_id WHERE ic.workspace_id=ad_insights.workspace_id AND ic.external_id=ad_insights.campaign_id AND ia.selected=true) AND day BETWEEN $2::date AND $3::date AND ($4::text IS NULL OR campaign_id=$4) AND ($5::text IS NULL OR adset_id=$5) AND ($6::text IS NULL OR ad_id=$6)`;
  const [
    totals,
    insights,
    orders,
    campaigns,
    adsets,
    ads,
    seriesOrders,
    seriesSpend,
    events,
    connection,
  ] = await Promise.all([
    query(
      `SELECT status,count(*)::int AS count,COALESCE(sum(amount),0)::float8 AS amount,count(*) FILTER(WHERE campaign_id IS NULL)::int AS unattributed FROM orders WHERE ${orderFilter} GROUP BY status`,
      values,
    ),
    query(
      `SELECT campaign_id,sum(spend)::float8 AS spend,sum(clicks)::int AS clicks,sum(landing_page_views)::int AS landing_page_views,sum(impressions)::int AS impressions FROM ad_insights WHERE ${insightFilter} GROUP BY campaign_id`,
      values,
    ),
    query(
      `SELECT o.*,c.name AS campaign,a.name AS ad FROM (SELECT * FROM orders WHERE ${orderFilter} ORDER BY COALESCE(purchased_at,occurred_at) DESC LIMIT 200) o LEFT JOIN campaigns c ON c.workspace_id=o.workspace_id AND c.external_id=o.campaign_id LEFT JOIN ads a ON a.workspace_id=o.workspace_id AND a.external_id=o.ad_id`,
      values,
    ),
    query('SELECT * FROM campaigns WHERE workspace_id=$1 ORDER BY name', [w.id]),
    query(
      'SELECT external_id AS id,name,campaign_id AS "campaignId" FROM adsets WHERE workspace_id=$1',
      [w.id],
    ),
    query('SELECT external_id AS id,name,adset_id AS "adsetId" FROM ads WHERE workspace_id=$1', [
      w.id,
    ]),
    query(
      `SELECT (COALESCE(purchased_at,occurred_at) AT TIME ZONE 'America/Sao_Paulo')::date::text AS day,sum(amount)::float8 AS revenue FROM orders WHERE ${orderFilter} AND status='approved' GROUP BY day`,
      values,
    ),
    query(
      `SELECT day::text,sum(spend)::float8 AS spend FROM ad_insights WHERE ${insightFilter} GROUP BY day`,
      values,
    ),
    query(
      `SELECT e.event_name,count(*)::int AS count,count(DISTINCT e.session_id)::int AS sessions,count(*) FILTER(WHERE e.session_id IS NULL)::int AS missing_sessions,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM campaigns ec WHERE ec.workspace_id=e.workspace_id AND ec.external_id=COALESCE(e.campaign_id,c.campaign_id)))::int AS attributed FROM tracking_events e LEFT JOIN clicks c ON c.id=e.click_id AND c.workspace_id=e.workspace_id WHERE e.workspace_id=$1 AND e.is_test=false AND EXISTS(SELECT 1 FROM campaigns fc JOIN ad_accounts fa ON fa.workspace_id=fc.workspace_id AND fa.external_id=fc.account_id WHERE fc.workspace_id=e.workspace_id AND fc.external_id=COALESCE(e.campaign_id,c.campaign_id) AND fa.selected=true) AND (COALESCE(e.occurred_at,e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date AND ($4::text IS NULL OR COALESCE(e.campaign_id,c.campaign_id)=$4) AND ($5::text IS NULL OR COALESCE(e.adset_id,c.adset_id)=$5) AND ($6::text IS NULL OR COALESCE(e.ad_id,c.ad_id)=$6) GROUP BY e.event_name`,
      values,
    ),
    query('SELECT last_sync_at,expires_at FROM meta_connections WHERE workspace_id=$1', [w.id]),
  ]);
  const campaignSales = await query(
    `SELECT campaign_id,count(*)::int AS sales,sum(amount)::float8 AS revenue FROM orders WHERE ${orderFilter} AND status='approved' GROUP BY campaign_id`,
    values,
  );
  const total = (status: string) =>
    totals.find((t) => t.status === status) || { count: 0, amount: 0, unattributed: 0 };
  const approved = total('approved'),
    refund = total('refunded'),
    chargeback = total('chargeback');
  const spend = insights.reduce((a, c) => a + c.spend, 0),
    clicks = insights.reduce((a, c) => a + c.clicks, 0);
  const series: DashboardData['series'] = [];
  for (
    let time = Date.parse(f.start + 'T12:00:00Z');
    time <= Date.parse(f.end + 'T12:00:00Z');
    time += 86400000
  ) {
    const day = new Date(time).toISOString().slice(0, 10);
    series.push({
      date: day,
      label: `${day.slice(8)}/${day.slice(5, 7)}`,
      revenue: seriesOrders.find((s) => s.day === day)?.revenue || 0,
      spend: seriesSpend.find((s) => s.day === day)?.spend || 0,
    });
  }
  const [costRow] = await query('SELECT * FROM cost_settings WHERE workspace_id=$1', [w.id]);
  const costs = estimateCosts(
    approved.amount,
    spend,
    approved.count,
    series.length,
    costRow
      ? {
          salesTaxBps: costRow.sales_tax_bps,
          feeBps: costRow.fee_bps,
          adTaxBps: costRow.ad_tax_bps,
          productCost: Number(costRow.product_cost),
          dailyExpenses: Number(costRow.daily_expenses),
        }
      : defaultCosts,
    !!(f.campaign || f.adset || f.ad),
  );
  const financialOrders = await query(
    `SELECT amount,provider_fees,commission_breakdown FROM orders WHERE ${orderFilter} AND status='approved'`,
    values,
  );
  const finance = financialSummary(
    financialOrders as Parameters<typeof financialSummary>[0],
    w.cakto_account_email,
    costRow?.fee_bps || 0,
  );
  const [productsSummary, paymentRows] = await Promise.all([
    query(
      `SELECT product AS name,count(*)::int AS sales,sum(amount)::float8 AS revenue FROM orders WHERE ${orderFilter} AND status='approved' GROUP BY product ORDER BY sum(amount) DESC LIMIT 20`,
      values,
    ),
    query(
      `SELECT COALESCE(payment_method,'Não informado') AS method,count(*) FILTER(WHERE status='approved' OR purchased_at IS NOT NULL)::int AS approved,count(*)::int AS total FROM orders WHERE ${orderFilter} GROUP BY payment_method ORDER BY count(*) DESC`,
      values,
    ),
  ]);
  const financials = {
    productsSummary: productsSummary as { name: string; sales: number; revenue: number }[],
    paymentSummary: paymentRows.map((row) => ({
      method: row.method as string,
      approved: row.approved as number,
      total: row.total as number,
      rate: row.total ? (row.approved / row.total) * 100 : 0,
    })),
    gross: approved.amount + refund.amount + chargeback.amount,
    net: finance.net,
    netEstimated: finance.estimated,
    fees: finance.fees,
    feesEstimated: approved.count === 0 || finance.reportedFees !== approved.count,
    refunded: refund.amount,
    chargebackAmount: chargeback.amount,
    pending: total('pending').amount,
    confirmedNetOrders: finance.confirmed,
    ticket: approved.count ? Math.round(approved.amount / approved.count) : 0,
    taxes: costs.taxes,
    adTax: costs.adTax,
    products: costs.products,
    expenses: costs.expenses,
  };
  return {
    eventMetrics: events.map((e) => ({
      name: e.event_name,
      rawEvents: e.count,
      uniqueSessions: e.sessions,
      eventsWithoutSession: e.missing_sessions,
      attributedEvents: e.attributed,
      uniqueUsers: null,
    })),
    financials,
    workspaceId: w.id,
    demo: false,
    workspace: w.name,
    userName: w.user_name,
    lastSync: connection[0]?.last_sync_at?.toISOString() || null,
    metaConnected: !!connection[0] && new Date(connection[0].expires_at) > new Date(),
    caktoConnected: !!w.cakto_secret,
    summary: {
      revenue: approved.amount,
      spend,
      profit: finance.net - spend - (costs.total - costs.fees),
      costs: approved.amount - finance.net + costs.total - costs.fees,
      roas: spend ? approved.amount / spend : 0,
      cpa: approved.count ? spend / approved.count : 0,
      sales: approved.count,
      refundRate:
        approved.count + refund.count + chargeback.count
          ? (refund.count / (approved.count + refund.count + chargeback.count)) * 100
          : 0,
      refunded: refund.amount,
      pending: total('pending').amount,
      chargebacks: chargeback.count,
      attributed: approved.count - approved.unattributed,
      unattributed: approved.unattributed,
      clicks,
      pageviews: insights.reduce((sum, row) => sum + row.landing_page_views, 0),
      checkouts: events.find((e) => e.event_name === 'InitiateCheckout')?.count || 0,
    },
    series,
    campaigns: campaigns
      .filter(
        (c) =>
          (!f.campaign || c.external_id === f.campaign) &&
          (!f.adset || adsets.some((a) => a.id === f.adset && a.campaignId === c.external_id)) &&
          (!f.ad ||
            ads.some(
              (a) =>
                a.id === f.ad &&
                adsets.some((s) => s.id === a.adsetId && s.campaignId === c.external_id),
            )),
      )
      .map((c): Campaign => {
        const insight = insights.find((i) => i.campaign_id === c.external_id),
          sales = campaignSales.find((s) => s.campaign_id === c.external_id);
        return {
          id: c.external_id,
          name: c.name,
          status: c.status,
          dailyBudget: c.daily_budget === null ? null : Number(c.daily_budget),
          spend: insight?.spend || 0,
          revenue: sales?.revenue || 0,
          sales: sales?.sales || 0,
          clicks: insight?.clicks || 0,
          impressions: insight?.impressions || 0,
          adsets: adsets.filter((a) => a.campaignId === c.external_id).length,
          accountId: c.account_id,
        };
      }),
    sales: orders.map((s): Sale => ({
      id: s.id,
      externalId: s.external_id,
      product: s.product,
      status: s.status,
      amount: Number(s.amount),
      campaignId: s.campaign_id,
      campaign: s.campaign || 'Sem atribuição',
      ad: s.ad || '—',
      attribution: s.attribution,
      paymentMethod: s.payment_method || '—',
      date: new Date(s.purchased_at || s.occurred_at).toISOString(),
    })),
    filters: {
      campaigns: campaigns.map((c) => ({ id: c.external_id, name: c.name })),
      adsets: adsets as DashboardData['filters']['adsets'],
      ads: ads as DashboardData['filters']['ads'],
    },
  };
}
