use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;

use image::codecs::jpeg::JpegEncoder;
use serde::Serialize;

use crate::paths::{expand_home, safe_export_stem, safe_relative_path};

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Azw3ConversionResult {
    file_name: String,
}

struct KindleThumbnail {
    file_name: String,
    data: Vec<u8>,
}

fn be_u16(data: &[u8], offset: usize) -> Option<u16> {
    let bytes: [u8; 2] = data.get(offset..offset + 2)?.try_into().ok()?;
    Some(u16::from_be_bytes(bytes))
}

fn be_u32(data: &[u8], offset: usize) -> Option<u32> {
    let bytes: [u8; 4] = data.get(offset..offset + 4)?.try_into().ok()?;
    Some(u32::from_be_bytes(bytes))
}

fn safe_thumbnail_component(value: &[u8]) -> Option<String> {
    let value = std::str::from_utf8(value).ok()?.trim_matches('\0').trim();
    if value.is_empty()
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return None;
    }
    Some(value.to_string())
}

fn thumbnail_filename_from_record0(record0: &[u8]) -> Result<String, String> {
    let mobi_length = be_u32(record0, 20).ok_or_else(|| "Cabecalho MOBI incompleto".to_string())? as usize;
    let exth_offset = 16usize
        .checked_add(mobi_length)
        .ok_or_else(|| "Offset EXTH invalido".to_string())?;
    if record0.get(exth_offset..exth_offset + 4) != Some(b"EXTH") {
        return Err("AZW3 nao contem cabecalho EXTH".to_string());
    }
    let exth_length = be_u32(record0, exth_offset + 4)
        .ok_or_else(|| "Cabecalho EXTH incompleto".to_string())? as usize;
    let item_count = be_u32(record0, exth_offset + 8)
        .ok_or_else(|| "Cabecalho EXTH incompleto".to_string())? as usize;
    let exth_end = exth_offset
        .checked_add(exth_length)
        .filter(|end| *end <= record0.len())
        .ok_or_else(|| "Tamanho EXTH invalido".to_string())?;

    let mut uuid = None;
    let mut content_type = None;
    let mut position = exth_offset + 12;
    for _ in 0..item_count {
        let id = be_u32(record0, position).ok_or_else(|| "Registro EXTH incompleto".to_string())?;
        let size = be_u32(record0, position + 4).ok_or_else(|| "Registro EXTH incompleto".to_string())? as usize;
        if size < 8 || position.checked_add(size).is_none_or(|end| end > exth_end) {
            return Err("Registro EXTH invalido".to_string());
        }
        let content = &record0[position + 8..position + size];
        match id {
            113 => uuid = safe_thumbnail_component(content),
            501 => content_type = safe_thumbnail_component(content),
            _ => {}
        }
        position += size;
    }

    let uuid = uuid.ok_or_else(|| "AZW3 nao contem identificador EXTH 113".to_string())?;
    let content_type = content_type.ok_or_else(|| "AZW3 nao contem tipo EXTH 501".to_string())?;
    Ok(format!("thumbnail_{uuid}_{content_type}_portrait.jpg"))
}

fn kindle_thumbnail_filename(azw3: &Path) -> Result<String, String> {
    let mut file = File::open(azw3).map_err(|err| format!("Nao foi possivel ler o AZW3: {err}"))?;
    let mut pdb_header = [0u8; 94];
    file.read_exact(&mut pdb_header)
        .map_err(|err| format!("Cabecalho AZW3 incompleto: {err}"))?;
    if &pdb_header[60..68] != b"BOOKMOBI" && &pdb_header[60..68] != b"TEXTREAD" {
        return Err("Arquivo nao e um AZW3/MOBI valido".to_string());
    }
    let section_count = be_u16(&pdb_header, 76).unwrap_or(0);
    if section_count < 2 {
        return Err("AZW3 nao contem secoes suficientes".to_string());
    }
    let first = be_u32(&pdb_header, 78).unwrap_or(0) as u64;
    let second = be_u32(&pdb_header, 86).unwrap_or(0) as u64;
    if second <= first || second - first > 16 * 1024 * 1024 {
        return Err("Secao de metadados AZW3 invalida".to_string());
    }
    let mut record0 = vec![0u8; (second - first) as usize];
    file.seek(SeekFrom::Start(first))
        .and_then(|_| file.read_exact(&mut record0))
        .map_err(|err| format!("Nao foi possivel ler os metadados AZW3: {err}"))?;
    thumbnail_filename_from_record0(&record0)
}

fn build_kindle_thumbnail(azw3: &Path, cover: &Path) -> Result<KindleThumbnail, String> {
    let image = image::ImageReader::open(cover)
        .map_err(|err| format!("Nao foi possivel abrir a capa: {err}"))?
        .with_guessed_format()
        .map_err(|err| format!("Formato de capa invalido: {err}"))?
        .decode()
        .map_err(|err| format!("Nao foi possivel decodificar a capa: {err}"))?;
    let image = image.thumbnail(500, 500);
    let mut data = Vec::new();
    JpegEncoder::new_with_quality(&mut data, 75)
        .encode_image(&image)
        .map_err(|err| format!("Nao foi possivel gerar a thumbnail Kindle: {err}"))?;
    Ok(KindleThumbnail {
        file_name: kindle_thumbnail_filename(azw3)?,
        data,
    })
}

fn install_mass_storage_thumbnail(documents_dir: &Path, thumbnail: &KindleThumbnail) -> Result<(), String> {
    let root = documents_dir
        .parent()
        .ok_or_else(|| "Nao foi possivel localizar a raiz do Kindle".to_string())?;
    let thumbnail_dir = root.join("system").join("thumbnails");
    let cache_dir = root.join("amazon-cover-bug");
    fs::create_dir_all(&thumbnail_dir)
        .map_err(|err| format!("Nao foi possivel acessar system/thumbnails: {err}"))?;
    fs::create_dir_all(&cache_dir)
        .map_err(|err| format!("Nao foi possivel criar o cache de capas: {err}"))?;
    fs::write(thumbnail_dir.join(&thumbnail.file_name), &thumbnail.data)
        .map_err(|err| format!("Nao foi possivel salvar a capa no Kindle: {err}"))?;
    fs::write(cache_dir.join(&thumbnail.file_name), &thumbnail.data)
        .map_err(|err| format!("Nao foi possivel salvar o cache da capa: {err}"))?;
    Ok(())
}

fn sync_mass_storage_thumbnail_cache(documents_dir: &Path) -> Result<(), String> {
    let root = documents_dir
        .parent()
        .ok_or_else(|| "Nao foi possivel localizar a raiz do Kindle".to_string())?;
    let cache_dir = root.join("amazon-cover-bug");
    if !cache_dir.is_dir() {
        return Ok(());
    }
    let thumbnail_dir = root.join("system").join("thumbnails");
    fs::create_dir_all(&thumbnail_dir)
        .map_err(|err| format!("Nao foi possivel acessar system/thumbnails: {err}"))?;
    for entry in fs::read_dir(cache_dir).map_err(|err| format!("Nao foi possivel ler o cache de capas: {err}"))? {
        let entry = entry.map_err(|err| format!("Nao foi possivel ler uma capa em cache: {err}"))?;
        let source = entry.path();
        if !source.is_file() {
            continue;
        }
        let target = thumbnail_dir.join(entry.file_name());
        let needs_restore = match (fs::metadata(&source), fs::metadata(&target)) {
            (Ok(source_meta), Ok(target_meta)) => source_meta.len() != target_meta.len(),
            (Ok(_), Err(_)) => true,
            _ => false,
        };
        if needs_restore {
            fs::copy(&source, &target)
                .map_err(|err| format!("Nao foi possivel restaurar uma capa do Kindle: {err}"))?;
        }
    }
    Ok(())
}

fn converter_available() -> bool {
    Command::new("ebook-convert")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn find_cover_file(output_dir: &PathBuf) -> Option<PathBuf> {
    fs::read_dir(output_dir).ok()?.flatten().find_map(|entry| {
        let path = entry.path();
        let name = path.file_name()?.to_string_lossy().to_lowercase();
        let is_cover = name.starts_with("cover.")
            && (name.ends_with(".jpg")
                || name.ends_with(".jpeg")
                || name.ends_with(".png")
                || name.ends_with(".webp"));
        if path.is_file() && is_cover {
            Some(path)
        } else {
            None
        }
    })
}

fn convert_epub_to_azw3(epub: &PathBuf, target: &PathBuf, cover: Option<PathBuf>) -> Result<(), String> {
    let mut command = Command::new("ebook-convert");
    command.arg(epub).arg(target);
    if let Some(cover_path) = cover {
        command.arg("--cover").arg(cover_path);
    }
    let status = command
        .status()
        .map_err(|err| format!("Nao foi possivel executar ebook-convert: {err}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Falha ao converter para AZW3".to_string())
    }
}

#[tauri::command]
pub fn convert_export_to_azw3(
    title: String,
    output_dir: String,
    output_files: Vec<String>,
) -> Result<Azw3ConversionResult, String> {
    let output_dir = expand_home(&output_dir);
    fs::create_dir_all(&output_dir)
        .map_err(|err| format!("Nao foi possivel acessar a pasta de saida: {err}"))?;

    if let Some(existing) = output_files
        .iter()
        .find(|name| name.to_lowercase().ends_with(".azw3"))
    {
        let relative = safe_relative_path(existing)?;
        if output_dir.join(&relative).is_file() {
            return Ok(Azw3ConversionResult {
                file_name: existing.to_string(),
            });
        }
    }

    let epub = output_files
        .iter()
        .find(|name| name.to_lowercase().ends_with(".epub"))
        .map(|name| safe_relative_path(name).map(|relative| output_dir.join(relative)))
        .transpose()?
        .filter(|path| path.is_file())
        .or_else(|| {
            fs::read_dir(&output_dir).ok().and_then(|entries| {
                entries.flatten().find_map(|entry| {
                    let path = entry.path();
                    let is_epub = path
                        .extension()
                        .and_then(|ext| ext.to_str())
                        .map(|ext| ext.eq_ignore_ascii_case("epub"))
                        .unwrap_or(false);
                    if path.is_file() && is_epub {
                        Some(path)
                    } else {
                        None
                    }
                })
            })
        })
        .ok_or_else(|| format!("{title} nao tem EPUB para converter em AZW3"))?;

    if !converter_available() {
        return Err("Calibre/ebook-convert nao encontrado no PATH. Instale o Calibre para converter EPUB em AZW3.".to_string());
    }

    let file_name = format!("{}.azw3", safe_export_stem(&title));
    let target = output_dir.join(&file_name);
    convert_epub_to_azw3(&epub, &target, find_cover_file(&output_dir))
        .map_err(|err| format!("Falha ao converter {title} para AZW3: {err}"))?;

    Ok(Azw3ConversionResult { file_name })
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
    if let Some(path) = &ms_dir {
        let _ = sync_mass_storage_thumbnail_cache(path);
    }
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
            convert_epub_to_azw3(&epub, &target, find_cover_file(&output_dir))
                .map_err(|err| format!("Falha ao converter {} para AZW3: {err}", item.title))?;
            azw3 = Some(target);
        }

        let source = azw3.ok_or_else(|| format!("{} nao gerou AZW3", item.title))?;
        let cover = find_cover_file(&output_dir)
            .ok_or_else(|| format!("{} nao tem capa local para enviar ao Kindle", item.title))?;
        let thumbnail = build_kindle_thumbnail(&source, &cover)
            .map_err(|err| format!("Nao foi possivel preparar a capa de {}: {err}", item.title))?;
        let file_name = source
            .file_name()
            .ok_or_else(|| "Arquivo AZW3 invalido".to_string())?
            .to_string_lossy()
            .to_string();
        match &ms_dir {
            Some(dir) => {
                fs::copy(&source, dir.join(&file_name))
                    .map_err(|err| format!("Nao foi possivel copiar para o Kindle: {err}"))?;
                install_mass_storage_thumbnail(dir, &thumbnail)?;
            }
            None => {
                #[cfg(target_os = "windows")]
                {
                    crate::kindle_mtp::send_file_to_kindle(&source, &file_name)?;
                    crate::kindle_mtp::send_thumbnail_to_kindle(&thumbnail.file_name, &thumbnail.data)?;
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

#[cfg(test)]
mod tests {
    use super::thumbnail_filename_from_record0;

    fn exth_record(id: u32, content: &[u8]) -> Vec<u8> {
        let mut record = Vec::new();
        record.extend_from_slice(&id.to_be_bytes());
        record.extend_from_slice(&((content.len() + 8) as u32).to_be_bytes());
        record.extend_from_slice(content);
        record
    }

    #[test]
    fn builds_kindle_thumbnail_name_from_exth_metadata() {
        let uuid = b"aecccc50-50d7-419f-9bc9-25a13871f389";
        let records = [exth_record(113, uuid), exth_record(501, b"EBOK")].concat();
        let mobi_length = 0xe8usize;
        let exth_offset = 16 + mobi_length;
        let exth_length = 12 + records.len();
        let mut record0 = vec![0u8; exth_offset + exth_length];
        record0[20..24].copy_from_slice(&(mobi_length as u32).to_be_bytes());
        record0[exth_offset..exth_offset + 4].copy_from_slice(b"EXTH");
        record0[exth_offset + 4..exth_offset + 8].copy_from_slice(&(exth_length as u32).to_be_bytes());
        record0[exth_offset + 8..exth_offset + 12].copy_from_slice(&2u32.to_be_bytes());
        record0[exth_offset + 12..].copy_from_slice(&records);

        let name = thumbnail_filename_from_record0(&record0).expect("valid EXTH metadata");
        assert_eq!(name, "thumbnail_aecccc50-50d7-419f-9bc9-25a13871f389_EBOK_portrait.jpg");
    }
}
