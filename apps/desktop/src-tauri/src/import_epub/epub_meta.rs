//! Reads what the import preview needs from an EPUB without unpacking it next to the
//! original: the OPF (parsed by kindling's `OPFData` from a private temp copy), the series
//! from the OPF or the file name, and the cover bytes.
//!
//! Series sources, in this order (docs/IMPORT_EPUB.md, "Série"):
//! 1. Calibre: `<meta name="calibre:series">` + `calibre:series_index`;
//! 2. EPUB3: `<meta property="belongs-to-collection" id="c">` + `group-position` refining `#c`;
//! 3. the file name, by `FILE_NAME_SERIES`.
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use kindling::opf::OPFData;
use regex::Regex;
use serde::Serialize;

/// OPF/container larger than this is not a real EPUB metadata file.
const MAX_OPF_BYTES: u64 = 8 * 1024 * 1024;
const MAX_COVER_BYTES: u64 = 40 * 1024 * 1024;

/// Group 1 is the series, 2 the volume, 3 the subtitle (case-insensitive).
const FILE_NAME_SERIES: &str =
    r"(?i)^(.+?)\s*[-–—]\s*(?:vol(?:ume)?\.?|v\.?|livro|book)\s*(\d+(?:[.,]\d)?)(?:\s*[-–—:]\s*(.+))?$";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesInfo {
    pub id: String,
    pub name: String,
    pub volume: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SeriesSource {
    Calibre,
    Epub3,
    Filename,
}

/// What the file name says when it matches `FILE_NAME_SERIES`.
#[derive(Debug, Clone, PartialEq)]
pub struct FileNameSeries {
    pub name: String,
    pub volume: Option<f64>,
    pub subtitle: Option<String>,
}

#[derive(Debug, Default)]
pub struct EpubMeta {
    pub title: Option<String>,
    pub author: Option<String>,
    pub language: Option<String>,
    /// Series from the OPF (Calibre first, then EPUB3); the file name is handled by the caller.
    pub series: Option<(SeriesInfo, SeriesSource)>,
    /// Cover image bytes and their lowercase extension (`jpg`, `png`, `webp`, …).
    pub cover: Option<(Vec<u8>, String)>,
}

fn file_name_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(FILE_NAME_SERIES).expect("file name series regex"))
}

/// Series, volume and subtitle from a file name ("Unsheathed - Volume 1 - Caged Sparrow.epub").
pub fn series_from_file_name(file_name: &str) -> Option<FileNameSeries> {
    let stem = strip_epub_extension(file_name).trim();
    let caps = file_name_regex().captures(stem)?;
    let name = caps.get(1)?.as_str().trim().to_string();
    if name.is_empty() {
        return None;
    }
    Some(FileNameSeries {
        name,
        volume: caps.get(2).and_then(|m| parse_volume(m.as_str())),
        subtitle: caps
            .get(3)
            .map(|m| m.as_str().trim().to_string())
            .filter(|s| !s.is_empty()),
    })
}

pub fn strip_epub_extension(file_name: &str) -> &str {
    let len = file_name.len();
    if len > 5 && file_name.is_char_boundary(len - 5) && file_name[len - 5..].eq_ignore_ascii_case(".epub") {
        &file_name[..len - 5]
    } else {
        file_name
    }
}

/// A volume with at most one decimal place ("1", "2.5", "2,5", "1.0" → 1). Negative or
/// non-numeric values are `None`.
pub fn parse_volume(raw: &str) -> Option<f64> {
    let value: f64 = raw.trim().replace(',', ".").parse().ok()?;
    if !value.is_finite() || value < 0.0 {
        return None;
    }
    Some((value * 10.0).round() / 10.0)
}

fn fold_accent(ch: char) -> Option<&'static str> {
    Some(match ch {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => "a",
        'ç' | 'ć' | 'č' => "c",
        'ď' | 'đ' => "d",
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ė' | 'ę' | 'ě' => "e",
        'ì' | 'í' | 'î' | 'ï' | 'ī' | 'į' => "i",
        'ł' => "l",
        'ñ' | 'ń' | 'ň' => "n",
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ő' => "o",
        'ř' => "r",
        'ś' | 'š' | 'ş' => "s",
        'ť' | 'ţ' => "t",
        'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ů' | 'ű' => "u",
        'ý' | 'ÿ' => "y",
        'ź' | 'ż' | 'ž' => "z",
        'æ' => "ae",
        'œ' => "oe",
        'ß' => "ss",
        _ => return None,
    })
}

/// `series:<slug>`: lowercase, accents removed, runs of `[^a-z0-9]` as one `-`, no `-` at the
/// ends. A name with no Latin letters or digits (e.g. only CJK) would give an empty slug, so it
/// falls back to the first 12 hex digits of the name's sha256 to keep distinct series apart.
pub fn series_id(name: &str) -> String {
    let mut slug = String::with_capacity(name.len());
    let mut pending_dash = false;
    for ch in name.trim().chars().flat_map(char::to_lowercase) {
        let folded: String = match fold_accent(ch) {
            Some(text) => text.to_string(),
            None => ch.to_string(),
        };
        for c in folded.chars() {
            if c.is_ascii_lowercase() || c.is_ascii_digit() {
                if pending_dash && !slug.is_empty() {
                    slug.push('-');
                }
                pending_dash = false;
                slug.push(c);
            } else {
                pending_dash = true;
            }
        }
    }
    if slug.is_empty() {
        use sha2::{Digest, Sha256};
        let digest = Sha256::digest(name.trim().as_bytes());
        slug = digest.iter().take(6).map(|b| format!("{b:02x}")).collect();
    }
    format!("series:{slug}")
}

pub fn make_series(name: &str, volume: Option<f64>) -> SeriesInfo {
    let name = name.trim().to_string();
    SeriesInfo { id: series_id(&name), name, volume }
}

fn unescape_xml(text: &str) -> String {
    if !text.contains('&') {
        return text.trim().to_string();
    }
    static ENTITY: OnceLock<Regex> = OnceLock::new();
    let re = ENTITY.get_or_init(|| Regex::new(r"&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);").unwrap());
    re.replace_all(text, |caps: &regex::Captures| {
        let entity = &caps[1];
        match entity {
            "amp" => "&".to_string(),
            "lt" => "<".to_string(),
            "gt" => ">".to_string(),
            "quot" => "\"".to_string(),
            "apos" => "'".to_string(),
            _ => {
                let code = if let Some(hex) = entity.strip_prefix("#x") {
                    u32::from_str_radix(hex, 16).ok()
                } else {
                    entity[1..].parse().ok()
                };
                code.and_then(char::from_u32).map(String::from).unwrap_or_default()
            }
        }
    })
    .trim()
    .to_string()
}

fn attributes(tag_attrs: &str) -> HashMap<String, String> {
    static ATTR: OnceLock<Regex> = OnceLock::new();
    let re = ATTR.get_or_init(|| Regex::new(r#"([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')"#).unwrap());
    re.captures_iter(tag_attrs)
        .map(|caps| {
            let value = caps.get(2).or_else(|| caps.get(3)).map_or("", |m| m.as_str());
            (caps[1].to_ascii_lowercase(), unescape_xml(value))
        })
        .collect()
}

/// Series declared in the OPF: Calibre metas first, then the EPUB3 collection.
pub fn series_from_opf(opf: &str) -> Option<(SeriesInfo, SeriesSource)> {
    static META: OnceLock<Regex> = OnceLock::new();
    let meta = META.get_or_init(|| {
        Regex::new(r"(?is)<(?:opf:)?meta\b([^>]*?)(?:/>|>(.*?)</(?:opf:)?meta\s*>)").unwrap()
    });
    let metas: Vec<(HashMap<String, String>, String)> = meta
        .captures_iter(opf)
        .map(|caps| {
            let attrs = attributes(caps.get(1).map_or("", |m| m.as_str()));
            (attrs, caps.get(2).map(|m| unescape_xml(m.as_str())).unwrap_or_default())
        })
        .collect();
    let by_name = |name: &str| {
        metas
            .iter()
            .find(|(attrs, _)| attrs.get("name").is_some_and(|n| n == name))
            .and_then(|(attrs, _)| attrs.get("content").cloned())
            .filter(|value| !value.is_empty())
    };
    if let Some(name) = by_name("calibre:series") {
        let volume = by_name("calibre:series_index").and_then(|v| parse_volume(&v));
        return Some((make_series(&name, volume), SeriesSource::Calibre));
    }
    let (attrs, name) = metas.iter().find(|(attrs, text)| {
        attrs.get("property").is_some_and(|p| p == "belongs-to-collection") && !text.is_empty()
    })?;
    let volume = attrs.get("id").and_then(|id| {
        let target = format!("#{id}");
        metas
            .iter()
            .find(|(a, _)| {
                a.get("refines").is_some_and(|r| *r == target)
                    && a.get("property").is_some_and(|p| p == "group-position")
            })
            .and_then(|(_, text)| parse_volume(text))
    });
    Some((make_series(name, volume), SeriesSource::Epub3))
}

/// Removes the private OPF copy when dropped.
struct ScratchDir(PathBuf);

impl Drop for ScratchDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn read_entry(archive: &mut zip::ZipArchive<fs::File>, name: &str, limit: u64) -> Result<Vec<u8>, String> {
    let entry = archive
        .by_name(name)
        .map_err(|_| format!("o EPUB não tem {name}"))?;
    if entry.size() > limit {
        return Err(format!("{name} é grande demais"));
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .take(limit)
        .read_to_end(&mut bytes)
        .map_err(|err| format!("não foi possível ler {name}: {err}"))?;
    Ok(bytes)
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = (bytes[i] == b'%' && i + 2 < bytes.len())
            .then(|| std::str::from_utf8(&bytes[i + 1..i + 3]).ok())
            .flatten()
            .and_then(|h| u8::from_str_radix(h, 16).ok());
        match hex {
            Some(byte) => {
                out.push(byte);
                i += 3;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Joins a manifest href to the OPF folder inside the zip, resolving `.`/`..` and `%20`.
fn zip_path(opf_dir: &str, href: &str) -> String {
    let href = href.split('#').next().unwrap_or(href);
    let decoded = percent_decode(href);
    let mut parts: Vec<&str> = opf_dir.split('/').filter(|p| !p.is_empty()).collect();
    for part in decoded.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

fn image_extension(href: &str, media_type: &str) -> String {
    match media_type {
        "image/jpeg" => return "jpg".to_string(),
        "image/png" => return "png".to_string(),
        "image/webp" => return "webp".to_string(),
        _ => {}
    }
    Path::new(href)
        .extension()
        .map(|ext| ext.to_string_lossy().to_lowercase())
        .map(|ext| if ext == "jpeg" { "jpg".to_string() } else { ext })
        .unwrap_or_else(|| "jpg".to_string())
}

/// The cover href: kindling's method (`coverimage` / `<meta name="cover">`), then the EPUB3
/// `cover-image` property, then the first manifest image with "cover" in its id or href.
fn cover_href(opf: &OPFData) -> Option<(String, String)> {
    let media_of = |href: &str| {
        opf.manifest_items
            .iter()
            .find(|item| item.href == href)
            .map(|item| item.media_type.clone())
            .unwrap_or_default()
    };
    if let Some(href) = opf.get_cover_image_href() {
        let media = media_of(&href);
        return Some((href, media));
    }
    let images = || opf.manifest_items.iter().filter(|item| item.media_type.starts_with("image/"));
    images()
        .find(|item| item.properties.split_whitespace().any(|p| p == "cover-image"))
        .or_else(|| {
            images().find(|item| {
                item.id.to_lowercase().contains("cover") || item.href.to_lowercase().contains("cover")
            })
        })
        .map(|item| (item.href.clone(), item.media_type.clone()))
}

fn language_declared(opf: &str) -> bool {
    static LANG: OnceLock<Regex> = OnceLock::new();
    LANG.get_or_init(|| Regex::new(r"(?i)<(?:dc:)?language\b[^>]*>\s*[^<\s]").unwrap())
        .is_match(opf)
}

fn non_empty(text: &str) -> Option<String> {
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

/// Opens the EPUB as a zip, parses its OPF with kindling and reads the cover. The EPUB
/// itself is never written to; the OPF copy lives in a private temp folder.
pub fn read_epub_meta(path: &Path) -> Result<EpubMeta, String> {
    let file = fs::File::open(path).map_err(|err| format!("não foi possível abrir o arquivo: {err}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|_| "o arquivo não é um EPUB (zip) válido".to_string())?;
    let container = String::from_utf8_lossy(&read_entry(&mut archive, "META-INF/container.xml", MAX_OPF_BYTES)?).to_string();
    static ROOTFILE: OnceLock<Regex> = OnceLock::new();
    let opf_name = ROOTFILE
        .get_or_init(|| Regex::new(r#"full-path\s*=\s*["']([^"']+)["']"#).unwrap())
        .captures(&container)
        .map(|caps| unescape_xml(&caps[1]))
        .ok_or_else(|| "o EPUB não indica o arquivo OPF".to_string())?;
    let opf_bytes = read_entry(&mut archive, &opf_name, MAX_OPF_BYTES)?;
    let opf_text = String::from_utf8_lossy(&opf_bytes).to_string();

    let scratch = ScratchDir(std::env::temp_dir().join(format!("oghma-import-opf-{}", crate::files::unique_suffix())));
    fs::create_dir_all(&scratch.0).map_err(|err| format!("pasta temporária: {err}"))?;
    let opf_copy = scratch.0.join("content.opf");
    fs::write(&opf_copy, &opf_bytes).map_err(|err| format!("pasta temporária: {err}"))?;
    let opf = OPFData::parse(&opf_copy).map_err(|err| format!("OPF inválido: {err}"))?;

    let opf_dir = opf_name.rsplit_once('/').map_or("", |(dir, _)| dir);
    let cover = cover_href(&opf).and_then(|(href, media)| {
        let bytes = read_entry(&mut archive, &zip_path(opf_dir, &href), MAX_COVER_BYTES).ok()?;
        (!bytes.is_empty()).then(|| (bytes, image_extension(&href, &media)))
    });

    Ok(EpubMeta {
        title: non_empty(&opf.title),
        author: non_empty(&opf.author),
        language: language_declared(&opf_text).then(|| non_empty(&opf.language)).flatten(),
        series: series_from_opf(&opf_text),
        cover,
    })
}

/// JPEG data URL of the cover, at most `max_side` px on the longer side.
pub fn cover_thumbnail_data_url(bytes: &[u8], max_side: u32) -> Option<String> {
    use base64::Engine as _;
    let image = image::load_from_memory(bytes).ok()?;
    let image = if image.width() > max_side || image.height() > max_side {
        image.thumbnail(max_side, max_side)
    } else {
        image
    };
    let mut out = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 85);
    image.to_rgb8().write_with_encoder(encoder).ok()?;
    Some(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&out)
    ))
}
