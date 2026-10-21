//! `import_epub_commit` (docs/IMPORT_EPUB.md, "Pasta e marcador" and "Capa e autor").
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::commit::{commit_import, folder_title, CommitSeries, ImportCommitItem};
use super::tests::{make_epub, png, write_book};
use super::*;
use crate::files::test_support::TempDir;

fn jpeg() -> Vec<u8> {
    let image = image::RgbImage::from_pixel(3, 4, image::Rgb([10, 20, 30]));
    let mut out = std::io::Cursor::new(Vec::new());
    image.write_to(&mut out, image::ImageFormat::Jpeg).unwrap();
    out.into_inner()
}

/// The Library root, canonical like `ExportRoot` keeps it (`/var` is `/private/var` on macOS).
fn library_root(label: &str) -> (TempDir, PathBuf) {
    let dir = TempDir::new(label);
    let root = dir.path().canonicalize().unwrap();
    (dir, root)
}

fn item(title: &str, series: Option<(&str, Option<f64>)>) -> ImportCommitItem {
    ImportCommitItem {
        id: "x".to_string(),
        title: title.to_string(),
        author: Some("  Feng Huo  ".to_string()),
        series: series.map(|(name, volume)| CommitSeries { name: name.to_string(), volume }),
        cover_png: None,
    }
}

fn marker(dir: &Path) -> Value {
    serde_json::from_slice(&std::fs::read(dir.join(LOCAL_BOOK_MANIFEST)).unwrap()).unwrap()
}

fn entries(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect();
    names.sort();
    names
}

fn epub_with_jpeg_cover(dir: &Path, name: &str) -> PathBuf {
    make_epub(
        dir,
        name,
        "<dc:title>Ignorado</dc:title><dc:language>pt-BR</dc:language>",
        r#"<item id="cover" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>"#,
        &[("cover.jpg", &jpeg())],
    )
}

#[test]
fn commit_writes_folder_byte_copy_cover_and_marker() {
    let (_root, root) = library_root("commit-root");
    let source = TempDir::new("commit-src");
    let path = epub_with_jpeg_cover(source.path(), "Unsheathed - Volume 1 - Caged Sparrow.epub");
    let original = std::fs::read(&path).unwrap();
    let (sha, size) = sha256_file(&path).unwrap();

    let done = commit_import(&root, &path, &item(" Caged Sparrow ", Some(("Unsheathed", Some(1.0))))).unwrap();
    assert!(!done.existing);
    assert_eq!(done.key, format!("import:{sha}"));
    assert_eq!(done.output_dir.file_name().unwrap(), "Unsheathed - Vol 1 - Caged Sparrow");
    assert_eq!(
        entries(&done.output_dir),
        vec![".oghma-book.json", "Caged Sparrow.epub", "cover.jpg"]
    );
    assert_eq!(std::fs::read(done.output_dir.join("Caged Sparrow.epub")).unwrap(), original);
    assert_eq!(std::fs::read(&path).unwrap(), original, "the original stays as it was");
    assert_eq!(std::fs::read(done.output_dir.join("cover.jpg")).unwrap(), jpeg());
    // Only the book folder is left in the Library (no staging or trash).
    assert_eq!(entries(&root), vec!["Unsheathed - Vol 1 - Caged Sparrow"]);

    let marker = marker(&done.output_dir);
    let series = json!({ "id": "series:unsheathed", "name": "Unsheathed", "volume": 1.0 });
    assert_eq!(marker["schema_version"], 1);
    assert_eq!(marker["novel_id"], done.key.as_str());
    assert_eq!(marker["origin"], "import");
    assert_eq!(marker["title"], "Caged Sparrow");
    assert_eq!(marker["author"], "Feng Huo");
    assert_eq!(marker["language"], "pt-BR");
    assert_eq!(marker["series"], series);
    assert_eq!(marker["source_file_name"], "Unsheathed - Volume 1 - Caged Sparrow.epub");
    assert_eq!(marker["file_sha256"], sha.as_str());
    assert_eq!(marker["file_size"], size);
    assert!(marker["generated_at"].as_str().unwrap().ends_with('Z'));

    assert_eq!(
        done.snapshot,
        json!({
            "title": "Caged Sparrow", "author": "Feng Huo", "origin": "import", "language": "pt-BR",
            "series": series, "fileSize": size, "coverExt": "jpg"
        })
    );

    // The Library sees it as imported: the preview flags it and the listing exposes it.
    let preview = build_preview("x", &path, &library_books(&root));
    assert_eq!(preview.already_imported.unwrap().output_dir, done.output_dir.to_string_lossy());
    let listed = crate::files::scan_export_library(&root, false).unwrap();
    let listed = serde_json::to_value(&listed[0]).unwrap();
    assert_eq!((listed["novelId"].as_str(), listed["origin"].as_str()), (Some(done.key.as_str()), Some("import")));
}

#[test]
fn reimport_returns_the_existing_folder_without_copying_again() {
    let (_root, root) = library_root("commit-again");
    let source = TempDir::new("commit-again-src");
    let path = epub_with_jpeg_cover(source.path(), "Livro.epub");
    let first = commit_import(&root, &path, &item("Livro", None)).unwrap();
    assert_eq!(first.output_dir.file_name().unwrap(), "Livro");
    std::fs::write(first.output_dir.join("nota.txt"), b"do leitor").unwrap();

    // Same bytes under another name and another title: same key, same folder.
    let copy = source.path().join("Outro nome.epub");
    std::fs::copy(&path, &copy).unwrap();
    let again = commit_import(&root, &copy, &item("Outro título", None)).unwrap();
    assert!(again.existing);
    assert_eq!((again.key.as_str(), &again.output_dir), (first.key.as_str(), &first.output_dir));
    assert_eq!(again.snapshot["coverExt"], "jpg");
    assert_eq!(entries(&root), vec!["Livro"]);
    assert!(first.output_dir.join("nota.txt").exists(), "the existing folder is not rewritten");
}

#[test]
fn cover_comes_from_another_volume_before_the_app_png() {
    let root = TempDir::new("commit-sibling");
    let source = TempDir::new("commit-sibling-src");
    let sibling = json!({
        "novel_id": "import:aaaa",
        "series": { "id": "series:unsheathed", "name": "Unsheathed", "volume": 1 }
    });
    let sibling_dir = write_book(root.path(), "Unsheathed - Vol 1 - Caged Sparrow", sibling, true);
    write_book(root.path(), "Outro", json!({ "novel_id": "novel:9" }), true);

    let path = make_epub(source.path(), "v2.epub", "", "", &[]);
    let mut volume_two = item("Traveling Boy", Some(("  Unsheathed ", Some(2.04))));
    volume_two.cover_png = Some(png(5, 5));
    let done = commit_import(root.path(), &path, &volume_two).unwrap();
    assert_eq!(done.output_dir.file_name().unwrap(), "Unsheathed - Vol 2 - Traveling Boy");
    assert_eq!(
        std::fs::read(done.output_dir.join("cover.png")).unwrap(),
        std::fs::read(sibling_dir.join("cover.png")).unwrap()
    );
    // The series id is recomputed from the name and the volume keeps one decimal place.
    assert_eq!(marker(&done.output_dir)["series"], json!({ "id": "series:unsheathed", "name": "Unsheathed", "volume": 2.0 }));
    assert_eq!(done.snapshot["coverExt"], "png");
    // No dc:language: the field stays out.
    assert!(marker(&done.output_dir).get("language").is_none());
}

#[test]
fn app_png_is_the_last_cover_and_anything_else_is_refused() {
    let root = TempDir::new("commit-png");
    let source = TempDir::new("commit-png-src");
    let generated = png(6, 8);

    let first = make_epub(source.path(), "Sozinho - Livro 1.epub", "<dc:title>A</dc:title>", "", &[]);
    let mut with_png = item("Volume 1", Some(("Sozinho", Some(1.0))));
    with_png.cover_png = Some(generated.clone());
    let done = commit_import(root.path(), &first, &with_png).unwrap();
    assert_eq!(std::fs::read(done.output_dir.join("cover.png")).unwrap(), generated);

    // Not a PNG (the webview sends bytes): no cover file and no coverExt.
    let second = make_epub(source.path(), "Solto.epub", "<dc:title>B</dc:title>", "", &[]);
    let mut bad = item("Solto", None);
    bad.author = None;
    bad.cover_png = Some(b"<svg/>".to_vec());
    let done = commit_import(root.path(), &second, &bad).unwrap();
    assert_eq!(entries(&done.output_dir), vec![".oghma-book.json", "Solto.epub"]);
    assert!(done.snapshot.get("coverExt").is_none());
    assert!(done.snapshot.get("author").is_none() && done.snapshot.get("series").is_none());
    assert!(marker(&done.output_dir).get("series").is_none());
}

#[test]
fn taken_folder_name_gets_a_suffix_and_blank_title_uses_the_file_name() {
    let root = TempDir::new("commit-taken");
    let source = TempDir::new("commit-taken-src");
    write_book(root.path(), "Meu Livro", json!({ "novel_id": "novel:1" }), false);
    let path = make_epub(source.path(), "Meu Livro.epub", "", "", &[]);
    let done = commit_import(root.path(), &path, &item("   ", None)).unwrap();
    assert_eq!(done.output_dir.file_name().unwrap(), "Meu Livro (2)");
    assert_eq!(marker(&done.output_dir)["title"], "Meu Livro");
    assert!(done.output_dir.join("Meu Livro.epub").exists());
}

#[test]
fn invalid_epub_writes_nothing() {
    let root = TempDir::new("commit-invalid");
    let source = TempDir::new("commit-invalid-src");
    let path = source.path().join("quebrado.epub");
    std::fs::write(&path, b"isto nao e zip").unwrap();
    let err = commit_import(root.path(), &path, &item("Quebrado", None)).unwrap_err();
    assert!(err.starts_with("EPUB inválido"), "{err}");
    assert!(entries(root.path()).is_empty());
}

#[test]
fn folder_title_follows_the_contract() {
    let series = |volume| SeriesInfo { id: "series:s".into(), name: "Série".into(), volume };
    assert_eq!(folder_title(Some(&series(Some(1.0))), "T"), "Série - Vol 1 - T");
    assert_eq!(folder_title(Some(&series(Some(2.5))), "T"), "Série - Vol 2.5 - T");
    assert_eq!(folder_title(Some(&series(None)), "T"), "Série - T");
    assert_eq!(folder_title(None, "T"), "T");
}

#[test]
fn commit_item_deserializes_from_the_webview() {
    let parsed: ImportCommitItem = serde_json::from_value(json!({
        "id": "a", "title": "T", "author": null,
        "series": { "name": "S", "volume": 2.5 }, "coverPng": [137, 80, 78, 71]
    }))
    .unwrap();
    assert_eq!(parsed.cover_png, Some(vec![137, 80, 78, 71]));
    assert_eq!(parsed.series.unwrap().volume, Some(2.5));
    let result = serde_json::to_value(ImportResult { id: "a".into(), key: "import:x".into(), ..Default::default() }).unwrap();
    for key in ["id", "key", "outputDir", "error"] {
        assert!(result.get(key).is_some(), "missing {key}");
    }
}

/// `OGHMA_REAL_EPUBS=/path/to/fixtures cargo test --lib real_epubs_import -- --ignored --nocapture`
#[test]
#[ignore]
fn real_epubs_import_as_one_series() {
    let dir = std::env::var("OGHMA_REAL_EPUBS").expect("OGHMA_REAL_EPUBS");
    let root = TempDir::new("commit-real");
    let mut paths: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "epub"))
        .collect();
    paths.sort();
    for path in &paths {
        let preview = build_preview("real", path, &library_books(root.path()));
        let series = preview.series.clone().expect("series");
        let commit = ImportCommitItem {
            id: "real".into(),
            title: preview.title.clone(),
            author: preview.author.clone(),
            series: Some(CommitSeries { name: series.name, volume: series.volume }),
            cover_png: None,
        };
        let done = commit_import(root.path(), path, &commit).unwrap();
        println!("{} -> {:?} {}", preview.file_name, entries(&done.output_dir), done.snapshot);
        assert_eq!(std::fs::read(path).unwrap(), std::fs::read(done.output_dir.join(format!("{}.epub", preview.title))).unwrap());
    }
    assert_eq!(library_books(root.path()).iter().filter(|b| b.series_id.as_deref() == Some("series:unsheathed")).count(), paths.len());
}
