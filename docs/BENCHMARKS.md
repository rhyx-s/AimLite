# Benchmarks (measured, 2026-10-24)

Machine: the build PC — Windows 11 Home 25H2 (build 26200), WebView2 141.0.3537.99, two 1920×1080 monitors at 100 % scaling, primary running at ≈238 Hz, balanced power settings. One trial per row unless noted. These are application-side numbers, **not** click-to-photon latency. Source: `docs/evidence/native-smoke-*.json`, `install-test-*.json`, `release/0.1.0/manifest.json`.

## Size

| Item | Bytes | |
|---|---|---|
| Normal installer `AimLite_0.1.0_x64-setup.exe` (Evergreen bootstrapper) | 1,865,576 | 1.78 MiB |
| Offline installer `AimLite_0.1.0_x64-offline-setup.exe` (embeds WebView2 standalone installer) | 219,480,247 | 209.3 MiB |
| Portable zip `AimLite_0.1.0_x64-portable.zip` | 2,217,069 | 2.11 MiB |
| Release executable `aimlite.exe` | 4,681,728 | 4.47 MiB |
| Installed footprint (`%LOCALAPPDATA%\AimLite`, exe + uninstaller) | 4,761,063 | 4.54 MiB |
| Fresh database after two runs (incl. replays) | ~76 KB | |

The research budget of < 15 MB download (excluding the separately disclosed runtime) is met by the normal installer and the portable zip. The plan's earlier "~5 MB installer" guess is close for the normal installer; the offline variant is ~209 MiB because of Microsoft's runtime.

## Design v2 (dark violet, 2026-10-24) — memory note

The v2 look (gradients, glass cards, glowing targets) was compared with v1 by alternating launches of both builds on the Modes screen (3 trials each, same window size):

| Build | Private MB (whole tree) | Working set MB | GPU process private MB |
|---|---|---|---|
| v1 (flat design) | 171–180 | 338–364 | 76 |
| v2 (this design) | 275–320 | 347–373 | 186 |

Resident memory (working set) is within ~10 MB of v1. The difference is committed memory in the WebView2 GPU process (tile/raster caches sized by the richer styling). Removing blur, shadows, animations, the page gradient, the variable font or the card gradients one at a time did not change it materially; only the v1 stylesheet did. No browser flags were used to cap it. Frame pacing (238 Hz) and idle CPU (≤ 0.6 %) are unchanged.

## Startup

| Measurement | Result |
|---|---|
| Launch → Modes screen readable via UI Automation, first launch with a new data folder (release folder / portable / installed) | 1300 ms / 1434 ms / 1571 ms |
| Second launch (warm, existing data) | 1274–1344 ms |

These include ~0.7 s of the test harness waking WebView2's accessibility tree from a helper process, so the visible window appears sooner. The < 2 s warm-launch target is met even with that overhead.

## Memory and CPU (whole process tree: aimlite.exe + its WebView2 processes)

| State | Private MB | Working set MB | Processes |
|---|---|---|---|
| Idle on Modes | 175 | 345 | 7 (1 + 6 WebView2) |
| Playing (Pinpoint Sudden Death) | 212–214 | 393–394 | 8 |
| Before / after 100 restart cycles | 214.3 → 202.3 (portable), 210.5 → 201.8 (installed) | 393 → 395 | |

Working sets double-count memory shared between WebView2 processes; private bytes are the better figure. The old "~40 MB RAM" estimate counted only the host process and is not accurate for this app: the WebView2 tree uses ~175 MB private at idle. No growth over 100 restarts (memory fell slightly). Idle CPU over 10 s: 0.47 % of one core.

## Frames (in-app display probe, 3 s)

719 frames, median 4.20 ms (≈238 Hz), p95 4.30 ms, p99 4.30 ms, 0 frames above 1.5× median. WebView2 delivered requestAnimationFrame at the monitor's full rate. Each saved run also records its own frame-interval median/p95/p99 (`record.frame`).

## Input

The packaged app is a secure context and supports `pointerrawupdate` and `getCoalescedEvents()` (Settings → Diagnostics). Observed mouse sample rates need a person moving a physical mouse; the in-app probe (*Measure mouse input*) reports events/s and unique samples/s, but it was **not run with a physical mouse** in this session, so no hardware number is claimed. Synthetic UI-Automation input does not represent a real mouse.

## Network

No TCP connections or UDP endpoints were owned by the app's process tree while playing (Get-NetTCPConnection / Get-NetUDPEndpoint). A run with the network adapter disabled was not performed; the app contains no network code and its CSP allows only local IPC. Installing on a machine without WebView2 (which needs the internet for the normal installer) was not tested.

## Not measured

60 Hz and 144 Hz displays (only the 238 Hz panel was available), mixed-DPI monitors, fullscreen frame pacing, GPU utilisation, click-to-photon latency, clean-machine / VM installs, standard-user account different from the developer account.
