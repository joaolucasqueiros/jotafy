# Processador HTTP no Render gratuito + cron-job.org

Esta alternativa mantém painel e webhooks na Cloudflare e executa a fila em um serviço web Node separado. O arquivo `render-free.yaml` solicita explicitamente o plano `free`. O arquivo `render.yaml` original configura um Background Worker pago: não use esse Blueprint para esta alternativa.

O plano gratuito pode suspender o serviço por inatividade, tem franquias e não garante execução contínua ou atraso fixo. O primeiro disparo após uma suspensão pode demorar ou expirar no agendador; os jobs permanecem no banco para a próxima tentativa. Confirme a disponibilidade e os termos do plano Free na tela de criação. Não é necessário contratar um Background Worker. Esta configuração não cria serviços nem aceita cobrança automaticamente.

## 1. Criar o serviço web

No Render, escolha New → Web Service e conecte `joaolucasqueiros/jotafy`, branch `main`:

| Campo             | Valor                                    |
| ----------------- | ---------------------------------------- |
| Runtime           | Node                                     |
| Build Command     | `npm ci --omit=dev --no-audit --no-fund` |
| Start Command     | `npm run processor:http`                 |
| Instance Type     | **Free**                                 |
| Health Check Path | `/health`                                |

Como alternativa ao formulário manual, use um Blueprint apontando explicitamente para `render-free.yaml`, revisando o plano exibido antes de criar. Não é necessário fazer build do Next.js nem publicar outra cópia do painel.

Configure no ambiente do serviço:

- `DATABASE_URL`: a mesma conexão PostgreSQL de produção usada na Cloudflare, com TLS validado.
- `ENCRYPTION_KEY`: a chave original de produção. Não gere outra: os tokens existentes precisam ser descriptografados.
- `META_APP_SECRET`: o segredo real do mesmo aplicativo Meta usado pelo painel.
- `CRON_SECRET`: um segredo novo aleatório de pelo menos 32 caracteres. O Blueprint pode gerá-lo. Guarde no secret manager, sem publicar no repositório ou enviar no chat.
- `NODE_ENV=production`, `NODE_VERSION=24`, `META_GRAPH_VERSION=v25.0`.

O Render fornece `PORT`. O serviço escuta nessa porta em `0.0.0.0` e não inicia processamento antes de receber um disparo autenticado. Após o deploy, abra `https://SEU_SERVICO.onrender.com/health`: `{"ok":true}` confirma que o servidor iniciou, não que banco ou Meta já foram validados.

## 2. Agendar trabalho real

No cron-job.org, crie um agendamento:

| Campo              | Valor                                       |
| ------------------ | ------------------------------------------- |
| URL                | `https://SEU_SERVICO.onrender.com/api/jobs` |
| Método             | `POST`                                      |
| Cabeçalho          | `Authorization: Bearer SEU_CRON_SECRET`     |
| Frequência inicial | a cada 5 minutos                            |

Use a URL do **Render**, não a do Worker Cloudflare. O segredo vai somente no cabeçalho; não o acrescente à URL. O agendamento dispara o processamento real da fila e as sincronizações elegíveis. Não configure chamadas artificiais de keep-alive.

A resposta 202 significa disparo aceito. O ciclo continua no processo Node após a resposta para evitar depender do timeout HTTP do agendador. Pedidos simultâneos não iniciam ciclos duplicados no mesmo processo; as travas no PostgreSQL também protegem contra outra instância. Cada ciclo agenda as sincronizações elegíveis, processa até 10 jobs (inclusive `capi_test`) e executa a retenção no máximo uma vez por hora. Filas maiores precisam de mais ciclos.

## 3. Confirmar o resultado

Execute manualmente o agendamento uma vez. Confira os logs do serviço: `processor_http_started` e `processor_cycle_finished`, com quantidades completed/failed. Um 202 não comprova recebimento pela Meta; a confirmação permanece no painel, por job.

Em Jotafy → Rastreamento, gere um teste com o código TEST da Meta. Após um ciclo, confirme “Aceito pela Meta” e o recibo. Se houver erro, confira a mensagem do job. Segredos incorretos retornam 401 no disparo; falha de banco ocorre no ciclo e fica indicada nos logs sem expor a URL de conexão. Configurações ausentes impedem o serviço de iniciar e registram somente os nomes das variáveis faltantes.

Depois de validar o Render, você pode desativar o workflow GitHub Actions antigo para manter apenas um agendador. O GitHub Actions e o Render usam as mesmas travas de jobs, mas não é necessário manter ambos para esta configuração.

## Operação

Este serviço usa o mesmo banco já migrado. Não execute migrations em cada disparo. Preserve backups e a chave de criptografia original. Suspensões, reinícios ou falhas transitórias não removem a fila; os leases dos jobs e event_ids preservam a recuperação/deduplicação. O plano gratuito não substitui um serviço contínuo quando a operação exigir entrega imediata ou SLA.
