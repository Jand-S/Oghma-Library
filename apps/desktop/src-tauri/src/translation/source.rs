//! Source EPUB reading and a small tag-aware HTML block splitter.
//!
//! Why a hand-written splitter instead of `scraper`/`html5ever` (already in the
//! tree through kindling-mobi): the contract asks to keep each block's HTML
//! exactly as it is in the book, and a DOM round-trip re-serializes it
//! (attribute quoting, entities, implied tags). The input is XHTML written by
//! the app (well-formed), and the model output is a flat list of block
//! elements, so a depth-tracking scanner with void-element and implicit-`</p>`
//! handling is enough, keeps the bytes untouched, and costs no dependency.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use regex::Regex;

const VOID_TAGS: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
];
const BLOCK_TAGS: &[&str] = &[
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "div", "ul", "ol", "dl", "blockquote", "hr", "table", "pre",
    "section", "figure", "aside", "header", "footer",
];
const XHTML_NS: &str = " xmlns=\"http://www.w3.org/1999/xhtml\"";

#[derive(Debug, Clone)]
struct Tag {
    name: String,
    closing: bool,
    self_closing: bool,
    /// Byte index just past the closing `>`.
    end: usize,
}

/// Parses the tag starting at `start` (`s[start] == '<'`). Returns `None` for a
/// `<` that does not start a tag (it is then plain text).
fn parse_tag(s: &str, start: usize) -> Option<Tag> {
    let bytes = s.as_bytes();
    let mut i = start + 1;
    let closing = bytes.get(i) == Some(&b'/');
    if closing {
        i += 1;
    }
    let name_start = i;
    while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || matches!(bytes[i], b':' | b'-' | b'_')) {
        i += 1;
    }
    if i == name_start || !bytes[name_start].is_ascii_alphabetic() {
        return None;
    }
    let name = s[name_start..i].to_ascii_lowercase();
    let mut quote: Option<u8> = None;
    while i < bytes.len() {
        let b = bytes[i];
        match quote {
            Some(q) if b == q => quote = None,
            Some(_) => {}
            None if b == b'"' || b == b'\'' => quote = Some(b),
            None if b == b'>' => {
                let self_closing = i > start && bytes[i - 1] == b'/';
                return Some(Tag { name, closing, self_closing, end: i + 1 });
            }
            None => {}
        }
        i += 1;
    }
    None
}

/// Skips `<!-- -->`, `<!DOCTYPE>`, `<?xml?>`; returns the index after it.
fn skip_special(s: &str, i: usize) -> Option<usize> {
    let rest = &s[i..];
    if rest.starts_with("<!--") {
        return Some(rest.find("-->").map(|p| i + p + 3).unwrap_or(s.len()));
    }
    if rest.starts_with("<!") || rest.starts_with("<?") {
        return Some(rest.find('>').map(|p| i + p + 1).unwrap_or(s.len()));
    }
    None
}

/// End (exclusive) of the element whose start tag ends at `from`.
fn element_end(s: &str, from: usize, root: &str) -> usize {
    let mut stack = vec![root.to_string()];
    let mut j = from;
    while let Some(offset) = s[j..].find('<') {
        let at = j + offset;
        if let Some(next) = skip_special(s, at) {
            j = next;
            continue;
        }
        let Some(tag) = parse_tag(s, at) else {
            j = at + 1;
            continue;
        };
        if tag.closing {
            if let Some(pos) = stack.iter().rposition(|name| *name == tag.name) {
                stack.truncate(pos);
            }
            if stack.is_empty() {
                return tag.end;
            }
        } else if !(tag.self_closing || VOID_TAGS.contains(&tag.name.as_str())) {
            // `<p>a<p>b`: an unclosed paragraph ends where the next block starts.
            if root == "p" && stack.len() == 1 && BLOCK_TAGS.contains(&tag.name.as_str()) {
                return at;
            }
            stack.push(tag.name);
        }
        j = tag.end;
    }
    s.len()
}

/// Inner HTML of `<body>`, or the whole string when there is no body.
pub fn body_inner(html: &str) -> &str {
    let lower = html.to_ascii_lowercase();
    let Some(open) = lower.find("<body") else { return html };
    let Some(gt) = lower[open..].find('>') else { return html };
    let start = open + gt + 1;
    let end = lower.rfind("</body>").filter(|end| *end >= start).unwrap_or(html.len());
    &html[start..end]
}

/// Top-level children of `<body>` (or of the fragment). Bare text runs become `<p>`.
pub fn split_blocks(html: &str) -> Vec<String> {
    let s = body_inner(html);
    let mut blocks = Vec::new();
    let mut i = 0;
    while i < s.len() {
        let rest = &s[i..];
        if rest.starts_with('<') {
            if let Some(next) = skip_special(s, i) {
                i = next;
                continue;
            }
            if let Some(tag) = parse_tag(s, i) {
                if tag.closing {
                    i = tag.end;
                    continue;
                }
                let end = if tag.self_closing || VOID_TAGS.contains(&tag.name.as_str()) {
                    tag.end
                } else {
                    element_end(s, tag.end, &tag.name)
                };
                blocks.push(s[i..end].trim_end().to_string());
                i = end;
                continue;
            }
        }
        // Text run (or a lone `<` that is not a tag) up to the next `<`.
        let skip = if rest.starts_with('<') { 1 } else { 0 };
        let next = rest[skip..].find('<').map(|p| i + skip + p).unwrap_or(s.len());
        let text = s[i..next].trim();
        if !text.is_empty() {
            blocks.push(format!("<p>{text}</p>"));
        }
        i = next.max(i + 1);
    }
    blocks
}

/// Lower-case name of the first tag of a block (`p`, `h1`, …).
pub fn block_tag(block: &str) -> Option<String> {
    let at = block.find('<')?;
    parse_tag(block, at).filter(|tag| !tag.closing).map(|tag| tag.name)
}

/// Removes the redundant XHTML namespace the app's serializer puts on every block.
pub fn strip_xhtml_ns(block: &str) -> String {
    block.replace(XHTML_NS, "")
}

pub fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(pos) = rest.find('&') {
        out.push_str(&rest[..pos]);
        let tail = &rest[pos..];
        let semi = tail[..tail.len().min(12)].find(';');
        let decoded = semi.and_then(|semi| {
            let name = &tail[1..semi];
            let ch = match name {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some('\u{a0}'),
                "mdash" => Some('—'),
                "ndash" => Some('–'),
                "hellip" => Some('…'),
                "lsquo" => Some('‘'),
                "rsquo" => Some('’'),
                "ldquo" => Some('“'),
                "rdquo" => Some('”'),
                _ if name.starts_with("#x") || name.starts_with("#X") => {
                    u32::from_str_radix(&name[2..], 16).ok().and_then(char::from_u32)
                }
                _ if name.starts_with('#') => name[1..].parse::<u32>().ok().and_then(char::from_u32),
                _ => None,
            }?;
            Some((ch, semi + 1))
        });
        match decoded {
            Some((ch, len)) => {
                out.push(ch);
                rest = &tail[len..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Visible text, tags replaced by spaces, entities decoded, whitespace collapsed
/// (like BeautifulSoup `get_text(" ", strip=True)`).
pub fn text_of(html: &str) -> String {
    let mut raw = String::with_capacity(html.len());
    let mut i = 0;
    while i < html.len() {
        let rest = &html[i..];
        if rest.starts_with('<') {
            if let Some(next) = skip_special(html, i) {
                i = next;
                raw.push(' ');
                continue;
            }
            if let Some(tag) = parse_tag(html, i) {
                i = tag.end;
                raw.push(' ');
                continue;
            }
        }
        let next = rest[1..].find('<').map(|p| i + 1 + p).unwrap_or(html.len());
        raw.push_str(&html[i..next]);
        i = next;
    }
    decode_entities(&raw).split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn word_count(html: &str) -> usize {
    text_of(html).split_whitespace().count()
}

pub fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

// ---------------------------------------------------------------------------
// EPUB
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct SourceChapter {
    /// 1-based position among the extracted chapters.
    pub index: u32,
    pub title: String,
    pub href: String,
    pub blocks: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct SourceAsset {
    /// Path relative to the OPF folder (`assets/a.png`).
    pub href: String,
    pub media_type: String,
}

#[derive(Debug, Clone)]
pub struct SourceBook {
    pub chapters: Vec<SourceChapter>,
    pub assets: Vec<SourceAsset>,
    /// Folder of the OPF inside the zip (`OEBPS`), empty for the root.
    pub opf_dir: String,
}

fn attr_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')"#).unwrap())
}

fn attrs(tag: &str) -> HashMap<String, String> {
    attr_re()
        .captures_iter(tag)
        .map(|c| {
            let value = c.get(2).or_else(|| c.get(3)).map(|m| m.as_str()).unwrap_or("");
            (c[1].to_ascii_lowercase(), decode_entities(value))
        })
        .collect()
}

/// All start tags named `name` (`item`, `itemref`, `rootfile`) with their attributes.
fn tags_named(xml: &str, name: &str) -> Vec<HashMap<String, String>> {
    let mut out = Vec::new();
    let needle = format!("<{name}");
    let mut from = 0;
    while let Some(pos) = xml[from..].find(&needle) {
        let at = from + pos;
        let after = xml.as_bytes().get(at + needle.len()).copied().unwrap_or(b'>');
        if !(after.is_ascii_whitespace() || after == b'/' || after == b'>') {
            from = at + needle.len();
            continue;
        }
        let end = xml[at..].find('>').map(|p| at + p + 1).unwrap_or(xml.len());
        out.push(attrs(&xml[at..end]));
        from = end;
    }
    out
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(byte) = hex.and_then(|hex| u8::from_str_radix(hex, 16).ok()) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn join_zip(dir: &str, href: &str) -> String {
    let href = href.split('#').next().unwrap_or(href);
    let mut parts: Vec<&str> = if dir.is_empty() { Vec::new() } else { dir.split('/').collect() };
    for part in href.split('/') {
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

fn read_entry<R: Read + std::io::Seek>(zip: &mut zip::ZipArchive<R>, name: &str) -> Option<String> {
    let mut file = zip.by_name(name).ok()?;
    let mut text = String::new();
    file.read_to_string(&mut text).ok()?;
    Some(text)
}

pub fn read_entry_bytes(epub: &Path, name: &str) -> Option<Vec<u8>> {
    let file = fs::File::open(epub).ok()?;
    let mut zip = zip::ZipArchive::new(file).ok()?;
    let mut entry = zip.by_name(name).ok()?;
    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes).ok()?;
    Some(bytes)
}

/// The book's EPUB inside its library folder (the one named like the folder wins).
pub fn find_epub(dir: &Path) -> Result<PathBuf, String> {
    let mut found: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(|err| format!("Não foi possível ler a pasta do livro: {err}"))?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("epub"))
                && !path
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with('.'))
        })
        .collect();
    found.sort();
    let folder = dir.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
    let preferred = found
        .iter()
        .position(|path| path.file_stem().is_some_and(|stem| stem.to_string_lossy() == folder))
        .unwrap_or(0);
    found
        .get(preferred)
        .cloned()
        .ok_or_else(|| "Nenhum EPUB encontrado na pasta do livro".to_string())
}

fn title_of(xhtml: &str, blocks: &[String], index: u32) -> String {
    if let Some(heading) = blocks
        .iter()
        .find(|block| block_tag(block).is_some_and(|tag| tag.len() == 2 && tag.starts_with('h')))
    {
        let text = text_of(heading);
        if !text.is_empty() {
            return text;
        }
    }
    let lower = xhtml.to_ascii_lowercase();
    if let (Some(open), Some(close)) = (lower.find("<title>"), lower.find("</title>")) {
        let text = text_of(&xhtml[open + 7..close.max(open + 7)]);
        if !text.is_empty() {
            return text;
        }
    }
    format!("Capítulo {index}")
}

/// Reads the spine of an EPUB: nav, cover and `linear="no"` items are skipped;
/// each chapter's blocks are the top-level children of `<body>`.
pub fn read_epub(path: &Path) -> Result<SourceBook, String> {
    let file = fs::File::open(path).map_err(|err| format!("Não foi possível abrir o EPUB: {err}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|err| format!("EPUB inválido: {err}"))?;

    let opf_path = read_entry(&mut zip, "META-INF/container.xml")
        .and_then(|container| {
            tags_named(&container, "rootfile")
                .into_iter()
                .find_map(|attrs| attrs.get("full-path").cloned())
        })
        .unwrap_or_else(|| "OEBPS/content.opf".to_string());
    let opf = read_entry(&mut zip, &opf_path).ok_or_else(|| "EPUB sem content.opf".to_string())?;
    let opf_dir = opf_path.rsplit_once('/').map(|(dir, _)| dir.to_string()).unwrap_or_default();

    let items = tags_named(&opf, "item");
    let by_id: HashMap<String, &HashMap<String, String>> = items
        .iter()
        .filter_map(|item| Some((item.get("id")?.clone(), item)))
        .collect();

    let mut chapters = Vec::new();
    let mut texts = Vec::new();
    for itemref in tags_named(&opf, "itemref") {
        if itemref.get("linear").is_some_and(|linear| linear == "no") {
            continue;
        }
        let Some(item) = itemref.get("idref").and_then(|id| by_id.get(id)) else { continue };
        let id = item.get("id").map(String::as_str).unwrap_or("");
        let href = percent_decode(item.get("href").map(String::as_str).unwrap_or(""));
        let properties = item.get("properties").map(String::as_str).unwrap_or("");
        let media = item.get("media-type").map(String::as_str).unwrap_or("");
        if properties.split_whitespace().any(|p| p == "nav")
            || id.to_ascii_lowercase().contains("cover")
            || href.to_ascii_lowercase().contains("cover")
            || !(media.contains("html") || href.ends_with("html") || href.ends_with(".htm"))
        {
            continue;
        }
        let Some(xhtml) = read_entry(&mut zip, &join_zip(&opf_dir, &href)) else { continue };
        let blocks: Vec<String> = split_blocks(&xhtml).iter().map(|block| strip_xhtml_ns(block)).collect();
        if blocks.is_empty() {
            continue;
        }
        let index = chapters.len() as u32 + 1;
        let title = title_of(&xhtml, &blocks, index);
        texts.push(blocks.join("\n"));
        chapters.push(SourceChapter { index, title, href, blocks });
    }
    if chapters.is_empty() {
        return Err("O EPUB não tem capítulos com texto".to_string());
    }

    let assets = items
        .iter()
        .filter_map(|item| {
            let media = item.get("media-type")?.clone();
            let href = percent_decode(item.get("href")?);
            let properties = item.get("properties").map(String::as_str).unwrap_or("");
            let name = href.rsplit('/').next().unwrap_or(&href).to_string();
            if !media.starts_with("image/")
                || properties.contains("cover-image")
                || name.to_ascii_lowercase().starts_with("cover.")
                || !texts.iter().any(|text| text.contains(&name))
            {
                return None;
            }
            Some(SourceAsset { href, media_type: media })
        })
        .collect();

    Ok(SourceBook { chapters, assets, opf_dir })
}

#[cfg(test)]
pub(crate) mod test_epub {
    use std::io::Write;
    use std::path::Path;

    use zip::write::SimpleFileOptions;

    fn xhtml_doc(title: &str, body: &str) -> String {
        format!(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<!DOCTYPE html>\n<html xmlns=\"http://www.w3.org/1999/xhtml\" lang=\"pt-BR\">\n<head><title>{title}</title><link rel=\"stylesheet\" type=\"text/css\" href=\"../style.css\"/></head>\n<body>{body}</body>\n</html>"
        )
    }

    /// Writes an EPUB in the same structure as `buildEpub` in `downloadManager.ts`
    /// (cover page, nav, `chapters/chapter-N.xhtml` with `<h1>` + `<p>`s carrying the
    /// XHTML namespace, `assets/`).
    pub fn write_app_epub(path: &Path, chapters: &[(&str, Vec<String>)], with_cover: bool) {
        let file = std::fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let stored = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        let deflated = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("mimetype", stored).unwrap();
        zip.write_all(b"application/epub+zip").unwrap();
        zip.start_file("META-INF/container.xml", deflated).unwrap();
        zip.write_all(br#"<?xml version="1.0" encoding="utf-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#).unwrap();
        let ns = " xmlns=\"http://www.w3.org/1999/xhtml\"";
        let manifest: Vec<String> = (1..=chapters.len())
            .map(|i| format!("<item id=\"chapter-{i}\" href=\"chapters/chapter-{i}.xhtml\" media-type=\"application/xhtml+xml\"/>"))
            .collect();
        let spine: Vec<String> = (1..=chapters.len()).map(|i| format!("<itemref idref=\"chapter-{i}\"/>")).collect();
        let cover_manifest = if with_cover {
            "<item id=\"cover-page\" href=\"cover.xhtml\" media-type=\"application/xhtml+xml\"/>\n    <item id=\"cover-image\" href=\"cover.png\" media-type=\"image/png\" properties=\"cover-image\"/>"
        } else {
            ""
        };
        let opf = format!(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"book-id\">\n  <metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:identifier id=\"book-id\">oghma:test</dc:identifier><dc:title>Test</dc:title><dc:language>pt-BR</dc:language></metadata>\n  <manifest>\n    <item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>\n    <item id=\"style\" href=\"style.css\" media-type=\"text/css\"/>\n    {cover_manifest}\n    {}\n    <item id=\"asset-1\" href=\"assets/map.png\" media-type=\"image/png\"/>\n  </manifest>\n  <spine>\n    {}\n    {}\n  </spine>\n</package>",
            manifest.join("\n    "),
            if with_cover { "<itemref idref=\"cover-page\" linear=\"no\"/>" } else { "" },
            spine.join("\n    ")
        );
        zip.start_file("OEBPS/content.opf", deflated).unwrap();
        zip.write_all(opf.as_bytes()).unwrap();
        zip.start_file("OEBPS/nav.xhtml", deflated).unwrap();
        zip.write_all(xhtml_doc("Sumario", "<nav><h1>Sumario</h1><ol></ol></nav>").as_bytes()).unwrap();
        if with_cover {
            zip.start_file("OEBPS/cover.xhtml", deflated).unwrap();
            zip.write_all(xhtml_doc("Capa", "<section class=\"cover-page\"><img src=\"cover.png\" alt=\"T\" /></section>").as_bytes()).unwrap();
            zip.start_file("OEBPS/cover.png", stored).unwrap();
            zip.write_all(b"\x89PNG fake").unwrap();
        }
        zip.start_file("OEBPS/style.css", deflated).unwrap();
        zip.write_all(b"body{font-family:serif;}").unwrap();
        for (i, (title, paragraphs)) in chapters.iter().enumerate() {
            let mut body = format!("<h1{ns}>{title}</h1>");
            for p in paragraphs {
                body.push_str(&format!("<p{ns}>{p}</p>"));
            }
            zip.start_file(format!("OEBPS/chapters/chapter-{}.xhtml", i + 1), deflated).unwrap();
            zip.write_all(xhtml_doc(title, &body).as_bytes()).unwrap();
        }
        zip.start_file("OEBPS/assets/map.png", stored).unwrap();
        zip.write_all(b"\x89PNG map").unwrap();
        zip.finish().unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::test_support::TempDir;

    #[test]
    fn splits_top_level_blocks_and_keeps_html() {
        let html = "<html><body>\n<h1 class=\"t\">Title</h1>\n<p>One <em>two</em></p><!-- c --><p>Three<br/>four</p>\n<hr/>\n<div><p>a</p><p>b</p></div>loose text</body></html>";
        let blocks = split_blocks(html);
        assert_eq!(
            blocks,
            vec![
                "<h1 class=\"t\">Title</h1>",
                "<p>One <em>two</em></p>",
                "<p>Three<br/>four</p>",
                "<hr/>",
                "<div><p>a</p><p>b</p></div>",
                "<p>loose text</p>",
            ]
        );
    }

    #[test]
    fn splitter_tolerates_model_html() {
        // Unclosed paragraphs, `<br>` without slash, `>` inside attributes, stray close tags.
        let html = "<p>Um<br>dois<p>tres</p></span><p title=\"a>b\">quatro</p>";
        let blocks = split_blocks(html);
        assert_eq!(blocks, vec!["<p>Um<br>dois", "<p>tres</p>", "<p title=\"a>b\">quatro</p>"]);
        assert_eq!(block_tag("<h2 x='1'>t</h2>").as_deref(), Some("h2"));
    }

    #[test]
    fn text_of_decodes_entities_and_collapses_space() {
        assert_eq!(text_of("<p>Tom &amp; Jerry&#8217;s  <em>cat</em></p>\n<p>x&nbsp;y</p>"), "Tom & Jerry’s cat x y");
        assert_eq!(word_count("<p>one two</p><p>three</p>"), 3);
        assert_eq!(decode_entities("a &unknown; b &#x41;"), "a &unknown; b A");
    }

    #[test]
    fn reads_app_generated_epub() {
        let dir = TempDir::new("epub-read");
        let path = dir.path().join("Livro.epub");
        test_epub::write_app_epub(
            &path,
            &[
                ("Chapter One", vec!["Hello <em>there</em>.".into(), "See <img src=\"../assets/map.png\"/>".into()]),
                ("Chapter Two", vec!["Second.".into()]),
            ],
            true,
        );
        let book = read_epub(&path).unwrap();
        assert_eq!(book.opf_dir, "OEBPS");
        assert_eq!(book.chapters.len(), 2, "nav and cover are skipped");
        let first = &book.chapters[0];
        assert_eq!(first.index, 1);
        assert_eq!(first.title, "Chapter One");
        assert_eq!(first.href, "chapters/chapter-1.xhtml");
        assert_eq!(
            first.blocks,
            vec!["<h1>Chapter One</h1>", "<p>Hello <em>there</em>.</p>", "<p>See <img src=\"../assets/map.png\"/></p>"]
        );
        assert_eq!(book.chapters[1].blocks.len(), 2);
        assert_eq!(book.assets.len(), 1);
        assert_eq!(book.assets[0].href, "assets/map.png");
        assert_eq!(find_epub(dir.path()).unwrap(), path);
    }
}
