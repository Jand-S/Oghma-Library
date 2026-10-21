//! Imported EPUBs in the Library listing (docs/IMPORT_EPUB.md, "Pasta e marcador").
use super::test_support::TempDir;
use super::*;

fn book(root: &Path, folder: &str, manifest: serde_json::Value) {
    let dir = root.join(folder);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(format!("{folder}.epub")), b"epub").unwrap();
    fs::write(dir.join(LOCAL_BOOK_MANIFEST), manifest.to_string()).unwrap();
}

#[test]
fn imported_book_exposes_series_and_origin_in_camel_case() {
    let root = TempDir::new("scan-import");
    let sha = "ab".repeat(32);
    book(
        root.path(),
        "Unsheathed - Vol 1 - Caged Sparrow",
        serde_json::json!({
            "schema_version": 1,
            "novel_id": format!("import:{sha}"),
            "origin": "import",
            "title": "Caged Sparrow",
            "series": { "id": "series:unsheathed", "name": "Unsheathed", "volume": 1.5 },
            "source_file_name": "Unsheathed - Volume 1 - Caged Sparrow.epub",
            "file_sha256": sha,
            "file_size": 1878579,
        }),
    );
    let items = scan_export_library(root.path(), false).unwrap();
    let item = &items[0];
    assert_eq!(item.origin.as_deref(), Some("import"));
    assert_eq!(
        item.series,
        Some(SeriesInfo { id: "series:unsheathed".into(), name: "Unsheathed".into(), volume: Some(1.5) })
    );
    let json = serde_json::to_value(item).unwrap();
    assert_eq!(json["novelId"], format!("import:{sha}"));
    assert_eq!(json["series"]["name"], "Unsheathed");
    assert_eq!(json["sourceFileName"], "Unsheathed - Volume 1 - Caged Sparrow.epub");
    assert_eq!(json["fileSha256"], sha);
    assert_eq!(json["fileSize"], 1878579);
}

#[test]
fn catalog_book_and_malformed_series_still_list() {
    let root = TempDir::new("scan-import-loose");
    book(root.path(), "A", serde_json::json!({ "novel_id": "42", "title": "A" }));
    book(
        root.path(),
        "B",
        serde_json::json!({ "novel_id": "43", "title": "B", "series": { "id": 7, "name": "X" } }),
    );
    let items = scan_export_library(root.path(), false).unwrap();
    assert_eq!(items.len(), 2);
    for item in &items {
        assert!(item.origin.is_none() && item.series.is_none() && item.file_sha256.is_none());
    }
    assert_eq!(items[1].novel_id.as_deref(), Some("43"), "a bad series keeps the rest of the manifest");
}
