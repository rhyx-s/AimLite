# Building AimLite

All commands run from the `aimlite` folder in PowerShell. Paths contain spaces, so keep the quotes. Use `npm.cmd` (not `npm`) if PowerShell's execution policy blocks `npm.ps1`; the scripts use `-ExecutionPolicy Bypass` for their own process only and never change the system policy.

## Prerequisites (verified on the build machine, 2026-10-24)

| Tool | Version used | Notes |
|---|---|---|
| Windows 11 x64 | 25H2, build 26200 | |
| Node.js / npm | 24.22.0 / 11.19.1 | |
| Rust (rustup, MSVC toolchain) | rustc 1.99.1, cargo 1.99.1, target `x86_64-pc-windows-msvc` | installed per-user with `winget install --id Rustlang.Rustup -e` |
| Microsoft C++ Build Tools | VS Build Tools 18 (18.11.0), MSVC 14.51.36231 | "Desktop development with C++" |
| Windows SDK | 10.0.26100.0 | |
| WebView2 Runtime | 141.0.3537.99 | Evergreen |

Check them (read-only, installs nothing):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\preflight.ps1
```

Exit code 0 means everything is present. Rust goes in `%USERPROFILE%\.cargo\bin`; open a new terminal after installing it, or prepend that folder to `PATH`.

## Dependencies

Versions are pinned in `package.json` / `package-lock.json` and `src-tauri/Cargo.lock`:

```powershell
npm.cmd ci
```

Key versions: Tauri 2.12 (CLI 2.12.4, crate 2.12.5), Vite 8.3.5, TypeScript 6.0.3, Vitest 5.0.5, ESLint 10.13, rusqlite 0.41 (bundled SQLite), tauri-plugin-dialog 2.8, tauri-plugin-single-instance 2.5.

## Checks

```powershell
npm.cmd run verify
```

runs, in order: `tsc --noEmit`, `eslint .`, `vitest run` (engine, all 27 presets, schemas, UI flows), `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --locked`, and the production frontend build (`dist/`). Individually: `npm.cmd run typecheck | lint | test | rust:fmt | rust:clippy | test:rust | build`.

## Desktop builds

```powershell
# release exe + current-user NSIS installer (WebView2 Evergreen bootstrapper)
npm.cmd run tauri -- build --target x86_64-pc-windows-msvc --bundles nsis

# offline installer variant (embeds Microsoft's WebView2 standalone installer, ~180 MB download at build time)
npm.cmd run tauri -- build --target x86_64-pc-windows-msvc --bundles nsis --config src-tauri/tauri.offline.conf.json
```

Outputs: `src-tauri\target\x86_64-pc-windows-msvc\release\aimlite.exe` and `...\release\bundle\nsis\AimLite_0.1.1_x64-setup.exe`. Both variants write the same installer file name, so copy the first before building the second (the release script does this). The production build loads the bundled `dist/` files (`frontendDist`); `devUrl` is only used by `tauri dev`.

Development window with hot reload: `npm.cmd run tauri -- dev`. Browser-only preview (no native storage, labelled in the UI): `npm.cmd run dev`.

## Full release

```powershell
npm.cmd run release
# or: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release.ps1 [-SkipOffline] [-SkipSmoke] [-SkipCi]
```

Steps: preflight Ã¢â€ â€™ version consistency (package.json, Cargo.toml, tauri.conf.json) Ã¢â€ â€™ `npm ci` Ã¢â€ â€™ `npm run verify` Ã¢â€ â€™ normal build Ã¢â€ â€™ portable zip Ã¢â€ â€™ offline build Ã¢â€ â€™ rebuild normal Ã¢â€ â€™ extract the zip to a unique staging directory under `release/` and run the native smoke test from there Ã¢â€ â€™ `SHA256SUMS.txt` + `manifest.json` Ã¢â€ â€™ re-verify hashes. Exit codes: 2 prerequisites, 3 version mismatch, 4 npm ci, 5 verification, 6 build, 7 portable smoke, 8 hashes.

Output: `release\<version>\` Ã¢â‚¬â€ `AimLite_<v>_x64-setup.exe`, `AimLite_<v>_x64-offline-setup.exe`, `AimLite_<v>_x64-portable.zip`, `SHA256SUMS.txt`, `manifest.json`.

## Native tests on a built app

```powershell
# drives the real app through UI Automation (isolated temp data); moves the mouse once inside the field
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\smoke-native.ps1 -Exe <path\to\aimlite.exe or AimLite.exe> -Label name
# installer: install -> smoke -> reinstall -> uninstall, data kept (refuses if AimLite is already installed)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-test.ps1 -Installer release\0.1.1\AimLite_0.1.1_x64-setup.exe
# screenshots of every screen
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\screenshot-tour.ps1
```

Reports and screenshots go to `docs\evidence\`.

## Generated files

- `node scripts/gen-presets.mjs <REA modes.json> [site-averages.json]` Ã¢â‚¬â€ regenerates `src/presets/official.json`, `source-map.json`, `site-averages.json` from the REA archive (dev time only).
- `node scripts/gen-fidelity.mjs` Ã¢â‚¬â€ `docs/FIDELITY-MATRIX.md`.
- `node scripts/gen-licenses.mjs` Ã¢â‚¬â€ `docs/THIRD-PARTY-LICENSES.md`.
- `node scripts/gen-icon.mjs` then `npm.cmd run tauri -- icon src-tauri/icons/app-icon.png -o src-tauri/icons` Ã¢â‚¬â€ the original icon set.

## Identifier and data folder

The app identifier is `local.devideus.aimlite` (src-tauri/tauri.conf.json). It decides the data folder `%APPDATA%\local.devideus.aimlite`; changing it moves users to an empty folder, so keep it stable (rebranding needs a data migration).

## Signing and CI

Builds are unsigned. `.github/workflows/build.yml` runs only when manually dispatched, builds and uploads run artifacts, and does not publish releases. The source is MIT licensed and the audited fixes are included. The 0.1.1 preview release passed packaged native smoke checks; see `docs/RELEASE-STATUS.md` for evidence and remaining installation limits.
