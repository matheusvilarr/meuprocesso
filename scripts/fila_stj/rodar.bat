@echo off
REM Roda a fila de conversao STJ (AREsp/REsp -> numero CNJ) e importa os
REM resultados no sistema. Duplo-clique pra rodar — mostra o resumo e espera
REM você apertar uma tecla antes de fechar.

set VENV=C:\Users\mathe\scrapling-env\.venv

if not exist "%VENV%\Scripts\python.exe" (
  echo Venv do Scrapling nao encontrado em %VENV%
  echo Veja scripts\fila_stj\requirements.txt para montar o ambiente.
  pause
  exit /b 1
)

"%VENV%\Scripts\python.exe" "%~dp0worker.py"

echo.
pause
