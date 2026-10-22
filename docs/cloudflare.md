# Cloudflare Workers

Este projeto tem dois destinos de execução: Node.js (`npm run build` / `npm start`) e Cloudflare Workers (OpenNext + Wrangler). Não configure `npm start` como comando de deploy de um Worker.

## Configurar o projeto jotafy no painel Cloudflare

Em **Workers e Pages → jotafy → Configurações → Builds**, use:

| Campo                   | Valor                       |
| ----------------------- | --------------------------- |
| Repositório             | `joaolucasqueiros/jotafy`   |
| Branch de produção      | `main`                      |
| Diretório raiz          | raiz do repositório         |
| Comando de build        | `npm run build:cloudflare`  |
| Comando de deploy       | `npm run deploy:cloudflare` |
| Versão de Node no build | `24`                        |

O arquivo `wrangler.jsonc` preserva variáveis configuradas no painel (`keep_vars`) e define o nome do Worker, entrada gerada, assets e `nodejs_compat`. Não é necessário criar R2 para esta versão: os dados de negócio são dinâmicos em PostgreSQL e não usamos ISR/cache compartilhado.

A raiz do site funciona como demonstração sem credenciais externas e sem banco configurado. Abra o domínio público informado pelo Cloudflare após o deploy. `/api/health` retorna 503 enquanto o banco não estiver configurado; isso não impede a demonstração de renderizar.

## Banco e autenticação reais

Em **Configurações → Variáveis e segredos**, configure no runtime do Worker:

- `APP_URL`: a URL HTTPS pública exata, sem barra final. Evita erro de origem no cadastro e define o callback OAuth.
- `DATABASE_URL`: PostgreSQL externo acessível ao Workers, com TLS validado. `localhost` na nuvem não aponta para o banco Docker de desenvolvimento.
- `ENCRYPTION_KEY`: 32 bytes em base64, gerados uma vez, armazenados como segredo. Preserve a mesma chave nos deployments posteriores.
- `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION`: para conectar anúncios. O segredo do aplicativo é necessário como valor real no processo, pois calcula HMAC local.
- `CRON_SECRET`: somente se usar `POST /api/jobs` em uma implantação Node. O runtime Cloudflare recusa processamento por essa rota; use o processador GitHub Actions ou Node separado.

Execute as migrações com `npm run db:migrate` em um ambiente Node seguro que tenha acesso ao mesmo PostgreSQL. Não execute migrações em cada requisição. O código fecha conexões PostgreSQL de Workers dentro da operação; não compartilha sockets entre requisições. Para escala, use um endpoint de pool do seu provedor ou adapte o binding Hyperdrive do seu ambiente; nenhum ID de Hyperdrive foi inventado no repositório.

O processo contínuo `npm run worker` deve executar em Node, separado do Worker web. A rota `/api/meta/sync` somente enfileira a sincronização e reutiliza trabalhos pendentes do workspace; `GET /api/meta/sync?jobId=...` acompanha o estado. O processador consulta a Meta e grava em lotes, enquanto o painel relê os números a cada 30 segundos. Sem o processador, os trabalhos ficam aguardando e a tela informa isso. O erro Cloudflare 1102 observado ao executar toda a importação dentro da requisição motivou essa separação. O endpoint `/api/jobs` recusa processamento no runtime Cloudflare; um agendador externo chamando esse Worker não remove os limites de recursos. Para operação contínua, hospede o worker em um serviço Node. O site e o recebimento de webhooks continuam na Cloudflare.

## Validar antes de enviar

```bash
npm ci
npm run build:cloudflare
# Simula o empacotamento/upload, sem publicar:
npx wrangler deploy --dry-run
# Runtime local da Cloudflare:
npm run preview:cloudflare
```

No preview, use `.dev.vars` (ignorado pelo Git) para os valores locais. `APP_URL=http://localhost:8787` precisa corresponder à origem usada no navegador. Para executar o teste com banco local, use um PostgreSQL de desenvolvimento migrado e a mesma ENCRYPTION_KEY local. Nunca copie segredos em arquivos versionados.

Com o preview ativo:

```bash
TEST_BASE_URL=http://localhost:8787 npm run test:e2e
WORKERS_DATABASE_TEST=1 npm run test:cloudflare
```

## Falha corrigida no empacotamento

O OpenNext seleciona a exportação `workerd` do `pg-cloudflare`. O trace do build Node do Next.js havia copiado somente a exportação padrão vazia, omitindo `dist/index.js`. Isso fazia o empacotamento falhar com `Could not resolve "pg-cloudflare"`. `outputFileTracingIncludes` em `next.config.ts` inclui explicitamente os arquivos do adaptador, sem ignorar o módulo nem desativar a validação.

As versões de Next/OpenNext e o lockfile acompanham o repositório. Não use um `npx` sem versão para substituir o adaptador instalado durante o deploy. Caso o painel ainda mostre uma build antiga, selecione o commit mais recente de `main` e repita a implantação.

## Diagnosticar a abertura do login Meta

A rota `/api/auth/meta` valida as configurações antes de consultar a sessão e criar o cookie OAuth. Os códigos `META_APP_ID_MISSING`, `META_APP_ID_INVALID`, `META_APP_SECRET_MISSING`, `META_GRAPH_VERSION_INVALID`, `APP_URL_INVALID` e `ENCRYPTION_KEY_INVALID` identificam problemas nas variáveis de **runtime**, sem expor seus valores. Salve/publique as variáveis no Worker correspondente e reinicie a tentativa pelo botão do painel.

`ENCRYPTION_KEY_INVALID` exige restaurar a chave original de 32 bytes em base64. Não gere outra chave se já há tokens de integrações armazenados. O cadastro por senha pode funcionar mesmo quando essa chave ainda está ausente, porque somente o fluxo de integrações usa criptografia de tokens/estado.

Se um erro inesperado persistir, a resposta inclui `operation`, `stage` e `requestId`. Em Observability, procure esse requestId. `session_lookup` indica a consulta de sessão no banco; `state_cookie` identifica a criação do estado criptografado/cookie; `redirect` identifica a construção da resposta de redirecionamento. Os logs registram somente etapa, nome e código técnico do erro, sem corpo, senha, token, URL de conexão ou mensagem bruta do provedor. Um callback validado no painel Meta não comprova a disponibilidade dessas configurações no Worker.

## Erro 1102 ao salvar Pixel/token

Esse erro é da requisição web, não prova falha do processador Node. O cliente identifica método e rota sem expor parâmetros: `POST /api/integrations` é o salvamento; `GET /api/integrations` é a leitura da configuração. Se a gravação conclui e só a leitura posterior falha, a interface informa que as configurações foram salvas e não pede para gerar outro token.

GET e POST de Integrações compartilham uma conexão PostgreSQL por requisição entre a autenticação e as consultas; a conexão é encerrada antes do retorno no Workers. Não há socket global reutilizado entre requisições. Isso evita repetir os handshakes de conexão/autenticação a cada consulta. A rota não consulta Graph, não envia CAPI nem processa jobs ao salvar.

Publique a versão atual de `main`, recarregue o painel e repita o salvamento. Se o 1102 continuar, confira a rota na mensagem e os registros CPU/memória em Observability da Cloudflare para essa requisição. O teste local não reproduz os limites e a carga do plano de produção; confirme se o problema é CPU, memória ou versão antiga antes de alterar limites ou hospedagem.
