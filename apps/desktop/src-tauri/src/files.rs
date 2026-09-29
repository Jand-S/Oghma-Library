use std::fs;
use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request};

use crate::paths::{expand_home, safe_relative_path};

#[derive(Serialize)]
pub struct ExportLibraryItem {
    title: String,
    output_dir: String,
    files: Vec<String>,
    cover_path: Option<String>,
    cover_data_url: Option<String>,
    size_bytes: u64,
    chapter_count: Option<u32>,
    source_chars: Option<u64>,
    word_count: Option<u64>,
    analysis_format: Option<String>,
}

const LOCAL_BOOK_MANIFEST: &str = ".oghma-book.json";

#[derive(Debug)]
struct ContentAnalysis {
    chapter_count: Option<u32>,
    source_chars: u64,
    word_count: u64,
    format: String,
}

#[derive(Deserialize)]
struct LocalBookManifest {
    chapter_count: u32,
    source_chars: u64,
    word_count: u64,
    analysis_format: String,
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
pub fn save_export_file(request: Request<'_>) -> Result<String, String> {
    fn decode_header(value: &str) -> Result<String, String> {
        let source = value.as_bytes();
        let mut decoded = Vec::with_capacity(source.len());
        let mut index = 0;
        while index < source.len() {
            if source[index] == b'%' {
                if index + 2 >= source.len() {
                    return Err("Header de arquivo invalido".to_string());
                }
                let hex = std::str::from_utf8(&source[index + 1..index + 3])
                    .map_err(|_| "Header de arquivo invalido".to_string())?;
                decoded.push(
                    u8::from_str_radix(hex, 16)
                        .map_err(|_| "Header de arquivo invalido".to_string())?,
                );
                index += 3;
            } else {
                decoded.push(source[index]);
                index += 1;
            }
        }
        String::from_utf8(decoded).map_err(|_| "Header de arquivo invalido".to_string())
    }

    let payload = match request.body() {
        InvokeBody::Raw(bytes) => bytes,
        _ => return Err("Payload binario esperado".to_string()),
    };
    let output_dir = request
        .headers()
        .get("x-oghma-output-dir")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "Pasta de saida ausente".to_string())
        .and_then(decode_header)?;
    let file_name = request
        .headers()
        .get("x-oghma-file-name")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "Nome de arquivo ausente".to_string())
        .and_then(decode_header)?;

    let relative_path = safe_relative_path(&file_name)?;
    let dir = expand_home(&output_dir);
    fs::create_dir_all(&dir)
        .map_err(|err| format!("Nao foi possivel criar a pasta de saida: {err}"))?;
    let path = dir.join(relative_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Nao foi possivel criar a pasta de assets: {err}"))?;
    }
    fs::write(&path, payload).map_err(|err| format!("Nao foi possivel salvar o arquivo: {err}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_local_path(path: String) -> Result<(), String> {
    let path = expand_home(&path);
    fs::create_dir_all(&path)
        .map_err(|err| format!("Nao foi possivel abrir/criar a pasta: {err}"))?;
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
    for entry in fs::read_dir(&root)
        .map_err(|err| format!("Nao foi possivel ler a pasta de saida: {err}"))?
    {
        let entry = entry.map_err(|err| format!("Nao foi possivel ler um item da pasta: {err}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let mut files = Vec::new();
        let mut cover_path = None;
        let mut cover_data_url = None;
        let mut size_bytes = 0;
        for file in fs::read_dir(&path)
            .map_err(|err| format!("Nao foi possivel ler uma pasta de livro: {err}"))?
        {
            let file =
                file.map_err(|err| format!("Nao foi possivel ler um arquivo exportado: {err}"))?;
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
                        cover_data_url = Some(format!(
                            "data:{};base64,{}",
                            mime_from_name(&name),
                            base64_encode(&bytes)
                        ));
                    }
                }
            } else if lower.ends_with(".epub")
                || lower.ends_with(".pdf")
                || lower.ends_with(".txt")
                || lower.ends_with(".html")
                || lower.ends_with(".azw3")
            {
                files.push(name);
            }
        }

        if files.is_empty() {
            continue;
        }
        files.sort();
        let analysis = read_local_book_manifest(&path);
        items.push(ExportLibraryItem {
            title: entry.file_name().to_string_lossy().to_string(),
            output_dir: path.to_string_lossy().to_string(),
            files,
            cover_path,
            cover_data_url,
            size_bytes,
            chapter_count: analysis.as_ref().and_then(|item| item.chapter_count),
            source_chars: analysis.as_ref().map(|item| item.source_chars),
            word_count: analysis.as_ref().map(|item| item.word_count),
            analysis_format: analysis.map(|item| item.format),
        });
    }

    items.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(items)
}

fn read_local_book_manifest(root: &Path) -> Option<ContentAnalysis> {
    let manifest: LocalBookManifest =
        serde_json::from_slice(&fs::read(root.join(LOCAL_BOOK_MANIFEST)).ok()?).ok()?;
    Some(ContentAnalysis {
        chapter_count: (manifest.chapter_count > 0).then_some(manifest.chapter_count),
        source_chars: manifest.source_chars,
        word_count: manifest.word_count,
        format: manifest.analysis_format,
    })
}

#[cfg(test)]
mod content_analysis_tests {
    use super::{read_local_book_manifest, LOCAL_BOOK_MANIFEST};
    use std::fs;

    #[test]
    fn reads_persisted_manifest_without_opening_the_book() {
        let dir = std::env::temp_dir().join(format!(
            "oghma-manifest-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(&dir).expect("manifest dir");
        fs::write(
            dir.join(LOCAL_BOOK_MANIFEST),
            r#"{"chapter_count":3033,"source_chars":22024151,"word_count":3500000,"analysis_format":"bundle"}"#,
        )
        .expect("manifest fixture");

        let analysis = read_local_book_manifest(&dir).expect("analysis");
        let _ = fs::remove_dir_all(dir);

        assert_eq!(analysis.chapter_count, Some(3033));
        assert_eq!(analysis.source_chars, 22_024_151);
        assert_eq!(analysis.format, "bundle");
    }
}

#[tauri::command]
pub fn delete_export_library_item(output_dir: String, item_dir: String) -> Result<(), String> {
    let root = expand_home(&output_dir)
        .canonicalize()
        .map_err(|err| format!("Nao foi possivel resolver a pasta de saida: {err}"))?;
    let target = expand_home(&item_dir)
        .canonicalize()
        .map_err(|err| format!("Nao foi possivel resolver a pasta do livro: {err}"))?;

    if target == root || !target.starts_with(&root) {
        return Err("Recusa de seguranca: item fora da pasta de saida".to_string());
    }
    if !target.is_dir() {
        return Err("A pasta do livro nao existe".to_string());
    }

    fs::remove_dir_all(&target)
        .map_err(|err| format!("Nao foi possivel excluir os arquivos do livro: {err}"))?;
    Ok(())
}
