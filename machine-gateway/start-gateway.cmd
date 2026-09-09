@echo off
cd /d "%~dp0"
if not exist config.json (
  copy /Y config.example.json config.json >nul
  echo Created config.json. Edit it with your IDMS URL, gateway key and CNC addresses.
  pause
  exit /b 1
)
node gateway.mjs
pause
