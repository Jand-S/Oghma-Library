use std::io::Write;
use std::path::{Path, PathBuf};

use super::epub_meta::{parse_volume, series_from_file_name, series_id};
use super::*;
use crate::files::test_support::TempDir;

/// Small valid EPUB: `metadata` goes inside `<metadata>`, `manifest_extra` inside `<manifest>`
/// and `files` are extra zip entries under `OEBPS/`.
pub(super) fn make_epub(dir: &Path, file_name: &str, metadata: &str, manifest_extra: &str, files: &[(&str, &[u8])]) -> PathBuf {
    let path = dir.join(file_name);
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
    let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    zip.start_file("mimetype", stored).unwrap();
    zip.write_all(b"application/epub+zip").unwrap();
    zip.start_file("META-INF/container.xml", stored).unwrap();
    zip.write_all(br#"<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#).unwrap();
    let opf = format!(
        r#"<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf"><dc:identifier id="bid">x</dc:identifier>{metadata}</metadata><manifest><item id="p1" href="p1.xhtml" media-type="application/xhtml+xml"/>{manifest_extra}</manifest><spine><itemref idref="p1"/></spine></package>"#
    );
    zip.start_file("OEBPS/content.opf", stored).unwrap();
    zip.write_all(opf.as_bytes()).unwrap();
    zip.start_file("OEBPS/p1.xhtml", stored).unwrap();
    zip.write_all(b"<html><body><p>Oi</p></body></html>").unwrap();
    for (name, bytes) in files {
        zip.start_file(format!("OEBPS/{name}"), stored).unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap();
    path
}

pub(super) fn png(width: u32, height: u32) -> Vec<u8> {
    let image = image::RgbImage::from_pixel(width, height, image::Rgb([200, 40, 40]));
    let mut out = std::io::Cursor::new(Vec::new());
    image.write_to(&mut out, image::ImageFormat::Png).unwrap();
    out.into_inner()
}

pub(super) fn write_book(root: &Path, folder: &str, manifest: serde_json::Value, cover: bool) -> PathBuf {
    let dir = root.join(folder);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(LOCAL_BOOK_MANIFEST), manifest.to_string()).unwrap();
    std::fs::write(dir.join(format!("{folder}.epub")), b"x").unwrap();
    if cover {
        std::fs::write(dir.join("cover.png"), png(2, 2)).unwrap();
    }
    dir
}

#[test]
fn file_name_regex_reads_the_four_real_volumes() {
    let cases = [
        ("Unsheathed - Volume 1 - Caged Sparrow.epub", 1.0, "Caged Sparrow"),
        ("Unsheathed - Volume 2 - Traveling Boy.epub", 2.0, "Traveling Boy"),
        ("Unsheathed - Volume 3 - Golden Saber Coin.epub", 3.0, "Golden Saber Coin"),
        ("Unsheathed - Volume 4 - Approaching Sword Qi.epub", 4.0, "Approaching Sword Qi"),
    ];
    for (name, volume, subtitle) in cases {
        let found = series_from_file_name(name).expect(name);
        assert_eq!(found.name, "Unsheathed");
        assert_eq!(found.volume, Some(volume));
        assert_eq!(found.subtitle.as_deref(), Some(subtitle));
    }
}

#[test]
fn file_name_regex_variants_and_misses() {
    let found = series_from_file_name("Saga – vol. 2,5.EPUB").unwrap();
    assert_eq!((found.name.as_str(), found.volume, found.subtitle), ("Saga", Some(2.5), None));
    let found = series_from_file_name("O Rei - Livro 3: A Volta.epub").unwrap();
    assert_eq!((found.name.as_str(), found.volume), ("O Rei", Some(3.0)));
    assert_eq!(found.subtitle.as_deref(), Some("A Volta"));
    assert!(series_from_file_name("Um livro qualquer.epub").is_none());
    assert!(series_from_file_name("Volume 1.epub").is_none());
}

#[test]
fn series_id_is_an_accentless_slug() {
    assert_eq!(series_id("Unsheathed"), "series:unsheathed");
    assert_eq!(series_id("  A Canção de Gelo & Fogo!  "), "series:a-cancao-de-gelo-fogo");
    assert_eq!(series_id("Ação--Ç"), "series:acao-c");
    let cjk = series_id("剑来");
    assert!(cjk.starts_with("series:") && cjk.len() == "series:".len() + 12, "{cjk}");
    assert_ne!(cjk, series_id("雪中"));
    assert_eq!(parse_volume("1.0"), Some(1.0));
    assert_eq!(parse_volume("2.46"), Some(2.5));
    assert_eq!(parse_volume("x"), None);
}

#[test]
fn calibre_series_wins_over_epub3_and_file_name() {
    let tmp = TempDir::new("import-calibre");
    let path = make_epub(
        tmp.path(),
        "Outra - Volume 9 - Nada.epub",
        r##"<dc:title>Livro Calibre</dc:title><dc:creator>Ana Autora</dc:creator><dc:language>pt-BR</dc:language>
        <meta content="2.0" name="calibre:series_index"/><meta name="calibre:series" content="Crônicas &amp; Lendas"/>
        <meta property="belongs-to-collection" id="c1">Coleção</meta><meta refines="#c1" property="group-position">7</meta>"##,
        "",
        &[],
    );
    let preview = build_preview("a", &path, &[]);
    assert_eq!(preview.error, None);
    assert_eq!(preview.series_source, Some(SeriesSource::Calibre));
    let series = preview.series.unwrap();
    assert_eq!(series.name, "Crônicas & Lendas");
    assert_eq!(series.id, "series:cronicas-lendas");
    assert_eq!(series.volume, Some(2.0));
    // The file name matched the regex, so its subtitle is the suggested title.
    assert_eq!(preview.title, "Nada");
    assert_eq!(preview.author.as_deref(), Some("Ana Autora"));
    assert_eq!(preview.language.as_deref(), Some("pt-BR"));
    let (sha, size) = sha256_file(&path).unwrap();
    assert_eq!(sha.len(), 64);
    assert_eq!((preview.sha256, preview.size), (sha, size));
}

#[test]
fn epub3_collection_is_the_second_source() {
    let tmp = TempDir::new("import-epub3");
    let path = make_epub(
        tmp.path(),
        "qualquer.epub",
        r##"<dc:title>O Começo</dc:title><meta property="belongs-to-collection" id="serie">Mundo Novo</meta>
        <meta refines="#serie" property="collection-type">series</meta><meta refines="#serie" property="group-position">3</meta>"##,
        "",
        &[],
    );
    let preview = build_preview("b", &path, &[]);
    assert_eq!(preview.series_source, Some(SeriesSource::Epub3));
    assert_eq!(preview.series, Some(SeriesInfo { id: "series:mundo-novo".into(), name: "Mundo Novo".into(), volume: Some(3.0) }));
    // No regex match: the title comes from dc:title.
    assert_eq!(preview.title, "O Começo");
    // No dc:language in the OPF: kindling's "en" default is not reported.
    assert_eq!(preview.language, None);
    assert_eq!(preview.author, None);
}

#[test]
fn file_name_is_the_last_source_and_cover_becomes_a_small_thumbnail() {
    let tmp = TempDir::new("import-filename");
    let cover = png(900, 1200);
    let path = make_epub(
        tmp.path(),
        "Unsheathed - Volume 1 - Caged Sparrow.epub",
        "<dc:title>Unsheathed - Volume 1 - Caged Sparrow</dc:title><dc:language>pt-BR</dc:language>",
        r#"<item id="cover-image" href="images/My%20Cover.png" media-type="image/png" properties="cover-image"/>"#,
        &[("images/My Cover.png", &cover)],
    );
    let preview = build_preview("c", &path, &[]);
    assert_eq!(preview.series_source, Some(SeriesSource::Filename));
    assert_eq!(preview.series.as_ref().unwrap().id, "series:unsheathed");
    assert_eq!(preview.series.as_ref().unwrap().volume, Some(1.0));
    assert_eq!(preview.title, "Caged Sparrow");
    let data_url = preview.cover_data_url.expect("cover thumbnail");
    let encoded = data_url.strip_prefix("data:image/jpeg;base64,").expect("jpeg data url");
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).unwrap();
    let thumb = image::load_from_memory(&bytes).unwrap();
    assert_eq!((thumb.width(), thumb.height()), (450, 600));
    assert_eq!(preview.cover_from_library, None);
}

#[test]
fn file_name_without_subtitle_suggests_volume_n() {
    let tmp = TempDir::new("import-volume-n");
    let path = make_epub(tmp.path(), "Saga - Vol 2.5.epub", "", "", &[]);
    let preview = build_preview("d", &path, &[]);
    assert_eq!(preview.title, "Volume 2.5");
    assert_eq!(preview.series.unwrap().volume, Some(2.5));
}

#[test]
fn library_gives_already_imported_sibling_cover_and_author() {
    let tmp = TempDir::new("import-library");
    let source = TempDir::new("import-library-src");
    let path = make_epub(source.path(), "Unsheathed - Volume 2 - Traveling Boy.epub", "", "", &[]);
    let (sha, _) = sha256_file(&path).unwrap();
    let root = tmp.path();
    write_book(root, "Outro", serde_json::json!({ "novel_id": "novel:1", "author": "Alguém" }), true);
    let sibling = serde_json::json!({
        "novel_id": "import:aaaa", "author": "Feng",
        "series": { "id": "series:unsheathed", "name": "Unsheathed", "volume": 1 }
    });
    write_book(root, "Unsheathed - Vol 1 - Caged Sparrow", sibling, true);

    let preview = build_preview("e", &path, &library_books(root));
    assert_eq!(preview.already_imported, None);
    assert_eq!(preview.cover_from_library.as_deref(), Some("import:aaaa"));
    assert_eq!(preview.author.as_deref(), Some("Feng"));

    let mine = write_book(root, "Unsheathed - Vol 2 - Traveling Boy", serde_json::json!({ "novel_id": format!("import:{sha}") }), false);
    let preview = build_preview("e", &path, &library_books(root));
    assert_eq!(preview.already_imported, Some(AlreadyImported { output_dir: mine.to_string_lossy().to_string() }));
}

#[test]
fn invalid_epub_still_gets_sha_and_an_error() {
    let tmp = TempDir::new("import-invalid");
    let path = tmp.path().join("Quebrado - Volume 1.epub");
    std::fs::write(&path, b"not a zip").unwrap();
    let preview = build_preview("f", &path, &[]);
    assert!(preview.error.as_deref().unwrap().starts_with("EPUB inválido"));
    assert_eq!(preview.sha256.len(), 64);
    assert_eq!(preview.size, 9);
    assert_eq!(preview.title, "Volume 1");
}

#[test]
fn register_keeps_only_epubs_and_reuses_ids() {
    let tmp = TempDir::new("import-register");
    let a = make_epub(tmp.path(), "a.EPUB", "", "", &[]);
    let txt = tmp.path().join("b.txt");
    std::fs::write(&txt, b"x").unwrap();
    let missing = tmp.path().join("c.epub");
    let state = ImportEpubState::default();
    let picked = state.register(&[a.clone(), txt, missing, a.clone()]);
    assert_eq!(picked.len(), 1);
    assert_eq!(picked[0].file_name, "a.EPUB");
    assert_eq!(picked[0].size, std::fs::metadata(&a).unwrap().len());
    assert_eq!(state.path_of(&picked[0].id), Some(a.clone()));
    assert_eq!(state.register(&[a])[0].id, picked[0].id);
    assert_eq!(state.path_of("nope"), None);
}

#[test]
fn preview_serializes_in_camel_case() {
    let preview = ImportPreview { series_source: Some(SeriesSource::Epub3), ..Default::default() };
    let value = serde_json::to_value(&preview).unwrap();
    for key in ["fileName", "sha256", "seriesSource", "coverDataUrl", "coverFromLibrary", "alreadyImported"] {
        assert!(value.get(key).is_some(), "{key}");
    }
    assert_eq!(value["seriesSource"], "epub3");
}

/// `OGHMA_REAL_EPUBS=/path/to/fixtures cargo test --lib real_epubs -- --ignored --nocapture`
#[test]
#[ignore]
fn real_epubs_show_unsheathed_volumes() {
    let dir = std::env::var("OGHMA_REAL_EPUBS").expect("OGHMA_REAL_EPUBS");
    let mut paths: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "epub"))
        .collect();
    paths.sort();
    let volumes: Vec<f64> = paths
        .iter()
        .map(|path| {
            let preview = build_preview("real", path, &[]);
            println!(
                "{} -> {:?} / {:?} ({:?}) title={:?} author={:?} cover={}",
                preview.file_name,
                preview.series.as_ref().map(|s| &s.name),
                preview.series.as_ref().and_then(|s| s.volume),
                preview.series_source,
                preview.title,
                preview.author,
                preview.cover_data_url.is_some()
            );
            assert_eq!(preview.error, None);
            let series = preview.series.expect("series");
            assert_eq!(series.id, "series:unsheathed");
            series.volume.expect("volume")
        })
        .collect();
    assert_eq!(volumes, vec![1.0, 2.0, 3.0, 4.0]);
}
