AimLite 0.1.1 - portable (Windows x64)
=======================================

1. Keep this folder anywhere (Desktop, USB stick...). Do not run it from inside the zip:
   extract the zip first.
2. Double-click AimLite.exe.
3. Pick a mode, click the field (or press Enter) to start. Esc cancels, R restarts.

Requirements
- Windows 10 or 11, 64-bit.
- Microsoft Edge WebView2 Runtime. Windows 11 already includes it. If the window stays
  blank or AimLite closes at once, install "Microsoft Edge WebView2 Runtime" from Microsoft,
  or use the offline installer (AimLite_0.1.0_x64-offline-setup.exe) instead.

Unsigned build
- This is an unsigned local build. Windows SmartScreen may warn "unknown publisher".
  Only run it if you trust where it came from ("More info" -> "Run anyway").

Your data
- Stored in %APPDATA%\local.devideus.aimlite (the same place as the installed app), not in
  this folder. Settings -> Data shows the exact path and lets you back up or export.
- To keep data next to this copy instead, start AimLite with the environment variable
  AIMLITE_DATA_DIR set to an absolute folder path.
- Deleting this folder does not delete your data.

No internet connection is used. Full guide: USER-GUIDE.md. Licences: THIRD-PARTY-LICENSES.md.
