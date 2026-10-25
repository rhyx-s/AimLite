# AimLite native smoke test + measurements, run against a built executable (release folder,
# extracted portable zip or installed copy). Uses an isolated data folder, never your real data.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\smoke-native.ps1 -Exe <path\aimlite.exe> [-Label name]
#
# It drives the real app through Windows UI Automation and keyboard input. It also moves the mouse
# once to click inside the AimLite training field (the cursor position is restored afterwards).
# Keep the AimLite window in front while it runs (~2 minutes). Exit code 0 = every check passed.
param(
  [string]$Exe = (Join-Path $PSScriptRoot '..\src-tauri\target\x86_64-pc-windows-msvc\release\aimlite.exe'),
  [string]$Label = 'release',
  [switch]$KeepData
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib-win.ps1')

$Exe = (Resolve-Path $Exe).Path
$evidence = Join-Path $PSScriptRoot '..\docs\evidence'
New-Item -ItemType Directory -Force $evidence | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$data = Join-Path $env:TEMP ('aimlite-smoke-' + [guid]::NewGuid().ToString('N'))
$env:AIMLITE_DATA_DIR = $data
$report = [ordered]@{ label = $Label; exe = $Exe; exeBytes = (Get-Item $Exe).Length; startedAt = (Get-Date).ToString('o'); dataDir = $data; checks = [ordered]@{}; measurements = [ordered]@{}; notes = @() }
$failed = 0
function Check([string]$name, [bool]$ok, [string]$detail = '') {
  $report.checks[$name] = [ordered]@{ ok = $ok; detail = $detail }
  $mark = if ($ok) { 'PASS' } else { 'FAIL' }
  Write-Output ("[{0}] {1} {2}" -f $mark, $name, $detail)
  if (-not $ok) { $script:failed++ }
}
$savedCursor = New-Object AimWin+POINT
[void][AimWin]::GetCursorPos([ref]$savedCursor)

function Launch([string]$what) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process -FilePath $Exe -PassThru
  $hwnd = Wait-Until { Get-AppWindow $p.Id } 30000 "$what window"
  $root = Wake-Accessibility $hwnd 30000
  [void](Wait-Until { Find-ByName $root 'Training modes' } 30000 "$what modes screen")
  $ms = $sw.ElapsedMilliseconds
  [void][AimWin]::SetForegroundWindow($hwnd)
  return @{ p = $p; hwnd = $hwnd; root = $root; ms = $ms }
}
function Nav($root, [string]$name) { Invoke-El (Wait-Until { Find-ByName $root $name 'Button' } 10000 "nav $name"); Start-Sleep -Milliseconds 400 }
function TextOf($root) { Get-AllText $root }

try {
  # ---------------------------------------------------------------- first launch (cold, new data)
  $a = Launch 'first launch'
  $report.measurements.coldStartToModesMs = $a.ms
  Check 'launch: window and Modes screen' $true "$($a.ms) ms to Modes (first launch, new data folder)"
  Check 'launch: 27 official modes listed' (([regex]::Matches((TextOf $a.root), 'Play [^\n]+\.')).Count -ge 27) ''
  Save-WindowShot $a.hwnd (Join-Path $evidence "$Label-01-modes.png")
  Start-Sleep -Seconds 3
  $idle = Get-TreeMemory $a.p.Id
  $report.measurements.idleMemory = $idle
  $c0 = Get-TreeCpuSeconds $idle.Ids; Start-Sleep -Seconds 10; $c1 = Get-TreeCpuSeconds $idle.Ids
  $report.measurements.idleCpuPercentOfOneCore = [math]::Round(($c1 - $c0) / 10 * 100, 2)

  # ---------------------------------------------------------------- settings persist (mute)
  Nav $a.root 'Settings'
  Invoke-El (Wait-Until { Find-ByName $a.root 'Audio' } 10000 'Audio tab')
  $mute = Wait-Until { Find-ByName $a.root 'Mute' 'CheckBox' } 10000 'Mute checkbox'
  Set-Toggle $mute $true
  Start-Sleep -Milliseconds 800

  # ---------------------------------------------------------------- display frames probe
  Invoke-El (Wait-Until { Find-ByName $a.root 'Diagnostics' } 10000 'Diagnostics tab')
  [void][AimWin]::SetForegroundWindow($a.hwnd)
  Invoke-El (Wait-Until { Find-ByName $a.root 'Measure display frames (3 s)' 'Button' } 10000 'frames button')
  $fr = Wait-Until { $e = Find-NameLike $a.root '*frames*median*'; if ($e) { $e.Current.Name } } 15000 'frame result'
  $report.measurements.displayFrames = $fr
  $diag = TextOf $a.root
  $report.measurements.diagnosticsText = ($diag -split "`n" | Where-Object { $_ -match 'WebView2|Windows 1|Pointer speed|Enhance pointer|DPI|Monitors|Input stream' }) -join ' | '
  Save-WindowShot $a.hwnd (Join-Path $evidence "$Label-02-diagnostics.png")

  # ---------------------------------------------------------------- a real completed run
  Nav $a.root 'Modes'
  Invoke-El (Wait-Until { Find-NameLike $a.root 'Play Pinpoint Sudden Death*' 'Button' } 10000 'Sudden Death card')
  $field = Wait-Until { Find-NameLike $a.root '*training field*' } 10000 'training field'
  $field.SetFocus()
  Send-Keys $a.hwnd '{ENTER}'
  Start-Sleep -Milliseconds 3600   # 3 s countdown, then play
  $play = Get-TreeMemory $a.p.Id
  $report.measurements.playingMemory = $play
  $conns = @(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $play.Ids -contains $_.OwningProcess })
  $udp = @(Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $play.Ids -contains $_.OwningProcess })
  $report.measurements.networkWhilePlaying = @{ tcp = @($conns | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)->$($_.RemoteAddress):$($_.RemotePort) $($_.State)" }); udp = @($udp | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" }) }
  Save-WindowShot $a.hwnd (Join-Path $evidence "$Label-03-playing.png")
  # a click in the field's corner: targets keep their whole radius inside, so this is always a miss
  $r = Get-Rect $field
  [void][AimWin]::SetForegroundWindow($a.hwnd)
  Click-At ([int]$r.Left + 4) ([int]$r.Top + 4)
  $res = Wait-Until { Find-NameLike $a.root 'Pinpoint Sudden Death*results' } 15000 'results screen'
  $saved = Wait-Until { Find-NameLike $a.root 'Saved to your history*' } 15000 'saved status'
  Check 'run: completed and saved natively' ($null -ne $saved) $saved.Current.Name
  Save-WindowShot $a.hwnd (Join-Path $evidence "$Label-04-results.png")

  # ---------------------------------------------------------------- a cancelled run (> 3 s of play)
  Nav $a.root 'Modes'
  Invoke-El (Wait-Until { Find-NameLike $a.root 'Play Pinpoint Pulse*' 'Button' } 10000 'Pinpoint Pulse card')
  $field = Wait-Until { Find-NameLike $a.root '*training field*' } 10000 'training field'
  $field.SetFocus()
  Send-Keys $a.hwnd '{ENTER}'
  Start-Sleep -Milliseconds 7500
  Send-Keys $a.hwnd '{ESC}'
  Start-Sleep -Milliseconds 800

  # ---------------------------------------------------------------- history + CSV export via native dialog
  Nav $a.root 'Progress'
  $hist = Wait-Until { Find-NameLike $a.root 'History (*' } 10000 'history heading'
  Save-WindowShot $a.hwnd (Join-Path $evidence "$Label-05-history.png")
  Check 'history: completed + cancelled runs listed' ($hist.Current.Name -eq 'History (2 runs)') $hist.Current.Name
  Invoke-El (Find-ByName $a.root 'Export CSV' 'Button')
  $csvPath = Join-Path $data "smoke-export.csv"
  # the Windows Save dialog belongs to the AimLite process; its file-name box has focus
  $dlgCond = New-Object System.Windows.Automation.AndCondition((New-Object System.Windows.Automation.PropertyCondition($script:UIA::ProcessIdProperty, $a.p.Id)), (New-Object System.Windows.Automation.PropertyCondition($script:UIA::ClassNameProperty, '#32770')))
  $dlg = Wait-Until { $script:UIA::RootElement.FindFirst($script:TS::Children, $dlgCond) } 15000 'save dialog'
  Start-Sleep -Milliseconds 800
  $dh = [IntPtr]$dlg.Current.NativeWindowHandle
  [void][AimWin]::SetForegroundWindow($dh); Start-Sleep -Milliseconds 300
  [System.Windows.Forms.SendKeys]::SendWait('%n'); Start-Sleep -Milliseconds 200
  [System.Windows.Forms.SendKeys]::SendWait('^a'); Start-Sleep -Milliseconds 100
  [System.Windows.Forms.SendKeys]::SendWait($csvPath); Start-Sleep -Milliseconds 200
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  [void](Wait-Until { Test-Path $csvPath } 10000 'CSV file')
  Start-Sleep -Milliseconds 300
  $csv = Get-Content $csvPath -Encoding UTF8
  Check 'export: CSV written through the native dialog' ($csv.Count -eq 3 -and $csv[0] -like '*run_id*') "$($csv.Count - 1) data rows"

  # ---------------------------------------------------------------- close, reopen, recover
  Close-AppWindow $a.hwnd
  [void](Wait-Until { -not (Get-Process -Id $a.p.Id -ErrorAction SilentlyContinue) } 10000 'app exit')
  Check 'close: process exits on window close (no background process)' $true ''
  $walLeft = (Get-Item (Join-Path $data 'aimlite.sqlite-wal') -ErrorAction SilentlyContinue).Length
  $report.measurements.walBytesAfterExit = $walLeft
  $b = Launch 'second launch'
  $report.measurements.warmStartToModesMs = $b.ms
  Nav $b.root 'Progress'
  $hist2 = Wait-Until { Find-NameLike $b.root 'History (2 runs)' } 10000 'history after restart'
  Check 'reopen: history recovered from SQLite' ($null -ne $hist2) ''
  Nav $b.root 'Settings'
  Invoke-El (Wait-Until { Find-ByName $b.root 'Audio' } 10000 'Audio tab')
  $mute2 = Wait-Until { Find-ByName $b.root 'Mute' 'CheckBox' } 10000 'Mute checkbox'
  Check 'reopen: settings persisted (mute)' (Get-ToggleOn $mute2) ''
  Set-Toggle $mute2 $false
  Start-Sleep -Milliseconds 600

  # ---------------------------------------------------------------- 100 restarts: memory stability
  Nav $b.root 'Modes'
  Invoke-El (Wait-Until { Find-NameLike $b.root 'Play Pinpoint Pulse*' 'Button' } 10000 'Pinpoint Pulse card')
  $field = Wait-Until { Find-NameLike $b.root '*training field*' } 10000 'training field'
  $field.SetFocus()
  Start-Sleep -Seconds 2
  $m0 = Get-TreeMemory $b.p.Id
  [void][AimWin]::SetForegroundWindow($b.hwnd)
  Start-Sleep -Milliseconds 200
  for ($i = 0; $i -lt 100; $i++) { [System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); Start-Sleep -Milliseconds 30; [System.Windows.Forms.SendKeys]::SendWait('r'); Start-Sleep -Milliseconds 30 }
  Start-Sleep -Seconds 3
  $m1 = Get-TreeMemory $b.p.Id
  $report.measurements.restart100 = @{ beforePrivateMB = $m0.PrivateMB; afterPrivateMB = $m1.PrivateMB; deltaMB = [math]::Round($m1.PrivateMB - $m0.PrivateMB, 1); beforeWorkingSetMB = $m0.WorkingSetMB; afterWorkingSetMB = $m1.WorkingSetMB }
  Check 'stability: 100 restarts' (($m1.PrivateMB - $m0.PrivateMB) -lt 40) "private memory $($m0.PrivateMB) -> $($m1.PrivateMB) MB"

  # ---------------------------------------------------------------- single instance
  $second = Start-Process -FilePath $Exe -PassThru
  Start-Sleep -Seconds 4
  $count = @(Get-Process aimlite -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Exe }).Count
  Check 'single instance: a second launch exits and focuses the first' ($count -eq 1 -and $second.HasExited) "aimlite processes: $count"

  Close-AppWindow $b.hwnd
  [void](Wait-Until { -not (Get-Process -Id $b.p.Id -ErrorAction SilentlyContinue) } 10000 'app exit')
}
catch {
  Check 'smoke script' $false $_.Exception.Message
  Get-Process aimlite -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Exe } | ForEach-Object { $_.CloseMainWindow() | Out-Null }
}
finally {
  [void][AimWin]::SetCursorPos($savedCursor.X, $savedCursor.Y)
  $report.finishedAt = (Get-Date).ToString('o')
  $report.failed = $failed
  $out = Join-Path $evidence "native-smoke-$Label-$stamp.json"
  $report | ConvertTo-Json -Depth 6 | Out-File -Encoding utf8 $out
  Write-Output "Report: $out"
  if (-not $KeepData) {
    $resolved = [IO.Path]::GetFullPath($data)
    $boundary = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($boundary, [StringComparison]::OrdinalIgnoreCase)) { throw 'smoke data path outside temp directory' }
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
  }
}
if ($failed) { exit 1 } else { exit 0 }
