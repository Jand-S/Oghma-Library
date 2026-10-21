//! Send to Kindle (wireless) gets the EPUB itself. When it has no cover, or an imported
//! book needs its Kindle title, the app hands over a temporary copy with the folder cover
//! embedded and the title set. The original in the Library is never written to: its sha
//! is the book's identity (docs/IMPORT_EPUB.md, "Kindle").
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};

use image::codecs::jpeg::JpegEncoder;
use regex::Regex;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use super::imported::KindleIdentity;
use crate::files::{pick_cover, unique_suffix};
use crate::import_epub::epub_meta::{opf_entry_name, read_entry, read_epub_meta, zip_path, MAX_OPF_BYTES};
use crate::paths::safe_export_stem;

const COVER_ID: &str = "oghma-cover-image";
/// Copies older than this are left over from earlier sends (the Amazon app reads them
/// after the command returns, so they cannot be removed right away).
const STALE_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

/// The cover as JPEG (Kindle and Send to Kindle do not read WebP).
pub(super) fn cover_jpeg(cover: &Path) -> Result<Vec<u8>, String> {
    let image = image::ImageReader::open(cover)
        .map_err(|err| format!("Não foi possível abrir a capa local: {err}"))?
        .with_guessed_format()
        .map_err(|err| format!("Formato de capa local inválido: {err}"))?
        .decode()
        .map_err(|err| format!("Não foi possível decodificar a capa local: {err}"))?;
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, 90)
        .encode_image(&image)
        .map_err(|err| format!("Não foi possível preparar a capa para o Kindle: {err}"))?;
    Ok(bytes)
}

fn temp_root() -> PathBuf {
    std::env::temp_dir().join("oghma-send-to-kindle")
}

fn remove_stale_copies(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|modified| SystemTime::now().duration_since(modified).ok())
            .is_some_and(|age| age > STALE_AFTER);
        if old {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

/// The file to open in Send to Kindle: the original EPUB, or a temporary copy when the EPUB
/// has no cover (and the folder has one) or the Kindle title differs from the EPUB's. Any
/// failure falls back to the original.
pub(super) fn wireless_epub(output_dir: &Path, epub: &Path, identity: &KindleIdentity) -> PathBuf {
    wireless_epub_in(&temp_root(), output_dir, epub, identity)
}

pub(super) fn wireless_epub_in(temp: &Path, output_dir: &Path, epub: &Path, identity: &KindleIdentity) -> PathBuf {
    let Ok(meta) = read_epub_meta(epub) else { return epub.to_path_buf() };
    let cover = meta.cover.is_none().then(|| pick_cover(output_dir)).flatten();
    let title = identity
        .title
        .as_deref()
        .filter(|title| meta.title.as_deref().map(str::trim) != Some(title.trim()));
    if cover.is_none() && title.is_none() {
        return epub.to_path_buf();
    }
    remove_stale_copies(temp);
    let stem = identity
        .title
        .clone()
        .or_else(|| epub.file_stem().map(|stem| stem.to_string_lossy().to_string()))
        .unwrap_or_default();
    let dest = temp.join(unique_suffix()).join(format!("{}.epub", safe_export_stem(&stem)));
    let result = cover
        .as_deref()
        .map(cover_jpeg)
        .transpose()
        .and_then(|jpeg| write_patched_copy(epub, &dest, jpeg.as_deref(), title));
    match result {
        Ok(()) => dest,
        Err(err) => {
            eprintln!("Warning: Send to Kindle vai receber o EPUB original: {err}");
            if let Some(dir) = dest.parent() {
                let _ = fs::remove_dir_all(dir);
            }
            epub.to_path_buf()
        }
    }
}

fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Inserts `insert` right before the closing tag `</prefix:name>` and returns the prefix.
fn insert_before_close(opf: &mut String, name: &str, insert: impl Fn(&str) -> String) -> Result<(), String> {
    let re = Regex::new(&format!(r"</((?:[\w.-]+:)?){name}\s*>")).unwrap();
    let caps = re.captures(opf).ok_or_else(|| format!("OPF sem </{name}>"))?;
    let (at, prefix) = (caps.get(0).unwrap().start(), caps[1].to_string());
    opf.insert_str(at, &insert(&prefix));
    Ok(())
}

/// Adds the cover item (and `<meta name="cover">`, replacing a broken one) and sets `dc:title`.
pub(super) fn patch_opf(opf: &str, cover_href: Option<&str>, title: Option<&str>) -> Result<String, String> {
    let mut opf = opf.to_string();
    if let Some(href) = cover_href {
        static VERSION3: OnceLock<Regex> = OnceLock::new();
        static META_COVER: OnceLock<Regex> = OnceLock::new();
        let epub3 = VERSION3
            .get_or_init(|| Regex::new(r#"<(?:[\w.-]+:)?package\b[^>]*\bversion\s*=\s*["']3"#).unwrap())
            .is_match(&opf);
        opf = META_COVER
            .get_or_init(|| Regex::new(r#"<(?:[\w.-]+:)?meta\b[^>]*\bname\s*=\s*["']cover["'][^>]*/>"#).unwrap())
            .replace_all(&opf, "")
            .to_string();
        let properties = if epub3 { r#" properties="cover-image""# } else { "" };
        let href = escape_xml(href);
        insert_before_close(&mut opf, "manifest", |p| {
            format!(r#"<{p}item id="{COVER_ID}" href="{href}" media-type="image/jpeg"{properties}/>"#)
        })?;
        insert_before_close(&mut opf, "metadata", |p| format!(r#"<{p}meta name="cover" content="{COVER_ID}"/>"#))?;
    }
    if let Some(title) = title {
        static TITLE: OnceLock<Regex> = OnceLock::new();
        let re = TITLE.get_or_init(|| Regex::new(r"(?s)(<dc:title\b[^>]*>).*?(</dc:title\s*>)").unwrap());
        let escaped = escape_xml(title);
        if re.is_match(&opf) {
            opf = re.replacen(&opf, 1, |caps: &regex::Captures| format!("{}{escaped}{}", &caps[1], &caps[2])).to_string();
        } else {
            insert_before_close(&mut opf, "metadata", |_| format!("<dc:title>{escaped}</dc:title>"))?;
        }
    }
    Ok(opf)
}

/// Writes a copy of `epub` at `dest` with every entry copied raw except the OPF, plus the cover.
fn write_patched_copy(epub: &Path, dest: &Path, cover: Option<&[u8]>, title: Option<&str>) -> Result<(), String> {
    let file = fs::File::open(epub).map_err(|err| format!("não foi possível abrir o EPUB: {err}"))?;
    let mut archive = ZipArchive::new(file).map_err(|_| "o EPUB não é um zip válido".to_string())?;
    let opf_name = opf_entry_name(&mut archive)?;
    let opf_dir = opf_name.rsplit_once('/').map_or("", |(dir, _)| dir);
    let cover_href = cover.map(|_| {
        (0..)
            .map(|n| if n == 0 { "oghma-cover.jpg".to_string() } else { format!("oghma-cover-{n}.jpg") })
            .find(|href| archive.index_for_name(&zip_path(opf_dir, href)).is_none())
            .unwrap()
    });
    let opf = String::from_utf8_lossy(&read_entry(&mut archive, &opf_name, MAX_OPF_BYTES)?).to_string();
    let opf = patch_opf(&opf, cover_href.as_deref(), title)?;

    let parent = dest.parent().ok_or("destino inválido")?;
    fs::create_dir_all(parent).map_err(|err| format!("pasta temporária: {err}"))?;
    let mut write = || -> zip::result::ZipResult<()> {
        let mut out = ZipWriter::new(fs::File::create(dest)?);
        for index in 0..archive.len() {
            let entry = archive.by_index_raw(index)?;
            if entry.name() == opf_name {
                drop(entry);
                let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
                out.start_file(opf_name.as_str(), deflated)?;
                out.write_all(opf.as_bytes())?;
            } else {
                out.raw_copy_file(entry)?;
            }
        }
        if let (Some(bytes), Some(href)) = (cover, &cover_href) {
            let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
            out.start_file(zip_path(opf_dir, href), stored)?;
            out.write_all(bytes)?;
        }
        out.finish()?;
        Ok(())
    };
    write().map_err(|err| format!("não foi possível gravar a cópia do EPUB: {err}"))
}
