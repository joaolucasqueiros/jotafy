# Processador gratuito pelo GitHub Actions

Para um repositório público, os runners Linux padrão do GitHub Actions são gratuitos, sujeitos às regras do GitHub. Em repositórios privados, confira a franquia e a cobrança da conta. Não é necessário criar serviço no Render nem manter o PowerShell aberto.

O site e os webhooks da Cakto permanecem na Cloudflare. Este workflow roda Node por um ciclo, agenda as contas selecionadas e processa até 10 jobs da fila. Não executa build nem deploy do site.

## Ativar

1. Abra o repositório no GitHub e entre em **Settings → Secrets and variables → Actions**.
2. Clique em **New repository secret** e cadastre, separadamente:
   - `DATABASE_URL`: a conexão do mesmo banco Neon usado na Cloudflare.
   - `ENCRYPTION_KEY`: exatamente a chave original configurada na Cloudflare. Não gere outra.
   - `META_APP_SECRET`: o segredo do mesmo aplicativo Meta conectado ao painel.
3. Cole somente o valor em cada segredo, sem o prefixo `NOME=`. Nunca coloque esses valores em arquivos públicos, issues ou mensagens.
4. Abra **Actions → MetaTrack - Processador**. Se o GitHub solicitar habilitar workflows, habilite.
5. Clique em **Run workflow**, escolha `main` e confirme **Run workflow**.
6. Abra a execução e confira a etapa **Processar fila**. Um resultado `{ completed: 0, failed: 0 }` é normal se não há trabalho disponível. Em caso de falha, confira a fila no painel; falhas de configuração encerram o comando com erro.
7. Depois de uma execução bem-sucedida, encerre o worker local com `Ctrl+C`. No painel, solicite uma sincronização e confira se a próxima execução conclui o job e atualiza as métricas.

## Frequência e limites

O agendamento ocorre nos minutos 7, 22, 37 e 52 de cada hora, na branch padrão. O GitHub pode atrasar ou descartar execuções sob carga; não há garantia de atualização exata a cada 15 minutos. O botão Atualizar enfileira trabalho e aguarda o processador; para antecipar uma execução, use Run workflow.

Vendas recebidas pelo webhook continuam entrando em tempo real; sincronizações Meta e envios pela Conversions API aguardam o processador. Os jobs usam travas no banco e as execuções deste workflow não se sobrepõem. Tentativas com falha permanecem na fila conforme a política de retries.

Cada execução tem limite de 12 minutos. Filas grandes podem precisar de várias execuções; para alto volume ou baixa latência, use um processo contínuo. A limpeza de retenção também roda no ciclo. Não há necessidade de configurar `/api/jobs` nem `CRON_SECRET` para este workflow.

Em repositórios públicos, o GitHub pode desabilitar agendamentos após 60 dias sem atividade no repositório. Verifique a aba Actions e reative o workflow quando necessário. Monitore as falhas: um agendamento não substitui acompanhamento operacional.
