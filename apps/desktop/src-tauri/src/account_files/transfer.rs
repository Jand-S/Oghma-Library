//! The account-file transfers themselves (docs/IMPORT_EPUB.md, "Arquivos na conta"), apart
//! from the Tauri commands so the tests can drive them against a fake local server.
//!
//! Upload: `POST /v1/me/files` -> streaming PUT to the presigned URL -> `confirm`, for the EPUB
//! and the cover of the book folder. Download: `GET /v1/me/files/{sha}` -> stream into the
//! staging -> sha256 check -> commit of the folder with the marker built from the row snapshot.
//! The presigned URLs and the session token never leave this module.
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::export_root::resolve;
use crate::files::{pick_cover, write_atomic, LOCAL_BOOK_MANIFEST};
use crate::import_epub::{folder_title, library_books, make_series, sha256_file, MAX_EPUB_BYTES};
use crate::library_meta::IMPORT_PREFIX;
use crate::oghma_account::{send, ApiResponse};
use crate::staging::{abort_export_at, begin_import_at, commit_export_at, folder_name_for_title};

/// Bytes read from disk per chunk of the upload stream.
const CHUNK: usize = 256 * 1024;

/// The HTTP client of the transfers: no overall timeout (they can take minutes), only for
/// connecting and between reads, and no redirects: a presigned URL answers with the file or
/// fails, and a 3xx is an error (the bytes never go to or come from anywhere else).
pub(crate) fn transfer_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("OghmaLibrary/", env!("CARGO_PKG_VERSION")))
        .build()
        .unwrap_or_default()
}

/// Runs blocking file work (hashing, reading, writing) off the async worker threads.
async fn blocking<T: Send + 'static>(
    error: &'static str,
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|_| error.to_string())?
}

/// The signed-in account: base URL and token (both stay in Rust).
pub(crate) struct AccountClient {
    pub http: reqwest::Client,
    pub base: String,
    pub token: String,
}

/// Counts the bytes moved and reports `(sent, total)` after each chunk.
pub(crate) struct Progress {
    total: AtomicU64,
    sent: AtomicU64,
    report: Box<dyn Fn(u64, u64) + Send + Sync>,
}

impl Progress {
    pub(crate) fn new(report: impl Fn(u64, u64) + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self { total: AtomicU64::new(0), sent: AtomicU64::new(0), report: Box::new(report) })
    }

    fn start(&self, total: u64) {
        self.total.store(total, Ordering::SeqCst);
        self.sent.store(0, Ordering::SeqCst);
        (self.report)(0, total);
    }

    fn add(&self, bytes: u64) {
        let sent = self.sent.fetch_add(bytes, Ordering::SeqCst) + bytes;
        (self.report)(sent, self.total.load(Ordering::SeqCst));
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Uploaded {
    /// At least one file went up.
    Sent,
    /// The server already had every file: nothing was sent.
    Already,
}

/// The `<sha256>` of an `import:<sha256>` key.
pub(crate) fn import_sha(key: &str) -> Option<&str> {
    key.strip_prefix(IMPORT_PREFIX)
        .filter(|sha| sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}

/// Error code of an API answer: the server's `{"error": code}`, else `http_<status>`.
fn error_code(response: &ApiResponse) -> String {
    if response.status == 401 {
        return "unauthorized".to_string();
    }
    response
        .body
        .get("error")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("http_{}", response.status))
}

/// A presigned URL is only followed over HTTPS (or plain HTTP on this machine, in development).
fn transfer_url(raw: Option<&str>) -> Result<url::Url, String> {
    let url = raw.and_then(|raw| url::Url::parse(raw).ok()).ok_or("invalid_url")?;
    let local = matches!(url.host_str(), Some("127.0.0.1" | "localhost"));
    if url.scheme() == "https" || (url.scheme() == "http" && local) {
        Ok(url)
    } else {
        Err("invalid_url".to_string())
    }
}

/// `path` resolved (symlinks followed) strictly inside `root`; anything else is refused.
fn inside(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let target = resolve(path).map_err(|_| "outside_root")?;
    if target != root && target.starts_with(root) {
        Ok(target)
    } else {
        Err("outside_root".to_string())
    }
}

/// The book's EPUB: the first `.epub` file of the folder, by name.
fn epub_in(dir: &Path) -> Option<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("epub")))
        .collect();
    files.sort();
    files.into_iter().next()
}

/// Server extension of a cover file (`jpeg` is stored as `jpg`).
fn cover_ext(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_string_lossy().to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Some("jpg"),
        "png" => Some("png"),
        "webp" => Some("webp"),
        _ => None,
    }
}

impl AccountClient {
    async fn api(&self, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<ApiResponse, String> {
        send(&self.http, method, format!("{}{path}", self.base), Some(&self.token), body)
            .await
            .map_err(|_| "network".to_string())
    }

    /// `GET /v1/me/files/usage` -> `{usedBytes, quotaBytes, files}`.
    pub(crate) async fn usage(&self) -> Result<Value, String> {
        let response = self.api(reqwest::Method::GET, "/v1/me/files/usage", None).await?;
        if response.status == 200 {
            Ok(response.body)
        } else {
            Err(error_code(&response))
        }
    }

    /// Streams the file at `path` to the presigned URL of `ticket`, without the session token.
    async fn put(&self, ticket: &Value, path: &Path, size: u64, progress: &Arc<Progress>) -> Result<(), String> {
        let url = transfer_url(ticket.get("uploadUrl").and_then(Value::as_str))?;
        let method = match ticket.get("method").and_then(Value::as_str).unwrap_or("PUT") {
            "PUT" => reqwest::Method::PUT,
            "POST" => reqwest::Method::POST,
            _ => return Err("invalid_url".to_string()),
        };
        let file = fs::File::open(path).map_err(|_| "file_missing")?;
        let counter = Arc::clone(progress);
        // `None` after an error ends the stream (the request then fails).
        let chunks = futures_lite::stream::unfold(Some(file), move |file| {
            let counter = Arc::clone(&counter);
            async move {
                let mut file = file?;
                let read = tauri::async_runtime::spawn_blocking(move || {
                    let mut buf = vec![0u8; CHUNK];
                    let read = file.read(&mut buf).map(|read| {
                        buf.truncate(read);
                        buf
                    });
                    (read, file)
                })
                .await;
                match read {
                    Ok((Ok(buf), _)) if buf.is_empty() => None,
                    Ok((Ok(buf), file)) => {
                        counter.add(buf.len() as u64);
                        Some((Ok::<_, std::io::Error>(buf), Some(file)))
                    }
                    Ok((Err(err), _)) => Some((Err(err), None)),
                    Err(_) => Some((Err(std::io::Error::other("read_failed")), None)),
                }
            }
        });
        // Presigned PUTs need a Content-Length (no chunked encoding), so it is set by hand.
        let mut request = self
            .http
            .request(method, url)
            .header(reqwest::header::CONTENT_LENGTH, size)
            .body(reqwest::Body::wrap_stream(chunks));
        if let Some(headers) = ticket.get("headers").and_then(Value::as_object) {
            for (name, value) in headers {
                if let Some(value) = value.as_str() {
                    request = request.header(name.as_str(), value);
                }
            }
        }
        let response = request.send().await.map_err(|_| "network")?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err("upload_failed".to_string())
        }
    }

    /// Streams `url` into `target`, returning `(sha256, size)` of what arrived.
    async fn fetch(&self, url: &str, target: &Path, progress: &Progress) -> Result<(String, u64), String> {
        let url = transfer_url(Some(url))?;
        let mut response = self.http.get(url).send().await.map_err(|_| "network")?;
        if !response.status().is_success() {
            return Err("download_failed".to_string());
        }
        let target = target.to_path_buf();
        let mut file = blocking("write_failed", move || fs::File::create(target).map_err(|_| "write_failed".to_string())).await?;
        let mut hasher = Sha256::new();
        let mut size = 0u64;
        while let Some(chunk) = response.chunk().await.map_err(|_| "network")? {
            let len = chunk.len() as u64;
            hasher.update(&chunk);
            file = blocking("write_failed", move || {
                file.write_all(&chunk).map_err(|_| "write_failed")?;
                Ok(file)
            })
            .await?;
            size += len;
            progress.add(len);
        }
        blocking("write_failed", move || file.sync_all().map_err(|_| "write_failed".to_string())).await?;
        let hex = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
        Ok((hex, size))
    }

    /// `GET /v1/me/files/{sha}?kind=` -> the download ticket; `None` when the file is not there.
    async fn ticket(&self, sha: &str, kind: &str) -> Result<Option<Value>, String> {
        let response = self.api(reqwest::Method::GET, &format!("/v1/me/files/{sha}?kind={kind}"), None).await?;
        match response.status {
            200 => Ok(Some(response.body)),
            404 => Ok(None),
            _ => Err(error_code(&response)),
        }
    }
}

/// The files of the `key` book folder to send: `(kind, ext, path, size)`, the EPUB first.
/// Blocking (scans the Library and hashes the EPUB): run it through `blocking`.
fn local_files(root: &Path, key: &str, sha: &str) -> Result<Vec<(&'static str, &'static str, PathBuf, u64)>, String> {
    let root = resolve(root).map_err(|_| "no_library")?;
    let book = library_books(&root)
        .into_iter()
        .find(|book| book.novel_id.as_deref() == Some(key))
        .ok_or("not_in_library")?;
    let dir = inside(&root, &book.dir)?;
    let epub = inside(&root, &epub_in(&dir).ok_or("file_missing")?)?;
    // Over the limit the server refuses it anyway: say so before hashing hundreds of MB.
    if fs::metadata(&epub).map_err(|_| "file_missing")?.len() > MAX_EPUB_BYTES {
        return Err("file_too_large".to_string());
    }
    let (local_sha, size) = sha256_file(&epub).map_err(|_| "file_missing")?;
    if local_sha != sha {
        return Err("sha_mismatch".to_string());
    }
    let mut files = vec![("epub", "epub", epub, size)];
    if let Some(cover) = pick_cover(&dir) {
        let cover = inside(&root, &cover)?;
        if let (Some(ext), Ok(meta)) = (cover_ext(&cover), fs::metadata(&cover)) {
            files.push(("cover", ext, cover, meta.len()));
        }
    }
    Ok(files)
}

/// Sends the EPUB and the cover of the `key` book folder of the Library at `root`.
pub(crate) async fn upload_book(
    client: &AccountClient,
    root: &Path,
    key: &str,
    progress: &Arc<Progress>,
) -> Result<Uploaded, String> {
    let sha = import_sha(key).ok_or("invalid_key")?;
    let files = {
        let (root, key, sha) = (root.to_path_buf(), key.to_string(), sha.to_string());
        blocking("file_missing", move || local_files(&root, &key, &sha)).await?
    };

    let mut tickets = Vec::new();
    for (kind, ext, path, size) in files {
        let body = json!({ "sha256": sha, "kind": kind, "ext": ext, "size": size });
        let response = client.api(reqwest::Method::POST, "/v1/me/files", Some(body)).await?;
        if response.status != 200 {
            return Err(error_code(&response));
        }
        if response.body.get("exists").and_then(Value::as_bool) != Some(true) {
            tickets.push((kind, path, size, response.body));
        }
    }
    if tickets.is_empty() {
        return Ok(Uploaded::Already);
    }
    progress.start(tickets.iter().map(|(_, _, size, _)| size).sum());
    for (kind, path, size, ticket) in &tickets {
        client.put(ticket, path, *size, progress).await?;
        let confirm = format!("/v1/me/files/{sha}/confirm");
        let response = client.api(reqwest::Method::POST, &confirm, Some(json!({ "kind": kind }))).await?;
        if response.status != 200 {
            return Err(error_code(&response));
        }
    }
    Ok(Uploaded::Sent)
}

fn text(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

/// Downloads the `key` book into the Library at `root` and returns its folder. The marker and
/// the folder name come from `snapshot` (the `library_meta` row); `title` wins when not blank.
/// A book already in the Library is not downloaded again.
pub(crate) async fn download_book(
    client: &AccountClient,
    root: &Path,
    key: &str,
    title: &str,
    snapshot: &Value,
    progress: &Arc<Progress>,
) -> Result<PathBuf, String> {
    let sha = import_sha(key).ok_or("invalid_key")?;
    let present = {
        let (root, key) = (root.to_path_buf(), key.to_string());
        blocking("write_failed", move || {
            Ok(library_books(&root).into_iter().find(|book| book.novel_id.as_deref() == Some(key.as_str())))
        })
        .await?
    };
    if let Some(book) = present {
        return Ok(book.dir);
    }
    let epub = client.ticket(sha, "epub").await?.ok_or("file_not_found")?;
    let epub_url = text(epub.get("downloadUrl")).ok_or("invalid_url")?;
    let cover = match client.ticket(sha, "cover").await? {
        Some(ticket) => match (text(ticket.get("downloadUrl")), text(ticket.get("ext"))) {
            (Some(url), Some(ext)) if matches!(ext.as_str(), "jpg" | "png" | "webp") => Some((url, ext, ticket)),
            _ => None,
        },
        None => None,
    };
    let size_of = |ticket: &Value| ticket.get("size").and_then(Value::as_u64).unwrap_or(0);
    progress.start(size_of(&epub) + cover.as_ref().map(|(_, _, ticket)| size_of(ticket)).unwrap_or(0));

    let title = text(Some(&Value::from(title)))
        .or_else(|| text(snapshot.get("title")))
        .unwrap_or_else(|| "Livro importado".to_string());
    let series = snapshot.get("series").and_then(|series| {
        let name = text(series.get("name"))?;
        Some(make_series(&name, series.get("volume").and_then(Value::as_f64)))
    });
    let begun = {
        let (root, key, folder) = (root.to_path_buf(), key.to_string(), folder_title(series.as_ref(), &title));
        blocking("write_failed", move || begin_import_at(&root, &key, &folder).map_err(|_| "write_failed".to_string())).await?
    };
    let staging = PathBuf::from(&begun.staging_dir);
    let written = async {
        let file_name = format!("{}.epub", folder_name_for_title(&title));
        let (got, size) = client.fetch(&epub_url, &staging.join(&file_name), progress).await?;
        // The sha is the book's identity: different bytes are thrown away.
        if got != sha {
            return Err("sha_mismatch".to_string());
        }
        if let Some((url, ext, _)) = &cover {
            client.fetch(url, &staging.join(format!("cover.{ext}")), progress).await?;
        }
        let mut marker = json!({
            "schema_version": 1,
            "novel_id": key,
            "origin": "import",
            "title": title,
            "source_file_name": file_name,
            "file_sha256": sha,
            "file_size": size,
            "generated_at": crate::translation::iso_utc(crate::translation::now_secs()),
        });
        if let Some(object) = marker.as_object_mut() {
            if let Some(author) = text(snapshot.get("author")) {
                object.insert("author".into(), Value::from(author));
            }
            if let Some(language) = text(snapshot.get("language")) {
                object.insert("language".into(), Value::from(language));
            }
            if let Some(series) = &series {
                object.insert("series".into(), json!(series));
            }
        }
        let marker = serde_json::to_vec_pretty(&marker).map_err(|_| "write_failed")?;
        let (staging, final_dir) = (staging.clone(), PathBuf::from(&begun.final_dir));
        blocking("write_failed", move || {
            write_atomic(&staging.join(LOCAL_BOOK_MANIFEST), &marker).map_err(|_| "write_failed")?;
            commit_export_at(&staging, &final_dir).map_err(|_| "write_failed".to_string())
        })
        .await
    }
    .await;
    if written.is_err() {
        let _ = blocking("write_failed", move || abort_export_at(&staging)).await;
    }
    written
}
