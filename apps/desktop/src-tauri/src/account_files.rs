//! Imported EPUBs kept in the Oghma account (docs/IMPORT_EPUB.md, "Arquivos na conta"):
//! sending the book folder's EPUB and cover, bringing them back into the Library and the
//! storage usage. Everything goes through Rust with the session of `oghma_account`: the web
//! view only sees keys, states and error codes, never the token nor the presigned URLs.
use std::sync::OnceLock;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use crate::export_root::ExportRoot;
use crate::oghma_account::OghmaAccount;

mod transfer;
#[cfg(test)]
mod tests;

use transfer::{download_book, upload_book, AccountClient, Progress, Uploaded};

/// Event emitted with `{ key, sent, total }` while a file goes up or comes down.
pub const PROGRESS_EVENT: &str = "account-file-progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResult {
    pub key: String,
    /// "uploaded" | "already" | "failed".
    pub state: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub key: String,
    pub output_dir: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    key: String,
    sent: u64,
    total: u64,
}

/// One shared client for the transfers (see `transfer_client`: no redirects).
fn transfer_http() -> reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(transfer::transfer_client).clone()
}

fn client(app: &AppHandle, account: &OghmaAccount) -> Result<AccountClient, String> {
    let (base, token) = account.session(app)?.ok_or("not_signed_in")?;
    Ok(AccountClient { http: transfer_http(), base, token })
}

/// A 401 means the session is gone on the server: forget it here too.
fn after(app: &AppHandle, account: &OghmaAccount, error: &str) {
    if error == "unauthorized" {
        let _ = account.forget(app);
    }
}

fn progress(app: &AppHandle, key: &str) -> std::sync::Arc<Progress> {
    let (app, key) = (app.clone(), key.to_string());
    Progress::new(move |sent, total| {
        let _ = app.emit(PROGRESS_EVENT, ProgressPayload { key: key.clone(), sent, total });
    })
}

/// Sends the EPUB and the cover of the `import:<sha>` book (its folder must be inside the
/// Library): `POST /v1/me/files` -> PUT to the presigned URL -> confirm.
#[tauri::command]
pub async fn account_file_upload(
    app: AppHandle,
    account: State<'_, OghmaAccount>,
    export_root: State<'_, ExportRoot>,
    key: String,
) -> Result<UploadResult, String> {
    let outcome = match (client(&app, &account), export_root.current()) {
        (Err(err), _) => Err(err),
        (_, None) => Err("no_library".to_string()),
        (Ok(client), Some(root)) => upload_book(&client, &root, &key, &progress(&app, &key)).await,
    };
    let (state, error) = match outcome {
        Ok(Uploaded::Sent) => ("uploaded", None),
        Ok(Uploaded::Already) => ("already", None),
        Err(err) => {
            after(&app, &account, &err);
            ("failed", Some(err))
        }
    };
    Ok(UploadResult { key, state: state.to_string(), error })
}

/// Brings the `import:<sha>` book back from the account into the Library (folder, cover and
/// a marker built from the row snapshot) and puts it back on the shelf.
#[tauri::command]
pub async fn account_file_download(
    app: AppHandle,
    account: State<'_, OghmaAccount>,
    export_root: State<'_, ExportRoot>,
    key: String,
    title: String,
) -> Result<DownloadResult, String> {
    let snapshot = crate::library_meta::live_snapshot(&app, &key).ok().flatten().unwrap_or(Value::Null);
    let outcome = match (client(&app, &account), export_root.current()) {
        (Err(err), _) => Err(err),
        (_, None) => Err("no_library".to_string()),
        (Ok(client), Some(root)) => download_book(&client, &root, &key, &title, &snapshot, &progress(&app, &key)).await,
    };
    let mut result = DownloadResult { key: key.clone(), output_dir: None, error: None };
    match outcome {
        Ok(dir) => {
            // The files are in place; a metadata failure must not fail the download.
            if let Err(err) = crate::library_meta::mark_downloaded(&app, &[key.clone()]) {
                eprintln!("Warning: could not mark {key} as downloaded: {err}");
            }
            result.output_dir = Some(dir.to_string_lossy().to_string());
        }
        Err(err) => {
            after(&app, &account, &err);
            result.error = Some(err);
        }
    }
    Ok(result)
}

/// `{ usedBytes, quotaBytes, files }` of the account storage; errors are codes.
#[tauri::command]
pub async fn account_files_usage(app: AppHandle, account: State<'_, OghmaAccount>) -> Result<Value, String> {
    let client = client(&app, &account)?;
    let usage = client.usage().await;
    if let Err(err) = &usage {
        after(&app, &account, err);
    }
    usage
}
