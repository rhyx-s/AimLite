# AimLite release orchestrator (Windows x64). Builds and verifies every deliverable into
# release\<version>\. It never installs tools: run scripts\preflight.ps1 first.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release.ps1 [-SkipOffline] [-SkipSmoke] [-SkipCi]
#
# Exit codes: 0 ok / 2 prerequisites missing / 3 version mismatch / 4 dependency install failed
#             5 verification failed / 6 build failed / 7 portable smoke test failed / 8 hash check failed
param(
  [switch]$SkipOffline,   # skip the offline-installer variant (needs a ~180 MB WebView2 download)
  [switch]$SkipSmoke,     # skip launching the extracted portable build
  [switch]$SkipCi         # reuse node_modules instead of `npm ci`
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
$target = 'x86_64-pc-windows-msvc'
function Step([string]$t) { Write-Output ''; Write-Output "==> $t" }
function Fail([int]$code, [string]$msg) { Write-Output "FAILED ($code): $msg"; exit $code }
function Run([string]$exe, [string[]]$argv, [int]$code, [string]$what) {
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { Fail $code "$what (exit $LASTEXITCODE)" }
}

Step 'Prerequisites'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'preflight.ps1')
if ($LASTEXITCODE -ne 0) { Fail 2 'missing prerequisites (see preflight output); nothing was installed' }

Step 'Version consistency'
$pkgVer = (Get-Content package.json -Raw | ConvertFrom-Json).version
$tauriVer = (Get-Content src-tauri\tauri.conf.json -Raw | ConvertFrom-Json).version
$cargoVer = ((Get-Content src-tauri\Cargo.toml) | Where-Object { $_ -match '^version\s*=\s*"(.+)"' } | Select-Object -First 1) -replace '^version\s*=\s*"(.+)"', '$1'
Write-Output "package.json $pkgVer / tauri.conf.json $tauriVer / Cargo.toml $cargoVer"
if ($pkgVer -ne $tauriVer -or $pkgVer -ne $cargoVer) { Fail 3 'versions differ' }
$ver = $pkgVer
if ($ver -notmatch '^\d+\.\d+\.\d+$') { Fail 3 'version must be numeric semver' }
$out = Join-Path $root "release\$ver"
if (Test-Path $out) { Fail 6 'release output already exists; preserve it and choose a new version or archive it explicitly' }
New-Item -ItemType Directory -Force $out | Out-Null
function Remove-OwnedStage([string]$path) {
  $resolved = [IO.Path]::GetFullPath($path)
  $boundary = [IO.Path]::GetFullPath((Join-Path $root 'release')) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($boundary, [StringComparison]::OrdinalIgnoreCase)) { throw 'staging path outside release directory' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

if (-not $SkipCi) {
  Step 'npm ci (locked, project-local)'
  Run 'npm.cmd' @('ci', '--no-fund', '--no-audit') 4 'npm ci'
}

Step 'Verify: types, lint, tests, Rust fmt/clippy/tests, production frontend build'
Run 'npm.cmd' @('run', 'verify') 5 'npm run verify'

$targetRoot = if ($env:CARGO_TARGET_DIR) { [IO.Path]::GetFullPath($env:CARGO_TARGET_DIR) } else { Join-Path $root 'src-tauri\target' }
$bundleDir = Join-Path $targetRoot "$target\release\bundle\nsis"
$exePath = Join-Path $targetRoot "$target\release\aimlite.exe"
$setupName = "AimLite_${ver}_x64-setup.exe"

Step 'Build: release executable + NSIS installer (Evergreen bootstrapper)'
Run 'npm.cmd' @('run', 'tauri', '--', 'build', '--target', $target, '--bundles', 'nsis') 6 'tauri build'
Copy-Item (Join-Path $bundleDir $setupName) (Join-Path $out $setupName)

Step 'Portable zip'
$stage = Join-Path $root ('release\stage-' + [guid]::NewGuid().ToString('N'))
$pdir = Join-Path $stage "AimLite-$ver"
New-Item -ItemType Directory -Force $pdir | Out-Null
Copy-Item $exePath (Join-Path $pdir 'AimLite.exe')
Copy-Item (Join-Path $root 'release-assets\README-FIRST.txt') $pdir
Copy-Item (Join-Path $root 'docs\THIRD-PARTY-LICENSES.md') $pdir
Copy-Item (Join-Path $root 'USER-GUIDE.md') $pdir
Copy-Item (Join-Path $root 'LICENSE') $pdir
Copy-Item (Join-Path $root 'THIRD-PARTY-NOTICES.md') $pdir
Copy-Item (Join-Path $root 'third-party') $pdir -Recurse
$zipName = "AimLite_${ver}_x64-portable.zip"
Compress-Archive -Path $pdir -DestinationPath (Join-Path $out $zipName) -CompressionLevel Optimal
Remove-OwnedStage $stage

if (-not $SkipOffline) {
  Step 'Build: offline installer variant (embeds the WebView2 standalone installer)'
  Run 'npm.cmd' @('run', 'tauri', '--', 'build', '--target', $target, '--bundles', 'nsis', '--config', 'src-tauri/tauri.offline.conf.json') 6 'tauri build (offline)'
  Copy-Item (Join-Path $bundleDir $setupName) (Join-Path $out "AimLite_${ver}_x64-offline-setup.exe")
  # restore the normal build so target\ matches the normal installer again
  Run 'npm.cmd' @('run', 'tauri', '--', 'build', '--target', $target, '--bundles', 'nsis') 6 'tauri build (restore normal)'
}

if (-not $SkipSmoke) {
  Step 'Portable smoke test from an extracted folder outside the source tree'
  $ext = Join-Path $root ('release\smoke-' + [guid]::NewGuid().ToString('N'))
  Expand-Archive (Join-Path $out $zipName) $ext
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'smoke-native.ps1') -Exe (Join-Path $ext "AimLite-$ver\AimLite.exe") -Label "portable-$ver"
  $smoke = $LASTEXITCODE
  Remove-OwnedStage $ext
  if ($smoke -ne 0) { Fail 7 'portable smoke test' }
}

Step 'Checksums and manifest'
$files = Get-ChildItem $out -File | Where-Object { $_.Name -ne 'SHA256SUMS.txt' -and $_.Name -ne 'manifest.json' } | Sort-Object Name
$sums = foreach ($f in $files) { '{0}  {1}' -f (Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLower(), $f.Name }
$sums | Out-File -Encoding ascii (Join-Path $out 'SHA256SUMS.txt')
$tool = { param($e, $a) try { (& $e $a 2>$null | Select-Object -First 1) } catch { $null } }
$wv = (Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -ErrorAction SilentlyContinue).pv
$manifest = [ordered]@{
  product = 'AimLite'
  version = $ver
  identifier = 'local.devideus.aimlite'
  architecture = 'x64'
  target = $target
  builtAt = (Get-Date).ToString('o')
  signature = 'unsigned (local test build; Windows SmartScreen may warn)'
  runtime = 'Microsoft Edge WebView2 Runtime (Evergreen). Normal installer: downloads it only if missing (bootstrapper). Offline installer: embeds the standalone installer. Portable zip: requires it to be installed already (Windows 11 includes it).'
  artifacts = @(foreach ($f in $files) { [ordered]@{ file = $f.Name; bytes = $f.Length; sha256 = (Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLower() } })
  tools = [ordered]@{
    node = (& $tool 'node' '--version'); npm = (& $tool 'npm.cmd' '--version'); rustc = (& $tool 'rustc' '--version'); cargo = (& $tool 'cargo' '--version')
    tauriCli = (Get-Content node_modules\@tauri-apps\cli\package.json -Raw | ConvertFrom-Json).version
    webview2OnBuildMachine = $wv
  }
  offlineInstaller = if ($SkipOffline) { 'not built in this run (-SkipOffline)' } else { 'built' }
  knownLimitations = @(
    'Unsigned: SmartScreen may show an "unknown publisher" warning.',
    'Tested on the build machine only (Windows 11, 2 x 1080p @ 100 %, 238 Hz primary); no clean-machine or VM test.',
    'Portable build stores data in %APPDATA%\local.devideus.aimlite like the installed app (set AIMLITE_DATA_DIR for another folder).',
    'Scores follow recovered aim400kg rules but are not equivalent to website scores.',
    'No auto-update; install new versions manually (data is kept).'
  )
}
$manifest | ConvertTo-Json -Depth 5 | Out-File -Encoding utf8 (Join-Path $out 'manifest.json')

Step 'Verify checksums'
foreach ($line in Get-Content (Join-Path $out 'SHA256SUMS.txt')) {
  $hash, $name = $line -split '\s+', 2
  $actual = (Get-FileHash (Join-Path $out $name) -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $hash) { Fail 8 "hash mismatch for $name" }
  Write-Output "ok  $name"
}
Write-Output ''
Write-Output "Release $ver ready in $out"
Get-ChildItem $out | Select-Object Name, @{ n = 'MB'; e = { [math]::Round($_.Length / 1MB, 2) } } | Format-Table -AutoSize
exit 0
