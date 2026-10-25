use serde::Serialize;

/// Structured error returned to the UI. `code` is one of the values the frontend understands
/// (see src/bridge/types.ts) so it can show an actionable message.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AppError {
    pub code: &'static str,
    pub message: String,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid", message)
    }
    pub fn read_only(reason: &str) -> Self {
        Self::new(
            "read_only",
            format!("The database is read-only: {reason}. Export or back up your data before changing anything."),
        )
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        use rusqlite::ErrorCode as C;
        let code = match e.sqlite_error_code() {
            Some(C::DatabaseBusy) | Some(C::DatabaseLocked) => "locked",
            Some(C::ReadOnly) => "read_only",
            Some(C::DiskFull) => "disk_full",
            Some(C::CannotOpen) | Some(C::PermissionDenied) => "permission",
            Some(C::DatabaseCorrupt) | Some(C::NotADatabase) => "corrupt",
            _ => "io",
        };
        AppError::new(code, format!("database error: {e}"))
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        use std::io::ErrorKind as K;
        let code = match e.kind() {
            K::PermissionDenied => "permission",
            K::NotFound => "not_found",
            K::StorageFull => "disk_full",
            _ => "io",
        };
        AppError::new(code, format!("file error: {e}"))
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::invalid(format!("invalid JSON: {e}"))
    }
}
