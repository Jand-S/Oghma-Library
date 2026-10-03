//! Output folder ("pasta de saída") kept on the Rust side.
//!
//! File commands used to take any folder from the webview: `delete_export_library_item`
//! with `output_dir="/Users/x"` deleted `/Users/x/Documents`. Now every file command checks
//! its paths against this root, and the root itself only changes in ways an injected script
//! cannot abuse:
//! - the first time (fresh install or upgrade from the TS-only config);
//! - through `export_root_pick`, the native folder dialog (needs a click by the user);
//! - through `export_root_set` only to a folder that is missing, empty or already an Oghma
//!   library (book folders with `.oghma-book.json`), never to `~/Documents` and the like.
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, Runtime, State};

use crate::files::LOCAL_BOOK_MANIFEST;
use crate::paths::expand_home;

const STORE_FILE: &str = "export-root.json";
/// Files the OS drops in any folder; they do not make a folder "someone else's".
const OS_CLUTTER: &[&str] = &[".DS_Store", "Thumbs.db", "desktop.ini", ".localized"];

pub struct ExportRoot {
    path: Mutex<Option<PathBuf>>,
    store: Option<PathBuf>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Stored {
    path: PathBuf,
}

impl ExportRoot {
    pub fn load(store: Option<PathBuf>) -> Self {
        let path = store
            .as_ref()
            .and_then(|file| fs::read(file).ok())
            .and_then(|bytes| serde_json::from_slice::<Stored>(&bytes).ok())
            .map(|stored| stored.path);
        Self { path: Mutex::new(path), store }
    }

    pub fn current(&self) -> Option<PathBuf> {
        self.path.lock().ok().and_then(|guard| guard.clone())
    }

    fn remember(&self, root: PathBuf) -> Result<PathBuf, String> {
        if let Some(file) = &self.store {
            if let Some(dir) = file.parent() {
                let _ = fs::create_dir_all(dir);
            }
            let bytes = serde_json::to_vec(&Stored { path: root.clone() }).map_err(|err| err.to_string())?;
            fs::write(file, bytes).map_err(|err| format!("Não foi possível guardar a pasta de saída: {err}"))?;
        }
        *self.path.lock().map_err(|_| "Estado da pasta de saída indisponível".to_string())? = Some(root.clone());
        Ok(root)
    }

    /// Root requested by the webview (config, typed path). See the module docs for the rules.
    pub fn set_checked(&self, requested: &Path) -> Result<PathBuf, String> {
        let target = resolve(requested)?;
        refuse_system_folders(&target)?;
        match self.current() {
            None => self.remember(target),
            Some(current) if current == target => Ok(target),
            Some(_) if is_empty_or_library(&target) => self.remember(target),
            Some(_) => Err(
                "Essa pasta já tem outros arquivos. Use o botão \"Escolher…\" ou uma pasta vazia.".to_string(),
            ),
        }
    }

    /// Root chosen by the user in the native dialog.
    pub fn set_trusted(&self, chosen: &Path) -> Result<PathBuf, String> {
        let target = resolve(chosen)?;
        refuse_system_folders(&target)?;
        self.remember(target)
    }

    fn root(&self) -> Result<PathBuf, String> {
        self.current()
            .ok_or_else(|| "A pasta de saída ainda não foi configurada".to_string())
    }

    /// `path` is the root itself.
    pub fn require_root(&self, path: &Path) -> Result<PathBuf, String> {
        let root = self.root()?;
        let target = resolve(path)?;
        if target == root {
            Ok(target)
        } else {
            Err("Recusa de segurança: pasta diferente da pasta de saída".to_string())
        }
    }

    /// `path` is strictly inside the root.
    pub fn require_inside(&self, path: &Path) -> Result<PathBuf, String> {
        let root = self.root()?;
        let target = resolve(path)?;
        if target != root && target.starts_with(&root) {
            Ok(target)
        } else {
            Err("Recusa de segurança: caminho fora da pasta de saída".to_string())
        }
    }

    /// `path` is the root or inside it.
    pub fn require_root_or_inside(&self, path: &Path) -> Result<PathBuf, String> {
        let root = self.root()?;
        let target = resolve(path)?;
        if target.starts_with(&root) {
            Ok(target)
        } else {
            Err("Recusa de segurança: caminho fora da pasta de saída".to_string())
        }
    }

    /// A book folder that may be deleted: a direct child of the root holding `.oghma-book.json`.
    pub fn require_book_dir(&self, path: &Path) -> Result<PathBuf, String> {
        let root = self.root()?;
        let target = self.require_inside(path)?;
        if target.parent() != Some(root.as_path()) || !target.join(LOCAL_BOOK_MANIFEST).is_file() {
            return Err("Recusa de segurança: só pastas de livros do Oghma podem ser excluídas".to_string());
        }
        Ok(target)
    }
}

/// Absolute, `~`-expanded path with symlinks resolved. Works for folders that do not exist
/// yet (the existing ancestor is canonicalized, the rest is appended). `..` is refused.
pub fn resolve(path: &Path) -> Result<PathBuf, String> {
    let expanded = expand_home(&path.to_string_lossy());
    if !expanded.is_absolute() {
        return Err("Caminho precisa ser absoluto".to_string());
    }
    if expanded.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Caminho com \"..\" não é aceito".to_string());
    }
    let mut existing = expanded.clone();
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    while !existing.exists() {
        match (existing.file_name(), existing.parent()) {
            (Some(name), Some(parent)) => {
                rest.push(name.to_os_string());
                existing = parent.to_path_buf();
            }
            _ => break,
        }
    }
    let mut out = existing
        .canonicalize()
        .map_err(|err| format!("Não foi possível resolver o caminho: {err}"))?;
    for name in rest.into_iter().rev() {
        out.push(name);
    }
    Ok(out)
}

fn refuse_system_folders(target: &Path) -> Result<(), String> {
    let home = expand_home("~").canonicalize().ok();
    let depth = target.components().count();
    if depth <= 2 || Some(target) == home.as_deref() {
        // "/", "/Users", "C:\\" or the home folder itself.
        return Err("Escolha uma pasta própria para os livros, não a pasta pessoal nem a raiz do disco".to_string());
    }
    if let Some(home) = home {
        if let Ok(rel) = target.strip_prefix(&home) {
            let first = rel.components().next().map(|c| c.as_os_str().to_string_lossy().to_string());
            if matches!(first.as_deref(), Some(name) if name.starts_with('.') || name == "Library" || name == "AppData") {
                return Err("Essa pasta é do sistema; escolha outra para os livros".to_string());
            }
        }
    }
    Ok(())
}

/// Missing, empty, or only Oghma book folders (plus the staging/trash dot-folders).
fn is_empty_or_library(dir: &Path) -> bool {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return !dir.exists(),
    };
    entries.flatten().all(|entry| {
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        if OS_CLUTTER.contains(&name.as_str()) || name == ".oghma-staging" || name == ".oghma-trash" {
            return true;
        }
        path.is_dir() && path.join(LOCAL_BOOK_MANIFEST).is_file()
    })
}

pub fn store_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join(STORE_FILE))
}

#[tauri::command]
pub fn export_root_set(root: State<'_, ExportRoot>, path: String) -> Result<String, String> {
    root.set_checked(Path::new(&path)).map(|p| p.to_string_lossy().to_string())
}

/// Native folder dialog, opened by Rust: the only way to point the root at a folder that
/// already has other files. Returns None when the user cancels.
#[tauri::command]
pub async fn export_root_pick<R: Runtime>(
    app: AppHandle<R>,
    root: State<'_, ExportRoot>,
    title: Option<String>,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = app.dialog().file();
    if let Some(title) = title {
        dialog = dialog.set_title(title);
    }
    if let Some(dir) = default_path.map(|p| expand_home(&p)).filter(|p| p.is_dir()) {
        dialog = dialog.set_directory(dir);
    }
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
        .await
        .map_err(|err| err.to_string())?;
    let Some(picked) = picked else { return Ok(None) };
    let chosen = picked.into_path().map_err(|err| err.to_string())?;
    root.set_trusted(&chosen).map(|p| Some(p.to_string_lossy().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::test_support::TempDir;

    fn root_at(dir: &Path) -> ExportRoot {
        let root = ExportRoot::load(Some(dir.join("state").join(STORE_FILE)));
        root.set_checked(&dir.join("exports")).expect("first root");
        root
    }

    #[test]
    fn first_root_is_accepted_and_persisted() {
        let tmp = TempDir::new("root-first");
        let root = root_at(&tmp.0);
        let again = ExportRoot::load(Some(tmp.0.join("state").join(STORE_FILE)));
        assert_eq!(again.current(), root.current());
    }

    #[test]
    fn webview_cannot_move_the_root_to_a_folder_with_other_files() {
        let tmp = TempDir::new("root-move");
        let root = root_at(&tmp.0);
        let documents = tmp.0.join("Documents");
        fs::create_dir_all(documents.join("Projetos")).unwrap();
        fs::write(documents.join("contrato.pdf"), b"x").unwrap();
        assert!(root.set_checked(&documents).is_err());
        // An empty folder, a missing one or another Oghma library are fine.
        assert!(root.set_checked(&tmp.0.join("nova")).is_ok());
        let library = tmp.0.join("biblioteca");
        fs::create_dir_all(library.join("Livro")).unwrap();
        fs::write(library.join("Livro").join(LOCAL_BOOK_MANIFEST), b"{}").unwrap();
        fs::write(library.join(".DS_Store"), b"").unwrap();
        assert!(root.set_checked(&library).is_ok());
        // The native dialog may point anywhere the user wants.
        assert!(root.set_trusted(&documents).is_ok());
    }

    #[test]
    fn paths_outside_the_root_and_dot_dot_are_refused() {
        let tmp = TempDir::new("root-inside");
        let root = root_at(&tmp.0);
        let exports = tmp.0.join("exports");
        assert!(root.require_inside(&exports.join("Livro")).is_ok());
        assert!(root.require_inside(&exports).is_err());
        assert!(root.require_root(&exports).is_ok());
        assert!(root.require_inside(&tmp.0.join("outra")).is_err());
        assert!(root.require_inside(&exports.join("..").join("outra")).is_err());
        assert!(root.require_root_or_inside(&tmp.0).is_err());
    }

    #[test]
    fn only_marked_book_folders_directly_under_the_root_can_be_deleted() {
        let tmp = TempDir::new("root-delete");
        let root = root_at(&tmp.0);
        let exports = tmp.0.join("exports");
        let book = exports.join("Livro");
        let plain = exports.join("Fotos");
        let nested = book.join("sub");
        for dir in [&book, &plain, &nested] {
            fs::create_dir_all(dir).unwrap();
        }
        fs::write(book.join(LOCAL_BOOK_MANIFEST), b"{}").unwrap();
        fs::write(nested.join(LOCAL_BOOK_MANIFEST), b"{}").unwrap();
        assert!(root.require_book_dir(&book).is_ok());
        assert!(root.require_book_dir(&plain).is_err());
        assert!(root.require_book_dir(&nested).is_err());
    }

    #[test]
    fn home_and_system_folders_are_never_a_root() {
        let root = ExportRoot::load(None);
        assert!(root.set_checked(Path::new("/")).is_err());
        assert!(root.set_trusted(Path::new("~")).is_err());
        assert!(root.set_trusted(Path::new("~/Library/Application Support")).is_err());
        assert!(root.set_trusted(Path::new("~/.ssh")).is_err());
    }
}
