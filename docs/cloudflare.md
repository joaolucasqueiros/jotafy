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
- `CRON_SECRET`: se usar um agendador externo para chamar `POST /api/jobs` com Bearer.

Execute as migrações com `npm run db:migrate` em um ambiente Node seguro que tenha acesso ao mesmo PostgreSQL. Não execute migrações em cada requisição. O código fecha conexões PostgreSQL de Workers dentro da operação; não compartilha sockets entre requisições. Para escala, use um endpoint de pool do seu provedor ou adapte o binding Hyperdrive do seu ambiente; nenhum ID de Hyperdrive foi inventado no repositório.

O processo contínuo `npm run worker` é destinado a Node, não a Cloudflare Workers. Para esta implantação, mantenha esse processo em um serviço Node ou configure um agendador externo autenticado para `/api/jobs`. Sem isso, CAPI e sincronizações ficam na fila. O painel de demonstração não precisa desses serviços.

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
