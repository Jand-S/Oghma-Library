//! What the Kindle sees of a book: the content id (EXTH 113), and for imported EPUBs
//! (`import:<sha>`, docs/IMPORT_EPUB.md "Kindle") the title "<Série> <N> – <Título>" so the
//! volumes sort in order, plus the series name.
//!
//! Series in the AZW3: only the name goes in (EXTH 112). Kindling's rewrite API maps
//! `series_index` to EXTH 113, which is the content id the Kindle uses for the thumbnail, so
//! the volume number is never written there; it is already in the title.
use std::path::Path;

use crate::files::{read_manifest, LocalBookManifest};
use crate::import_epub::SeriesInfo;

use super::{kindle_content_seed, oghma_content_id};

#[derive(Debug, Clone, PartialEq)]
pub(super) struct KindleIdentity {
    /// EXTH 113/ASIN.
    pub content_id: String,
    /// Title for the AZW3 (EXTH 503) and its file name; `None` keeps the EPUB's title.
    pub title: Option<String>,
    /// Series name for EXTH 112.
    pub series: Option<String>,
}

impl KindleIdentity {
    pub fn from_seed(seed: &str) -> Self {
        KindleIdentity { content_id: oghma_content_id(seed), title: None, series: None }
    }
}

/// The sha of an `import:<64 hex>` novel id.
fn imported_sha(novel_id: &str) -> Option<&str> {
    let sha = novel_id.strip_prefix("import:")?;
    (sha.len() == 64 && sha.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))).then_some(sha)
}

/// Content id of an imported book: the first 16 hex of its sha, so the same file gets the
/// same id on every computer and after a title or series change.
fn imported_content_id(sha: &str) -> String {
    format!("oghma-{}", &sha[..16])
}

/// 1 -> "1", 2.5 -> "2.5".
fn format_volume(volume: f64) -> String {
    if volume.fract() == 0.0 {
        format!("{}", volume as i64)
    } else {
        format!("{:.1}", volume)
    }
}

/// "<Série> <N> – <Título>"; without a volume "<Série> – <Título>"; without a series the title.
pub(super) fn kindle_title(series: Option<&SeriesInfo>, title: &str) -> String {
    let title = title.trim();
    let Some(series) = series else { return title.to_string() };
    let head = match series.volume {
        Some(volume) => format!("{} {}", series.name, format_volume(volume)),
        None => series.name.clone(),
    };
    if title.is_empty() {
        head
    } else {
        format!("{head} – {title}")
    }
}

fn imported_identity(manifest: &LocalBookManifest, fallback_title: &str) -> Option<KindleIdentity> {
    let sha = imported_sha(manifest.novel_id()?)?;
    let title = manifest
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .unwrap_or(fallback_title);
    let series = manifest.series();
    Some(KindleIdentity {
        content_id: imported_content_id(sha),
        title: Some(kindle_title(series.as_ref(), title)),
        series: series.map(|series| series.name),
    })
}

/// Identity of the book in `output_dir`: imported books by their sha, the rest by
/// `kindle_content_seed` (unchanged).
pub(super) fn kindle_identity(output_dir: &Path, title: &str) -> KindleIdentity {
    read_manifest(output_dir)
        .and_then(|manifest| imported_identity(&manifest, title))
        .unwrap_or_else(|| KindleIdentity::from_seed(&kindle_content_seed(output_dir, title)))
}
