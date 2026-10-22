# Ativação da operação Meta Ads + Cakto

## Publicar as duas partes

Publique a branch `main` do `mundocriativo` e do `jotafy` pelos builds Cloudflare já configurados. Um push no GitHub não comprova publicação: verifique a conclusão em cada Worker. Preserve os segredos existentes e a chave original de criptografia.

## Conectar a página

No Jotafy, em Integrações, adicione `mundocriativo.joaolucasqueirozag.workers.dev` nas origens permitidas e salve. A aplicação completa HTTPS e remove a barra final. Ao reabrir a aba, confira o domínio e o bloco Diagnóstico das integrações.

A página Mundo Criativo usa o coletor Jotafy com a chave pública já fornecida. Depois de aceitar o rastreamento, uma visita deve aumentar PageView no diagnóstico e um clique de compra deve aumentar InitiateCheckout. Recusar mantém a compra funcional, sem esses envios. O diagnóstico mostra 7 dias do workspace, enquanto o funil usa o período e os filtros selecionados.

## Confirmar a Cakto

Copie a URL exclusiva de webhook em Integrações. Configure essa URL e o mesmo segredo na Cakto, selecionando os eventos suportados no contrato de `integrations.md`. Nunca envie o segredo para chats, repositórios ou URLs. Não gere outro segredo se a integração existente já usa o atual.

Confira uma entrega real: status HTTP, resposta, produto, valor, data de aprovação e UTMs. Um HTTP 200 com `ignored: true` não registra venda: significa evento fora do contrato suportado. Uma entrega aprovada aceita aparece como último webhook no diagnóstico e como pedido em Vendas. Reenviar o mesmo webhook não duplica receita. Reenvie aprovações antigas pelo provedor quando disponível; não há importação histórica automática.

## Atribuir a campanha

No campo Parâmetros de URL dos anúncios Meta, use:

```text
utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}
```

A página consentida acrescenta UTMs e `mt_click` ao checkout. Confirme com a Cakto o retorno desses campos no webhook: o navegador não controla esse retorno. Sem mt_click, a atribuição por UTM ainda pode funcionar, mas o contexto de matching do clique pode faltar para CAPI. Não associe compras por suposição. Sem origem, confira Vendas sem filtro de campanha.

## Ativar o processador e CAPI

Em Integrações, cadastre o Pixel `1309619167932261` e o token CAPI com permissão nesse Pixel/Dataset. Use um código de teste durante a validação no Gerenciador de Eventos; retire-o antes de medir produção. Eventos de navegador e servidor devem usar o mesmo nome, event_id e Dataset. Confira emissores Purchase da própria Cakto antes de habilitar outro emissor para evitar duplicidades.

O site Cloudflare recebe webhooks e consultas. O envio CAPI e a sincronização Meta precisam de um processador separado. A opção existente no repositório é GitHub Actions → MetaTrack - Processador, aproximadamente a cada 15 minutos. Cadastre no secret manager do GitHub `DATABASE_URL`, `ENCRYPTION_KEY` e `META_APP_SECRET`, com os mesmos valores reais já usados pelo Worker; não gere uma chave de criptografia nova. Siga `github-actions-worker.md` e execute Run workflow. O agendamento pode atrasar. A alternativa é um processo Node contínuo conforme `render-worker.md`.

No diagnóstico, verifique último trabalho concluído, fila e envios aceitos pela Meta. Um job CAPI só conclui com `events_received: 1`; isso comprova recebimento, não atribuição ao anúncio ou compra aprovada. Corrija a causa indicada em Rastreamento antes de clicar Reagendar. Eventos de conversão com mais de 7 dias não podem ter sua data alterada para passar na validação.

## Critério de validação

Valide um clique real autorizado, um checkout, uma aprovação Cakto, sua campanha e o aceite correspondente na Meta. Confira reenvio sem duplicação e atualização automática posterior. Confirme também valores, taxas, reembolsos e custos na operação. Os testes locais usam banco isolado e respostas externas simuladas; não comprovam configuração, publicação ou recebimento nos serviços de produção.
