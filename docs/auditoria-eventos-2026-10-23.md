# Auditoria de eventos — MetaTrack — 23/10/2026

## Diagnóstico e evidências

A investigação usou o código do repositório e PostgreSQL local isolado. Não houve acesso ao banco Neon de produção, aos payloads reais da conta Meta, ao painel autenticado da Cakto ou ao código instalado na landing page. Nenhuma campanha ou compra real foi disparada.

A definição da coluna Meta foi fornecida pelo usuário: **“Finalizações de compra iniciadas”**, eventos **atribuídos aos anúncios**, recebidos pelas Ferramentas Comerciais ou ocorridos nas tecnologias Meta, sujeitos a estimativas. Isso confirma a natureza atribuída da métrica. Não prova qual `action_type` do retorno real, janela ou população originou os 5.

| Indicador informado      |       Meta Ads |          MetaTrack | Conclusão verificável                                                                                          |
| ------------------------ | -------------: | -----------------: | -------------------------------------------------------------------------------------------------------------- |
| Cliques no link          |             11 |                 11 | Fontes nominalmente equivalentes: `inline_link_clicks`; período/conta da captura ainda precisam ser conferidos |
| Visualizações de destino |              7 |                  7 | MetaTrack usa apenas `actions[action_type=landing_page_view].value`                                            |
| Checkouts                |   5 atribuídos | 8 eventos internos | Definições distintas; não comprova três duplicatas                                                             |
| Vendas aprovadas         | Não confirmado |                  0 | No MetaTrack são pedidos Cakto aprovados, não `InitiateCheckout` nem compras atribuídas Meta                   |

**Origem dos 8:** `dashboard()` em `src/lib/dashboard.ts`, consulta a `tracking_events` com `event_name='InitiateCheckout'`, filtrada pelo período São Paulo e IDs de campanha/conjunto/anúncio quando fornecidos. Cada `event_id` diferente era contado. A consulta não usava ações de checkout da Meta. Não há evidência disponível para listar os oito IDs reais, identificar seus listeners ou concluir quais foram legítimos.

Problemas confirmados por inspeção/reprodução:

1. `public/pixel.js`: cada `init()` repetido disparava `PageView`; carregar o script duas vezes substituía a instância e permitia reinicialização duplicada.
2. O coletor deduplicava por `(workspace_id,event_id)`, mas aceitava silenciosamente reutilização desse ID para outro nome de evento. IDs diferentes continuam sendo ações diferentes: não foram colapsados por usuário ou por proximidade temporal.
3. Não havia sessão, horário de ocorrência nem classificação de teste nos eventos. O período usava somente a hora de recebimento. Pedidos de teste podiam participar dos totais financeiros.
4. O dashboard somava insights históricos de contas já desmarcadas, pois filtrava apenas workspace/datas/entidades.
5. `normalizeCakto()` dava preferência a `updatedAt` e o pedido usava esse instante também como aprovação, mesmo havendo `paidAt`/`approvedDate` anterior. Uma notificação tardia podia deslocar o dia da receita.
6. A consulta de eventos dependia de `INNER JOIN clicks`. A retenção podia remover um clique de atribuição antigo antes de remover um evento recente associado, fazendo o evento desaparecer do funil.
7. A sincronização descartava `actions` originais após extrair visitas. Faltavam evidências para reconciliar o checkout Meta e sua janela/configuração.

## Pipeline e identidade

`Anúncio → Meta insights (cliques/visitas atribuídos) → banco → dashboard`

`Landing page consentida → pixel MetaTrack → /api/tracking → clicks + tracking_events + job CAPI → worker → Meta`

`Checkout decorado (mt_click/UTMs) → pagamento → webhook Cakto autenticado → recibo + pedido + job Purchase → worker → Meta`

Esses fluxos não representam necessariamente uma mesma coorte. A tabela `clicks` é um registro de **atribuição de navegação**, com validade de até 90 dias; não é o contador de cliques Meta nem uma sessão.

### Identidade e fontes

| Entidade           | Identidade / regra                                                                                                        | Fonte / período                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Evento browser     | `(workspace_id,event_id)`; mesmo ID/nome/clique/sessão = retry; conflito = 409; primeiro recebimento fixa o modo de teste | `browser`; `occurred_at`, fallback histórico `created_at`                  |
| Sessão             | UUID por aba, renovado após 30 minutos sem atividade                                                                      | Não equivale a usuário único; abas/sessões diferentes permanecem distintas |
| Usuário único      | Não calculado                                                                                                             | `null`, pois não há identidade confiável suficiente                        |
| Atribuição interna | Snapshot de IDs UTM/clique; campanha conhecida no workspace                                                               | Não reproduz modelo/janela Meta                                            |
| Pedido             | `(workspace_id,provider,external_id)`                                                                                     | Cakto validada; aprovação por `paidAt`/`approvedDate`, fallback explícito  |
| Webhook            | `(workspace_id,event_key)` + trava por pedido                                                                             | Recibo guarda horário, pedido externo, resultado e motivo de descarte      |
| Purchase CAPI      | `cakto:<pedido>:purchase` estável                                                                                         | Somente aprovação transacional; browser Purchase não cria pedido           |

A identidade continua sendo responsabilidade de quem dispara a ação. Dois listeners que geram dois UUIDs para a mesma ação ainda precisam ser corrigidos na página. Não se usa uma janela arbitrária de “X segundos” que apagaria checkouts legítimos. `init()` não instala listeners em CTAs.

## Correções realizadas

- Migração **006**, aditiva: sessão, ocorrência, teste, atribuição por evento, contexto de insights e rastreabilidade de recibos. Nenhum histórico é apagado nem renumerado. Sessões/ocorrência desconhecidas permanecem nulas; atribuição antiga é copiada apenas quando o clique existe.
- Pixel: mantém uma instância e uma inicialização por chave/página; registra sessão e ocorrência; conserva `eventId` explícito; revogação de consentimento encerra coleta e limpa armazenamento.
- Coletor: transação única com evento e fila, retorno de duplicidade, rejeição de colisões de identidade; CAPI recebe exatamente o mesmo nome/ID/horário. Aceita ocorrência de até sete dias atrás e no máximo cinco minutos no futuro; outros relógios são recusados, não ajustados silenciosamente.
- Eventos explicitamente de teste são separados de produção. `isTest` no browser ou código de teste configurado classificam os novos eventos browser como teste. O contrato do adapter Cakto aceita `is_test:true` no topo ou em `data`; isso **não é alegação de que o teste nativo Cakto sempre envia esse campo**. Homologar o payload real é obrigatório.
- Testes sem código CAPI são guardados internamente e não enviados para a Meta. Novos jobs capturam o código no recebimento; mudar configurações depois não transforma teste em produção. Jobs legados com código nulo preservam a regra anterior baseada na configuração do workspace.
- Dashboard e agregados financeiros de entidades excluem registros marcados como teste. Cliques/visitas/gasto usam apenas contas atualmente selecionadas. Eventos não somem quando o clique é removido pela retenção; IDs de atribuição são preservados no evento.
- Aprovação mantém o horário real de pagamento quando informado. Estados pendente/recusado não regridem aprovação; reembolso/chargeback permanecem terminais conforme as regras existentes.
- Meta: guarda ações originais, conta, fuso, versão Graph, horário de sincronização e `attribution_spec` do conjunto quando disponível. Requisição explicita `use_unified_attribution_setting=true` e `action_report_time=impression`. Não soma aliases/famílias de checkout, nem janelas sobrepostas. Rejeita resposta HTML com erro legível.
- Logs estruturados: entrada/duplicidade/resultado, IDs técnicos, sessão, ocorrência, recebimento, origem, teste e tentativas de fila. Não incluem URLs com query, e-mail, tokens, segredo, fbclid/fbc/fbp ou corpo bruto.
- Sem alterações de CSS, disposição, tamanho ou estilo. O texto existente do funil agora distingue fontes, sessões e fórmula, e sinaliza checkout maior que visitas. A área do desenho continua limitada ao card, mas valores e percentuais não são reduzidos a 100%.

## Mapeamento das métricas

| Métrica             | Fonte exata                                                      | Definição                                                                         |
| ------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Cliques             | Meta `inline_link_clicks`, anúncio/dia                           | Soma de snapshots; não `clicks` total nem clique interno                          |
| Visitas de destino  | Meta `landing_page_view` em `actions`                            | Valor agregado exato; não somar `view_content`                                    |
| Checkouts do funil  | `tracking_events.InitiateCheckout` não teste                     | Eventos aceitos distintos; não conversões Meta atribuídas                         |
| Sessões de checkout | `COUNT(DISTINCT session_id)` dos mesmos eventos                  | Somente sessões identificadas; históricos sem sessão são reportados separadamente |
| Vendas              | `orders.status=approved AND is_test=false`                       | Pedidos transacionais atuais; inclui sem UTM no total geral                       |
| Bruto               | Valores de aprovadas + reembolsadas + chargebacks                | Coorte por data de compra; não saldo de saque                                     |
| Líquido             | Comissões próprias identificadas / estimativa de campos ausentes | Fórmulas financeiras anteriores preservadas; teste excluído                       |
| Percentual do funil | `valor da etapa / cliques Meta × 100`                            | Razão entre fontes, não taxa de conversão de sessão nem probabilidade causal      |

O subtítulo/badge Meta Ads não torna todos os eventos do card métricas Meta. O rodapé identifica as fontes. Um mesmo visitante pode iniciar vários checkouts, visitar por origem orgânica ou usar uma página sem coleta. Logo, etapa posterior maior que anterior exige diagnóstico, não corte artificial de contagem.

## Diagnóstico autenticado

Após migração/deploy/sincronização, abrir, autenticado no próprio MetaTrack:

```text
/api/events/audit?start=2026-10-23&end=2026-10-23
```

Aceita também `campaign`, `adset` e `ad`. O retorno contém:

- `summary`: eventos por nome/origem/teste, sessões conhecidas, ausência de sessão e atribuição interna.
- `events`: até 200 eventos mais recentes, com identidade, horários, status/tentativas CAPI e origem da atribuição; sem tokens/identificadores Meta de matching.
- `metaActions`: ações Meta por `action_type` e contexto. Grupos diferentes não devem ser somados indiscriminadamente. Pode haver aliases sobrepostos (`initiate_checkout`, famílias `offsite_conversion` ou `omni`); a descrição visual sozinha não seleciona qual corresponde aos 5.
- `accounts`: contas selecionadas e fusos; `uniqueUsers:null` indica indisponibilidade.

Eventos de teste aparecem no diagnóstico, separados por `is_test`, mas não nos totais de produção. Somatórios Meta antigos sem `raw_actions` exigem nova sincronização. O diagnóstico é restrito ao workspace autenticado e usa `Cache-Control:no-store`.

## Validação automatizada

Com banco local, Graph/CAPI simuladas e nenhum envio externo real:

- Build de produção Next.js/OpenNext para Cloudflare concluído com sucesso.
- Unitários: 32 aprovados, incluindo inicialização duplicada, carregamento duplo, consentimento/revogação, identidade explícita, sessão após inatividade e resposta HTML da Meta.
- Integração PostgreSQL + HTTP: **16 testes aprovados, nenhum ignorado**; testes de idempotência concorrente, ciclo aprovação/reembolso, isolamento de workspace, autorização/CORS/CSRF, fila/retries, paginação 601 linhas, filtro de conta, diagnóstico e classificação de teste.
- Mesmo ID em dois POSTs: um evento, um job. Dois novos IDs na mesma sessão são preservados. Colisão do ID com outro nome recebe erro.
- Simulação de erro CAPI e retry: ID/nome originais e código de teste capturado preservados em ambas as tentativas; um evento interno.
- Fronteira São Paulo: evento às 02:59 UTC pertence ao dia anterior; às 03:10 UTC ao dia selecionado. `paidAt` anterior a `updatedAt` não desloca a aprovação.
- Browser Purchase não cria receita. Pedido Cakto de teste de R$90 permanece armazenado, sem receita bruta/líquida de produção e sem envio CAPI de produção.

O teste local comprova o transporte de identidade para CAPI, **não comprova o resultado da deduplicação no servidor Meta**. Isso depende do mesmo Pixel/Dataset, nome e ID também usados pelo Pixel Meta externo; validar em Eventos de Teste com as integrações reais.

## Comparação antes/depois

Não foram produzidos novos números de produção. O 11/7/8/0 informado permanece uma evidência histórica; o valor corrigido após deploy ainda não é conhecido.

| Cenário controlado                           | Antes                            | Depois                                        |
| -------------------------------------------- | -------------------------------- | --------------------------------------------- |
| `init()` repetido na mesma página            | 2 PageViews                      | 1 PageView                                    |
| Script incluído duas vezes + init            | Nova instância e novo PageView   | Instância preservada                          |
| Reenvio do mesmo ID/nome                     | 1 evento                         | 1 evento; resultado de duplicidade rastreável |
| Reuso do ID para outro nome                  | Ignorado silenciosamente         | 409; registro original preservado             |
| 3 ações legítimas em 2 sessões               | 3 eventos, sessões desconhecidas | 3 eventos / 2 sessões                         |
| Pedido explicitamente teste R$90             | Sem separação de produção        | R$0 nos totais de produção; histórico mantido |
| Clique de atribuição purgado, evento recente | Evento excluído por INNER JOIN   | Evento preservado com snapshot de atribuição  |
| Conta desmarcada com insights históricos     | Participava dos totais           | Não participa de cliques/visitas/gasto        |

## Pendências e aplicação segura

1. **Produção não foi migrada nem implantada nesta auditoria.** Primeiro revisar/aplicar `npm run db:migrate` com a conexão Neon correta; a migração 006 é compatível com o código anterior. Só depois implantar o código novo e atualizar o worker. Fazer backup antes da intervenção de produção.
2. Confirmar período exato da captura 11/7/8, conta(s), fuso, janela e opção de data das conversões no Ads Manager. Depois sincronizar e obter `metaActions` no mesmo recorte. O pipeline usa dia São Paulo e data da impressão para ações atribuídas; a janela unificada vem do conjunto, e sua equivalência com a configuração da coluna precisa ser conferida.
3. Revisar o JavaScript realmente instalado na landing page e no checkout: listeners, integrações externas, carregamentos/recarregamentos e duplicação entre clique e carga. Nenhum acesso autenticado a esses ativos foi fornecido.
4. Conferir o Pixel/Dataset usado pela Cakto e por scripts externos. Não há coordenação automática de IDs com emissores de terceiros. Um emissor externo de Purchase com outro ID pode duplicar na Meta, apesar da idempotência do banco MetaTrack. Usar um único emissor Purchase ou IDs idênticos comprovadamente compartilhados.
5. Eventos/testes antigos **não são classificados retroativamente por nome do produto**, pois isso apagaria vendas legítimas. O pedido de teste já registrado deve ser identificado por ID e payload/proveniência, com backup, antes de marcar `is_test`. Sessões/ocorrências antigas sem dados não podem ser reconstruídas.
6. Cakto: validar o campo real de teste, formatos e identidade de eventos da conta. A integração direta usa segredo do JSON em tempo constante + HTTPS; não é HMAC oficial. Um relay próprio pode exigir HMAC adicional conforme contrato já existente.
7. Não há reconciliação histórica com API Cakto. Reembolso/chargeback retiram valores aprovados internamente, mas não desfazem automaticamente Purchase já enviado à Meta. O painel é coorte pela data de compra, não fluxo de caixa pela data de estorno.
8. `last_sync_at` só avança ao término de todas as contas. Há atomicidade por conta; uma conta concluída pode atualizar antes de uma conta seguinte falhar. O worker não inventa métricas em falhas, mas a sincronização multi-conta não é uma transação global. Snapshots de dias omitidos pela Meta não são apagados automaticamente; reconciliar casos de supressão de linhas antes de qualquer limpeza histórica.
9. Retenção existente continua: eventos/cliques 90 dias, recibos 180 dias, payloads de jobs conforme política. Logs do provedor devem ter acesso/retencão limitados; IDs de sessão também são identificadores pseudônimos.

A divergência foi **explicada no nível das definições**, mas sua decomposição exata em produção permanece pendente. Não há base para alterar 8 para 5 ou declarar três eventos inválidos.
