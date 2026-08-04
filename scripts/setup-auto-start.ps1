# PowerShell script to register Nora Bot in Windows Task Scheduler for automatic startup on PC boot
$TaskName = "NoraBotAutoStart"
$WorkingDir = (Resolve-Path "$PSScriptRoot\..").Path
$BatPath = "$WorkingDir\scripts\start-nora.bat"

Write-Host "Setting up Nora Bot auto-start task in Windows Task Scheduler..." -ForegroundColor Cyan

# Remove existing task if present
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$Action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$BatPath`"" -WorkingDirectory $WorkingDir
$TriggerBoot = New-ScheduledTaskTrigger -AtStartup
$TriggerLogon = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0

try {
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger @($TriggerBoot, $TriggerLogon) -Settings $Settings -RunLevel Highest -Description "Auto-starts Nora Bot on PC boot/login" -ErrorAction Stop
} catch {
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $TriggerLogon -Settings $Settings -Description "Auto-starts Nora Bot on PC boot/login"
}

Write-Host "✅ Nora Bot Windows Auto-Start Task successfully created!" -ForegroundColor Green
Write-Host "Nora will now start automatically whenever your PC turns on." -ForegroundColor Yellow
