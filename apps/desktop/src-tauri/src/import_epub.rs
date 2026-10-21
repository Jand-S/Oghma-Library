//! Importing the user's own EPUBs (docs/IMPORT_EPUB.md): picking or dropping files and the
//! preview shown before the import.
//!
//! The webview never sees the chosen paths: `import_epub_pick` and the window's DragDrop
//! register them here and hand out opaque ids, and every later command takes those ids.
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::export_root::ExportRoot;
use crate::files::{pick_cover, LOCAL_BOOK_MANIFEST};
use crate::paths::is_hidden_name;

mod commit;
pub(crate) mod epub_meta;
#[cfg(test)]
mod commit_tests;
#[cfg(test)]
mod tests;

pub use commit::{ImportCommitItem, ImportResult};
pub(crate) use commit::folder_title;
pub(crate) use epub_meta::make_series;
pub use epub_meta::{SeriesInfo, SeriesSource};

/// Event emitted with `Vec<PickedFile>` when .epub files are dropped on the window.
pub const DROPPED_EVENT: &str = "import-epub-dropped";
/// Longer side of the cover thumbnail sent to the preview.
const PREVIEW_COVER_SIDE: u32 = 600;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFile {
    pub id: String,
    pub file_name: String,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlreadyImported {
    pub output_dir: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub id: String,
    pub file_name: String,
    pub sha256: String,
    pub size: u64,
    pub title: String,
    pub author: Option<String>,
    pub language: Option<String>,
    pub series: Option<SeriesInfo>,
    pub series_source: Option<SeriesSource>,
    pub cover_data_url: Option<String>,
    pub cover_from_library: Option<String>,
    pub already_imported: Option<AlreadyImported>,
    pub error: Option<String>,
}

/// Paths picked or dropped in this session, by id.
#[derive(Default)]
pub struct ImportEpubState {
    files: Mutex<HashMap<String, PathBuf>>,
}

fn is_epub(path: &Path) -> bool {
    path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("epub")) && path.is_file()
}

fn new_id() -> String {
    let mut bytes = [0u8; 12];
    if getrandom::fill(&mut bytes).is_err() {
        return format!("f{}", crate::files::unique_suffix());
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

impl ImportEpubState {
    /// Keeps the .epub files among `paths` (others are ignored) and returns their ids.
    /// A path registered before keeps its id.
    pub fn register(&self, paths: &[PathBuf]) -> Vec<PickedFile> {
        let mut files = self.files.lock().unwrap_or_else(|e| e.into_inner());
        let mut picked = Vec::new();
        for path in paths.iter().filter(|path| is_epub(path)) {
            let id = match files.iter().find(|(_, known)| *known == path) {
                Some((id, _)) => id.clone(),
                None => {
                    let id = new_id();
                    files.insert(id.clone(), path.clone());
                    id
                }
            };
            if picked.iter().any(|p: &PickedFile| p.id == id) {
                continue;
            }
            picked.push(PickedFile {
                id,
                file_name: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                size: fs::metadata(path).map(|m| m.len()).unwrap_or(0),
            });
        }
        picked
    }

    pub fn path_of(&self, id: &str) -> Option<PathBuf> {
        self.files.lock().unwrap_or_else(|e| e.into_inner()).get(id).cloned()
    }
}

/// A book folder of the Library, as far as the import cares.
#[derive(Debug, Clone)]
pub(crate) struct LibraryBook {
    pub dir: PathBuf,
    pub novel_id: Option<String>,
    pub series_id: Option<String>,
    pub author: Option<String>,
    pub has_cover: bool,
}

/// Book folders directly under `root` with a `.oghma-book.json`, sorted by folder name.
pub(crate) fn library_books(root: &Path) -> Vec<LibraryBook> {
    let Ok(entries) = fs::read_dir(root) else { return Vec::new() };
    let mut books: Vec<LibraryBook> = entries
        .flatten()
        .filter(|entry| !is_hidden_name(&entry.file_name().to_string_lossy()))
        .map(|entry| entry.path())
        .filter(|dir| dir.is_dir())
        .filter_map(|dir| {
            let manifest: serde_json::Value =
                serde_json::from_slice(&fs::read(dir.join(LOCAL_BOOK_MANIFEST)).ok()?).ok()?;
            let text = |value: Option<&serde_json::Value>| {
                value
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
            };
            Some(LibraryBook {
                novel_id: text(manifest.get("novel_id")),
                series_id: text(manifest.get("series").and_then(|s| s.get("id"))),
                author: text(manifest.get("author")),
                has_cover: pick_cover(&dir).is_some(),
                dir,
            })
        })
        .collect();
    books.sort_by(|a, b| a.dir.cmp(&b.dir));
    books
}

pub(crate) fn sha256_file(path: &Path) -> Result<(String, u64), String> {
    let mut file = fs::File::open(path).map_err(|err| format!("não foi possível abrir o arquivo: {err}"))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut size = 0u64;
    loop {
        let read = file.read(&mut buf).map_err(|err| format!("não foi possível ler o arquivo: {err}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
        size += read as u64;
    }
    let hex = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    Ok((hex, size))
}

pub(crate) fn format_volume(volume: f64) -> String {
    if volume.fract() == 0.0 {
        format!("{}", volume as i64)
    } else {
        format!("{volume:.1}")
    }
}

/// Builds the preview of one file. `library` is the current Library (empty without a root).
pub(crate) fn build_preview(id: &str, path: &Path, library: &[LibraryBook]) -> ImportPreview {
    let file_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let stem = epub_meta::strip_epub_extension(&file_name).trim().to_string();
    let from_name = epub_meta::series_from_file_name(&file_name);
    let mut preview = ImportPreview { id: id.to_string(), file_name, ..Default::default() };

    match sha256_file(path) {
        Ok((sha, size)) => {
            preview.sha256 = sha;
            preview.size = size;
        }
        Err(err) => {
            preview.title = stem;
            preview.error = Some(err);
            return preview;
        }
    }
    let meta = match epub_meta::read_epub_meta(path) {
        Ok(meta) => meta,
        Err(err) => {
            preview.error = Some(format!("EPUB inválido: {err}"));
            Default::default()
        }
    };

    preview.title = match &from_name {
        Some(found) => found.subtitle.clone().unwrap_or_else(|| match found.volume {
            Some(volume) => format!("Volume {}", format_volume(volume)),
            None => stem.clone(),
        }),
        None => meta.title.clone().unwrap_or(stem),
    };
    let (series, source) = match (meta.series, &from_name) {
        (Some((series, source)), _) => (Some(series), Some(source)),
        (None, Some(found)) => (
            Some(epub_meta::make_series(&found.name, found.volume)),
            Some(SeriesSource::Filename),
        ),
        (None, None) => (None, None),
    };
    preview.series = series;
    preview.series_source = source;
    preview.language = meta.language;

    let key = format!("import:{}", preview.sha256);
    preview.already_imported = library
        .iter()
        .find(|book| book.novel_id.as_deref() == Some(key.as_str()))
        .map(|book| AlreadyImported { output_dir: book.dir.to_string_lossy().to_string() });
    let siblings: Vec<&LibraryBook> = match &preview.series {
        Some(series) => library
            .iter()
            .filter(|book| book.series_id.as_deref() == Some(series.id.as_str()))
            .filter(|book| book.novel_id.as_deref() != Some(key.as_str()))
            .collect(),
        None => Vec::new(),
    };
    preview.author = meta
        .author
        .or_else(|| siblings.iter().find_map(|book| book.author.clone()));
    match meta.cover {
        Some((bytes, _)) => {
            preview.cover_data_url = epub_meta::cover_thumbnail_data_url(&bytes, PREVIEW_COVER_SIDE)
        }
        None => {
            preview.cover_from_library = siblings
                .iter()
                .filter(|book| book.has_cover)
                .find_map(|book| book.novel_id.clone())
        }
    }
    preview
}

/// Native dialog (several files, .epub only). Returns an empty list when cancelled.
#[tauri::command]
pub async fn import_epub_pick<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, ImportEpubState>,
) -> Result<Vec<PickedFile>, String> {
    use tauri_plugin_dialog::DialogExt;
    let dialog = app.dialog().file().add_filter("EPUB", &["epub"]);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_files())
        .await
        .map_err(|err| err.to_string())?;
    let paths: Vec<PathBuf> = picked
        .unwrap_or_default()
        .into_iter()
        .filter_map(|file| file.into_path().ok())
        .collect();
    Ok(state.register(&paths))
}

#[tauri::command(async)]
pub fn import_epub_preview(
    state: State<'_, ImportEpubState>,
    export_root: State<'_, ExportRoot>,
    ids: Vec<String>,
) -> Vec<ImportPreview> {
    let library = export_root.current().map(|root| library_books(&root)).unwrap_or_default();
    ids.iter()
        .map(|id| match state.path_of(id) {
            Some(path) => build_preview(id, &path, &library),
            None => ImportPreview {
                id: id.clone(),
                error: Some("Arquivo não encontrado; escolha de novo".to_string()),
                ..Default::default()
            },
        })
        .collect()
}

/// Imports the previewed files (docs/IMPORT_EPUB.md): folder, marker and cover in the
/// Library, then the `import:<sha>` row of `library_meta` (private, on the shelf, dirty).
/// Importing a file already in the Library returns its folder without copying it again.
#[tauri::command(async)]
pub fn import_epub_commit(
    app: AppHandle,
    state: State<'_, ImportEpubState>,
    export_root: State<'_, ExportRoot>,
    items: Vec<ImportCommitItem>,
) -> Vec<ImportResult> {
    let root = export_root.current();
    items
        .iter()
        .map(|item| {
            let mut result = ImportResult { id: item.id.clone(), ..Default::default() };
            let committed = match (&root, state.path_of(&item.id)) {
                (None, _) => Err("Escolha a pasta da Biblioteca antes de importar".to_string()),
                (_, None) => Err("Arquivo não encontrado; escolha de novo".to_string()),
                (Some(root), Some(path)) => commit::commit_import(root, &path, item),
            };
            match committed {
                Ok(done) => {
                    // The files are already in place; a metadata failure must not fail the import
                    // (importing again creates the missing row).
                    let keys = [done.key.clone()];
                    let recorded = crate::library_meta::record_import(&app, &done.key, &done.snapshot, !done.existing)
                        .and_then(|_| crate::library_meta::mark_downloaded(&app, &keys));
                    if let Err(err) = recorded {
                        eprintln!("Warning: could not record the imported book {}: {err}", done.key);
                    }
                    result.key = done.key;
                    result.output_dir = Some(done.output_dir.to_string_lossy().to_string());
                }
                Err(err) => result.error = Some(err),
            }
            result
        })
        .collect()
}

/// Window DragDrop: registers the dropped .epub files and emits `DROPPED_EVENT`.
pub fn on_window_event<R: Runtime>(window: &tauri::Window<R>, event: &tauri::WindowEvent) {
    let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event else {
        return;
    };
    let Some(state) = window.try_state::<ImportEpubState>() else { return };
    let picked = state.register(paths);
    if !picked.is_empty() {
        let _ = window.emit(DROPPED_EVENT, picked);
    }
}
