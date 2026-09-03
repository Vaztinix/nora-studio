@echo off
:: This script stops and disables the conflicting cloudflared Windows Service.
:: Right-click this file and choose "Run as administrator".

echo ========================================================
echo   Fixing Cloudflare Tunnel Conflict for Nora Studio
echo ========================================================
echo.

echo [1/2] Stopping cloudflared Windows service...
net stop cloudflared 2>nul
sc.exe stop cloudflared 2>nul

echo [2/2] Disabling automatic startup for cloudflared service...
sc.exe config cloudflared start= disabled

echo.
echo ========================================================
echo   Done! The conflicting service has been disabled.
echo   Nora's internal tunnel will now be the sole connector
echo   and api.vaztinix.dev will resolve cleanly without 503s.
echo ========================================================
echo.
pause
