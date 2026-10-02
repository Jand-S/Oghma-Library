//! The PT-BR library book: an EPUB with the same structure `buildEpub` writes in
//! `services/downloadManager.ts` (`OEBPS/content.opf`, `nav.xhtml`,
//! `chapters/chapter-N.xhtml`, `style.css`, cover), published as a sibling of the
//! source book through the staging flow of `src/staging.rs`.

use std::collections::BTreeSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use regex::Regex;
use serde_json::json;
use zip::write::SimpleFileOptions;

use super::source::{
    decode_entities, join_zip, parse_tag, read_epub, skip_special, split_blocks, text_of, word_count, xml_escape,
    BLOCK_TAGS, VOID_TAGS,
};
use super::{events, iso_utc, now_secs, Engine, ExportResult, ProjectStatus};
use crate::files::{pick_cover, write_export_file, LOCAL_BOOK_MANIFEST};
use crate::paths::sanitize_file_name;
use crate::staging::{abort_export_at, begin_export_at, commit_export_at, meta_keys_for};

pub const LANGUAGE: &str = "pt-BR";
const STYLE_CSS: &str = "body{font-family:serif;line-height:1.55;margin:5%;} h1{font-size:1.35em;} img{display:block;width:100%;max-width:100%;height:auto;object-fit:contain;margin:1em auto;} .cover-page{margin:0;text-align:center;} .cover-page img{width:100%;max-height:95vh;object-fit:contain;}";

pub struct EpubChapter {
    pub title: String,
    /// XHTML fragment (the translated blocks, `<h1>` included).
    pub body: String,
}

pub struct EpubAsset {
    /// Path relative to `OEBPS/` (`assets/map.png`).
    pub href: String,
    pub media_type: String,
    pub data: Vec<u8>,
}

pub struct EpubCover {
    /// `cover.jpg`, `cover.png`, …
    pub name: String,
    pub media_type: String,
    pub data: Vec<u8>,
}

/// Library id of the translated book.
pub fn translated_novel_id(source_novel_id: &str) -> String {
    format!("{source_novel_id}:{LANGUAGE}")
}

pub fn translated_title(title: &str) -> String {
    format!("{} (PT-BR)", title.trim())
}

// ---------------------------------------------------------------------------
// XHTML
// ---------------------------------------------------------------------------

/// `&` that does not start an XML entity becomes `&amp;`; HTML named entities
/// (`&nbsp;`) become numeric ones, since XHTML readers do not know them.
fn escape_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(pos) = rest.find('&') {
        out.push_str(&rest[..pos]);
        let tail = &rest[pos..];
        let entity = super::source::prefix_within(tail, 12).find(';').map(|semi| &tail[..=semi]);
        match entity {
            Some(entity) if matches!(entity, "&amp;" | "&lt;" | "&gt;" | "&quot;" | "&apos;") => {
                out.push_str(entity);
                rest = &tail[entity.len()..];
            }
            Some(entity) if entity.starts_with("&#") && decode_entities(entity) != entity => {
                out.push_str(entity);
                rest = &tail[entity.len()..];
            }
            Some(entity) if decode_entities(entity) != entity => {
                for ch in decode_entities(entity).chars() {
                    out.push_str(&format!("&#{};", ch as u32));
                }
                rest = &tail[entity.len()..];
            }
            _ => {
                out.push_str("&amp;");
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out.replace('<', "&lt;")
}

/// Makes model/HTML output well-formed XML: void tags self-close, unclosed
/// elements are closed, stray closing tags are dropped, a block opened inside a
/// `<p>` closes it first, and text is escaped. Attributes are kept as they are.
pub fn to_xhtml(html: &str) -> String {
    let mut out = String::with_capacity(html.len() + 32);
    // (lower-case name, name as written)
    let mut stack: Vec<(String, String)> = Vec::new();
    let mut i = 0;
    while i < html.len() {
        let rest = &html[i..];
        if rest.starts_with('<') {
            if let Some(next) = skip_special(html, i) {
                if rest.starts_with("<!--") && html[i..next].ends_with("-->") {
                    out.push_str(&html[i..next]);
                }
                i = next;
                continue;
            }
            if let Some(tag) = parse_tag(html, i) {
                let raw = &html[i..tag.end];
                if tag.closing {
                    if let Some(pos) = stack.iter().rposition(|(name, _)| *name == tag.name) {
                        while stack.len() > pos {
                            let (_, written) = stack.pop().unwrap_or_default();
                            out.push_str(&format!("</{written}>"));
                        }
                    }
                } else if tag.self_closing {
                    out.push_str(raw);
                } else if VOID_TAGS.contains(&tag.name.as_str()) {
                    out.push_str(raw[..raw.len() - 1].trim_end());
                    out.push_str("/>");
                } else {
                    if BLOCK_TAGS.contains(&tag.name.as_str()) && stack.last().is_some_and(|(name, _)| name == "p") {
                        let (_, written) = stack.pop().unwrap_or_default();
                        out.push_str(&format!("</{written}>"));
                    }
                    let written = raw[1..].chars().take_while(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '-' | '_')).collect();
                    out.push_str(raw);
                    stack.push((tag.name, written));
                }
                i = tag.end;
                continue;
            }
            out.push_str("&lt;");
            i += 1;
            continue;
        }
        let next = rest.find('<').map(|p| i + p).unwrap_or(html.len());
        out.push_str(&escape_text(&html[i..next]));
        i = next;
    }
    while let Some((_, written)) = stack.pop() {
        out.push_str(&format!("</{written}>"));
    }
    out
}

fn xhtml_doc(title: &str, body: &str, stylesheet: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<!DOCTYPE html>\n<html xmlns=\"http://www.w3.org/1999/xhtml\" lang=\"{LANGUAGE}\">\n<head><title>{}</title><link rel=\"stylesheet\" type=\"text/css\" href=\"{}\"/></head>\n<body>{body}</body>\n</html>",
        xml_escape(title),
        xml_escape(stylesheet)
    )
}

fn src_attr_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r#"((?:\s)(?:src|xlink:href)\s*=\s*)("([^"]*)"|'([^']*)')"#).expect("valid regex"))
}

/// Re-points image references from the source chapter's folder to
/// `chapters/`; returns the html and the asset hrefs (relative to the OPF) it uses.
pub fn rewrite_asset_refs(html: &str, chapter_href: &str, assets: &[String]) -> (String, BTreeSet<String>) {
    let chapter_dir = chapter_href.rsplit_once('/').map(|(dir, _)| dir).unwrap_or("");
    let mut used = BTreeSet::new();
    let rewritten = src_attr_re().replace_all(html, |caps: &regex::Captures| {
        let value = caps.get(3).or_else(|| caps.get(4)).map(|m| m.as_str()).unwrap_or("");
        let lower = value.to_ascii_lowercase();
        if lower.starts_with("data:") || lower.contains("://") || value.starts_with('/') || value.is_empty() {
            return caps[0].to_string();
        }
        let resolved = join_zip(chapter_dir, &decode_entities(value));
        if assets.iter().any(|asset| *asset == resolved) {
            used.insert(resolved.clone());
            format!("{}\"../{}\"", &caps[1], xml_escape(&resolved))
        } else {
            caps[0].to_string()
        }
    });
    (rewritten.into_owned(), used)
}

// ---------------------------------------------------------------------------
// EPUB
// ---------------------------------------------------------------------------

/// Same layout as `buildEpub` in `downloadManager.ts`.
pub fn build_epub(
    title: &str,
    novel_id: &str,
    chapters: &[EpubChapter],
    assets: &[EpubAsset],
    cover: Option<&EpubCover>,
) -> Result<Vec<u8>, String> {
    let err = |e: zip::result::ZipError| format!("Não foi possível montar o EPUB: {e}");
    let io = |e: std::io::Error| format!("Não foi possível montar o EPUB: {e}");
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let stored = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let deflated = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let manifest_items: Vec<String> = (1..=chapters.len())
        .map(|i| format!("<item id=\"chapter-{i}\" href=\"chapters/chapter-{i}.xhtml\" media-type=\"application/xhtml+xml\"/>"))
        .collect();
    let spine_items: Vec<String> = (1..=chapters.len()).map(|i| format!("<itemref idref=\"chapter-{i}\"/>")).collect();
    let nav_items: Vec<String> = chapters
        .iter()
        .enumerate()
        .map(|(i, chapter)| format!("<li><a href=\"chapters/chapter-{}.xhtml\">{}</a></li>", i + 1, xml_escape(&chapter.title)))
        .collect();
    let asset_items: Vec<String> = assets
        .iter()
        .enumerate()
        .map(|(i, asset)| {
            format!(
                "<item id=\"asset-{}\" href=\"{}\" media-type=\"{}\"/>",
                i + 1,
                xml_escape(&asset.href),
                xml_escape(&asset.media_type)
            )
        })
        .collect();
    let (cover_manifest, cover_spine, cover_meta) = match cover {
        Some(cover) => (
            format!(
                "<item id=\"cover-page\" href=\"cover.xhtml\" media-type=\"application/xhtml+xml\"/>\n    <item id=\"cover-image\" href=\"{}\" media-type=\"{}\" properties=\"cover-image\"/>",
                xml_escape(&cover.name),
                cover.media_type
            ),
            "<itemref idref=\"cover-page\" linear=\"no\"/>".to_string(),
            "<meta name=\"cover\" content=\"cover-image\"/>".to_string(),
        ),
        None => (String::new(), String::new(), String::new()),
    };
    let description: String = chapters
        .first()
        .map(|chapter| text_of(&chapter.body))
        .unwrap_or_else(|| title.to_string())
        .chars()
        .take(1000)
        .collect();
    let opf = format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>
<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"book-id\">
  <metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">
    <dc:identifier id=\"book-id\">oghma:{}</dc:identifier>
    <dc:title>{}</dc:title>
    <dc:language>{LANGUAGE}</dc:language>
    <dc:description>{}</dc:description>
    {cover_meta}
  </metadata>
  <manifest>
    <item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>
    <item id=\"style\" href=\"style.css\" media-type=\"text/css\"/>
    {cover_manifest}
    {}
    {}
  </manifest>
  <spine>
    {cover_spine}
    {}
  </spine>
</package>",
        xml_escape(novel_id),
        xml_escape(title),
        xml_escape(&description),
        manifest_items.join("\n    "),
        asset_items.join("\n    "),
        spine_items.join("\n    "),
    );

    zip.start_file("mimetype", stored).map_err(err)?;
    zip.write_all(b"application/epub+zip").map_err(io)?;
    zip.start_file("META-INF/container.xml", deflated).map_err(err)?;
    zip.write_all(br#"<?xml version="1.0" encoding="utf-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#).map_err(io)?;
    zip.start_file("OEBPS/content.opf", deflated).map_err(err)?;
    zip.write_all(opf.as_bytes()).map_err(io)?;
    zip.start_file("OEBPS/nav.xhtml", deflated).map_err(err)?;
    let nav = format!(
        "<nav epub:type=\"toc\" xmlns:epub=\"http://www.idpf.org/2007/ops\"><h1>Sumário</h1><ol>{}</ol></nav>",
        nav_items.join("\n      ")
    );
    zip.write_all(xhtml_doc("Sumário", &nav, "style.css").as_bytes()).map_err(io)?;
    if let Some(cover) = cover {
        zip.start_file("OEBPS/cover.xhtml", deflated).map_err(err)?;
        let page = format!(
            "<section class=\"cover-page\"><img src=\"{}\" alt=\"{}\"/></section>",
            xml_escape(&cover.name),
            xml_escape(title)
        );
        zip.write_all(xhtml_doc("Capa", &page, "style.css").as_bytes()).map_err(io)?;
        zip.start_file(format!("OEBPS/{}", cover.name), stored).map_err(err)?;
        zip.write_all(&cover.data).map_err(io)?;
    }
    zip.start_file("OEBPS/style.css", deflated).map_err(err)?;
    zip.write_all(STYLE_CSS.as_bytes()).map_err(io)?;
    for (i, chapter) in chapters.iter().enumerate() {
        zip.start_file(format!("OEBPS/chapters/chapter-{}.xhtml", i + 1), deflated).map_err(err)?;
        zip.write_all(xhtml_doc(&chapter.title, &chapter.body, "../style.css").as_bytes()).map_err(io)?;
    }
    for asset in assets {
        zip.start_file(format!("OEBPS/{}", asset.href), stored).map_err(err)?;
        zip.write_all(&asset.data).map_err(io)?;
    }
    Ok(zip.finish().map_err(err)?.into_inner())
}

/// The source book's cover: the project's recorded cover, else the folder's `cover.*`.
fn original_cover_path(row: &super::store::ProjectRow) -> Option<PathBuf> {
    row.cover_path
        .as_ref()
        .map(PathBuf::from)
        .filter(|path| path.is_file() && cover_media(path).is_some())
        .or_else(|| pick_cover(Path::new(&row.source_dir)))
}

fn cover_media(path: &Path) -> Option<(&'static str, &'static str)> {
    match path.extension()?.to_string_lossy().to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Some(("jpg", "image/jpeg")),
        "png" => Some(("png", "image/png")),
        "webp" => Some(("webp", "image/webp")),
        _ => None,
    }
}

/// Reads the given entries of a zip (missing ones are skipped).
fn read_zip_entries(epub: &Path, names: &[String]) -> Vec<(String, Vec<u8>)> {
    let Ok(file) = fs::File::open(epub) else { return Vec::new() };
    let Ok(mut zip) = zip::ZipArchive::new(file) else { return Vec::new() };
    names
        .iter()
        .filter_map(|name| {
            let mut entry = zip.by_name(name).ok()?;
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).ok()?;
            Some((name.clone(), bytes))
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

impl Engine {
    /// Builds the PT-BR EPUB from the translated chunks and commits it as a
    /// sibling library book (`<sourceNovelId>:pt-BR`, `"<Title> (PT-BR)"`).
    /// Every chunk in scope must be translated; chapters outside the scope are
    /// included when they are fully translated (e.g. retranslated ones).
    #[cfg(test)]
    pub fn export_project(self: &Arc<Self>, id: &str) -> Result<ExportResult, String> {
        self.export_with(id, false)
    }

    /// Final book (`partial = false`) or preview with only the finished chapters (`partial = true`).
    pub async fn export_book(self: &Arc<Self>, id: &str, partial: bool) -> Result<ExportResult, String> {
        let engine = Arc::clone(self);
        let project = id.to_string();
        tauri::async_runtime::spawn_blocking(move || engine.export_with(&project, partial))
            .await
            .map_err(|err| err.to_string())?
    }

    fn export_with(self: &Arc<Self>, id: &str, partial: bool) -> Result<ExportResult, String> {
        let result = self.build_and_commit(id, partial);
        if partial {
            match &result {
                Ok(done) => {
                    let _ = self.store.set_output_dir(id, &done.output_dir);
                    let _ = self.store.set_last_preview_at(id, now_secs() as f64);
                    self.log(id, "info", format!("Prévia gerada na biblioteca: {}", done.title));
                    self.emit(
                        events::EXPORTED,
                        json!({ "projectId": id, "outputDir": done.output_dir, "title": done.title, "preview": true }),
                    );
                    self.emit_project(id, true);
                }
                Err(err) => self.log(id, "error", format!("Falha ao gerar a prévia: {err}")),
            }
            return result;
        }
        match &result {
            Ok(done) => {
                let _ = self.store.set_output_dir(id, &done.output_dir);
                let _ = self.store.set_status(id, ProjectStatus::Exported);
                self.log(id, "info", format!("Livro PT-BR gerado na biblioteca: {}", done.title));
                self.emit(
                    events::EXPORTED,
                    json!({ "projectId": id, "outputDir": done.output_dir, "title": done.title }),
                );
                self.emit_project(id, true);
            }
            Err(err) => self.log(id, "error", format!("Falha ao gerar o livro PT-BR: {err}")),
        }
        result
    }

    fn build_and_commit(&self, id: &str, partial: bool) -> Result<ExportResult, String> {
        let row = self.store.project(id)?;
        let source = read_epub(Path::new(&row.source_epub)).ok();
        let asset_hrefs: Vec<String> = source
            .as_ref()
            .map(|book| book.assets.iter().map(|asset| asset.href.clone()).collect())
            .unwrap_or_default();

        let mut chapters = Vec::new();
        let mut used_assets = BTreeSet::new();
        let mut missing = 0usize;
        let (mut scope_total, mut scope_ready) = (0usize, 0usize);
        let (mut source_chars, mut words) = (0u64, 0u64);
        for chapter in self.store.chapters(id)? {
            let chunks = self.store.chunks(id, chapter.index)?;
            let in_scope = row.scope.contains(chapter.index);
            let complete = !chunks.is_empty() && chunks.iter().all(|chunk| chunk.is_translated());
            if in_scope {
                scope_total += 1;
                scope_ready += complete as usize;
            }
            if !complete {
                if in_scope {
                    missing += chunks.iter().filter(|chunk| !chunk.is_translated()).count();
                }
                continue;
            }
            let html = chunks.iter().filter_map(|chunk| chunk.dst_html.as_deref()).collect::<Vec<_>>().join("\n");
            let (html, used) = rewrite_asset_refs(&html, &chapter.href, &asset_hrefs);
            used_assets.extend(used);
            let title = split_blocks(&html)
                .iter()
                .find(|block| super::source::block_tag(block).is_some_and(|tag| tag.len() == 2 && tag.starts_with('h')))
                .map(|heading| text_of(heading))
                .filter(|text| !text.is_empty())
                .unwrap_or_else(|| chapter.title.clone());
            let text = text_of(&html);
            source_chars += text.chars().count() as u64;
            words += word_count(&html) as u64;
            chapters.push(EpubChapter { title, body: to_xhtml(&html) });
        }
        if missing > 0 && !partial {
            return Err(format!("ainda faltam {missing} trecho(s) para traduzir no escopo escolhido"));
        }
        if chapters.is_empty() {
            return Err(if partial { "Nenhum capítulo traduzido ainda".into() } else { "nenhum capítulo traduzido para exportar".into() });
        }
        let progress = (partial && missing > 0)
            .then(|| ((scope_ready * 100) / scope_total.max(1)).min(99) as u8);

        let assets: Vec<EpubAsset> = match &source {
            Some(book) => {
                let wanted: Vec<&super::source::SourceAsset> =
                    book.assets.iter().filter(|asset| used_assets.contains(&asset.href)).collect();
                let names: Vec<String> = wanted.iter().map(|asset| join_zip(&book.opf_dir, &asset.href)).collect();
                let data = read_zip_entries(Path::new(&row.source_epub), &names);
                wanted
                    .iter()
                    .zip(&names)
                    .filter_map(|(asset, name)| {
                        let bytes = data.iter().find(|(n, _)| n == name)?.1.clone();
                        Some(EpubAsset { href: asset.href.clone(), media_type: asset.media_type.clone(), data: bytes })
                    })
                    .collect()
            }
            None => Vec::new(),
        };

        let source_dir = PathBuf::from(&row.source_dir);
        let cover = original_cover_path(&row).and_then(|path| {
            let (ext, media_type) = cover_media(&path)?;
            let data = fs::read(&path).ok().filter(|data| !data.is_empty())?;
            Some(EpubCover { name: format!("cover.{ext}"), media_type: media_type.to_string(), data })
        });

        let source_id = row
            .source_novel_id
            .clone()
            .filter(|id| !id.trim().is_empty())
            .unwrap_or_else(|| {
                let folder = source_dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                format!("local:{}", sanitize_file_name(&folder))
            });
        let novel_id = translated_novel_id(&source_id);
        let title = translated_title(&row.title);
        let epub = build_epub(&title, &novel_id, &chapters, &assets, cover.as_ref())?;

        let root = source_dir
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .ok_or("pasta do livro original sem pasta pai")?;
        let begun = begin_export_at(root, &novel_id, &title)?;
        let staging = PathBuf::from(&begun.staging_dir);
        let manifest = json!({
            "schema_version": 1,
            "novel_id": novel_id,
            "title": title,
            "language": LANGUAGE,
            "source_novel_id": row.source_novel_id,
            "translation_project_id": id,
            "model": row.model,
            "chapter_count": chapters.len(),
            "source_chars": source_chars,
            "word_count": words,
            "analysis_format": "translation",
            "translation_progress": progress,
            "generated_at": iso_utc(now_secs()),
        });
        let write = || -> Result<PathBuf, String> {
            write_export_file(&staging, &format!("{}.epub", sanitize_file_name(&title)), &epub)?;
            if let Some(cover) = &cover {
                write_export_file(&staging, &cover.name, &cover.data)?;
            }
            let json = serde_json::to_vec_pretty(&manifest).map_err(|err| err.to_string())?;
            write_export_file(&staging, LOCAL_BOOK_MANIFEST, &json)?;
            commit_export_at(&staging, Path::new(&begun.final_dir))
        };
        let committed = match write() {
            Ok(path) => path,
            Err(err) => {
                let _ = abort_export_at(&staging);
                return Err(err);
            }
        };
        self.host.library_committed(&meta_keys_for(&committed, &begun.final_dir, &novel_id));
        Ok(ExportResult { output_dir: committed.to_string_lossy().to_string(), title })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::translation::runner::tests::{create, fixture, glossary_settled, wait_until};
    use crate::translation::source::block_tag;

    #[test]
    fn xhtml_is_well_formed() {
        assert_eq!(to_xhtml("<p>Um<br>dois &amp; três &nbsp;x & y</p>"), "<p>Um<br/>dois &amp; três &#160;x &amp; y</p>");
        assert_eq!(to_xhtml("<p>a <em>b</p><p>c</span></p>"), "<p>a <em>b</em></p><p>c</p>");
        assert_eq!(to_xhtml("<p>a<p>b"), "<p>a</p><p>b</p>");
        assert_eq!(to_xhtml("<P>x</P><img src=\"a.png\">"), "<P>x</P><img src=\"a.png\"/>");
        assert_eq!(to_xhtml("1 < 2 &#8217;"), "1 &lt; 2 &#8217;");
    }

    #[test]
    fn asset_refs_follow_the_chapter_folder() {
        let assets = vec!["Images/map.png".to_string()];
        let (html, used) = rewrite_asset_refs("<p><img src=\"../Images/map.png\"/> <img src='x.png'/></p>", "Text/c1.xhtml", &assets);
        assert_eq!(html, "<p><img src=\"../Images/map.png\"/> <img src='x.png'/></p>");
        assert!(used.contains("Images/map.png"));
        let (html, _) = rewrite_asset_refs("<p><img src=\"Images/map.png\"/></p>", "c1.xhtml", &assets);
        assert_eq!(html, "<p><img src=\"../Images/map.png\"/></p>");
    }

    #[test]
    fn export_builds_a_translated_sibling_book() {
        tauri::async_runtime::block_on(async {
            let f = fixture(70);
            let id = create(&f);
            glossary_settled(&f, &id).await;
            // Nothing translated yet: the export is refused.
            assert!(f.engine.export_project(&id).unwrap_err().contains("faltam"));

            f.engine.start(&id).unwrap();
            let engine = Arc::clone(&f.engine);
            let pid = id.clone();
            wait_until(move || engine.store.project(&pid).unwrap().status == ProjectStatus::Exported).await;

            let root = f.book_dir.parent().unwrap().to_path_buf();
            let out = root.join("Livro (PT-BR)");
            assert_eq!(
                f.engine.store.project(&id).unwrap().output_dir.map(PathBuf::from).map(|p| p.canonicalize().unwrap()),
                Some(out.canonicalize().unwrap())
            );
            let exported = f.host.last(events::EXPORTED).unwrap();
            assert_eq!(exported["projectId"], id.as_str());
            assert_eq!(exported["title"], "Livro (PT-BR)");
            assert_eq!(f.host.committed.lock().unwrap().len(), 1);
            assert!(f.host.committed.lock().unwrap()[0].contains(&"novel:cn:livro:pt-BR".to_string()));

            // The library scanner (`list_export_library`) sees both books.
            let items = crate::files::scan_export_library(&root, false).unwrap();
            let items: Vec<serde_json::Value> = items.iter().map(|item| serde_json::to_value(item).unwrap()).collect();
            assert_eq!(items.len(), 2, "{items:?}");
            let book = items.iter().find(|item| item["novelId"] == "cn:livro:pt-BR").expect("translated book listed");
            assert_eq!(book["title"], "Livro (PT-BR)");
            assert_eq!(book["files"], json!(["Livro (PT-BR).epub"]));
            assert!(book["coverPath"].as_str().unwrap().ends_with("cover.png"));
            assert_eq!(book["chapterCount"], 3);
            assert_eq!(book["analysisFormat"], "translation");
            let manifest: serde_json::Value =
                serde_json::from_slice(&fs::read(out.join(LOCAL_BOOK_MANIFEST)).unwrap()).unwrap();
            assert_eq!(manifest["language"], "pt-BR");
            assert_eq!(manifest["source_novel_id"], "cn:livro");
            assert_eq!(fs::read(out.join("cover.png")).unwrap(), b"\x89PNG cover");

            // The EPUB reads back with the translated blocks, the cover and the image.
            let epub = out.join("Livro (PT-BR).epub");
            let book = read_epub(&epub).unwrap();
            assert_eq!(book.chapters.len(), 3);
            let first = &book.chapters[0];
            assert_eq!(first.href, "chapters/chapter-1.xhtml");
            assert_eq!(block_tag(&first.blocks[0]).as_deref(), Some("h1"));
            assert!(first.blocks.iter().all(|b| !text_of(b).contains("alpha")), "{:?}", first.blocks);
            assert!(first.blocks.iter().any(|b| b.contains("src=\"../assets/map.png\"")));
            assert_eq!(book.assets.len(), 1);
            let names = read_zip_entries(&epub, &["mimetype".into(), "OEBPS/cover.png".into(), "OEBPS/assets/map.png".into(), "OEBPS/nav.xhtml".into()]);
            assert_eq!(names.len(), 4);
            assert_eq!(names[0].1, b"application/epub+zip");
            let opf = String::from_utf8(read_zip_entries(&epub, &["OEBPS/content.opf".into()])[0].1.clone()).unwrap();
            assert!(opf.contains("<dc:identifier id=\"book-id\">oghma:cn:livro:pt-BR</dc:identifier>"));
            assert!(opf.contains("<dc:language>pt-BR</dc:language>"));
            assert!(opf.contains("properties=\"cover-image\""));

            // A second export replaces the same folder.
            f.engine.export_project(&id).unwrap();
            assert_eq!(crate::files::scan_export_library(&root, false).unwrap().len(), 2);
        });
    }

    #[test]
    fn preview_then_final_replace_the_same_book() {
        tauri::async_runtime::block_on(async {
            let f = fixture(70);
            // A real (decodable) cover so the translated cover can be drawn.
            let img = image::RgbaImage::from_fn(300, 450, |x, y| image::Rgba([(x % 200) as u8, (y % 200) as u8, 140, 255]));
            let mut png = std::io::Cursor::new(Vec::new());
            image::DynamicImage::ImageRgba8(img).write_to(&mut png, image::ImageFormat::Png).unwrap();
            fs::write(f.book_dir.join("cover.png"), png.into_inner()).unwrap();
            let id = create(&f);
            glossary_settled(&f, &id).await;

            // Nothing ready: no preview.
            assert!(f.engine.export_book(&id, true).await.unwrap_err().contains("Nenhum capítulo"));

            // Translate only chapter 1 by hand, then build a preview.
            for chunk in f.engine.store.chunks(&id, 1).unwrap() {
                f.engine.store.save_chunk(chunk.id, "<p>um</p>", "done", None, "m", 1, 1).unwrap();
            }
            let preview = f.engine.export_book(&id, true).await.unwrap();
            let out = PathBuf::from(&preview.output_dir);
            let manifest: serde_json::Value = serde_json::from_slice(&fs::read(out.join(LOCAL_BOOK_MANIFEST)).unwrap()).unwrap();
            assert_eq!(manifest["translation_progress"], 33);
            assert_eq!(manifest["chapter_count"], 1);
            assert!(out.join("cover.png").is_file(), "the original cover is used as is");
            let row = f.engine.store.project(&id).unwrap();
            assert!(row.last_preview_at.is_some());
            assert_ne!(row.status, ProjectStatus::Exported, "a preview does not finish the project");
            let root = f.book_dir.parent().unwrap().to_path_buf();
            let listed: Vec<serde_json::Value> = crate::files::scan_export_library(&root, false)
                .unwrap()
                .iter()
                .map(|item| serde_json::to_value(item).unwrap())
                .collect();
            let book = listed.iter().find(|item| item["novelId"] == "cn:livro:pt-BR").unwrap();
            assert_eq!(book["translationProgress"], 33);
            assert_eq!(book["language"], "pt-BR");
            assert!(book["coverPath"].as_str().unwrap().ends_with("cover.png"));
            assert_eq!(read_epub(&out.join("Livro (PT-BR).epub")).unwrap().chapters.len(), 1);

            // Finishing replaces the same folder; the preview mark is gone.
            f.engine.start(&id).unwrap();
            let engine = Arc::clone(&f.engine);
            let pid = id.clone();
            wait_until(move || engine.store.project(&pid).unwrap().status == ProjectStatus::Exported).await;
            let manifest: serde_json::Value = serde_json::from_slice(&fs::read(out.join(LOCAL_BOOK_MANIFEST)).unwrap()).unwrap();
            assert!(manifest["translation_progress"].is_null());
            assert_eq!(manifest["chapter_count"], 3);
            assert_eq!(crate::files::scan_export_library(&root, false).unwrap().len(), 2);
        });
    }
}
