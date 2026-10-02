//! Minimal MTP (PTP over USB) client for macOS, on top of `nusb`, to copy books
//! to Kindles from 2021 onwards (they no longer mount as a disk). Windows uses WPD
//! (`kindle_mtp.rs`); this file only exists on macOS.
//!
//! One session per send: open the Amazon device, claim its MTP interface, find
//! `documents` (and `system/thumbnails`) on the first storage, replace any file
//! with the same name, `SendObjectInfo` + `SendObject`, close.

use std::future::Future;
use std::sync::mpsc;
use std::time::Duration;

use nusb::transfer::{Direction, EndpointType, RequestBuffer};

const AMAZON_VENDOR: u16 = 0x1949;

const OP_OPEN_SESSION: u16 = 0x1002;
const OP_CLOSE_SESSION: u16 = 0x1003;
const OP_GET_STORAGE_IDS: u16 = 0x1004;
const OP_GET_OBJECT_HANDLES: u16 = 0x1007;
const OP_GET_OBJECT_INFO: u16 = 0x1008;
const OP_DELETE_OBJECT: u16 = 0x100B;
const OP_SEND_OBJECT_INFO: u16 = 0x100C;
const OP_SEND_OBJECT: u16 = 0x100D;

const RC_OK: u16 = 0x2001;
const RC_SESSION_ALREADY_OPEN: u16 = 0x201E;

const TYPE_COMMAND: u16 = 1;
const TYPE_DATA: u16 = 2;
const TYPE_RESPONSE: u16 = 3;

const FORMAT_UNDEFINED: u16 = 0x3000;
const FORMAT_ASSOCIATION: u16 = 0x3001;
const FORMAT_JPEG: u16 = 0x3801;
const ROOT: u32 = 0xFFFF_FFFF;

const TIMEOUT: Duration = Duration::from_secs(60);

// ---------------------------------------------------------------------------
// Containers (pure, unit-tested)
// ---------------------------------------------------------------------------

pub(crate) fn command_container(code: u16, transaction: u32, params: &[u32]) -> Vec<u8> {
    let len = 12 + 4 * params.len();
    let mut out = Vec::with_capacity(len);
    out.extend_from_slice(&(len as u32).to_le_bytes());
    out.extend_from_slice(&TYPE_COMMAND.to_le_bytes());
    out.extend_from_slice(&code.to_le_bytes());
    out.extend_from_slice(&transaction.to_le_bytes());
    for p in params {
        out.extend_from_slice(&p.to_le_bytes());
    }
    out
}

pub(crate) fn data_container(code: u16, transaction: u32, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(12 + payload.len());
    out.extend_from_slice(&((12 + payload.len()) as u32).to_le_bytes());
    out.extend_from_slice(&TYPE_DATA.to_le_bytes());
    out.extend_from_slice(&code.to_le_bytes());
    out.extend_from_slice(&transaction.to_le_bytes());
    out.extend_from_slice(payload);
    out
}

#[derive(Debug, PartialEq)]
pub(crate) struct Header {
    pub length: u32,
    pub kind: u16,
    pub code: u16,
    pub transaction: u32,
}

pub(crate) fn parse_header(bytes: &[u8]) -> Option<Header> {
    if bytes.len() < 12 {
        return None;
    }
    Some(Header {
        length: u32::from_le_bytes(bytes[0..4].try_into().ok()?),
        kind: u16::from_le_bytes(bytes[4..6].try_into().ok()?),
        code: u16::from_le_bytes(bytes[6..8].try_into().ok()?),
        transaction: u32::from_le_bytes(bytes[8..12].try_into().ok()?),
    })
}

fn u16_at(data: &[u8], at: usize) -> Option<u16> {
    data.get(at..at + 2).map(|b| u16::from_le_bytes([b[0], b[1]]))
}

fn u32_at(data: &[u8], at: usize) -> Option<u32> {
    data.get(at..at + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

/// PTP array of u32: count then items.
pub(crate) fn parse_u32_array(data: &[u8]) -> Vec<u32> {
    let count = u32_at(data, 0).unwrap_or(0) as usize;
    (0..count).filter_map(|i| u32_at(data, 4 + 4 * i)).collect()
}

/// PTP string: u8 char count (incl. the NUL), UTF-16LE chars. Returns (string, bytes used).
pub(crate) fn parse_ptp_string(data: &[u8], at: usize) -> (String, usize) {
    let count = *data.get(at).unwrap_or(&0) as usize;
    if count == 0 {
        return (String::new(), 1);
    }
    let units: Vec<u16> = (0..count).filter_map(|i| u16_at(data, at + 1 + 2 * i)).take_while(|&u| u != 0).collect();
    (String::from_utf16_lossy(&units), 1 + 2 * count)
}

pub(crate) fn ptp_string(value: &str) -> Vec<u8> {
    if value.is_empty() {
        return vec![0];
    }
    let units: Vec<u16> = value.encode_utf16().take(254).chain(std::iter::once(0)).collect();
    let mut out = vec![units.len() as u8];
    for unit in units {
        out.extend_from_slice(&unit.to_le_bytes());
    }
    out
}

/// The fields of an ObjectInfo dataset we need.
#[derive(Debug, PartialEq)]
pub(crate) struct ObjectInfo {
    pub storage: u32,
    pub format: u16,
    pub parent: u32,
    pub name: String,
}

pub(crate) fn parse_object_info(data: &[u8]) -> Option<ObjectInfo> {
    // StorageID u32, Format u16, Protection u16, Size u32, ThumbFormat u16, ThumbSize u32,
    // ThumbW u32, ThumbH u32, ImgW u32, ImgH u32, Depth u32, Parent u32 (offset 38),
    // AssocType u16, AssocDesc u32, Sequence u32, Filename string (offset 52).
    Some(ObjectInfo {
        storage: u32_at(data, 0)?,
        format: u16_at(data, 4)?,
        parent: u32_at(data, 38)?,
        name: parse_ptp_string(data, 52).0,
    })
}

pub(crate) fn object_info_dataset(storage: u32, parent: u32, format: u16, size: u32, name: &str) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&storage.to_le_bytes());
    out.extend_from_slice(&format.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // protection
    out.extend_from_slice(&size.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // thumb format
    for _ in 0..6 {
        out.extend_from_slice(&0u32.to_le_bytes()); // thumb size, thumb w/h, image w/h, depth
    }
    out.extend_from_slice(&parent.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // association type
    out.extend_from_slice(&0u32.to_le_bytes()); // association desc
    out.extend_from_slice(&0u32.to_le_bytes()); // sequence
    out.extend(ptp_string(name));
    out.extend(ptp_string("")); // date created
    out.extend(ptp_string("")); // date modified
    out.extend(ptp_string("")); // keywords
    out
}

// ---------------------------------------------------------------------------
// USB session
// ---------------------------------------------------------------------------

/// Runs a transfer future with a timeout (nusb 0.1 has none of its own).
fn wait<T: Send + 'static>(future: impl Future<Output = T> + Send + 'static) -> Result<T, String> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(futures_lite::future::block_on(future));
    });
    rx.recv_timeout(TIMEOUT).map_err(|_| "o Kindle parou de responder (tempo esgotado)".to_string())
}

struct Session {
    interface: nusb::Interface,
    ep_in: u8,
    ep_out: u8,
    max_packet: usize,
    transaction: u32,
}

struct Response {
    code: u16,
    params: Vec<u32>,
}

impl Session {
    fn open() -> Result<Session, String> {
        let info = nusb::list_devices()
            .map_err(|e| format!("USB indisponível: {e}"))?
            .find(|d| d.vendor_id() == AMAZON_VENDOR)
            .ok_or("Kindle não encontrado por USB")?;
        let device = info.open().map_err(|e| format!("Não foi possível abrir o Kindle: {e}"))?;
        let config = device.active_configuration().map_err(|e| format!("Kindle sem configuração USB ativa: {e}"))?;
        // MTP: still-image class (6/1) or vendor-specific with bulk in/out.
        let mut chosen = None;
        for group in config.interfaces() {
            for alt in group.alt_settings() {
                let bulk: Vec<_> = alt.endpoints().filter(|e| e.transfer_type() == EndpointType::Bulk).collect();
                let ep_in = bulk.iter().find(|e| e.direction() == Direction::In).map(|e| (e.address(), e.max_packet_size()));
                let ep_out = bulk.iter().find(|e| e.direction() == Direction::Out).map(|e| e.address());
                let mtp_like = alt.class() == 6 || alt.class() == 0xFF;
                if let (true, Some((ep_in, mps)), Some(ep_out)) = (mtp_like, ep_in, ep_out) {
                    if chosen.is_none() || alt.class() == 6 {
                        chosen = Some((group.interface_number(), ep_in, ep_out, mps));
                    }
                }
            }
        }
        let (number, ep_in, ep_out, max_packet) = chosen.ok_or("O Kindle não expôs a interface MTP")?;
        let interface = match device.claim_interface(number) {
            Ok(interface) => interface,
            Err(_) => {
                // macOS' ptpcamerad (Image Capture/Photos) grabs MTP devices; it restarts by itself.
                let _ = std::process::Command::new("killall").arg("ptpcamerad").status();
                std::thread::sleep(Duration::from_millis(600));
                device.claim_interface(number).map_err(|e| {
                    format!(
                        "O macOS está usando o Kindle ({e}). Feche Captura de Imagem, Fotos, Android File Transfer ou OpenMTP e tente de novo."
                    )
                })?
            }
        };
        let mut session = Session { interface, ep_in, ep_out, max_packet: max_packet.max(64), transaction: 0 };
        let response = session.command(OP_OPEN_SESSION, &[1], None)?.0;
        if response.code != RC_OK && response.code != RC_SESSION_ALREADY_OPEN {
            return Err(format!("O Kindle recusou a sessão MTP (0x{:04X})", response.code));
        }
        Ok(session)
    }

    fn write(&self, bytes: Vec<u8>) -> Result<(), String> {
        let needs_zlp = !bytes.is_empty() && bytes.len() % self.max_packet == 0;
        let iface = self.interface.clone();
        let ep = self.ep_out;
        wait(async move { iface.bulk_out(ep, bytes).await })?
            .into_result()
            .map_err(|e| format!("falha ao enviar ao Kindle: {e}"))?;
        if needs_zlp {
            let iface = self.interface.clone();
            wait(async move { iface.bulk_out(ep, Vec::new()).await })?
                .into_result()
                .map_err(|e| format!("falha ao enviar ao Kindle: {e}"))?;
        }
        Ok(())
    }

    /// Reads one container (data or response), spanning as many transfers as needed.
    fn read_container(&self) -> Result<Vec<u8>, String> {
        let mut out: Vec<u8> = Vec::new();
        loop {
            let iface = self.interface.clone();
            let ep = self.ep_in;
            let chunk = wait(async move { iface.bulk_in(ep, RequestBuffer::new(512 * 1024)).await })?
                .into_result()
                .map_err(|e| format!("falha ao ler do Kindle: {e}"))?;
            if chunk.is_empty() && out.is_empty() {
                continue; // stray zero-length packet
            }
            out.extend_from_slice(&chunk);
            if let Some(header) = parse_header(&out) {
                if out.len() >= header.length as usize {
                    out.truncate(header.length as usize);
                    return Ok(out);
                }
            }
        }
    }

    /// Command → optional data out → (data in) → response.
    fn command(&mut self, code: u16, params: &[u32], data_out: Option<&[u8]>) -> Result<(Response, Vec<u8>), String> {
        self.transaction = self.transaction.wrapping_add(1);
        let tid = if code == OP_OPEN_SESSION { 0 } else { self.transaction };
        self.write(command_container(code, tid, params))?;
        if let Some(payload) = data_out {
            self.write(data_container(code, tid, payload))?;
        }
        let mut data = Vec::new();
        loop {
            let container = self.read_container()?;
            let header = parse_header(&container).ok_or("resposta MTP inválida")?;
            match header.kind {
                TYPE_DATA => data = container[12..].to_vec(),
                TYPE_RESPONSE => {
                    let params = container[12..].chunks_exact(4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
                    return Ok((Response { code: header.code, params }, data));
                }
                _ => {}
            }
        }
    }

    fn ok(&mut self, code: u16, params: &[u32], data_out: Option<&[u8]>, what: &str) -> Result<(Vec<u32>, Vec<u8>), String> {
        let (response, data) = self.command(code, params, data_out)?;
        if response.code != RC_OK {
            return Err(format!("{what}: o Kindle respondeu 0x{:04X}", response.code));
        }
        Ok((response.params, data))
    }

    fn storages(&mut self) -> Result<Vec<u32>, String> {
        let (_, data) = self.ok(OP_GET_STORAGE_IDS, &[], None, "listar armazenamento")?;
        Ok(parse_u32_array(&data))
    }

    fn children(&mut self, storage: u32, parent: u32) -> Result<Vec<(u32, ObjectInfo)>, String> {
        let (_, data) = self.ok(OP_GET_OBJECT_HANDLES, &[storage, 0, parent], None, "listar pasta")?;
        let mut out = Vec::new();
        for handle in parse_u32_array(&data) {
            let (_, info) = self.ok(OP_GET_OBJECT_INFO, &[handle], None, "ler item")?;
            if let Some(info) = parse_object_info(&info) {
                out.push((handle, info));
            }
        }
        Ok(out)
    }

    /// Finds a folder by path (case-insensitive) on any storage: (storage, handle).
    fn folder(&mut self, path: &[&str]) -> Result<Option<(u32, u32)>, String> {
        for storage in self.storages()? {
            let mut parent = ROOT;
            let mut found = true;
            for part in path {
                let next = self
                    .children(storage, parent)?
                    .into_iter()
                    .find(|(_, info)| info.format == FORMAT_ASSOCIATION && info.name.eq_ignore_ascii_case(part));
                match next {
                    Some((handle, _)) => parent = handle,
                    None => {
                        found = false;
                        break;
                    }
                }
            }
            if found {
                return Ok(Some((storage, parent)));
            }
        }
        Ok(None)
    }

    /// Replaces `name` inside the folder and sends `bytes`.
    fn put(&mut self, folder: (u32, u32), name: &str, format: u16, bytes: &[u8]) -> Result<(), String> {
        let (storage, parent) = folder;
        for (handle, info) in self.children(storage, parent)? {
            if info.name.eq_ignore_ascii_case(name) {
                self.ok(OP_DELETE_OBJECT, &[handle], None, "substituir o arquivo antigo")?;
            }
        }
        let size = u32::try_from(bytes.len()).map_err(|_| "arquivo grande demais para MTP")?;
        let dataset = object_info_dataset(storage, parent, format, size, name);
        self.ok(OP_SEND_OBJECT_INFO, &[storage, parent], Some(&dataset), "preparar o envio")?;
        self.ok(OP_SEND_OBJECT, &[], Some(bytes), "enviar o arquivo")?;
        Ok(())
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.command(OP_CLOSE_SESSION, &[], None);
    }
}

/// Sends a book (AZW3) to `documents` and, if given, its thumbnail to `system/thumbnails`.
pub fn send_book(file_name: &str, bytes: &[u8], thumbnail: Option<(&str, &[u8])>) -> Result<(), String> {
    let mut session = Session::open()?;
    let documents = session.folder(&["documents"])?.ok_or("Pasta documents não encontrada no Kindle")?;
    session.put(documents, file_name, FORMAT_UNDEFINED, bytes)?;
    if let Some((thumb_name, thumb)) = thumbnail {
        // Thumbnails are best effort: the book is already there.
        if let Ok(Some(folder)) = session.folder(&["system", "thumbnails"]) {
            let _ = session.put(folder, thumb_name, FORMAT_JPEG, thumb);
        }
    }
    Ok(())
}

/// File names inside `documents` (manual check / diagnostics).
#[cfg(test)]
pub fn list_documents() -> Result<Vec<String>, String> {
    let mut session = Session::open()?;
    let (storage, folder) = session.folder(&["documents"])?.ok_or("Pasta documents não encontrada no Kindle")?;
    Ok(session.children(storage, folder)?.into_iter().map(|(_, info)| info.name).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_and_data_containers() {
        assert_eq!(
            command_container(OP_OPEN_SESSION, 0, &[1]),
            vec![16, 0, 0, 0, 1, 0, 0x02, 0x10, 0, 0, 0, 0, 1, 0, 0, 0]
        );
        let data = data_container(OP_SEND_OBJECT, 7, b"ab");
        assert_eq!(parse_header(&data), Some(Header { length: 14, kind: TYPE_DATA, code: OP_SEND_OBJECT, transaction: 7 }));
        assert_eq!(&data[12..], b"ab");
    }

    #[test]
    fn ptp_strings_round_trip() {
        assert_eq!(ptp_string(""), vec![0]);
        let encoded = ptp_string("Livró.azw3");
        assert_eq!(encoded[0] as usize, "Livró.azw3".encode_utf16().count() + 1);
        assert_eq!(parse_ptp_string(&encoded, 0), ("Livró.azw3".to_string(), encoded.len()));
    }

    #[test]
    fn object_info_round_trip() {
        let dataset = object_info_dataset(0x10001, 42, FORMAT_UNDEFINED, 1234, "Meu Livro.azw3");
        assert_eq!(
            parse_object_info(&dataset),
            Some(ObjectInfo { storage: 0x10001, format: FORMAT_UNDEFINED, parent: 42, name: "Meu Livro.azw3".into() })
        );
        assert_eq!(parse_u32_array(&[2, 0, 0, 0, 5, 0, 0, 0, 9, 0, 0, 0]), vec![5, 9]);
    }

    /// With a Kindle on the cable: `cargo test kindle_mtp_mac::tests::real -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_list_documents() {
        println!("{:?}", list_documents());
    }
}
