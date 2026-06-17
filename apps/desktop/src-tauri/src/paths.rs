use std::path::{Path, PathBuf};

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

pub fn safe_file_name(file_name: &str) -> Result<&str, String> {
    let path = Path::new(file_name);
    if path.components().count() != 1 {
        return Err("Nome de arquivo invalido".to_string());
    }
    Ok(file_name)
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
