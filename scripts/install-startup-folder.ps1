$StartupFolder = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
$VbsPath = "$StartupFolder\NoraBotAutoStart.vbs"
$BatPath = (Resolve-Path "$PSScriptRoot\start-nora.bat").Path

$VbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """$BatPath""", 0, False
"@

Set-Content -Path $VbsPath -Value $VbsContent -Encoding String

Write-Host "✅ Created Nora Bot Auto-Start script in Windows Startup folder:" -ForegroundColor Green
Write-Host "   $VbsPath" -ForegroundColor Yellow
