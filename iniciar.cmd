@echo off
setlocal
cd /d "%~dp0"
set "NODE_EXE=node"
where node >nul 2>nul
if errorlevel 1 set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE_EXE%" if "%NODE_EXE%"=="%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
  echo Node.js nao foi encontrado. Instale Node.js 20 ou superior.
  pause
  exit /b 1
)
echo Iniciando o Assistente de Pilotagem Inteligente...
set "PORT=3003"
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3003"
"%NODE_EXE%" src\server.js
endlocal
