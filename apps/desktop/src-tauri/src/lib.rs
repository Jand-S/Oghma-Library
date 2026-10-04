mod cloud;
mod export_root;
mod files;
mod kindle;
mod library_meta;
mod paths;
mod staging;
mod translation;

#[cfg(target_os = "windows")]
mod kindle_mtp;
#[cfg(target_os = "macos")]
mod kindle_mtp_mac;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Output folder lives on the Rust side; file commands only accept paths inside it.
            tauri::Manager::manage(app, export_root::ExportRoot::load(export_root::store_path(app.handle())));
            // Opens translation.db, registers the engine as managed state and pauses
            // projects left `running`. A failure only disables the translation screen.
            if let Err(err) = translation::init(app.handle()) {
                eprintln!("Translation engine unavailable: {err}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            export_root::export_root_set,
            export_root::export_root_pick,
            files::save_export_file,
            files::open_local_path,
            files::list_export_library,
            files::delete_export_library_item,
            staging::begin_export,
            staging::commit_export,
            staging::abort_export,
            staging::cleanup_export_root,
            cloud::icloud_status,
            cloud::icloud_save,
            cloud::icloud_reveal,
            kindle::detect_kindle,
            kindle::convert_export_to_azw3,
            kindle::send_to_kindle,
            kindle::kindle_send_wireless,
            library_meta::list_library_meta,
            library_meta::save_library_meta,
            library_meta::delete_library_meta,
            library_meta::library_sync_pending,
            library_meta::library_sync_mark_clean,
            library_meta::library_sync_apply,
            library_meta::library_sync_mark_all_dirty,
            translation::commands::translation_account,
            translation::commands::translation_login,
            translation::commands::translation_login_cancel,
            translation::commands::translation_logout,
            translation::commands::translation_usage,
            translation::commands::translation_list_projects,
            translation::commands::translation_create_project,
            translation::commands::translation_delete_project,
            translation::commands::translation_get_project,
            translation::commands::translation_update_settings,
            translation::commands::translation_start,
            translation::commands::translation_pause,
            translation::commands::translation_cancel,
            translation::commands::translation_glossary,
            translation::commands::translation_glossary_upsert,
            translation::commands::translation_glossary_delete,
            translation::commands::translation_glossary_suggest,
            translation::commands::translation_glossary_regenerate,
            translation::commands::translation_run_pilot,
            translation::commands::translation_pilot,
            translation::commands::translation_choose_model,
            translation::commands::translation_chapter,
            translation::commands::translation_retranslate,
            translation::commands::translation_retranslate_chunk,
            translation::commands::translation_mark_reviewed,
            translation::commands::translation_verify,
            translation::commands::translation_export,
            translation::commands::translation_log,
            translation::commands::smart_filter_ask
        ])
        .run(tauri::generate_context!())
        .expect("error while running Oghma Library");
}
