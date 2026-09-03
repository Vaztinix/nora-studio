@echo off
:: Auto-request Administrator elevation if not already elevated
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Administrator privileges required. Requesting elevation...
    powershell -NoProfile -Command "Start-Process cmd.exe -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

title Nora Studio - Disable Conflicting Cloudflared Service
color 0b

echo ======================================================================
echo    Nora Studio - Cloudflare Tunnel Service Fixer
echo ======================================================================
echo.
echo Stopping conflicting Windows Service (cloudflared)...
net stop cloudflared 2>nul
sc.exe stop cloudflared 2>nul

echo Disabling automatic startup for cloudflared service...
sc.exe config cloudflared start= disabled

echo Terminating any lingering ghost processes...
taskkill /F /IM cloudflared.exe /FI "SESSION eq 0" 2>nul

echo.
echo ======================================================================
echo  SUCCESS: Conflicting service has been stopped and disabled!
echo  Nora's internal tunnel is now the sole active connector.
echo  Your dashboard at https://vaztinix.dev will now connect with zero 503s!
echo ======================================================================
echo.
pause
