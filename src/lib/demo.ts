import type { DashboardData, Campaign, Sale } from './types';
export function demoData(days = 7, campaignId = ''): DashboardData {
  const names = [
    '[CBO] Escala · Método Essencial',
    '[ABO] Prospecção · Público aberto',
    '[CBO] Remarketing · 7 dias',
    '[ABO] Criativos · Teste A/B',
    '[CBO] Lookalike · Compradores',
  ];
  const campaigns: Campaign[] = names.map((name, i) => ({
    id: String(120210010000 + i),
    name,
    status: i === 3 ? 'PAUSED' : 'ACTIVE',
    dailyBudget: [30000, 20000, 12000, 15000, 18000][i],
    spend: 0,
    revenue: 0,
    sales: 0,
    clicks: 0,
    impressions: 0,
    adsets: [3, 2, 2, 4, 2][i],
    accountId: 'act_demo',
  }));
  const products = ['Método Essencial', 'Mentoria Avançada', 'Kit de Templates'];
  const prices = [19700, 49700, 9700];
  const sales: Sale[] = [];
  const series: DashboardData['series'] = [];
  for (let d = days - 1; d >= 0; d--) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - d);
    date.setUTCHours(15, 0, 0, 0);
    const day = date.toISOString().slice(0, 10);
    let revenue = 0,
      spend = 0;
    campaigns.forEach((c, i) => {
      const cost = Math.round((16000 + i * 1200) * (1 + Math.sin(d * 0.8 + i) * 0.2));
      c.spend += cost;
      spend += cost;
      c.clicks += Math.round(cost / 78);
      c.impressions += Math.round(cost / 2.7);
      const count = 6 + ((d + i * 2) % 7);
      for (let k = 0; k < count; k++) {
        const p = (d + i + k) % 3,
          refunded = (d * 13 + i * 17 + k) % 41 === 0,
          pending = (d + i + k * 9) % 29 === 0,
          chargeback = (d * 3 + i + k * 5) % 127 === 0;
        const status = refunded
          ? 'refunded'
          : chargeback
            ? 'chargeback'
            : pending
              ? 'pending'
              : 'approved';
        const untracked = (d * 5 + i + k) % 13 === 0;
        sales.push({
          id: `demo-${d}-${i}-${k}`,
          externalId: `CK${96240 + d * 100 + i * 10 + k}`,
          product: products[p],
          status,
          amount: prices[p],
          campaignId: untracked ? null : c.id,
          campaign: untracked ? 'Sem atribuição' : c.name,
          ad: untracked ? '—' : `Vídeo ${i + 1} · Criativo ${(k % 3) + 1}`,
          attribution: untracked ? 'unattributed' : k % 3 === 0 ? 'utm' : 'click',
          paymentMethod: k % 3 === 0 ? 'credit_card' : 'pix',
          date: new Date(date.getTime() + i * 600000 + k * 30000).toISOString(),
        });
        if (status === 'approved') {
          revenue += prices[p];
          if (!untracked) {
            c.revenue += prices[p];
            c.sales++;
          }
        }
      }
    });
    series.push({ date: day, label: `${day.slice(8)}/${day.slice(5, 7)}`, revenue, spend });
  }
  const filteredSales = campaignId ? sales.filter((s) => s.campaignId === campaignId) : sales;
  const filteredCampaigns = campaignId ? campaigns.filter((c) => c.id === campaignId) : campaigns;
  const filteredSeries = campaignId
    ? series.map((point, index) => ({
        ...point,
        revenue: filteredSales
          .filter((s) => s.status === 'approved' && s.date.startsWith(point.date))
          .reduce((sum, s) => sum + s.amount, 0),
        spend: filteredCampaigns.reduce((sum, c) => {
          const i = campaigns.findIndex((x) => x.id === c.id),
            d = days - 1 - index;
          return sum + Math.round((16000 + i * 1200) * (1 + Math.sin(d * 0.8 + i) * 0.2));
        }, 0),
      }))
    : series;
  const approved = filteredSales.filter((s) => s.status === 'approved'),
    refunded = filteredSales.filter((s) => s.status === 'refunded'),
    lost = filteredSales.filter((s) => ['refunded', 'chargeback'].includes(s.status));
  const revenue = approved.reduce((a, s) => a + s.amount, 0),
    spend = filteredCampaigns.reduce((a, c) => a + c.spend, 0);
  return {
    demo: true,
    workspace: 'Workspace demonstração',
    userName: 'Visitante',
    lastSync: null,
    metaConnected: false,
    caktoConnected: false,
    summary: {
      revenue,
      spend,
      profit: revenue - spend - Math.round(revenue * 0.119),
      costs: Math.round(revenue * 0.119),
      roas: spend ? revenue / spend : 0,
      cpa: approved.length ? spend / approved.length : 0,
      sales: approved.length,
      refundRate:
        approved.length + lost.length
          ? (refunded.length / (approved.length + lost.length)) * 100
          : 0,
      refunded: refunded.reduce((a, s) => a + s.amount, 0),
      pending: filteredSales
        .filter((s) => s.status === 'pending')
        .reduce((a, s) => a + s.amount, 0),
      chargebacks: filteredSales.filter((s) => s.status === 'chargeback').length,
      unattributed: approved.filter((s) => !s.campaignId).length,
      attributed: approved.filter((s) => s.campaignId).length,
      clicks: filteredCampaigns.reduce((a, c) => a + c.clicks, 0),
      pageviews: Math.round(filteredCampaigns.reduce((a, c) => a + c.clicks, 0) * 0.81),
      checkouts: Math.round(filteredSales.length * 2.2),
    },
    series: filteredSeries,
    campaigns: filteredCampaigns,
    sales: filteredSales.sort((a, b) => b.date.localeCompare(a.date)),
    filters: {
      campaigns: campaigns.map((c) => ({ id: c.id, name: c.name })),
      adsets: campaigns.map((c, i) => ({
        id: `set-${i}`,
        name: `Público ${i + 1} · Brasil`,
        campaignId: c.id,
      })),
      ads: campaigns.map((c, i) => ({
        id: `ad-${i}`,
        name: `Vídeo ${i + 1}`,
        adsetId: `set-${i}`,
      })),
    },
  };
}
