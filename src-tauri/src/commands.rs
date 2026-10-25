//! Typed commands: the whole native API surface the UI can use. Paths are never accepted from the
//! frontend; files are only read or written where the user picked them in a native dialog.
use crate::db::{Db, NewRun, PersonalBest, RunPage, RunQuery, SaveRunResult};
use crate::diagnostics;
use crate::error::{AppError, AppResult};
use crate::validate;
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

pub struct AppState {
    pub db: Mutex<Db>,
    pub data_dir: PathBuf,
}

fn lock(s: &AppState) -> AppResult<std::sync::MutexGuard<'_, Db>> {
    s.db.lock()
        .map_err(|_| AppError::new("io", "database lock poisoned; restart AimLite"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    kind: &'static str,
    data_dir: String,
    database_path: String,
    schema_version: i64,
    supported_schema_version: i64,
    read_only: bool,
    read_only_reason: Option<String>,
    backups_dir: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    settings: Option<Value>,
    profiles: Vec<Value>,
    presets: Vec<Value>,
    favourites: Vec<String>,
    routines: Vec<Value>,
    storage: StorageInfo,
}

#[tauri::command]
pub async fn bootstrap(state: State<'_, AppState>) -> AppResult<Bootstrap> {
    let db = lock(&state)?;
    Ok(Bootstrap {
        settings: db.settings()?,
        profiles: db.profiles()?,
        presets: db.presets()?,
        favourites: db.favourites()?,
        routines: db.routines()?,
        storage: StorageInfo {
            kind: "native",
            data_dir: state.data_dir.display().to_string(),
            database_path: db.path.display().to_string(),
            schema_version: db.schema_version,
            supported_schema_version: crate::db::SUPPORTED_SCHEMA,
            read_only: db.read_only(),
            read_only_reason: db.read_only_reason.clone(),
            backups_dir: db.backups_dir.display().to_string(),
        },
    })
}

#[tauri::command]
pub async fn save_settings(state: State<'_, AppState>, json: String) -> AppResult<()> {
    lock(&state)?.save_settings(&json)
}

#[tauri::command]
pub async fn upsert_profile(state: State<'_, AppState>, id: String, json: String) -> AppResult<()> {
    lock(&state)?.upsert_profile(&id, &json)
}

#[tauri::command]
pub async fn delete_profile(state: State<'_, AppState>, id: String) -> AppResult<()> {
    lock(&state)?.delete_profile(&id)
}

#[tauri::command]
pub async fn upsert_preset(state: State<'_, AppState>, id: String, json: String) -> AppResult<()> {
    lock(&state)?.upsert_preset(&id, &json)
}

#[tauri::command]
pub async fn delete_preset(state: State<'_, AppState>, id: String) -> AppResult<()> {
    lock(&state)?.delete_preset(&id)
}

#[tauri::command]
pub async fn set_favourite(
    state: State<'_, AppState>,
    preset_id: String,
    on: bool,
) -> AppResult<()> {
    lock(&state)?.set_favourite(&preset_id, on)
}

#[tauri::command]
pub async fn upsert_routine(state: State<'_, AppState>, id: String, json: String) -> AppResult<()> {
    lock(&state)?.upsert_routine(&id, &json)
}

#[tauri::command]
pub async fn delete_routine(state: State<'_, AppState>, id: String) -> AppResult<()> {
    lock(&state)?.delete_routine(&id)
}

#[tauri::command]
pub async fn save_run(
    state: State<'_, AppState>,
    run: NewRun,
    replay_json: Option<String>,
    replay_kind: Option<String>,
    retention: String,
) -> AppResult<SaveRunResult> {
    lock(&state)?.save_run(
        &run,
        replay_json.as_deref(),
        replay_kind.as_deref(),
        &retention,
    )
}

#[tauri::command]
pub async fn query_runs(state: State<'_, AppState>, query: RunQuery) -> AppResult<RunPage> {
    lock(&state)?.query_runs(&query)
}

#[tauri::command]
pub async fn personal_bests(state: State<'_, AppState>) -> AppResult<Vec<PersonalBest>> {
    lock(&state)?.personal_bests()
}

#[tauri::command]
pub async fn get_replay(state: State<'_, AppState>, run_id: String) -> AppResult<Option<String>> {
    lock(&state)?.replay(&run_id)
}

#[tauri::command]
pub async fn delete_run(state: State<'_, AppState>, id: String) -> AppResult<()> {
    lock(&state)?.delete_run(&id)
}

#[tauri::command]
pub async fn prune_replays(state: State<'_, AppState>, retention: String) -> AppResult<i64> {
    lock(&state)?.prune_replays(&retention)
}

async fn pick_save(
    app: &AppHandle,
    name: String,
    filter: (&'static str, &'static str),
) -> AppResult<Option<PathBuf>> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(name)
            .add_filter(filter.0, &[filter.1])
            .blocking_save_file()
            .map(|p| {
                p.into_path()
                    .map_err(|e| AppError::new("io", e.to_string()))
            })
            .transpose()
    })
    .await
    .map_err(|e| AppError::new("io", e.to_string()))?
}

#[tauri::command]
pub async fn export_runs_csv(
    app: AppHandle,
    state: State<'_, AppState>,
    preset_id: Option<String>,
) -> AppResult<Option<String>> {
    let csv = lock(&state)?.runs_csv(preset_id.as_deref())?;
    let Some(path) = pick_save(&app, "aimlite-runs.csv".into(), ("CSV", "csv")).await? else {
        return Ok(None);
    };
    // UTF-8 BOM so spreadsheet apps read non-ASCII names correctly
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(csv.as_bytes());
    std::fs::write(&path, bytes)?;
    Ok(Some(path.display().to_string()))
}

#[tauri::command]
pub async fn export_text(
    app: AppHandle,
    kind: String,
    suggested_name: String,
    content: String,
) -> AppResult<Option<String>> {
    if content.len() > validate::MAX_EXPORT_BYTES {
        return Err(AppError::invalid("export is too large"));
    }
    let label = match kind.as_str() {
        "preset" => "AimLite preset",
        "diagnostics" => "Diagnostics",
        "run" => "AimLite run",
        _ => return Err(AppError::invalid("unknown export kind")),
    };
    serde_json::from_str::<Value>(&content)?;
    let name = validate::safe_file_name(&suggested_name, "json");
    let Some(path) = pick_save(&app, name, (label, "json")).await? else {
        return Ok(None);
    };
    std::fs::write(&path, content.as_bytes())?;
    Ok(Some(path.display().to_string()))
}

#[tauri::command]
pub async fn import_preset_file(app: AppHandle) -> AppResult<Option<String>> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("AimLite preset", &["json"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| AppError::new("io", e.to_string()))?;
    let Some(fp) = picked else { return Ok(None) };
    let path = fp
        .into_path()
        .map_err(|e| AppError::new("io", e.to_string()))?;
    let meta = std::fs::metadata(&path)?;
    if !meta.is_file() || meta.len() > validate::MAX_IMPORT_BYTES {
        return Err(AppError::invalid(
            "pick a preset .json file of at most 64 KB",
        ));
    }
    let bytes = std::fs::read(&path)?;
    let text =
        String::from_utf8(bytes).map_err(|_| AppError::invalid("the file is not UTF-8 text"))?;
    Ok(Some(text.trim_start_matches('\u{feff}').to_string()))
}

#[tauri::command]
pub async fn backup_database(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Option<String>> {
    let Some(path) = pick_save(
        &app,
        "aimlite-backup.sqlite".into(),
        ("SQLite database", "sqlite"),
    )
    .await?
    else {
        return Ok(None);
    };
    lock(&state)?.backup_to(&path)?;
    Ok(Some(path.display().to_string()))
}

#[tauri::command]
pub async fn reset_data(state: State<'_, AppState>, scope: String) -> AppResult<String> {
    let p = lock(&state)?.reset(&scope)?;
    Ok(p.display().to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    name: Option<String>,
    width: u32,
    height: u32,
    scale_factor: f64,
    x: i32,
    y: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    app_version: String,
    identifier: String,
    os: String,
    webview2_version: Option<String>,
    mouse_speed: Option<u32>,
    mouse_acceleration: Option<diagnostics::MouseAcceleration>,
    window_dpi: Option<u32>,
    scale_factor: Option<f64>,
    monitors: Vec<MonitorInfo>,
    data_dir: String,
    database_path: String,
    database_bytes: Option<u64>,
    errors: Vec<String>,
}

#[tauri::command]
pub async fn diagnostics(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Diagnostics> {
    let mut errors = vec![];
    let webview = match tauri::webview_version() {
        Ok(v) => Some(v),
        Err(e) => {
            errors.push(format!("WebView2 version unavailable: {e}"));
            None
        }
    };
    let dpi = {
        #[cfg(windows)]
        {
            match window.hwnd() {
                Ok(h) => diagnostics::window_dpi(h.0 as _),
                Err(e) => {
                    errors.push(format!("window handle unavailable: {e}"));
                    None
                }
            }
        }
        #[cfg(not(windows))]
        {
            None
        }
    };
    let monitors = window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| MonitorInfo {
            name: m.name().cloned(),
            width: m.size().width,
            height: m.size().height,
            scale_factor: m.scale_factor(),
            x: m.position().x,
            y: m.position().y,
        })
        .collect();
    let speed = diagnostics::mouse_speed();
    if speed.is_none() {
        errors.push("pointer speed unavailable".into());
    }
    let accel = diagnostics::mouse_acceleration();
    if accel.is_none() {
        errors.push("pointer acceleration setting unavailable".into());
    }
    let (db_path, db_bytes) = {
        let db = lock(&state)?;
        (db.path.display().to_string(), db.size_bytes())
    };
    Ok(Diagnostics {
        app_version: app.package_info().version.to_string(),
        identifier: app.config().identifier.clone(),
        os: diagnostics::os_version(),
        webview2_version: webview,
        mouse_speed: speed,
        mouse_acceleration: accel,
        window_dpi: dpi,
        scale_factor: window.scale_factor().ok(),
        monitors,
        data_dir: state.data_dir.display().to_string(),
        database_path: db_path,
        database_bytes: db_bytes,
        errors,
    })
}

/// Focus the existing window when a second copy is launched.
pub fn focus_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}
