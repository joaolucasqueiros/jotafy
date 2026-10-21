# Integrações e contrato de eventos

## Meta OAuth e Marketing API

1. Configure um aplicativo Business na Meta. Ative Facebook Login compatível com sua modalidade de aplicativo e registre **exatamente** `APP_URL/api/auth/meta/callback` como URI OAuth autorizada. Não use wildcard.
2. Login solicita `public_profile,email`. Conexão de anúncios solicita também `ads_read,ads_management`. App Review, acesso avançado, verificação da empresa e requisitos de Meta Business variam com o público e ativos acessados; obtenha as aprovações necessárias antes de atender clientes externos.
3. Configure domínio, política de privacidade, termos, contato e exclusão de dados próprios da sua organização no aplicativo Meta. O guia técnico interno não substitui esses documentos legais.
4. Entre no MetaTrack e conecte sua conta em Integrações. A descoberta de Ad Accounts não seleciona todas automaticamente. Marque as contas de operação, BRL e São Paulo, e solicite Sincronizar Meta.
5. Mantenha o worker ativo. O token de usuário de longa duração tem prazo; a UI mostra a validade. Reconecte quando necessário; a aplicação não promete renovação automática indefinida. Tokens revogados podem expirar antes do prazo.

`src/lib/meta.ts` restringe caminhos da Graph API e pagina por cursores em host fixo, sem seguir URLs arbitrárias fornecidas pelo serviço. Não registra tokens ou a URL de troca OAuth. O `appsecret_proof` exige o segredo real no processo. Preserve a validação TLS.

A sincronização atualiza entidades e substitui snapshots de insights por anúncio/dia. São sincronizados os últimos 90 dias para contemplar ajustes recentes. Dados de gasto de períodos anteriores não são importados automaticamente. Não execute sincronizações simultâneas excessivas da mesma conta; acompanhe limites e erros da Meta.

Gerenciar orçamento utiliza centavos inteiros em BRL. Campanhas com orçamento no conjunto podem recusar edição no nível campanha; use a aba Conjuntos. A API de cópias está sujeita ao objetivo e compatibilidade da campanha. A resposta real da Meta é a autoridade, e a UI exibe recusas.

## Cakto: autenticação direta e formato aceito

O endpoint é `POST /api/webhooks/cakto/<chave-publica-do-workspace>`. A chave da URL identifica o workspace, não autentica o remetente. A autenticação exige o mesmo segredo do corpo, configurado em Integrações, comparado em tempo constante. Use HTTPS. Não envie o segredo em URLs, UTMs, tickets ou screenshots.

**Esta modalidade usa segredo compartilhado, não uma assinatura criptográfica oficial.** Caso seu contrato Cakto tenha um mecanismo de assinatura diferente, implemente e homologue esse mecanismo antes de trocar o método; não remova a validação para fazer um payload passar. O acesso à documentação externa da Cakto foi bloqueado na sessão de desenvolvimento. O adapter é um contrato explícito a validar com os payloads reais da sua conta.

Exemplo mínimo do contrato implementado (segredo ilustrativo; não usar em produção):

```json
{
  "secret": "SUBSTITUA_PELO_SEGREDO_CONFIGURADO",
  "event": "purchase_approved",
  "data": {
    "id": "pedido-cakto-123",
    "amount": 197.9,
    "currency": "BRL",
    "createdAt": "2026-10-21T12:00:00Z",
    "approvedDate": "2026-10-21T12:02:00Z",
    "customer": { "email": "comprador@example.com" },
    "product": { "name": "Produto exemplo" },
    "paymentMethod": "pix",
    "utm": {
      "utm_source": "meta",
      "utm_medium": "paid_social",
      "utm_campaign": "ID_NUMERICO_CAMPANHA",
      "utm_term": "ID_NUMERICO_CONJUNTO",
      "utm_content": "ID_NUMERICO_ANUNCIO"
    },
    "metadata": { "mt_click": "00000000-0000-4000-8000-000000000001" }
  }
}
```

- `amount` é o valor em **reais**, convertido uma vez para centavos. O adapter não aceita formatos locais como `197,90` nem infere unidade.
- `data.id` identifica o pedido. `id` no nível superior, quando fornecido, deve ser o ID único da **entrega/evento**, não novamente o ID do pedido. Sem ID de evento, o hash canônico do evento/dados é usado; lifecycle e job únicos também impedem duplicação de compra.
- Datas ISO: `updatedAt` tem preferência para atualização; aprovação usa `approvedDate`, com fallback em `createdAt`. O webhook deve conter pelo menos uma data válida. Reembolsos/chargebacks são estados terminais e prevalecem mesmo quando o provedor repete a data original de criação.
- E-mail é normalizado e persistido somente como hash SHA-256 para matching CAPI; o corpo inteiro e o segredo não são armazenados. Nome, CPF, telefone e endereço do comprador não são persistidos.
- UTMs são aceitas em `data.utm`, `data.tracking` ou diretamente em `data`. Campos nulos são tolerados. `mt_click` é aceito em `data.metadata`, `data.tracking` ou `data.utm`; só use esse metadado se sua integração efetivamente o preservar.
- O evento desconhecido autenticado é ignorado com 200 após validação estrutural. Erros de autenticação retornam 401; JSON/schema inválidos, 400; moeda incompatível, 422; limitação de frequência, 429; erro transiente, 500. Configure retries do provedor para falhas transientes.

| Evento                                                  | Estado interno |
| ------------------------------------------------------- | -------------- |
| `purchase_approved`                                     | `approved`     |
| `purchase_pending`, `pix_generated`, `boleto_generated` | `pending`      |
| `purchase_refused`                                      | `refused`      |
| `purchase_refunded`                                     | `refunded`     |
| `chargeback`, `purchase_chargeback`                     | `chargeback`   |

Somente aprovação cria job Purchase, atomicamente com o pedido. Reembolso e chargeback retiram a venda das métricas aprovadas; não enviam uma conversão negativa à Meta. Não há API de estorno de um Purchase previamente enviado neste adapter.

### Assinatura HMAC de relay opcional

Se um gateway **seu** recebe o webhook e encaminha para o MetaTrack, configure `CAKTO_RELAY_HMAC_SECRET` no gateway e no servidor. O gateway deve calcular HMAC SHA-256 sobre os bytes UTF-8 **exatos** do JSON encaminhado e enviar:

```text
x-metatrack-signature: sha256=<64 caracteres hexadecimais minúsculos>
```

Com a variável preenchida, o MetaTrack exige a assinatura **e** o segredo nativo do corpo. Sem a variável, aceita a integração direta com a autenticação nativa do contrato acima. Isso não atribui à Cakto um cabeçalho de assinatura que ela não forneceu. Deduplicação limita replay; mantenha o gateway privado e monitore entregas. Não use um proxy que altera JSON depois da assinatura.

## Pixel e transporte de atribuição

Em Integrações, autorize origens exatas, por exemplo `https://oferta.exemplo.com`. O coletor recusa origens desconhecidas e exige `consent: true`. CORS não é autenticação e pode ser forjado por clientes fora do navegador; o coletor é deliberadamente público. Ele nunca cria receita com base em um evento do browser.

```html
<script src="https://SEU_METATRACK/pixel.js" defer></script>
<script>
  // Chame após o script carregar E após seu CMP obter consentimento:
  function onTrackingConsent() {
    MetaTrack.init({ key: 'CHAVE_PUBLICA_DO_WORKSPACE', consent: true });
  }
  // Conforme ações reais do usuário:
  // MetaTrack.track('ViewContent');
  // MetaTrack.track('InitiateCheckout');
  // checkoutLink.href = MetaTrack.decorateCheckout(checkoutLink.href);
  // Na revogação: MetaTrack.revoke();
</script>
```

`decorateCheckout` transporta UTMs e `mt_click` por query string. Confirme no sandbox da Cakto o que é preservado e como o token pode ser mapeado para `metadata.mt_click`; não suponha que um parâmetro arbitrário retorne. Com apenas UTMs ainda há atribuição por anúncio/campanha, mas os identificadores de matching de clique podem faltar.

O pixel conserva o último clique de campanha por até 90 dias no armazenamento do domínio. Nova navegação com UTMs/fbclid inicia nova origem; navegação direta preserva a anterior válida. Domínios distintos não compartilham localStorage. URLs persistidas no servidor excluem query e fragmento para evitar armazenar dados pessoais acidentalmente.

Atribuição por clique validado tem prioridade. Um ad_id conhecido determina adset e campanha, evitando combinações incompatíveis. Nomes de campanha não substituem IDs. Tráfego não identificado permanece sem origem; sincronize a conta antes de iniciar tráfego para que os IDs existam.

### Purchase e deduplicação CAPI

A fonte autoritativa é o pagamento aprovado. `event_id = cakto:<data.id>:purchase` é estável. Retries usam o mesmo ID. A chave de job é única por workspace, tipo e ID, e a transação do pedido inclui a criação do job. Se você também envia Purchase por outro pixel/provedor ao mesmo Dataset, configure **o mesmo event_name e event_id** ou desative esse emissor redundante. O MetaTrack não pode deduplicar automaticamente um ID gerado por outra plataforma.

Eventos de navegação usam UUID do pixel. O evento Purchase enviado manualmente pelo script não é encaminhado à CAPI nem cria pedido. Identificadores disponíveis são `fbc`, `fbp` e hash de e-mail; eventos website também preservam URL e user agent do clique. Se o token de clique não retornar e faltarem os campos de contexto obrigatórios, o job fica em erro explícito, sem declarar entrega; não há fingerprinting, uso não consentido de IP ou promessa de matching perfeito. Remova eventos sem consentimento conforme sua base legal e política operacional; receber um webhook de pagamento não dispensa sua avaliação de consentimento e LGPD para publicidade.

## Homologação obrigatória antes de produção

1. Confirme login com Facebook e o callback exato com um usuário autorizado no aplicativo.
2. Liste e selecione uma Ad Account BRL/São Paulo; sincronize e confira gasto de um dia com insights Meta.
3. Configure webhook e segredo na Cakto; envie uma entrega de teste e compare os nomes/campos com o contrato.
4. Abra uma landing page com UTMs de IDs válidos, conceda consentimento, gere checkout e confirme que UTMs/token retornam no pedido.
5. Efetue uma compra sandbox permitida pela plataforma. Confira valor em centavos, campanha/conjunto/anúncio e um único job Purchase.
6. Reenvie o webhook e confirme ausência de receita duplicada. Teste pendente → aprovado → reembolsado e um chargeback independente.
7. Use Test Events no Events Manager e confira `events_received=1`, identificadores, `event_id`, qualidade de matching e ausência de duplicação por outra integração.
8. Retire `test_event_code`, confira as permissões externas do aplicativo e monitore primeiras entregas de produção.


### Visitas de destino no funil

Os cliques usam `inline_link_clicks`; as visitas usam `actions` com tipo exato
`landing_page_view` do Insights da Meta, por anúncio e dia. PageViews do pixel
MetaTrack não são somados a essa métrica. Sem essa ação na resposta, o valor é zero.
Checkouts continuam sendo eventos do pixel MetaTrack e vendas vêm da Cakto.
As visitas refletem a medição e a atribuição da Meta, não visitantes individuais.

Ao atualizar, pare o worker, execute `npm run db:migrate` (migração 004), publique
o site, reinicie o worker e solicite uma sincronização para preencher os últimos
90 dias. A Meta precisa ter dados de visualizações de destino disponíveis.
