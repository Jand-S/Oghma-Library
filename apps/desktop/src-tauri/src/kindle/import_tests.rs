use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde_json::json;
use sha2::{Digest, Sha256};

use super::imported::{kindle_identity, kindle_title, KindleIdentity};
use super::wireless_copy::{patch_opf, wireless_epub_in};
use super::{ensure_fresh_azw3, kindle_thumbnail_filename, oghma_content_id};
use crate::files::test_support::TempDir;
use crate::files::LOCAL_BOOK_MANIFEST;
use crate::import_epub::epub_meta::{make_series, read_epub_meta};

const SHA: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

fn sha_of(path: &Path) -> String {
    format!("{:x}", Sha256::digest(fs::read(path).unwrap()))
}

fn png(dir: &Path) -> PathBuf {
    let path = dir.join("cover.png");
    image::RgbImage::from_pixel(40, 60, image::Rgb([30, 120, 180])).save(&path).unwrap();
    path
}

/// Small EPUB3 with `title` and, optionally, a JPEG cover.
fn make_epub(dir: &Path, name: &str, title: &str, with_cover: bool) -> PathBuf {
    let path = dir.join(name);
    let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
    let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let deflated = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("mimetype", stored).unwrap();
    zip.write_all(b"application/epub+zip").unwrap();
    zip.start_file("META-INF/container.xml", deflated).unwrap();
    zip.write_all(br#"<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#).unwrap();
    let cover_item = if with_cover {
        r#"<item id="cover" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>"#
    } else {
        ""
    };
    let opf = format!(
        r#"<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bid">x</dc:identifier><dc:title>{title}</dc:title><dc:language>pt-BR</dc:language></metadata><manifest><item id="p1" href="p1.xhtml" media-type="application/xhtml+xml"/>{cover_item}</manifest><spine><itemref idref="p1"/></spine></package>"#
    );
    zip.start_file("OEBPS/content.opf", deflated).unwrap();
    zip.write_all(opf.as_bytes()).unwrap();
    zip.start_file("OEBPS/p1.xhtml", deflated).unwrap();
    zip.write_all(br#"<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cap</title></head><body><h1>Capitulo 1</h1><p>Conteudo.</p></body></html>"#).unwrap();
    if with_cover {
        let mut jpeg = Vec::new();
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(4, 6, image::Rgb([1, 2, 3])))
            .write_to(&mut std::io::Cursor::new(&mut jpeg), image::ImageFormat::Jpeg)
            .unwrap();
        zip.start_file("OEBPS/cover.jpg", stored).unwrap();
        zip.write_all(&jpeg).unwrap();
    }
    zip.finish().unwrap();
    path
}

fn imported_book(root: &Path, title: &str, volume: Option<f64>) -> PathBuf {
    let dir = root.join("Unsheathed - Vol 1");
    fs::create_dir_all(&dir).unwrap();
    let series = make_series("Unsheathed", volume);
    fs::write(
        dir.join(LOCAL_BOOK_MANIFEST),
        json!({ "novel_id": format!("import:{SHA}"), "title": title, "origin": "import", "series": series }).to_string(),
    )
    .unwrap();
    dir
}

fn exth(id: u32, content: &str) -> Vec<u8> {
    [&id.to_be_bytes()[..], &((content.len() + 8) as u32).to_be_bytes(), content.as_bytes()].concat()
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|window| window == needle)
}

#[test]
fn imported_content_id_comes_from_the_sha_and_survives_renames() {
    let root = TempDir::new("kindle-import-id");
    let dir = imported_book(root.path(), "Caged Sparrow", Some(1.0));
    let identity = kindle_identity(&dir, "ignorado");
    assert_eq!(identity.content_id, format!("oghma-{}", &SHA[..16]));
    assert_eq!(identity.title.as_deref(), Some("Unsheathed 1 – Caged Sparrow"));
    assert_eq!(identity.series.as_deref(), Some("Unsheathed"));

    let renamed = imported_book(root.path(), "Outro título", Some(2.0));
    assert_eq!(kindle_identity(&renamed, "x").content_id, identity.content_id);

    // Not an import (or a malformed sha): the old seed, unchanged.
    fs::write(dir.join(LOCAL_BOOK_MANIFEST), r#"{"novel_id":"import:abc","title":"Livro"}"#).unwrap();
    assert_eq!(kindle_identity(&dir, "Livro"), KindleIdentity::from_seed("novel:import:abc"));
    fs::write(dir.join(LOCAL_BOOK_MANIFEST), r#"{"novel_id":"cn:42","title":"Livro"}"#).unwrap();
    let novel = kindle_identity(&dir, "Livro");
    assert_eq!(novel.content_id, oghma_content_id("novel:cn:42"));
    assert_eq!((novel.title, novel.series), (None, None));
}

#[test]
fn kindle_title_puts_series_and_volume_first() {
    assert_eq!(kindle_title(Some(&make_series("Unsheathed", Some(2.5))), "Meio"), "Unsheathed 2.5 – Meio");
    assert_eq!(kindle_title(Some(&make_series("Unsheathed", Some(10.0))), " Fim "), "Unsheathed 10 – Fim");
    assert_eq!(kindle_title(Some(&make_series("Unsheathed", None)), "Extra"), "Unsheathed – Extra");
    assert_eq!(kindle_title(None, "Avulso"), "Avulso");
}

#[test]
fn imported_azw3_gets_kindle_title_and_series_without_touching_content_id() {
    let root = TempDir::new("kindle-import-azw3");
    let dir = imported_book(root.path(), "Caged Sparrow", Some(1.0));
    make_epub(&dir, "Caged Sparrow.epub", "Caged Sparrow", false);
    png(&dir);
    let content_id = format!("oghma-{}", &SHA[..16]);

    let azw3 = ensure_fresh_azw3("Caged Sparrow", &dir, &[]).expect("conversion");
    assert_eq!(azw3, dir.join("Unsheathed 1 – Caged Sparrow.azw3"));
    assert_eq!(
        kindle_thumbnail_filename(&azw3).unwrap(),
        format!("thumbnail_{content_id}_PDOC_portrait.jpg")
    );
    let bytes = fs::read(&azw3).unwrap();
    assert!(contains(&bytes, &exth(503, "Unsheathed 1 – Caged Sparrow")));
    assert!(contains(&bytes, &exth(112, "Unsheathed")));
    assert!(contains(&bytes, &exth(113, &content_id)));

    // Series renumbered: the AZW3 is rebuilt under the new title and the old one goes away.
    imported_book(root.path(), "Caged Sparrow", Some(2.0));
    let rebuilt = ensure_fresh_azw3("Caged Sparrow", &dir, &[]).expect("rebuild");
    assert_eq!(rebuilt, dir.join("Unsheathed 2 – Caged Sparrow.azw3"));
    assert!(!azw3.exists());
    assert_eq!(ensure_fresh_azw3("Caged Sparrow", &dir, &[]).unwrap(), rebuilt);
}

#[test]
fn wireless_copy_embeds_the_cover_and_keeps_the_original_byte_for_byte() {
    let root = TempDir::new("kindle-wireless");
    let temp = TempDir::new("kindle-wireless-tmp");
    let dir = imported_book(root.path(), "Caged Sparrow", Some(1.0));
    let epub = make_epub(&dir, "Caged Sparrow.epub", "Caged Sparrow", false);
    png(&dir);
    let before = sha_of(&epub);

    let identity = kindle_identity(&dir, "Caged Sparrow");
    let sent = wireless_epub_in(temp.path(), &dir, &epub, &identity);
    assert_ne!(sent, epub);
    assert!(sent.starts_with(temp.path()));
    assert_eq!(sent.file_name().unwrap(), "Unsheathed 1 – Caged Sparrow.epub");
    assert_eq!(sha_of(&epub), before);

    let meta = read_epub_meta(&sent).expect("copy is a valid EPUB");
    let (cover, ext) = meta.cover.expect("copy has the cover");
    assert_eq!(ext, "jpg");
    assert_eq!(image::guess_format(&cover).unwrap(), image::ImageFormat::Jpeg);
    assert_eq!(meta.title.as_deref(), Some("Unsheathed 1 – Caged Sparrow"));
    let mut copy = zip::ZipArchive::new(fs::File::open(&sent).unwrap()).unwrap();
    assert_eq!(copy.by_index(0).unwrap().name(), "mimetype");
    assert!(copy.by_name("OEBPS/p1.xhtml").is_ok());
}

#[test]
fn wireless_sends_the_original_when_nothing_is_missing() {
    let root = TempDir::new("kindle-wireless-orig");
    let temp = TempDir::new("kindle-wireless-orig-tmp");
    let dir = root.path().join("Livro");
    fs::create_dir_all(&dir).unwrap();
    let with_cover = make_epub(&dir, "Livro.epub", "Livro", true);
    png(&dir);
    let identity = kindle_identity(&dir, "Livro");
    assert_eq!(wireless_epub_in(temp.path(), &dir, &with_cover, &identity), with_cover);

    // No cover anywhere: nothing to embed either.
    let bare_dir = root.path().join("Sem capa");
    fs::create_dir_all(&bare_dir).unwrap();
    let bare = make_epub(&bare_dir, "Sem capa.epub", "Sem capa", false);
    assert_eq!(wireless_epub_in(temp.path(), &bare_dir, &bare, &identity), bare);
    assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 0);
}

#[test]
fn patch_opf_handles_epub2_prefixes_broken_cover_meta_and_escaping() {
    let opf = r#"<opf:package xmlns:opf="http://www.idpf.org/2007/opf" version="2.0"><opf:metadata><dc:title>Velho</dc:title><opf:meta name="cover" content="sumiu"/></opf:metadata><opf:manifest><opf:item id="p1" href="p1.xhtml" media-type="application/xhtml+xml"/></opf:manifest></opf:package>"#;
    let patched = patch_opf(opf, Some("oghma-cover.jpg"), Some("A & B <1>")).unwrap();
    assert!(patched.contains(r#"<opf:item id="oghma-cover-image" href="oghma-cover.jpg" media-type="image/jpeg"/></opf:manifest>"#));
    assert!(patched.contains(r#"<opf:meta name="cover" content="oghma-cover-image"/></opf:metadata>"#));
    assert!(!patched.contains("sumiu"));
    assert!(patched.contains("<dc:title>A &amp; B &lt;1&gt;</dc:title>"));
    assert!(patch_opf("<package/>", Some("c.jpg"), None).is_err());
}

#[test]
#[ignore]
fn real_epubs_go_wireless_with_cover_and_untouched_originals() {
    let source = std::env::var("OGHMA_REAL_EPUBS").expect("OGHMA_REAL_EPUBS");
    let temp = TempDir::new("kindle-real-tmp");
    let dir = TempDir::new("kindle-real");
    png(dir.path());
    for entry in fs::read_dir(source).unwrap().flatten() {
        let epub = entry.path();
        if epub.extension().is_none_or(|ext| ext != "epub") {
            continue;
        }
        let before = sha_of(&epub);
        let identity = KindleIdentity {
            content_id: "oghma-test".into(),
            title: Some("Unsheathed 1 – Teste".into()),
            series: None,
        };
        let sent = wireless_epub_in(temp.path(), dir.path(), &epub, &identity);
        println!("{} -> {}", epub.display(), sent.display());
        assert_ne!(sent, epub);
        assert_eq!(sha_of(&epub), before);
        let meta = read_epub_meta(&sent).expect("valid copy");
        assert!(meta.cover.is_some());
        assert_eq!(meta.title.as_deref(), Some("Unsheathed 1 – Teste"));
    }
}
