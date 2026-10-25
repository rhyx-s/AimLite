# AimLite

A small, offline desktop trainer for mouse precision on **Windows 11 x64**.

Practise precision, flicks, reaction, target switching and tracking across 27 modes. Review local progress, build custom drills and organise practice routines. Built with Tauri, TypeScript, Canvas and SQLite. No account, subscription, advertising or cloud storage.

## Download and run

Windows downloads belong in this repository's **Releases** tab, separate from source code. This public repository is currently being prepared; no release has been published by this preparation session.

| Package | Purpose |
|---|---|
| `AimLite_0.1.1_x64-setup.exe` | Normal per-user installer and Start menu shortcut. Downloads WebView2 if missing. |
| `AimLite_0.1.1_x64-portable.zip` | Extract, then run `AimLite.exe`. Requires an installed WebView2 runtime. |
| `AimLite_0.1.1_x64-offline-setup.exe` | Larger installer with the WebView2 runtime installer included. |

Verify downloads against the release's `SHA256SUMS.txt` with `Get-FileHash -Algorithm SHA256`. These preview builds are unsigned; Windows may warn. Check the download origin and source before running them. Do not disable Windows security.

Choose a mode, click the training field, then review results or retry. [Full user guide](USER-GUIDE.md).

## Features

- 27 precision, flick, reaction, speed-clear, tracking and mixed drills.
- Results with accuracy, centre precision, timing, path efficiency, replay and charts.
- Personal bests/history grouped by comparable setups; CSV export.
- Routines, favourites and a validated custom-mode builder with JSON import/export.
- Adaptive practice kept separate from fixed benchmarks.
- Synthesised audio, configurable targets, high contrast, reduced motion and keyboard controls.
- Local SQLite storage, backups, retention controls and read-only setup diagnostics.

AimLite is inspired by aim400kg's mechanics with an independently written engine and original presentation. It is not affiliated with aim400kg or Roblox. Scores are not website-equivalent; improved Roblox performance has not been established.

## Build from source

Install Node.js 24, the Rust MSVC toolchain, Microsoft C++ Build Tools, a Windows SDK and WebView2. From the repository root:

```powershell
npm.cmd ci
npm.cmd run verify
npm.cmd run tauri -- build --target x86_64-pc-windows-msvc --bundles nsis
```

Executable: `src-tauri\target\x86_64-pc-windows-msvc\release\aimlite.exe`.
Development: `npm.cmd run tauri -- dev`.
[Build instructions](BUILD.md) ? [Contributing](CONTRIBUTING.md) ? [Architecture](docs/ARCHITECTURE.md) ? [Engine](docs/ENGINE.md) ? [Fidelity](docs/FIDELITY-MATRIX.md).

## Data and support

Data is stored at `%APPDATA%\local.devideus.aimlite`. Portable binaries use that same location by default. `AIMLITE_DATA_DIR` may select another absolute folder. Normal uninstall preserves personal data.

[Release status](docs/RELEASE-STATUS.md) distinguishes repeated checks from historical implementation-owner reports. [Security policy](SECURITY.md) describes safe reporting and known limitations.

## Licence

AimLite original code and assets are available under the [MIT licence](LICENSE). Third-party packages retain their own licences; see [dependency inventory](docs/THIRD-PARTY-LICENSES.md) and [notices](THIRD-PARTY-NOTICES.md). WebView2 is a Microsoft component under its own terms.
