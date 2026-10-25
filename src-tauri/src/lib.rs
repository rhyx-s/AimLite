mod commands;
pub mod db;
mod diagnostics;
pub mod error;
pub mod validate;
pub mod window_state;

use commands::AppState;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, WindowEvent};

/// Data directory: Tauri's app-data dir for this identifier, or AIMLITE_DATA_DIR when it is set to
/// an absolute path (portable data / isolated testing). Always separate from the install folder.
fn data_dir(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Ok(p) = std::env::var("AIMLITE_DATA_DIR") {
        let p = PathBuf::from(p);
        if p.is_absolute() {
            return Ok(p);
        }
    }
    Ok(app.path().app_data_dir()?)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            commands::focus_main(app)
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = data_dir(app)?;
            let db = db::Db::open(&dir).map_err(|e| {
                format!(
                    "could not open the AimLite database in {}: {e}",
                    dir.display()
                )
            })?;
            if let Some(w) = app.get_webview_window("main") {
                window_state::restore(&dir, &w);
                let _ = w.show();
                let _ = w.set_focus();
            }
            app.manage(AppState {
                db: Mutex::new(db),
                data_dir: dir,
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                if let (Some(state), Some(w)) = (
                    window.try_state::<AppState>(),
                    window.app_handle().get_webview_window(window.label()),
                ) {
                    window_state::save(&state.data_dir, &w);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::save_settings,
            commands::upsert_profile,
            commands::delete_profile,
            commands::upsert_preset,
            commands::delete_preset,
            commands::set_favourite,
            commands::upsert_routine,
            commands::delete_routine,
            commands::save_run,
            commands::query_runs,
            commands::personal_bests,
            commands::get_replay,
            commands::delete_run,
            commands::prune_replays,
            commands::export_runs_csv,
            commands::export_text,
            commands::import_preset_file,
            commands::backup_database,
            commands::reset_data,
            commands::diagnostics,
        ])
        .build(tauri::generate_context!())
        .expect("error while starting AimLite")
        .run(|app, event| {
            // fold the write-ahead log into the database file on a normal exit
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(db) = state.db.lock() {
                        db.checkpoint();
                    }
                }
            }
        });
}
