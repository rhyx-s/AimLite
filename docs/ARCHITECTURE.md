# Architecture

```text
 ┌──────────────────────── WebView2 (frontend, dist/) ────────────────────────┐
 │ ui/ screens ── store.ts (state, persistence calls, error messages)          │
 │   play.ts: rAF loop ─ input/collector.ts ─▶ engine/game.ts ─▶ render/field  │
 │                                   │ summary.ts (results + series)           │
 │ bridge/native.ts (typed invoke) ──┼── bridge/memory.ts (tests / preview)    │
 └───────────────────────────────────┼─────────────────────────────────────────┘
                                     ▼ IPC (21 app commands, each permitted explicitly)
 ┌──────────────────────── Rust (src-tauri) ──────────────────────────────────┐
 │ commands.rs ─ validate.rs (2nd trust boundary) ─ db.rs (rusqlite, bundled) │
 │ diagnostics.rs (read-only Win32) · window_state.rs · single instance      │
 │ tauri-plugin-dialog (native open/save; paths never come from the UI)       │
 └────────────────────────────────────────────────────────────────────────────┘
```

## Frontend

- **Engine** (`src/engine`): pure TypeScript, no DOM. `Game` takes a config, field size and options (seed, input policy, click-rate guard, countdown) and is driven by `begin/advance/pointerMove/pointerDown/pointerUp/space/cancel` with host timestamps. See [ENGINE.md](ENGINE.md).
- **Presets** (`src/presets`): 27 official presets (deep-frozen), comparison keys (engine version + canonical config + field mode/size + input policy + practice level), large-field scaling and practice adjustments.
- **Schemas** (`src/schemas`): `fields.json` (96 gameplay fields: type, bounds, labels, help) is shared with Rust via `include_str!`. Validation for imported presets (size ≤ 64 KB, finite bounded numbers, no unknown fields, dangerous combinations), settings, profiles, routines, run validity.
- **Input** (`src/input/collector.ts`): one canonical sample stream per policy; handlers only queue; no predicted events.
- **Render** (`src/render`): canvas in CSS pixels with a DPR-scaled backing buffer; bounded feedback marks (≤ 400) and trail (≤ 200 samples); charts draw raw values (steps for counters).
- **UI** (`src/ui`): plain DOM through a `textContent`-only helper (lint forbids `innerHTML`, `eval`, `Function`). Runtime clock/frame scheduler is injectable (`runtime.ts`) for tests.

## Native side

- **Commands** (`commands.rs`): bootstrap, settings, profiles, presets, favourites, routines, save/query/delete runs, personal bests, replays, retention, CSV export, text export, preset import, backup, reset, diagnostics. `build.rs` lists them in the app manifest, so each needs an explicit `allow-*` permission in `capabilities/main.json` (granted to the `main` window only). Errors are structured `{ code, message }`.
- **Database** (`db.rs`): `%APPDATA%\local.devideus.aimlite\aimlite.sqlite` (or `AIMLITE_DATA_DIR`), WAL, `busy_timeout` 3 s, foreign keys. Schema version in `PRAGMA user_version`; migrations run in transactions with a `VACUUM INTO` backup before changing an existing database. A newer schema or a failed `quick_check` opens read-only (no writes, export and backup still work); a database is never reset silently. Runs are inserted idempotently by id (`INSERT OR IGNORE`) with their replay in one transaction. Replays can be pruned (all / latest 200 + bests / bests only / none); summaries stay. Backups and resets use `VACUUM INTO` (consistent with the WAL). Exit folds the WAL back (`wal_checkpoint(TRUNCATE)`).
- **Files**: only through native dialogs (`tauri-plugin-dialog`, called from Rust); the frontend never supplies a path. Imports are capped at 64 KB, exports at 16 MB; suggested names are sanitised. CSV cells holding user text are quoted and formula-neutralised.
- **Diagnostics** (`diagnostics.rs`): `SPI_GETMOUSESPEED`, `SPI_GETMOUSE` (Enhance pointer precision), `GetDpiForWindow`, Windows version from the registry, monitors and WebView2 version. Read-only; unknown values are reported as unavailable. Mouse DPI is entered by the user.
- **Window**: geometry saved on close, restored only if the title bar is on a connected monitor; closing quits (no tray, no autostart); a second launch focuses the first window (`tauri-plugin-single-instance`).

## Security settings

Production CSP: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src ipc: http://ipc.localhost; media-src/object-src/frame-src/worker-src 'none'; base-uri 'none'; form-action 'none'`. `freezePrototype`, no global Tauri object, no shell/fs plugin permissions, no devtools in release builds, no remote URLs, no telemetry. Verified at run time: no TCP/UDP endpoints owned by the app process tree while playing.

## Data model (schema 1)

`settings(id=1, json)`, `profiles(id, json)`, `presets(id, json)` (custom only), `favourites(preset_id)`, `routines(id, json)`, `runs(id, preset_id, preset_name, comparison_key, score, direction, valid, status, started_at, ended_at, duration_ms, engine_version, input_policy, seed, config_hash, practice_level, record_json)`, `replays(run_id → runs, kind full|preview, bytes, json)`. `record_json` holds the full run record (config, field geometry and DPR, settings snapshot, profile, summary, frame-interval stats).
