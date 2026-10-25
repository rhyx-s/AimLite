# AimLite preflight: read-only report of build prerequisites. Installs nothing, edits nothing.
# Usage: powershell -NoProfile -File scripts\preflight.ps1   (exit 0 = all found, 1 = something missing)
$ErrorActionPreference = 'SilentlyContinue'
$missing = @()
function Report($name, $ok, $detail) {
  $mark = if ($ok) { 'OK     ' } else { 'MISSING' }
  Write-Output ("[{0}] {1,-22} {2}" -f $mark, $name, $detail)
  if (-not $ok) { $script:missing += $name }
}
function Ver($exe, $arg) { try { (& $exe $arg 2>$null | Select-Object -First 1) } catch { $null } }

$node = Get-Command node.exe; Report 'Node.js' ([bool]$node) $(if ($node) { Ver 'node.exe' '--version' } else { 'not on PATH' })
$npm = Get-Command npm.cmd; Report 'npm' ([bool]$npm) $(if ($npm) { Ver 'npm.cmd' '--version' } else { 'not on PATH' })

$cargoPaths = @("$env:USERPROFILE\.cargo\bin\cargo.exe", (Get-Command cargo.exe).Source) | Where-Object { $_ -and (Test-Path $_) }
$cargo = $cargoPaths | Select-Object -First 1
Report 'Rust / Cargo' ([bool]$cargo) $(if ($cargo) { Ver $cargo '--version' } else { 'cargo not found (PATH, %USERPROFILE%\.cargo\bin)' })
$rustup = @("$env:USERPROFILE\.cargo\bin\rustup.exe", (Get-Command rustup.exe).Source) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($rustup) {
  $targets = & $rustup target list --installed 2>$null
  Report 'MSVC Rust target' ($targets -contains 'x86_64-pc-windows-msvc') ($targets -join ', ')
} else { Report 'MSVC Rust target' $false 'rustup not found' }

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
  $vs = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -latest -property installationPath
  $vsVer = & $vswhere -products * -latest -property catalog_productDisplayVersion
  Report 'MSVC C++ tools' ([bool]$vs) $(if ($vs) { "$vs ($vsVer)" } else { 'VC.Tools.x86.x64 component not found' })
  if ($vs) {
    $msvc = Get-ChildItem "$vs\VC\Tools\MSVC" -Directory | Sort-Object Name -Descending | Select-Object -First 1
    Report 'cl.exe / link.exe' ((Test-Path "$($msvc.FullName)\bin\Hostx64\x64\cl.exe") -and (Test-Path "$($msvc.FullName)\bin\Hostx64\x64\link.exe")) "MSVC $($msvc.Name)"
  }
} else { Report 'MSVC C++ tools' $false 'vswhere.exe not found' }

$sdkRoot = (Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Microsoft SDKs\Windows\v10.0').InstallationFolder
$sdkVers = if ($sdkRoot) { Get-ChildItem "$sdkRoot\Lib" -Directory | Where-Object { Test-Path "$($_.FullName)\um\x64\kernel32.lib" } | ForEach-Object Name } else { @() }
Report 'Windows SDK' ([bool]$sdkVers) $(if ($sdkVers) { ($sdkVers -join ', ') } else { 'no SDK with um\x64\kernel32.lib' })

$wv = @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
        'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}') |
      ForEach-Object { (Get-ItemProperty $_).pv } | Where-Object { $_ -and $_ -ne '0.0.0.0' } | Select-Object -First 1
Report 'WebView2 runtime' ([bool]$wv) $(if ($wv) { $wv } else { 'not registered' })

$winget = Get-Command winget.exe
Write-Output ("[INFO   ] winget (optional)      " + $(if ($winget) { Ver 'winget.exe' '--version' } else { 'absent; manual tool installation remains available' }))
Write-Output ''
if ($missing.Count) { Write-Output ("Missing: " + ($missing -join ', ')); exit 1 } else { Write-Output 'All prerequisites found.'; exit 0 }
