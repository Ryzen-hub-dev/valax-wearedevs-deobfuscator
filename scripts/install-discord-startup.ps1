$ErrorActionPreference = 'Stop'

$taskName = 'Valax Discord Bot'
$repoRoot = Split-Path -Parent $PSScriptRoot
$supervisorPath = Join-Path $PSScriptRoot 'discord-supervisor.js'
$nodePath = (Get-Command node -ErrorAction Stop).Source
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction `
  -Execute $nodePath `
  -Argument ('"{0}"' -f $supervisorPath) `
  -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries

$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings
Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Output "Installed and started scheduled task: $taskName"
Write-Output "Supervisor: $supervisorPath"
Write-Output "Logs: $(Join-Path $repoRoot 'apps\discord-bot\data\supervisor.log')"
