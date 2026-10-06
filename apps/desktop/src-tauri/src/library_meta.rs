//! The reader's own data about each book (favorite, reading status, rating, tags, shelf)
//! in `oghma-library.sqlite`. Rows keyed `novel:<id>` are the library itself: a row
//! `on_shelf` shows up even without files on disk, and those rows are what the Oghma
//! account syncs. Every change bumps `changed_at` (ms) and sets `dirty` until the sync
//! confirms the upload; a removal leaves a tombstone (`deleted_at`) so it reaches the
//! other devices instead of coming back from them.

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
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
    /// 1–5 stars; `None` = not rated.
    #[serde(default)]
    rating: Option<u8>,
    /// In the library even without files (the shelf).
    #[serde(default)]
    on_shelf: bool,
    /// When the book entered the library (ms since epoch).
    #[serde(default)]
    added_at: Option<i64>,
    /// Last change (ms since epoch); set by the app when saving.
    #[serde(default)]
    changed_at: Option<i64>,
    /// Set on tombstones (removed from the library); listed so the app can tell
    /// "removed on purpose" from "never added".
    #[serde(default)]
    deleted_at: Option<i64>,
    /// Title, author, source and cover at the time it was added, so the book still shows
    /// when its source leaves the catalog. Opaque JSON for the Rust side.
    #[serde(default)]
    snapshot: Option<serde_json::Value>,
    /// "Só eu vejo": friends do not see this book (profile, activity). Synced.
    #[serde(default)]
    private: bool,
}

const NOVEL_PREFIX: &str = "novel:";

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
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
    migrate(&conn)?;
    Ok(conn)
}

/// Adds the shelf, rating and sync columns to tables created by older versions.
fn migrate(conn: &Connection) -> Result<(), String> {
    let err = |err: rusqlite::Error| format!("Não foi possível atualizar a tabela da biblioteca: {err}");
    let mut stmt = conn.prepare("PRAGMA table_info(library_meta)").map_err(err)?;
    let columns: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(err)?
        .filter_map(Result::ok)
        .collect();
    let added = [
        ("rating", "INTEGER"),
        ("on_shelf", "INTEGER NOT NULL DEFAULT 0"),
        ("added_at", "INTEGER"),
        ("changed_at", "INTEGER NOT NULL DEFAULT 0"),
        ("deleted_at", "INTEGER"),
        ("dirty", "INTEGER NOT NULL DEFAULT 1"),
        ("snapshot_json", "TEXT"),
        ("is_private", "INTEGER NOT NULL DEFAULT 0"),
    ];
    let mut fresh_shelf = false;
    for (name, kind) in added {
        if !columns.iter().any(|column| column == name) {
            conn.execute(&format!("ALTER TABLE library_meta ADD COLUMN {name} {kind}"), [])
                .map_err(err)?;
            fresh_shelf |= name == "on_shelf";
        }
    }
    if fresh_shelf {
        // Books the reader already marked (and did not remove) belong to the library.
        let now = now_ms();
        conn.execute(
            "UPDATE library_meta SET on_shelf = 1, added_at = ?1, changed_at = ?1
             WHERE key LIKE 'novel:%' AND hidden = 0",
            params![now],
        )
        .map_err(err)?;
    }
    Ok(())
}

const SELECT_COLUMNS: &str = "key, favorite, reading_status, tags_json, hidden, rating, on_shelf, added_at, changed_at, deleted_at, snapshot_json, is_private";

fn row_to_meta(row: &rusqlite::Row<'_>) -> rusqlite::Result<LibraryMeta> {
    let tags_json: String = row.get(3)?;
    let snapshot_json: Option<String> = row.get(10)?;
    let changed_at: i64 = row.get(8)?;
    Ok(LibraryMeta {
        key: row.get(0)?,
        favorite: row.get::<_, i64>(1)? != 0,
        reading_status: row.get(2)?,
        tags: serde_json::from_str::<Vec<String>>(&tags_json).unwrap_or_default(),
        hidden: row.get::<_, i64>(4)? != 0,
        rating: row.get::<_, Option<i64>>(5)?.and_then(|value| u8::try_from(value).ok()),
        on_shelf: row.get::<_, i64>(6)? != 0,
        added_at: row.get(7)?,
        changed_at: (changed_at > 0).then_some(changed_at),
        deleted_at: row.get(9)?,
        snapshot: snapshot_json.and_then(|json| serde_json::from_str(&json).ok()),
        private: row.get::<_, i64>(11)? != 0,
    })
}

/// Every row, tombstones included (`deletedAt` set).
#[tauri::command(async)]
pub fn list_library_meta(app: AppHandle) -> Result<Vec<LibraryMeta>, String> {
    list_meta_in(&open_db(&app)?)
}

fn list_meta_in(conn: &Connection) -> Result<Vec<LibraryMeta>, String> {
    let mut stmt = conn
        .prepare(&format!("SELECT {SELECT_COLUMNS} FROM library_meta"))
        .map_err(|err| format!("Não foi possível ler os metadados da biblioteca: {err}"))?;
    let rows = stmt
        .query_map([], row_to_meta)
        .map_err(|err| format!("Não foi possível consultar os metadados da biblioteca: {err}"))?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|err| format!("Metadado de biblioteca inválido: {err}"))?);
    }
    Ok(items)
}

fn clamp_rating(rating: Option<u8>) -> Option<i64> {
    rating.filter(|value| (1..=5).contains(value)).map(i64::from)
}

/// Writes `meta` as-is, with the given `dirty` flag (local edits are dirty; rows coming
/// from the account are not).
fn write_row(conn: &Connection, meta: &LibraryMeta, changed_at: i64, dirty: bool) -> Result<(), String> {
    let tags_json = serde_json::to_string(&meta.tags)
        .map_err(|err| format!("Não foi possível serializar marcadores: {err}"))?;
    let snapshot_json = meta
        .snapshot
        .as_ref()
        .filter(|value| !value.is_null())
        .map(serde_json::to_string)
        .transpose()
        .map_err(|err| format!("Não foi possível serializar o livro: {err}"))?;
    conn.execute(
        r#"
        INSERT INTO library_meta (key, favorite, reading_status, tags_json, hidden, rating, on_shelf,
                                  added_at, changed_at, deleted_at, dirty, snapshot_json, is_private, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
            favorite = excluded.favorite,
            reading_status = excluded.reading_status,
            tags_json = excluded.tags_json,
            hidden = excluded.hidden,
            rating = excluded.rating,
            on_shelf = excluded.on_shelf,
            added_at = COALESCE(excluded.added_at, library_meta.added_at),
            changed_at = excluded.changed_at,
            deleted_at = excluded.deleted_at,
            dirty = excluded.dirty,
            snapshot_json = COALESCE(excluded.snapshot_json, library_meta.snapshot_json),
            is_private = excluded.is_private,
            updated_at = CURRENT_TIMESTAMP
        "#,
        params![
            meta.key,
            if meta.favorite { 1 } else { 0 },
            meta.reading_status,
            tags_json,
            if meta.hidden { 1 } else { 0 },
            clamp_rating(meta.rating),
            if meta.on_shelf { 1 } else { 0 },
            meta.added_at,
            changed_at,
            meta.deleted_at,
            if dirty { 1 } else { 0 },
            snapshot_json,
            if meta.private { 1 } else { 0 },
        ],
    )
    .map_err(|err| format!("Não foi possível salvar metadados da biblioteca: {err}"))?;
    Ok(())
}

/// Upserts `meta`. Library items with a novel id are keyed `novel:<id>`; when the
/// row used to live under the folder path, pass it as `legacy_key` and it is
/// removed in the same transaction (migration from path keys).
#[tauri::command(async)]
pub fn save_library_meta(app: AppHandle, meta: LibraryMeta, legacy_key: Option<String>) -> Result<(), String> {
    let mut conn = open_db(&app)?;
    save_meta_in(&mut conn, &meta, legacy_key.as_deref())
}

fn save_meta_in(conn: &mut Connection, meta: &LibraryMeta, legacy_key: Option<&str>) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|err| format!("Não foi possível salvar metadados da biblioteca: {err}"))?;
    let changed_at = meta.changed_at.filter(|value| *value > 0).unwrap_or_else(now_ms);
    // A save is a live row: it clears any tombstone.
    let live = LibraryMeta { deleted_at: None, ..meta.clone() };
    write_row(&tx, &live, changed_at, true)?;
    if let Some(legacy) = legacy_key.filter(|legacy| *legacy != meta.key) {
        tx.execute("DELETE FROM library_meta WHERE key = ?1", params![legacy])
            .map_err(|err| format!("Não foi possível migrar metadados da biblioteca: {err}"))?;
    }
    tx.commit()
        .map_err(|err| format!("Não foi possível salvar metadados da biblioteca: {err}"))
}

/// A finished download: the book is back in the library (not hidden, on the shelf, no
/// tombstone). Rows that do not exist yet are created by the app with the book snapshot.
pub(crate) fn mark_downloaded(app: &AppHandle, keys: &[String]) -> Result<usize, String> {
    mark_downloaded_in(&open_db(app)?, keys, now_ms())
}

fn mark_downloaded_in(conn: &Connection, keys: &[String], now: i64) -> Result<usize, String> {
    let mut changed = 0;
    for key in keys {
        let shelf = key.starts_with(NOVEL_PREFIX);
        changed += conn
            .execute(
                "UPDATE library_meta SET hidden = 0, deleted_at = NULL,
                    on_shelf = CASE WHEN ?2 THEN 1 ELSE on_shelf END,
                    added_at = COALESCE(added_at, ?3),
                    changed_at = ?3, dirty = 1, updated_at = CURRENT_TIMESTAMP
                 WHERE key = ?1 AND (hidden != 0 OR deleted_at IS NOT NULL OR (?2 AND on_shelf = 0))",
                params![key, shelf, now],
            )
            .map_err(|err| format!("Não foi possível atualizar metadados da biblioteca: {err}"))?;
    }
    Ok(changed)
}

/// Removes a book from the library. `novel:` rows become tombstones (synced to every device);
/// status, rating, favorite, tags and the snapshot stay in the row, so bringing the book back
/// restores them. Folder-path rows are local only and are deleted outright.
#[tauri::command(async)]
pub fn delete_library_meta(app: AppHandle, key: String) -> Result<(), String> {
    delete_meta_in(&open_db(&app)?, &key, now_ms())
}

fn delete_meta_in(conn: &Connection, key: &str, now: i64) -> Result<(), String> {
    let err = |err: rusqlite::Error| format!("Não foi possível remover metadados da biblioteca: {err}");
    if key.starts_with(NOVEL_PREFIX) {
        conn.execute(
            "INSERT INTO library_meta (key, deleted_at, changed_at, dirty) VALUES (?1, ?2, ?2, 1)
             ON CONFLICT(key) DO UPDATE SET hidden = 0, on_shelf = 0, deleted_at = ?2, changed_at = ?2,
                dirty = 1, updated_at = CURRENT_TIMESTAMP",
            params![key, now],
        )
        .map_err(err)?;
    } else {
        conn.execute("DELETE FROM library_meta WHERE key = ?1", params![key]).map_err(err)?;
    }
    Ok(())
}

// ---------- Account sync ----------

/// Rows waiting to be uploaded (only `novel:` keys sync).
#[tauri::command(async)]
pub fn library_sync_pending(app: AppHandle) -> Result<Vec<LibraryMeta>, String> {
    pending_in(&open_db(&app)?)
}

fn pending_in(conn: &Connection) -> Result<Vec<LibraryMeta>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {SELECT_COLUMNS} FROM library_meta WHERE dirty = 1 AND key LIKE 'novel:%' ORDER BY changed_at"
        ))
        .map_err(|err| format!("Não foi possível ler as alterações da biblioteca: {err}"))?;
    let rows = stmt
        .query_map([], row_to_meta)
        .map_err(|err| format!("Não foi possível ler as alterações da biblioteca: {err}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Metadado de biblioteca inválido: {err}"))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncedKey {
    key: String,
    changed_at: i64,
}

/// Clears `dirty` for rows the server accepted, unless they changed again since.
#[tauri::command(async)]
pub fn library_sync_mark_clean(app: AppHandle, entries: Vec<SyncedKey>) -> Result<usize, String> {
    mark_clean_in(&open_db(&app)?, &entries)
}

fn mark_clean_in(conn: &Connection, entries: &[SyncedKey]) -> Result<usize, String> {
    let mut changed = 0;
    for entry in entries {
        changed += conn
            .execute(
                "UPDATE library_meta SET dirty = 0 WHERE key = ?1 AND changed_at = ?2",
                params![entry.key, entry.changed_at],
            )
            .map_err(|err| format!("Não foi possível marcar a sincronização: {err}"))?;
    }
    Ok(changed)
}

/// Applies rows from the account: the newest `changedAt` wins, per book. A local row
/// that changed later (still dirty) is kept and goes up on the next push.
/// Returns the keys that changed here (the app tells the reader about books removed elsewhere).
#[tauri::command(async)]
pub fn library_sync_apply(app: AppHandle, rows: Vec<LibraryMeta>) -> Result<Vec<String>, String> {
    let mut conn = open_db(&app)?;
    apply_in(&mut conn, &rows)
}

fn apply_in(conn: &mut Connection, rows: &[LibraryMeta]) -> Result<Vec<String>, String> {
    let tx = conn
        .transaction()
        .map_err(|err| format!("Não foi possível aplicar a sincronização: {err}"))?;
    let mut applied = Vec::new();
    for remote in rows.iter().filter(|row| row.key.starts_with(NOVEL_PREFIX)) {
        let remote_changed = remote.changed_at.unwrap_or(0);
        let local: Option<(i64, i64)> = tx
            .query_row(
                "SELECT changed_at, hidden FROM library_meta WHERE key = ?1",
                params![remote.key],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|err| format!("Não foi possível aplicar a sincronização: {err}"))?;
        if let Some((local_changed, _)) = local {
            if local_changed >= remote_changed {
                continue;
            }
        }
        // `hidden` is per device (files kept on this disk): keep the local value.
        let hidden = local.map(|(_, hidden)| hidden != 0).unwrap_or(false);
        let row = LibraryMeta { hidden, ..remote.clone() };
        write_row(&tx, &row, remote_changed, false)?;
        applied.push(remote.key.clone());
    }
    tx.commit()
        .map_err(|err| format!("Não foi possível aplicar a sincronização: {err}"))?;
    Ok(applied)
}

/// Marks every book row for upload (after signing in: the local library joins the account).
#[tauri::command(async)]
pub fn library_sync_mark_all_dirty(app: AppHandle) -> Result<usize, String> {
    open_db(&app)?
        .execute("UPDATE library_meta SET dirty = 1 WHERE key LIKE 'novel:%'", [])
        .map_err(|err| format!("Não foi possível preparar a sincronização: {err}"))
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
            rating: None,
            on_shelf: false,
            added_at: None,
            changed_at: None,
            deleted_at: None,
            snapshot: None,
            private: false,
        }
    }

    fn open(label: &str) -> (TempDir, Connection) {
        let dir = TempDir::new(label);
        let conn = open_db_at(&dir.path().join("db.sqlite")).unwrap();
        (dir, conn)
    }

    fn row(conn: &Connection, key: &str) -> LibraryMeta {
        list_meta_in(conn).unwrap().into_iter().find(|row| row.key == key).unwrap()
    }

    #[test]
    fn mark_downloaded_unhides_both_keys_without_creating_rows() {
        let (_dir, mut conn) = open("meta");
        save_meta_in(&mut conn, &meta("novel:1", true), None).unwrap();
        save_meta_in(&mut conn, &meta("/out/Livro", true), None).unwrap();
        save_meta_in(&mut conn, &meta("novel:2", true), None).unwrap();

        let keys = vec!["novel:1".to_string(), "/out/Livro".to_string(), "novel:404".to_string()];
        assert_eq!(mark_downloaded_in(&conn, &keys, 99).unwrap(), 2);
        let rows = list_meta_in(&conn).unwrap();
        assert_eq!(rows.len(), 3);
        for row in rows {
            assert_eq!(row.hidden, row.key == "novel:2", "row {}", row.key);
            assert!(row.favorite);
        }
        assert!(row(&conn, "novel:1").on_shelf);
        assert!(!row(&conn, "/out/Livro").on_shelf);
    }

    #[test]
    fn saving_with_legacy_key_migrates_the_row() {
        let (_dir, mut conn) = open("meta-migrate");
        save_meta_in(&mut conn, &meta("/out/Livro", false), None).unwrap();
        save_meta_in(&mut conn, &meta("novel:1", false), Some("/out/Livro")).unwrap();
        let keys: Vec<String> = list_meta_in(&conn).unwrap().into_iter().map(|row| row.key).collect();
        assert_eq!(keys, vec!["novel:1".to_string()]);
    }

    #[test]
    fn old_tables_gain_the_new_columns_and_keep_their_books_on_the_shelf() {
        let dir = TempDir::new("meta-old");
        let path = dir.path().join("db.sqlite");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE library_meta (key TEXT PRIMARY KEY, favorite INTEGER NOT NULL DEFAULT 0,
                 reading_status TEXT NOT NULL DEFAULT 'unread', tags_json TEXT NOT NULL DEFAULT '[]',
                 hidden INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
                 INSERT INTO library_meta (key, favorite) VALUES ('novel:a', 1);
                 INSERT INTO library_meta (key, hidden) VALUES ('novel:b', 1);
                 INSERT INTO library_meta (key) VALUES ('/out/Local');",
            )
            .unwrap();
        }
        let conn = open_db_at(&path).unwrap();
        assert!(row(&conn, "novel:a").on_shelf);
        assert!(!row(&conn, "novel:b").on_shelf);
        assert!(!row(&conn, "/out/Local").on_shelf);
        // Opening again does not re-run the shelf backfill.
        drop(conn);
        let conn = open_db_at(&path).unwrap();
        assert!(!row(&conn, "novel:b").on_shelf);
    }

    #[test]
    fn rating_snapshot_and_shelf_round_trip() {
        let (_dir, mut conn) = open("meta-rating");
        let snapshot = serde_json::json!({ "title": "Shadow Slave", "sourceId": "central-novel" });
        let saved = LibraryMeta { rating: Some(5), on_shelf: true, added_at: Some(10), snapshot: Some(snapshot.clone()), ..meta("novel:s", false) };
        save_meta_in(&mut conn, &saved, None).unwrap();
        let loaded = row(&conn, "novel:s");
        assert_eq!(loaded.rating, Some(5));
        assert!(loaded.on_shelf);
        assert_eq!(loaded.added_at, Some(10));
        assert_eq!(loaded.snapshot, Some(snapshot.clone()));
        // Out-of-range ratings are dropped; a save without snapshot keeps the old one.
        let again = LibraryMeta { rating: Some(9), snapshot: None, added_at: None, ..saved };
        save_meta_in(&mut conn, &again, None).unwrap();
        let loaded = row(&conn, "novel:s");
        assert_eq!(loaded.rating, None);
        assert_eq!(loaded.snapshot, Some(snapshot));
        assert_eq!(loaded.added_at, Some(10));
    }

    #[test]
    fn private_flag_round_trips() {
        let (_dir, mut conn) = open("meta-private");
        save_meta_in(&mut conn, &LibraryMeta { private: true, on_shelf: true, ..meta("novel:p", false) }, None).unwrap();
        assert!(row(&conn, "novel:p").private);
        save_meta_in(&mut conn, &LibraryMeta { private: false, on_shelf: true, ..meta("novel:p", false) }, None).unwrap();
        assert!(!row(&conn, "novel:p").private);
    }

    #[test]
    fn deleting_a_book_leaves_a_dirty_tombstone_and_saving_revives_it() {
        let (_dir, mut conn) = open("meta-tomb");
        save_meta_in(&mut conn, &LibraryMeta { on_shelf: true, ..meta("novel:t", false) }, None).unwrap();
        save_meta_in(&mut conn, &meta("/out/Local", false), None).unwrap();
        delete_meta_in(&conn, "novel:t", 500).unwrap();
        delete_meta_in(&conn, "/out/Local", 500).unwrap();
        let rows = list_meta_in(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        let tomb = &rows[0];
        assert_eq!(tomb.deleted_at, Some(500));
        assert!(!tomb.on_shelf);
        // What the reader marked stays, so bringing the book back restores it.
        assert!(tomb.favorite);
        assert_eq!(tomb.reading_status, "reading");
        assert_eq!(pending_in(&conn).unwrap().len(), 1);

        save_meta_in(&mut conn, &LibraryMeta { on_shelf: true, changed_at: Some(600), ..meta("novel:t", false) }, None).unwrap();
        let revived = row(&conn, "novel:t");
        assert_eq!(revived.deleted_at, None);
        assert_eq!(revived.changed_at, Some(600));
    }

    #[test]
    fn sync_apply_keeps_the_newest_change_and_the_local_hidden_flag() {
        let (_dir, mut conn) = open("meta-sync");
        save_meta_in(&mut conn, &LibraryMeta { changed_at: Some(200), ..meta("novel:local-newer", true) }, None).unwrap();
        save_meta_in(&mut conn, &LibraryMeta { changed_at: Some(100), ..meta("novel:remote-newer", true) }, None).unwrap();

        let remote = |key: &str, changed: i64| LibraryMeta {
            favorite: false,
            rating: Some(4),
            on_shelf: true,
            changed_at: Some(changed),
            ..meta(key, false)
        };
        let applied = apply_in(
            &mut conn,
            &[remote("novel:local-newer", 150), remote("novel:remote-newer", 300), remote("novel:new", 50), remote("/out/x", 999)],
        )
        .unwrap();
        assert_eq!(applied, vec!["novel:remote-newer".to_string(), "novel:new".to_string()]);

        let kept = row(&conn, "novel:local-newer");
        assert!(kept.favorite && kept.rating.is_none());
        let taken = row(&conn, "novel:remote-newer");
        assert_eq!(taken.rating, Some(4));
        assert!(taken.hidden, "hidden is per device");
        assert!(row(&conn, "novel:new").on_shelf);
        assert!(list_meta_in(&conn).unwrap().iter().all(|row| row.key != "/out/x"));

        // Remote rows are clean; the locally newer one is still waiting to go up.
        let pending: Vec<String> = pending_in(&conn).unwrap().into_iter().map(|row| row.key).collect();
        assert_eq!(pending, vec!["novel:local-newer".to_string()]);
    }

    #[test]
    fn mark_clean_skips_rows_changed_after_the_upload() {
        let (_dir, mut conn) = open("meta-clean");
        save_meta_in(&mut conn, &LibraryMeta { changed_at: Some(10), ..meta("novel:a", false) }, None).unwrap();
        save_meta_in(&mut conn, &LibraryMeta { changed_at: Some(10), ..meta("novel:b", false) }, None).unwrap();
        save_meta_in(&mut conn, &LibraryMeta { changed_at: Some(20), ..meta("novel:b", false) }, None).unwrap();
        let entries = vec![
            SyncedKey { key: "novel:a".into(), changed_at: 10 },
            SyncedKey { key: "novel:b".into(), changed_at: 10 },
        ];
        assert_eq!(mark_clean_in(&conn, &entries).unwrap(), 1);
        let pending: Vec<String> = pending_in(&conn).unwrap().into_iter().map(|row| row.key).collect();
        assert_eq!(pending, vec!["novel:b".to_string()]);
    }
}
