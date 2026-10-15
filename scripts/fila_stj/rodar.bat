@echo off
REM Roda a fila de conversao STJ (AREsp/REsp -> numero CNJ) e importa os
REM resultados no sistema.
REM   Duplo-clique: mostra o resumo e espera voce apertar uma tecla.
REM   "rodar.bat auto" (Agendador do Windows): sem pausa, grava em fila_stj.log.

set VENV=C:\Users\mathe\scrapling-env\.venv
set LOG=C:\Users\mathe\scrapling-env\fila_stj.log
set PYTHONIOENCODING=utf-8

if not exist "%VENV%\Scripts\python.exe" (
  echo Venv do Scrapling nao encontrado em %VENV%
  echo Veja scripts\fila_stj\requirements.txt para montar o ambiente.
  if /i not "%1"=="auto" pause
  exit /b 1
)

if /i "%1"=="auto" (
  echo. >> "%LOG%"
  echo ===== %date% %time% ===== >> "%LOG%"
  "%VENV%\Scripts\python.exe" "%~dp0worker.py" >> "%LOG%" 2>&1
  exit /b %errorlevel%
)

"%VENV%\Scripts\python.exe" "%~dp0worker.py"

echo.
pause
