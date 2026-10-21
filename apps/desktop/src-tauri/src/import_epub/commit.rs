//! The import itself (docs/IMPORT_EPUB.md, "Pasta e marcador"): the EPUB is copied byte for
//! byte into `<ExportRoot>/<Série> - Vol <N> - <Título>/` through the atomic staging, next to
//! `cover.<jpg|png|webp>` and the `.oghma-book.json` marker. The original is never touched.
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{epub_meta, format_volume, library_books, sha256_file, LibraryBook, SeriesInfo};
use crate::files::{pick_cover, write_atomic, LOCAL_BOOK_MANIFEST};
use crate::library_meta::IMPORT_PREFIX;
use crate::staging::{abort_export_at, begin_import_at, commit_export_at, folder_name_for_title};

/// Series as edited in the preview; the id is always recomputed from the name.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSeries {
    pub name: String,
    #[serde(default)]
    pub volume: Option<f64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCommitItem {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub series: Option<CommitSeries>,
    /// Typographic cover drawn by the app; used only when the EPUB has no cover and no other
    /// volume of the series in the Library has one.
    #[serde(default)]
    pub cover_png: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub id: String,
    /// `import:<sha256>`; empty when the file could not even be read.
    pub key: String,
    pub output_dir: Option<String>,
    pub error: Option<String>,
}

/// What a commit wrote, or found already in the Library.
#[derive(Debug)]
pub(crate) struct Committed {
    pub key: String,
    pub output_dir: PathBuf,
    /// Snapshot of the `library_meta` row (opaque JSON; the server validates it).
    pub snapshot: Value,
    /// The same file was already imported: nothing was written.
    pub existing: bool,
}

fn non_blank(text: &str) -> Option<String> {
    Some(text.trim()).filter(|text| !text.is_empty()).map(str::to_string)
}

/// Finite, not negative, at most one decimal place.
fn clean_volume(volume: f64) -> Option<f64> {
    (volume.is_finite() && volume >= 0.0).then(|| (volume * 10.0).round() / 10.0)
}

/// `<Série> - Vol <N> - <Título>`, `<Série> - <Título>` without a volume, or just the title.
pub(crate) fn folder_title(series: Option<&SeriesInfo>, title: &str) -> String {
    match series {
        Some(SeriesInfo { name, volume: Some(volume), .. }) => format!("{name} - Vol {} - {title}", format_volume(*volume)),
        Some(SeriesInfo { name, volume: None, .. }) => format!("{name} - {title}"),
        None => title.to_string(),
    }
}

/// The cover's extension by its bytes: only JPEG, PNG and WebP are kept.
fn cover_ext(bytes: &[u8]) -> Option<&'static str> {
    match image::guess_format(bytes).ok()? {
        image::ImageFormat::Jpeg => Some("jpg"),
        image::ImageFormat::Png => Some("png"),
        image::ImageFormat::WebP => Some("webp"),
        _ => None,
    }
}

/// Cover order: the EPUB's, another volume of the same series in the Library, the app's PNG.
fn choose_cover(
    epub_cover: Option<Vec<u8>>,
    siblings: &[&LibraryBook],
    cover_png: Option<&[u8]>,
) -> Option<(Vec<u8>, &'static str)> {
    let from_library = || {
        siblings.iter().filter(|book| book.has_cover).find_map(|book| fs::read(pick_cover(&book.dir)?).ok())
    };
    let app_png = || cover_png.filter(|bytes| cover_ext(bytes) == Some("png")).map(<[u8]>::to_vec);
    [epub_cover, from_library(), app_png()]
        .into_iter()
        .flatten()
        .find_map(|bytes| cover_ext(&bytes).map(|ext| (bytes, ext)))
}

/// Adds `value` under `key` when present (absent fields stay out of the JSON).
fn put(target: &mut Value, key: &str, value: Option<Value>) {
    if let (Some(value), Some(object)) = (value, target.as_object_mut()) {
        object.insert(key.to_string(), value);
    }
}

/// Imports the file at `source` into the Library at `root`. A file imported before (same
/// sha256) is not copied again: its folder is returned with `existing: true`.
pub(crate) fn commit_import(root: &Path, source: &Path, item: &ImportCommitItem) -> Result<Committed, String> {
    super::check_epub_size(source)?;
    let (sha, size) = sha256_file(source)?;
    let key = format!("{IMPORT_PREFIX}{sha}");
    let meta = epub_meta::read_epub_meta(source).map_err(|err| format!("EPUB inválido: {err}"))?;
    let source_file_name = source.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let title = non_blank(&item.title)
        .or_else(|| non_blank(epub_meta::strip_epub_extension(&source_file_name)))
        .unwrap_or_else(|| "Livro importado".to_string());
    let author = item.author.as_deref().and_then(non_blank);
    let series = item
        .series
        .as_ref()
        .filter(|series| !series.name.trim().is_empty())
        .map(|series| epub_meta::make_series(&series.name, series.volume.and_then(clean_volume)));
    let series_json = series.as_ref().map(|series| json!(series));

    let mut snapshot = json!({ "title": title, "origin": "import", "fileSize": size });
    put(&mut snapshot, "author", author.clone().map(Value::from));
    put(&mut snapshot, "language", meta.language.clone().map(Value::from));
    put(&mut snapshot, "series", series_json.clone());

    let library = library_books(root);
    if let Some(book) = library.iter().find(|book| book.novel_id.as_deref() == Some(key.as_str())) {
        let ext = pick_cover(&book.dir).and_then(|cover| fs::read(cover).ok()).and_then(|bytes| cover_ext(&bytes));
        put(&mut snapshot, "coverExt", ext.map(Value::from));
        return Ok(Committed { key, output_dir: book.dir.clone(), snapshot, existing: true });
    }

    let siblings: Vec<&LibraryBook> = match &series {
        Some(series) => library.iter().filter(|book| book.series_id.as_deref() == Some(series.id.as_str())).collect(),
        None => Vec::new(),
    };
    let cover = choose_cover(meta.cover.map(|(bytes, _)| bytes), &siblings, item.cover_png.as_deref());
    put(&mut snapshot, "coverExt", cover.as_ref().map(|(_, ext)| Value::from(*ext)));

    let mut marker = json!({
        "schema_version": 1,
        "novel_id": key,
        "origin": "import",
        "title": title,
        "source_file_name": source_file_name,
        "file_sha256": sha,
        "file_size": size,
        "generated_at": crate::translation::iso_utc(crate::translation::now_secs()),
    });
    put(&mut marker, "author", author.map(Value::from));
    put(&mut marker, "language", meta.language.map(Value::from));
    put(&mut marker, "series", series_json);

    let begun = begin_import_at(root, &key, &folder_title(series.as_ref(), &title))?;
    let staging = PathBuf::from(&begun.staging_dir);
    let written = (|| {
        let copy = staging.join(format!("{}.epub", folder_name_for_title(&title)));
        fs::copy(source, &copy).map_err(|err| format!("Não foi possível copiar o EPUB: {err}"))?;
        // The sha is the book's identity: a file that changed while importing is refused.
        if sha256_file(&copy)?.0 != sha {
            return Err("O arquivo mudou durante a importação; tente de novo".to_string());
        }
        if let Some((bytes, ext)) = &cover {
            write_atomic(&staging.join(format!("cover.{ext}")), bytes)?;
        }
        let marker = serde_json::to_vec_pretty(&marker).map_err(|err| err.to_string())?;
        write_atomic(&staging.join(LOCAL_BOOK_MANIFEST), &marker)?;
        commit_export_at(&staging, Path::new(&begun.final_dir))
    })();
    match written {
        Ok(output_dir) => Ok(Committed { key, output_dir, snapshot, existing: false }),
        Err(err) => {
            let _ = abort_export_at(&staging);
            Err(err)
        }
    }
}
