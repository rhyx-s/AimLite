# Visual QA tour: screenshots of every screen of a built AimLite, including a short real run with
# hits (a centre-spawning custom mode made through the Builder UI). Isolated temp data folder.
# Moves the mouse inside the AimLite window while it runs; the cursor is restored afterwards.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\screenshot-tour.ps1 [-Exe path] [-Label name]
param(
  [string]$Exe = (Join-Path $PSScriptRoot '..\src-tauri\target\x86_64-pc-windows-msvc\release\aimlite.exe'),
  [string]$Label = 'tour'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib-win.ps1')
$Exe = (Resolve-Path $Exe).Path
$out = Join-Path $PSScriptRoot '..\docs\evidence\screens'
New-Item -ItemType Directory -Force $out | Out-Null
$data = Join-Path $env:TEMP ("aimlite-tour-" + (Get-Date -Format 'yyyyMMddHHmmss'))
$env:AIMLITE_DATA_DIR = $data
$saved = New-Object AimWin+POINT
[void][AimWin]::GetCursorPos([ref]$saved)
$p = Start-Process -FilePath $Exe -PassThru
try {
  $hwnd = Wait-Until { Get-AppWindow $p.Id } 30000 'window'
  $root = Wake-Accessibility $hwnd 30000
  [void][AimWin]::SetForegroundWindow($hwnd)
  function Shot([string]$name) { Start-Sleep -Milliseconds 700; Save-WindowShot $hwnd (Join-Path $out "$Label-$name.png") }
  function Nav([string]$n) { Invoke-El (Wait-Until { Find-ByName $root $n 'Button' } 10000 $n); Start-Sleep -Milliseconds 500 }

  Shot 'modes'
  Nav 'Routines'; Shot 'routines'
  Invoke-El (Wait-Until { Find-ByName $root 'Use this' 'Button' } 10000 'starter'); Shot 'routine-editor'
  Nav 'Help'; Shot 'help'
  Nav 'Settings'; Shot 'settings-look'
  Invoke-El (Find-ByName $root 'Data'); Shot 'settings-data'

  # Builder: copy Pinpoint Pulse, centre spawns, 10 s limit
  Nav 'Builder'; Shot 'builder'
  $name = Wait-Until { Find-ByName $root 'Name' 'Edit' } 10000 'name box'
  $name.SetFocus(); [System.Windows.Forms.SendKeys]::SendWait('^aTour Centre')
  $rand = Wait-Until { Find-ByName $root 'Random positions' 'CheckBox' } 10000 'random positions'
  Set-Toggle $rand $false
  Start-Sleep -Milliseconds 300
  $root = $script:UIA::FromHandle($hwnd)
  if (-not (Find-ByName $root 'Time limit (s)' 'Spinner')) { $grp = Find-ByName $root 'End conditions'; if ($grp) { Invoke-El $grp; Start-Sleep -Milliseconds 400 } }
  $timer = Wait-Until { Find-ByName $root 'Time limit (s)' 'Spinner' } 10000 'time limit'
  $timer.SetFocus(); [System.Windows.Forms.SendKeys]::SendWait('^a10{TAB}')
  Start-Sleep -Milliseconds 400
  Shot 'builder-edited'
  Invoke-El (Wait-Until { Find-ByName $root 'Save and play' 'Button' } 10000 'save and play')
  $field = Wait-Until { Find-NameLike $root '*training field*' } 10000 'field'
  $r = Get-Rect $field
  $cx = [int]$r.Left + 528; $cy = [int]$r.Top + 328
  $field.SetFocus(); Send-Keys $hwnd '{ENTER}'
  Start-Sleep -Milliseconds 3300
  [void][AimWin]::SetCursorPos($cx - 150, $cy + 80)
  for ($i = 0; $i -lt 18; $i++) {
    # approach from alternating sides so paths and offsets vary
    $ox = if ($i % 2) { -140 } else { 160 }
    for ($k = 6; $k -ge 0; $k--) { [void][AimWin]::SetCursorPos($cx + [int]($ox * $k / 6), $cy + [int](60 * $k / 6)); Start-Sleep -Milliseconds 12 }
    Click-At ($cx + ($i % 3) - 1) $cy
    Start-Sleep -Milliseconds 180
    if ($i -eq 9) { Click-At ([int]$r.Left + 6) ([int]$r.Top + 6); Shot 'tour-playing' }
  }
  Wait-Until { Find-NameLike $root 'Tour Centre*results' } 20000 'results' | Out-Null
  Start-Sleep -Seconds 1
  Shot 'results-top'
  # scroll the results down for the charts
  [void][AimWin]::SetCursorPos($cx, $cy); [System.Windows.Forms.SendKeys]::SendWait('{PGDN}')
  Shot 'results-charts'
  Nav 'Progress'
  Shot 'progress'
}
finally {
  [void][AimWin]::SetCursorPos($saved.X, $saved.Y)
  if (-not $p.HasExited) { [void]$p.CloseMainWindow(); Start-Sleep -Seconds 2 }
  Remove-Item -Recurse -Force $data -ErrorAction SilentlyContinue
}
Write-Output "Screens in $out"
