//! Conta Oghma: the session token lives here (a 0600 JSON file in the app data dir, like the
//! ChatGPT tokens) and every call to the account API goes through Rust, so the token never
//! reaches the web view. The UI only sees statuses and JSON bodies.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::translation::siwc::write_private;

const FILE_NAME: &str = "oghma-account.json";

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSession {
    base_url: String,
    token: String,
}

/// Managed state: the HTTP client and the cached session.
pub struct OghmaAccount {
    http: reqwest::Client,
    path: Mutex<Option<PathBuf>>,
    session: Mutex<Option<Option<StoredSession>>>,
}

impl Default for OghmaAccount {
    fn default() -> Self {
        Self {
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(45))
                .user_agent(concat!("OghmaLibrary/", env!("CARGO_PKG_VERSION")))
                .build()
                .unwrap_or_default(),
            path: Mutex::new(None),
            session: Mutex::new(None),
        }
    }
}

impl OghmaAccount {
    fn file(&self, app: &AppHandle) -> Result<PathBuf, String> {
        let mut path = self.path.lock().map_err(|_| "estado da conta indisponível".to_string())?;
        if let Some(path) = path.as_ref() {
            return Ok(path.clone());
        }
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|err| format!("Não foi possível localizar dados do app: {err}"))?;
        let file = dir.join(FILE_NAME);
        *path = Some(file.clone());
        Ok(file)
    }

    fn load(&self, app: &AppHandle) -> Result<Option<StoredSession>, String> {
        let mut cached = self.session.lock().map_err(|_| "estado da conta indisponível".to_string())?;
        if let Some(session) = cached.as_ref() {
            return Ok(session.clone());
        }
        let file = self.file(app)?;
        let session = std::fs::read(&file)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<StoredSession>(&bytes).ok())
            .filter(|session| !session.token.is_empty() && !session.base_url.is_empty());
        *cached = Some(session.clone());
        Ok(session)
    }

    fn save(&self, app: &AppHandle, session: Option<StoredSession>) -> Result<(), String> {
        let file = self.file(app)?;
        match &session {
            Some(value) => {
                let bytes = serde_json::to_vec(value).map_err(|err| err.to_string())?;
                write_private(&file, &bytes)?;
            }
            None => match std::fs::remove_file(&file) {
                Err(err) if err.kind() != std::io::ErrorKind::NotFound => return Err(err.to_string()),
                _ => {}
            },
        }
        *self.session.lock().map_err(|_| "estado da conta indisponível".to_string())? = Some(session);
        Ok(())
    }
}

/// `https://host[:port]` (or `http://127.0.0.1…` / `localhost` for development), no path.
fn normalize_base(raw: &str) -> Result<String, String> {
    let url = url::Url::parse(raw.trim()).map_err(|_| "Endereço do servidor da conta inválido.".to_string())?;
    let host = url.host_str().unwrap_or_default();
    let local = host == "127.0.0.1" || host == "localhost";
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("O servidor da conta precisa usar HTTPS.".into());
    }
    let mut base = format!("{}://{}", url.scheme(), host);
    if let Some(port) = url.port() {
        base.push_str(&format!(":{port}"));
    }
    Ok(base)
}

/// Only the account API (`/v1/...`) is reachable through the proxy command.
fn checked_path(path: &str) -> Result<&str, String> {
    let ok = path.starts_with("/v1/")
        && !path.contains("..")
        && !path.contains("//")
        && path.chars().all(|ch| ch.is_ascii_graphic());
    if ok {
        Ok(path)
    } else {
        Err("Caminho da API da conta inválido.".into())
    }
}

/// The computer's name, shown in "Dispositivos conectados".
fn device_name() -> String {
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = std::process::Command::new("scutil").args(["--get", "ComputerName"]).output() {
            let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(name) = std::env::var("COMPUTERNAME") {
            if !name.trim().is_empty() {
                return name;
            }
        }
    }
    std::fs::read_to_string("/etc/hostname")
        .map(|name| name.trim().to_string())
        .ok()
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Computador".into())
}

fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResponse {
    status: u16,
    body: Value,
}

async fn send(
    http: &reqwest::Client,
    method: reqwest::Method,
    url: String,
    token: Option<&str>,
    body: Option<Value>,
) -> Result<ApiResponse, String> {
    let mut request = http.request(method, url);
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    if let Some(body) = body {
        let bytes = serde_json::to_vec(&body).map_err(|err| err.to_string())?;
        request = request.header(reqwest::header::CONTENT_TYPE, "application/json").body(bytes);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "Não foi possível falar com o servidor da conta. Verifique a internet.".to_string())?;
    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    let body = if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or(Value::Null)
    };
    Ok(ApiResponse { status, body })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    signed_in: bool,
    base_url: Option<String>,
}

#[tauri::command(async)]
pub fn oghma_account_status(app: AppHandle, state: tauri::State<'_, OghmaAccount>) -> Result<AccountStatus, String> {
    let session = state.load(&app)?;
    Ok(AccountStatus {
        signed_in: session.is_some(),
        base_url: session.map(|session| session.base_url),
    })
}

/// Sends the 6-digit code to `email` (no session needed).
#[tauri::command]
pub async fn oghma_account_request_code(
    state: tauri::State<'_, OghmaAccount>,
    base_url: String,
    email: String,
) -> Result<ApiResponse, String> {
    let base = normalize_base(&base_url)?;
    let body = serde_json::json!({ "email": email, "deviceName": device_name(), "platform": platform() });
    send(&state.http, reqwest::Method::POST, format!("{base}/v1/auth/code"), None, Some(body)).await
}

/// Keeps the session from a successful sign-in response (200 with `token`) and strips the token
/// from the body the UI receives.
fn keep_session(app: &AppHandle, state: &OghmaAccount, base: String, response: &mut ApiResponse) -> Result<(), String> {
    if response.status != 200 {
        return Ok(());
    }
    let token = response.body.get("token").and_then(Value::as_str).unwrap_or_default().to_string();
    if token.is_empty() {
        return Err("Resposta inválida do servidor da conta.".into());
    }
    state.save(app, Some(StoredSession { base_url: base, token }))?;
    if let Some(object) = response.body.as_object_mut() {
        object.remove("token");
    }
    Ok(())
}

/// Asks whether the e-mail button was confirmed (202 = still waiting; 200 = signed in, session kept).
#[tauri::command]
pub async fn oghma_account_poll(
    app: AppHandle,
    state: tauri::State<'_, OghmaAccount>,
    base_url: String,
    email: String,
    login_id: String,
) -> Result<ApiResponse, String> {
    let base = normalize_base(&base_url)?;
    let body = serde_json::json!({ "email": email, "loginId": login_id });
    let mut response = send(&state.http, reqwest::Method::POST, format!("{base}/v1/auth/poll"), None, Some(body)).await?;
    keep_session(&app, &state, base, &mut response)?;
    Ok(response)
}

/// Checks the code; on success keeps the session token here and returns the body without it.
#[tauri::command]
pub async fn oghma_account_verify(
    app: AppHandle,
    state: tauri::State<'_, OghmaAccount>,
    base_url: String,
    email: String,
    code: String,
) -> Result<ApiResponse, String> {
    let base = normalize_base(&base_url)?;
    let body = serde_json::json!({
        "email": email,
        "code": code,
        "deviceName": device_name(),
        "platform": platform(),
    });
    let mut response = send(&state.http, reqwest::Method::POST, format!("{base}/v1/auth/verify"), None, Some(body)).await?;
    keep_session(&app, &state, base, &mut response)?;
    Ok(response)
}

/// Authenticated call to the account API (`/v1/...`). A 401 forgets the session.
#[tauri::command]
pub async fn oghma_account_api(
    app: AppHandle,
    state: tauri::State<'_, OghmaAccount>,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<ApiResponse, String> {
    let session = state.load(&app)?.ok_or_else(|| "Você não está conectado à conta Oghma.".to_string())?;
    let method = match method.to_ascii_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        _ => return Err("Método inválido.".into()),
    };
    let path = checked_path(&path)?;
    let response = send(&state.http, method, format!("{}{path}", session.base_url), Some(&session.token), body).await?;
    if response.status == 401 {
        state.save(&app, None)?;
    }
    Ok(response)
}

/// Ends the session on the server (best effort) and forgets it here.
#[tauri::command]
pub async fn oghma_account_logout(app: AppHandle, state: tauri::State<'_, OghmaAccount>) -> Result<(), String> {
    if let Some(session) = state.load(&app)? {
        let _ = send(
            &state.http,
            reqwest::Method::POST,
            format!("{}/v1/auth/logout", session.base_url),
            Some(&session.token),
            None,
        )
        .await;
    }
    state.save(&app, None)
}

/// Forgets the session here only (after the account was deleted on the server).
#[tauri::command(async)]
pub fn oghma_account_forget(app: AppHandle, state: tauri::State<'_, OghmaAccount>) -> Result<(), String> {
    state.save(&app, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_urls_must_be_https_except_on_this_machine() {
        assert_eq!(normalize_base("https://conta.exemplo.com/qualquer?x=1").unwrap(), "https://conta.exemplo.com");
        assert_eq!(normalize_base(" http://127.0.0.1:8090 ").unwrap(), "http://127.0.0.1:8090");
        assert!(normalize_base("http://conta.exemplo.com").is_err());
        assert!(normalize_base("file:///etc/passwd").is_err());
        assert!(normalize_base("não é url").is_err());
    }

    #[test]
    fn only_account_api_paths_go_through() {
        assert!(checked_path("/v1/me/library?since=10").is_ok());
        assert!(checked_path("/v1/nicknames/jandson/available").is_ok());
        assert!(checked_path("/health").is_err());
        assert!(checked_path("/v1/../admin").is_err());
        assert!(checked_path("//evil.com/v1/").is_err());
        assert!(checked_path("/v1/me x").is_err());
    }
}
