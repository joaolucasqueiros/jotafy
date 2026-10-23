'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CircleHelp, Clock3, Loader2, Radio, RefreshCw } from 'lucide-react';
import { api } from '@/lib/client-api';
import type { UtmTrackingCampaign } from '@/lib/utm-status';
import { Button } from './ui/button';
type Status = { checkedAt: string; campaigns: UtmTrackingCampaign[] };
export function UtmTrackingStatus({ demo }: { demo: boolean }) {
  const [data, setData] = useState<Status | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const verify = useCallback(async () => {
    if (demo || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError('');
    try {
      const response = await api('/api/utms/status');
      if (mounted.current) setData(response);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Não foi possível verificar.');
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [demo]);
  useEffect(() => {
    mounted.current = true;
    void verify();
    return () => {
      mounted.current = false;
    };
  }, [verify]);
  return (
    <section className="panel utm-tracking-panel" aria-label="Status de rastreamento das UTMs">
      <div className="panel-heading">
        <div>
          <h2>
            <Radio size={18} /> Rastreamento das UTMs
          </h2>
          <p>Eventos recebidos com o ID da campanha nas contas selecionadas.</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={loading || demo}
          onClick={() => void verify()}
        >
          {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}{' '}
          {loading ? 'Verificando…' : 'Verificar UTMs'}
        </Button>
      </div>
      <div aria-live="polite">
        {demo ? (
          <p className="muted">Conecte sua conta para verificar o rastreamento real.</p>
        ) : error ? (
          <p role="alert">{error} O status não pôde ser confirmado.</p>
        ) : loading ? (
          <p className="muted">Consultando os eventos recebidos…</p>
        ) : data?.campaigns.length ? (
          <ul className="utm-tracking-list">
            {data.campaigns.map((c) => {
              const active = c.state === 'receiving',
                Icon = active ? Check : c.state === 'historical' ? Clock3 : CircleHelp;
              return (
                <li key={c.id}>
                  <div>
                    <strong>{c.name}</strong>
                    <small>
                      ID: {c.id} ·{' '}
                      {c.campaignStatus === 'ACTIVE'
                        ? 'Campanha ativa na última sincronização'
                        : 'Status Meta: ' + c.campaignStatus}
                    </small>
                  </div>
                  <div>
                    <span className={active ? 'utm-tracking-active' : 'muted'}>
                      <Icon size={15} />{' '}
                      {active
                        ? 'Rastreamento ativo'
                        : c.state === 'historical'
                          ? 'Sem eventos recentes'
                          : 'Aguardando primeiro evento'}
                    </span>
                    <small>
                      {c.events24h} eventos · {c.checkouts24h} checkouts nas últimas 24h
                    </small>
                    <small>
                      Último recebimento:{' '}
                      {c.lastReceivedAt
                        ? new Date(c.lastReceivedAt).toLocaleString('pt-BR', {
                            timeZone: 'America/Sao_Paulo',
                          })
                        : 'ainda não identificado'}
                    </small>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : data ? (
          <p className="muted">
            Nenhuma campanha disponível nas contas selecionadas. Selecione uma conta e sincronize a
            Meta.
          </p>
        ) : null}
      </div>
      <p className="field-hint">
        Ativo = recebeu evento de produção com UTM de campanha nas últimas 24 horas. Gerar um link
        não comprova instalação no anúncio; ausência de eventos também não comprova falha. Horários
        de São Paulo.
      </p>
      {data && !error && !loading && (
        <p className="field-hint">
          Verificado em{' '}
          {new Date(data.checkedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.
        </p>
      )}
    </section>
  );
}
