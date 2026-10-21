mod account_files;
mod cloud;
mod export_root;
mod files;
mod import_epub;
mod kindle;
mod library_meta;
mod oghma_account;
mod paths;
mod staging;
mod translation;

#[cfg(target_os = "windows")]
mod kindle_mtp;
#[cfg(target_os = "macos")]
mod kindle_mtp_mac;

pub fn run() {
    let builder = tauri::Builder::default();
    // macOS menu bar: the default menu plus "Importar EPUB…" (⌘O) in File. Windows and Linux
    // have no menu bar (custom title bar); the webview handles Ctrl+O there.
    #[cfg(target_os = "macos")]
    let builder = builder.menu(import_epub::menu::app_menu);
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Updates: checked and installed from the UI (signed with the Oghma key; see docs/RELEASE.md).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Output folder lives on the Rust side; file commands only accept paths inside it.
            tauri::Manager::manage(app, export_root::ExportRoot::load(export_root::store_path(app.handle())));
            tauri::Manager::manage(app, oghma_account::OghmaAccount::default());
            // Paths of the EPUBs picked or dropped for import; the webview only gets ids.
            tauri::Manager::manage(app, import_epub::ImportEpubState::default());
            // Opens translation.db, registers the engine as managed state and pauses
            // projects left `running`. A failure only disables the translation screen.
            if let Err(err) = translation::init(app.handle()) {
                eprintln!("Translation engine unavailable: {err}");
            }
            Ok(())
        })
        .on_window_event(import_epub::on_window_event)
        .on_menu_event(import_epub::menu::on_menu_event)
        .invoke_handler(tauri::generate_handler![
            export_root::export_root_set,
            export_root::export_root_pick,
            files::save_export_file,
            files::open_local_path,
            files::list_export_library,
            files::delete_export_library_item,
            import_epub::import_epub_pick,
            import_epub::import_epub_preview,
            import_epub::import_epub_commit,
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
            oghma_account::oghma_account_status,
            oghma_account::oghma_account_request_code,
            oghma_account::oghma_account_verify,
            oghma_account::oghma_account_poll,
            oghma_account::oghma_account_api,
            oghma_account::oghma_account_logout,
            oghma_account::oghma_account_forget,
            account_files::account_file_upload,
            account_files::account_file_download,
            account_files::account_files_usage,
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
            translation::commands::translation_set_author,
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
