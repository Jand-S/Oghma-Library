//! iCloud Drive: copies a book's EPUB into a folder of the user's iCloud Drive
//! (default "Livros"); macOS uploads it in the background, and it opens on the
//! iPhone/iPad from Files or Apple Books.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::export_root::ExportRoot;
use crate::paths::{expand_home, sanitize_file_name};

pub const DEFAULT_FOLDER: &str = "Livros";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudItem {
    pub id: String,
    pub title: String,
    pub output_dir: Option<String>,
    pub output_files: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStatus {
    pub available: bool,
    /// iCloud Drive root (empty when unavailable).
    pub root: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSaveResult {
    pub saved_ids: Vec<String>,
    pub paths: Vec<String>,
    pub folder_path: String,
}

/// `~/Library/Mobile Documents/com~apple~CloudDocs` when iCloud Drive is on.
pub fn icloud_drive_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    let dir = home.join("Library/Mobile Documents/com~apple~CloudDocs");
    dir.is_dir().then_some(dir)
}

/// Folder inside iCloud Drive: plain relative names only (no "..", no absolute paths).
fn target_folder(root: &Path, folder: &str) -> Result<PathBuf, String> {
    let folder = folder.trim().trim_matches('/');
    let folder = if folder.is_empty() { DEFAULT_FOLDER } else { folder };
    if folder.split('/').any(|part| part.is_empty() || part == "." || part == ".." || part.starts_with('.')) {
        return Err(format!("Pasta do iCloud inválida: {folder}"));
    }
    Ok(root.join(folder))
}

fn epub_of(item: &CloudItem) -> Result<PathBuf, String> {
    let dir = item
        .output_dir
        .as_deref()
        .map(expand_home)
        .ok_or_else(|| format!("{} não tem pasta local", item.title))?;
    let listed = item
        .output_files
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|name| dir.join(name))
        .find(|path| path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("epub")) && path.is_file());
    listed
        .or_else(|| {
            fs::read_dir(&dir).ok()?.flatten().map(|e| e.path()).find(|path| {
                path.is_file() && path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("epub"))
            })
        })
        .ok_or_else(|| format!("{} não tem EPUB para enviar", item.title))
}

/// Copies through a temp file + rename, replacing an older copy with the same name.
pub fn save_items(root: &Path, folder: &str, items: &[CloudItem]) -> Result<CloudSaveResult, String> {
    let target = target_folder(root, folder)?;
    fs::create_dir_all(&target).map_err(|err| format!("Não foi possível criar a pasta no iCloud Drive: {err}"))?;
    let mut saved_ids = Vec::new();
    let mut paths = Vec::new();
    for item in items {
        let source = epub_of(item)?;
        let name = format!("{}.epub", sanitize_file_name(item.title.trim()));
        let dest = target.join(&name);
        let temp = target.join(format!(".{name}.oghma-tmp"));
        fs::copy(&source, &temp).map_err(|err| format!("Não foi possível copiar {} para o iCloud: {err}", item.title))?;
        fs::rename(&temp, &dest).map_err(|err| {
            let _ = fs::remove_file(&temp);
            format!("Não foi possível salvar {} no iCloud: {err}", item.title)
        })?;
        saved_ids.push(item.id.clone());
        paths.push(dest.to_string_lossy().to_string());
    }
    Ok(CloudSaveResult { saved_ids, paths, folder_path: target.to_string_lossy().to_string() })
}

#[tauri::command]
pub fn icloud_status() -> CloudStatus {
    match icloud_drive_dir() {
        Some(root) => CloudStatus { available: true, root: root.to_string_lossy().to_string() },
        None => CloudStatus { available: false, root: String::new() },
    }
}

#[tauri::command]
pub async fn icloud_save(
    export_root: tauri::State<'_, ExportRoot>,
    items: Vec<CloudItem>,
    folder: Option<String>,
) -> Result<CloudSaveResult, String> {
    for item in &items {
        if let Some(dir) = &item.output_dir {
            export_root.require_inside(Path::new(dir))?;
        }
    }
    let root = icloud_drive_dir().ok_or("O iCloud Drive não está ativado neste Mac (Ajustes do Sistema → Apple ID → iCloud).")?;
    let folder = folder.unwrap_or_else(|| DEFAULT_FOLDER.to_string());
    tauri::async_runtime::spawn_blocking(move || save_items(&root, &folder, &items))
        .await
        .map_err(|err| err.to_string())?
}

/// Shows a saved file (or folder) in Finder.
#[tauri::command(async)]
pub fn icloud_reveal(path: String) -> Result<(), String> {
    let root = icloud_drive_dir().ok_or("iCloud Drive indisponível")?;
    // Canonical paths: "root/../.." would pass a plain starts_with.
    let root = root.canonicalize().map_err(|err| err.to_string())?;
    let path = PathBuf::from(path).canonicalize().map_err(|_| "Arquivo não encontrado no iCloud Drive".to_string())?;
    if !path.starts_with(&root) {
        return Err("Caminho fora do iCloud Drive".into());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("oghma-cloud-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn copies_the_epub_and_replaces_older_copies() {
        let book = temp_dir("book");
        fs::write(book.join("Livro (PT-BR).epub"), b"v1").unwrap();
        fs::write(book.join("cover.png"), b"x").unwrap();
        let root = temp_dir("root");
        let item = CloudItem {
            id: "1".into(),
            title: "Livro (PT-BR)".into(),
            output_dir: Some(book.to_string_lossy().to_string()),
            output_files: Some(vec!["Livro (PT-BR).epub".into()]),
        };
        let out = save_items(&root, "Livros", std::slice::from_ref(&item)).unwrap();
        let dest = root.join("Livros/Livro (PT-BR).epub");
        assert_eq!(out.paths, vec![dest.to_string_lossy().to_string()]);
        assert_eq!(fs::read(&dest).unwrap(), b"v1");

        fs::write(book.join("Livro (PT-BR).epub"), b"v2").unwrap();
        save_items(&root, "Livros", &[item]).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"v2", "a new copy replaces the old one");
        let leftovers: Vec<_> = fs::read_dir(root.join("Livros")).unwrap().flatten().collect();
        assert_eq!(leftovers.len(), 1, "no temp files left behind");
    }

    #[test]
    fn rejects_bad_folders_and_books_without_epub() {
        let root = temp_dir("bad");
        assert!(target_folder(&root, "../fora").is_err());
        assert!(target_folder(&root, ".escondida").is_err());
        assert_eq!(target_folder(&root, "  ").unwrap(), root.join(DEFAULT_FOLDER));
        assert_eq!(target_folder(&root, "Livros/Novels").unwrap(), root.join("Livros/Novels"));
        let book = temp_dir("noepub");
        fs::write(book.join("x.azw3"), b"x").unwrap();
        let item = CloudItem { id: "2".into(), title: "Sem".into(), output_dir: Some(book.to_string_lossy().to_string()), output_files: None };
        assert!(save_items(&root, "Livros", &[item]).unwrap_err().contains("EPUB"));
    }
}
