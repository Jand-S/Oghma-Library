mod files;
mod kindle;
mod library_meta;
mod paths;
mod staging;

#[cfg(target_os = "windows")]
mod kindle_mtp;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            files::save_export_file,
            files::open_local_path,
            files::list_export_library,
            files::delete_export_library_item,
            staging::begin_export,
            staging::commit_export,
            staging::abort_export,
            staging::cleanup_export_root,
            kindle::detect_kindle,
            kindle::convert_export_to_azw3,
            kindle::send_to_kindle,
            library_meta::list_library_meta,
            library_meta::save_library_meta,
            library_meta::delete_library_meta
        ])
        .run(tauri::generate_context!())
        .expect("error while running Oghma Library");
}
