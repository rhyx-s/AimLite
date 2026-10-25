# AimLite user guide

AimLite is an offline mouse-precision trainer for Windows: 27 built-in training modes, your own modes, routines, history and progress charts. Everything stays on your computer.

## Install and first launch

You need Windows 10/11 (x64) with the **Microsoft Edge WebView2 Runtime**. Windows 11 already has it.

**Installer (recommended)** — run `AimLite_0.1.0_x64-setup.exe`. It installs for your user only (no administrator rights) into `%LOCALAPPDATA%\AimLite` and adds AimLite to the Start menu. If WebView2 is missing it downloads it from Microsoft (internet needed once). `AimLite_0.1.0_x64-offline-setup.exe` does the same without internet: it carries Microsoft's WebView2 installer inside (much larger).

**Portable zip** — extract `AimLite_0.1.0_x64-portable.zip` anywhere and run `AimLite.exe`. Nothing is installed, but WebView2 must already be present, and your data still goes to the normal data folder (below).

These are **unsigned local builds**. Windows SmartScreen may say "Windows protected your PC / unknown publisher". Only run a build you made or got from someone you trust; choose *More info → Run anyway* if you do. Do not turn SmartScreen off.

When AimLite opens you land on **Modes**. Click a mode, then click the field (or press Enter) to start. No setup is needed.

## Screens

- **Modes** — all modes by category, with a search box, favourites (☆), your best for the current setup and the rules of each mode. *Practice* starts adaptive practice (see below).
- **Play** — the field, timer, score and live stats. A countdown runs first.
- **Results** — score, hits, misses, lost targets, hit rate (hits ÷ clicks), centre precision, reaction and aim times, path efficiency, a points breakdown, a replay of every click, a map of where you click relative to the target centre, and graphs. *Retry* plays again.
- **Progress** — every run (finished, and cancelled runs longer than 3 s), page by page. Pick a mode to see your best, the median of your last 10 runs, how much they vary, and charts. *Export CSV* saves your history as a spreadsheet file. *View* reopens a run's results.
- **Routines** — chains of modes with repetitions and rests (e.g. a five-minute warm-up). *Start* plays them in order; results show *Next*.
- **Builder** — make your own mode from any existing one. Every rule is editable; settings that do nothing with the current choices are greyed out with the reason. Official modes never change — you edit a copy. *Export/Import JSON* shares modes as files.
- **Settings** — look (colours, opacity, outlines, centre dot/crosshair, background), feedback (click marks, fades, cursor trail), HUD, audio, play options, keys, accessibility, setup profiles, data and diagnostics.
- **Help** — controls, scoring, troubleshooting.

## Controls

| Key / action | What it does |
|---|---|
| Click the field / Enter | Start a run (the starting click does not count) |
| Training button (Settings → Play; left by default) | Shoot |
| Esc | Cancel the run |
| R (rebindable) | Restart |
| M (rebindable) | Mute / unmute |
| F11 (rebindable) | Fullscreen |
| Space | Ends a run only in modes that allow it |
| Arrow keys | Move between modes on the Modes screen |
| Tab / Shift+Tab | Move through every control |

A run is cancelled — not scored — if the window loses focus, the app stalls, the field size or display scaling changes, or (official modes, optional) you click more than 25 times within 2 seconds.

## How results are compared

- **Points modes**: points per hit plus bonuses for centre precision, reaction speed, straight paths and distance; minus points for misses and lost targets.
- **Tracking modes**: one point per tick (61 per second) with the cursor on a target.
- **Stopwatch modes** and **reaction modes**: time; lower is better.
- Bests and medians compare only runs with the same mode, field size (Classic or Large and its size), input policy (Settings → Play) and practice level. Cancelled runs never count.
- **Adaptive practice** makes the targets smaller/faster or bigger/slower between runs (never during one), based on your hit rate or time on target, within ±5 levels. Practice results are kept apart from benchmark results.
- The modes follow rules recovered from aim400kg.com's public training modes. That does not make AimLite scores equal to scores on the website.
- Better scores here do not guarantee better aim in any particular game. Setup profiles (Settings → Profiles) record which game, camera mode, mouse DPI (you enter it) and sensitivity you train for, so you can interpret your results; they do not convert sensitivities.

## Your data

Data folder: `%APPDATA%\local.devideus.aimlite` (for example `C:\Users\<you>\AppData\Roaming\local.devideus.aimlite`). Settings → Data and Settings → Diagnostics show the exact path. It holds `aimlite.sqlite` (settings, modes, routines, profiles, history), `window-state.json` and `backups\`.

- **Back up**: Settings → Data → *Back up database…* writes a consistent copy wherever you choose.
- **Export**: *Export all runs (CSV)*; a single run from its results screen (*Export run*); modes from the Builder.
- **Replays** use most of the space; Settings → Data → *Keep detailed replays for* limits them. Scores and bests are always kept.
- **Reset**: *Delete all run history…* or *Reset everything…* (you type a confirmation word). Both write a backup into `backups\` first.
- **Uninstall** (Windows Settings → Apps, or the Start menu) removes the program but keeps your data. To remove your data too, delete the data folder yourself.
- AIMLITE_DATA_DIR: set this environment variable to an absolute folder to keep data somewhere else (for example next to the portable copy).
- AimLite makes no network connections.

## Troubleshooting

| Problem | What to do |
|---|---|
| Blank or white window, or it closes at once | WebView2 is missing or broken. Install or repair "Microsoft Edge WebView2 Runtime" (Microsoft's website, or Windows Settings → Apps → Repair), or use the offline installer. |
| "Windows protected your PC" | The build is unsigned. Use *More info → Run anyway* only if you trust the file. |
| No sound | Sound starts after your first click or key. Check M (mute), Settings → Audio, and the Windows volume mixer. |
| Field blurry, wrong size, or runs cancel when moving the window | Display scaling differs between monitors; a run is cancelled when it changes. Start the run on the monitor you play on. Settings → Diagnostics shows the DPI AimLite sees. |
| "Not saved" after a run | The message says why (disk full, permissions, database busy). Press *Retry save*, or *Export run* to keep it as a file. Nothing is lost while the results screen is open. |
| "Permission" errors | Make sure your user account can write the data folder. |
| "Read-only data" message | The database was written by a newer AimLite or failed its check. Nothing was deleted. Back it up (Settings → Data) and install the newer version, or ask for help with the backup. |
| Mouse feels different from games | AimLite uses the normal Windows cursor (including your pointer speed and "Enhance pointer precision"). Settings → Diagnostics shows both, read-only. |
