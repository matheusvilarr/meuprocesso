@echo off
REM Atalho do Windows para o backup — pode dar duplo clique neste arquivo.
REM Ele procura o Git Bash nos lugares onde costuma ser instalado.
setlocal

set "RAIZ=%~dp0.."

for %%B in (
  "%ProgramFiles%\Git\bin\bash.exe"
  "%ProgramFiles(x86)%\Git\bin\bash.exe"
  "%LOCALAPPDATA%\Programs\Git\bin\bash.exe"
  "%ProgramW6432%\Git\bin\bash.exe"
) do (
  if exist %%B (
    %%B "%~dp0backup.sh"
    goto :fim
  )
)

echo.
echo Nao encontrei o Git Bash nesta maquina.
echo Instale em https://git-scm.com/download/win e rode este arquivo de novo.
echo.

:fim
echo.
pause
