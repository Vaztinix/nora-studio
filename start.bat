@echo off
title Nora Bot Engine
:loop
echo Starting Nora...
node src/index.js
echo.
echo Nora closed or crashed. Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto loop
