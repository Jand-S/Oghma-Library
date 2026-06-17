use std::fs;
use std::process::Command;

use serde::Serialize;

use crate::paths::{expand_home, safe_file_name};

#[derive(Serialize)]
pub struct ExportLibraryItem {
    title: String,
    output_dir: String,
    files: Vec<String>,
    cover_path: Option<String>,
    size_bytes: u64,
}

#[tauri::command]
pub fn save_export_file(output_dir: String, file_name: String, bytes: Vec<u8>) -> Result<String, String> {
    let file_name = safe_file_name(&file_name)?;
    let dir = expand_home(&output_dir);
    fs::create_dir_all(&dir).map_err(|err| format!("Nao foi possivel criar a pasta de saida: {err}"))?;
    let path = dir.join(file_name);
    fs::write(&path, bytes).map_err(|err| format!("Nao foi possivel salvar o arquivo: {err}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_local_path(path: String) -> Result<(), String> {
    let path = expand_home(&path);
    fs::create_dir_all(&path).map_err(|err| format!("Nao foi possivel abrir/criar a pasta: {err}"))?;
    let path = path
        .canonicalize()
        .map_err(|err| format!("Nao foi possivel resolver a pasta: {err}"))?;

    #[cfg(target_os = "windows")]
    let status = Command::new("explorer").arg(path.as_os_str()).status();
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(&path).status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(&path).status();

    status
        .map_err(|err| format!("Nao foi possivel abrir a pasta: {err}"))
        .and_then(|exit| {
            if exit.success() {
                Ok(())
            } else {
                Err("O sistema recusou abrir a pasta".to_string())
            }
        })
}

#[tauri::command]
pub fn list_export_library(output_dir: String) -> Result<Vec<ExportLibraryItem>, String> {
    let root = expand_home(&output_dir);
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut items = Vec::new();
    for entry in fs::read_dir(&root).map_err(|err| format!("Nao foi possivel ler a pasta de saida: {err}"))? {
        let entry = entry.map_err(|err| format!("Nao foi possivel ler um item da pasta: {err}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let mut files = Vec::new();
        let mut cover_path = None;
        let mut size_bytes = 0;
        for file in fs::read_dir(&path).map_err(|err| format!("Nao foi possivel ler uma pasta de livro: {err}"))? {
            let file = file.map_err(|err| format!("Nao foi possivel ler um arquivo exportado: {err}"))?;
            let file_path = file.path();
            if !file_path.is_file() {
                continue;
            }
            let name = file.file_name().to_string_lossy().to_string();
            let lower = name.to_lowercase();
            size_bytes += file.metadata().map(|m| m.len()).unwrap_or(0);
            if lower.starts_with("cover.") {
                cover_path = Some(file_path.to_string_lossy().to_string());
            } else if lower.ends_with(".epub") || lower.ends_with(".pdf") || lower.ends_with(".txt") || lower.ends_with(".html") {
                files.push(name);
            }
        }

        if files.is_empty() {
            continue;
        }
        files.sort();
        items.push(ExportLibraryItem {
            title: entry.file_name().to_string_lossy().to_string(),
            output_dir: path.to_string_lossy().to_string(),
            files,
            cover_path,
            size_bytes,
        });
    }

    items.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(items)
}
