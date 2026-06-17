mod files;
mod kindle;
mod paths;

#[cfg(target_os = "windows")]
mod kindle_mtp;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            files::save_export_file,
            files::open_local_path,
            files::list_export_library,
            kindle::detect_kindle,
            kindle::send_to_kindle
        ])
        .run(tauri::generate_context!())
        .expect("error while running Oghma Library");
}
