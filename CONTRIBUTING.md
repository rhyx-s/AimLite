# Contributing

Focused fixes, reproducible bug reports and meaningful tests are welcome.

1. Follow [BUILD.md](BUILD.md), then run `npm.cmd ci`.
2. Make one focused change. Keep dependency lockfiles and the application identifier stable unless migration is intentional.
3. Run `npm.cmd run verify`. Native changes also require a packaged-app check with real save/relaunch/export; browser preview uses an in-memory adapter.
4. Describe the problem, resulting behaviour, actual validation and untested cases in your pull request.

Keep legacy benchmark rules separate from adaptive experiments. Do not claim website-score equivalence or Roblox improvement from trainer scores alone.

Do not commit credentials, personal data, private logs, installers, archives, dependencies or build outputs. Publish downloadable binaries through Releases. Only contribute code/assets you have the right to redistribute; third-party dependencies retain their own licences. Original contributions use the MIT project licence.
