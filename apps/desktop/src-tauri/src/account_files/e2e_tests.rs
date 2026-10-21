//! End to end against a real local `oghma-accounts` (with moto as S3), with the real EPUBs:
//! import on computer A, upload, library sync, download on computer B, usage, and a tampered
//! object refused. Ignored by default; `backend/scripts/e2e_import_epub.sh` starts the servers,
//! signs in and runs it (docs/IMPORT_EPUB.md, "Teste ponta a ponta local").
//!
//! Env: `OGHMA_E2E_ACCOUNT_URL` (accounts service), `OGHMA_E2E_TOKEN` (session token),
//! `OGHMA_REAL_EPUBS` (folder with the 4 volumes of Unsheathed) and, optionally,
//! `OGHMA_E2E_TMP` (where the two Libraries and their databases go; kept after the run).
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde_json::{json, Value};

use super::download_into_library;
use super::transfer::{transfer_client, upload_book, AccountClient, Progress, Uploaded};
use crate::files::{pick_cover, LOCAL_BOOK_MANIFEST};
use crate::import_epub::{build_preview, commit_items, library_books, sha256_file, ImportCommitItem};
use crate::library_meta::{apply_in, list_meta_in, mark_clean_in, open_db_at, pending_in, LibraryMeta, SyncedKey};
use crate::oghma_account::send;
use crate::staging::STAGING_DIR;

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("{name} is required (see backend/scripts/e2e_import_epub.sh)"))
}

fn png(width: u32, height: u32) -> Vec<u8> {
    let image = image::RgbImage::from_pixel(width, height, image::Rgb([30, 90, 120]));
    let mut out = std::io::Cursor::new(Vec::new());
    image.write_to(&mut out, image::ImageFormat::Png).unwrap();
    out.into_inner()
}

/// A "computer": its Library folder and its `library_meta` database.
struct Computer {
    root: PathBuf,
    db: PathBuf,
}

impl Computer {
    fn new(base: &Path, name: &str) -> Self {
        let root = base.join(name).join("Biblioteca");
        fs::create_dir_all(&root).unwrap();
        // Canonical, like the ExportRoot the app keeps (macOS /var -> /private/var).
        let root = fs::canonicalize(&root).unwrap();
        let db = root.parent().unwrap().join("oghma-library.sqlite");
        Computer { root, db }
    }

    fn conn(&self) -> Connection {
        open_db_at(&self.db).unwrap()
    }

    fn open_db(&self) -> impl Fn() -> Result<Connection, String> + Send + Sync {
        let db = self.db.clone();
        move || open_db_at(&db)
    }

    fn rows(&self) -> Vec<Value> {
        list_meta_in(&self.conn())
            .unwrap()
            .into_iter()
            .map(|row| serde_json::to_value(row).unwrap())
            .filter(|row| row["key"].as_str().unwrap_or_default().starts_with("import:"))
            .collect()
    }

    /// Folders of the Library a person sees (the staging is hidden).
    fn visible_dirs(&self) -> Vec<String> {
        let mut dirs: Vec<String> = fs::read_dir(&self.root)
            .unwrap()
            .flatten()
            .filter(|entry| entry.path().is_dir())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| !name.starts_with('.'))
            .collect();
        dirs.sort();
        dirs
    }
}

/// `{id: series:unsheathed, name: Unsheathed, volume}`; the server may send the volume as 1 or 1.0.
fn assert_unsheathed(series: &Value, volume: usize) {
    assert_eq!(series["id"], "series:unsheathed", "{series}");
    assert_eq!(series["name"], "Unsheathed", "{series}");
    assert_eq!(series["volume"].as_f64(), Some(volume as f64), "{series}");
}

fn marker(dir: &Path) -> Value {
    serde_json::from_slice(&fs::read(dir.join(LOCAL_BOOK_MANIFEST)).unwrap()).unwrap()
}

fn epub_of(dir: &Path) -> PathBuf {
    fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|entry| entry.path())
        .find(|path| path.extension().is_some_and(|ext| ext == "epub"))
        .unwrap_or_else(|| panic!("no .epub in {}", dir.display()))
}

async fn api(client: &AccountClient, method: reqwest::Method, path: &str, body: Option<Value>) -> Value {
    let response = send(&client.http, method, format!("{}{path}", client.base), Some(&client.token), body)
        .await
        .unwrap();
    assert_eq!(response.status, 200, "{path}: {}", response.body);
    response.body
}

/// The real EPUBs, by volume (file name order is volume order).
fn real_epubs() -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(env("OGHMA_REAL_EPUBS"))
        .unwrap()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "epub"))
        .collect();
    files.sort();
    assert_eq!(files.len(), 4, "expected the 4 volumes of Unsheathed");
    files
}

#[test]
#[ignore = "needs the local accounts service + moto; run backend/scripts/e2e_import_epub.sh"]
fn import_upload_sync_and_download_on_another_computer() {
    let base = std::env::var("OGHMA_E2E_TMP")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir())
        .join(format!("run-{}", crate::files::unique_suffix()));
    let client = AccountClient { http: transfer_client(), base: env("OGHMA_E2E_ACCOUNT_URL"), token: env("OGHMA_E2E_TOKEN") };
    let progress = Progress::new(|_, _| {});
    let epubs = real_epubs();
    let originals: Vec<(String, u64)> = epubs.iter().map(|path| sha256_file(path).unwrap()).collect();
    let keys: Vec<String> = originals.iter().map(|(sha, _)| format!("import:{sha}")).collect();

    // a) Computer A: preview + commit, as import_epub_preview / import_epub_commit do.
    let a = Computer::new(&base, "A");
    let ids: Vec<String> = (1..=4).map(|n| format!("f{n}")).collect();
    let path_of = |id: &str| ids.iter().position(|known| known == id).map(|at| epubs[at].clone());
    let previews: Vec<_> = ids
        .iter()
        .map(|id| build_preview(id, &path_of(id).unwrap(), &library_books(&a.root)))
        .collect();
    for (n, preview) in previews.iter().enumerate() {
        assert!(preview.error.is_none(), "{}: {:?}", preview.file_name, preview.error);
        let series = preview.series.as_ref().expect("series from the file name");
        assert_eq!((series.id.as_str(), series.name.as_str(), series.volume), ("series:unsheathed", "Unsheathed", Some((n + 1) as f64)));
        assert_eq!(preview.sha256, originals[n].0);
        assert!(preview.already_imported.is_none());
    }
    let generated = png(6, 9);
    let items: Vec<ImportCommitItem> = previews
        .iter()
        .map(|preview| {
            let series = preview.series.as_ref().unwrap();
            serde_json::from_value(json!({
                "id": preview.id,
                "title": preview.title,
                "author": preview.author,
                "series": { "name": series.name, "volume": series.volume },
                "coverPng": if preview.cover_data_url.is_none() { Some(generated.clone()) } else { None },
            }))
            .unwrap()
        })
        .collect();
    let results = commit_items(Some(&a.root), &items, path_of, a.open_db());
    for (n, result) in results.iter().enumerate() {
        assert!(result.error.is_none(), "commit {}: {:?}", ids[n], result.error);
        assert_eq!(result.key, keys[n]);
    }

    // b) 4 folders with marker, cover and private rows.
    let books = library_books(&a.root);
    assert_eq!(books.len(), 4, "{:?}", a.visible_dirs());
    let mut folders_a = Vec::new();
    for (n, key) in keys.iter().enumerate() {
        let book = books.iter().find(|book| book.novel_id.as_deref() == Some(key.as_str())).expect("book folder");
        let marker = marker(&book.dir);
        assert_unsheathed(&marker["series"], n + 1);
        assert_eq!(marker["origin"], "import");
        assert_eq!(marker["file_sha256"], originals[n].0.as_str());
        assert!(pick_cover(&book.dir).is_some(), "cover in {}", book.dir.display());
        assert_eq!(sha256_file(&epub_of(&book.dir)).unwrap(), originals[n]);
        folders_a.push(book.dir.file_name().unwrap().to_string_lossy().to_string());
    }
    let rows_a = a.rows();
    assert_eq!(rows_a.len(), 4);
    for row in &rows_a {
        assert_eq!((row["private"].as_bool(), row["onShelf"].as_bool()), (Some(true), Some(true)), "{row}");
        assert_eq!(row["snapshot"]["series"]["id"], "series:unsheathed");
    }
    // Importing again finds them: nothing duplicated.
    let again = commit_items(Some(&a.root), &items, path_of, a.open_db());
    assert!(again.iter().all(|result| result.error.is_none()));
    assert_eq!(a.visible_dirs().len(), 4);
    let reviewed = build_preview(&ids[0], &epubs[0], &library_books(&a.root));
    assert!(reviewed.already_imported.is_some());

    tauri::async_runtime::block_on(async {
        // c) Upload through the real transfer code; the second time everything is already there.
        for key in &keys {
            assert_eq!(upload_book(&client, &a.root, key, &progress).await, Ok(Uploaded::Sent), "{key}");
        }
        for key in &keys {
            assert_eq!(upload_book(&client, &a.root, key, &progress).await, Ok(Uploaded::Already), "{key}");
        }

        // d) Push the rows like librarySync.ts (pending -> changes -> mark clean), then pull them
        // into computer B's empty database.
        let pending: Vec<Value> = pending_in(&a.conn()).unwrap().into_iter().map(|row| serde_json::to_value(row).unwrap()).collect();
        assert_eq!(pending.len(), 4);
        let pushed = api(&client, reqwest::Method::POST, "/v1/me/library/changes", Some(json!({ "changes": pending }))).await;
        assert_eq!(pushed["rejected"], json!([]), "{pushed}");
        assert_eq!(pushed["accepted"].as_array().map(Vec::len), Some(4), "{pushed}");
        let accepted: Vec<SyncedKey> = serde_json::from_value(pushed["accepted"].clone()).unwrap();
        assert_eq!(mark_clean_in(&a.conn(), &accepted).unwrap(), 4);
        assert!(pending_in(&a.conn()).unwrap().is_empty());

        let b = Computer::new(&base, "B");
        let pulled = api(&client, reqwest::Method::GET, "/v1/me/library?since=0", None).await;
        let entries: Vec<Value> = pulled["entries"].as_array().unwrap().clone();
        let rows: Vec<LibraryMeta> = entries
            .iter()
            .map(|entry| {
                let mut row = entry.clone();
                row.as_object_mut().unwrap().remove("seq");
                serde_json::from_value(row).unwrap()
            })
            .collect();
        let applied = apply_in(&mut b.conn(), &rows).unwrap();
        assert_eq!(applied.len(), 4, "{pulled}");
        let rows_b = b.rows();
        for (n, key) in keys.iter().enumerate() {
            let row = rows_b.iter().find(|row| row["key"] == key.as_str()).expect("pulled row");
            assert_eq!(row["private"], true, "{row}");
            assert_unsheathed(&row["snapshot"]["series"], n + 1);
            assert_eq!(row["snapshot"]["origin"], "import");
            assert_eq!(row["snapshot"]["fileSize"], originals[n].1);
        }

        // e) Computer B downloads each book (the app passes the row title).
        for (n, key) in keys.iter().enumerate() {
            let row = rows_b.iter().find(|row| row["key"] == key.as_str()).unwrap();
            let title = row["snapshot"]["title"].as_str().unwrap_or_default().to_string();
            let dir = download_into_library(&client, &b.root, b.open_db(), key, &title, &progress).await.unwrap();
            assert_eq!(sha256_file(&epub_of(&dir)).unwrap(), originals[n], "{}", dir.display());
            let marker = marker(&dir);
            assert_eq!(marker["novel_id"], key.as_str());
            assert_unsheathed(&marker["series"], n + 1);
            assert!(pick_cover(&dir).is_some(), "cover in {}", dir.display());
            assert_eq!(dir.file_name().unwrap().to_string_lossy(), folders_a[n].as_str());
        }
        assert_eq!(library_books(&b.root).len(), 4);
        assert_eq!(b.rows().iter().filter(|row| row["onShelf"] == true && row["hidden"] == false).count(), 4);

        // f) Usage: the 4 EPUBs and their 4 covers.
        let covers: u64 = books.iter().map(|book| fs::metadata(pick_cover(&book.dir).unwrap()).unwrap().len()).sum();
        let epub_bytes: u64 = originals.iter().map(|(_, size)| size).sum();
        let usage = client.usage().await.unwrap();
        assert_eq!(usage["files"], 8, "{usage}");
        assert_eq!(usage["usedBytes"], epub_bytes + covers, "{usage}");

        // Negative: the stored EPUB of volume 1 changes (same size, one byte flipped). A third
        // computer must refuse it and leave no folder behind.
        let ticket = api(&client, reqwest::Method::GET, &format!("/v1/me/files/{}?kind=epub", originals[0].0), None).await;
        // moto refuses anonymous writes but does not check signatures: the signed GET URL
        // overwrites the object (only in this test; a real bucket would refuse it).
        let signed = url::Url::parse(ticket["downloadUrl"].as_str().unwrap()).unwrap();
        let mut bytes = fs::read(&epubs[0]).unwrap();
        let at = bytes.len() / 2;
        bytes[at] ^= 0xff;
        let http = reqwest::Client::new();
        let put = http.put(signed.clone()).body(bytes.clone()).send().await.unwrap();
        assert!(put.status().is_success(), "tamper PUT: {}", put.status());
        let stored = http.get(signed.clone()).send().await.unwrap().bytes().await.unwrap();
        assert_eq!(stored.as_ref(), bytes.as_slice(), "moto kept the tampered bytes");

        let c = Computer::new(&base, "C");
        let refused = download_into_library(&client, &c.root, c.open_db(), &keys[0], "Caged Sparrow", &progress).await;
        assert_eq!(refused, Err("sha_mismatch".to_string()));
        assert!(c.visible_dirs().is_empty(), "{:?}", c.visible_dirs());
        assert!(library_books(&c.root).is_empty());
        let staging = c.root.join(STAGING_DIR);
        let left: Vec<_> = fs::read_dir(&staging).map(|dir| dir.flatten().collect()).unwrap_or_default();
        assert!(left.is_empty(), "staging left behind: {left:?}");

        // Put the original back (the account stays consistent for a manual look afterwards).
        let original = fs::read(&epubs[0]).unwrap();
        assert!(http.put(signed).body(original).send().await.unwrap().status().is_success());
    });
    eprintln!("e2e ok: Libraries in {}", base.display());
}
