//! `import:` rows (docs/IMPORT_EPUB.md): created by the import and synced like `novel:` rows.
use super::imports::{live_snapshot_in, record_import_in};
use super::*;
use crate::files::test_support::TempDir;

const KEY: &str = "import:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

fn open(label: &str) -> (TempDir, Connection) {
    let dir = TempDir::new(label);
    let conn = open_db_at(&dir.path().join("db.sqlite")).unwrap();
    (dir, conn)
}

fn row(conn: &Connection, key: &str) -> Option<LibraryMeta> {
    list_meta_in(conn).unwrap().into_iter().find(|row| row.key == key)
}

fn plain(key: &str, changed_at: i64) -> LibraryMeta {
    LibraryMeta {
        key: key.to_string(),
        favorite: false,
        reading_status: "unread".to_string(),
        tags: Vec::new(),
        hidden: false,
        rating: None,
        on_shelf: true,
        added_at: Some(changed_at),
        changed_at: Some(changed_at),
        deleted_at: None,
        snapshot: None,
        private: false,
    }
}

fn dirty_keys(conn: &Connection) -> Vec<String> {
    let mut keys: Vec<String> = pending_in(conn).unwrap().into_iter().map(|row| row.key).collect();
    keys.sort();
    keys
}

#[test]
fn import_row_is_on_the_shelf_private_dirty_with_the_snapshot() {
    let (_dir, conn) = open("meta-import");
    let snapshot = serde_json::json!({ "title": "Caged Sparrow", "origin": "import", "fileSize": 10 });
    record_import_in(&conn, KEY, &snapshot, true, 500).unwrap();

    let saved = row(&conn, KEY).unwrap();
    assert!(saved.on_shelf && saved.private && !saved.hidden);
    assert_eq!((saved.added_at, saved.changed_at, saved.deleted_at), (Some(500), Some(500), None));
    assert_eq!(saved.snapshot, Some(snapshot));
    assert_eq!(dirty_keys(&conn), vec![KEY.to_string()]);
}

#[test]
fn reimport_keeps_the_row_and_a_new_import_keeps_the_readers_data() {
    let (_dir, mut conn) = open("meta-reimport");
    let first = serde_json::json!({ "title": "Antes" });
    record_import_in(&conn, KEY, &first, true, 100).unwrap();
    // The reader rated it and marked it reading; then removed it (tombstone).
    let edited = LibraryMeta {
        reading_status: "reading".to_string(),
        rating: Some(4),
        private: true,
        added_at: None,
        ..plain(KEY, 200)
    };
    save_meta_in(&mut conn, &edited, None).unwrap();

    // Re-import of a book already in the library: the row is not touched.
    record_import_in(&conn, KEY, &serde_json::json!({ "title": "Outro" }), false, 300).unwrap();
    assert_eq!(row(&conn, KEY).unwrap().snapshot, Some(first));
    assert_eq!(row(&conn, KEY).unwrap().changed_at, Some(200));

    delete_meta_in(&conn, KEY, 400).unwrap();
    assert_eq!(row(&conn, KEY).unwrap().deleted_at, Some(400), "import rows leave a tombstone");

    let second = serde_json::json!({ "title": "Depois" });
    record_import_in(&conn, KEY, &second, true, 500).unwrap();
    let saved = row(&conn, KEY).unwrap();
    assert_eq!((saved.deleted_at, saved.changed_at, saved.added_at), (None, Some(500), Some(100)));
    assert!(saved.on_shelf && saved.private);
    assert_eq!((saved.reading_status.as_str(), saved.rating), ("reading", Some(4)));
    assert_eq!(saved.snapshot, Some(second));
}

#[test]
fn reimport_creates_a_missing_row() {
    let (_dir, conn) = open("meta-reimport-missing");
    record_import_in(&conn, KEY, &serde_json::json!({ "title": "X" }), false, 100).unwrap();
    let saved = row(&conn, KEY).unwrap();
    assert!(saved.on_shelf && saved.private);
}

#[test]
fn sync_filters_take_novel_and_import_keys_but_not_folder_paths() {
    let (_dir, mut conn) = open("meta-import-sync");
    for key in ["novel:1", KEY, "/out/Livro"] {
        save_meta_in(&mut conn, &plain(key, 100), None).unwrap();
    }
    assert_eq!(dirty_keys(&conn), vec![KEY.to_string(), "novel:1".to_string()]);

    mark_clean_in(
        &conn,
        &[
            SyncedKey { key: "novel:1".to_string(), changed_at: 100 },
            SyncedKey { key: KEY.to_string(), changed_at: 100 },
            SyncedKey { key: "/out/Livro".to_string(), changed_at: 100 },
        ],
    )
    .unwrap();
    assert!(dirty_keys(&conn).is_empty());
    assert_eq!(mark_all_dirty_in(&conn).unwrap(), 2, "folder-path rows stay local");
    assert_eq!(dirty_keys(&conn), vec![KEY.to_string(), "novel:1".to_string()]);

    let other = "import:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    let remote = vec![
        LibraryMeta { private: true, ..plain(other, 900) },
        plain("novel:2", 900),
        plain("/elsewhere/Livro", 900),
    ];
    let mut applied = apply_in(&mut conn, &remote).unwrap();
    applied.sort();
    assert_eq!(applied, vec![other.to_string(), "novel:2".to_string()]);
    assert!(row(&conn, other).unwrap().private);
    assert!(row(&conn, "/elsewhere/Livro").is_none());
}

#[test]
fn mark_downloaded_puts_an_import_row_back_on_the_shelf() {
    let (_dir, mut conn) = open("meta-import-download");
    save_meta_in(&mut conn, &LibraryMeta { on_shelf: false, ..plain(KEY, 100) }, None).unwrap();
    assert_eq!(mark_downloaded_in(&conn, &[KEY.to_string()], 200).unwrap(), 1);
    assert!(row(&conn, KEY).unwrap().on_shelf);
}

#[test]
fn live_snapshot_reads_the_row_until_it_is_removed() {
    let (_dir, conn) = open("import-snapshot");
    assert_eq!(live_snapshot_in(&conn, KEY).unwrap(), None);
    let snapshot = serde_json::json!({ "title": "Caged Sparrow", "origin": "import" });
    record_import_in(&conn, KEY, &snapshot, true, 100).unwrap();
    assert_eq!(live_snapshot_in(&conn, KEY).unwrap(), Some(snapshot));
    delete_meta_in(&conn, KEY, 200).unwrap();
    assert_eq!(live_snapshot_in(&conn, KEY).unwrap(), None, "a tombstone has no live snapshot");
}
