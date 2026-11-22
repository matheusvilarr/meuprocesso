@echo off
rem Worker do DJEN: busca as publicacoes das OABs a partir deste computador.
rem Duplo-clique pra rodar agora. Agendamento automatico: ver LEIA-ME.md.
rem Chamado com qualquer argumento (ex: pelo Agendador) nao espera tecla no fim.
cd /d "%~dp0"
node worker.mjs
set CODIGO=%ERRORLEVEL%
if "%~1"=="" pause
exit /b %CODIGO%
