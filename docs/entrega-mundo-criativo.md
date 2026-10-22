# Entrega privada do Pequenos Construtores

O Jotafy autoriza o PDF a partir do pedido aprovado da Cakto já registrado, com isolamento por workspace e nome exato do produto. A loja Mundo Criativo entrega os bytes pelo Worker e R2 privado. Não há dependência do processador Render para autorizar um download.

Configuração completa, armazenamento, URL de obrigado, passagem da Cakto e testes: [guia do Mundo Criativo](https://github.com/joaolucasqueiros/mundocriativo/blob/main/docs/entrega-segura.md).

1. Aplique `npm run db:migrate` com a conexão de produção no ambiente seguro do Jotafy. A migration `006` cria a tabela `delivery_access`.
2. Cadastre `DELIVERY_SERVICE_SECRET`, 64 caracteres hexadecimais aleatórios, como Secret no Worker Jotafy e o mesmo valor no Worker Mundo Criativo. Não altere segredos existentes nem envie esse valor no chat.
3. Publique este Jotafy. Na loja, prepare o bucket privado e ative `npm run deploy:delivery` conforme o guia.
4. Em Vendas, abra um pedido aprovado do Pequenos Construtores e use **Gerar link do material**. Um link vale 24 horas para a primeira abertura e libera um cookie protegido por 30 dias naquele navegador. O próximo download sempre verifica o estado atual do pedido.

O nome padrão é `Pequenos Construtores — 131 Projetos Criativos`. `DELIVERY_PRODUCT_NAME`, `DELIVERY_WORKSPACE_PUBLIC_KEY` e `MUNDO_CRIATIVO_ORIGIN` permitem ajustar os valores no servidor; não são parâmetros controlados pelo comprador. A emissão de outro produto, outro workspace, pedido pendente, reembolsado ou com chargeback é recusada.

`POST /api/orders/[id]/access` exige sessão do vendedor, mesma origem e limite de emissão. `POST /api/delivery/authorize` é interno e exige o segredo do serviço antes de consultar o banco; não aceita autenticação por ID de pedido, UTM ou chave pública.

Os hashes dos acessos ficam em `delivery_access`; tokens em claro e links completos não são gravados nos logs ou auditoria. A rotina de retenção remove acessos expirados há mais de sete dias. A auditoria usa os eventos operacionais do guia, sem criar pedidos nem novos eventos Meta.

O redirecionamento automático da Cakto com identificação segura não foi confirmado. O link individual gerado no painel é a entrega funcional implementada. A URL genérica de obrigado, sozinha, mantém o arquivo bloqueado.

Validação local com banco de QA: `npm run test:delivery`. A suíte cobre webhooks duplicados, aprovação/pendência, expiração, uso único concorrente, escopo de produto/workspace, sessão e revogação por reembolso. O PDF e suas credenciais de armazenamento não ficam neste repositório.
