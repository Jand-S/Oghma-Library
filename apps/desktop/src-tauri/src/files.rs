use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

use crate::export_root::ExportRoot;
use crate::paths::{is_hidden_name, safe_relative_path};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportLibraryItem {
    /// Display title: the manifest title (with accents) when present, else the folder name.
    title: String,
    /// Folder name inside the output root (the sanitized title).
    folder_name: String,
    output_dir: String,
    files: Vec<String>,
    cover_path: Option<String>,
    /// Only filled when `include_cover_data` is true (legacy, expensive).
    cover_data_url: Option<String>,
    size_bytes: u64,
    /// Newest mtime (ms since epoch) of any file in the folder; used for cache-busting.
    mtime_ms: Option<u64>,
    novel_id: Option<String>,
    generated_at: Option<String>,
    chapter_count: Option<u32>,
    source_chars: Option<u64>,
    word_count: Option<u64>,
    analysis_format: Option<String>,
    /// Language of the text ("pt-BR" for translated books).
    language: Option<String>,
    /// Novel this book was translated from.
    source_novel_id: Option<String>,
    /// Author written by the app (translated books carry the original's).
    author: Option<String>,
    /// 0–100 while the book is a translation preview (only finished chapters); absent when final.
    translation_progress: Option<u8>,
    /// Downloaded as a chapter range (not the whole novel): "new chapters" do not apply.
    partial_range: bool,
}

pub(crate) const LOCAL_BOOK_MANIFEST: &str = ".oghma-book.json";
const COVER_EXTENSIONS: [&str; 4] = ["jpg", "jpeg", "png", "webp"];
const BOOK_EXTENSIONS: [&str; 5] = ["epub", "pdf", "txt", "html", "azw3"];

#[derive(Debug)]
struct ContentAnalysis {
    chapter_count: Option<u32>,
    source_chars: u64,
    word_count: u64,
    format: String,
}

/// Lenient view of `.oghma-book.json`: every field is optional so an older or
/// partial manifest still yields whatever identity data it has.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub(crate) struct LocalBookManifest {
    pub novel_id: Option<String>,
    pub title: Option<String>,
    pub generated_at: Option<String>,
    pub chapter_count: Option<u32>,
    pub source_chars: Option<u64>,
    pub word_count: Option<u64>,
    pub analysis_format: Option<String>,
    pub language: Option<String>,
    pub source_novel_id: Option<String>,
    pub author: Option<String>,
    pub translation_progress: Option<u8>,
    pub range_start: Option<f64>,
    pub range_end: Option<f64>,
}

impl LocalBookManifest {
    pub fn novel_id(&self) -> Option<&str> {
        self.novel_id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
    }

    fn title(&self) -> Option<&str> {
        self.title
            .as_deref()
            .map(str::trim)
            .filter(|title| !title.is_empty())
    }

    fn analysis(&self) -> Option<ContentAnalysis> {
        Some(ContentAnalysis {
            chapter_count: self.chapter_count.filter(|count| *count > 0),
            source_chars: self.source_chars?,
            word_count: self.word_count?,
            format: self.analysis_format.clone()?,
        })
    }
}

pub(crate) fn read_manifest(dir: &Path) -> Option<LocalBookManifest> {
    serde_json::from_slice(&fs::read(dir.join(LOCAL_BOOK_MANIFEST)).ok()?).ok()
}

fn mime_from_name(name: &str) -> &'static str {
    let lower = name.to_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else {
        "image/jpeg"
    }
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0b0000_0011) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(((b1 & 0b0000_1111) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(b2 & 0b0011_1111) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn extension_lower(name: &str) -> Option<String> {
    Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
}

/// `cover.<anything>` (case-insensitive), the name family `save_export_file` dedupes.
fn is_cover_family(name: &str) -> bool {
    name.to_lowercase().starts_with("cover.")
}

fn is_cover_image(name: &str) -> bool {
    is_cover_family(name)
        && extension_lower(name).is_some_and(|ext| COVER_EXTENSIONS.contains(&ext.as_str()))
}

pub(crate) fn mtime_ms(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// Deterministic cover choice for a book folder: the newest `cover.{jpg,jpeg,png,webp}`
/// by mtime; ties are broken by extension preference (jpg, jpeg, png, webp) then name.
pub(crate) fn pick_cover(dir: &Path) -> Option<PathBuf> {
    let mut best: Option<(u64, usize, String, PathBuf)> = None;
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_cover_image(&name) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let modified = meta.modified().map(mtime_ms).unwrap_or(0);
        let ext = extension_lower(&name).unwrap_or_default();
        let rank = COVER_EXTENSIONS
            .iter()
            .position(|candidate| *candidate == ext)
            .unwrap_or(COVER_EXTENSIONS.len());
        let better = match &best {
            None => true,
            Some((best_time, best_rank, best_name, _)) => {
                (modified, std::cmp::Reverse(rank), std::cmp::Reverse(&name))
                    > (*best_time, std::cmp::Reverse(*best_rank), std::cmp::Reverse(best_name))
            }
        };
        if better {
            best = Some((modified, rank, name, entry.path()));
        }
    }
    best.map(|(_, _, _, path)| path)
}

pub(crate) fn unique_suffix() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{}-{nanos}", std::process::id())
}

/// Writes `bytes` to `path` atomically (temp file in the same dir + rename), so a
/// half-written file is never visible under its final name.
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Caminho de arquivo inválido".to_string())?;
    let name = path
        .file_name()
        .ok_or_else(|| "Caminho de arquivo inválido".to_string())?
        .to_string_lossy();
    let temp = parent.join(format!(".{name}.oghma-tmp-{}", unique_suffix()));
    if let Err(err) = fs::write(&temp, bytes) {
        let _ = fs::remove_file(&temp);
        return Err(format!("Não foi possível salvar o arquivo: {err}"));
    }
    fs::rename(&temp, path).map_err(|err| {
        let _ = fs::remove_file(&temp);
        format!("Não foi possível finalizar o arquivo: {err}")
    })
}

/// Saves one export file under `dir` (creating subfolders), atomically. Writing a
/// `cover.*` removes sibling `cover.*` files with other extensions.
pub(crate) fn write_export_file(dir: &Path, file_name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let relative_path = safe_relative_path(file_name)?;
    fs::create_dir_all(dir)
        .map_err(|err| format!("Não foi possível criar a pasta de saída: {err}"))?;
    let path = dir.join(relative_path);
    let parent = path
        .parent()
        .ok_or_else(|| "Caminho de arquivo inválido".to_string())?
        .to_path_buf();
    fs::create_dir_all(&parent)
        .map_err(|err| format!("Não foi possível criar a pasta de assets: {err}"))?;
    write_atomic(&path, bytes)?;

    let written_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    if is_cover_family(&written_name) {
        if let Ok(entries) = fs::read_dir(&parent) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name != written_name && is_cover_family(&name) && entry.path().is_file() {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }
    Ok(path)
}

#[tauri::command(async)]
pub fn save_export_file(request: Request<'_>, root: tauri::State<'_, ExportRoot>) -> Result<String, String> {
    fn decode_header(value: &str) -> Result<String, String> {
        let source = value.as_bytes();
        let mut decoded = Vec::with_capacity(source.len());
        let mut index = 0;
        while index < source.len() {
            if source[index] == b'%' {
                if index + 2 >= source.len() {
                    return Err("Header de arquivo inválido".to_string());
                }
                let hex = std::str::from_utf8(&source[index + 1..index + 3])
                    .map_err(|_| "Header de arquivo inválido".to_string())?;
                decoded.push(
                    u8::from_str_radix(hex, 16)
                        .map_err(|_| "Header de arquivo inválido".to_string())?,
                );
                index += 3;
            } else {
                decoded.push(source[index]);
                index += 1;
            }
        }
        String::from_utf8(decoded).map_err(|_| "Header de arquivo inválido".to_string())
    }

    let payload = match request.body() {
        InvokeBody::Raw(bytes) => bytes,
        _ => return Err("Payload binario esperado".to_string()),
    };
    let output_dir = request
        .headers()
        .get("x-oghma-output-dir")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "Pasta de saída ausente".to_string())
        .and_then(decode_header)?;
    let file_name = request
        .headers()
        .get("x-oghma-file-name")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "Nome de arquivo ausente".to_string())
        .and_then(decode_header)?;

    let dir = root.require_inside(Path::new(&output_dir))?;
    let path = write_export_file(&dir, &file_name, payload)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command(async)]
pub fn open_local_path(root: tauri::State<'_, ExportRoot>, path: String) -> Result<(), String> {
    // Only the output folder and what is inside it: `open` would also launch an .app bundle.
    let path = root.require_root_or_inside(Path::new(&path))?;
    fs::create_dir_all(&path)
        .map_err(|err| format!("Não foi possível abrir/criar a pasta: {err}"))?;
    let path = path
        .canonicalize()
        .map_err(|err| format!("Não foi possível resolver a pasta: {err}"))?;

    #[cfg(target_os = "windows")]
    let status = Command::new("explorer").arg(path.as_os_str()).status();
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(&path).status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(&path).status();

    status
        .map_err(|err| format!("Não foi possível abrir a pasta: {err}"))
        .and_then(|exit| {
            if exit.success() {
                Ok(())
            } else {
                Err("O sistema recusou abrir a pasta".to_string())
            }
        })
}

fn scan_book_dir(path: &Path, folder_name: String, include_cover_data: bool) -> Result<Option<ExportLibraryItem>, String> {
    let mut files = Vec::new();
    let mut size_bytes = 0;
    let mut newest: Option<u64> = None;
    for file in fs::read_dir(path)
        .map_err(|err| format!("Não foi possível ler uma pasta de livro: {err}"))?
    {
        let file = file.map_err(|err| format!("Não foi possível ler um arquivo exportado: {err}"))?;
        let name = file.file_name().to_string_lossy().to_string();
        if is_hidden_name(&name) {
            continue;
        }
        let Ok(meta) = file.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        size_bytes += meta.len();
        if let Ok(modified) = meta.modified() {
            let ms = mtime_ms(modified);
            newest = Some(newest.map_or(ms, |current| current.max(ms)));
        }
        if extension_lower(&name).is_some_and(|ext| BOOK_EXTENSIONS.contains(&ext.as_str())) {
            files.push(name);
        }
    }

    if files.is_empty() {
        return Ok(None);
    }
    files.sort();

    let cover = pick_cover(path);
    let cover_data_url = if include_cover_data {
        cover.as_ref().and_then(|cover| {
            let bytes = fs::read(cover).ok()?;
            let name = cover.file_name()?.to_string_lossy().to_string();
            Some(format!("data:{};base64,{}", mime_from_name(&name), base64_encode(&bytes)))
        })
    } else {
        None
    };
    let manifest = read_manifest(path).unwrap_or_default();
    let analysis = manifest.analysis();
    Ok(Some(ExportLibraryItem {
        title: manifest.title().map(str::to_string).unwrap_or_else(|| folder_name.clone()),
        folder_name,
        output_dir: path.to_string_lossy().to_string(),
        files,
        cover_path: cover.map(|cover| cover.to_string_lossy().to_string()),
        cover_data_url,
        size_bytes,
        mtime_ms: newest,
        novel_id: manifest.novel_id().map(str::to_string),
        generated_at: manifest.generated_at.clone(),
        chapter_count: analysis.as_ref().and_then(|item| item.chapter_count),
        source_chars: analysis.as_ref().map(|item| item.source_chars),
        word_count: analysis.as_ref().map(|item| item.word_count),
        analysis_format: analysis.map(|item| item.format),
        language: manifest.language.clone().filter(|l| !l.trim().is_empty()),
        source_novel_id: manifest.source_novel_id.clone().filter(|id| !id.trim().is_empty()),
        author: manifest.author.clone().filter(|a| !a.trim().is_empty()),
        translation_progress: manifest.translation_progress.map(|p| p.min(100)),
        partial_range: manifest.range_start.is_some() || manifest.range_end.is_some(),
    }))
}

/// Scans `<root>/*` for book folders. Dot-directories (`.oghma-staging`, `.oghma-trash`, …) are skipped.
pub(crate) fn scan_export_library(root: &Path, include_cover_data: bool) -> Result<Vec<ExportLibraryItem>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut items = Vec::new();
    for entry in fs::read_dir(root)
        .map_err(|err| format!("Não foi possível ler a pasta de saída: {err}"))?
    {
        let entry = entry.map_err(|err| format!("Não foi possível ler um item da pasta: {err}"))?;
        let folder_name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        if is_hidden_name(&folder_name) || !path.is_dir() {
            continue;
        }
        if let Some(item) = scan_book_dir(&path, folder_name, include_cover_data)? {
            items.push(item);
        }
    }

    items.sort_by(|a, b| {
        a.title
            .to_lowercase()
            .cmp(&b.title.to_lowercase())
            .then_with(|| a.folder_name.cmp(&b.folder_name))
    });
    Ok(items)
}

/// Lists the book folders in `output_dir`. Covers are returned as `coverPath`
/// (served through the asset protocol, allowed here file by file); the legacy
/// base64 `coverDataUrl` is only computed when `include_cover_data` is true.
#[tauri::command(async)]
pub fn list_export_library(
    app: AppHandle,
    export_root: tauri::State<'_, ExportRoot>,
    output_dir: String,
    include_cover_data: Option<bool>,
) -> Result<Vec<ExportLibraryItem>, String> {
    let root = export_root.require_root(Path::new(&output_dir))?;
    let items = scan_export_library(&root, include_cover_data.unwrap_or(false))?;
    let scope = app.asset_protocol_scope();
    for cover in items.iter().filter_map(|item| item.cover_path.as_ref()) {
        let _ = scope.allow_file(cover);
    }
    Ok(items)
}

#[tauri::command(async)]
pub fn delete_export_library_item(
    export_root: tauri::State<'_, ExportRoot>,
    output_dir: String,
    item_dir: String,
) -> Result<(), String> {
    export_root.require_root(Path::new(&output_dir))?;
    // Direct child of the output folder holding `.oghma-book.json`: never any other folder.
    let target = export_root.require_book_dir(Path::new(&item_dir))?;
    if !target.is_dir() {
        return Err("A pasta do livro não existe".to_string());
    }

    fs::remove_dir_all(&target)
        .map_err(|err| format!("Não foi possível excluir os arquivos do livro: {err}"))?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::path::{Path, PathBuf};
    use std::time::{Duration, SystemTime};

    pub struct TempDir(pub PathBuf);

    impl TempDir {
        pub fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "oghma-{label}-{}",
                super::unique_suffix()
            ));
            std::fs::create_dir_all(&path).expect("temp dir");
            TempDir(path)
        }

        pub fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    pub fn set_mtime(path: &Path, secs_ago: u64) {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .open(path)
            .expect("open for mtime");
        file.set_modified(SystemTime::now() - Duration::from_secs(secs_ago))
            .expect("set mtime");
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{set_mtime, TempDir};
    use super::*;

    #[test]
    fn reads_persisted_manifest_without_opening_the_book() {
        let dir = TempDir::new("manifest");
        fs::write(
            dir.path().join(LOCAL_BOOK_MANIFEST),
            r#"{"chapter_count":3033,"source_chars":22024151,"word_count":3500000,"analysis_format":"bundle"}"#,
        )
        .expect("manifest fixture");

        let analysis = read_manifest(dir.path()).and_then(|m| m.analysis()).expect("analysis");
        assert_eq!(analysis.chapter_count, Some(3033));
        assert_eq!(analysis.source_chars, 22_024_151);
        assert_eq!(analysis.format, "bundle");
    }

    #[test]
    fn manifest_exposes_novel_identity() {
        let dir = TempDir::new("manifest-id");
        fs::write(
            dir.path().join(LOCAL_BOOK_MANIFEST),
            r#"{"schema_version":1,"novel_id":"cn:solo-leveling","title":"Solo Leveling: Ragnarök","generated_at":"2026-09-01T10:00:00Z","chapters":[]}"#,
        )
        .expect("manifest fixture");
        let manifest = read_manifest(dir.path()).expect("manifest");
        assert_eq!(manifest.novel_id(), Some("cn:solo-leveling"));
        assert_eq!(manifest.title(), Some("Solo Leveling: Ragnarök"));
        assert_eq!(manifest.generated_at.as_deref(), Some("2026-09-01T10:00:00Z"));
        // Analysis fields are missing: identity still parses, analysis does not.
        assert!(manifest.analysis().is_none());
    }

    #[test]
    fn saving_a_cover_removes_other_cover_extensions() {
        let dir = TempDir::new("cover-dedupe");
        fs::write(dir.path().join("cover.png"), b"old png").unwrap();
        fs::write(dir.path().join("Cover.webp"), b"old webp").unwrap();
        fs::write(dir.path().join("book.epub"), b"epub").unwrap();

        write_export_file(dir.path(), "cover.jpg", b"new jpg").expect("save cover");

        let mut names: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        assert_eq!(names, vec!["book.epub", "cover.jpg"]);
        assert_eq!(fs::read(dir.path().join("cover.jpg")).unwrap(), b"new jpg");
    }

    #[test]
    fn save_overwrites_atomically_and_rejects_escaping_paths() {
        let dir = TempDir::new("atomic");
        write_export_file(dir.path(), "assets/a.webp", b"one").expect("first");
        write_export_file(dir.path(), "assets/a.webp", b"two").expect("second");
        assert_eq!(fs::read(dir.path().join("assets/a.webp")).unwrap(), b"two");
        let leftovers = fs::read_dir(dir.path().join("assets")).unwrap().count();
        assert_eq!(leftovers, 1, "no temp files are left behind");
        assert!(write_export_file(dir.path(), "../evil.txt", b"x").is_err());
    }

    #[test]
    fn pick_cover_prefers_newest_then_extension() {
        let dir = TempDir::new("pick-cover");
        assert!(pick_cover(dir.path()).is_none());
        fs::write(dir.path().join("cover.png"), b"png").unwrap();
        fs::write(dir.path().join("cover.webp"), b"webp").unwrap();
        fs::write(dir.path().join("cover.txt"), b"not an image").unwrap();
        set_mtime(&dir.path().join("cover.png"), 100);
        set_mtime(&dir.path().join("cover.webp"), 10);
        assert_eq!(pick_cover(dir.path()).unwrap().file_name().unwrap(), "cover.webp");

        fs::write(dir.path().join("cover.jpg"), b"jpg").unwrap();
        set_mtime(&dir.path().join("cover.jpg"), 10);
        set_mtime(&dir.path().join("cover.webp"), 10);
        let chosen = pick_cover(dir.path()).unwrap();
        let chosen = chosen.file_name().unwrap().to_string_lossy();
        // Same second-resolution mtime on some filesystems: jpg wins the tie.
        assert!(chosen == "cover.jpg" || chosen == "cover.webp");
        set_mtime(&dir.path().join("cover.jpg"), 1);
        assert_eq!(pick_cover(dir.path()).unwrap().file_name().unwrap(), "cover.jpg");
    }

    #[test]
    fn scan_skips_dot_dirs_and_reads_identity() {
        let root = TempDir::new("scan");
        let book = root.path().join("Solo Leveling_ Ragnarok");
        fs::create_dir_all(&book).unwrap();
        fs::write(book.join("Solo Leveling_ Ragnarok.epub"), b"epub").unwrap();
        fs::write(book.join(".Solo.epub.oghma-tmp-1"), b"partial").unwrap();
        fs::write(book.join("cover.jpg"), b"jpg").unwrap();
        fs::write(
            book.join(LOCAL_BOOK_MANIFEST),
            r#"{"novel_id":"42","title":"Solo Leveling: Ragnarök"}"#,
        )
        .unwrap();
        for hidden in [".oghma-staging/42-1", ".oghma-trash/x-1"] {
            let dir = root.path().join(hidden);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("book.epub"), b"epub").unwrap();
        }

        let items = scan_export_library(root.path(), false).expect("scan");
        assert_eq!(items.len(), 1);
        let item = &items[0];
        assert_eq!(item.title, "Solo Leveling: Ragnarök");
        assert_eq!(item.folder_name, "Solo Leveling_ Ragnarok");
        assert_eq!(item.novel_id.as_deref(), Some("42"));
        assert_eq!(item.files, vec!["Solo Leveling_ Ragnarok.epub"]);
        assert!(item.cover_path.as_deref().unwrap().ends_with("cover.jpg"));
        assert!(item.cover_data_url.is_none());
        assert!(item.mtime_ms.is_some());

        let with_data = scan_export_library(root.path(), true).expect("scan");
        assert!(with_data[0].cover_data_url.as_deref().unwrap().starts_with("data:image/jpeg;base64,"));
    }

    #[test]
    fn serializes_library_item_in_camel_case() {
        let root = TempDir::new("serialize");
        let book = root.path().join("Livro");
        fs::create_dir_all(&book).unwrap();
        fs::write(book.join("Livro.epub"), b"epub").unwrap();
        let items = scan_export_library(root.path(), false).unwrap();
        let json = serde_json::to_value(&items[0]).unwrap();
        for key in ["title", "folderName", "outputDir", "files", "coverPath", "sizeBytes", "mtimeMs", "novelId"] {
            assert!(json.get(key).is_some(), "missing {key}");
        }
    }
}
