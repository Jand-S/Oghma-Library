use std::fs;
use std::path::Path;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryMeta {
    key: String,
    favorite: bool,
    reading_status: String,
    tags: Vec<String>,
    hidden: bool,
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Não foi possível localizar dados do app: {err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("Não foi possível criar dados do app: {err}"))?;
    open_db_at(&dir.join("oghma-library.sqlite"))
}

fn open_db_at(db_path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(db_path).map_err(|err| format!("Não foi possível abrir o SQLite: {err}"))?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS library_meta (
            key TEXT PRIMARY KEY,
            favorite INTEGER NOT NULL DEFAULT 0,
            reading_status TEXT NOT NULL DEFAULT 'unread',
            tags_json TEXT NOT NULL DEFAULT '[]',
            hidden INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        "#,
    )
    .map_err(|err| format!("Não foi possível preparar a tabela da biblioteca: {err}"))?;
    Ok(conn)
}

#[tauri::command]
pub fn list_library_meta(app: AppHandle) -> Result<Vec<LibraryMeta>, String> {
    list_meta_in(&open_db(&app)?)
}

fn list_meta_in(conn: &Connection) -> Result<Vec<LibraryMeta>, String> {
    let mut stmt = conn
        .prepare("SELECT key, favorite, reading_status, tags_json, hidden FROM library_meta")
        .map_err(|err| format!("Não foi possível ler os metadados da biblioteca: {err}"))?;
    let rows = stmt
        .query_map([], |row| {
            let tags_json: String = row.get(3)?;
            let tags = serde_json::from_str::<Vec<String>>(&tags_json).unwrap_or_default();
            Ok(LibraryMeta {
                key: row.get(0)?,
                favorite: row.get::<_, i64>(1)? != 0,
                reading_status: row.get(2)?,
                tags,
                hidden: row.get::<_, i64>(4)? != 0,
            })
        })
        .map_err(|err| format!("Não foi possível consultar os metadados da biblioteca: {err}"))?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|err| format!("Metadado de biblioteca inválido: {err}"))?);
    }
    Ok(items)
}

/// Upserts `meta`. Library items with a novel id are keyed `novel:<id>`; when the
/// row used to live under the folder path, pass it as `legacy_key` and it is
/// removed in the same transaction (migration from path keys).
#[tauri::command]
pub fn save_library_meta(app: AppHandle, meta: LibraryMeta, legacy_key: Option<String>) -> Result<(), String> {
    let mut conn = open_db(&app)?;
    save_meta_in(&mut conn, &meta, legacy_key.as_deref())
}

fn save_meta_in(conn: &mut Connection, meta: &LibraryMeta, legacy_key: Option<&str>) -> Result<(), String> {
    let tags_json = serde_json::to_string(&meta.tags)
        .map_err(|err| format!("Não foi possível serializar marcadores: {err}"))?;
    let tx = conn
        .transaction()
        .map_err(|err| format!("Não foi possível salvar metadados da biblioteca: {err}"))?;
    tx.execute(
        r#"
        INSERT INTO library_meta (key, favorite, reading_status, tags_json, hidden, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
            favorite = excluded.favorite,
            reading_status = excluded.reading_status,
            tags_json = excluded.tags_json,
            hidden = excluded.hidden,
            updated_at = CURRENT_TIMESTAMP
        "#,
        params![
            meta.key,
            if meta.favorite { 1 } else { 0 },
            meta.reading_status,
            tags_json,
            if meta.hidden { 1 } else { 0 },
        ],
    )
    .map_err(|err| format!("Não foi possível salvar metadados da biblioteca: {err}"))?;
    if let Some(legacy) = legacy_key.filter(|legacy| *legacy != meta.key) {
        tx.execute("DELETE FROM library_meta WHERE key = ?1", params![legacy])
            .map_err(|err| format!("Não foi possível migrar metadados da biblioteca: {err}"))?;
    }
    tx.commit()
        .map_err(|err| format!("Não foi possível salvar metadados da biblioteca: {err}"))
}

/// Clears `hidden` for existing rows (a re-downloaded book reappears in the library).
pub(crate) fn reset_hidden(app: &AppHandle, keys: &[String]) -> Result<usize, String> {
    reset_hidden_in(&open_db(app)?, keys)
}

fn reset_hidden_in(conn: &Connection, keys: &[String]) -> Result<usize, String> {
    let mut changed = 0;
    for key in keys {
        changed += conn
            .execute(
                "UPDATE library_meta SET hidden = 0, updated_at = CURRENT_TIMESTAMP WHERE key = ?1 AND hidden != 0",
                params![key],
            )
            .map_err(|err| format!("Não foi possível atualizar metadados da biblioteca: {err}"))?;
    }
    Ok(changed)
}

#[tauri::command]
pub fn delete_library_meta(app: AppHandle, key: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute("DELETE FROM library_meta WHERE key = ?1", params![key])
        .map_err(|err| format!("Não foi possível remover metadados da biblioteca: {err}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::test_support::TempDir;

    fn meta(key: &str, hidden: bool) -> LibraryMeta {
        LibraryMeta {
            key: key.to_string(),
            favorite: true,
            reading_status: "reading".to_string(),
            tags: vec!["fav".to_string()],
            hidden,
        }
    }

    #[test]
    fn reset_hidden_unhides_both_keys_without_creating_rows() {
        let dir = TempDir::new("meta");
        let mut conn = open_db_at(&dir.path().join("db.sqlite")).unwrap();
        save_meta_in(&mut conn, &meta("novel:1", true), None).unwrap();
        save_meta_in(&mut conn, &meta("/out/Livro", true), None).unwrap();
        save_meta_in(&mut conn, &meta("novel:2", true), None).unwrap();

        let keys = vec!["novel:1".to_string(), "/out/Livro".to_string(), "novel:404".to_string()];
        assert_eq!(reset_hidden_in(&conn, &keys).unwrap(), 2);
        let rows = list_meta_in(&conn).unwrap();
        assert_eq!(rows.len(), 3);
        for row in rows {
            assert_eq!(row.hidden, row.key == "novel:2", "row {}", row.key);
            assert!(row.favorite);
        }
    }

    #[test]
    fn saving_with_legacy_key_migrates_the_row() {
        let dir = TempDir::new("meta-migrate");
        let mut conn = open_db_at(&dir.path().join("db.sqlite")).unwrap();
        save_meta_in(&mut conn, &meta("/out/Livro", false), None).unwrap();
        save_meta_in(&mut conn, &meta("novel:1", false), Some("/out/Livro")).unwrap();
        let keys: Vec<String> = list_meta_in(&conn).unwrap().into_iter().map(|row| row.key).collect();
        assert_eq!(keys, vec!["novel:1".to_string()]);
    }
}
