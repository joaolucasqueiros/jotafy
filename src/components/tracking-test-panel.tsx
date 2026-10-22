'use client';
import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { api } from '@/lib/client-api';

type Test = {
  id: string;
  status: string;
  event: string;
  event_id: string;
  test_code: string;
  last_error: string | null;
  created_at: string;
  receipt: { events_received: number; fbtrace_id?: string } | null;
};
type Event = {
  event_id: string;
  event_name: string;
  created_at: string;
  landing_url: string | null;
  delivery_status: string | null;
  last_error: string | null;
};
const state = (value: string | null) =>
  ({
    pending: 'Aguardando processador',
    running: 'Enviando',
    completed: 'Aceito pela Meta',
    failed: 'Falhou',
  })[value || ''] || 'Somente recebido';
const date = (value: string) =>
  new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export function TrackingTestPanel({
  demo,
  origins,
  defaultCode,
}: {
  demo: boolean;
  origins: string[];
  defaultCode: string | null;
}) {
  const [url, setUrl] = useState(origins[0] || '');
  const [code, setCode] = useState(defaultCode || '');
  const [event, setEvent] = useState('PageView');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [data, setData] = useState<{ tests: Test[]; events: Event[] }>({ tests: [], events: [] });
  async function refresh() {
    if (demo) return;
    try {
      setData(await api('/api/tracking/test'));
    } catch (error) {
      setMessage((error as Error).message);
    }
  }
  useEffect(() => {
    if (!url && origins[0]) setUrl(origins[0]);
  }, [origins, url]);
  useEffect(() => {
    if (!code && defaultCode) setCode(defaultCode);
  }, [defaultCode]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [demo]);
  return (
    <>
      <section className="panel tracking-test-panel" aria-labelledby="tracking-test-title">
        <div className="panel-heading">
          <div>
            <h2 id="tracking-test-title">Testar envio ao Facebook</h2>
            <p>
              Simule um evento e acompanhe o aceite da Meta. O teste não cria vendas nem altera o
              funil.
            </p>
          </div>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (demo) {
              setMessage('Entre na sua conta para testar sua integração.');
              return;
            }
            setBusy(true);
            setMessage('');
            try {
              await api('/api/tracking/test', { event, testEventCode: code, url, consent });
              setMessage('Teste recebido pelo Jotafy. Aguardando o processador enviar à Meta.');
              await refresh();
            } catch (error) {
              setMessage((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-two">
            <label className="form-label">
              Evento de teste
              <select value={event} onChange={(e) => setEvent(e.target.value)}>
                {['PageView', 'ViewContent', 'InitiateCheckout', 'Purchase'].map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Código de teste da Meta
              <input
                required
                pattern="TEST[A-Za-z0-9_-]+"
                placeholder="TEST12345"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
          </div>
          <label className="form-label">
            URL da página para teste
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://seusite.com.br"
            />
          </label>
          <label className="tracking-test-consent">
            <input
              type="checkbox"
              required
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            Autorizo enviar dados técnicos deste navegador para este teste.
          </label>
          <p className="field-hint">
            Copie o código em Gerenciador de Eventos → seu Pixel → Testar eventos. Ele vale só para
            este envio. O processador Node/GitHub Actions precisa estar ativo.
          </p>
          <Button type="submit" disabled={busy || (!demo && !origins.length)}>
            {busy ? 'Registrando teste…' : 'Enviar evento de teste'}
          </Button>
          {!demo && !origins.length && (
            <p>Cadastre o domínio da página em Integrações para começar.</p>
          )}
        </form>
        {message && <p role="status">{message}</p>}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>TESTE</th>
                <th>RECEBIDO NO JOTAFY</th>
                <th>FACEBOOK</th>
              </tr>
            </thead>
            <tbody>
              {data.tests.map((test) => (
                <tr key={test.id}>
                  <td>
                    {test.event}
                    <small>{test.test_code}</small>
                    <code>{test.event_id}</code>
                  </td>
                  <td>{date(test.created_at)}</td>
                  <td>
                    {state(test.status)}
                    {test.receipt && (
                      <small>
                        {test.receipt.events_received} evento recebido pela Meta
                        {test.receipt.fbtrace_id && ` · referência ${test.receipt.fbtrace_id}`}
                      </small>
                    )}
                    {test.last_error && <small className="error-cell">{test.last_error}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.tests.length && <p>Nenhum teste registrado.</p>}
      </section>
      <section className="panel tracking-test-panel" aria-labelledby="tracking-live-title">
        <div className="panel-heading">
          <div>
            <h2 id="tracking-live-title">Eventos recebidos da página</h2>
            <p>
              Últimos 20 registros reais do seu workspace. Abra a página e confira se aparece
              PageView com o horário e endereço esperados.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            Atualizar eventos
          </Button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>EVENTO</th>
                <th>RECEBIDO</th>
                <th>PÁGINA</th>
                <th>FACEBOOK</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((item) => (
                <tr key={item.event_id}>
                  <td>
                    {item.event_name}
                    <code>{item.event_id}</code>
                  </td>
                  <td>{date(item.created_at)}</td>
                  <td>{item.landing_url || '—'}</td>
                  <td>
                    {state(item.delivery_status)}
                    {item.last_error && <small className="error-cell">{item.last_error}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.events.length && (
          <p>
            Nenhum evento recebido. Confira a publicação do script, o domínio permitido e as
            preferências de rastreamento do navegador.
          </p>
        )}
        <p className="field-hint">
          Receber no Jotafy e receber no Facebook são etapas diferentes. A tabela atualiza a cada 15
          segundos enquanto esta aba estiver visível.
        </p>
      </section>
    </>
  );
}
