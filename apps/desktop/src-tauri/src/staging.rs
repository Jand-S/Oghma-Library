//! Export staging: every download is written into
//! `<outputRoot>/.oghma-staging/<novelId>-<unixMillis>` and then swapped into its
//! final folder atomically, so a re-download fully replaces the previous files.

use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::AppHandle;

use crate::export_root::ExportRoot;
use crate::files::read_manifest;
use crate::library_meta;
use crate::paths::{expand_home, is_hidden_name, sanitize_file_name};

pub(crate) const STAGING_DIR: &str = ".oghma-staging";
pub(crate) const TRASH_DIR: &str = ".oghma-trash";

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BeginExportResult {
    pub(crate) staging_dir: String,
    pub(crate) final_dir: String,
}

/// Staging/trash paths in use by this process; startup cleanup never touches them.
fn active_paths() -> &'static Mutex<HashSet<PathBuf>> {
    static ACTIVE: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    ACTIVE.get_or_init(|| Mutex::new(HashSet::new()))
}

fn path_forms(path: &Path) -> Vec<PathBuf> {
    let mut forms = vec![path.to_path_buf()];
    if let Ok(canonical) = path.canonicalize() {
        if canonical != path {
            forms.push(canonical);
        }
    }
    forms
}

/// Stores the canonical form (paths are canonical by the time they are renamed/unmarked).
fn mark_active(path: &Path) {
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    if let Ok(mut set) = active_paths().lock() {
        set.insert(canonical);
    }
}

fn unmark_active(path: &Path) {
    let forms = path_forms(path);
    if let Ok(mut set) = active_paths().lock() {
        for form in forms {
            set.remove(&form);
        }
    }
}

fn is_active(path: &Path) -> bool {
    let forms = path_forms(path);
    active_paths()
        .lock()
        .map(|set| forms.iter().any(|form| set.contains(form)))
        .unwrap_or(false)
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

/// Novel ids can contain `:` or `/`; keep only filename-safe characters.
fn safe_id_component(novel_id: &str) -> String {
    let cleaned: String = novel_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .take(80)
        .collect();
    if cleaned.is_empty() {
        "novel".to_string()
    } else {
        cleaned
    }
}

/// Folder name for a title: the TS sanitizer, but never a dot-name (those are skipped by the scanner).
fn folder_name_for_title(title: &str) -> String {
    let name = sanitize_file_name(title);
    if is_hidden_name(&name) {
        format!("_{}", name.trim_start_matches('.'))
    } else {
        name
    }
}

fn manifest_novel_id(dir: &Path) -> Option<String> {
    read_manifest(dir)?.novel_id().map(str::to_string)
}

/// Picks the final folder for `novel_id`:
/// 1. an existing folder whose manifest has the same novel id (the one named like the title wins);
/// 2. `<root>/<sanitized title>` if free, without a manifest, or with the same id;
/// 3. `<root>/<sanitized title> (2)`, `(3)`, … otherwise.
pub(crate) fn resolve_final_dir(root: &Path, novel_id: &str, title: &str) -> PathBuf {
    let base = folder_name_for_title(title);
    let mut matches: Vec<String> = fs::read_dir(root)
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.path().is_dir())
                .map(|entry| entry.file_name().to_string_lossy().to_string())
                .filter(|name| !is_hidden_name(name))
                .filter(|name| manifest_novel_id(&root.join(name)).as_deref() == Some(novel_id))
                .collect()
        })
        .unwrap_or_default();
    if !matches.is_empty() {
        matches.sort();
        let chosen = matches
            .iter()
            .find(|name| **name == base)
            .unwrap_or(&matches[0]);
        return root.join(chosen);
    }

    let mut index = 1;
    loop {
        let name = if index == 1 {
            base.clone()
        } else {
            format!("{base} ({index})")
        };
        let candidate = root.join(&name);
        let taken = candidate.exists()
            && (!candidate.is_dir()
                || manifest_novel_id(&candidate).is_some_and(|id| id != novel_id));
        if !taken {
            return candidate;
        }
        index += 1;
    }
}

pub(crate) fn begin_export_at(root: &Path, novel_id: &str, title: &str) -> Result<BeginExportResult, String> {
    let novel_id = novel_id.trim();
    if novel_id.is_empty() {
        return Err("Identificador do livro ausente".to_string());
    }
    fs::create_dir_all(root)
        .map_err(|err| format!("Não foi possível criar a pasta de saída: {err}"))?;
    let staging_root = root.join(STAGING_DIR);
    fs::create_dir_all(&staging_root)
        .map_err(|err| format!("Não foi possível criar a pasta temporária: {err}"))?;

    let id_part = safe_id_component(novel_id);
    let mut millis = now_millis();
    let staging = loop {
        let candidate = staging_root.join(format!("{id_part}-{millis}"));
        match fs::create_dir(&candidate) {
            Ok(()) => break candidate,
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => millis += 1,
            Err(err) => return Err(format!("Não foi possível criar a pasta temporária: {err}")),
        }
    };
    mark_active(&staging);

    let final_dir = resolve_final_dir(root, novel_id, title);
    Ok(BeginExportResult {
        staging_dir: staging.to_string_lossy().to_string(),
        final_dir: final_dir.to_string_lossy().to_string(),
    })
}

fn is_plain_name(name: &Path) -> bool {
    let mut components = name.components();
    matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none()
}

/// Validates that `staging` is `<root>/.oghma-staging/<entry>` and returns `(root, staging)` canonicalized.
fn validate_staging(staging: &Path) -> Result<(PathBuf, PathBuf), String> {
    let staging = staging
        .canonicalize()
        .map_err(|err| format!("Pasta temporária inválida: {err}"))?;
    let parent = staging
        .parent()
        .filter(|parent| parent.file_name().is_some_and(|name| name == STAGING_DIR))
        .ok_or_else(|| "Recusa de segurança: pasta temporária fora da area de staging".to_string())?;
    let root = parent
        .parent()
        .ok_or_else(|| "Recusa de segurança: pasta temporária sem raiz".to_string())?
        .to_path_buf();
    if !staging.is_dir() {
        return Err("A pasta temporária não existe".to_string());
    }
    Ok((root, staging))
}

/// Validates that `final_dir` is a direct, non-hidden child of `root`.
fn validate_final(root: &Path, final_dir: &Path) -> Result<PathBuf, String> {
    let name = final_dir
        .file_name()
        .ok_or_else(|| "Pasta final inválida".to_string())?;
    if !is_plain_name(Path::new(name)) || is_hidden_name(&name.to_string_lossy()) {
        return Err("Pasta final inválida".to_string());
    }
    let parent = final_dir
        .parent()
        .ok_or_else(|| "Pasta final inválida".to_string())?
        .canonicalize()
        .map_err(|err| format!("Pasta final inválida: {err}"))?;
    if parent != root {
        return Err("Recusa de segurança: pasta final fora da pasta de saída".to_string());
    }
    Ok(root.join(name))
}

fn remove_dir_if_empty(dir: &Path) {
    let _ = fs::remove_dir(dir);
}

/// Rename hook so tests can simulate a failing swap.
type RenameFn = dyn Fn(&Path, &Path) -> std::io::Result<()>;

pub(crate) fn commit_export_at(staging: &Path, final_dir: &Path) -> Result<PathBuf, String> {
    commit_export_with(staging, final_dir, &|from, to| fs::rename(from, to))
}

fn commit_export_with(staging: &Path, final_dir: &Path, rename: &RenameFn) -> Result<PathBuf, String> {
    let (root, staging) = validate_staging(staging)?;
    let final_dir = validate_final(&root, final_dir)?;

    let mut trashed: Option<PathBuf> = None;
    if final_dir.symlink_metadata().is_ok() {
        let trash_root = root.join(TRASH_DIR);
        fs::create_dir_all(&trash_root)
            .map_err(|err| format!("Não foi possível preparar a substituição: {err}"))?;
        let name = final_dir
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        let trash = trash_root.join(format!("{name}-{}", now_millis()));
        mark_active(&trash);
        if let Err(err) = rename(&final_dir, &trash) {
            unmark_active(&trash);
            remove_dir_if_empty(&trash_root);
            return Err(format!(
                "Não foi possível substituir a versão anterior (algum arquivo está aberto?): {err}"
            ));
        }
        trashed = Some(trash);
    }

    if let Err(err) = rename(&staging, &final_dir) {
        let mut message = format!("Não foi possível mover o livro para a pasta final: {err}");
        if let Some(trash) = &trashed {
            if let Err(rollback) = rename(trash, &final_dir) {
                message.push_str(&format!(
                    ". A versão anterior ficou em {}: {rollback}",
                    trash.to_string_lossy()
                ));
            } else {
                unmark_active(trash);
                remove_dir_if_empty(&root.join(TRASH_DIR));
            }
        }
        return Err(message);
    }
    unmark_active(&staging);

    if let Some(trash) = trashed {
        let _ = fs::remove_dir_all(&trash);
        unmark_active(&trash);
        remove_dir_if_empty(&root.join(TRASH_DIR));
    }
    remove_dir_if_empty(&root.join(STAGING_DIR));
    Ok(final_dir)
}

pub(crate) fn abort_export_at(staging: &Path) -> Result<(), String> {
    if !staging.exists() {
        unmark_active(staging);
        return Ok(());
    }
    let (root, staging) = validate_staging(staging)?;
    fs::remove_dir_all(&staging)
        .map_err(|err| format!("Não foi possível apagar a pasta temporária: {err}"))?;
    unmark_active(&staging);
    remove_dir_if_empty(&root.join(STAGING_DIR));
    Ok(())
}

/// Removes leftover staging/trash entries (from a crash or a killed app). Entries
/// in use by an export running in this process are kept.
pub(crate) fn cleanup_export_root_at(root: &Path) -> usize {
    let mut removed = 0;
    for dir_name in [STAGING_DIR, TRASH_DIR] {
        let dir = root.join(dir_name);
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if is_active(&path) {
                continue;
            }
            let result = if path.is_dir() {
                fs::remove_dir_all(&path)
            } else {
                fs::remove_file(&path)
            };
            if result.is_ok() {
                removed += 1;
            }
        }
        remove_dir_if_empty(&dir);
    }
    removed
}

/// Keys whose `hidden` flag is reset when a book is (re)committed.
pub(crate) fn meta_keys_for(final_dir: &Path, raw_final_dir: &str, novel_id: &str) -> Vec<String> {
    let mut keys = vec![
        format!("novel:{novel_id}"),
        raw_final_dir.to_string(),
        expand_home(raw_final_dir).to_string_lossy().to_string(),
        final_dir.to_string_lossy().to_string(),
    ];
    keys.sort();
    keys.dedup();
    keys
}

#[tauri::command(async)]
pub fn begin_export(
    root: tauri::State<'_, ExportRoot>,
    output_root: String,
    novel_id: String,
    title: String,
) -> Result<BeginExportResult, String> {
    begin_export_at(&root.require_root(Path::new(&output_root))?, &novel_id, &title)
}

#[tauri::command(async)]
pub fn commit_export(
    app: AppHandle,
    root: tauri::State<'_, ExportRoot>,
    staging_dir: String,
    final_dir: String,
    novel_id: String,
) -> Result<(), String> {
    let staging = root.require_inside(Path::new(&staging_dir))?;
    let target = root.require_inside(Path::new(&final_dir))?;
    let committed = commit_export_at(&staging, &target)?;
    let keys = meta_keys_for(&committed, &final_dir, novel_id.trim());
    // The files are already in place; a metadata failure must not fail the export.
    if let Err(err) = library_meta::mark_downloaded(&app, &keys) {
        eprintln!("Warning: could not reset hidden flag for {final_dir:?}: {err}");
    }
    Ok(())
}

#[tauri::command(async)]
pub fn abort_export(root: tauri::State<'_, ExportRoot>, staging_dir: String) -> Result<(), String> {
    abort_export_at(&root.require_inside(Path::new(&staging_dir))?)
}

/// Deletes leftover `.oghma-staging` / `.oghma-trash` entries under the output root.
/// The output root lives in the TS config, so TS calls this once it knows the path
/// (`prepareExportRoot` in `services/localFiles.ts`, used by `useLocalLibrary`).
#[tauri::command(async)]
pub fn cleanup_export_root(root: tauri::State<'_, ExportRoot>, output_root: String) -> Result<usize, String> {
    Ok(cleanup_export_root_at(&root.require_root(Path::new(&output_root))?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::test_support::TempDir;
    use crate::files::LOCAL_BOOK_MANIFEST;

    fn write_book(dir: &Path, novel_id: Option<&str>, marker: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("book.epub"), marker).unwrap();
        if let Some(id) = novel_id {
            fs::write(
                dir.join(LOCAL_BOOK_MANIFEST),
                format!(r#"{{"novel_id":"{id}","title":"T"}}"#),
            )
            .unwrap();
        }
    }

    fn root() -> (TempDir, PathBuf) {
        let temp = TempDir::new("staging");
        let root = temp.path().canonicalize().unwrap();
        (temp, root)
    }

    #[test]
    fn begin_creates_staging_and_uses_sanitized_title() {
        let (_temp, root) = root();
        let result = begin_export_at(&root, "cn:re-zero", "Re:Zero  Kara").unwrap();
        let staging = PathBuf::from(&result.staging_dir);
        assert!(staging.is_dir());
        assert_eq!(staging.parent().unwrap(), root.join(STAGING_DIR));
        assert!(staging.file_name().unwrap().to_string_lossy().starts_with("cn_re-zero-"));
        assert_eq!(PathBuf::from(&result.final_dir), root.join("Re_Zero Kara"));
        let json = serde_json::to_value(&result).unwrap();
        assert!(json.get("stagingDir").is_some() && json.get("finalDir").is_some());
    }

    #[test]
    fn begin_reuses_existing_folder_with_same_novel_id() {
        let (_temp, root) = root();
        write_book(&root.join("Old Title"), Some("42"), "old");
        let result = begin_export_at(&root, "42", "New Title").unwrap();
        assert_eq!(PathBuf::from(result.final_dir), root.join("Old Title"));
    }

    #[test]
    fn begin_appends_suffix_when_name_belongs_to_other_novel() {
        let (_temp, root) = root();
        write_book(&root.join("Livro"), Some("1"), "other");
        write_book(&root.join("Livro (2)"), Some("2"), "other");
        let result = begin_export_at(&root, "3", "Livro").unwrap();
        assert_eq!(PathBuf::from(result.final_dir), root.join("Livro (3)"));
        // A legacy folder without a manifest is assumed to be the same book.
        write_book(&root.join("Legado"), None, "legacy");
        let result = begin_export_at(&root, "9", "Legado").unwrap();
        assert_eq!(PathBuf::from(result.final_dir), root.join("Legado"));
    }

    #[test]
    fn commit_replaces_the_whole_folder() {
        let (_temp, root) = root();
        let final_dir = root.join("Livro");
        write_book(&final_dir, Some("7"), "old");
        fs::write(final_dir.join("Livro.azw3"), "stale").unwrap();
        fs::write(final_dir.join("cover.png"), "stale").unwrap();

        let begun = begin_export_at(&root, "7", "Livro").unwrap();
        let staging = PathBuf::from(&begun.staging_dir);
        write_book(&staging, Some("7"), "new");
        fs::write(staging.join("cover.jpg"), "new").unwrap();

        let committed = commit_export_at(&staging, Path::new(&begun.final_dir)).unwrap();
        assert_eq!(committed, final_dir);
        assert_eq!(fs::read_to_string(final_dir.join("book.epub")).unwrap(), "new");
        assert!(!final_dir.join("Livro.azw3").exists());
        assert!(!final_dir.join("cover.png").exists());
        assert!(final_dir.join("cover.jpg").exists());
        assert!(!staging.exists());
        assert!(!root.join(STAGING_DIR).exists());
        assert!(!root.join(TRASH_DIR).exists());
    }

    #[test]
    fn commit_into_new_folder() {
        let (_temp, root) = root();
        let begun = begin_export_at(&root, "8", "Novo").unwrap();
        write_book(Path::new(&begun.staging_dir), Some("8"), "new");
        commit_export_at(Path::new(&begun.staging_dir), Path::new(&begun.final_dir)).unwrap();
        assert!(root.join("Novo/book.epub").is_file());
    }

    #[test]
    fn commit_rolls_back_when_the_second_rename_fails() {
        let (_temp, root) = root();
        let final_dir = root.join("Livro");
        write_book(&final_dir, Some("7"), "old");
        let begun = begin_export_at(&root, "7", "Livro").unwrap();
        let staging = PathBuf::from(&begun.staging_dir);
        write_book(&staging, Some("7"), "new");

        let failing = |from: &Path, to: &Path| {
            if from.parent().is_some_and(|p| p.ends_with(STAGING_DIR)) {
                Err(std::io::Error::other("simulated"))
            } else {
                fs::rename(from, to)
            }
        };
        let error = commit_export_with(&staging, &final_dir, &failing).unwrap_err();
        assert!(error.contains("simulated"));
        assert_eq!(fs::read_to_string(final_dir.join("book.epub")).unwrap(), "old");
        assert!(staging.is_dir(), "staging is kept for abort_export");
        assert!(!root.join(TRASH_DIR).exists());
        abort_export_at(&staging).unwrap();
        assert!(!staging.exists());
    }

    #[test]
    fn commit_rejects_paths_outside_the_root() {
        let (_temp, root) = root();
        let other = TempDir::new("elsewhere");
        let begun = begin_export_at(&root, "1", "A").unwrap();
        let staging = PathBuf::from(&begun.staging_dir);
        assert!(commit_export_at(&staging, &other.path().join("A")).is_err());
        assert!(commit_export_at(&staging, &root.join(".hidden")).is_err());
        assert!(commit_export_at(&staging, &root.join("A/B")).is_err());
        // A staging dir that is not under .oghma-staging is refused.
        let fake = root.join("fake");
        fs::create_dir_all(&fake).unwrap();
        assert!(commit_export_at(&fake, &root.join("A")).is_err());
        assert!(abort_export_at(&fake).is_err());
        assert!(fake.is_dir());
    }

    #[test]
    fn abort_is_a_noop_when_missing() {
        let (_temp, root) = root();
        abort_export_at(&root.join(STAGING_DIR).join("nothing-1")).unwrap();
    }

    #[test]
    fn cleanup_removes_leftovers_but_keeps_active_exports() {
        let (_temp, root) = root();
        let stale = root.join(STAGING_DIR).join("old-1");
        write_book(&stale, None, "x");
        write_book(&root.join(TRASH_DIR).join("Livro-1"), None, "x");
        let active = begin_export_at(&root, "5", "Ativo").unwrap();

        let removed = cleanup_export_root_at(&root);
        assert_eq!(removed, 2);
        assert!(!stale.exists());
        assert!(!root.join(TRASH_DIR).exists());
        assert!(Path::new(&active.staging_dir).is_dir());
        abort_export_at(Path::new(&active.staging_dir)).unwrap();
    }

    #[test]
    fn meta_keys_cover_novel_and_folder_forms() {
        let keys = meta_keys_for(Path::new("/x/Livro"), "/x/Livro", "42");
        assert!(keys.contains(&"novel:42".to_string()));
        assert!(keys.contains(&"/x/Livro".to_string()));
    }
}
