//! The library row of an imported EPUB (`import:<sha256>`, docs/IMPORT_EPUB.md).
use rusqlite::{params, Connection};
use tauri::AppHandle;

use super::{now_ms, open_db};

/// The library row of an imported EPUB: on the shelf, always private, dirty (goes up on the
/// next sync) with the import snapshot. A new import (`replace`) overwrites the shelf, privacy
/// and snapshot but keeps the reader's status, rating, favorite and tags; a re-import only
/// creates the row when it is missing.
pub(crate) fn record_import(app: &AppHandle, key: &str, snapshot: &serde_json::Value, replace: bool) -> Result<(), String> {
    record_import_in(&open_db(app)?, key, snapshot, replace, now_ms())
}

pub(super) fn record_import_in(conn: &Connection, key: &str, snapshot: &serde_json::Value, replace: bool, now: i64) -> Result<(), String> {
    let snapshot_json = serde_json::to_string(snapshot)
        .map_err(|err| format!("Não foi possível serializar o livro: {err}"))?;
    let on_conflict = if replace {
        "DO UPDATE SET on_shelf = 1, is_private = 1, hidden = 0, deleted_at = NULL,
            added_at = COALESCE(library_meta.added_at, ?2), changed_at = ?2, dirty = 1,
            snapshot_json = ?3, updated_at = CURRENT_TIMESTAMP"
    } else {
        "DO NOTHING"
    };
    conn.execute(
        &format!(
            "INSERT INTO library_meta (key, on_shelf, is_private, added_at, changed_at, dirty, snapshot_json)
             VALUES (?1, 1, 1, ?2, ?2, 1, ?3) ON CONFLICT(key) {on_conflict}"
        ),
        params![key, now, snapshot_json],
    )
    .map_err(|err| format!("Não foi possível salvar o livro importado: {err}"))?;
    Ok(())
}
