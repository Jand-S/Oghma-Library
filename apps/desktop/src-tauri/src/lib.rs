use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

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

    #[cfg(target_os = "windows")]
    let status = Command::new("explorer").arg(&path).status();
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_export_file, open_local_path])
        .run(tauri::generate_context!())
        .expect("error while running Oghma Library");
}
