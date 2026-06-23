use std::fs;

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
        .map_err(|err| format!("Nao foi possivel localizar dados do app: {err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("Nao foi possivel criar dados do app: {err}"))?;
    let db_path = dir.join("oghma-library.sqlite");
    let conn = Connection::open(db_path).map_err(|err| format!("Nao foi possivel abrir o SQLite: {err}"))?;
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
    .map_err(|err| format!("Nao foi possivel preparar a tabela da biblioteca: {err}"))?;
    Ok(conn)
}

#[tauri::command]
pub fn list_library_meta(app: AppHandle) -> Result<Vec<LibraryMeta>, String> {
    let conn = open_db(&app)?;
    let mut stmt = conn
        .prepare("SELECT key, favorite, reading_status, tags_json, hidden FROM library_meta")
        .map_err(|err| format!("Nao foi possivel ler os metadados da biblioteca: {err}"))?;
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
        .map_err(|err| format!("Nao foi possivel consultar os metadados da biblioteca: {err}"))?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|err| format!("Metadado de biblioteca invalido: {err}"))?);
    }
    Ok(items)
}

#[tauri::command]
pub fn save_library_meta(app: AppHandle, meta: LibraryMeta) -> Result<(), String> {
    let conn = open_db(&app)?;
    let tags_json = serde_json::to_string(&meta.tags)
        .map_err(|err| format!("Nao foi possivel serializar marcadores: {err}"))?;
    conn.execute(
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
    .map_err(|err| format!("Nao foi possivel salvar metadados da biblioteca: {err}"))?;
    Ok(())
}

#[tauri::command]
pub fn delete_library_meta(app: AppHandle, key: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute("DELETE FROM library_meta WHERE key = ?1", params![key])
        .map_err(|err| format!("Nao foi possivel remover metadados da biblioteca: {err}"))?;
    Ok(())
}
