use std::fs;
use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;

use crate::paths::{expand_home, safe_export_stem};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KindleStatus {
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
pub struct SendKindleItem {
    id: String,
    title: String,
    output_dir: Option<String>,
    output_files: Option<Vec<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KindleSendResult {
    sent_ids: Vec<String>,
    converted_format: String,
}

fn converter_available() -> bool {
    Command::new("ebook-convert")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

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
pub fn detect_kindle() -> KindleStatus {
    let ms_dir = find_kindle_documents_dir();
    let usb = kindle_usb_present();
    let connected = usb || ms_dir.is_some();
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
pub fn send_to_kindle(items: Vec<SendKindleItem>) -> Result<KindleSendResult, String> {
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
                    crate::kindle_mtp::send_file_to_kindle(&source, &file_name)?;
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
