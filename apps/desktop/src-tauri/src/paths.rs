use std::path::{Component, Path, PathBuf};

pub fn expand_home(path: &str) -> PathBuf {
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

pub fn safe_relative_path(file_name: &str) -> Result<PathBuf, String> {
    let path = Path::new(file_name);
    if file_name.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Caminho de arquivo invalido".to_string());
    }
    Ok(path.to_path_buf())
}


pub fn safe_export_stem(title: &str) -> String {
    let mut out = String::new();
    for ch in title.chars() {
        if matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            out.push('_');
        } else {
            out.push(ch);
        }
    }
    let trimmed = out.trim();
    if trimmed.is_empty() {
        "book".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Mirrors `sanitizeFileName` in `src/services/downloadManager.ts`:
/// runs of `\\/:*?"<>|` become a single `_`, whitespace runs collapse to one
/// space, the result is trimmed and an empty result becomes `novel`.
pub fn sanitize_file_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut in_forbidden = false;
    let mut in_space = false;
    for ch in name.chars() {
        if matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            if !in_forbidden {
                out.push('_');
            }
            in_forbidden = true;
            in_space = false;
        } else if ch.is_whitespace() {
            if !in_space {
                out.push(' ');
            }
            in_space = true;
            in_forbidden = false;
        } else {
            out.push(ch);
            in_forbidden = false;
            in_space = false;
        }
    }
    let trimmed = out.trim();
    if trimmed.is_empty() {
        "novel".to_string()
    } else {
        trimmed.to_string()
    }
}

/// True for names that the library scanner ignores (`.oghma-staging`, `.DS_Store`, temp files).
pub fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.')
}

#[cfg(test)]
mod tests {
    use super::{sanitize_file_name, safe_relative_path};

    #[test]
    fn relative_export_path_allows_asset_subdirectory() {
        assert!(safe_relative_path("assets/image.webp").is_ok());
        assert!(safe_relative_path("../outside.webp").is_err());
        assert!(safe_relative_path("/absolute.webp").is_err());
    }

    #[test]
    fn sanitize_matches_typescript_sanitizer() {
        assert_eq!(sanitize_file_name("Re:Zero / Kara"), "Re_Zero _ Kara");
        assert_eq!(sanitize_file_name("a:*?b"), "a_b");
        assert_eq!(sanitize_file_name("  Livro   de\tTeste  "), "Livro de Teste");
        assert_eq!(sanitize_file_name("Olá, Mundo"), "Olá, Mundo");
        assert_eq!(sanitize_file_name("   "), "novel");
    }
}
