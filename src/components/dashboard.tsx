'use client';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CircleDollarSign,
  Code2,
  Copy,
  ExternalLink,
  Filter,
  Layers3,
  LayoutDashboard,
  Link2,
  Loader2,
  LogOut,
  Menu,
  MoreHorizontal,
  MousePointer2,
  Pause,
  Play,
  Plug,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/client-api';
import {
  DashboardLayoutSettings,
  LayoutSection,
  OverviewLayout,
  useDashboardLayout,
} from './dashboard-layout';
import { ConversionFunnel } from './conversion-funnel';
import { Modal } from './ui/modal';
import { CostSettings } from './cost-settings';
import { Button } from './ui/button';
import { RevenueChart, AttributionChart } from './charts';
import { demoData } from '@/lib/demo';
import { money, number, percent, dateRange } from '@/lib/format';
import type { Campaign, DashboardData, Sale } from '@/lib/types';
type Tab = 'overview' | 'campaigns' | 'sales' | 'tracking' | 'integrations' | 'utms' | 'settings';
type Integration = {
  publicKey: string;
  webhookUrl: string;
  pixelUrl: string;
  connection: { expires_at: string; last_sync_at: string | null } | null;
  accounts: {
    external_id: string;
    name: string;
    currency: string;
    timezone: string;
    selected: boolean;
  }[];
  jobs: {
    kind: string;
    status: string;
    attempts: number;
    last_error: string | null;
    created_at: string;
  }[];
  allowedOrigins: string[];
  caktoConfigured: boolean;
  caktoAccountEmail?: string;
  pixelId: string | null;
  capiConfigured: boolean;
  testEventCode: string | null;
};
const nav: { id: Tab; label: string; icon: LucideIcon; tag?: string }[] = [
  { id: 'overview', label: 'Visão geral', icon: LayoutDashboard },
  { id: 'campaigns', label: 'Meta Ads', icon: Layers3 },
  { id: 'sales', label: 'Vendas', icon: ShoppingBag },
  { id: 'tracking', label: 'Rastreamento', icon: Radio },
  { id: 'integrations', label: 'Integrações', icon: Plug, tag: '2' },
  { id: 'utms', label: 'Gerador de UTMs', icon: Link2 },
];
const statusNames: Record<string, string> = {
  approved: 'Aprovada',
  pending: 'Pendente',
  refunded: 'Reembolsada',
  chargeback: 'Chargeback',
  refused: 'Recusada',
};
function Logo() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Activity size={22} strokeWidth={2.5} />
      </span>
      <span>
        meta<span className="brand-light">track</span>
        <span className="brand-dot">.</span>
      </span>
    </div>
  );
}
function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <BarChart3 size={28} />
      </div>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
function Csv({ sales }: { sales: Sale[] }) {
  function download() {
    const cells = [
      ['ID', 'Produto', 'Status', 'Valor BRL', 'Campanha', 'Anúncio', 'Atribuição', 'Data'],
      ...sales.map((s) => [
        s.externalId,
        s.product,
        statusNames[s.status],
        (s.amount / 100).toFixed(2),
        s.campaign,
        s.ad,
        s.attribution,
        s.date,
      ]),
    ];
    const text =
      '\uFEFF' +
      cells
        .map((row) =>
          row
            .map(
              (v) =>
                '"' +
                String(v)
                  .replace(/^[=+@\-\t\r]/, "'$&")
                  .replaceAll('"', '""') +
                '"',
            )
            .join(';'),
        )
        .join('\r\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'metatrack-vendas.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Button variant="outline" size="sm" onClick={download}>
      <ArrowDownToLine size={15} />
      Exportar CSV
    </Button>
  );
}
export function Dashboard({ initial }: { initial: DashboardData }) {
  const [data, setData] = useState(initial),
    [tab, setTab] = useState<Tab>('overview'),
    [period, setPeriod] = useState('7'),
    [range, setRange] = useState(dateRange(7)),
    [campaign, setCampaign] = useState(''),
    [adset, setAdset] = useState(''),
    [ad, setAd] = useState(''),
    [advanced, setAdvanced] = useState(false),
    [search, setSearch] = useState(''),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(''),
    [notice, setNotice] = useState(false),
    [mobile, setMobile] = useState(false),
    [modal, setModal] = useState<{
      campaign: Campaign;
      action: 'budget' | 'duplicate' | 'status';
      kind?: 'campaign' | 'adset';
    } | null>(null),
    [budget, setBudget] = useState(''),
    [saleStatus, setSaleStatus] = useState('all'),
    [selectedSale, setSelectedSale] = useState<Sale | null>(null),
    [page, setPage] = useState(0);
  const [integration, setIntegration] = useState<Integration | null>(null),
    [entityLevel, setEntityLevel] = useState<'campaign' | 'adset' | 'ad'>('campaign'),
    [entities, setEntities] = useState<Campaign[]>([]);
  const demo = initial.demo;
  function notify(message: string) {
    setToast(message);
  }
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('tab');
    if ([...nav.map((n) => n.id), 'settings'].includes(id || '')) setTab(id as Tab);
  }, []);
  function changeTab(t: Tab) {
    setTab(t);
    setSearch('');
    setPage(0);
    setMobile(false);
    history.replaceState(null, '', `?tab=${t}`);
  }
  async function refresh() {
    if (demo) {
      setData(demoData(Number(period) || 7, campaign));
      notify('Dados de demonstração atualizados.');
      return;
    }
    setBusy(true);
    try {
      setData(
        await api(
          `/api/dashboard?${new URLSearchParams({ ...range, ...(campaign ? { campaign } : {}), ...(adset ? { adset } : {}), ...(ad ? { ad } : {}) })}`,
        ),
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (demo) {
      setData(demoData(Number(period) || 7, campaign));
      return;
    }
    let cancelled = false;
    setBusy(true);
    api(
      `/api/dashboard?${new URLSearchParams({ ...range, ...(campaign ? { campaign } : {}), ...(adset ? { adset } : {}), ...(ad ? { ad } : {}) })}`,
    )
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) notify(e.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [demo, period, range.start, range.end, campaign, adset, ad]);
  async function loadIntegration() {
    if (demo) return;
    try {
      setIntegration(await api('/api/integrations'));
    } catch (e) {
      notify((e as Error).message);
    }
  }
  useEffect(() => {
    if (['integrations', 'tracking', 'settings'].includes(tab)) void loadIntegration();
  }, [tab]);
  useEffect(() => {
    if (tab !== 'campaigns' || entityLevel === 'campaign') return;
    if (demo) {
      setEntities(
        data.campaigns.map((c, i) => ({
          ...c,
          id: entityLevel === 'adset' ? `set-${i}` : `ad-${i}`,
          name:
            entityLevel === 'adset' ? `Público aberto · ${c.name}` : `Vídeo ${i + 1} · ${c.name}`,
        })),
      );
      return;
    }
    api(
      `/api/meta/entities?${new URLSearchParams({ ...range, level: entityLevel, ...(campaign ? { campaign } : {}) })}`,
    )
      .then(setEntities)
      .catch((e) => notify(e.message));
  }, [tab, entityLevel, demo, data, range.start, range.end, campaign]);
  async function manage() {
    if (!modal) return;
    setBusy(true);
    try {
      const c = modal.campaign;
      if (demo) {
        if (modal.action === 'duplicate')
          setData((d) => ({
            ...d,
            campaigns: [
              ...d.campaigns,
              {
                ...c,
                id: `demo-${Date.now()}`,
                name: c.name + ' — cópia',
                status: 'PAUSED',
                spend: 0,
                revenue: 0,
                sales: 0,
                clicks: 0,
                impressions: 0,
              },
            ],
          }));
        else {
          const update = (items: Campaign[]) =>
            items.map((x) =>
              x.id === c.id
                ? {
                    ...x,
                    ...(modal.action === 'status'
                      ? { status: c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }
                      : { dailyBudget: Math.round(Number(budget) * 100) }),
                  }
                : x,
            );
          if (modal.kind === 'adset') setEntities(update);
          else setData((d) => ({ ...d, campaigns: update(d.campaigns) }));
        }
        notify('Alteração aplicada apenas na demonstração.');
      } else {
        await api('/api/meta/manage', {
          kind: modal.kind || 'campaign',
          id: c.id,
          action: modal.action,
          ...(modal.action === 'status'
            ? { value: c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }
            : modal.action === 'budget'
              ? { value: Math.round(Number(budget) * 100) }
              : {}),
        });
        notify(
          modal.action === 'duplicate'
            ? 'Cópia criada pausada. Sincronização enfileirada.'
            : 'Alteração confirmada pela Meta.',
        );
        await refresh();
      }
      setModal(null);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const shownCampaigns = (entityLevel === 'campaign' ? data.campaigns : entities).filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );
  const shownSales = useMemo(
    () =>
      data.sales.filter(
        (s) =>
          (saleStatus === 'all' || s.status === saleStatus) &&
          `${s.externalId} ${s.product} ${s.campaign}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [data.sales, saleStatus, search],
  );
  const layout = useDashboardLayout(
    data.workspaceId || (demo ? 'demo' : `workspace:${data.workspace}`),
  );
  const s = data.summary,
    margin = s.revenue ? (s.profit / s.revenue) * 100 : 0;
  const title =
    tab === 'settings' ? 'Meu workspace' : nav.find((n) => n.id === tab)?.label || 'Visão geral';
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify('Copiado para a área de transferência.');
    } catch {
      notify('O navegador bloqueou a cópia. Selecione o texto e copie manualmente.');
    }
  }
  const metrics = [
    {
      label: 'Faturamento aprovado atual',
      value: money(s.revenue),
      icon: CircleDollarSign,
      note: 'Vendas confirmadas pela Cakto',
      color: 'green',
    },
    {
      label: 'Investimento em anúncios',
      value: money(s.spend),
      icon: Wallet,
      note: 'Gasto sincronizado do Meta Ads',
      color: 'blue',
    },
    {
      label: 'ROAS real',
      value: `${s.roas.toFixed(2).replace('.', ',')}x`,
      icon: TrendingUp,
      note: 'Faturamento ÷ investimento',
      color: 'purple',
    },
    {
      label: 'Lucro líquido estimado',
      value: money(s.profit),
      icon: ArrowUpRight,
      note: `${percent(margin)} de margem · custos configurados`,
      color: s.profit >= 0 ? 'green' : 'red',
    },
  ];
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="mobile-scrim"
          aria-label="Fechar menu"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? 'mobile-open' : ''}`}>
        <Link href="/" aria-label="MetaTrack início">
          <Logo />
        </Link>
        <button className="workspace-switch" onClick={() => changeTab('settings')}>
          <span className="workspace-avatar">M</span>
          <span>
            <strong>Meu workspace</strong>
            <small>{demo ? 'Ambiente de demonstração' : 'Conta de rastreamento'}</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <p className="nav-caption">WORKSPACE</p>
        <nav>
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${tab === item.id ? 'active' : ''}`}
              onClick={() => changeTab(item.id)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.tag && <small>{item.tag}</small>}
              {tab === item.id && <span className="active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="tracking-tip">
            <div className="tip-icon">
              <ShieldCheck size={19} />
              <span>Seus dados, sua verdade.</span>
            </div>
            <p>
              Mais clareza para investir.
              <br />
              Mais precisão para crescer.
            </p>
            <button onClick={() => changeTab('tracking')}>
              Conheça o rastreamento
              <ArrowUpRight size={14} />
            </button>
          </div>
          <button
            className={`nav-item ${tab === 'settings' ? 'active' : ''}`}
            onClick={() => changeTab('settings')}
          >
            <Settings2 size={18} />
            <span>Configurações</span>
          </button>
          <a className="nav-item" href="/guide">
            <CircleHelp size={18} />
            <span>Central de ajuda</span>
            <ExternalLink size={13} />
          </a>
          <div className="sidebar-version">
            <span className="online-dot" />
            MetaTrack <span>v1.0</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button className="mobile-menu" onClick={() => setMobile(true)} aria-label="Abrir menu">
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <span className="secure-label">
              <ShieldCheck size={14} /> Conexão segura
            </span>
            <div className="topbar-divider" />
            <button
              className="icon-button notification"
              aria-label="Notificações"
              onClick={() => setNotice(!notice)}
            >
              <Bell size={19} />
              <i />
            </button>
            <button className="user-button" onClick={() => changeTab('settings')}>
              <span className="user-avatar">
                {demo ? 'MT' : data.userName.slice(0, 2).toUpperCase()}
              </span>
              <span>
                <strong>{demo ? 'Olá, visitante' : data.userName}</strong>
                <small>{demo ? 'Conheça o MetaTrack' : 'Meu workspace'}</small>
              </span>
              <ChevronDown size={14} />
            </button>
          </div>
          {notice && (
            <div className="notification-popover">
              <strong>Central de notificações</strong>
              <p>
                {demo
                  ? 'Você está explorando dados ilustrativos. Crie sua conta para começar a receber vendas.'
                  : data.lastSync
                    ? `Última sincronização: ${new Date(data.lastSync).toLocaleString('pt-BR')}`
                    : 'Conecte a Meta e selecione suas contas para iniciar a sincronização.'}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  changeTab('integrations');
                  setNotice(false);
                }}
              >
                Ver integrações
                <ArrowRight size={14} />
              </Button>
            </div>
          )}
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="online-dot" />
                INTELIGÊNCIA DE VENDAS PARA META ADS
              </div>
              <h1>
                {title}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {tab === 'overview'
                  ? 'Cada clique tem uma história. Veja quais realmente viraram vendas.'
                  : tab === 'campaigns'
                    ? 'Decida com base na receita real de cada campanha.'
                    : tab === 'sales'
                      ? 'Da primeira interação à venda aprovada. Tudo conectado.'
                      : tab === 'integrations'
                        ? 'Conecte as pontas da sua operação em poucos passos.'
                        : tab === 'tracking'
                          ? 'Acompanhe sua estrutura de rastreamento de ponta a ponta.'
                          : tab === 'utms'
                            ? 'Dê um endereço de origem a cada conversão.'
                            : 'Sua operação, organizada e protegida.'}
              </p>
            </div>
            <div className="heading-actions">
              {tab === 'overview' && (
                <DashboardLayoutSettings controller={layout} notify={notify} />
              )}
              {demo ? (
                <Link href="/login" className="button button-primary">
                  <Plus size={16} />
                  Conectar minha operação
                </Link>
              ) : (
                <Button
                  variant="outline"
                  onClick={async () => {
                    await api('/api/auth/logout', {});
                    location.href = '/';
                  }}
                >
                  <LogOut size={15} />
                  Sair
                </Button>
              )}
            </div>
          </div>
          {demo && (
            <div className="demo-banner">
              <span className="demo-badge">
                <Sparkles size={13} />
                DEMONSTRAÇÃO
              </span>
              <span>
                Explore o MetaTrack com dados ilustrativos. Suas contas ainda não estão conectadas.
              </span>
              <Link href="/login">
                Começar agora
                <ArrowRight size={14} />
              </Link>
            </div>
          )}
          {['overview', 'campaigns', 'sales'].includes(tab) && (
            <div className="filter-bar">
              <div className="filter-left">
                <span className="filter-icon">
                  <SlidersHorizontal size={17} />
                </span>
                <div className="select-wrap period-select">
                  <CalendarDays size={15} />
                  <select
                    aria-label="Período"
                    value={period}
                    onChange={(e) => {
                      setPeriod(e.target.value);
                      if (e.target.value === 'custom') setAdvanced(true);
                      if (e.target.value !== 'custom') setRange(dateRange(Number(e.target.value)));
                      setPage(0);
                    }}
                  >
                    <option value="1">Hoje</option>
                    <option value="7">Últimos 7 dias</option>
                    <option value="14">Últimos 14 dias</option>
                    <option value="30">Últimos 30 dias</option>
                    {!demo && <option value="custom">Personalizado</option>}
                  </select>
                </div>
                <div className="filter-separator" />
                <div className="select-wrap">
                  <Layers3 size={15} />
                  <select
                    aria-label="Campanha"
                    value={campaign}
                    onChange={(e) => {
                      setCampaign(e.target.value);
                      setAdset('');
                      setAd('');
                      setPage(0);
                    }}
                  >
                    <option value="">Todas as campanhas</option>
                    {data.filters.campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  className={`text-button ${advanced ? 'accent' : ''}`}
                  onClick={() => setAdvanced(!advanced)}
                >
                  <Filter size={14} />
                  Mais filtros{(adset || ad) && <i className="online-dot" />}
                </button>
              </div>
              <Button variant="outline" size="sm" disabled={busy} onClick={refresh}>
                <RefreshCw size={14} className={busy ? 'spin' : ''} />
                Atualizar
              </Button>
            </div>
          )}
          {advanced && ['overview', 'campaigns', 'sales'].includes(tab) && (
            <div className="advanced-filters">
              {period === 'custom' && (
                <>
                  <label>
                    Início
                    <input
                      type="date"
                      value={range.start}
                      onChange={(e) => setRange({ ...range, start: e.target.value })}
                    />
                  </label>
                  <label>
                    Fim
                    <input
                      type="date"
                      value={range.end}
                      onChange={(e) => setRange({ ...range, end: e.target.value })}
                    />
                  </label>
                </>
              )}
              <label>
                Conjunto
                <select
                  value={adset}
                  disabled={demo}
                  onChange={(e) => {
                    setAdset(e.target.value);
                    setAd('');
                  }}
                >
                  <option value="">Todos os conjuntos</option>
                  {data.filters.adsets
                    .filter((a) => !campaign || a.campaignId === campaign)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Anúncio
                <select value={ad} disabled={demo} onChange={(e) => setAd(e.target.value)}>
                  <option value="">Todos os anúncios</option>
                  {data.filters.ads
                    .filter((a) => !adset || a.adsetId === adset)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
              <span className="muted text-xs">
                {demo
                  ? 'Filtros por conjunto e anúncio disponíveis com sua conta conectada.'
                  : 'Fuso: America/Sao_Paulo · moeda: BRL'}
              </span>
              <button
                className="text-button"
                onClick={() => {
                  setCampaign('');
                  setAdset('');
                  setAd('');
                }}
              >
                Limpar filtros
              </button>
            </div>
          )}
          {tab === 'overview' && (
            <>
              <div className="section-label">
                <span>
                  <span className="live-dot" />
                  {demo ? 'SUA OPERAÇÃO, EM PERSPECTIVA' : 'RESUMO DA OPERAÇÃO'}
                </span>
                <small>
                  {demo
                    ? 'Exemplo ilustrativo'
                    : data.lastSync
                      ? `Meta sincronizada em ${new Date(data.lastSync).toLocaleString('pt-BR')}`
                      : 'Aguardando primeira sincronização'}
                </small>
              </div>
              <OverviewLayout preferences={layout.preferences}>
                <LayoutSection id="metrics">
                  <div className="metric-grid">
                    {metrics.map((m) => (
                      <div className={`metric-card ${m.color}`} key={m.label}>
                        <div className="metric-top">
                          <span>{m.label}</span>
                          <span className="metric-icon">
                            <m.icon size={17} />
                          </span>
                        </div>
                        <strong>{m.value}</strong>
                        <div className="metric-note">{m.note}</div>
                      </div>
                    ))}
                  </div>
                </LayoutSection>
                <LayoutSection id="financials">
                  {data.financials && (
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Financeiro Cakto</h2>
                          <p>
                            Vendas no período selecionado; não representa saldo disponível para
                            saque.
                          </p>
                        </div>
                      </div>
                      <div className="metric-grid" style={{ padding: 20 }}>
                        {[
                          [
                            'Bruto de vendas',
                            data.financials.gross,
                            'Aprovadas, reembolsadas e chargebacks; exclui pendentes',
                          ],
                          [
                            data.financials.netEstimated
                              ? 'Líquido estimado'
                              : 'Líquido informado pela Cakto',
                            data.financials.net,
                            `${data.financials.confirmedNetOrders} de ${s.sales} vendas com comissão identificada`,
                          ],
                          [
                            data.financials.feesEstimated
                              ? 'Taxas da plataforma · estimadas em parte'
                              : 'Taxas informadas pela Cakto',
                            data.financials.fees,
                            'Taxas reais quando recebidas; configuração para valores ausentes',
                          ],
                          [
                            'Vendas pendentes',
                            data.financials.pending,
                            'Não incluídas no faturamento',
                          ],
                          [
                            'Reembolsos',
                            data.financials.refunded,
                            'Pedidos reembolsados no grupo de vendas do período',
                          ],
                          [
                            'Chargebacks',
                            data.financials.chargebackAmount,
                            'Pedidos contestados; excluídos do líquido',
                          ],
                          [
                            'Ticket médio aprovado',
                            data.financials.ticket,
                            'Faturamento aprovado atual ÷ vendas aprovadas',
                          ],
                          [
                            'Impostos sobre vendas',
                            data.financials.taxes,
                            'Estimativa conforme configuração',
                          ],
                          [
                            'Imposto sobre anúncios',
                            data.financials.adTax,
                            'Estimativa conforme configuração',
                          ],
                          [
                            'Custo dos produtos',
                            data.financials.products,
                            'Custo configurado por venda aprovada',
                          ],
                          [
                            'Despesas adicionais',
                            data.financials.expenses,
                            'Despesas diárias; não rateadas com filtro de campanha',
                          ],
                        ].map(([label, value, note]) => (
                          <div className="metric-card" key={String(label)}>
                            <div className="metric-top">
                              <span>{label}</span>
                            </div>
                            <strong>{money(Number(value))}</strong>
                            <div className="metric-note">{note}</div>
                          </div>
                        ))}
                      </div>
                      <div className="bottom-grid" style={{ padding: 20 }}>
                        <div className="table-scroll">
                          <h3>Vendas por produto</h3>
                          <table>
                            <thead>
                              <tr>
                                <th>PRODUTO</th>
                                <th>APROVADAS</th>
                                <th>FATURAMENTO</th>
                              </tr>
                            </thead>
                            <tbody>
                              {data.financials.productsSummary.map((product) => (
                                <tr key={product.name}>
                                  <td>{product.name}</td>
                                  <td>{product.sales}</td>
                                  <td>{money(product.revenue)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {!data.financials.productsSummary.length && (
                            <p>Nenhuma venda aprovada no período.</p>
                          )}
                        </div>
                        <div className="table-scroll">
                          <h3>Aprovação por pagamento</h3>
                          <table>
                            <thead>
                              <tr>
                                <th>MEIO</th>
                                <th>APROVADOS / PEDIDOS</th>
                                <th>TAXA</th>
                              </tr>
                            </thead>
                            <tbody>
                              {data.financials.paymentSummary.map((payment) => (
                                <tr key={payment.method}>
                                  <td>{payment.method}</td>
                                  <td>
                                    {payment.approved} / {payment.total}
                                  </td>
                                  <td>{percent(payment.rate)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p>
                            Inclui pedidos aprovados posteriormente reembolsados quando há data de
                            aprovação registrada.
                          </p>
                        </div>
                      </div>
                      <div className="panel-footnote">
                        Líquido confirmado usa sua comissão no webhook, sem descontar as taxas
                        novamente. Estimativas não incluem comissões desconhecidas. ROAS usa
                        faturamento aprovado antes de custos.
                      </div>
                    </section>
                  )}
                </LayoutSection>
                <LayoutSection id="secondary">
                  <div className="secondary-metrics">
                    <div>
                      <span className="secondary-icon">
                        <ShoppingBag size={18} />
                      </span>
                      <span>
                        <small>Vendas aprovadas</small>
                        <strong>
                          {number(s.sales)}
                          <em>pedidos confirmados</em>
                        </strong>
                      </span>
                    </div>
                    <div>
                      <span className="secondary-icon">
                        <Target size={18} />
                      </span>
                      <span>
                        <small>CPA real</small>
                        <strong>
                          {money(s.cpa)}
                          <em>por venda aprovada</em>
                        </strong>
                      </span>
                    </div>
                    <div>
                      <span className="secondary-icon">
                        <ArrowDownLeft size={18} />
                      </span>
                      <span>
                        <small>Taxa de reembolso</small>
                        <strong>
                          {percent(s.refundRate)}
                          <em>{money(s.refunded)} reembolsados</em>
                        </strong>
                      </span>
                    </div>
                    <div>
                      <span className="secondary-icon">
                        <MousePointer2 size={18} />
                      </span>
                      <span>
                        <small>Vendas atribuídas</small>
                        <strong>
                          {s.sales ? percent((s.attributed / s.sales) * 100) : '—'}
                          <em>{number(s.attributed)} com origem identificada</em>
                        </strong>
                      </span>
                    </div>
                  </div>
                </LayoutSection>
                <LayoutSection id="performance">
                  <section className="panel performance-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>
                          Desempenho de vendas<span className="subtle-badge">BRL</span>
                        </h2>
                        <p>O retorno real do seu investimento, dia a dia.</p>
                      </div>
                      <span className="chart-period">
                        {period === 'custom'
                          ? 'Personalizado'
                          : Number(period) === 1
                            ? 'Hoje'
                            : `Últimos ${period} dias`}
                        <ChevronDown size={13} />
                      </span>
                    </div>
                    <div className="chart-total">
                      <strong>{money(s.revenue)}</strong>
                      <span>em vendas aprovadas</span>
                    </div>
                    <RevenueChart data={data.series} />
                  </section>
                </LayoutSection>
                <LayoutSection id="attribution">
                  <section className="panel attribution-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Atribuição de vendas</h2>
                        <p>Saiba de onde vem seu resultado.</p>
                      </div>
                      <Target size={17} className="muted" />
                    </div>
                    <AttributionChart attributed={s.attributed} unattributed={s.unattributed} />
                    <div className="attribution-legend">
                      <div>
                        <i />
                        <span>Meta Ads</span>
                        <strong>{number(s.attributed)}</strong>
                      </div>
                      <div>
                        <i />
                        <span>Sem atribuição</span>
                        <strong>{number(s.unattributed)}</strong>
                      </div>
                    </div>
                    <div className="attribution-foot">
                      <ShieldCheck size={14} />
                      UTMs + dados de clique no servidor
                    </div>
                  </section>
                </LayoutSection>
                <LayoutSection id="campaigns">
                  <CampaignTable
                    campaigns={data.campaigns.slice(0, 4)}
                    overview
                    onAll={() => changeTab('campaigns')}
                    onManage={(c, a) => {
                      setModal({ campaign: c, action: a });
                      setBudget(String((c.dailyBudget || 0) / 100));
                    }}
                  />
                </LayoutSection>
                <LayoutSection id="funnel">
                  <section className="panel funnel-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>
                          Funil de conversão <span className="subtle-badge">META ADS</span>
                        </h2>
                        <p>Do primeiro clique à venda aprovada.</p>
                      </div>
                      <Activity size={16} className="muted" />
                    </div>
                    <ConversionFunnel
                      clicks={s.clicks}
                      pageviews={s.pageviews}
                      checkouts={s.checkouts}
                      sales={s.sales}
                    />
                    <div className="panel-footnote">
                      Cliques no link e visitas de destino: Meta Ads. Checkouts: pixel MetaTrack.
                      Vendas: Cakto. Etapas agregadas, sem visitantes únicos.
                    </div>
                  </section>
                </LayoutSection>
                <LayoutSection id="connections">
                  <section className="panel connection-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Saúde das integrações</h2>
                        <p>Os pontos de conexão da sua operação.</p>
                      </div>
                      <span className="connection-count">
                        {Number(data.metaConnected) + Number(data.caktoConnected)}/2
                      </span>
                    </div>
                    <div className="health-item">
                      <span className="meta-icon">∞</span>
                      <span>
                        <strong>Meta Ads</strong>
                        <small>Campanhas e investimento</small>
                      </span>
                      <span className={`status-dot ${data.metaConnected ? 'connected' : ''}`} />
                      <small>{data.metaConnected ? 'Conectado' : 'Não conectado'}</small>
                    </div>
                    <div className="health-item">
                      <span className="cakto-icon">C</span>
                      <span>
                        <strong>Cakto</strong>
                        <small>Vendas e reembolsos</small>
                      </span>
                      <span className={`status-dot ${data.caktoConnected ? 'connected' : ''}`} />
                      <small>{data.caktoConnected ? 'Configurado' : 'Não conectado'}</small>
                    </div>
                    <button className="panel-link" onClick={() => changeTab('integrations')}>
                      Gerenciar integrações
                      <ArrowRight size={14} />
                    </button>
                  </section>
                </LayoutSection>
              </OverviewLayout>
            </>
          )}
          {tab === 'campaigns' && (
            <>
              <div className="mini-stats">
                <div>
                  <span>Campanhas</span>
                  <strong>{data.campaigns.length}</strong>
                </div>
                <div>
                  <span>Em veiculação</span>
                  <strong className="accent">
                    {data.campaigns.filter((c) => c.status === 'ACTIVE').length}
                  </strong>
                </div>
                <div>
                  <span>Investimento no período</span>
                  <strong>{money(s.spend)}</strong>
                </div>
                <div>
                  <span>Receita atribuída</span>
                  <strong>{money(data.campaigns.reduce((n, c) => n + c.revenue, 0))}</strong>
                </div>
              </div>
              <section className="panel">
                <div className="table-toolbar">
                  <div className="segmented">
                    {(['campaign', 'adset', 'ad'] as const).map((level, i) => (
                      <button
                        className={entityLevel === level ? 'selected' : ''}
                        key={level}
                        onClick={() => {
                          setEntityLevel(level);
                          setSearch('');
                        }}
                      >
                        {['Campanhas', 'Conjuntos', 'Anúncios'][i]}
                      </button>
                    ))}
                  </div>
                  <div className="search-box">
                    <Search size={15} />
                    <input
                      aria-label="Buscar campanha"
                      placeholder="Buscar por nome..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      if (demo) return notify('Conecte a Meta para sincronizar campanhas reais.');
                      try {
                        const r = await api('/api/meta/sync', {});
                        notify(r.message);
                      } catch (e) {
                        notify((e as Error).message);
                      }
                    }}
                  >
                    <RefreshCw size={14} />
                    Sincronizar Meta
                  </Button>
                </div>
                <CampaignTable
                  embedded
                  campaigns={shownCampaigns}
                  readonly={entityLevel === 'ad'}
                  hideDuplicate={entityLevel === 'adset'}
                  onManage={(c, a) => {
                    setModal({
                      campaign: c,
                      action: a,
                      kind: entityLevel === 'adset' ? 'adset' : 'campaign',
                    });
                    setBudget(String((c.dailyBudget || 0) / 100));
                  }}
                />
                {!shownCampaigns.length && (
                  <Empty
                    title="Nenhuma campanha por aqui"
                    detail="Conecte sua conta Meta, selecione uma conta de anúncios e sincronize."
                    action={
                      <Button onClick={() => changeTab('integrations')}>
                        Conectar Meta Ads
                        <ArrowRight size={15} />
                      </Button>
                    }
                  />
                )}
              </section>
              <div className="info-callout">
                <ShieldCheck size={18} />
                <p>
                  Vendas, faturamento e ROAS são calculados com pedidos aprovados da Cakto.
                  Investimento, cliques e impressões vêm da Meta. Duplicações são criadas pausadas.
                </p>
              </div>
            </>
          )}
          {tab === 'sales' && (
            <section className="panel">
              <div className="table-toolbar">
                <h2>
                  Histórico de vendas <span className="subtle-badge">{shownSales.length}</span>
                </h2>
                <div className="search-box">
                  <Search size={15} />
                  <input
                    aria-label="Buscar venda"
                    placeholder="Produto, campanha ou ID..."
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(0);
                    }}
                  />
                </div>
                <select
                  className="compact-select"
                  aria-label="Status da venda"
                  value={saleStatus}
                  onChange={(e) => {
                    setSaleStatus(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="all">Todos os status</option>
                  {Object.entries(statusNames).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
                <Csv sales={shownSales} />
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>PRODUTO / PEDIDO</th>
                      <th>STATUS</th>
                      <th>ORIGEM DA VENDA</th>
                      <th>VALOR</th>
                      <th>DATA</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shownSales.slice(page * 12, (page + 1) * 12).map((sale) => (
                      <tr key={sale.id}>
                        <td>
                          <strong>{sale.product}</strong>
                          <small>{sale.externalId}</small>
                        </td>
                        <td>
                          <span className={`sale-status ${sale.status}`}>
                            <i />
                            {statusNames[sale.status]}
                          </span>
                        </td>
                        <td className="source-cell">
                          <span>{sale.campaign}</span>
                          <small>{sale.ad}</small>
                        </td>
                        <td className="bold">{money(sale.amount)}</td>
                        <td className="muted">
                          {new Date(sale.date).toLocaleString('pt-BR', {
                            timeZone: 'America/Sao_Paulo',
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`Ver detalhes ${sale.externalId}`}
                            onClick={() => setSelectedSale(sale)}
                          >
                            <ChevronRight size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!shownSales.length && (
                <Empty
                  title="Nenhuma venda encontrada"
                  detail="As vendas aparecem aqui após o recebimento dos webhooks da Cakto."
                />
              )}
              <div className="pagination">
                <span>
                  {shownSales.length
                    ? `${page * 12 + 1}–${Math.min(shownSales.length, (page + 1) * 12)} de ${shownSales.length} vendas`
                    : '0 vendas'}
                  {!demo ? ' · últimos 200 pedidos do período' : ''}
                </span>
                <div>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="Página anterior"
                    disabled={page === 0}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft size={16} />
                  </Button>
                  <span>{page + 1}</span>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="Próxima página"
                    disabled={(page + 1) * 12 >= shownSales.length}
                    onClick={() => setPage(page + 1)}
                  >
                    <ChevronRight size={16} />
                  </Button>
                </div>
              </div>
            </section>
          )}
          {tab === 'integrations' && (
            <Integrations
              demo={demo}
              integration={integration}
              notify={notify}
              reload={loadIntegration}
              copy={copy}
            />
          )}
          {tab === 'tracking' && (
            <>
              <div className="tracking-hero panel">
                <span className="tracking-hero-icon">
                  <Radio size={30} />
                </span>
                <div>
                  <span className="subtle-badge">SERVER-SIDE TRACKING</span>
                  <h2>Conecte cada venda à sua origem.</h2>
                  <p>
                    O pixel registra os cliques consentidos. A Cakto confirma a compra.
                    <br />O servidor conecta os dados e envia a conversão para a Meta.
                  </p>
                </div>
                <Button onClick={() => changeTab('integrations')}>
                  Configurar rastreamento
                  <ArrowRight size={16} />
                </Button>
              </div>
              <div className="pipeline">
                {[
                  {
                    icon: MousePointer2,
                    title: '1. Clique no anúncio',
                    text: 'UTMs identificam campanha, conjunto e anúncio.',
                  },
                  {
                    icon: Code2,
                    title: '2. Pixel MetaTrack',
                    text: 'Identificadores de clique, com consentimento.',
                  },
                  {
                    icon: ShoppingBag,
                    title: '3. Webhook Cakto',
                    text: 'A venda é confirmada pelo servidor da plataforma.',
                  },
                  {
                    icon: Target,
                    title: '4. Meta CAPI',
                    text: 'Conversão enviada com ID de deduplicação.',
                  },
                ].map((p) => (
                  <div className="panel pipeline-card" key={p.title}>
                    <p.icon size={23} />
                    <h3>{p.title}</h3>
                    <p>{p.text}</p>
                  </div>
                ))}
              </div>
              <section className="panel code-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Instale o pixel no seu site</h2>
                    <p>
                      Autorize o domínio em Integrações e inicialize somente após o consentimento.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copy(pixelSnippet(integration))}
                  >
                    <Copy size={14} />
                    Copiar código
                  </Button>
                </div>
                <pre>{pixelSnippet(integration)}</pre>
                <div className="info-callout">
                  <ShieldCheck size={17} />
                  <p>
                    Para preservar a origem no checkout, use{' '}
                    <code>MetaTrack.decorateCheckout(url)</code>. Confirme que a Cakto devolve as
                    UTMs ou o <code>metadata.mt_click</code> no webhook. Sem esses dados, a venda
                    aparecerá sem atribuição.
                  </p>
                </div>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Fila de processamento</h2>
                    <p>Entrega persistente, tentativas automáticas e erros visíveis.</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void loadIntegration();
                      if (demo) notify('O histórico real aparece com sua conta conectada.');
                    }}
                  >
                    <RefreshCw size={14} />
                    Atualizar
                  </Button>
                </div>
                {integration?.jobs.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>TIPO</th>
                          <th>STATUS</th>
                          <th>TENTATIVAS</th>
                          <th>ÚLTIMO ERRO</th>
                        </tr>
                      </thead>
                      <tbody>
                        {integration.jobs.map((j, i) => (
                          <tr key={i}>
                            <td>{j.kind === 'capi' ? 'Meta CAPI' : 'Sincronização Meta'}</td>
                            <td>
                              <span className="subtle-badge">{j.status}</span>
                            </td>
                            <td>{j.attempts}</td>
                            <td className="error-cell">{j.last_error || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title="Aguardando os primeiros eventos"
                    detail="Os eventos recebidos e as tentativas de entrega serão exibidos aqui."
                  />
                )}
              </section>
            </>
          )}
          {tab === 'utms' && <UtmGenerator copy={copy} />}
          {tab === 'settings' && (
            <CostSettings
              demo={demo}
              name={data.workspace}
              notify={notify}
              onSaved={(name) => {
                setData((d) => ({ ...d, workspace: name }));
                void refresh();
              }}
            />
          )}
          {tab === 'settings' && (
            <div className="settings-grid">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Meu workspace</h2>
                    <p>Sua central de rastreamento.</p>
                  </div>
                  <Settings2 size={19} />
                </div>
                <dl className="detail-list">
                  <div>
                    <dt>Nome</dt>
                    <dd>{data.workspace}</dd>
                  </div>
                  <div>
                    <dt>Usuário</dt>
                    <dd>{data.userName}</dd>
                  </div>
                  <div>
                    <dt>Moeda</dt>
                    <dd>Real brasileiro · BRL</dd>
                  </div>
                  <div>
                    <dt>Fuso horário</dt>
                    <dd>America/Sao_Paulo</dd>
                  </div>
                  <div>
                    <dt>Ambiente</dt>
                    <dd>{demo ? 'Demonstração com dados ilustrativos' : 'Operação real'}</dd>
                  </div>
                </dl>
                {demo && (
                  <Link href="/login" className="button button-primary">
                    Criar minha conta
                    <ArrowRight size={15} />
                  </Link>
                )}
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Transparência dos dados</h2>
                    <p>Precisão começa com definições claras.</p>
                  </div>
                  <ShieldCheck size={19} />
                </div>
                <div className="settings-copy">
                  <p>
                    <strong>Faturamento:</strong> apenas pedidos aprovados. Reembolsos e chargebacks
                    são excluídos do faturamento aprovado.
                  </p>
                  <p>
                    <strong>Lucro estimado:</strong> faturamento aprovado menos anúncios e custos
                    configurados. O cálculo usa taxas médias e não substitui conciliação contábil.
                  </p>
                  <p>
                    <strong>Atribuição:</strong> último clique consentido disponível ou IDs das
                    UTMs. Atribuição não comprova causalidade.
                  </p>
                  <Link href="/guide">
                    Ler documentação de configuração
                    <ArrowUpRight size={15} />
                  </Link>
                </div>
              </section>
            </div>
          )}
          <footer className="main-footer">
            <span>
              <ShieldCheck size={13} />
              MetaTrack · Clareza em cada conversão.
            </span>
            <span>
              Feito para quem decide com dados
              <span className="footer-dot" />
              Meta + Cakto
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Activity size={18} />
          <span>{toast}</span>
          <button aria-label="Fechar aviso" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {modal && (
        <Modal title="Confirmar alteração na Meta" onClose={() => setModal(null)}>
          <button
            className="modal-close icon-button"
            aria-label="Fechar"
            onClick={() => setModal(null)}
          >
            <X size={20} />
          </button>
          <div className="modal-symbol">
            <Layers3 size={25} />
          </div>
          <h2 id="modal-title">
            {modal.action === 'budget'
              ? 'Alterar orçamento diário'
              : modal.action === 'duplicate'
                ? 'Duplicar campanha'
                : modal.campaign.status === 'ACTIVE'
                  ? 'Pausar veiculação'
                  : 'Ativar veiculação'}
          </h2>
          <p>{modal.campaign.name}</p>
          {modal.action === 'budget' ? (
            <label className="form-label">
              Orçamento diário em reais
              <input
                autoFocus
                type="number"
                min="1"
                max="1000000"
                step="0.01"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </label>
          ) : (
            <p className="modal-note">
              {modal.action === 'duplicate'
                ? 'A cópia será criada pausada, incluindo os conjuntos e anúncios.'
                : modal.campaign.status === 'ACTIVE'
                  ? 'A veiculação será pausada na sua conta Meta.'
                  : 'A veiculação será ativada e poderá gerar gastos na sua conta Meta.'}
            </p>
          )}
          {demo && (
            <div className="subtle-badge">Demonstração · nenhuma conta real será alterada</div>
          )}
          <div className="modal-actions">
            <Button variant="outline" onClick={() => setModal(null)}>
              Cancelar
            </Button>
            <Button
              disabled={
                busy ||
                (modal.action === 'budget' &&
                  (!Number.isFinite(Number(budget)) || Number(budget) < 1))
              }
              onClick={manage}
            >
              {busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />}Confirmar
              alteração
            </Button>
          </div>
        </Modal>
      )}
      {selectedSale && (
        <Modal
          title="Detalhes da venda"
          onClose={() => setSelectedSale(null)}
          className="sale-modal"
        >
          <button
            className="modal-close icon-button"
            aria-label="Fechar venda"
            onClick={() => setSelectedSale(null)}
          >
            <X size={20} />
          </button>
          <div className="modal-symbol">
            <ShoppingBag size={25} />
          </div>
          <h2 id="sale-title">Origem da venda</h2>
          <p>
            {selectedSale.externalId} · {selectedSale.product}
          </p>
          <div className="sale-amount">
            {money(selectedSale.amount)}
            <span className={`sale-status ${selectedSale.status}`}>
              {statusNames[selectedSale.status]}
            </span>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Campanha</dt>
              <dd>{selectedSale.campaign}</dd>
            </div>
            <div>
              <dt>Anúncio</dt>
              <dd>{selectedSale.ad}</dd>
            </div>
            <div>
              <dt>Método de atribuição</dt>
              <dd>
                {selectedSale.attribution === 'click'
                  ? 'Clique identificado + UTMs'
                  : selectedSale.attribution === 'utm'
                    ? 'UTMs do pedido'
                    : 'Origem não identificada'}
              </dd>
            </div>
            <div>
              <dt>Pagamento</dt>
              <dd>
                {selectedSale.paymentMethod === 'credit_card'
                  ? 'Cartão de crédito'
                  : selectedSale.paymentMethod.toUpperCase()}
              </dd>
            </div>
            <div>
              <dt>Data</dt>
              <dd>
                {new Date(selectedSale.date).toLocaleString('pt-BR', {
                  timeZone: 'America/Sao_Paulo',
                })}
              </dd>
            </div>
          </dl>
          <div className="info-callout">
            <ShieldCheck size={16} />
            <p>Compra confirmada via webhook da Cakto.{demo ? ' Exemplo ilustrativo.' : ''}</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
function CampaignTable({
  campaigns,
  overview,
  embedded,
  readonly,
  hideDuplicate,
  onAll,
  onManage,
}: {
  campaigns: Campaign[];
  overview?: boolean;
  embedded?: boolean;
  readonly?: boolean;
  hideDuplicate?: boolean;
  onAll?: () => void;
  onManage: (c: Campaign, a: 'status' | 'budget' | 'duplicate') => void;
}) {
  const [open, setOpen] = useState('');
  return (
    <section className={embedded ? '' : 'panel campaigns-panel'}>
      {!embedded && (
        <div className="panel-heading">
          <div>
            <h2>
              Suas campanhas<span className="subtle-badge">META ADS</span>
            </h2>
            <p>O que está gerando resultado para o seu negócio.</p>
          </div>
          <button className="text-button" onClick={onAll}>
            Ver todas
            <ArrowRight size={15} />
          </button>
        </div>
      )}
      <div className="table-scroll">
        <table className="campaign-table">
          <thead>
            <tr>
              <th>STATUS</th>
              <th>{readonly ? 'ANÚNCIO' : 'CAMPANHA / CONJUNTO'}</th>
              <th>ORÇAMENTO / DIA</th>
              <th>INVESTIMENTO</th>
              <th>VENDAS</th>
              <th>FATURAMENTO</th>
              <th>
                ROAS <CircleHelp size={11} />
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id}>
                <td>
                  {readonly ? (
                    <span className={`status-dot ${c.status === 'ACTIVE' ? 'connected' : ''}`} />
                  ) : (
                    <button
                      role="switch"
                      aria-checked={c.status === 'ACTIVE'}
                      aria-label={`${c.status === 'ACTIVE' ? 'Pausar' : 'Ativar'} ${c.name}`}
                      className={`toggle ${c.status === 'ACTIVE' ? 'on' : ''}`}
                      onClick={() => onManage(c, 'status')}
                    >
                      <span />
                    </button>
                  )}
                </td>
                <td className="campaign-name">
                  <strong>{c.name}</strong>
                  <small>
                    <span className={c.status === 'ACTIVE' ? 'accent' : ''}>
                      {c.status === 'ACTIVE' ? 'Em veiculação' : 'Pausada'}
                    </span>
                    <span className="inline-dot" />
                    {c.adsets} conjuntos
                  </small>
                </td>
                <td>
                  <button
                    className="budget-button"
                    disabled={readonly}
                    onClick={() => onManage(c, 'budget')}
                  >
                    {c.dailyBudget === null ? 'No conjunto' : money(c.dailyBudget)}
                    {!readonly && <Settings2 size={11} />}
                  </button>
                </td>
                <td>{money(c.spend)}</td>
                <td>
                  <span className="sales-count">{c.sales}</span>
                </td>
                <td className="bold">{money(c.revenue)}</td>
                <td>
                  <span
                    className={`roas-badge ${c.spend && c.revenue / c.spend >= 2 ? 'positive' : ''}`}
                  >
                    {c.spend ? (c.revenue / c.spend).toFixed(2).replace('.', ',') : '0,00'}x
                  </span>
                </td>
                <td className="row-actions">
                  {!readonly && (
                    <>
                      <button
                        className="icon-button"
                        aria-label={`Mais ações ${c.name}`}
                        onClick={() => setOpen(open === c.id ? '' : c.id)}
                      >
                        <MoreHorizontal size={17} />
                      </button>
                      {open === c.id && (
                        <div className="row-menu">
                          <button
                            onClick={() => {
                              onManage(c, 'budget');
                              setOpen('');
                            }}
                          >
                            <Wallet size={14} />
                            Editar orçamento
                          </button>
                          <button
                            onClick={() => {
                              onManage(c, 'status');
                              setOpen('');
                            }}
                          >
                            {c.status === 'ACTIVE' ? <Pause size={14} /> : <Play size={14} />}{' '}
                            {c.status === 'ACTIVE' ? 'Pausar' : 'Ativar'}
                          </button>
                          {!hideDuplicate && !c.id.startsWith('set-') && (
                            <button
                              onClick={() => {
                                onManage(c, 'duplicate');
                                setOpen('');
                              }}
                            >
                              <Copy size={14} />
                              Duplicar campanha
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {overview && (
        <div className="table-bottom-note">
          <span>
            <span className="online-dot" />
            Métricas de conversão calculadas a partir das vendas reais
          </span>
          <span>Valores em BRL</span>
        </div>
      )}
    </section>
  );
}
function pixelSnippet(i: Integration | null) {
  return `<script src="${i?.pixelUrl || 'https://SEU_DOMINIO/pixel.js'}" defer></script>\n<script>\n  // Execute após o pixel carregar E o usuário aceitar o rastreamento:\n  function onTrackingConsent() {\n    MetaTrack.init({ key: "${i?.publicKey || 'SUA_CHAVE_PUBLICA'}", consent: true });\n  }\n  // MetaTrack.track("ViewContent");\n  // MetaTrack.track("InitiateCheckout");\n  // checkout.href = MetaTrack.decorateCheckout(checkout.href);\n</script>`;
}
function Integrations({
  demo,
  integration: i,
  notify,
  reload,
  copy,
}: {
  demo: boolean;
  integration: Integration | null;
  notify: (s: string) => void;
  reload: () => Promise<void>;
  copy: (s: string) => Promise<void>;
}) {
  const [secret, setSecret] = useState(''),
    [origins, setOrigins] = useState(''),
    [caktoEmail, setCaktoEmail] = useState(''),
    [pixel, setPixel] = useState(''),
    [token, setToken] = useState(''),
    [testCode, setTestCode] = useState(''),
    [saving, setSaving] = useState(false),
    [generated, setGenerated] = useState('');
  useEffect(() => {
    if (i) {
      setOrigins(i.allowedOrigins.join('\n'));
      setCaktoEmail(i.caktoAccountEmail || '');
      setPixel(i.pixelId || '');
      setTestCode(i.testEventCode || '');
    }
  }, [i]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (demo) {
      notify('Crie uma conta para salvar suas integrações com segurança.');
      return;
    }
    setSaving(true);
    try {
      await api('/api/integrations', {
        ...(secret ? { caktoSecret: secret } : {}),
        ...(pixel ? { pixelId: pixel } : {}),
        ...(token ? { capiToken: token } : {}),
        testEventCode: testCode,
        caktoAccountEmail: caktoEmail,
        allowedOrigins: origins
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setSecret('');
      setToken('');
      notify('Configuração salva. Segredos armazenados com criptografia.');
      await reload();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className="integration-grid">
        <section className="panel integration-card">
          <div className="integration-card-top">
            <span className="integration-logo meta">∞</span>
            <span className={`integration-status ${i?.connection ? 'connected' : ''}`}>
              <i />
              {i?.connection ? 'Conectado' : 'Não conectado'}
            </span>
          </div>
          <h2>Meta Ads</h2>
          <p>
            Conecte suas contas para sincronizar campanhas, conjuntos, anúncios e investimentos.
          </p>
          <div className="integration-features">
            <span>
              <Check size={13} />
              Sincronização automática
            </span>
            <span>
              <Check size={13} />
              Gestão de campanhas
            </span>
          </div>
          <a
            className="button button-outline"
            href={demo ? '/login' : '/api/auth/meta?intent=connect'}
          >
            {i?.connection ? 'Reconectar Meta Ads' : 'Conectar com Facebook'}
            <ArrowUpRight size={15} />
          </a>
          {i?.connection && (
            <small className="muted">
              Token válido até {new Date(i.connection.expires_at).toLocaleDateString('pt-BR')}
            </small>
          )}
        </section>
        <section className="panel integration-card">
          <div className="integration-card-top">
            <span className="integration-logo cakto">
              c<span>•</span>
            </span>
            <span className={`integration-status ${i?.caktoConfigured ? 'connected' : ''}`}>
              <i />
              {i?.caktoConfigured ? 'Configurado' : 'Não conectado'}
            </span>
          </div>
          <h2>
            Cakto<span className="subtle-badge">NATIVA</span>
          </h2>
          <p>Receba pedidos aprovados, pendentes, reembolsos e chargebacks pelo webhook.</p>
          <div className="integration-features">
            <span>
              <Check size={13} />
              Atribuição de vendas
            </span>
            <span>
              <Check size={13} />
              Validação de segredo
            </span>
          </div>
          <Button
            variant="outline"
            onClick={() =>
              document.getElementById('cakto-config')?.scrollIntoView({ behavior: 'smooth' })
            }
          >
            Configurar integração
            <ArrowRight size={15} />
          </Button>
        </section>
        <section className="panel integration-card future-integration">
          <div className="integration-card-top">
            <span className="integration-logo">
              <Plus size={25} />
            </span>
            <span className="subtle-badge">NO RADAR</span>
          </div>
          <h2>Novas conexões</h2>
          <p>
            Uma arquitetura preparada para receber outras plataformas de vendas e fontes de tráfego.
          </p>
          <div className="future-logos">
            <span>Google Ads</span>
            <span>TikTok Ads</span>
          </div>
          <Link className="button button-ghost" href="/guide">
            Ver o escopo da versão 1.0
            <ArrowUpRight size={15} />
          </Link>
        </section>
      </div>
      {i?.accounts.length ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Contas de anúncios</h2>
              <p>
                Selecione contas BRL com fuso America/Sao_Paulo. O worker sincroniza a cada 15
                minutos.
              </p>
            </div>
          </div>
          <div className="account-list">
            {i.accounts.map((a) => (
              <label key={a.external_id}>
                <input
                  type="checkbox"
                  checked={a.selected}
                  onChange={async (e) => {
                    try {
                      await api('/api/meta/accounts', {
                        ids: i.accounts
                          .filter((x) =>
                            x.external_id === a.external_id ? e.target.checked : x.selected,
                          )
                          .map((x) => x.external_id),
                      });
                      await reload();
                      notify('Seleção salva.');
                    } catch (error) {
                      notify((error as Error).message);
                    }
                  }}
                />
                <span>
                  <strong>{a.name}</strong>
                  <small>
                    {a.external_id} · {a.currency} · {a.timezone}
                  </small>
                </span>
              </label>
            ))}
          </div>
        </section>
      ) : null}
      <form onSubmit={save} className="integration-settings">
        <section className="panel" id="cakto-config">
          <div className="panel-heading">
            <div>
              <h2>
                <span className="step-number">01</span>Webhook da Cakto
              </h2>
              <p>Configure esta URL no painel da Cakto e selecione os eventos de vendas.</p>
            </div>
            <ShieldCheck size={18} className="accent" />
          </div>
          <label className="form-label">
            URL do webhook
            <div className="copy-input">
              <input
                readOnly
                value={i?.webhookUrl || 'Crie sua conta para gerar a URL exclusiva'}
              />
              <button
                type="button"
                aria-label="Copiar URL do webhook"
                onClick={() =>
                  i ? copy(i.webhookUrl) : notify('Entre para gerar sua URL de integração.')
                }
              >
                <Copy size={16} />
              </button>
            </div>
          </label>
          <label className="form-label">
            E-mail da conta Cakto
            <input
              type="email"
              value={caktoEmail}
              onChange={(e) => setCaktoEmail(e.target.value)}
              placeholder="Seu e-mail cadastrado na Cakto"
            />
            <small>
              Identifica sua comissão para calcular o líquido. Sem correspondência, o valor é
              estimado.
            </small>
          </label>
          <label className="form-label">
            Segredo do webhook
            <input
              type="password"
              minLength={16}
              placeholder={
                i?.caktoConfigured
                  ? 'Configurado · digite somente para substituir'
                  : 'Mesmo segredo definido na Cakto (mín. 16 caracteres)'
              }
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <button
            type="button"
            className="text-button accent"
            onClick={async () => {
              if (demo) return notify('Crie sua conta para gerar um segredo.');
              try {
                const r = await api('/api/integrations', { generateSecret: true });
                setGenerated(r.generatedSecret);
                await reload();
                notify('Novo segredo gerado. Atualize também na Cakto.');
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            <Zap size={14} />
            Gerar e salvar novo segredo seguro
          </button>
          {generated && (
            <div className="generated-secret">
              <p>
                Copie agora e configure na Cakto. O segredo não será exibido novamente ao sair desta
                página.
              </p>
              <code>{generated}</code>
              <Button type="button" size="sm" variant="outline" onClick={() => copy(generated)}>
                <Copy size={14} />
                Copiar segredo
              </Button>
            </div>
          )}
          <p className="field-hint">
            A integração direta verifica o campo <code>secret</code> no JSON em tempo constante, via
            HTTPS. Não é uma assinatura HMAC. Veja o contrato e os eventos suportados na
            documentação.
          </p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>
                <span className="step-number">02</span>Pixel e Conversions API
              </h2>
              <p>Use um token de acesso com permissão no Pixel/Dataset informado.</p>
            </div>
            <Target size={18} className="accent" />
          </div>
          <div className="form-two">
            <label className="form-label">
              ID do Pixel / Dataset
              <input
                placeholder="Ex.: 123456789012345"
                value={pixel}
                onChange={(e) => setPixel(e.target.value)}
              />
            </label>
            <label className="form-label">
              Código de evento de teste
              <input
                placeholder="Opcional: TEST12345"
                value={testCode}
                onChange={(e) => setTestCode(e.target.value)}
              />
            </label>
          </div>
          <label className="form-label">
            Token da Conversions API
            <input
              type="password"
              placeholder={
                i?.capiConfigured
                  ? 'Configurado · digite somente para substituir'
                  : 'Cole seu token de acesso da Meta'
              }
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="form-label">
            Domínios permitidos do pixel · uma origem por linha
            <textarea
              placeholder={'https://seusite.com.br\nhttps://checkout.seusite.com.br'}
              rows={3}
              value={origins}
              onChange={(e) => setOrigins(e.target.value)}
            />
          </label>
          <p className="field-hint">
            Sem barra final ou caminho. Retire o código de teste antes de enviar conversões de
            produção. Configure o consentimento no seu site antes de inicializar o pixel.
          </p>
        </section>
        <div className="save-bar">
          <span>
            <ShieldCheck size={15} />
            Tokens e segredos são criptografados no servidor.
          </span>
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}Salvar
            configurações
          </Button>
        </div>
      </form>
    </>
  );
}
function UtmGenerator({ copy }: { copy: (v: string) => Promise<void> }) {
  const [url, setUrl] = useState('https://seusite.com.br/oferta'),
    [source, setSource] = useState('meta'),
    [medium, setMedium] = useState('paid_social');
  const params = `utm_source=${encodeURIComponent(source)}&utm_medium=${encodeURIComponent(medium)}&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}`;
  let result = 'URL inválida';
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach((k) =>
      u.searchParams.delete(k),
    );
    const fragment = u.hash;
    u.hash = '';
    result = u.toString() + (u.search ? '&' : '?') + params + fragment;
  } catch {}
  return (
    <div className="utm-grid">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Uma URL, toda a origem.</h2>
            <p>Use os IDs dinâmicos da Meta para uma atribuição estável.</p>
          </div>
          <Link2 size={22} className="accent" />
        </div>
        <label className="form-label">
          URL da página de destino
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <div className="form-two">
          <label className="form-label">
            Origem · utm_source
            <input value={source} onChange={(e) => setSource(e.target.value)} />
          </label>
          <label className="form-label">
            Mídia · utm_medium
            <input value={medium} onChange={(e) => setMedium(e.target.value)} />
          </label>
        </div>
        <div className="utm-mapping">
          {[
            ['Campanha', 'utm_campaign', '{{campaign.id}}'],
            ['Conjunto', 'utm_term', '{{adset.id}}'],
            ['Anúncio', 'utm_content', '{{ad.id}}'],
          ].map(([label, key, value]) => (
            <div key={key}>
              <span>
                {label}
                <small>{key}</small>
              </span>
              <code>{value}</code>
              <span className="subtle-badge">DINÂMICO</span>
            </div>
          ))}
        </div>
        <div className="utm-output">
          <label>URL pronta para usar</label>
          <code>{result}</code>
          <Button disabled={result === 'URL inválida'} onClick={() => copy(result)}>
            <Copy size={15} />
            Copiar URL completa
          </Button>
        </div>
        <Button variant="outline" onClick={() => copy(params)}>
          <Code2 size={15} />
          Copiar somente os parâmetros
        </Button>
      </section>
      <div>
        <section className="panel guide-card">
          <span className="guide-icon">
            <BookOpen size={24} />
          </span>
          <h2>Como usar na Meta</h2>
          <ol>
            <li>Abra seu anúncio no Gerenciador de Anúncios.</li>
            <li>
              Localize <strong>Rastreamento → Parâmetros de URL</strong>.
            </li>
            <li>Cole somente os parâmetros gerados ao lado.</li>
            <li>Publique e valide a URL em um clique real.</li>
          </ol>
          <div className="info-callout">
            <CircleHelp size={17} />
            <p>
              A Meta substitui os parâmetros dinâmicos no anúncio publicado. IDs continuam estáveis
              mesmo após renomear uma campanha.
            </p>
          </div>
        </section>
        <div className="utm-note">
          <ShieldCheck size={18} />
          <p>Não inclua e-mails, telefones ou outros dados pessoais nas UTMs.</p>
        </div>
      </div>
    </div>
  );
}
