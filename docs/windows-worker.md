# Atualizar pelo Windows com dois cliques

## Preparar uma vez

Na pasta local do projeto, atualize os arquivos com `git pull origin main`. Depois disso, o arquivo `Atualizar-MetaTrack.cmd` estará dentro da pasta `jotafy`.

O computador precisa de Node.js e acesso à internet. O `.env.local` deve conter `DATABASE_URL`, `ENCRYPTION_KEY` e `META_APP_SECRET`, com os mesmos valores usados pelo serviço. O arquivo de inicialização não contém segredos.

Para colocar na Área de Trabalho, clique com o botão direito em `Atualizar-MetaTrack.cmd` e escolha **Enviar para → Área de trabalho (criar atalho)**. Em algumas versões do Windows, abra primeiro **Mostrar mais opções**. Crie um atalho; mantenha o arquivo original na pasta do projeto.

## Atualizar os dados

1. No painel MetaTrack, clique em **Atualizar** para colocar a sincronização na fila.
2. Abra `Atualizar-MetaTrack.cmd` ou seu atalho com dois cliques.
3. Aguarde **Processamento concluído**. Se aparecer erro, a janela permanece aberta para leitura.
4. Volte ao navegador e confira o painel. Se necessário, recarregue a página.

O comando processa até 10 tarefas disponíveis em um ciclo e termina. Uma tarefa já em execução ou aguardando o prazo de retry pode não ser processada nesse ciclo; confira o estado da fila e execute novamente quando estiver disponível. Ele também agenda as contas elegíveis conforme o intervalo de sincronização de 15 minutos.

Não é um instalador `.exe`: é um inicializador Windows `.cmd`, executável com dois cliques. Ele utiliza o Node.js já instalado e instala dependências se estiverem ausentes. Não altera nem publica o código do site. Quando a janela termina, não há processador local contínuo; para atualizar novamente, repita os passos. O site e os webhooks continuam hospedados na Cloudflare.

Se o GitHub Actions já estiver habilitado, ele continua funcionando de forma independente. As travas no banco protegem o processamento de um mesmo job contra execução simultânea.
