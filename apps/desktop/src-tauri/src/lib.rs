use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

#[cfg(target_os = "windows")]
mod kindle_mtp;

#[derive(Serialize)]
struct ExportLibraryItem {
    title: String,
    output_dir: String,
    files: Vec<String>,
    cover_path: Option<String>,
    size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KindleStatus {
    id: String,
    device_name: String,
    connected: bool,
    mount_path: String,
    target_format: String,
    converter_available: bool,
    transport: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendKindleItem {
    id: String,
    title: String,
    output_dir: Option<String>,
    output_files: Option<Vec<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KindleSendResult {
    sent_ids: Vec<String>,
    converted_format: String,
}

fn expand_home(path: &str) -> PathBuf {
    if path == "~" || path.starts_with("~/") || path.starts_with("~\\") {
        if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
            let rest = path
                .trim_start_matches('~')
                .trim_start_matches('/')
                .trim_start_matches('\\');
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(path)
}

fn safe_file_name(file_name: &str) -> Result<&str, String> {
    let path = Path::new(file_name);
    if path.components().count() != 1 {
        return Err("Nome de arquivo invalido".to_string());
    }
    Ok(file_name)
}

fn converter_available() -> bool {
    Command::new("ebook-convert")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Kindle conectado por USB? Detecta antigo (Mass Storage) e novo (MTP) pelo
/// Vendor ID da Amazon/Lab126 (0x1949), independente de montar como drive.
fn kindle_usb_present() -> bool {
    match nusb::list_devices() {
        Ok(devices) => devices.into_iter().any(|device| {
            device.vendor_id() == 0x1949
                && device
                    .product_string()
                    .map(|name| name.to_lowercase().contains("kindle"))
                    .unwrap_or(true)
        }),
        Err(_) => false,
    }
}

fn candidate_kindle_document_dirs() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    #[cfg(target_os = "windows")]
    {
        for letter in b'D'..=b'Z' {
            candidates.push(PathBuf::from(format!("{}:\\documents", letter as char)));
            candidates.push(PathBuf::from(format!("{}:\\Documents", letter as char)));
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(entries) = fs::read_dir("/Volumes") {
            for entry in entries.flatten() {
                candidates.push(entry.path().join("documents"));
                candidates.push(entry.path().join("Documents"));
            }
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let user = std::env::var("USER").unwrap_or_default();
        for base in [format!("/media/{user}"), format!("/run/media/{user}"), "/mnt".to_string()] {
            if let Ok(entries) = fs::read_dir(base) {
                for entry in entries.flatten() {
                    candidates.push(entry.path().join("documents"));
                    candidates.push(entry.path().join("Documents"));
                }
            }
        }
    }

    candidates
}

fn find_kindle_documents_dir() -> Option<PathBuf> {
    candidate_kindle_document_dirs()
        .into_iter()
        .find(|path| path.is_dir())
}

#[tauri::command]
fn save_export_file(output_dir: String, file_name: String, bytes: Vec<u8>) -> Result<String, String> {
    let file_name = safe_file_name(&file_name)?;
    let dir = expand_home(&output_dir);
    fs::create_dir_all(&dir).map_err(|err| format!("Nao foi possivel criar a pasta de saida: {err}"))?;
    let path = dir.join(file_name);
    fs::write(&path, bytes).map_err(|err| format!("Nao foi possivel salvar o arquivo: {err}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn open_local_path(path: String) -> Result<(), String> {
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
fn list_export_library(output_dir: String) -> Result<Vec<ExportLibraryItem>, String> {
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

#[tauri::command]
fn detect_kindle() -> KindleStatus {
    let ms_dir = find_kindle_documents_dir();
    let usb = kindle_usb_present();
    let connected = usb || ms_dir.is_some();
    // transport: "mass_storage" (antigo, copia direta), "mtp" (novo, WPD/Windows), "none"
    let (transport, mount_path, id) = match &ms_dir {
        Some(path) => (
            "mass_storage".to_string(),
            path.to_string_lossy().to_string(),
            format!("kindle-{}", path.to_string_lossy()),
        ),
        None if usb => ("mtp".to_string(), String::new(), "kindle-mtp".to_string()),
        None => ("none".to_string(), String::new(), "kindle-usb".to_string()),
    };
    KindleStatus {
        id,
        device_name: "Kindle".to_string(),
        connected,
        mount_path,
        target_format: "AZW3".to_string(),
        converter_available: converter_available(),
        transport,
    }
}

#[tauri::command]
fn send_to_kindle(items: Vec<SendKindleItem>) -> Result<KindleSendResult, String> {
    let ms_dir = find_kindle_documents_dir();
    if ms_dir.is_none() && !kindle_usb_present() {
        return Err("Kindle nao encontrado por USB".to_string());
    }
    if let Some(dir) = &ms_dir {
        fs::create_dir_all(dir).map_err(|err| format!("Nao foi possivel acessar a pasta documents do Kindle: {err}"))?;
    }
    #[cfg(not(target_os = "windows"))]
    if ms_dir.is_none() {
        return Err("Envio via MTP so e suportado no Windows por enquanto.".to_string());
    }

    let mut sent_ids = Vec::new();
    for item in items {
        let output_dir = item
            .output_dir
            .as_deref()
            .map(expand_home)
            .ok_or_else(|| format!("{} nao tem pasta local de saida", item.title))?;
        let files = item.output_files.unwrap_or_default();

        let mut azw3 = files
            .iter()
            .find(|name| name.to_lowercase().ends_with(".azw3"))
            .map(|name| output_dir.join(name));

        if azw3.is_none() {
            let epub = files
                .iter()
                .find(|name| name.to_lowercase().ends_with(".epub"))
                .map(|name| output_dir.join(name))
                .ok_or_else(|| format!("{} nao tem EPUB para converter", item.title))?;
            if !converter_available() {
                return Err("Calibre/ebook-convert nao encontrado no PATH. Instale o Calibre para converter EPUB em AZW3.".to_string());
            }
            let target = output_dir.join(format!("{}.azw3", safe_export_stem(&item.title)));
            let status = Command::new("ebook-convert")
                .arg(&epub)
                .arg(&target)
                .status()
                .map_err(|err| format!("Nao foi possivel executar ebook-convert: {err}"))?;
            if !status.success() {
                return Err(format!("Falha ao converter {} para AZW3", item.title));
            }
            azw3 = Some(target);
        }

        let source = azw3.ok_or_else(|| format!("{} nao gerou AZW3", item.title))?;
        let file_name = source
            .file_name()
            .ok_or_else(|| "Arquivo AZW3 invalido".to_string())?
            .to_string_lossy()
            .to_string();
        match &ms_dir {
            Some(dir) => {
                fs::copy(&source, dir.join(&file_name))
                    .map_err(|err| format!("Nao foi possivel copiar para o Kindle: {err}"))?;
            }
            None => {
                #[cfg(target_os = "windows")]
                {
                    kindle_mtp::send_file_to_kindle(&source, &file_name)?;
                }
                #[cfg(not(target_os = "windows"))]
                {
                    return Err("Envio via MTP so e suportado no Windows.".to_string());
                }
            }
        }
        sent_ids.push(item.id);
    }

    Ok(KindleSendResult {
        sent_ids,
        converted_format: "AZW3".to_string(),
    })
}

fn safe_export_stem(title: &str) -> String {
    let mut out = String::new();
    for ch in title.chars() {
        if matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            out.push('_');
        } else {
            out.push(ch);
        }
    }
    let trimmed = out.trim();
    if trimmed.is_empty() { "book".to_string() } else { trimmed.to_string() }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_export_file, open_local_path, list_export_library, detect_kindle, send_to_kindle])
        .run(tauri::generate_context!())
        .expect("error while running Oghma Library");
}
