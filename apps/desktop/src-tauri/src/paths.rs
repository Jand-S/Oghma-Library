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

#[cfg(test)]
mod tests {
    use super::safe_relative_path;

    #[test]
    fn relative_export_path_allows_asset_subdirectory() {
        assert!(safe_relative_path("assets/image.webp").is_ok());
        assert!(safe_relative_path("../outside.webp").is_err());
        assert!(safe_relative_path("/absolute.webp").is_err());
    }
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
