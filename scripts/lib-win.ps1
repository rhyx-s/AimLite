# Shared helpers for AimLite's Windows smoke/measurement scripts (dot-source this file).
# Read-only towards the system: they launch AimLite, read its UI through UI Automation, take
# screenshots of its own window and read process statistics. They change no system settings.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AimWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@

# per-monitor DPI aware, so UI Automation rectangles and cursor positions use the same physical pixels
[void][AimWin]::SetProcessDpiAwarenessContext([IntPtr](-4))

$script:UIA = [System.Windows.Automation.AutomationElement]

# Chromium (WebView2) builds its accessibility tree only after a UI Automation client asks, and
# the asking process keeps a stale view of that window. So a short-lived child process makes the
# first query; this process queries afterwards (verified on 2026-10-24 with WebView2 141).
function Wake-Accessibility([IntPtr]$hwnd, [int]$timeoutMs = 20000) {
  $docCond = New-Object System.Windows.Automation.PropertyCondition($script:UIA::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.ElapsedMilliseconds -lt $timeoutMs) {
    # each child is a fresh UIA client; it reports 1 once the web document is visible
    $seen = & powershell.exe -NoProfile -Command {
      param($h)
      Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
      $r = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$h)
      [void]$r.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      $c = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
      if ($r.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c)) { '1' } else { '0' }
    } -args ([int64]$hwnd)
    if ("$seen".Trim() -eq '1') {
      $root = $script:UIA::FromHandle($hwnd)
      if ($root.FindFirst($script:TS::Descendants, $docCond)) { return $root }
    }
    Start-Sleep -Milliseconds 700
  }
  throw "Timed out after $timeoutMs ms waiting for the web content accessibility tree"
}

function Get-Rect($el) { $el.Current.BoundingRectangle }

function Click-At([int]$x, [int]$y) {
  [void][AimWin]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 60
  [AimWin]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero) # left down
  Start-Sleep -Milliseconds 40
  [AimWin]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) # left up
}

function Set-Toggle($el, [bool]$on) {
  $p = $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
  $isOn = $p.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On
  if ($isOn -ne $on) { $p.Toggle() }
}

function Get-ToggleOn($el) {
  $p = $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
  $p.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On
}
$script:TS = [System.Windows.Automation.TreeScope]

function Wait-Until([scriptblock]$cond, [int]$timeoutMs = 15000, [string]$what = 'condition') {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.ElapsedMilliseconds -lt $timeoutMs) {
    $r = & $cond
    if ($r) { return $r }
    Start-Sleep -Milliseconds 100
  }
  throw "Timed out after $timeoutMs ms waiting for $what"
}

function Get-AppWindow([int]$procId) {
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if (-not $p) { return $null }
  $p.Refresh()
  # the main window starts hidden; only accept the visible window titled AimLite
  if ($p.MainWindowHandle -eq [IntPtr]::Zero -or $p.MainWindowTitle -ne 'AimLite' -or -not [AimWin]::IsWindowVisible($p.MainWindowHandle)) { return $null }
  return $p.MainWindowHandle
}

function Get-Root([IntPtr]$hwnd) { $script:UIA::FromHandle($hwnd) }

function Find-ByName($root, [string]$name, [string]$type = $null) {
  $cond = New-Object System.Windows.Automation.PropertyCondition($script:UIA::NameProperty, $name)
  $all = $root.FindAll($script:TS::Descendants, $cond)
  foreach ($e in $all) {
    if (-not $type -or $e.Current.ControlType.ProgrammaticName -eq "ControlType.$type") { return $e }
  }
  return $null
}

function Find-NameLike($root, [string]$pattern, [string]$type = $null) {
  $all = $root.FindAll($script:TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($e in $all) {
    try {
      if ($e.Current.Name -like $pattern -and (-not $type -or $e.Current.ControlType.ProgrammaticName -eq "ControlType.$type")) { return $e }
    } catch {}
  }
  return $null
}

function Invoke-El($el) {
  $o = $null
  if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$o)) { $o.Invoke(); return }
  if ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$o)) { $o.Select(); return }
  if ($el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$o)) { $o.Toggle(); return }
  if ($el.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$o)) {
    if ($o.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed) { $o.Expand() } else { $o.Collapse() }
    return
  }
  throw "Element '$($el.Current.Name)' supports no invoke/select/toggle pattern"
}

function Get-AllText($root) {
  $all = $root.FindAll($script:TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $names = foreach ($e in $all) { try { $e.Current.Name } catch {} }
  ($names | Where-Object { $_ }) -join "`n"
}

function Save-WindowShot([IntPtr]$hwnd, [string]$path) {
  $r = New-Object AimWin+RECT
  [void][AimWin]::GetWindowRect($hwnd, [ref]$r)
  $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
  if ($w -le 0 -or $h -le 0) { return }
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

function Send-Keys([IntPtr]$hwnd, [string]$keys) {
  [void][AimWin]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds 150
  [System.Windows.Forms.SendKeys]::SendWait($keys)
}

function Close-AppWindow([IntPtr]$hwnd) {
  # WM_CLOSE: the same as clicking the window's close button
  [void][AimWin]::PostMessage($hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
}

# Total working set / private bytes of a process and all its descendants (WebView2 children included).
function Get-TreeMemory([int]$rootId) {
  $all = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, WorkingSetSize, PrivatePageCount
  $ids = New-Object System.Collections.Generic.HashSet[int]
  [void]$ids.Add($rootId)
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $changed = $true } }
  }
  $tree = $all | Where-Object { $ids.Contains([int]$_.ProcessId) }
  [pscustomobject]@{
    Processes = $tree.Count
    WorkingSetMB = [math]::Round((($tree | Measure-Object WorkingSetSize -Sum).Sum) / 1MB, 1)
    PrivateMB = [math]::Round((($tree | Measure-Object PrivatePageCount -Sum).Sum) / 1MB, 1)
    Names = (($tree | Group-Object Name | ForEach-Object { "$($_.Name)x$($_.Count)" }) -join ', ')
    Ids = @($ids)
  }
}

function Get-TreeCpuSeconds([int[]]$ids) {
  $t = 0.0
  foreach ($id in $ids) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p) { $t += $p.TotalProcessorTime.TotalSeconds } }
  return $t
}
