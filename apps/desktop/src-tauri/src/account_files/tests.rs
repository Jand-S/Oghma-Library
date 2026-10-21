//! Account files against a fake local server: the account API and the presigned URLs.
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::transfer::{download_book, upload_book, AccountClient, Progress, Uploaded};
use crate::files::test_support::TempDir;
use crate::files::LOCAL_BOOK_MANIFEST;

/// One request as the fake server saw it (header names in lower case).
#[derive(Debug, Clone)]
struct Seen {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Seen {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(key, _)| key == name).map(|(_, value)| value.as_str())
    }

    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }
}

type Handler = dyn Fn(&Seen, &str) -> (u16, Vec<u8>) + Send + Sync;

/// Starts a fake HTTP/1.1 server; `handler(request, base_url)` answers each request.
async fn serve(handler: Arc<Handler>) -> (String, Arc<Mutex<Vec<Seen>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let (log, url) = (Arc::clone(&seen), base.clone());
    tauri::async_runtime::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else { return };
            let (log, url, handler) = (Arc::clone(&log), url.clone(), Arc::clone(&handler));
            tauri::async_runtime::spawn(async move {
                let mut raw = Vec::new();
                let mut buf = vec![0u8; 64 * 1024];
                let head_end = loop {
                    let read = socket.read(&mut buf).await.unwrap_or(0);
                    if read == 0 {
                        return;
                    }
                    raw.extend_from_slice(&buf[..read]);
                    if let Some(at) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                        break at + 4;
                    }
                };
                let head = String::from_utf8_lossy(&raw[..head_end]).to_string();
                let mut lines = head.lines();
                let mut first = lines.next().unwrap_or_default().split(' ');
                let (method, path) = (first.next().unwrap_or_default().to_string(), first.next().unwrap_or_default().to_string());
                let headers: Vec<(String, String)> = lines
                    .filter_map(|line| line.split_once(':'))
                    .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_string()))
                    .collect();
                let length = headers
                    .iter()
                    .find(|(name, _)| name == "content-length")
                    .and_then(|(_, value)| value.parse::<usize>().ok())
                    .unwrap_or(0);
                while raw.len() < head_end + length {
                    let read = socket.read(&mut buf).await.unwrap_or(0);
                    if read == 0 {
                        break;
                    }
                    raw.extend_from_slice(&buf[..read]);
                }
                let request = Seen { method, path, headers, body: raw[head_end..].to_vec() };
                let (status, body) = handler(&request, &url);
                log.lock().unwrap().push(request);
                let head = format!(
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = socket.write_all(head.as_bytes()).await;
                let _ = socket.write_all(&body).await;
            });
        }
    });
    (base, seen)
}

fn reply(value: Value) -> (u16, Vec<u8>) {
    (200, serde_json::to_vec(&value).unwrap())
}

fn sha_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// More than one upload chunk, not all the same byte.
fn epub_bytes() -> Vec<u8> {
    (0..600_000u32).map(|i| (i.wrapping_mul(31) % 251) as u8).collect()
}

fn client(base: &str) -> AccountClient {
    AccountClient { http: reqwest::Client::new(), base: base.to_string(), token: "tok".to_string() }
}

/// A recorder of `(sent, total)` progress reports.
fn recorder() -> (Arc<Progress>, Arc<Mutex<Vec<(u64, u64)>>>) {
    let reports = Arc::new(Mutex::new(Vec::new()));
    let log = Arc::clone(&reports);
    (Progress::new(move |sent, total| log.lock().unwrap().push((sent, total))), reports)
}

/// A Library book folder of an import: marker, EPUB and (optionally) a cover. Returns the key.
fn make_book(root: &Path, name: &str, epub: &[u8], cover: Option<&[u8]>) -> String {
    let key = format!("import:{}", sha_hex(epub));
    let dir = root.join(name);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(LOCAL_BOOK_MANIFEST), json!({ "novel_id": key }).to_string()).unwrap();
    fs::write(dir.join(format!("{name}.epub")), epub).unwrap();
    if let Some(cover) = cover {
        fs::write(dir.join("cover.jpg"), cover).unwrap();
    }
    key
}

#[test]
fn upload_streams_both_files_to_the_presigned_urls_and_confirms() {
    tauri::async_runtime::block_on(async {
        let root = TempDir::new("files-upload");
        let epub = epub_bytes();
        let cover = b"\xff\xd8\xff fake jpeg".to_vec();
        let key = make_book(root.path(), "Caged Sparrow", &epub, Some(&cover));
        let sha = sha_hex(&epub);
        let (base, seen) = serve(Arc::new(|request: &Seen, base: &str| match (request.method.as_str(), request.path.as_str()) {
            ("POST", "/v1/me/files") => {
                let kind = request.json()["kind"].as_str().unwrap_or_default().to_string();
                reply(json!({
                    "exists": false,
                    "uploadUrl": format!("{base}/bucket/{kind}?X-Signature=abc"),
                    "method": "PUT",
                    "headers": { "Content-Type": if kind == "epub" { "application/epub+zip" } else { "image/jpeg" } },
                    "expiresIn": 900,
                }))
            }
            ("PUT", _) => (200, Vec::new()),
            ("POST", path) if path.ends_with("/confirm") => reply(json!({ "ok": true })),
            _ => (500, Vec::new()),
        }))
        .await;
        let (progress, reports) = recorder();

        let done = upload_book(&client(&base), root.path(), &key, &progress).await;
        assert_eq!(done, Ok(Uploaded::Sent));

        let seen = seen.lock().unwrap().clone();
        let steps: Vec<(&str, &str)> = seen.iter().map(|r| (r.method.as_str(), r.path.as_str())).collect();
        let confirm = format!("/v1/me/files/{sha}/confirm");
        assert_eq!(steps, vec![
            ("POST", "/v1/me/files"),
            ("POST", "/v1/me/files"),
            ("PUT", "/bucket/epub?X-Signature=abc"),
            ("POST", confirm.as_str()),
            ("PUT", "/bucket/cover?X-Signature=abc"),
            ("POST", confirm.as_str()),
        ]);
        assert_eq!(seen[0].json(), json!({ "sha256": sha, "kind": "epub", "ext": "epub", "size": epub.len() }));
        assert_eq!(seen[1].json(), json!({ "sha256": sha, "kind": "cover", "ext": "jpg", "size": cover.len() }));
        assert_eq!((seen[3].json(), seen[5].json()), (json!({ "kind": "epub" }), json!({ "kind": "cover" })));
        for api in [&seen[0], &seen[1], &seen[3], &seen[5]] {
            assert_eq!(api.header("authorization"), Some("Bearer tok"));
        }
        for (put, bytes, mime) in [(&seen[2], &epub, "application/epub+zip"), (&seen[4], &cover, "image/jpeg")] {
            assert_eq!(&put.body, bytes);
            assert_eq!(put.header("content-length"), Some(bytes.len().to_string().as_str()));
            assert_eq!(put.header("transfer-encoding"), None, "presigned PUTs are not chunked");
            assert_eq!(put.header("authorization"), None, "the session token never goes to the bucket");
            assert_eq!(put.header("content-type"), Some(mime));
        }
        let reports = reports.lock().unwrap().clone();
        let total = (epub.len() + cover.len()) as u64;
        assert_eq!(reports.first(), Some(&(0, total)));
        assert_eq!(reports.last(), Some(&(total, total)));
        assert!(reports.len() > 3, "the EPUB goes up in chunks: {reports:?}");
    });
}

#[test]
fn upload_sends_nothing_when_the_account_already_has_the_files() {
    tauri::async_runtime::block_on(async {
        let root = TempDir::new("files-already");
        let key = make_book(root.path(), "Book", b"epub bytes", Some(b"cover"));
        let (base, seen) = serve(Arc::new(|_: &Seen, _: &str| reply(json!({ "exists": true })))).await;
        let (progress, reports) = recorder();

        assert_eq!(upload_book(&client(&base), root.path(), &key, &progress).await, Ok(Uploaded::Already));
        let paths: Vec<String> = seen.lock().unwrap().iter().map(|r| format!("{} {}", r.method, r.path)).collect();
        assert_eq!(paths, vec!["POST /v1/me/files", "POST /v1/me/files"]);
        assert!(reports.lock().unwrap().is_empty());
    });
}

#[test]
fn upload_passes_the_server_error_code_on() {
    tauri::async_runtime::block_on(async {
        let root = TempDir::new("files-quota");
        let key = make_book(root.path(), "Book", b"epub bytes", None);
        let (base, _) = serve(Arc::new(|_: &Seen, _: &str| {
            (409, br#"{"error":"quota_exceeded","usedBytes":1,"quotaBytes":1}"#.to_vec())
        }))
        .await;
        let (progress, _) = recorder();
        let done = upload_book(&client(&base), root.path(), &key, &progress).await;
        assert_eq!(done, Err("quota_exceeded".to_string()));
    });
}

#[cfg(unix)]
#[test]
fn upload_refuses_files_outside_the_library() {
    tauri::async_runtime::block_on(async {
        let root = TempDir::new("files-root");
        let outside = TempDir::new("files-outside");
        let (base, seen) = serve(Arc::new(|_: &Seen, _: &str| reply(json!({ "exists": true })))).await;
        let (progress, _) = recorder();

        // The EPUB of a Library folder is a link to a file elsewhere.
        let secret = b"not a library file".to_vec();
        let key = make_book(root.path(), "Linked", &secret, None);
        let linked = root.path().join("Linked").join("Linked.epub");
        fs::remove_file(&linked).unwrap();
        fs::write(outside.path().join("secret.epub"), &secret).unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.epub"), &linked).unwrap();
        let done = upload_book(&client(&base), root.path(), &key, &progress).await;
        assert_eq!(done, Err("outside_root".to_string()));

        // The book folder itself is a link to a folder elsewhere.
        let other = b"another book".to_vec();
        let other_key = make_book(outside.path(), "Elsewhere", &other, None);
        std::os::unix::fs::symlink(outside.path().join("Elsewhere"), root.path().join("Elsewhere")).unwrap();
        let done = upload_book(&client(&base), root.path(), &other_key, &progress).await;
        assert_eq!(done, Err("outside_root".to_string()));

        assert!(seen.lock().unwrap().is_empty(), "nothing reaches the server");
    });
}

/// Serves the `epub` ticket and file (with `served` bytes) and, when given, a jpg cover.
async fn account_with(sha: String, served: Vec<u8>, cover: Option<Vec<u8>>) -> (String, Arc<Mutex<Vec<Seen>>>) {
    serve(Arc::new(move |request: &Seen, base: &str| {
        let ticket = format!("/v1/me/files/{sha}?kind=");
        match request.path.strip_prefix(ticket.as_str()) {
            Some("epub") => reply(json!({ "downloadUrl": format!("{base}/bucket/epub"), "size": served.len(), "ext": "epub" })),
            Some("cover") => match &cover {
                Some(cover) => reply(json!({ "downloadUrl": format!("{base}/bucket/cover"), "size": cover.len(), "ext": "jpg" })),
                None => (404, br#"{"error":"file_not_found"}"#.to_vec()),
            },
            _ => match request.path.as_str() {
                "/bucket/epub" => (200, served.clone()),
                "/bucket/cover" => (200, cover.clone().unwrap_or_default()),
                _ => (500, Vec::new()),
            },
        }
    }))
    .await
}

#[test]
fn download_with_a_different_sha_is_thrown_away() {
    tauri::async_runtime::block_on(async {
        let root = TempDir::new("files-mismatch");
        let key = format!("import:{}", sha_hex(b"the real book"));
        let (base, _) = account_with(sha_hex(b"the real book"), b"something else".to_vec(), None).await;
        let (progress, _) = recorder();

        let done = download_book(&client(&base), root.path(), &key, "Book", &json!({}), &progress).await;
        assert_eq!(done, Err("sha_mismatch".to_string()));
        let left: Vec<_> = fs::read_dir(root.path()).unwrap().flatten().map(|e| e.file_name()).collect();
        assert!(left.is_empty(), "no folder and no staging left behind: {left:?}");
    });
}

#[test]
fn download_builds_the_folder_from_the_row_snapshot() {
    tauri::async_runtime::block_on(async {
        let root = TempDir::new("files-download");
        let epub = epub_bytes();
        let sha = sha_hex(&epub);
        let key = format!("import:{sha}");
        let cover = b"\xff\xd8\xff cover".to_vec();
        let (base, seen) = account_with(sha.clone(), epub.clone(), Some(cover.clone())).await;
        let snapshot = json!({
            "title": "Caged Sparrow", "author": "Feng Huo", "origin": "import", "language": "pt-BR",
            "series": { "id": "series:unsheathed", "name": "Unsheathed", "volume": 2 }, "coverExt": "jpg",
        });
        let (progress, reports) = recorder();

        let dir = download_book(&client(&base), root.path(), &key, " ", &snapshot, &progress).await.unwrap();
        assert_eq!(dir.file_name().unwrap(), "Unsheathed - Vol 2 - Caged Sparrow");
        assert_eq!(fs::read(dir.join("Caged Sparrow.epub")).unwrap(), epub);
        assert_eq!(fs::read(dir.join("cover.jpg")).unwrap(), cover);
        let marker: Value = serde_json::from_slice(&fs::read(dir.join(LOCAL_BOOK_MANIFEST)).unwrap()).unwrap();
        assert_eq!(marker["novel_id"], json!(key));
        assert_eq!((marker["origin"].clone(), marker["title"].clone()), (json!("import"), json!("Caged Sparrow")));
        assert_eq!((marker["author"].clone(), marker["language"].clone()), (json!("Feng Huo"), json!("pt-BR")));
        assert_eq!(marker["series"], json!({ "id": "series:unsheathed", "name": "Unsheathed", "volume": 2.0 }));
        assert_eq!((marker["file_sha256"].clone(), marker["file_size"].clone()), (json!(sha), json!(epub.len())));
        let total = (epub.len() + cover.len()) as u64;
        assert_eq!(reports.lock().unwrap().last(), Some(&(total, total)));
        assert!(seen.lock().unwrap().iter().all(|r| r.path.starts_with("/v1/") == r.header("authorization").is_some()));

        // Already in the Library: nothing is downloaded again.
        let before = seen.lock().unwrap().len();
        let again = download_book(&client(&base), root.path(), &key, "Other", &snapshot, &progress).await.unwrap();
        assert_eq!((again.file_name(), seen.lock().unwrap().len()), (dir.file_name(), before));
    });
}
