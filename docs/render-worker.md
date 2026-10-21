# Worker do MetaTrack no Render

O site e os webhooks ficam na Cloudflare. O processador Node contínuo no Render
consulta a Meta, atualiza o mesmo Neon e processa CAPI quando configurada.
Não usa domínio público nem porta HTTP. Não crie um Web Service para este processo.

Background Workers contínuos no Render exigem um plano pago. O Blueprint declara
`starter`; confira o preço atual no painel antes de confirmar. Não provisionamos
banco, disco ou outros serviços pagos no arquivo.

## 1. Criar o serviço

1. Acesse [o Blueprint do repositório](https://dashboard.render.com/blueprint/new?repo=https://github.com/joaolucasqueiros/jotafy).
2. Entre no Render, autorize o GitHub e o acesso a `joaolucasqueiros/jotafy`.
3. Se o link não abrir o assistente, vá a **New → Blueprint** e selecione esse repositório, branch `main`.
4. Confirme que o Blueprint encontrou `render.yaml` e o serviço `metatrack-worker`, tipo **Background Worker**, runtime **Node**.
5. Dê um nome ao Blueprint, por exemplo `metatrack`.

O serviço usa `npm ci --omit=dev --no-audit --no-fund` para instalar e
`npm run worker` para iniciar. Não precisa executar Next.js, OpenNext, Wrangler,
Docker ou compilar o site. Node 24 fica configurado no Blueprint.

## 2. Cadastrar os segredos

Antes de confirmar a criação, informe os três valores que o Blueprint solicita:

| Variável          | Valor a usar                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `DATABASE_URL`    | A mesma URL Neon já usada pelo site. Preserve as opções TLS; prefira `sslmode=verify-full`. |
| `ENCRYPTION_KEY`  | A mesma chave original cadastrada na Cloudflare. Não gere outra.                            |
| `META_APP_SECRET` | O mesmo segredo do aplicativo Meta já cadastrado na Cloudflare.                             |

Esses valores são segredos; cole apenas nos campos privados do Render. Eles não
fazem parte do Git e não precisam ser enviados no chat. Se a interface só permitir
cadastrar variáveis depois de criar, vá a **Environment**, adicione os três valores
e salve com novo deploy. Enquanto faltarem, o processo encerra com uma mensagem
indicando apenas os nomes das variáveis ausentes.

`NODE_ENV=production`, `NODE_VERSION=24` e `META_GRAPH_VERSION=v25.0` já estão no
arquivo. Se você usa outra versão Graph validada no site, mantenha-a igual aqui.
Não são necessárias `META_APP_ID`, `APP_URL`, credenciais Cakto ou `CRON_SECRET`
para esse worker. Tokens Meta e configurações de CAPI são lidos do banco e
descriptografados com a chave original.

## 3. Revisar e publicar

1. Confira o plano e o custo apresentados pelo Render.
2. Confirme a criação/implantação do Blueprint.
3. Abra o serviço `metatrack-worker` e acompanhe **Logs**.
4. Espere a instalação terminar. O processo deve emitir `worker_started` e, após
   conseguir acessar o banco e executar um ciclo, `worker_heartbeat`.
5. Se houver tarefas, aparecerão também contagens `completed`/`failed`. Sem tarefas,
   o heartbeat a cada minuto confirma que os ciclos continuam funcionando.

O heartbeat não certifica que toda tarefa foi bem-sucedida: confira erros na fila.
O serviço é contínuo e não precisa encerrar o comando para ficar ativo.

## 4. Validar antes de desligar o computador

1. Com o serviço iniciado, pare o worker local com **Ctrl + C**. Mantenha o site aberto.
2. No MetaTrack selecione a conta/campanha e o período corretos e clique **Atualizar**.
3. Em **Rastreamento → Fila de processamento**, confira que a tarefa recente termina
   em `completed` e que o horário da última sincronização avança.
4. Confira cliques e visitas com a mesma conta e período no Gerenciador da Meta.
5. Depois dessa confirmação, pode fechar o PowerShell e desligar o computador.

Mantenha somente uma instância do serviço no Render para essa configuração. A fila
coordena execuções concorrentes, mas deixar o processo local ligado é desnecessário.
O Blueprint habilita deploy automático da branch `main`: próximos pushes podem
reinstalar/reiniciar o worker. Não execute migrações automaticamente nesse comando;
aplique novas migrações antes de publicar versões que dependam delas.

## Problemas comuns

- `worker_configuration_missing`: cadastre os nomes listados em **Environment**.
- `ENCRYPTION_KEY ... inválida`: recupere a chave original da configuração segura.
- Falha de descriptografia: o worker e o site provavelmente usam chaves diferentes;
  não substitua por uma chave nova, pois os tokens existentes dependem da antiga.
- `worker_cycle_failed`: confira disponibilidade/acesso ao Neon e as configurações.
  Os logs evitam imprimir URLs de banco e segredos.
- `failed: 1`: veja o erro específico em **Rastreamento → Fila de processamento**.
- Interrupção durante deploy: o bloqueio renovável expira em até dois minutos após
  o último progresso; a fila permite retomada sem duplicar o pedido.
