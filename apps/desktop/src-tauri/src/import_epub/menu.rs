//! Ways into the import besides the Library button: "Importar EPUB…" in the macOS File menu
//! (⌘O) and the drag-over state of .epub files on the window (docs/IMPORT_EPUB.md).

use std::path::PathBuf;

use tauri::{AppHandle, DragDropEvent, Emitter, Runtime};

/// Id of the "Importar EPUB…" menu item.
pub const MENU_IMPORT_ID: &str = "import-epub";
/// Event emitted (no payload) when "Importar EPUB…" is chosen in the menu.
pub const MENU_EVENT: &str = "import-epub-menu";
/// Event emitted with `true` while .epub files are dragged over the window, `false` when they leave or drop.
pub const DRAG_EVENT: &str = "import-epub-drag";
/// Label and shortcut of the menu item.
pub const MENU_IMPORT_LABEL: &str = "Importar EPUB…";
pub const MENU_IMPORT_ACCELERATOR: &str = "CmdOrCtrl+O";

/// Drag-over state to send for a window drag event: `Some(true)` when files with at least one
/// .epub enter, `Some(false)` when they leave or drop, `None` for moves (nothing changes).
pub fn drag_state(event: &DragDropEvent, is_epub: impl Fn(&PathBuf) -> bool) -> Option<bool> {
    match event {
        DragDropEvent::Enter { paths, .. } => Some(paths.iter().any(is_epub)),
        DragDropEvent::Leave | DragDropEvent::Drop { .. } => Some(false),
        _ => None,
    }
}

/// True for the "Importar EPUB…" menu item.
pub fn is_import_item(id: &str) -> bool {
    id == MENU_IMPORT_ID
}

/// macOS menu bar: Tauri's default menu with "Importar EPUB…" (⌘O) at the top of File.
#[cfg(target_os = "macos")]
pub fn app_menu<R: Runtime>(handle: &AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem};
    let menu = Menu::default(handle)?;
    let import = MenuItem::with_id(handle, MENU_IMPORT_ID, MENU_IMPORT_LABEL, true, Some(MENU_IMPORT_ACCELERATOR))?;
    let file = menu.items()?.into_iter().find_map(|item| match item {
        MenuItemKind::Submenu(submenu) if submenu.text().is_ok_and(|text| text == "File") => Some(submenu),
        _ => None,
    });
    match file {
        Some(file) => file.prepend_items(&[&import, &PredefinedMenuItem::separator(handle)?])?,
        None => menu.append(&tauri::menu::Submenu::with_items(handle, "File", true, &[&import])?)?,
    }
    Ok(menu)
}

/// Menu clicks: "Importar EPUB…" tells the webview to run the import (it opens the Library).
pub fn on_menu_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    if is_import_item(event.id().as_ref()) {
        let _ = app.emit(MENU_EVENT, ());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::PhysicalPosition;

    fn epub(path: &PathBuf) -> bool {
        path.extension().is_some_and(|ext| ext == "epub")
    }

    #[test]
    fn drag_state_shows_only_for_epub_files_and_clears_on_leave_and_drop() {
        let position = PhysicalPosition::new(1.0, 2.0);
        let with_epub = DragDropEvent::Enter { paths: vec!["a.pdf".into(), "b.epub".into()], position };
        let without = DragDropEvent::Enter { paths: vec!["a.pdf".into()], position };
        assert_eq!(drag_state(&with_epub, epub), Some(true));
        assert_eq!(drag_state(&without, epub), Some(false));
        assert_eq!(drag_state(&DragDropEvent::Over { position }, epub), None);
        assert_eq!(drag_state(&DragDropEvent::Leave, epub), Some(false));
        assert_eq!(drag_state(&DragDropEvent::Drop { paths: vec!["b.epub".into()], position }, epub), Some(false));
    }

    #[test]
    fn only_the_import_item_runs_the_import() {
        assert!(is_import_item(MENU_IMPORT_ID));
        assert!(!is_import_item("close_window"));
        assert_eq!(MENU_IMPORT_ACCELERATOR, "CmdOrCtrl+O");
    }
}
