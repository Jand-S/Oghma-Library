use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;

use image::codecs::jpeg::JpegEncoder;
use kindling::extracted::ExtractedEpub;
use kindling::mobi_rewrite::{rewrite_mobi_metadata, MetadataUpdates};
use serde::Serialize;

use crate::files::{pick_cover, read_manifest, unique_suffix};
use crate::export_root::ExportRoot;
use crate::paths::{expand_home, is_hidden_name, safe_export_stem, safe_relative_path};

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
    /// Amazon's "Send to Kindle" app is installed (wireless sending, macOS).
    wireless_available: bool,
    /// Wireless sending exists on this platform (macOS), installed or not.
    wireless_supported: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KindleWirelessResult {
    opened_ids: Vec<String>,
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

/// Kindling emits a hardcoded DATP record copied from a single-record comic
/// template. The Kindle firmware reads DATP for total location count and gets 4
/// instead of the real value from FCIS. Setting datp_idx (mobi+240) to
/// 0xFFFFFFFF disables DATP and makes Kindle fall back to FCIS, matching
/// Calibre's behavior and producing the correct location bar.
fn patch_azw3_datp(path: &Path) -> Result<(), String> {
    let mut data = fs::read(path)
        .map_err(|e| format!("Não foi possível ler AZW3 para patch DATP: {e}"))?;
    let r0 = be_u32(&data, 78)
        .ok_or("AZW3 inválido: não foi possível ler offset do record 0")? as usize;
    // mobi header at r0+16; datp_idx field at mobi+240 = r0+256
    let datp_offset = r0 + 256;
    if datp_offset + 4 > data.len() {
        return Err("AZW3 inválido: arquivo muito pequeno para conter mobi+240".to_string());
    }
    data[datp_offset..datp_offset + 4].copy_from_slice(&0xFFFFFFFFu32.to_be_bytes());
    fs::write(path, &data)
        .map_err(|e| format!("Não foi possível gravar AZW3 com patch DATP: {e}"))
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
        .ok_or_else(|| "Offset EXTH inválido".to_string())?;
    if record0.get(exth_offset..exth_offset + 4) != Some(&b"EXTH"[..]) {
        return Err("AZW3 não contém cabeçalho EXTH".to_string());
    }
    let exth_length = be_u32(record0, exth_offset + 4)
        .ok_or_else(|| "Cabecalho EXTH incompleto".to_string())? as usize;
    let item_count = be_u32(record0, exth_offset + 8)
        .ok_or_else(|| "Cabecalho EXTH incompleto".to_string())? as usize;
    let exth_end = exth_offset
        .checked_add(exth_length)
        .filter(|end| *end <= record0.len())
        .ok_or_else(|| "Tamanho EXTH inválido".to_string())?;

    let mut uuid = None;
    let mut content_type = None;
    let mut position = exth_offset + 12;
    for _ in 0..item_count {
        let id = be_u32(record0, position).ok_or_else(|| "Registro EXTH incompleto".to_string())?;
        let size = be_u32(record0, position + 4).ok_or_else(|| "Registro EXTH incompleto".to_string())? as usize;
        if size < 8 || position.checked_add(size).is_none_or(|end| end > exth_end) {
            return Err("Registro EXTH inválido".to_string());
        }
        let content = &record0[position + 8..position + size];
        match id {
            113 => uuid = safe_thumbnail_component(content),
            501 => content_type = safe_thumbnail_component(content),
            _ => {}
        }
        position += size;
    }

    let uuid = uuid.ok_or_else(|| "AZW3 não contém identificador EXTH 113".to_string())?;
    let content_type = content_type.ok_or_else(|| "AZW3 não contém tipo EXTH 501".to_string())?;
    Ok(format!("thumbnail_{uuid}_{content_type}_portrait.jpg"))
}

fn kindle_thumbnail_filename(azw3: &Path) -> Result<String, String> {
    let mut file = File::open(azw3).map_err(|err| format!("Não foi possível ler o AZW3: {err}"))?;
    let mut pdb_header = [0u8; 94];
    file.read_exact(&mut pdb_header)
        .map_err(|err| format!("Cabecalho AZW3 incompleto: {err}"))?;
    if &pdb_header[60..68] != b"BOOKMOBI" && &pdb_header[60..68] != b"TEXTREAD" {
        return Err("Arquivo não é um AZW3/MOBI válido".to_string());
    }
    let section_count = be_u16(&pdb_header, 76).unwrap_or(0);
    if section_count < 2 {
        return Err("AZW3 não contém seções suficientes".to_string());
    }
    let first = be_u32(&pdb_header, 78).unwrap_or(0) as u64;
    let second = be_u32(&pdb_header, 86).unwrap_or(0) as u64;
    if second <= first || second - first > 16 * 1024 * 1024 {
        return Err("Seção de metadados AZW3 inválida".to_string());
    }
    let mut record0 = vec![0u8; (second - first) as usize];
    file.seek(SeekFrom::Start(first))
        .and_then(|_| file.read_exact(&mut record0))
        .map_err(|err| format!("Não foi possível ler os metadados AZW3: {err}"))?;
    thumbnail_filename_from_record0(&record0)
}

fn build_kindle_thumbnail(azw3: &Path, cover: &Path) -> Result<KindleThumbnail, String> {
    let image = image::ImageReader::open(cover)
        .map_err(|err| format!("Não foi possível abrir a capa: {err}"))?
        .with_guessed_format()
        .map_err(|err| format!("Formato de capa inválido: {err}"))?
        .decode()
        .map_err(|err| format!("Não foi possível decodificar a capa: {err}"))?;
    let image = image.thumbnail(500, 500);
    let mut data = Vec::new();
    JpegEncoder::new_with_quality(&mut data, 75)
        .encode_image(&image)
        .map_err(|err| format!("Não foi possível gerar a thumbnail Kindle: {err}"))?;
    Ok(KindleThumbnail {
        file_name: kindle_thumbnail_filename(azw3)?,
        data,
    })
}

fn install_mass_storage_thumbnail(documents_dir: &Path, thumbnail: &KindleThumbnail) -> Result<(), String> {
    let root = documents_dir
        .parent()
        .ok_or_else(|| "Não foi possível localizar a raiz do Kindle".to_string())?;
    let thumbnail_dir = root.join("system").join("thumbnails");
    let cache_dir = root.join("amazon-cover-bug");
    fs::create_dir_all(&thumbnail_dir)
        .map_err(|err| format!("Não foi possível acessar system/thumbnails: {err}"))?;
    fs::create_dir_all(&cache_dir)
        .map_err(|err| format!("Não foi possível criar o cache de capas: {err}"))?;
    fs::write(thumbnail_dir.join(&thumbnail.file_name), &thumbnail.data)
        .map_err(|err| format!("Não foi possível salvar a capa no Kindle: {err}"))?;
    fs::write(cache_dir.join(&thumbnail.file_name), &thumbnail.data)
        .map_err(|err| format!("Não foi possível salvar o cache da capa: {err}"))?;
    Ok(())
}

fn sync_mass_storage_thumbnail_cache(documents_dir: &Path) -> Result<(), String> {
    let root = documents_dir
        .parent()
        .ok_or_else(|| "Não foi possível localizar a raiz do Kindle".to_string())?;
    let cache_dir = root.join("amazon-cover-bug");
    if !cache_dir.is_dir() {
        return Ok(());
    }
    let thumbnail_dir = root.join("system").join("thumbnails");
    fs::create_dir_all(&thumbnail_dir)
        .map_err(|err| format!("Não foi possível acessar system/thumbnails: {err}"))?;
    for entry in fs::read_dir(cache_dir).map_err(|err| format!("Não foi possível ler o cache de capas: {err}"))? {
        let entry = entry.map_err(|err| format!("Não foi possível ler uma capa em cache: {err}"))?;
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
                .map_err(|err| format!("Não foi possível restaurar uma capa do Kindle: {err}"))?;
        }
    }
    Ok(())
}

fn calibre_converter_available() -> bool {
    Command::new("ebook-convert")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn converter_available() -> bool {
    true
}

/// Stable Kindle content id (EXTH 113/ASIN). `seed` comes from `kindle_content_seed`.
fn oghma_content_id(seed: &str) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in seed.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("oghma-{hash:016x}")
}

/// Seed for the Kindle content id: the manifest novel id when the folder has one
/// (stable across title changes and re-downloads), else the title.
fn kindle_content_seed(output_dir: &Path, title: &str) -> String {
    read_manifest(output_dir)
        .and_then(|manifest| manifest.novel_id().map(|id| format!("novel:{id}")))
        .unwrap_or_else(|| title.to_string())
}

/// An existing AZW3 is reused only when it is at least as new as its EPUB.
/// Without an EPUB there is nothing to regenerate from, so any AZW3 is kept.
fn azw3_is_fresh(azw3_modified: Option<SystemTime>, epub_modified: Option<SystemTime>) -> bool {
    match (azw3_modified, epub_modified) {
        (None, _) => false,
        (Some(_), None) => true,
        (Some(azw3), Some(epub)) => azw3 >= epub,
    }
}

fn modified(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).and_then(|meta| meta.modified()).ok()
}

fn has_extension(path: &Path, wanted: &str) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case(wanted))
}

/// Finds a book file: first among `listed` names (validated), then by scanning the folder.
fn find_book_file(output_dir: &Path, listed: &[String], extension: &str) -> Result<Option<PathBuf>, String> {
    for name in listed {
        let relative = safe_relative_path(name)?;
        let path = output_dir.join(relative);
        if has_extension(&path, extension) && path.is_file() {
            return Ok(Some(path));
        }
    }
    let mut found: Vec<PathBuf> = fs::read_dir(output_dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| !is_hidden_name(&entry.file_name().to_string_lossy()))
                .map(|entry| entry.path())
                .filter(|path| path.is_file() && has_extension(path, extension))
                .collect()
        })
        .unwrap_or_default();
    found.sort();
    Ok(found.into_iter().next())
}

/// Returns an up-to-date AZW3 for the book in `output_dir`, converting from the
/// EPUB when the AZW3 is missing or older than the EPUB. Other AZW3 files in the
/// folder are removed after a regeneration so only one version remains.
fn ensure_fresh_azw3(title: &str, output_dir: &Path, listed: &[String]) -> Result<PathBuf, String> {
    let epub = find_book_file(output_dir, listed, "epub")?;
    let existing = find_book_file(output_dir, listed, "azw3")?;
    if let Some(existing) = &existing {
        if azw3_is_fresh(modified(existing), epub.as_deref().and_then(modified)) {
            return Ok(existing.clone());
        }
    }
    let epub = epub.ok_or_else(|| format!("{title} não tem EPUB para converter em AZW3"))?;
    let target = output_dir.join(format!("{}.azw3", safe_export_stem(title)));
    let seed = kindle_content_seed(output_dir, title);
    convert_epub_to_azw3(&epub, &target, pick_cover(output_dir), title, &seed)
        .map_err(|err| format!("Falha ao converter {title} para AZW3: {err}"))?;
    if let Ok(entries) = fs::read_dir(output_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path != target && path.is_file() && has_extension(&path, "azw3")
                && !is_hidden_name(&entry.file_name().to_string_lossy())
            {
                let _ = fs::remove_file(path);
            }
        }
    }
    Ok(target)
}

fn transcode_unsupported_images_for_kindle(extracted: &mut ExtractedEpub) -> Result<(), String> {
    let webp_hrefs: Vec<String> = extracted
        .opf
        .manifest
        .values()
        .filter(|(_, media_type)| {
            let mt = media_type.to_ascii_lowercase();
            mt == "image/webp" || mt == "image/avif" || mt == "image/heic"
        })
        .map(|(href, _)| href.clone())
        .collect();

    if webp_hrefs.is_empty() {
        return Ok(());
    }

    eprintln!(
        "Transcoding {} unsupported image(s) to JPEG for Kindle compatibility",
        webp_hrefs.len()
    );

    for href in &webp_hrefs {
        let path = extracted.root.join(href);
        if !path.is_file() {
            continue;
        }
        let img = image::ImageReader::open(&path)
            .map_err(|e| format!("Não foi possível abrir imagem {href}: {e}"))?
            .with_guessed_format()
            .map_err(|e| format!("Formato de imagem inválido {href}: {e}"))?
            .decode()
            .map_err(|e| format!("Não foi possível decodificar imagem {href}: {e}"))?;
        let mut jpeg_bytes = Vec::new();
        JpegEncoder::new_with_quality(&mut jpeg_bytes, 90)
            .encode_image(&img)
            .map_err(|e| format!("Não foi possível recodificar {href} como JPEG: {e}"))?;
        fs::write(&path, &jpeg_bytes)
            .map_err(|e| format!("Não foi possível salvar JPEG para {href}: {e}"))?;
    }

    for (_, (href, media_type)) in extracted.opf.manifest.iter_mut() {
        if webp_hrefs.contains(href) {
            *media_type = "image/jpeg".to_string();
        }
    }

    Ok(())
}

fn install_kindling_cover(extracted: &mut ExtractedEpub, cover: &Path) -> Result<(), String> {
    let image = image::ImageReader::open(cover)
        .map_err(|err| format!("Não foi possível abrir a capa local: {err}"))?
        .with_guessed_format()
        .map_err(|err| format!("Formato de capa local inválido: {err}"))?
        .decode()
        .map_err(|err| format!("Não foi possível decodificar a capa local: {err}"))?;
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, 90)
        .encode_image(&image)
        .map_err(|err| format!("Não foi possível preparar a capa para o AZW3: {err}"))?;

    let cover_name = "oghma-cover.jpg";
    fs::write(extracted.root.join(cover_name), bytes)
        .map_err(|err| format!("Não foi possível preparar a capa no EPUB extraído: {err}"))?;
    let cover_id = "oghma-cover-image".to_string();
    extracted.opf.manifest.insert(
        cover_id.clone(),
        (cover_name.to_string(), "image/jpeg".to_string()),
    );
    extracted.opf.coverimage_id = Some(cover_id);
    Ok(())
}

fn convert_epub_with_kindling(
    epub: &Path,
    target: &Path,
    cover: Option<&Path>,
    content_seed: &str,
) -> Result<(), String> {
    let source_data = fs::read(epub)
        .map_err(|err| format!("Não foi possível ler o EPUB: {err}"))?;
    let mut extracted = ExtractedEpub::from_epub_path(epub)
        .map_err(|err| format!("Kindling não conseguiu abrir o EPUB: {err}"))?;
    if let Some(cover) = cover {
        install_kindling_cover(&mut extracted, cover)?;
    }
    transcode_unsupported_images_for_kindle(&mut extracted)?;

    let staging = target.with_extension("kindling.azw3");
    let _ = fs::remove_file(&staging);
    let build_result = kindling::mobi::build_mobi_from_extracted(
        &extracted,
        &staging,
        false,
        false,
        Some(&source_data),
        false,
        false,
        true,
        true,
        Some("PDOC"),
        false,
        true,
        false,
        false,
    )
    .map_err(|err| format!("Kindling não conseguiu gerar o AZW3: {err}"));
    if let Err(err) = build_result {
        let _ = fs::remove_file(&staging);
        return Err(err);
    }

    let content_id = oghma_content_id(content_seed);
    // Kindle's thumbnail lookup uses EXTH 113 as its content UUID. Kindling's
    // rewrite API exposes that record as series_index, so emit both known IDs.
    let updates = MetadataUpdates {
        asin: Some(content_id.clone()),
        series_index: Some(content_id),
        ..MetadataUpdates::default()
    };
    let rewrite_result = rewrite_mobi_metadata(&staging, target, &updates)
        .map(|_| ())
        .map_err(|err| format!("Não foi possível finalizar os metadados do AZW3: {err}"));
    let _ = fs::remove_file(&staging);
    rewrite_result?;
    patch_azw3_datp(target)
}

fn convert_epub_with_calibre(epub: &Path, target: &Path, cover: Option<&Path>) -> Result<(), String> {
    let mut command = Command::new("ebook-convert");
    command.arg(epub).arg(target);
    if let Some(cover_path) = cover {
        command.arg("--cover").arg(cover_path);
    }
    let status = command
        .status()
        .map_err(|err| format!("Não foi possível executar ebook-convert: {err}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Falha ao converter para AZW3".to_string())
    }
}

/// Converts into a hidden temp file next to `target` and renames it into place, so
/// an interrupted conversion never leaves a half-written AZW3 that looks fresh.
fn convert_epub_to_azw3(
    epub: &Path,
    target: &Path,
    cover: Option<PathBuf>,
    title: &str,
    content_seed: &str,
) -> Result<(), String> {
    let stem = target
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| "book".to_string());
    let temp = target.with_file_name(format!(".{stem}.oghma-tmp-{}.azw3", unique_suffix()));
    let result = match convert_epub_with_kindling(epub, &temp, cover.as_deref(), content_seed) {
        Ok(()) => {
            eprintln!("AZW3 converter=kindling title={title:?}");
            Ok(())
        }
        Err(kindling_error) if calibre_converter_available() => {
            eprintln!(
                "Warning: Kindling failed for {title:?}; trying Calibre fallback: {kindling_error}"
            );
            let _ = fs::remove_file(&temp);
            convert_epub_with_calibre(epub, &temp, cover.as_deref()).map_err(|calibre_error| {
                format!("Kindling: {kindling_error}. Fallback do Calibre: {calibre_error}")
            })
        }
        Err(kindling_error) => Err(kindling_error),
    };
    if let Err(err) = result {
        let _ = fs::remove_file(&temp);
        return Err(err);
    }
    fs::rename(&temp, target).map_err(|err| {
        let _ = fs::remove_file(&temp);
        format!("Não foi possível finalizar o AZW3: {err}")
    })
}

#[tauri::command]
pub fn convert_export_to_azw3(
    root: tauri::State<'_, ExportRoot>,
    title: String,
    output_dir: String,
    output_files: Vec<String>,
) -> Result<Azw3ConversionResult, String> {
    let output_dir = root.require_inside(Path::new(&output_dir))?;
    fs::create_dir_all(&output_dir)
        .map_err(|err| format!("Não foi possível acessar a pasta de saída: {err}"))?;
    let azw3 = ensure_fresh_azw3(&title, &output_dir, &output_files)?;
    let file_name = azw3
        .strip_prefix(&output_dir)
        .unwrap_or(&azw3)
        .to_string_lossy()
        .replace('\\', "/");
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
        wireless_available: send_to_kindle_app().is_some(),
        wireless_supported: cfg!(target_os = "macos"),
    }
}

/// Amazon's "Send to Kindle" app for Mac (free; sends EPUB to the Amazon account over Wi-Fi).
pub fn send_to_kindle_app() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let mut candidates = vec![PathBuf::from("/Applications/Send to Kindle.app")];
        if let Some(home) = &home {
            candidates.push(home.join("Applications/Send to Kindle.app"));
        }
        if let Some(found) = candidates.into_iter().find(|path| path.is_dir()) {
            return Some(found);
        }
        // Renamed or installed elsewhere: ask Spotlight.
        let output = std::process::Command::new("mdfind")
            .arg("kMDItemContentType == 'com.apple.application-bundle' && kMDItemDisplayName == 'Send to Kindle*'c")
            .output()
            .ok()?;
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(PathBuf::from)
            .find(|path| path.extension().is_some_and(|ext| ext == "app") && path.is_dir())
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

fn epub_for_item(item: &SendKindleItem) -> Result<PathBuf, String> {
    let dir = item
        .output_dir
        .as_deref()
        .map(expand_home)
        .ok_or_else(|| format!("{} não tem pasta local de saída", item.title))?;
    item.output_files
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|name| dir.join(name))
        .chain(fs::read_dir(&dir).into_iter().flatten().flatten().map(|entry| entry.path()))
        .find(|path| path.is_file() && path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("epub")))
        .ok_or_else(|| format!("{} não tem EPUB para enviar", item.title))
}

/// Opens Amazon's "Send to Kindle" with the books' EPUBs; the user confirms the send in that app.
#[tauri::command]
pub fn kindle_send_wireless(
    root: tauri::State<'_, ExportRoot>,
    items: Vec<SendKindleItem>,
) -> Result<KindleWirelessResult, String> {
    check_items_inside(&root, &items)?;
    let app = send_to_kindle_app()
        .ok_or("O app Send to Kindle da Amazon não está instalado. Instale em amazon.com/sendtokindle/mac.")?;
    let mut files = Vec::new();
    let mut opened_ids = Vec::new();
    for item in &items {
        files.push(epub_for_item(item)?);
        opened_ids.push(item.id.clone());
    }
    if files.is_empty() {
        return Err("Nenhum livro selecionado".into());
    }
    let status = std::process::Command::new("open")
        .arg("-a")
        .arg(&app)
        .args(&files)
        .status()
        .map_err(|err| format!("Não foi possível abrir o Send to Kindle: {err}"))?;
    if !status.success() {
        return Err("O Send to Kindle não abriu os arquivos.".into());
    }
    Ok(KindleWirelessResult { opened_ids })
}

/// Runs off the main thread: an MTP transfer can take a few seconds.
#[tauri::command]
pub async fn send_to_kindle(
    root: tauri::State<'_, ExportRoot>,
    items: Vec<SendKindleItem>,
) -> Result<KindleSendResult, String> {
    check_items_inside(&root, &items)?;
    tauri::async_runtime::spawn_blocking(move || send_to_kindle_blocking(items))
        .await
        .map_err(|err| err.to_string())?
}

/// Books sent or opened elsewhere must come from the output folder (no arbitrary file reads).
fn check_items_inside(root: &ExportRoot, items: &[SendKindleItem]) -> Result<(), String> {
    for item in items {
        if let Some(dir) = &item.output_dir {
            root.require_inside(Path::new(dir))?;
        }
    }
    Ok(())
}

fn send_to_kindle_blocking(items: Vec<SendKindleItem>) -> Result<KindleSendResult, String> {
    let ms_dir = find_kindle_documents_dir();
    if ms_dir.is_none() && !kindle_usb_present() {
        return Err("Kindle não encontrado por USB".to_string());
    }
    if let Some(dir) = &ms_dir {
        fs::create_dir_all(dir).map_err(|err| format!("Não foi possível acessar a pasta documents do Kindle: {err}"))?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    if ms_dir.is_none() {
        return Err("Envio via MTP só é suportado no Windows e no macOS.".to_string());
    }

    let mut sent_ids = Vec::new();
    for item in items {
        let output_dir = item
            .output_dir
            .as_deref()
            .map(expand_home)
            .ok_or_else(|| format!("{} não tem pasta local de saída", item.title))?;
        let files = item.output_files.unwrap_or_default();
        let source = ensure_fresh_azw3(&item.title, &output_dir, &files)?;
        let cover = pick_cover(&output_dir)
            .ok_or_else(|| format!("{} não tem capa local para enviar ao Kindle", item.title))?;
        let thumbnail = build_kindle_thumbnail(&source, &cover)
            .map_err(|err| format!("Não foi possível preparar a capa de {}: {err}", item.title))?;
        let file_name = source
            .file_name()
            .ok_or_else(|| "Arquivo AZW3 inválido".to_string())?
            .to_string_lossy()
            .to_string();
        match &ms_dir {
            Some(dir) => {
                fs::copy(&source, dir.join(&file_name))
                    .map_err(|err| format!("Não foi possível copiar para o Kindle: {err}"))?;
                install_mass_storage_thumbnail(dir, &thumbnail)?;
            }
            None => {
                #[cfg(target_os = "windows")]
                {
                    crate::kindle_mtp::send_file_to_kindle(&source, &file_name)?;
                    crate::kindle_mtp::send_thumbnail_to_kindle(&thumbnail.file_name, &thumbnail.data)?;
                }
                #[cfg(target_os = "macos")]
                {
                    let bytes = fs::read(&source).map_err(|err| format!("Não foi possível ler {}: {err}", item.title))?;
                    crate::kindle_mtp_mac::send_book(&file_name, &bytes, Some((&thumbnail.file_name, &thumbnail.data)))?;
                }
                #[cfg(not(any(target_os = "windows", target_os = "macos")))]
                {
                    return Err("Envio via MTP só é suportado no Windows e no macOS.".to_string());
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
    use std::fs::{self, File};
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    use image::{DynamicImage, Rgb, RgbImage};
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    use super::{
        azw3_is_fresh, convert_epub_with_kindling, kindle_content_seed, oghma_content_id,
        thumbnail_filename_from_record0,
    };
    use crate::files::test_support::TempDir;
    use std::time::Duration;

    #[test]
    fn azw3_staleness_decision() {
        let now = SystemTime::now();
        let earlier = now - Duration::from_secs(60);
        assert!(!azw3_is_fresh(None, Some(now)));
        assert!(!azw3_is_fresh(None, None));
        assert!(azw3_is_fresh(Some(now), None));
        assert!(azw3_is_fresh(Some(now), Some(earlier)));
        assert!(azw3_is_fresh(Some(now), Some(now)));
        assert!(!azw3_is_fresh(Some(earlier), Some(now)));
    }

    #[test]
    fn content_seed_prefers_manifest_novel_id() {
        let dir = TempDir::new("seed");
        assert_eq!(kindle_content_seed(dir.path(), "Livro"), "Livro");
        fs::write(
            dir.path().join(crate::files::LOCAL_BOOK_MANIFEST),
            r#"{"novel_id":"cn:42","title":"Livro"}"#,
        )
        .unwrap();
        assert_eq!(kindle_content_seed(dir.path(), "Outro título"), "novel:cn:42");
        assert_ne!(oghma_content_id("novel:cn:42"), oghma_content_id("Livro"));
    }

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

    #[test]
    fn converts_epub_with_local_cover_using_kindling() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("oghma-kindling-{suffix}"));
        fs::create_dir_all(&dir).expect("temp directory");
        let epub = dir.join("book.epub");
        let target = dir.join("book.azw3");
        let cover = dir.join("cover.png");

        DynamicImage::ImageRgb8(RgbImage::from_pixel(40, 60, Rgb([30, 120, 180])))
            .save(&cover)
            .expect("test cover");

        let file = File::create(&epub).expect("epub file");
        let mut zip = ZipWriter::new(file);
        zip.start_file(
            "mimetype",
            SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
        )
        .expect("mimetype entry");
        zip.write_all(b"application/epub+zip").expect("mimetype");
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        zip.start_file("META-INF/container.xml", options)
            .expect("container entry");
        zip.write_all(br#"<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#)
            .expect("container");
        zip.start_file("OEBPS/content.opf", options)
            .expect("opf entry");
        zip.write_all(br#"<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">oghma:test</dc:identifier><dc:title>Livro de teste</dc:title><dc:creator>Oghma</dc:creator><dc:language>pt-BR</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>"#)
            .expect("opf");
        zip.start_file("OEBPS/chapter.xhtml", options)
            .expect("chapter entry");
        zip.write_all(br#"<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Capitulo</title></head><body><h1>Capitulo 1</h1><p>Conteudo de teste.</p></body></html>"#)
            .expect("chapter");
        zip.finish().expect("finish epub");

        convert_epub_with_kindling(&epub, &target, Some(&cover), "Livro de teste")
            .expect("Kindling conversion");
        assert!(target.is_file());
        let thumbnail = super::kindle_thumbnail_filename(&target).expect("thumbnail metadata");
        assert_eq!(
            thumbnail,
            format!(
                "thumbnail_{}_PDOC_portrait.jpg",
                oghma_content_id("Livro de teste")
            )
        );

        fs::remove_dir_all(dir).expect("remove temp directory");
    }
}
