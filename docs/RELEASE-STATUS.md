# AimLite 0.1.1 release status

MIT licensed. Audited preview and database-integrity issues have been fixed in this source tree. The [0.1.1 preview release](https://github.com/rhyx-s/AimLite/releases/tag/v0.1.1) is public.

## Verified source

`npm run verify` passed: TypeScript, ESLint, 96 Vitest tests, Rust formatting, Clippy with warnings denied, 22 Rust tests and production frontend build. JSDOM tests do not establish rendered-canvas or native runtime correctness.

Preview-only recycling bounds imported-preset history without changing scored runs. Backup export uses unique staging and replacement without predeleting an old backup; live database/sidecar aliases and Windows normalized names are rejected. Existing databases are probed read-only before writable pragmas. A newer-schema WAL regression verifies main/WAL/SHM bytes remain unchanged. An incomplete nonempty WAL without SHM is rejected for explicit recovery. An external process mutating sidecars concurrently is outside this precheck's atomicity guarantee. Reset scope is validated before backup creation.

Independent prepatch and candidate security reviews completed. No further confirmed patch blocker remained. The original audit remains a historical prepatch snapshot.

## Security evidence and limits

Original handoff SHA256 checks matched all nine entries. Credential-format scans found no candidates in original source and supplied release archive/binary bytes; compressed installer internals were not independently unpacked. npm lockfile audit returned zero known advisories. OSV found five Rust advisory matches, none in the Windows x64 normal/build tree. Other platforms require separate assessment.

The project includes MIT and collected notices for 222 runtime dependency entries. Third-party components retain their own licenses. No API key, cloud account, telemetry or automatic update is required.

Windows builds are unsigned. Clean-device installation and offline WebView2 installation remain untested. Use only hashes attached to the actual 0.1.1 release; original 0.1.0 handoff binaries do not contain these fixes. No malware-free, absolute security, website-score-equivalence or Roblox-transfer claim is made.

Native smoke of the exact packaged portable executable passed all ten checks on 2026-10-25 after the previous installed instance was closed: launch and 27 modes, completed/cancelled run persistence, CSV export, clean shutdown, history/settings recovery, 100 restarts and single-instance behavior. Executable SHA256: `6a15eb1742bbf9ebd514bfbc61c6a1536af96c7114699fdf038cf496ca10dad5`. This is build-PC testing, not clean-device installation evidence.

Normal installer, portable ZIP and offline installer were rebuilt as 0.1.1. SHA256SUMS.txt and manifest.json were generated and checked. The offline runtime was bundled successfully; installation on a clean machine remains untested.
