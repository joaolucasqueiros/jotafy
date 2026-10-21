@echo off
setlocal
chcp 65001 >nul
title MetaTrack - Atualizar dados
pushd "%~dp0"
if errorlevel 1 (
  echo Nao foi possivel abrir a pasta do MetaTrack.
  pause
  exit /b 1
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo Node.js nao encontrado. Instale o Node.js e abra este arquivo novamente.
  goto :failure
)
if not exist "package.json" (
  echo Coloque este arquivo dentro da pasta jotafy.
  goto :failure
)
if not exist ".env.local" (
  echo Arquivo .env.local nao encontrado nesta pasta.
  echo Configure DATABASE_URL, ENCRYPTION_KEY e META_APP_SECRET antes de continuar.
  goto :failure
)
if not exist "node_modules\tsx\dist\cli.mjs" (
  echo Dependencias ausentes. Instalando... Aguarde.
  call npm.cmd ci --no-audit --no-fund
  if errorlevel 1 goto :failure
)
echo.
echo MetaTrack - Atualizacao local
echo.
echo Para buscar os dados mais recentes, clique primeiro em Atualizar no painel.
echo Este arquivo processa a fila uma vez e encerra.
echo Mantenha esta janela aberta ate terminar.
echo.
call npm.cmd run worker:once
if errorlevel 1 goto :failure
echo.
echo Processamento concluido. Confira o painel no navegador.
echo Se nao havia tarefas na fila, nenhum dado foi alterado.
echo.
popd
pause
exit /b 0

:failure
echo.
echo Nao foi possivel concluir. Confira a mensagem acima.
echo.
popd
pause
exit /b 1
