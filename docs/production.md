# Operação e limites da versão 1.0

## Serviços

- Web: `npm start`, Node.js, porta 3000 atrás de ingress HTTPS. Não faça deploy como export estático.
- Worker: `npm run worker`, processo contínuo com o mesmo banco e configurações da aplicação. Reinicie automaticamente em falha.
- PostgreSQL: banco persistente com TLS validado, usuário de aplicação com privilégios mínimos e backups testados.
- Migração: `npm run db:migrate` antes de liberar réplicas web/worker. O banco tem versionamento e trava. Não inicie migrations automaticamente em todas as requisições.
- Health: `GET /api/health` retorna 200 somente se o banco responde e a migração esperada existe. Falhas retornam 503 sem detalhes privados.

O Docker Compose é de desenvolvimento. Sua senha conhecida e volume local não são um provisionamento de produção. O Dockerfile não incorpora `.env.local`. No ambiente em nuvem do onboarding, processos não são considerados persistentes entre tarefas; siga as instruções de inicialização salvas. A restauração dos dados do Docker externo não foi homologada em uma tarefa nova.

## Rede e proteção

O web/worker precisa de PostgreSQL, `graph.facebook.com` e o navegador do usuário precisa de `www.facebook.com` para OAuth. Webhooks chegam por HTTPS público da Cakto; não é necessário chamar uma API Cakto para o fluxo de vendas implementado. O site do cliente precisa alcançar a origem pública do MetaTrack para `pixel.js` e `/api/tracking`.

No ingress configure limites de corpo e frequência por IP, proteção a abuso de cadastro/login e dos endpoints públicos, timeouts e forward de origem confiável. O servidor aplica limites globais e por e-mail/workspace no banco, mas não confia em `x-forwarded-for` arbitrário. Não exponha a porta PostgreSQL publicamente. Mantenha `APP_URL` exata e HTTPS. Cookies de sessão são Secure em produção; testes HTTP locais devem rodar `npm run dev` ou usar um contexto HTTPS.

A CSP atual permite inline styles/scripts para bootstrap do Next.js e restringe conexões ao mesmo domínio. Em desenvolvimento permite eval para o runtime de depuração. A versão de produção não habilita unsafe-eval. Para uma política sem scripts inline, adote nonces por requisição conforme o guia da versão instalada de Next.js e teste antes de endurecer. O CSP do **site que instala o pixel** deve permitir a origem pública do MetaTrack em script-src/connect-src.

## Fila e falhas

Jobs são obtidos com `FOR UPDATE SKIP LOCKED`, coordenação por workspace e bloqueio de dois minutos renovado durante a execução. Tentativas antigas não podem sobrescrever as atuais. Backoff exponencial começa após a primeira falha e tem teto de 6 horas. Após dez tentativas, o job fica `failed`. Observe filas pending/running/failed, idade do job, erros de token/permissão, limite Meta, disponibilidade do banco e hora da última sincronização.

Payload sem identificador de matching ou sem configuração de CAPI não é marcado entregue. Reconfigure os segredos, confirme a causa e reagende somente os jobs do workspace afetado. Não altere o evento para fazer a validação passar. Os limites de idade de eventos da Meta continuam aplicáveis; um evento velho pode exigir reconciliação operacional em vez de reenvio.

Exemplo de inspeção SQL com parâmetros aplicados pelo seu cliente seguro (não cole segredos em logs):

```sql
SELECT id, kind, status, attempts, run_at, last_error
FROM jobs
WHERE workspace_id = $1
ORDER BY created_at DESC;

-- Após corrigir o problema, reagende explicitamente um job revisado:
UPDATE jobs SET status='pending', attempts=0, run_at=now(), locked_until=NULL
WHERE id=$1 AND workspace_id=$2 AND status='failed';
```

Solicitações manuais reutilizam trabalhos pendentes; execuções por workspace são serializadas e as operações de importação são upserts idempotentes. Em operações de grande volume, serialize por conta e adote a API assíncrona de Insights. O limite de paginação falha explicitamente e não apresenta uma importação parcial como concluída.

## Privacidade, exclusão e chaves

- O pixel precisa de consentimento anterior à inicialização e oferece revoke. A aplicação não pode impor o comportamento do CMP ou a base legal do checkout externo.
- Cliques e eventos de navegação são purgados após 90 dias. Hash de e-mail de pedidos é removido após 90 dias. Recibos de deduplicação expiram após 180 dias. Payloads dos jobs concluídos são purgados após 7 dias.
- Jobs falhos ou pendentes conservam payload por até 30 dias para diagnóstico e retry. Após esse prazo o payload é removido e o job expira como failed.
- Dados contábeis e auditoria permanecem até exclusão administrativa. Defina política própria. Um hash de e-mail ainda é dado pessoal pseudonimizado.
- Para exclusão de conta, o administrador deve autenticar a solicitação, exportar quando aplicável e excluir o usuário no banco. As FKs eliminam workspace, sessões, tokens, pedidos e jobs em cascata. Não há fluxo self-service de exclusão nesta versão. Registre procedimento e contato reais na política de privacidade e nos campos do aplicativo Meta.
- Guarde ENCRYPTION_KEY e backups criptografados separadamente. Rotação exige recriptografar tokens com a chave antiga antes de trocar; não substitua o valor aleatoriamente em uma atualização.
- Tokens nunca são retornados pelo GET de integrações. O segredo recém-gerado é mostrado apenas na resposta de geração para o titular copiá-lo e cadastrar no provedor. Evite screenshots dessa resposta.

## Escopo que ainda demanda trabalho de produto

A versão 1 oferece um usuário por workspace. Não inclui convites/equipes, billing SaaS, SSO corporativo, recuperação de senha, verificação de e-mail ou portal de exclusão. O lucro estimado usa taxas médias e não substitui lucro líquido contábil conciliado. Não há importação histórica Cakto anterior à ativação do webhook, reconciliação com API de pedidos, normalização multimoeda ou integração Google/TikTok. Campanhas anteriores à primeira sincronização podem gerar vendas sem atribuição; sincronize antes do tráfego e valide os webhooks reais.

Antes de abrir cadastro público, conclua a homologação dos provedores, o fluxo de recuperação/verificação de e-mail conforme sua operação, revisão de isolamento/autorização, monitoramento, revisão LGPD e exercício de restauração. Os testes locais não certificam permissões Meta nem contratos externos.

## Worker contínuo no Render

Siga [o passo a passo do Render](render-worker.md). O `render.yaml` na raiz cria
apenas um Background Worker Node, sem trocar o site Cloudflare nem provisionar
outro PostgreSQL. Revise o plano pago apresentado pelo provedor antes de criar.
