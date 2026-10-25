# Per-user installer test: install -> launch (smoke) -> reinstall over it -> data kept ->
# uninstall -> data kept, files and shortcut removed. Refuses to run if AimLite is already
# installed for this user (it will not touch an existing installation).
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-test.ps1 -Installer release\0.1.0\AimLite_0.1.0_x64-setup.exe
param([Parameter(Mandatory = $true)][string]$Installer)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib-win.ps1')
$Installer = (Resolve-Path $Installer).Path
$evidence = Join-Path $PSScriptRoot '..\docs\evidence'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$report = [ordered]@{ installer = $Installer; startedAt = (Get-Date).ToString('o'); checks = [ordered]@{} }
$failed = 0
function Check([string]$n, [bool]$ok, [string]$d = '') { $report.checks[$n] = @{ ok = $ok; detail = $d }; Write-Output ("[{0}] {1} {2}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $n, $d); if (-not $ok) { $script:failed++ } }
function Uninst() { Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -eq 'AimLite' } | Select-Object -First 1 }

if (Uninst) { Write-Output 'AimLite is already installed for this user; not touching it.'; exit 3 }
$defaultData = Join-Path $env:APPDATA 'local.devideus.aimlite'
$dataExisted = Test-Path $defaultData
$shortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\AimLite.lnk'
Remove-Item Env:\AIMLITE_DATA_DIR -ErrorAction SilentlyContinue

try {
  # ---- install (silent, current user, no admin)
  $p = Start-Process $Installer -ArgumentList '/S' -PassThru -Wait
  $u = Wait-Until { Uninst } 30000 'uninstall registry entry'
  $dir = $u.InstallLocation.Trim('"')
  $exe = Join-Path $dir 'aimlite.exe'
  Check 'install: per-user, no admin' ((Test-Path $exe) -and $dir -like "$env:LOCALAPPDATA*") $dir
  Check 'install: Start menu shortcut' (Test-Path $shortcut) $shortcut
  $report.installedBytes = (Get-ChildItem $dir -Recurse -File | Measure-Object Length -Sum).Sum

  # ---- full smoke against the installed copy (isolated temp data)
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'smoke-native.ps1') -Exe $exe -Label "installed"
  Check 'installed app: native smoke test' ($LASTEXITCODE -eq 0) ''

  # ---- real default data folder: create a run marker, reinstall, uninstall, check it survives
  Remove-Item Env:\AIMLITE_DATA_DIR -ErrorAction SilentlyContinue
  $a = Start-Process $exe -PassThru
  $h = Wait-Until { Get-AppWindow $a.Id } 30000 'window'
  Start-Sleep -Seconds 3
  Close-AppWindow $h
  [void](Wait-Until { -not (Get-Process -Id $a.Id -ErrorAction SilentlyContinue) } 15000 'exit')
  Check 'default data folder created on first launch' (Test-Path (Join-Path $defaultData 'aimlite.sqlite')) $defaultData
  $before = (Get-Item (Join-Path $defaultData 'aimlite.sqlite')).Length

  Start-Process $Installer -ArgumentList '/S' -Wait
  Start-Sleep -Seconds 2
  Check 'reinstall over existing: app still present' (Test-Path $exe) ''
  Check 'reinstall over existing: data kept' (Test-Path (Join-Path $defaultData 'aimlite.sqlite')) ''

  # ---- uninstall (silent): files and shortcut go, data stays
  $un = $u.UninstallString.Trim('"')
  Start-Process $un -ArgumentList '/S' -Wait
  [void](Wait-Until { -not (Uninst) -and -not (Test-Path $exe) } 60000 'uninstall to finish')
  Check 'uninstall: program files removed' (-not (Test-Path $exe)) ''
  Check 'uninstall: Start menu shortcut removed' (-not (Test-Path $shortcut)) ''
  Check 'uninstall: user data kept' ((Test-Path (Join-Path $defaultData 'aimlite.sqlite')) -and (Get-Item (Join-Path $defaultData 'aimlite.sqlite')).Length -ge $before) $defaultData
}
catch { Check 'install test script' $false $_.Exception.Message }
finally {
  # leave the machine as found: remove the default data folder only if this test created it
  if (-not $dataExisted -and (Test-Path $defaultData)) { Remove-Item -Recurse -Force $defaultData; $report.cleanup = "removed test-created $defaultData" }
  $report.failed = $failed
  $report | ConvertTo-Json -Depth 5 | Out-File -Encoding utf8 (Join-Path $evidence "install-test-$stamp.json")
}
if ($failed) { exit 1 } else { exit 0 }
