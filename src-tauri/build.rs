// App commands are listed in the app manifest so each one needs an explicit permission in
// capabilities/main.json (Tauri otherwise allows every registered command for every window).
const COMMANDS: &[&str] = &[
    "bootstrap",
    "save_settings",
    "upsert_profile",
    "delete_profile",
    "upsert_preset",
    "delete_preset",
    "set_favourite",
    "upsert_routine",
    "delete_routine",
    "save_run",
    "query_runs",
    "personal_bests",
    "get_replay",
    "delete_run",
    "prune_replays",
    "export_runs_csv",
    "export_text",
    "import_preset_file",
    "backup_database",
    "reset_data",
    "diagnostics",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
