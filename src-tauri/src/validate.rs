//! Native-side validation: the second trust boundary. The frontend validates too, but nothing
//! reaches SQLite without passing these checks.
use crate::error::{AppError, AppResult};
use serde_json::Value;
use std::sync::OnceLock;

pub const MAX_SETTINGS_BYTES: usize = 64 * 1024;
pub const MAX_ENTITY_BYTES: usize = 64 * 1024;
pub const MAX_RUN_RECORD_BYTES: usize = 512 * 1024;
pub const MAX_REPLAY_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_EXPORT_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_IMPORT_BYTES: u64 = 64 * 1024;

struct FieldDef {
    key: String,
    kind: String,
    min: f64,
    max: f64,
    values: Vec<f64>,
}

fn fields() -> &'static Vec<FieldDef> {
    static F: OnceLock<Vec<FieldDef>> = OnceLock::new();
    F.get_or_init(|| {
        let v: Value = serde_json::from_str(include_str!("../../src/schemas/fields.json"))
            .expect("fields.json is valid");
        v["fields"]
            .as_array()
            .expect("fields array")
            .iter()
            .map(|f| FieldDef {
                key: f["key"].as_str().unwrap_or_default().to_string(),
                kind: f["type"].as_str().unwrap_or_default().to_string(),
                min: f["min"].as_f64().unwrap_or(0.0),
                max: f["max"].as_f64().unwrap_or(0.0),
                values: f["values"]
                    .as_array()
                    .map(|a| a.iter().filter_map(|x| x.as_f64()).collect())
                    .unwrap_or_default(),
            })
            .collect()
    })
}

/// `prefix:` followed by 1–64 lowercase hex/letters/digits/dashes.
pub fn check_id(id: &str, prefix: &str) -> AppResult<()> {
    let rest = id
        .strip_prefix(prefix)
        .and_then(|r| r.strip_prefix(':'))
        .ok_or_else(|| AppError::invalid(format!("id must start with {prefix}:")))?;
    if rest.is_empty()
        || rest.len() > 64
        || !rest
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err(AppError::invalid("invalid id"));
    }
    Ok(())
}

/// Preset ids: official ones are known to the UI only (never stored), custom ones are stored.
pub fn check_preset_ref(id: &str) -> AppResult<()> {
    if id.len() > 80 {
        return Err(AppError::invalid("preset id too long"));
    }
    if id.starts_with("official:") {
        return check_id(id, "official");
    }
    check_id(id, "custom")
}

pub fn parse_json(json: &str, max: usize, what: &str) -> AppResult<Value> {
    if json.len() > max {
        return Err(AppError::invalid(format!(
            "{what} is too large ({} bytes, max {max})",
            json.len()
        )));
    }
    let v: Value = serde_json::from_str(json)?;
    if !v.is_object() {
        return Err(AppError::invalid(format!("{what} must be a JSON object")));
    }
    Ok(v)
}

fn text(v: &Value, key: &str, max_chars: usize, required: bool) -> AppResult<()> {
    match v.get(key) {
        Some(Value::String(s)) => {
            if s.chars().count() > max_chars {
                return Err(AppError::invalid(format!(
                    "{key} is longer than {max_chars} characters"
                )));
            }
            if required && s.trim().is_empty() {
                return Err(AppError::invalid(format!("{key} is required")));
            }
            Ok(())
        }
        None | Some(Value::Null) if !required => Ok(()),
        _ => Err(AppError::invalid(format!("{key} must be text"))),
    }
}

/// A custom preset: id/name/text limits and every gameplay field typed and in bounds.
pub fn check_preset(id: &str, v: &Value) -> AppResult<()> {
    check_id(id, "custom")?;
    if v.get("id").and_then(Value::as_str) != Some(id) {
        return Err(AppError::invalid("preset id mismatch"));
    }
    if v.get("official").and_then(Value::as_bool) != Some(false) {
        return Err(AppError::invalid("official presets are read-only"));
    }
    text(v, "name", 60, true)?;
    text(v, "description", 400, false)?;
    text(v, "category", 40, false)?;
    let cfg = v
        .get("config")
        .and_then(Value::as_object)
        .ok_or_else(|| AppError::invalid("config missing"))?;
    for f in fields() {
        let val = cfg
            .get(&f.key)
            .ok_or_else(|| AppError::invalid(format!("config.{} missing", f.key)))?;
        match f.kind.as_str() {
            "bool" => {
                if !val.is_boolean() {
                    return Err(AppError::invalid(format!(
                        "config.{} must be true/false",
                        f.key
                    )));
                }
            }
            "enum" => {
                let n = val.as_f64().ok_or_else(|| {
                    AppError::invalid(format!("config.{} must be a number", f.key))
                })?;
                if !f.values.contains(&n) {
                    return Err(AppError::invalid(format!(
                        "config.{} has an unsupported value",
                        f.key
                    )));
                }
            }
            _ => {
                let n = val.as_f64().ok_or_else(|| {
                    AppError::invalid(format!("config.{} must be a number", f.key))
                })?;
                if !n.is_finite() || n < f.min || n > f.max {
                    return Err(AppError::invalid(format!(
                        "config.{} is outside {}..{}",
                        f.key, f.min, f.max
                    )));
                }
                if f.kind == "int" && n.fract() != 0.0 {
                    return Err(AppError::invalid(format!(
                        "config.{} must be a whole number",
                        f.key
                    )));
                }
            }
        }
    }
    let known = fields().len() + 1; // + name
    if cfg.len() > known {
        return Err(AppError::invalid("config has unknown fields"));
    }
    Ok(())
}

pub fn check_routine(id: &str, v: &Value) -> AppResult<()> {
    check_id(id, "routine")?;
    text(v, "name", 60, true)?;
    let steps = v
        .get("steps")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::invalid("steps missing"))?;
    if steps.is_empty() || steps.len() > 30 {
        return Err(AppError::invalid("a routine needs 1 to 30 steps"));
    }
    for s in steps {
        let pid = s
            .get("presetId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        check_preset_ref(pid)?;
        let reps = s.get("reps").and_then(Value::as_i64).unwrap_or(0);
        if !(1..=20).contains(&reps) {
            return Err(AppError::invalid("repetitions must be 1 to 20"));
        }
    }
    let rest = v.get("restSeconds").and_then(Value::as_i64).unwrap_or(-1);
    if !(0..=300).contains(&rest) {
        return Err(AppError::invalid("rest must be 0 to 300 seconds"));
    }
    Ok(())
}

pub fn check_profile(id: &str, v: &Value) -> AppResult<()> {
    check_id(id, "profile")?;
    text(v, "name", 60, true)?;
    for (k, n) in [
        ("experience", 80),
        ("gameSensitivity", 40),
        ("display", 80),
        ("notes", 500),
        ("context", 20),
    ] {
        text(v, k, n, false)?;
    }
    Ok(())
}

/// CSV cell for user-supplied text: quoted, quotes doubled, and a leading formula character
/// neutralised with an apostrophe so spreadsheet apps do not evaluate it.
pub fn csv_text(s: &str) -> String {
    let mut t = s.replace(['\r', '\n'], " ");
    if t.starts_with(['=', '+', '-', '@', '\t']) {
        t.insert(0, '\'');
    }
    format!("\"{}\"", t.replace('"', "\"\""))
}

/// Strip anything path-like from a suggested file name.
pub fn safe_file_name(name: &str, ext: &str) -> String {
    let mut s: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ' ' | '.'))
        .take(80)
        .collect();
    s = s.trim_matches(|c: char| c == '.' || c == ' ').to_string();
    if s.is_empty() {
        s = "aimlite".into();
    }
    if !s.to_ascii_lowercase().ends_with(&format!(".{ext}")) {
        s.push('.');
        s.push_str(ext);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids() {
        assert!(check_id("custom:abc-123", "custom").is_ok());
        assert!(check_id("custom:", "custom").is_err());
        assert!(check_id("custom:../x", "custom").is_err());
        assert!(check_id("official:x", "custom").is_err());
        assert!(check_preset_ref("official:pinpoint-pulse").is_ok());
    }

    #[test]
    fn csv_injection() {
        assert_eq!(csv_text("=SUM(A1)"), "\"'=SUM(A1)\"");
        assert_eq!(csv_text("say \"hi\""), "\"say \"\"hi\"\"\"");
        assert_eq!(csv_text("-1"), "\"'-1\"");
        assert_eq!(csv_text("plain"), "\"plain\"");
    }

    #[test]
    fn file_names() {
        assert_eq!(safe_file_name("..\\..\\evil", "json"), "evil.json");
        assert_eq!(safe_file_name("my preset.json", "json"), "my preset.json");
        assert_eq!(safe_file_name("", "csv"), "aimlite.csv");
    }

    #[test]
    fn preset_bounds() {
        let official: Value =
            serde_json::from_str(include_str!("../../src/presets/official.json")).unwrap();
        let mut p = official[0].clone();
        p["id"] = Value::from("custom:test");
        p["official"] = Value::from(false);
        assert!(check_preset("custom:test", &p).is_ok());
        p["config"]["targetsOnStart"] = Value::from(5000);
        assert!(check_preset("custom:test", &p).is_err());
        p["config"]["targetsOnStart"] = Value::from(1.5);
        assert!(check_preset("custom:test", &p).is_err());
        p["config"]["targetsOnStart"] = Value::from(2);
        p["config"]["evil"] = Value::from(1);
        assert!(check_preset("custom:test", &p).is_err());
    }
}
