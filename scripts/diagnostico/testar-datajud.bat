@echo off
rem Teste das APIs do CNJ (DataJud e DJEN) a partir deste computador, sem Vercel.
rem Duplo-clique e digite o numero do processo ou a OAB.
chcp 65001 >nul
cd /d "%~dp0"
node testar-datajud.mjs %*
if "%~1"=="" pause
