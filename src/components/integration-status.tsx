import type { IntegrationDiagnostics } from '@/lib/integration-diagnostics';

export function IntegrationStatus({
  data,
  origins,
  capiConfigured,
  testMode,
}: {
  data: IntegrationDiagnostics;
  origins: string[];
  capiConfigured: boolean;
  testMode: boolean;
}) {
  const date = (value: string | null) =>
    value
      ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      : 'Ainda não registrado';
  return (
    <section
      className="panel integration-diagnostics"
      aria-labelledby="integration-diagnostics-title"
    >
      <div className="panel-heading">
        <div>
          <h2 id="integration-diagnostics-title">Diagnóstico das integrações</h2>
          <p>
            Dados recebidos neste workspace. Visitas, checkouts e envios CAPI: últimos 7 dias, sem
            filtros de campanha.
          </p>
        </div>
      </div>
      <dl>
        <div>
          <dt>Origens autorizadas</dt>
          <dd>
            {origins.length
              ? origins.join(', ')
              : 'Pendente: adicione o domínio da página e salve.'}
          </dd>
        </div>
        <div>
          <dt>Visitas recebidas pelo pixel</dt>
          <dd>
            {data.pageviews} · último evento: {date(data.lastTrackingAt)}
          </dd>
        </div>
        <div>
          <dt>Checkouts recebidos pelo pixel</dt>
          <dd>
            {data.checkouts}
            {!data.checkouts && ' · aceite o rastreamento na página e teste o botão de compra.'}
          </dd>
        </div>
        <div>
          <dt>Último webhook Cakto aceito</dt>
          <dd>
            {date(data.lastWebhookAt)} · {data.approvedOrders} pedidos atualmente aprovados.
          </dd>
        </div>
        <div>
          <dt>Fila de processamento</dt>
          <dd>
            {data.pendingJobs} aguardando/em execução · {data.failedJobs} com falha definitiva ·{' '}
            {data.delayedJobs} atrasados há mais de 30 minutos.
          </dd>
        </div>
        <div>
          <dt>Último trabalho concluído</dt>
          <dd>
            {date(data.lastCompletedAt)}. O site Cloudflare precisa do processador no GitHub Actions
            ou Node para sincronizar e enviar CAPI.
          </dd>
        </div>
        <div>
          <dt>Envios aceitos pela Meta</dt>
          <dd>
            {data.acceptedCapi} · último aceite: {date(data.lastCapiAt)}.{' '}
            {capiConfigured
              ? 'Pixel/token cadastrados; o aceite depende do processamento.'
              : 'Pendente: configure Pixel e token CAPI.'}
          </dd>
        </div>
        <div>
          <dt>Modo de envio CAPI</dt>
          <dd>
            {testMode
              ? 'Teste ativo: retire o código de teste após validar no Gerenciador de Eventos.'
              : 'Sem código de teste. A recepção em produção precisa ser validada na Meta.'}
          </dd>
        </div>
      </dl>
      <p className="field-hint">
        Nenhum evento de teste é criado por este diagnóstico. Para atualizar, salve as configurações
        ou reabra esta aba. Confira falhas na aba Rastreamento e as entregas no painel da Cakto.
      </p>
    </section>
  );
}
