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
    cover_data_url: Option<String>,
    size_bytes: u64,
}

fn mime_from_name(name: &str) -> &'static str {
    let lower = name.to_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else {
        "image/jpeg"
    }
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0b0000_0011) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(((b1 & 0b0000_1111) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(b2 & 0b0011_1111) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
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
        let mut cover_data_url = None;
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
                if cover_data_url.is_none() {
                    if let Ok(bytes) = fs::read(&file_path) {
                        cover_data_url = Some(format!("data:{};base64,{}", mime_from_name(&name), base64_encode(&bytes)));
                    }
                }
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
            cover_data_url,
            size_bytes,
        });
    }

    items.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(items)
}
