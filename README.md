# MetaTrack

Plataforma de atribuição de vendas para **Meta Ads + Cakto**, com dashboard em português, autenticação, PostgreSQL, pixel consentido e processamento server-side. O backend roda em Node.js nos Route Handlers do Next.js; não é necessário manter um segundo servidor NestJS.

A página inicial sem sessão abre uma demonstração explicitamente identificada, com dados ilustrativos. Ao criar uma conta, o workspace começa vazio e exibe apenas seus dados persistidos. A demonstração nunca chama a Meta para editar campanhas.

## Executar localmente

Requisitos: Node.js 22+ (validado em Node 24), npm, Docker Compose ou PostgreSQL 17 acessível.

```bash
cp .env.example .env.local
# Gere uma chave: openssl rand -base64 32
# Coloque o resultado em ENCRYPTION_KEY dentro de .env.local.
npm ci
# Banco de desenvolvimento, vinculado somente ao loopback:
docker compose up -d db
npm run db:migrate
npm run dev
```

Em outro terminal, no mesmo diretório:

```bash
npm run worker
```

O worker Node executa a fila e agenda sincronização das contas selecionadas a cada 15 minutos. O botão Atualizar / Sincronizar Meta enfileira o trabalho; a página acompanha seu estado e relê as métricas. Mantenha `npm run worker` ativo no computador durante testes ou em um serviço Node na produção. A sincronização pesada não roda dentro da requisição Cloudflare, evitando o erro 1102. O endpoint `/api/jobs` é uma alternativa autenticada somente quando hospedado em Node; no runtime Cloudflare ele retorna 503.

Crie uma conta em `/login`, configure as integrações e use `/guide` como guia operacional. A migração é transacional, tem trava de concorrência e pode ser repetida.

## Variáveis e segredos

| Configuração                           | Uso                                                                                                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                         | PostgreSQL. Em produção use TLS validado, por exemplo `sslmode=verify-full`, certificado da CA do provedor e `NODE_EXTRA_CA_CERTS` quando necessário. Nunca use `rejectUnauthorized=false`.          |
| `APP_URL`                              | Origem pública exata, sem barra final. Local: `http://localhost:3000`; produção: HTTPS. Define callback OAuth, validação de origem e URLs de integração.                                             |
| `ENCRYPTION_KEY`                       | **Segredo local do servidor**, 32 bytes em base64, gerado uma vez. Criptografa tokens AES-256-GCM. Preserve em um secret manager; trocar sem recriptografar perde acesso aos tokens existentes.      |
| `META_APP_ID`                          | ID do aplicativo Meta Business.                                                                                                                                                                      |
| `META_APP_SECRET`                      | Segredo real do aplicativo, disponível ao processo servidor. Também é usado localmente no HMAC `appsecret_proof`. Não funciona como placeholder de proxy que só é substituído em HTTPS.              |
| `META_GRAPH_VERSION`                   | Versão explícita da Graph API; padrão `v25.0`. Confira suporte e revisão das permissões do aplicativo antes da homologação.                                                                          |
| Segredo Cakto (`CAKTO_WEBHOOK_SECRET`) | **Configure por workspace em Integrações**, não como variável global. O valor é armazenado criptografado e deve ser o mesmo cadastrado na Cakto. Não é exposto no GET da configuração.               |
| Pixel/Dataset + token CAPI             | Configure por workspace em Integrações. Token criptografado, nunca enviado ao browser. O token precisa de permissão para o Dataset/Pixel.                                                            |
| `CAKTO_RELAY_HMAC_SECRET`              | Opcional: exige `x-metatrack-signature: sha256=<hex>` sobre o corpo bruto de um **relay próprio**. Deixe vazio para integração direta Cakto. Este não é um protocolo oficial de assinatura da Cakto. |
| `CRON_SECRET`                          | Segredo forte para o endpoint de jobs. Opcional se você usa somente o worker CLI.                                                                                                                    |
| `SIGNUP_EMAIL_DOMAIN`                  | Opcional: restringe novos cadastros ao domínio exato. Vazio permite cadastro público. Não substitui verificação de e-mail nem convites.                                                              |

Não prefixe segredos com `NEXT_PUBLIC_`. Não versione `.env.local`. Não utilize credenciais fictícias para simular uma integração bem-sucedida. A autenticação nativa usa scrypt, sessões aleatórias de sete dias com hash no banco e cookies HttpOnly/SameSite=Lax; Secure em produção.

## O que está implementado

- Cadastro/login por e-mail e senha; login com Facebook OAuth, estado criptografado e expirável, troca por token de longa duração. Contas de mesmo e-mail não são vinculadas automaticamente.
- Conexão de múltiplas Ad Accounts por workspace; importação paginada de campanhas, adsets, anúncios e insights diários dos últimos 90 dias. BRL e fuso `America/Sao_Paulo` são exigidos nesta versão para não somar moedas ou dias diferentes.
- Ativar/pausar campanhas e conjuntos, alterar orçamento diário em centavos e duplicar campanhas com `deep_copy`, criando a cópia pausada. A Meta valida elegibilidade, limites e orçamento mínimo. Ações são registradas em auditoria. Não há criação de campanhas do zero nesta versão.
- Webhook Cakto com segredo compartilhado em tempo constante, limites de corpo e frequência, schema Zod, deduplicação e trava por pedido. Estados terminais não regridem. Um webhook repetido não duplica receita nem Purchase.
- Pixel JS com consentimento explícito, PageView, ViewContent, InitiateCheckout e Purchase. Purchase do navegador registra um evento de diagnóstico e **não** cria uma venda nem job de compra. A confirmação de pagamento é autoritativa.
- Atribuição via `mt_click` ou UTMs de IDs. Anúncios e conjuntos são resolvidos no próprio workspace, sem confiar em IDs de outro cliente. Venda sem origem válida fica sem atribuição.
- Outbox CAPI persistida na mesma transação do pedido, `event_id` estável, retries com backoff, até dez tentativas, erro visível e confirmação de `events_received`. Payloads antigos e sem matching válido não são declarados entregues.
- Dashboard com períodos de até 90 dias, filtros campanha/conjunto/anúncio, receita, gasto, ROAS, CPA, lucro estimado, reembolsos, funil agregado e origem das vendas. Histórico e exportação CSV dos últimos 200 pedidos do filtro.
- Editor visual da visão geral: arraste cards e blocos pela barra verde e redimensione por cantos/bordas em uma grade de 12 colunas; salvar, descartar e restaurar. Opções adicionais de visibilidade, 2/3/4 cards por linha, espaçamento e tamanho dos valores. Preferências em localStorage por workspace e navegador, com restauração do padrão; não sincronizam entre dispositivos.
- UI responsiva com Tailwind e componente Button no padrão shadcn/ui (Radix Slot + CVA). Os componentes estão no próprio repositório e podem ser adaptados.

## Estrutura

```text
db/*.sql                           # Schema, índices e migrações incrementais
scripts/migrate.ts                 # Migração com versionamento e advisory lock
scripts/worker.ts                  # Processamento contínuo e sincronização periódica
src/app/api/auth/                  # E-mail, sessões e Meta OAuth
src/app/api/meta/                  # Contas, sincronização, entidades e gestão
src/app/api/webhooks/cakto/[key]/   # Ingresso autenticado por workspace
src/app/api/tracking/              # Coletor público com CORS e consentimento
src/app/api/dashboard/             # Métricas filtradas e isoladas
src/app/api/integrations/          # Configuração; segredos nunca retornados
src/app/api/jobs/                  # Alternativa autenticada ao worker
src/app/api/health/                # Prontidão do banco e migração
src/lib/meta.ts                    # Cliente Graph API, paginação e sincronização
src/lib/cakto.ts                   # Contrato e normalização do provedor
src/lib/orders.ts                  # Ciclo de venda, atribuição e outbox atômica
src/lib/jobs.ts                    # Lease, retries e retenção
src/lib/dashboard.ts               # Consultas e agregações de métricas
src/components/dashboard.tsx       # Dashboard e gestão da operação
src/components/charts.tsx          # Gráficos interativos
public/pixel.js                    # Script público sem tokens privados
tests/unit/                       # Criptografia, normalização, HMAC e métricas
tests/integration.test.ts          # Banco e APIs HTTP reais
tests/browser/                    # Navegação e responsividade Playwright
```

Os adaptadores de anúncios (`meta.ts`) e vendas (`cakto.ts`/`orders.ts`) são separados. A tabela `orders` possui `provider` e a fila possui `kind`; novos provedores devem implementar seus contratos próprios, autorização e matching sem reutilizar formatos da Meta por suposição.

## Homologar Meta, Cakto e pixel

Veja [docs/integrations.md](docs/integrations.md) para callback, escopos, eventos, payload aceito, exemplos de pixel, política de deduplicação e roteiro completo. As rotas são reais; os provedores externos **não foram homologados com credenciais de cliente neste ambiente**. Os testes locais validam o contrato implementado, não substituem uma venda real e um Test Event aceito pela Meta. A documentação externa da Cakto não estava acessível pela política de rede desta sessão; confirme o payload efetivo da sua conta antes de habilitar tráfego pago.

## Métricas e limites da atribuição

- Receita: pedidos cujo estado atual é `approved`, pela data da primeira aprovação em São Paulo. Pedidos reembolsados/chargebacks são excluídos. O estorno reclassifica a venda original, em vez de registrar um lançamento financeiro na data do estorno.
- Gasto, cliques e impressões vêm dos insights Meta diários. ROAS e CPA são recalculados com as vendas Cakto, não com as compras reportadas pelo Ads Manager.
- Lucro estimado = receita aprovada − gasto − impostos/taxas/custos médios configurados em Configurações. Despesas fixas por dia entram apenas na visão sem filtro de campanha, conjunto ou anúncio. É uma estimativa, não conciliação contábil.
- Taxa de reembolso = reembolsados ÷ (aprovados + reembolsados + chargebacks). Pendentes e recusados não entram.
- Clique consentido válido (até 90 dias) tem preferência sobre UTMs. A integração do checkout precisa devolver `metadata.mt_click` ou UTMs; o JavaScript não controla quais metadados a Cakto aceita/preserva. O modo UTM continua funcionando quando o token de clique não retorna.
- Adblockers, ausência de consentimento, identificadores removidos, tráfego anterior à sincronização ou ao pixel e payloads sem UTMs podem deixar vendas sem atribuição. Não há fingerprinting nem promessa de recuperar todas as conversões iOS.
- O funil soma eventos e não representa usuários únicos ou uma coorte fechada.

## Validação

```bash
npm run typecheck
npm test
# Usa DATABASE_URL; cria usuários temporários e os apaga ao terminar:
npm run test:integration
# Com o servidor em execução, também exercita as rotas HTTP:
TEST_BASE_URL=http://localhost:3000 npm run test:integration
# Chromium instalado no sistema ou CHROMIUM_PATH apontando para um executável confiável:
npm run test:e2e
npm run build
npm run format:check
```

A suíte de banco não deve ser executada apontando para o banco de produção. O teste HTTP só executa se `TEST_BASE_URL` estiver definido; a saída do runner distingue skipped de passed. Testes externos precisam de contas sandbox e permissões reais.

## Implantação

**Worker contínuo no Render:** o [render.yaml](render.yaml) cria apenas o processador Node. Siga [docs/render-worker.md](docs/render-worker.md) para conectar o repositório, revisar o plano pago e cadastrar os mesmos três segredos usados pela aplicação. O site permanece na Cloudflare.

**Cloudflare Workers:** siga [docs/cloudflare.md](docs/cloudflare.md). Use o build OpenNext e Wrangler; `npm start` abaixo é apenas para servidores Node/Docker.

```bash
npm ci
npm run db:migrate
npm run build
npm start
# Serviço separado, com as mesmas variáveis e acesso ao banco:
npm run worker
```

O Dockerfile permite construir uma imagem da aplicação e iniciar o worker com o mesmo artefato e comando `npm run worker`. Migre uma vez antes de iniciar as réplicas. Nunca passe segredos como build args. A imagem exclui `.env*`; forneça-os no runtime pelo secret manager do seu provedor. Configure HTTPS no ingress, limites por IP no proxy confiável, logs com redação, métricas de jobs falhos, backups e restauração de PostgreSQL. Veja [docs/production.md](docs/production.md).

Esta entrega é a base funcional da versão 1.0, não uma certificação de prontidão operacional. Ainda exige homologação dos provedores, revisão de segurança do deployment, configurações e políticas específicas do negócio. Não inclui cobrança de assinatura, recuperação de senha por e-mail, verificação de e-mail, equipes com múltiplos membros ou conectores Google/TikTok.
<!-- Cloudflare: reenviar versão com diagnóstico de configuração do Meta OAuth. -->
