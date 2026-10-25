//! SQLite repository. Rust owns the database; the UI only reaches it through typed commands.
use crate::error::{AppError, AppResult};
use crate::validate;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Schema version this build reads and writes.
pub const SUPPORTED_SCHEMA: i64 = 1;

const MIGRATIONS: &[(i64, &str)] = &[(
    1,
    "CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, updated_at INTEGER NOT NULL);
     CREATE TABLE profiles (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
     CREATE TABLE presets (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
     CREATE TABLE favourites (preset_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
     CREATE TABLE routines (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
     CREATE TABLE runs (
       id TEXT PRIMARY KEY, preset_id TEXT NOT NULL, preset_name TEXT NOT NULL, comparison_key TEXT NOT NULL,
       score REAL NOT NULL, direction TEXT NOT NULL CHECK (direction IN ('higher','lower')), valid INTEGER NOT NULL,
       status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
       engine_version TEXT NOT NULL, input_policy TEXT NOT NULL, seed INTEGER NOT NULL, config_hash TEXT NOT NULL,
       practice_level INTEGER, record_json TEXT NOT NULL, created_at INTEGER NOT NULL);
     CREATE INDEX runs_preset ON runs(preset_id, started_at DESC);
     CREATE INDEX runs_key ON runs(comparison_key, valid, score);
     CREATE INDEX runs_started ON runs(started_at DESC);
     CREATE TABLE replays (run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE, kind TEXT NOT NULL,
       bytes INTEGER NOT NULL, json TEXT NOT NULL);",
)];

pub struct Db {
    conn: Connection,
    pub path: PathBuf,
    pub backups_dir: PathBuf,
    pub schema_version: i64,
    pub read_only_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewRun {
    pub id: String,
    pub preset_id: String,
    pub preset_name: String,
    pub comparison_key: String,
    pub score: f64,
    pub direction: String,
    pub valid: bool,
    pub status: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_ms: i64,
    pub engine_version: String,
    pub input_policy: String,
    pub seed: i64,
    pub config_hash: String,
    pub practice_level: Option<i64>,
    pub record_json: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunQuery {
    pub preset_id: Option<String>,
    pub comparison_key: Option<String>,
    pub valid_only: Option<bool>,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRow {
    pub id: String,
    pub preset_id: String,
    pub preset_name: String,
    pub comparison_key: String,
    pub score: f64,
    pub direction: String,
    pub valid: bool,
    pub status: String,
    pub started_at: i64,
    pub duration_ms: i64,
    pub has_replay: bool,
    pub summary: Value,
    pub practice_level: Option<i64>,
    pub profile_name: Option<String>,
    pub input_policy: String,
    pub field: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunPage {
    pub rows: Vec<RunRow>,
    pub total: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalBest {
    pub comparison_key: String,
    pub preset_id: String,
    pub score: f64,
    pub direction: String,
    pub run_id: String,
    pub started_at: i64,
}

#[derive(Debug, Serialize)]
pub struct SaveRunResult {
    pub saved: bool,
    pub duplicate: bool,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// Main-file readonly alone can still write WAL shared memory. Fail safely if recovery needs writes.
fn open_readonly(path: &Path) -> AppResult<Connection> {
    let sidecar = |suffix: &str| {
        let mut name = path.as_os_str().to_os_string();
        name.push(suffix);
        PathBuf::from(name)
    };
    // Windows SQLite can create SHM even with readonly_shm. Require existing shared memory
    // for a live WAL; recovery of an incomplete WAL set must be explicit, never a probe.
    if sidecar("-wal").metadata().is_ok_and(|m| m.len() > 0) && !sidecar("-shm").is_file() {
        return Err(AppError::invalid("Database WAL has no shared-memory file; preserve the database and sidecars for recovery"));
    }
    let mut uri = String::from("file:");
    let text = path
        .to_str()
        .ok_or_else(|| AppError::invalid("database path is not valid text"))?;
    for b in text.replace('\\', "/").bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'/' | b':' | b'-' | b'_' | b'.' | b'~') {
            uri.push(b as char);
        } else {
            use std::fmt::Write;
            write!(uri, "%{b:02X}").unwrap();
        }
    }
    uri.push_str("?mode=ro&readonly_shm=1");
    Ok(Connection::open_with_flags(
        uri,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )?)
}

/// `VACUUM INTO` a fresh file: a consistent copy that includes WAL contents.
fn vacuum_into(conn: &Connection, target: &Path) -> AppResult<()> {
    // Own the staging directory; never remove a predictable sibling or the old backup.
    let parent = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let stage = tempfile::Builder::new()
        .prefix(".aimlite-backup-")
        .tempdir_in(parent)?;
    let tmp = stage.path().join("backup.sqlite");
    let s = tmp
        .to_str()
        .ok_or_else(|| AppError::invalid("backup path is not valid text"))?;
    conn.execute("VACUUM INTO ?1", params![s])?;
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&tmp)?
        .sync_all()?;
    // Same-volume replacement. A failed rename leaves the existing destination intact.
    std::fs::rename(&tmp, target)?;
    Ok(())
}

impl Db {
    /// Open (or create) the database in `data_dir`. Never resets an existing database: a newer
    /// schema or a failed integrity check opens it read-only so the user can export first.
    pub fn open(data_dir: &Path) -> AppResult<Db> {
        std::fs::create_dir_all(data_dir)?;
        let backups_dir = data_dir.join("backups");
        let path = data_dir.join("aimlite.sqlite");
        let existed = path.exists();
        let conn = if existed {
            open_readonly(&path)?
        } else {
            Connection::open(&path)?
        };
        conn.busy_timeout(std::time::Duration::from_millis(3000))?;
        let mut db = Db {
            conn,
            path,
            backups_dir,
            schema_version: 0,
            read_only_reason: None,
        };
        let check: String = db
            .conn
            .query_row("PRAGMA quick_check", [], |r| r.get(0))
            .unwrap_or_else(|e| e.to_string());
        if check != "ok" {
            db.read_only_reason = Some(format!("the integrity check failed ({check})"));
            return Ok(db);
        }
        db.schema_version = db.conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if db.schema_version > SUPPORTED_SCHEMA {
            db.read_only_reason = Some(format!(
                "it was written by a newer AimLite (schema {} > {})",
                db.schema_version, SUPPORTED_SCHEMA
            ));
            return Ok(db);
        }
        if existed {
            db.conn = Connection::open_with_flags(&db.path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
            db.conn
                .busy_timeout(std::time::Duration::from_millis(3000))?;
            // Recheck after reopening before any journal/migration writes.
            let check: String = db
                .conn
                .query_row("PRAGMA quick_check", [], |r| r.get(0))
                .unwrap_or_else(|e| e.to_string());
            db.schema_version = db
                .conn
                .query_row("PRAGMA user_version", [], |r| r.get(0))
                .unwrap_or(i64::MAX);
            if check != "ok" || db.schema_version > SUPPORTED_SCHEMA {
                db.conn = open_readonly(&db.path)?;
                db.read_only_reason =
                    Some("the database changed during startup; restart or export it".into());
                return Ok(db);
            }
        }
        db.conn.pragma_update(None, "foreign_keys", "ON")?;
        db.conn.pragma_update(None, "journal_mode", "WAL")?;
        db.conn.pragma_update(None, "synchronous", "NORMAL")?;
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&mut self) -> AppResult<()> {
        if self.schema_version >= SUPPORTED_SCHEMA {
            return Ok(());
        }
        if self.schema_version > 0 {
            // existing data: keep a copy before changing its structure
            std::fs::create_dir_all(&self.backups_dir)?;
            let b = self.backups_dir.join(format!(
                "before-migration-v{}-{}.sqlite",
                self.schema_version,
                now_ms()
            ));
            vacuum_into(&self.conn, &b)?;
        }
        for (v, sql) in MIGRATIONS {
            if *v <= self.schema_version {
                continue;
            }
            let tx = self.conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", v)?;
            tx.commit()?;
            self.schema_version = *v;
        }
        Ok(())
    }

    fn writable(&self) -> AppResult<()> {
        match &self.read_only_reason {
            Some(r) => Err(AppError::read_only(r)),
            None => Ok(()),
        }
    }

    pub fn read_only(&self) -> bool {
        self.read_only_reason.is_some()
    }

    // ------------------------------------------------------------ simple documents

    pub fn settings(&self) -> AppResult<Option<Value>> {
        if self.schema_version < 1 {
            return Ok(None);
        }
        let s: Option<String> = self
            .conn
            .query_row("SELECT json FROM settings WHERE id = 1", [], |r| r.get(0))
            .optional()?;
        Ok(s.and_then(|s| serde_json::from_str(&s).ok()))
    }

    pub fn save_settings(&self, json: &str) -> AppResult<()> {
        self.writable()?;
        validate::parse_json(json, validate::MAX_SETTINGS_BYTES, "settings")?;
        self.conn.execute(
            "INSERT INTO settings (id, json, updated_at) VALUES (1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
            params![json, now_ms()],
        )?;
        Ok(())
    }

    fn list_docs(&self, table: &str) -> AppResult<Vec<Value>> {
        if self.schema_version < 1 {
            return Ok(vec![]);
        }
        let mut st = self
            .conn
            .prepare(&format!("SELECT json FROM {table} ORDER BY updated_at"))?;
        let rows = st.query_map([], |r| r.get::<_, String>(0))?;
        let mut out = vec![];
        for r in rows {
            if let Ok(v) = serde_json::from_str::<Value>(&r?) {
                out.push(v);
            }
        }
        Ok(out)
    }

    fn upsert_doc(&self, table: &str, id: &str, json: &str) -> AppResult<()> {
        self.writable()?;
        self.conn.execute(
            &format!(
                "INSERT INTO {table} (id, json, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at"
            ),
            params![id, json, now_ms()],
        )?;
        Ok(())
    }

    fn delete_doc(&self, table: &str, id: &str) -> AppResult<()> {
        self.writable()?;
        self.conn
            .execute(&format!("DELETE FROM {table} WHERE id = ?1"), params![id])?;
        Ok(())
    }

    pub fn profiles(&self) -> AppResult<Vec<Value>> {
        self.list_docs("profiles")
    }
    pub fn presets(&self) -> AppResult<Vec<Value>> {
        self.list_docs("presets")
    }
    pub fn routines(&self) -> AppResult<Vec<Value>> {
        self.list_docs("routines")
    }

    pub fn upsert_profile(&self, id: &str, json: &str) -> AppResult<()> {
        let v = validate::parse_json(json, validate::MAX_ENTITY_BYTES, "profile")?;
        validate::check_profile(id, &v)?;
        self.upsert_doc("profiles", id, json)
    }
    pub fn delete_profile(&self, id: &str) -> AppResult<()> {
        validate::check_id(id, "profile")?;
        self.delete_doc("profiles", id)
    }
    pub fn upsert_preset(&self, id: &str, json: &str) -> AppResult<()> {
        let v = validate::parse_json(json, validate::MAX_ENTITY_BYTES, "preset")?;
        validate::check_preset(id, &v)?;
        self.upsert_doc("presets", id, json)
    }
    pub fn delete_preset(&mut self, id: &str) -> AppResult<()> {
        validate::check_id(id, "custom")?;
        self.writable()?;
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM presets WHERE id = ?1", params![id])?;
        tx.execute("DELETE FROM favourites WHERE preset_id = ?1", params![id])?;
        tx.commit()?;
        Ok(())
    }
    pub fn upsert_routine(&self, id: &str, json: &str) -> AppResult<()> {
        let v = validate::parse_json(json, validate::MAX_ENTITY_BYTES, "routine")?;
        validate::check_routine(id, &v)?;
        self.upsert_doc("routines", id, json)
    }
    pub fn delete_routine(&self, id: &str) -> AppResult<()> {
        validate::check_id(id, "routine")?;
        self.delete_doc("routines", id)
    }

    pub fn favourites(&self) -> AppResult<Vec<String>> {
        if self.schema_version < 1 {
            return Ok(vec![]);
        }
        let mut st = self
            .conn
            .prepare("SELECT preset_id FROM favourites ORDER BY created_at")?;
        let rows = st.query_map([], |r| r.get::<_, String>(0))?;
        rows.collect::<Result<_, _>>().map_err(Into::into)
    }

    pub fn set_favourite(&self, preset_id: &str, on: bool) -> AppResult<()> {
        validate::check_preset_ref(preset_id)?;
        self.writable()?;
        if on {
            self.conn.execute(
                "INSERT OR IGNORE INTO favourites (preset_id, created_at) VALUES (?1, ?2)",
                params![preset_id, now_ms()],
            )?;
        } else {
            self.conn.execute(
                "DELETE FROM favourites WHERE preset_id = ?1",
                params![preset_id],
            )?;
        }
        Ok(())
    }

    // ------------------------------------------------------------ runs

    /// Insert a finished run (idempotent by id) and its optional replay in one transaction.
    pub fn save_run(
        &mut self,
        run: &NewRun,
        replay_json: Option<&str>,
        replay_kind: Option<&str>,
        retention: &str,
    ) -> AppResult<SaveRunResult> {
        self.writable()?;
        validate::check_id(&run.id, "run")?;
        validate::check_preset_ref(&run.preset_id)?;
        if run.preset_name.chars().count() > 60
            || run.comparison_key.len() > 64
            || run.config_hash.len() > 64
        {
            return Err(AppError::invalid("run fields too long"));
        }
        if !run.score.is_finite() {
            return Err(AppError::invalid("score must be finite"));
        }
        if run.direction != "higher" && run.direction != "lower" {
            return Err(AppError::invalid("direction must be higher or lower"));
        }
        if run.status != "completed" && run.status != "cancelled" {
            return Err(AppError::invalid("unknown run status"));
        }
        if run.valid && run.status != "completed" {
            return Err(AppError::invalid("only completed runs can be valid"));
        }
        if !(-5..=5).contains(&run.practice_level.unwrap_or(0)) {
            return Err(AppError::invalid("practice level out of range"));
        }
        validate::parse_json(
            &run.record_json,
            validate::MAX_RUN_RECORD_BYTES,
            "run record",
        )?;
        if let Some(r) = replay_json {
            validate::parse_json(r, validate::MAX_REPLAY_BYTES, "replay")?;
        }
        let kind = match replay_kind {
            Some("full") | None => "full",
            Some("preview") => "preview",
            Some(_) => return Err(AppError::invalid("unknown replay kind")),
        };
        let tx = self.conn.transaction()?;
        let inserted = tx.execute(
            "INSERT OR IGNORE INTO runs (id, preset_id, preset_name, comparison_key, score, direction, valid, status,
               started_at, ended_at, duration_ms, engine_version, input_policy, seed, config_hash, practice_level,
               record_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            params![
                run.id, run.preset_id, run.preset_name, run.comparison_key, run.score, run.direction, run.valid as i64,
                run.status, run.started_at, run.ended_at, run.duration_ms, run.engine_version, run.input_policy,
                run.seed, run.config_hash, run.practice_level, run.record_json, now_ms()
            ],
        )?;
        if inserted == 1 && retention != "none" {
            if let Some(r) = replay_json {
                tx.execute(
                    "INSERT OR REPLACE INTO replays (run_id, kind, bytes, json) VALUES (?1, ?2, ?3, ?4)",
                    params![run.id, kind, r.len() as i64, r],
                )?;
            }
        }
        tx.commit()?;
        if inserted == 1 {
            self.prune_replays(retention)?;
        }
        Ok(SaveRunResult {
            saved: true,
            duplicate: inserted == 0,
        })
    }

    /// Apply replay retention. Summaries are never touched. Returns the number of replays removed.
    pub fn prune_replays(&self, retention: &str) -> AppResult<i64> {
        self.writable()?;
        let pb_ids = "SELECT r.id FROM runs r WHERE r.valid = 1 AND r.id = (
              SELECT r2.id FROM runs r2 WHERE r2.comparison_key = r.comparison_key AND r2.valid = 1
              ORDER BY CASE WHEN r2.direction = 'higher' THEN -r2.score ELSE r2.score END, r2.started_at LIMIT 1)";
        let sql = match retention {
            "all" => return Ok(0),
            "none" => "DELETE FROM replays".to_string(),
            "pb-only" => format!("DELETE FROM replays WHERE run_id NOT IN ({pb_ids})"),
            "recent-200" => format!(
                "DELETE FROM replays WHERE run_id NOT IN (SELECT id FROM runs ORDER BY started_at DESC LIMIT 200)
                 AND run_id NOT IN ({pb_ids})"
            ),
            _ => return Err(AppError::invalid("unknown retention setting")),
        };
        let n = self.conn.execute(&sql, [])?;
        Ok(n as i64)
    }

    pub fn query_runs(&self, q: &RunQuery) -> AppResult<RunPage> {
        if self.schema_version < 1 {
            return Ok(RunPage {
                rows: vec![],
                total: 0,
            });
        }
        let limit = q.limit.clamp(1, 500);
        let offset = q.offset.max(0);
        let mut where_ = vec!["1 = 1".to_string()];
        let mut args: Vec<String> = vec![];
        if let Some(p) = &q.preset_id {
            validate::check_preset_ref(p)?;
            args.push(p.clone());
            where_.push(format!("preset_id = ?{}", args.len()));
        }
        if let Some(k) = &q.comparison_key {
            if k.len() > 64 {
                return Err(AppError::invalid("bad comparison key"));
            }
            args.push(k.clone());
            where_.push(format!("comparison_key = ?{}", args.len()));
        }
        if q.valid_only.unwrap_or(false) {
            where_.push("valid = 1".into());
        }
        let w = where_.join(" AND ");
        let total: i64 = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM runs WHERE {w}"),
            rusqlite::params_from_iter(args.iter()),
            |r| r.get(0),
        )?;
        let mut st = self.conn.prepare(&format!(
            "SELECT id, preset_id, preset_name, comparison_key, score, direction, valid, status, started_at, duration_ms,
               practice_level, input_policy, record_json, EXISTS(SELECT 1 FROM replays WHERE run_id = runs.id)
             FROM runs WHERE {w} ORDER BY started_at DESC, id DESC LIMIT {limit} OFFSET {offset}"
        ))?;
        let rows = st.query_map(rusqlite::params_from_iter(args.iter()), |r| {
            let rec: String = r.get(12)?;
            let v: Value = serde_json::from_str(&rec).unwrap_or(Value::Null);
            Ok(RunRow {
                id: r.get(0)?,
                preset_id: r.get(1)?,
                preset_name: r.get(2)?,
                comparison_key: r.get(3)?,
                score: r.get(4)?,
                direction: r.get(5)?,
                valid: r.get::<_, i64>(6)? == 1,
                status: r.get(7)?,
                started_at: r.get(8)?,
                duration_ms: r.get(9)?,
                practice_level: r.get(10)?,
                input_policy: r.get(11)?,
                has_replay: r.get::<_, i64>(13)? == 1,
                summary: v.get("summary").cloned().unwrap_or(Value::Null),
                profile_name: v
                    .get("profileName")
                    .and_then(Value::as_str)
                    .map(String::from),
                field: v.get("field").cloned().unwrap_or(Value::Null),
            })
        })?;
        Ok(RunPage {
            rows: rows.collect::<Result<_, _>>()?,
            total,
        })
    }

    pub fn personal_bests(&self) -> AppResult<Vec<PersonalBest>> {
        if self.schema_version < 1 {
            return Ok(vec![]);
        }
        let mut st = self.conn.prepare(
            "SELECT comparison_key, preset_id, score, direction, id, started_at FROM (
               SELECT *, ROW_NUMBER() OVER (PARTITION BY comparison_key
                 ORDER BY CASE WHEN direction = 'higher' THEN -score ELSE score END, started_at) AS rn
               FROM runs WHERE valid = 1) WHERE rn = 1",
        )?;
        let rows = st.query_map([], |r| {
            Ok(PersonalBest {
                comparison_key: r.get(0)?,
                preset_id: r.get(1)?,
                score: r.get(2)?,
                direction: r.get(3)?,
                run_id: r.get(4)?,
                started_at: r.get(5)?,
            })
        })?;
        rows.collect::<Result<_, _>>().map_err(Into::into)
    }

    pub fn replay(&self, run_id: &str) -> AppResult<Option<String>> {
        validate::check_id(run_id, "run")?;
        self.conn
            .query_row(
                "SELECT json FROM replays WHERE run_id = ?1",
                params![run_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn delete_run(&self, id: &str) -> AppResult<()> {
        validate::check_id(id, "run")?;
        self.writable()?;
        self.conn
            .execute("DELETE FROM runs WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Rows for CSV export (all runs, or one preset), oldest first.
    pub fn runs_csv(&self, preset_id: Option<&str>) -> AppResult<String> {
        let mut out = String::from(
            "run_id,started_utc_ms,preset_id,preset_name,status,valid,score,direction,duration_ms,hits,misses,losses,hit_rate,precision_avg,reaction_avg_ms,input_policy,comparison_key,practice_level,profile\n",
        );
        if self.schema_version < 1 {
            return Ok(out);
        }
        let (sql, args): (&str, Vec<String>) = match preset_id {
            Some(p) => {
                validate::check_preset_ref(p)?;
                ("SELECT id, started_at, preset_id, preset_name, status, valid, score, direction, duration_ms, input_policy, comparison_key, practice_level, record_json FROM runs WHERE preset_id = ?1 ORDER BY started_at", vec![p.to_string()])
            }
            None => ("SELECT id, started_at, preset_id, preset_name, status, valid, score, direction, duration_ms, input_policy, comparison_key, practice_level, record_json FROM runs ORDER BY started_at", vec![]),
        };
        let mut st = self.conn.prepare(sql)?;
        let mut rows = st.query(rusqlite::params_from_iter(args.iter()))?;
        let num = |v: Option<&Value>| -> String {
            v.and_then(Value::as_f64)
                .filter(|f| f.is_finite())
                .map(|f| format!("{f}"))
                .unwrap_or_default()
        };
        while let Some(r) = rows.next()? {
            let rec: String = r.get(12)?;
            let v: Value = serde_json::from_str(&rec).unwrap_or(Value::Null);
            let s = &v["summary"];
            let profile = v.get("profileName").and_then(Value::as_str).unwrap_or("");
            let practice: Option<i64> = r.get(11)?;
            out.push_str(&format!(
                "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}\n",
                validate::csv_text(&r.get::<_, String>(0)?),
                r.get::<_, i64>(1)?,
                validate::csv_text(&r.get::<_, String>(2)?),
                validate::csv_text(&r.get::<_, String>(3)?),
                validate::csv_text(&r.get::<_, String>(4)?),
                r.get::<_, i64>(5)?,
                r.get::<_, f64>(6)?,
                validate::csv_text(&r.get::<_, String>(7)?),
                r.get::<_, i64>(8)?,
                num(s.get("hits")),
                num(s.get("misses")),
                num(s.get("losses")),
                num(s.get("hitRate")),
                num(s.get("precision").and_then(|p| p.get("avg"))),
                num(s.get("reaction").and_then(|p| p.get("avg"))),
                validate::csv_text(&r.get::<_, String>(9)?),
                validate::csv_text(&r.get::<_, String>(10)?),
                practice.map(|p| p.to_string()).unwrap_or_default(),
                validate::csv_text(profile),
            ));
        }
        Ok(out)
    }

    pub fn backup_to(&self, target: &Path) -> AppResult<()> {
        #[cfg(windows)]
        if target.file_name().is_some_and(|n| {
            let n = n.to_string_lossy();
            n.ends_with(['.', ' ']) || n.contains(':')
        }) {
            return Err(AppError::invalid(
                "choose a file name without a trailing dot, space or alternate data stream",
            ));
        }
        if std::fs::symlink_metadata(target).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(AppError::invalid(
                "choose a backup file rather than a symbolic link",
            ));
        }
        let parent = target
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        let parent = std::fs::canonicalize(parent)?;
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let mut protected = self.path.as_os_str().to_os_string();
            protected.push(suffix);
            let protected = PathBuf::from(protected);
            let protected_parent = std::fs::canonicalize(protected.parent().unwrap())?;
            let same_name = target
                .file_name()
                .zip(protected.file_name())
                .is_some_and(|(a, b)| {
                    a.to_string_lossy()
                        .eq_ignore_ascii_case(&b.to_string_lossy())
                });
            let same_path = same_name && same_file::is_same_file(&parent, &protected_parent)?;
            let same_file = target.exists()
                && protected.exists()
                && same_file::is_same_file(target, &protected)?;
            if same_path || same_file {
                return Err(AppError::invalid(
                    "the live database and its sidecars cannot be backup destinations",
                ));
            }
        }
        vacuum_into(&self.conn, target)
    }

    /// Back up into backups/, then delete runs (or everything). Returns the backup path.
    pub fn reset(&mut self, scope: &str) -> AppResult<PathBuf> {
        self.writable()?;
        if scope != "runs" && scope != "everything" {
            return Err(AppError::invalid("unknown reset scope"));
        }
        std::fs::create_dir_all(&self.backups_dir)?;
        let b = self
            .backups_dir
            .join(format!("before-reset-{}-{}.sqlite", scope, now_ms()));
        vacuum_into(&self.conn, &b)?;
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM replays", [])?;
        tx.execute("DELETE FROM runs", [])?;
        if scope == "everything" {
            for t in ["settings", "profiles", "presets", "favourites", "routines"] {
                tx.execute(&format!("DELETE FROM {t}"), [])?;
            }
        } else if scope != "runs" {
            return Err(AppError::invalid("unknown reset scope"));
        }
        tx.commit()?;
        Ok(b)
    }

    /// Best-effort WAL checkpoint (called on exit). Data is safe either way.
    pub fn checkpoint(&self) {
        if self.read_only_reason.is_none() {
            let _ = self
                .conn
                .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
        }
    }

    pub fn size_bytes(&self) -> Option<u64> {
        let main = std::fs::metadata(&self.path).ok()?.len();
        let wal = std::fs::metadata(self.path.with_extension("sqlite-wal"))
            .map(|m| m.len())
            .unwrap_or(0);
        Some(main + wal)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(id: &str, key: &str, score: f64, valid: bool) -> NewRun {
        NewRun {
            id: id.into(),
            preset_id: "official:pinpoint-pulse".into(),
            preset_name: "Pinpoint Pulse".into(),
            comparison_key: key.into(),
            score,
            direction: "higher".into(),
            valid,
            status: if valid { "completed" } else { "cancelled" }.into(),
            started_at: (score as i64) * 10,
            ended_at: 0,
            duration_ms: 1000,
            engine_version: "e1".into(),
            input_policy: "legacy-v1".into(),
            seed: 1,
            config_hash: "h".into(),
            practice_level: None,
            record_json: r#"{"summary":{"hits":3,"precision":{"avg":50}},"profileName":"=evil"}"#
                .into(),
        }
    }

    #[test]
    fn save_is_idempotent_and_survives_reopen() {
        let dir = tempfile::tempdir().unwrap();
        {
            let mut db = Db::open(dir.path()).unwrap();
            assert_eq!(db.schema_version, 1);
            let r = db
                .save_run(
                    &run("run:a1", "k", 10.0, true),
                    Some("{\"x\":1}"),
                    Some("full"),
                    "all",
                )
                .unwrap();
            assert!(!r.duplicate);
            let r = db
                .save_run(&run("run:a1", "k", 10.0, true), None, None, "all")
                .unwrap();
            assert!(r.duplicate);
            db.save_settings("{\"volume\":5}").unwrap();
        }
        let db = Db::open(dir.path()).unwrap();
        let page = db
            .query_runs(&RunQuery {
                preset_id: None,
                comparison_key: None,
                valid_only: None,
                limit: 10,
                offset: 0,
            })
            .unwrap();
        assert_eq!(page.total, 1);
        assert!(page.rows[0].has_replay);
        assert_eq!(db.settings().unwrap().unwrap()["volume"], 5);
        assert_eq!(db.replay("run:a1").unwrap().as_deref(), Some("{\"x\":1}"));
    }

    #[test]
    fn personal_bests_ignore_invalid_runs_and_respect_direction() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        db.save_run(&run("run:a", "k", 10.0, true), None, None, "all")
            .unwrap();
        db.save_run(&run("run:b", "k", 99.0, false), None, None, "all")
            .unwrap();
        db.save_run(&run("run:c", "k", 20.0, true), None, None, "all")
            .unwrap();
        let mut low = run("run:d", "low", 2.0, true);
        low.direction = "lower".into();
        db.save_run(&low, None, None, "all").unwrap();
        let mut low2 = run("run:e", "low", 1.5, true);
        low2.direction = "lower".into();
        db.save_run(&low2, None, None, "all").unwrap();
        let pbs = db.personal_bests().unwrap();
        let k = pbs.iter().find(|p| p.comparison_key == "k").unwrap();
        assert_eq!(k.run_id, "run:c");
        let l = pbs.iter().find(|p| p.comparison_key == "low").unwrap();
        assert_eq!(l.run_id, "run:e");
    }

    #[test]
    fn rejects_bad_runs() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        let mut r = run("run:x", "k", f64::NAN, true);
        assert_eq!(
            db.save_run(&r, None, None, "all").unwrap_err().code,
            "invalid"
        );
        r.score = 1.0;
        r.status = "cancelled".into();
        assert_eq!(
            db.save_run(&r, None, None, "all").unwrap_err().code,
            "invalid"
        );
        r.status = "completed".into();
        r.id = "nope".into();
        assert_eq!(
            db.save_run(&r, None, None, "all").unwrap_err().code,
            "invalid"
        );
    }

    #[test]
    fn newer_schema_is_read_only_and_not_reset() {
        let dir = tempfile::tempdir().unwrap();
        {
            let mut db = Db::open(dir.path()).unwrap();
            db.save_run(&run("run:keep", "k", 1.0, true), None, None, "all")
                .unwrap();
            db.conn.pragma_update(None, "user_version", 99).unwrap();
        }
        let mut db = Db::open(dir.path()).unwrap();
        assert!(db.read_only());
        assert_eq!(db.save_settings("{}").unwrap_err().code, "read_only");
        assert_eq!(
            db.save_run(&run("run:new", "k", 1.0, true), None, None, "all")
                .unwrap_err()
                .code,
            "read_only"
        );
        // data is still there and exportable
        assert_eq!(
            db.query_runs(&RunQuery {
                preset_id: None,
                comparison_key: None,
                valid_only: None,
                limit: 5,
                offset: 0
            })
            .unwrap()
            .total,
            1
        );
        assert!(db.runs_csv(None).unwrap().contains("run:keep"));
        let out = dir.path().join("export.sqlite");
        db.backup_to(&out).unwrap();
        assert!(out.exists());
    }

    #[test]
    fn corrupt_file_opens_read_only() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("aimlite.sqlite"),
            b"this is not a database at all, definitely not",
        )
        .unwrap();
        match Db::open(dir.path()) {
            Ok(db) => assert!(db.read_only()),
            Err(e) => assert!(e.code == "corrupt" || e.code == "io", "{e}"),
        }
        // the original bytes are untouched
        assert!(std::fs::read(dir.path().join("aimlite.sqlite"))
            .unwrap()
            .starts_with(b"this is not"));
    }

    #[test]
    fn retention_keeps_pb_replays() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        db.save_run(
            &run("run:a", "k", 50.0, true),
            Some("{}"),
            Some("full"),
            "all",
        )
        .unwrap();
        db.save_run(
            &run("run:b", "k", 10.0, true),
            Some("{}"),
            Some("full"),
            "all",
        )
        .unwrap();
        db.prune_replays("pb-only").unwrap();
        assert!(db.replay("run:a").unwrap().is_some());
        assert!(db.replay("run:b").unwrap().is_none());
        assert_eq!(
            db.query_runs(&RunQuery {
                preset_id: None,
                comparison_key: None,
                valid_only: None,
                limit: 5,
                offset: 0
            })
            .unwrap()
            .total,
            2
        );
    }

    #[test]
    fn csv_and_reset_with_backup() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        db.save_run(&run("run:a", "k", 50.0, true), None, None, "all")
            .unwrap();
        let csv = db.runs_csv(None).unwrap();
        assert!(csv.contains("\"'=evil\""), "{csv}");
        assert_eq!(csv.lines().count(), 2);
        let b = db.reset("runs").unwrap();
        assert!(b.exists());
        assert_eq!(
            db.query_runs(&RunQuery {
                preset_id: None,
                comparison_key: None,
                valid_only: None,
                limit: 5,
                offset: 0
            })
            .unwrap()
            .total,
            0
        );
        let restored = Db::open(b.parent().unwrap().join("..").as_path());
        assert!(restored.is_ok());
    }

    #[test]
    fn backup_keeps_unrelated_sibling_and_replaces_existing_backup() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        db.save_run(&run("run:wal", "k", 10.0, true), None, None, "all")
            .unwrap();
        let target = dir.path().join("export.sqlite");
        let unrelated = target.with_extension("tmp-aimlite");
        std::fs::write(&unrelated, b"unrelated sentinel").unwrap();
        std::fs::write(&target, b"previous backup").unwrap();
        db.backup_to(&target).unwrap();
        assert_eq!(std::fs::read(&unrelated).unwrap(), b"unrelated sentinel");
        let backup = Connection::open(&target).unwrap();
        let count: i64 = backup
            .query_row("SELECT count(*) FROM runs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        db.backup_to(&dir.path().join("export.tmp-aimlite"))
            .unwrap();
    }

    #[test]
    fn backup_rejects_live_database_sidecars_and_hardlink_aliases() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        let original = std::fs::read(&db.path).unwrap();
        assert!(db.backup_to(&db.path).is_err());
        for suffix in ["-wal", "-shm", "-journal"] {
            let mut name = db.path.as_os_str().to_os_string();
            name.push(suffix);
            assert!(db.backup_to(Path::new(&name)).is_err());
        }
        let alias = dir.path().join("alias.sqlite");
        std::fs::hard_link(&db.path, &alias).unwrap();
        assert!(db.backup_to(&alias).is_err());
        assert_eq!(std::fs::read(&db.path).unwrap(), original);
    }

    #[cfg(windows)]
    #[test]
    fn locked_backup_destination_is_preserved_on_replacement_failure() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        let target = dir.path().join("keep.sqlite");
        std::fs::write(&target, b"previous backup").unwrap();
        let _locked = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&target)
            .unwrap();
        assert!(db.backup_to(&target).is_err());
        drop(_locked);
        assert_eq!(std::fs::read(&target).unwrap(), b"previous backup");
    }

    #[test]
    fn newer_schema_is_opened_with_sqlite_readonly_flags() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("aimlite.sqlite");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch("PRAGMA user_version=99; CREATE TABLE marker (x INTEGER);")
                .unwrap();
        }
        let bytes = std::fs::read(&path).unwrap();
        let db = Db::open(dir.path()).unwrap();
        assert!(db.read_only());
        assert!(db
            .conn
            .execute("INSERT INTO marker VALUES (1)", [])
            .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        let mode: String = db
            .conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode, "delete");
    }

    #[cfg(windows)]
    #[test]
    fn backup_rejects_win32_normalized_names_and_streams() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        for name in [
            "aimlite.sqlite-journal.",
            "aimlite.sqlite-journal ",
            "aimlite.sqlite:copy",
            "AIMLITE.SQLITE-JOURNAL",
        ] {
            assert!(db.backup_to(&dir.path().join(name)).is_err(), "{name}");
        }
        assert!(!dir.path().join("aimlite.sqlite-journal").exists());
    }

    #[test]
    fn wal_fixture_process() {
        let Some(dir) = std::env::var_os("AIMLITE_TEST_WAL_FIXTURE") else {
            return;
        };
        let dir = PathBuf::from(dir);
        let writer = Connection::open(dir.join("aimlite.sqlite")).unwrap();
        writer.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE marker (x); PRAGMA user_version=99; INSERT INTO marker VALUES(7);").unwrap();
        std::fs::write(dir.join("ready"), b"ready").unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        while !dir.join("done").exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        drop(writer);
    }

    #[test]
    fn newer_wal_database_and_sidecars_are_untouched_by_probe() {
        let dir = tempfile::Builder::new()
            .prefix("aimlite #& ")
            .tempdir()
            .unwrap();
        // A separate process avoids SQLite sharing an already-writable SHM mapping with the probe.
        let mut writer = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "db::tests::wal_fixture_process"])
            .env("AIMLITE_TEST_WAL_FIXTURE", dir.path())
            .spawn()
            .unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !dir.path().join("ready").exists() {
            assert!(
                std::time::Instant::now() < deadline,
                "WAL fixture did not start"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let paths: Vec<PathBuf> = ["aimlite.sqlite", "aimlite.sqlite-wal", "aimlite.sqlite-shm"]
            .iter()
            .map(|p| dir.path().join(p))
            .collect();
        let before: Vec<Vec<u8>> = paths.iter().map(|p| std::fs::read(p).unwrap()).collect();
        let incomplete = tempfile::tempdir().unwrap();
        for p in &paths[..2] {
            std::fs::copy(p, incomplete.path().join(p.file_name().unwrap())).unwrap();
        }
        assert!(Db::open(incomplete.path()).is_err());
        assert!(!incomplete.path().join("aimlite.sqlite-shm").exists());
        {
            let db = Db::open(dir.path()).unwrap();
            assert!(db.read_only());
            assert_eq!(db.schema_version, 99);
            assert_eq!(
                db.conn
                    .query_row("SELECT x FROM marker", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                7
            );
        }
        for (p, bytes) in paths.iter().zip(before) {
            assert!(
                std::fs::read(p).unwrap() == bytes,
                "{} changed",
                p.display()
            );
        }
        std::fs::write(dir.path().join("done"), b"done").unwrap();
        assert!(writer.wait().unwrap().success());
    }

    #[test]
    fn invalid_reset_does_not_create_backups_or_modify_runs() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        db.save_run(&run("run:keep", "k", 10.0, true), None, None, "all")
            .unwrap();
        assert!(db.reset("../../unexpected").is_err());
        assert!(!db.backups_dir.exists());
        assert_eq!(
            db.conn
                .query_row("SELECT count(*) FROM runs", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn migration_from_v0_creates_schema() {
        let dir = tempfile::tempdir().unwrap();
        {
            let c = Connection::open(dir.path().join("aimlite.sqlite")).unwrap();
            c.execute_batch("CREATE TABLE unrelated (x INTEGER);")
                .unwrap();
        }
        let db = Db::open(dir.path()).unwrap();
        assert_eq!(db.schema_version, 1);
        assert!(!db.read_only());
    }
}
