//! Envio de arquivo ao Kindle via MTP usando Windows Portable Devices (WPD).
//! Somente Windows. v1 — precisa compilar/iterar na maquina (COM unsafe, nao testado no agente).
#![allow(non_snake_case)]

use std::ffi::OsStr;
use std::fs;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Devices::PortableDevices::*;
use windows::Win32::Foundation::S_FALSE;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IStream,
    CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, STGC_DEFAULT,
};

fn wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

fn fmt<E: std::fmt::Debug>(prefix: &str, err: E) -> String {
    format!("WPD {prefix}: {err:?}")
}

/// Copia um arquivo local para a pasta `documents` do Kindle conectado por MTP.
pub fn send_file_to_kindle(local_path: &Path, file_name: &str) -> Result<(), String> {
    let bytes = fs::read(local_path).map_err(|e| format!("Nao foi possivel ler o arquivo: {e}"))?;
    unsafe {
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        let did_init = hr.is_ok() || hr == S_FALSE;
        let result = send_inner(file_name, &bytes, &["documents"]);
        if did_init {
            CoUninitialize();
        }
        result
    }
}

pub fn send_thumbnail_to_kindle(file_name: &str, bytes: &[u8]) -> Result<(), String> {
    unsafe {
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        let did_init = hr.is_ok() || hr == S_FALSE;
        let result = send_inner(file_name, bytes, &["system", "thumbnails"]);
        if did_init {
            CoUninitialize();
        }
        result
    }
}

unsafe fn send_inner(file_name: &str, bytes: &[u8], folder_path: &[&str]) -> Result<(), String> {
    let device_id = find_kindle_device()?.ok_or_else(|| "Kindle nao encontrado via WPD".to_string())?;

    let device: IPortableDevice = CoCreateInstance(&PortableDevice, None, CLSCTX_INPROC_SERVER)
        .map_err(|e| fmt("CoCreateInstance(PortableDevice)", e))?;
    let client_info: IPortableDeviceValues =
        CoCreateInstance(&PortableDeviceValues, None, CLSCTX_INPROC_SERVER).map_err(|e| fmt("client info", e))?;
    device
        .Open(PCWSTR(device_id.as_ptr()), &client_info)
        .map_err(|e| fmt("Open", e))?;

    let content: IPortableDeviceContent = device.Content().map_err(|e| fmt("Content", e))?;

    let parent_id = find_folder_object_id(&content, folder_path)?
        .ok_or_else(|| format!("Pasta '{}' nao encontrada no Kindle", folder_path.join("/")))?;

    let values: IPortableDeviceValues =
        CoCreateInstance(&PortableDeviceValues, None, CLSCTX_INPROC_SERVER).map_err(|e| fmt("values", e))?;
    values
        .SetStringValue(&WPD_OBJECT_PARENT_ID, PCWSTR(parent_id.as_ptr()))
        .map_err(|e| fmt("set parent", e))?;
    values
        .SetUnsignedLargeIntegerValue(&WPD_OBJECT_SIZE, bytes.len() as u64)
        .map_err(|e| fmt("set size", e))?;
    let name = wide(file_name);
    values
        .SetStringValue(&WPD_OBJECT_ORIGINAL_FILE_NAME, PCWSTR(name.as_ptr()))
        .map_err(|e| fmt("set original name", e))?;
    values
        .SetStringValue(&WPD_OBJECT_NAME, PCWSTR(name.as_ptr()))
        .map_err(|e| fmt("set name", e))?;
    values
        .SetGuidValue(&WPD_OBJECT_CONTENT_TYPE, &WPD_CONTENT_TYPE_GENERIC_FILE)
        .map_err(|e| fmt("set content type", e))?;

    let mut stream: Option<IStream> = None;
    let mut optimal: u32 = 0;
    content
        .CreateObjectWithPropertiesAndData(&values, &mut stream, &mut optimal, std::ptr::null_mut())
        .map_err(|e| fmt("CreateObjectWithPropertiesAndData", e))?;
    let stream = stream.ok_or_else(|| "WPD nao retornou stream de escrita".to_string())?;

    let chunk = if optimal == 0 { 262_144usize } else { optimal as usize };
    let mut offset = 0usize;
    while offset < bytes.len() {
        let end = (offset + chunk).min(bytes.len());
        let slice = &bytes[offset..end];
        let mut written: u32 = 0;
        stream
            .Write(slice.as_ptr() as *const _, slice.len() as u32, Some(&mut written))
            .ok()
            .map_err(|e| fmt("Write", e))?;
        offset += (written.max(1)) as usize;
    }
    stream.Commit(STGC_DEFAULT).map_err(|e| fmt("Commit", e))?;
    Ok(())
}

unsafe fn find_kindle_device() -> Result<Option<Vec<u16>>, String> {
    let manager: IPortableDeviceManager =
        CoCreateInstance(&PortableDeviceManager, None, CLSCTX_INPROC_SERVER).map_err(|e| fmt("manager", e))?;
    let mut count: u32 = 0;
    manager.GetDevices(std::ptr::null_mut(), &mut count).map_err(|e| fmt("GetDevices(count)", e))?;
    if count == 0 {
        return Ok(None);
    }
    let mut ids: Vec<PWSTR> = vec![PWSTR::null(); count as usize];
    manager
        .GetDevices(ids.as_mut_ptr(), &mut count)
        .map_err(|e| fmt("GetDevices", e))?;

    let mut found: Option<Vec<u16>> = None;
    for id in ids.iter().take(count as usize) {
        if id.is_null() {
            continue;
        }
        let mut name_len: u32 = 0;
        let _ = manager.GetDeviceFriendlyName(PCWSTR(id.0 as *const u16), PWSTR::null(), &mut name_len);
        if name_len > 0 {
            let mut buf = vec![0u16; name_len as usize];
            if manager
                .GetDeviceFriendlyName(PCWSTR(id.0 as *const u16), PWSTR(buf.as_mut_ptr()), &mut name_len)
                .is_ok()
            {
                let end = (name_len as usize).min(buf.len());
                let s = String::from_utf16_lossy(&buf[..end]);
                if s.to_lowercase().contains("kindle") && found.is_none() {
                    let mut owned = id.as_wide().to_vec();
                    owned.push(0);
                    found = Some(owned);
                }
            }
        }
        CoTaskMemFree(Some(id.0 as *const _));
    }
    Ok(found)
}

unsafe fn enum_children(content: &IPortableDeviceContent, parent: PCWSTR) -> Vec<Vec<u16>> {
    let mut out: Vec<Vec<u16>> = Vec::new();
    let en = match content.EnumObjects(0, parent, None) {
        Ok(en) => en,
        Err(_) => return out,
    };
    loop {
        let mut ids: [PWSTR; 16] = [PWSTR::null(); 16];
        let mut fetched: u32 = 0;
        let _ = en.Next(&mut ids, &mut fetched);
        if fetched == 0 {
            break;
        }
        for id in ids.iter().take(fetched as usize) {
            if !id.is_null() {
                let mut owned = id.as_wide().to_vec();
                owned.push(0);
                out.push(owned);
                CoTaskMemFree(Some(id.0 as *const _));
            }
        }
        if fetched < 16 {
            break;
        }
    }
    out
}

unsafe fn object_name(
    props: &IPortableDeviceProperties,
    keys: &IPortableDeviceKeyCollection,
    id: PCWSTR,
) -> Option<String> {
    let values = props.GetValues(id, keys).ok()?;
    let pw = values.GetStringValue(&WPD_OBJECT_NAME).ok()?;
    if pw.is_null() {
        return None;
    }
    let s = pw.to_string().ok();
    CoTaskMemFree(Some(pw.0 as *const _));
    s
}

unsafe fn find_folder_object_id(content: &IPortableDeviceContent, folder_path: &[&str]) -> Result<Option<Vec<u16>>, String> {
    let props: IPortableDeviceProperties = content.Properties().map_err(|e| fmt("Properties", e))?;
    let keys: IPortableDeviceKeyCollection =
        CoCreateInstance(&PortableDeviceKeyCollection, None, CLSCTX_INPROC_SERVER).map_err(|e| fmt("key collection", e))?;
    keys.Add(&WPD_OBJECT_NAME).map_err(|e| fmt("keys.Add", e))?;

    let root = wide("DEVICE");
    let storages = enum_children(content, PCWSTR(root.as_ptr()));
    for storage in storages {
        let mut current = storage;
        let mut found = true;
        for component in folder_path {
            let kids = enum_children(content, PCWSTR(current.as_ptr()));
            let next = kids.into_iter().find(|kid| {
                object_name(&props, &keys, PCWSTR(kid.as_ptr()))
                    .map(|name| name.trim().eq_ignore_ascii_case(component))
                    .unwrap_or(false)
            });
            match next {
                Some(id) => current = id,
                None => {
                    found = false;
                    break;
                }
            }
        }
        if found {
            return Ok(Some(current));
        }
    }
    Ok(None)
}
