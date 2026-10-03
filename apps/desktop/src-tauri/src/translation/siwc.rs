//! Sign in with ChatGPT ("token sharing"): OAuth PKCE over a loopback redirect,
//! tokens kept in the Keychain (0600 file fallback), automatic refresh, and
//! streamed calls to `https://api.openai.com/v1/responses` billed to the user's plan.
//! Tokens are never logged or returned to the UI.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use super::now_secs;
use super::provider::{with_retry, AccountInfo, BoxFut, ChatOutput, ChatProvider, ProviderError, TokenUsage};

pub const AUTH_BASE: &str = "https://auth.openai.com";
pub const API_BASE: &str = "https://api.openai.com/v1";
const RESOURCE: &str = "https://api.openai.com/v1";
const SCOPE: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const DYNAMIC_CLIENT: &str = "dynamic_agent_client";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Clone, Serialize, Deserialize)]
pub struct StoredTokens {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub id_token: Option<String>,
    pub client_id: String,
    /// Unix seconds.
    #[serde(default)]
    pub expires_at: i64,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub plan_type: Option<String>,
}

impl std::fmt::Debug for StoredTokens {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StoredTokens")
            .field("client_id", &self.client_id.chars().take(7).collect::<String>())
            .field("expires_at", &self.expires_at)
            .finish_non_exhaustive()
    }
}

/// Email/plan from the `id_token` payload (decoded, not verified: it only labels the UI).
pub fn identity_from_id_token(id_token: &str) -> (Option<String>, Option<String>) {
    let claims = id_token
        .split('.')
        .nth(1)
        .and_then(|payload| URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok())
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .unwrap_or(Value::Null);
    let email = claims.get("email").and_then(Value::as_str).map(str::to_string);
    let plan = claims
        .pointer("/https:~1~1api.openai.com~1auth/chatgpt_plan_type")
        .and_then(Value::as_str)
        .map(str::to_string);
    (email, plan)
}

/// Builds `StoredTokens` from a token endpoint response (`expires_in` -> `expires_at`).
pub fn tokens_from_response(response: &Value, client_id: &str, previous: Option<&StoredTokens>) -> Option<StoredTokens> {
    let access_token = response.get("access_token")?.as_str()?.to_string();
    let text = |key: &str| response.get(key).and_then(Value::as_str).map(str::to_string);
    let id_token = text("id_token").or_else(|| previous.and_then(|p| p.id_token.clone()));
    let (email, plan) = id_token.as_deref().map(identity_from_id_token).unwrap_or((None, None));
    Some(StoredTokens {
        access_token,
        refresh_token: text("refresh_token").or_else(|| previous.and_then(|p| p.refresh_token.clone())),
        id_token,
        client_id: client_id.to_string(),
        expires_at: now_secs() + response.get("expires_in").and_then(Value::as_i64).unwrap_or(3600),
        email: email.or_else(|| previous.and_then(|p| p.email.clone())),
        plan_type: plan.or_else(|| previous.and_then(|p| p.plan_type.clone())),
    })
}

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

pub trait TokenStore: Send + Sync {
    fn load(&self) -> Option<StoredTokens>;
    fn save(&self, tokens: &StoredTokens) -> Result<(), String>;
    fn clear(&self) -> Result<(), String>;
}

/// JSON file with mode 0600 in the app data dir (like Codex's `~/.codex/auth.json`).
/// The macOS Keychain was dropped: the app is ad-hoc signed, so every rebuild or
/// reinstall changed its identity and macOS asked for the login-keychain password.
pub struct FileTokenStore(pub PathBuf);

impl TokenStore for FileTokenStore {
    fn load(&self) -> Option<StoredTokens> {
        serde_json::from_slice(&std::fs::read(&self.0).ok()?).ok()
    }

    fn save(&self, tokens: &StoredTokens) -> Result<(), String> {
        let bytes = serde_json::to_vec(tokens).map_err(|err| err.to_string())?;
        write_private(&self.0, &bytes)
    }

    fn clear(&self) -> Result<(), String> {
        match std::fs::remove_file(&self.0) {
            Err(err) if err.kind() != std::io::ErrorKind::NotFound => Err(err.to_string()),
            _ => Ok(()),
        }
    }
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    // Fresh temp file every time (create_new + unique name): a leftover `.tmp` with looser
    // permissions, or a symlink planted at that name, is never reused for the tokens.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp = path.with_extension(format!("{}-{nanos}.tmp", std::process::id()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let written = (|| {
        use std::io::Write;
        let mut file = options.open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()
    })();
    if let Err(err) = written {
        let _ = std::fs::remove_file(&temp);
        return Err(err.to_string());
    }
    std::fs::rename(&temp, path).map_err(|err| {
        let _ = std::fs::remove_file(&temp);
        err.to_string()
    })
}

#[cfg(test)]
#[derive(Default)]
pub struct MemoryTokenStore(pub Mutex<Option<StoredTokens>>);

#[cfg(test)]
impl TokenStore for MemoryTokenStore {
    fn load(&self) -> Option<StoredTokens> {
        self.0.lock().ok()?.clone()
    }

    fn save(&self, tokens: &StoredTokens) -> Result<(), String> {
        *self.0.lock().map_err(|_| "lock")? = Some(tokens.clone());
        Ok(())
    }

    fn clear(&self) -> Result<(), String> {
        *self.0.lock().map_err(|_| "lock")? = None;
        Ok(())
    }
}

/// Non-secret per-install registration: the `ext_agent_host_id` and the issued
/// `oaiapp_…` client id (reused on later logins).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Registration {
    host_id: String,
    #[serde(default)]
    client_id: Option<String>,
}

fn random_b64(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    if getrandom::fill(&mut buf).is_err() {
        // Extremely unlikely; still produce something unique.
        let seed = format!("{:?}{}", std::time::SystemTime::now(), std::process::id());
        buf = Sha256::digest(seed.as_bytes()).to_vec();
    }
    URL_SAFE_NO_PAD.encode(buf)
}

fn uuid_v4() -> String {
    let mut b = [0u8; 16];
    let _ = getrandom::fill(&mut b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let hex: String = b.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
}

pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

#[derive(Debug, Default)]
pub struct SseState {
    pub text: String,
    pub usage: Option<TokenUsage>,
    pub error: Option<ProviderError>,
    pub completed: bool,
}

fn usage_of(usage: &Value) -> TokenUsage {
    let int = |pointer: &str| usage.pointer(pointer).and_then(Value::as_i64).unwrap_or(0);
    let input = int("/input_tokens");
    let output = int("/output_tokens");
    TokenUsage {
        input_tokens: input,
        cached_input_tokens: int("/input_tokens_details/cached_tokens"),
        output_tokens: output,
        reasoning_output_tokens: int("/output_tokens_details/reasoning_tokens"),
        total_tokens: usage.get("total_tokens").and_then(Value::as_i64).unwrap_or(input + output),
    }
}

/// Maps an API error code/status to a `ProviderError`.
pub fn classify_error(status: Option<u16>, code: &str, message: &str) -> ProviderError {
    let message = if message.is_empty() { code.to_string() } else { message.chars().take(300).collect() };
    let code = code.to_ascii_lowercase();
    if code.contains("usage_limit_exceeded") {
        ProviderError::UsageLimit(message)
    } else if code.contains("usage_unavailable") {
        ProviderError::Unavailable(message)
    } else if code.contains("not_eligible") || code.contains("invalid_user") {
        ProviderError::NotLoggedIn(message)
    } else if code.contains("unsupported_capability") {
        ProviderError::Fatal(message)
    } else {
        match status {
            Some(401) => ProviderError::NotLoggedIn(message),
            Some(503) => ProviderError::Unavailable(message),
            Some(408) | Some(409) | Some(429) => ProviderError::Transient(message),
            Some(status) if status >= 500 => ProviderError::Transient(message),
            Some(_) => ProviderError::Fatal(message),
            None => ProviderError::Transient(message),
        }
    }
}

fn error_parts(error: &Value) -> (String, String) {
    let error = error.get("error").filter(|e| e.is_object()).unwrap_or(error);
    let code = error
        .get("code")
        .or_else(|| error.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let message = error.get("message").and_then(Value::as_str).unwrap_or("").to_string();
    (code, message)
}

impl SseState {
    pub fn apply(&mut self, event: &Value) {
        match event.get("type").and_then(Value::as_str).unwrap_or("") {
            "response.output_text.delta" => {
                self.text.push_str(event.get("delta").and_then(Value::as_str).unwrap_or(""));
            }
            "response.output_text.done" => {
                // Authoritative full text when present.
                if let Some(text) = event.get("text").and_then(Value::as_str) {
                    self.text = text.to_string();
                }
            }
            "response.completed" => {
                self.completed = true;
                if let Some(usage) = event.pointer("/response/usage") {
                    self.usage = Some(usage_of(usage));
                }
            }
            "response.incomplete" => {
                let reason = event
                    .pointer("/response/incomplete_details/reason")
                    .and_then(Value::as_str)
                    .unwrap_or("incompleta");
                self.error = Some(ProviderError::Transient(format!("resposta incompleta: {reason}")));
            }
            "response.failed" => {
                let (code, message) = error_parts(event.pointer("/response/error").unwrap_or(&Value::Null));
                self.error = Some(classify_error(None, &code, &message));
            }
            "error" => {
                let (code, message) = error_parts(event);
                self.error = Some(classify_error(None, &code, &message));
            }
            _ => {}
        }
    }

    /// Consumes every complete event (`\n\n`-terminated) from `buffer`.
    pub fn feed(&mut self, buffer: &mut Vec<u8>) {
        loop {
            let boundary = buffer
                .windows(2)
                .position(|w| w == b"\n\n")
                .map(|p| (p, 2))
                .or_else(|| buffer.windows(4).position(|w| w == b"\r\n\r\n").map(|p| (p, 4)));
            let Some((at, len)) = boundary else { break };
            let raw: Vec<u8> = buffer.drain(..at + len).collect();
            let text = String::from_utf8_lossy(&raw);
            let data: Vec<&str> = text
                .lines()
                .filter_map(|line| line.strip_prefix("data:"))
                .map(str::trim)
                .collect();
            let data = data.join("\n");
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            if let Ok(event) = serde_json::from_str::<Value>(&data) {
                self.apply(&event);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/// A login in progress: the loopback listener and the PKCE secrets.
pub struct PendingLogin {
    listener: TcpListener,
    redirect_uri: String,
    verifier: String,
    state: String,
    cancel: oneshot::Receiver<()>,
    pub auth_url: String,
}

pub struct SiwcProvider {
    http: reqwest::Client,
    store: Box<dyn TokenStore>,
    /// `None` = not loaded from the store yet.
    tokens: Mutex<Option<Option<StoredTokens>>>,
    refresh_lock: tokio::sync::Mutex<()>,
    registration_path: Option<PathBuf>,
    login_cancel: Mutex<Option<oneshot::Sender<()>>>,
    pub api_base: String,
    pub auth_base: String,
    pub timeout: Duration,
    pub retry_delays: Vec<Duration>,
}

impl SiwcProvider {
    pub fn new(store: Box<dyn TokenStore>, registration_path: Option<PathBuf>) -> SiwcProvider {
        SiwcProvider {
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(20))
                .user_agent(concat!("OghmaLibrary/", env!("CARGO_PKG_VERSION")))
                .build()
                .unwrap_or_default(),
            store,
            tokens: Mutex::new(None),
            refresh_lock: tokio::sync::Mutex::new(()),
            registration_path,
            login_cancel: Mutex::new(None),
            api_base: API_BASE.to_string(),
            auth_base: AUTH_BASE.to_string(),
            // ~1,000 words take ~35 s; one huge paragraph can take minutes.
            timeout: Duration::from_secs(300),
            retry_delays: vec![Duration::from_secs(3), Duration::from_secs(15), Duration::from_secs(45)],
        }
    }

    fn current(&self) -> Option<StoredTokens> {
        let mut guard = self.tokens.lock().ok()?;
        if guard.is_none() {
            *guard = Some(self.store.load());
        }
        guard.as_ref().and_then(|tokens| tokens.clone())
    }

    fn set_current(&self, tokens: Option<StoredTokens>) {
        if let Ok(mut guard) = self.tokens.lock() {
            *guard = Some(tokens);
        }
    }

    fn registration(&self) -> Registration {
        let loaded: Option<Registration> = self
            .registration_path
            .as_ref()
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice(&bytes).ok());
        match loaded {
            Some(reg) if !reg.host_id.is_empty() => reg,
            _ => {
                let reg = Registration { host_id: format!("urn:uuid:{}", uuid_v4()), client_id: None };
                self.save_registration(&reg);
                reg
            }
        }
    }

    fn save_registration(&self, reg: &Registration) {
        if let (Some(path), Ok(bytes)) = (&self.registration_path, serde_json::to_vec(reg)) {
            let _ = write_private(path, &bytes);
        }
    }

    pub fn logout(&self) -> Result<(), String> {
        self.set_current(None);
        self.store.clear()
    }

    pub fn cancel_login(&self) {
        if let Some(sender) = self.login_cancel.lock().ok().and_then(|mut slot| slot.take()) {
            let _ = sender.send(());
        }
    }

    /// Binds the loopback listener and builds the authorize URL (the caller opens it).
    pub async fn begin_login(&self) -> Result<PendingLogin, ProviderError> {
        let registration = self.registration();
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|err| ProviderError::Fatal(format!("não foi possível abrir a porta local: {err}")))?;
        let port = listener.local_addr().map_err(|err| ProviderError::Fatal(err.to_string()))?.port();
        let redirect_uri = format!("http://127.0.0.1:{port}/callback");
        let verifier = random_b64(48);
        let state = random_b64(24);
        let client_id = registration.client_id.clone().unwrap_or_else(|| DYNAMIC_CLIENT.to_string());
        let auth_url = url::Url::parse_with_params(
            &format!("{}/api/accounts/authorize", self.auth_base),
            &[
                ("client_id", client_id.as_str()),
                ("agent_name_hint", "Oghma Library"),
                ("ext_agent_host_id", registration.host_id.as_str()),
                ("response_type", "code"),
                ("redirect_uri", redirect_uri.as_str()),
                ("scope", SCOPE),
                ("resource", RESOURCE),
                ("state", state.as_str()),
                ("nonce", random_b64(24).as_str()),
                ("code_challenge_method", "S256"),
                ("code_challenge", pkce_challenge(&verifier).as_str()),
            ],
        )
        .map_err(|err| ProviderError::Fatal(err.to_string()))?
        .to_string();
        let (cancel_tx, cancel) = oneshot::channel();
        if let Ok(mut slot) = self.login_cancel.lock() {
            if let Some(previous) = slot.replace(cancel_tx) {
                let _ = previous.send(());
            }
        }
        Ok(PendingLogin { listener, redirect_uri, verifier, state, cancel, auth_url })
    }

    /// Waits for the browser callback, exchanges the code and stores the tokens.
    pub async fn finish_login(&self, pending: PendingLogin) -> Result<AccountInfo, ProviderError> {
        let PendingLogin { listener, redirect_uri, verifier, state, mut cancel, .. } = pending;
        let wait = async {
            loop {
                let (mut socket, _) = listener
                    .accept()
                    .await
                    .map_err(|err| ProviderError::Fatal(format!("falha no retorno do login: {err}")))?;
                let mut buf = vec![0u8; 8192];
                let mut read = 0;
                while read < buf.len() {
                    let n = socket.read(&mut buf[read..]).await.unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    read += n;
                    if buf[..read].windows(4).any(|w| w == b"\r\n\r\n") {
                        break;
                    }
                }
                let request = String::from_utf8_lossy(&buf[..read]).to_string();
                let target = request.split_whitespace().nth(1).unwrap_or("").to_string();
                if !target.starts_with("/callback") {
                    let _ = socket.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
                    continue;
                }
                let query: Vec<(String, String)> = url::Url::parse(&format!("http://127.0.0.1{target}"))
                    .map(|url| url.query_pairs().into_owned().collect())
                    .unwrap_or_default();
                let ok = query.iter().any(|(k, _)| k == "code");
                let page = if ok {
                    "<!doctype html><meta charset=\"utf-8\"><title>Oghma Library</title><h2>Oghma Library conectado ao ChatGPT.</h2><p>Pode fechar esta aba e voltar ao app.</p>"
                } else {
                    "<!doctype html><meta charset=\"utf-8\"><title>Oghma Library</title><h2>O login não foi concluído.</h2><p>Volte ao app e tente de novo.</p>"
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
                    page.len()
                );
                let _ = socket.write_all(response.as_bytes()).await;
                return Ok::<_, ProviderError>(query);
            }
        };
        let query = tokio::select! {
            result = tokio::time::timeout(LOGIN_TIMEOUT, wait) => match result {
                Ok(result) => result?,
                Err(_) => return Err(ProviderError::Fatal("tempo esgotado esperando o login".into())),
            },
            _ = &mut cancel => return Err(ProviderError::Cancelled),
        };
        let get = |key: &str| query.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone());
        if let Some(error) = get("error") {
            let detail = get("error_description").unwrap_or_default();
            return Err(ProviderError::NotLoggedIn(format!("{error} {detail}").trim().to_string()));
        }
        if get("state").as_deref() != Some(state.as_str()) {
            return Err(ProviderError::Fatal("resposta de login inválida (state)".into()));
        }
        let code = get("code").ok_or_else(|| ProviderError::Fatal("login sem código".into()))?;
        let mut registration = self.registration();
        let client_id = get("client_id")
            .or_else(|| registration.client_id.clone())
            .unwrap_or_else(|| DYNAMIC_CLIENT.to_string());

        let response = self
            .token_request(&[
                ("grant_type", "authorization_code"),
                ("client_id", &client_id),
                ("code", &code),
                ("code_verifier", &verifier),
                ("redirect_uri", &redirect_uri),
                ("resource", RESOURCE),
            ])
            .await?;
        let tokens = tokens_from_response(&response, &client_id, None)
            .ok_or_else(|| ProviderError::Fatal("resposta de token sem access_token".into()))?;
        registration.client_id = Some(client_id);
        self.save_registration(&registration);
        self.store.save(&tokens).map_err(ProviderError::Fatal)?;
        self.set_current(Some(tokens));
        if let Ok(mut slot) = self.login_cancel.lock() {
            slot.take();
        }
        Ok(self.account())
    }

    async fn token_request(&self, form: &[(&str, &str)]) -> Result<Value, ProviderError> {
        let body = url::form_urlencoded::Serializer::new(String::new()).extend_pairs(form).finish();
        let response = self
            .http
            .post(format!("{}/api/accounts/oauth/token", self.auth_base))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(body)
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .map_err(|err| ProviderError::Transient(format!("falha de rede no login: {err}")))?;
        let status = response.status().as_u16();
        let value: Value = json_value(response).await;
        if !(200..300).contains(&status) {
            let (code, message) = error_parts(&value);
            return Err(match status {
                400 | 401 | 403 => ProviderError::NotLoggedIn(if message.is_empty() { code } else { message }),
                _ => classify_error(Some(status), &code, &message),
            });
        }
        Ok(value)
    }

    async fn refresh(&self, stale: &StoredTokens) -> Result<StoredTokens, ProviderError> {
        let _guard = self.refresh_lock.lock().await;
        // Another task may have refreshed while we waited.
        if let Some(current) = self.current() {
            if current.access_token != stale.access_token {
                return Ok(current);
            }
        }
        let refresh_token = stale
            .refresh_token
            .clone()
            .ok_or_else(|| ProviderError::NotLoggedIn("sessão expirada".into()))?;
        let response = self
            .token_request(&[
                ("grant_type", "refresh_token"),
                ("client_id", &stale.client_id),
                ("refresh_token", &refresh_token),
                ("resource", RESOURCE),
            ])
            .await?;
        let tokens = tokens_from_response(&response, &stale.client_id, Some(stale))
            .ok_or_else(|| ProviderError::NotLoggedIn("renovação sem access_token".into()))?;
        let _ = self.store.save(&tokens);
        self.set_current(Some(tokens.clone()));
        Ok(tokens)
    }

    async fn fresh_tokens(&self) -> Result<StoredTokens, ProviderError> {
        let tokens = self.current().ok_or_else(|| ProviderError::NotLoggedIn("ChatGPT não conectado".into()))?;
        if tokens.expires_at > 0 && now_secs() + 120 >= tokens.expires_at && tokens.refresh_token.is_some() {
            return self.refresh(&tokens).await;
        }
        Ok(tokens)
    }

    async fn post_responses(&self, token: &str, body: &Value) -> Result<ChatOutput, ProviderError> {
        let response = self
            .http
            .post(format!("{}/responses", self.api_base))
            .bearer_auth(token)
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream")
            .body(body.to_string())
            .send()
            .await
            .map_err(|err| ProviderError::Transient(format!("falha de rede: {err}")))?;
        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            let value = json_value(response).await;
            let (code, message) = error_parts(&value);
            return Err(classify_error(Some(status), &code, &message));
        }
        let mut response = response;
        let mut state = SseState::default();
        let mut buffer = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|err| ProviderError::Transient(format!("conexão interrompida: {err}")))?
        {
            buffer.extend_from_slice(&chunk);
            state.feed(&mut buffer);
            if let Some(error) = state.error.take() {
                return Err(error);
            }
        }
        buffer.extend_from_slice(b"\n\n");
        state.feed(&mut buffer);
        if let Some(error) = state.error.take() {
            return Err(error);
        }
        if !state.completed {
            return Err(ProviderError::Transient("resposta terminou sem response.completed".into()));
        }
        Ok(ChatOutput { text: state.text, usage: state.usage.unwrap_or_default() })
    }

    async fn translate_once(&self, model: &str, effort: &str, instructions: &str, text: &str) -> Result<ChatOutput, ProviderError> {
        self.respond_once(model, effort, instructions, json!([{ "type": "input_text", "text": text }])).await
    }

    async fn respond_once(&self, model: &str, effort: &str, instructions: &str, content: Value) -> Result<ChatOutput, ProviderError> {
        let body = json!({
            "model": model,
            "instructions": instructions,
            "input": [{ "role": "user", "content": content }],
            "reasoning": { "effort": effort },
            "stream": true,
            "store": false,
        });
        let attempt = async {
            let tokens = self.fresh_tokens().await?;
            match self.post_responses(&tokens.access_token, &body).await {
                // On 401, refresh once, then ask for a new login.
                Err(ProviderError::NotLoggedIn(_)) if tokens.refresh_token.is_some() => {
                    let refreshed = self.refresh(&tokens).await?;
                    self.post_responses(&refreshed.access_token, &body).await
                }
                other => other,
            }
        };
        tokio::time::timeout(self.timeout, attempt)
            .await
            .map_err(|_| ProviderError::Transient(format!("tempo esgotado ({} s)", self.timeout.as_secs())))?
    }
}

/// `response.json()` without the reqwest `json` feature; never fails.
async fn json_value(response: reqwest::Response) -> Value {
    let bytes = response.bytes().await.unwrap_or_default();
    serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| json!({ "message": String::from_utf8_lossy(&bytes).chars().take(300).collect::<String>() }))
}

impl ChatProvider for SiwcProvider {
    fn account(&self) -> AccountInfo {
        match self.current() {
            Some(tokens) => AccountInfo { logged_in: true, email: tokens.email, plan_type: tokens.plan_type },
            None => AccountInfo::default(),
        }
    }

    fn translate<'a>(
        &'a self,
        model: &'a str,
        effort: &'a str,
        instructions: &'a str,
        text: &'a str,
    ) -> BoxFut<'a, Result<ChatOutput, ProviderError>> {
        Box::pin(async move {
            with_retry(&self.retry_delays, || self.translate_once(model, effort, instructions, text)).await
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sse_stream_split_across_chunks() {
        let stream = concat!(
            "event: response.created\ndata: {\"type\":\"response.created\"}\n\n",
            "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"<p>Olá\"}\n\n",
            "event: response.output_text.delta\r\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\", mundo</p>\"}\r\n\r\n",
            "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":119,\"input_tokens_details\":{\"cached_tokens\":0},\"output_tokens\":40,\"output_tokens_details\":{\"reasoning_tokens\":0},\"total_tokens\":159}}}\n\n"
        );
        let mut state = SseState::default();
        let mut buffer = Vec::new();
        for piece in stream.as_bytes().chunks(7) {
            buffer.extend_from_slice(piece);
            state.feed(&mut buffer);
        }
        assert!(state.completed);
        assert_eq!(state.text, "<p>Olá, mundo</p>");
        let usage = state.usage.unwrap();
        assert_eq!((usage.input_tokens, usage.output_tokens, usage.total_tokens), (119, 40, 159));
    }

    #[test]
    fn classifies_subscription_errors() {
        let mut state = SseState::default();
        state.apply(&json!({"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"limit"}}}));
        assert!(matches!(state.error, Some(ProviderError::UsageLimit(_))));
        assert!(matches!(classify_error(Some(503), "subscription_sharing_usage_unavailable", ""), ProviderError::Unavailable(_)));
        assert!(matches!(classify_error(Some(403), "subscription_sharing_user_not_eligible", ""), ProviderError::NotLoggedIn(_)));
        assert!(matches!(classify_error(Some(401), "subscription_sharing_invalid_user", ""), ProviderError::NotLoggedIn(_)));
        assert!(matches!(classify_error(Some(400), "subscription_sharing_unsupported_capability", ""), ProviderError::Fatal(_)));
        assert!(matches!(classify_error(Some(401), "", "expired"), ProviderError::NotLoggedIn(_)));
        assert!(classify_error(Some(502), "", "bad gateway").is_retryable());
    }

    #[test]
    fn pkce_and_id_token_helpers() {
        // RFC 7636 appendix B.
        assert_eq!(pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        let payload = URL_SAFE_NO_PAD.encode(br#"{"email":"leitor@example.com","https://api.openai.com/auth":{"chatgpt_plan_type":"plus"}}"#);
        let (email, plan) = identity_from_id_token(&format!("x.{payload}.y"));
        assert_eq!(email.as_deref(), Some("leitor@example.com"));
        assert_eq!(plan.as_deref(), Some("plus"));
        let tokens = tokens_from_response(&json!({"access_token":"a","refresh_token":"r","expires_in":3600}), "oaiapp_x", None).unwrap();
        assert!(tokens.expires_at > now_secs() + 3500);
        assert!(!format!("{tokens:?}").contains("\"a\""), "Debug never prints tokens");
        assert_eq!(uuid_v4().len(), 36);
    }

    #[test]
    fn file_store_is_private() {
        let dir = crate::files::test_support::TempDir::new("tokens");
        let store = FileTokenStore(dir.path().join("t.json"));
        let tokens = tokens_from_response(&json!({"access_token":"a"}), "c", None).unwrap();
        store.save(&tokens).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.path().join("t.json")).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        assert_eq!(store.load().unwrap().client_id, "c");
        store.clear().unwrap();
        assert!(store.load().is_none());
    }

    /// Real call against `/v1/responses` with the spike's tokens (never printed).
    /// `cargo test smoke_real_translation -- --ignored --nocapture`
    /// Tokens: `$OGHMA_SIWC_TOKENS` or `~/Documents/Oghma-wt/siwc-spike/tokens.json`.
    /// An expired access token is refreshed and written back to that file (0600).
    #[test]
    #[ignore]
    fn smoke_real_translation() {
        use crate::translation::pipeline::{translate_fragment, validate};
        let path = std::env::var("OGHMA_SIWC_TOKENS")
            .map(PathBuf::from)
            .unwrap_or_else(|_| crate::paths::expand_home("~/Documents/Oghma-wt/siwc-spike/tokens.json"));
        let Ok(raw) = std::fs::read(&path) else {
            println!("SKIP: no token file at {}", path.display());
            return;
        };
        let mut spike: serde_json::Map<String, Value> = serde_json::from_slice(&raw).expect("token file is JSON");
        let text = |key: &str| spike.get(key).and_then(Value::as_str).map(str::to_string);
        let saved_at = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let (email, plan) = text("id_token").as_deref().map(identity_from_id_token).unwrap_or((None, None));
        let original = StoredTokens {
            access_token: text("access_token").expect("access_token"),
            refresh_token: text("refresh_token"),
            id_token: text("id_token"),
            client_id: text("client_id").expect("client_id"),
            expires_at: saved_at + spike.get("expires_in").and_then(Value::as_i64).unwrap_or(3600),
            email,
            plan_type: plan,
        };
        println!(
            "account: plan={:?}, token expires in {} s",
            original.plan_type,
            original.expires_at - now_secs()
        );
        let mut provider = SiwcProvider::new(Box::new(MemoryTokenStore(Mutex::new(Some(original.clone())))), None);
        provider.retry_delays = vec![Duration::from_secs(3)];

        let paragraph = "<p>The rain had not stopped for three days, and the old watchtower at the edge of Greywater groaned \
            under its weight. Mira climbed the last flight of stairs with a lantern in one hand and her father's letter in the \
            other, counting the steps the way he had taught her when she was small. <em>Forty-two,</em> she thought, and pushed \
            the door open. The room smelled of wet stone and candle smoke. Someone had been here recently; the ashes in the \
            hearth were still warm, and a cup of tea sat half finished on the windowsill, a thin skin of cold milk floating on \
            top. She set the lantern down and unfolded the letter again, although she knew every word by heart. “If you are \
            reading this,” it began, “then the bridge has fallen, and you must not wait for me.” Outside, thunder rolled across \
            the valley like a cart full of iron.</p>";
        println!("source words: {}", crate::translation::source::word_count(paragraph));
        tauri::async_runtime::block_on(async {
            let started = std::time::Instant::now();
            let result = translate_fragment(&provider, "gpt-6-luna", "none", paragraph, &[], "").await;
            match result {
                Ok(fragment) => {
                    println!("seconds: {:.1}, requests: {}", started.elapsed().as_secs_f64(), fragment.requests);
                    println!(
                        "usage: input={} (cached {}), output={} (reasoning {}), total={}; credits={:.5}",
                        fragment.usage.input_tokens,
                        fragment.usage.cached_input_tokens,
                        fragment.usage.output_tokens,
                        fragment.usage.reasoning_output_tokens,
                        fragment.usage.total_tokens,
                        crate::translation::provider::credits("gpt-6-luna", &fragment.usage)
                    );
                    println!("valid: {:?}, note: {:?}", validate(paragraph, &fragment.html), fragment.note);
                    println!("output:\n{}", fragment.html);
                    assert!(!fragment.html.is_empty());
                }
                Err(ProviderError::NotLoggedIn(message)) => println!("SKIP: login expired and refresh failed: {message}"),
                Err(err) => panic!("real translation failed: {err}"),
            }
        });
        // Persist rotated tokens so the spike scripts keep working.
        if let Some(current) = provider.current() {
            if current.access_token != original.access_token {
                spike.insert("access_token".into(), Value::String(current.access_token.clone()));
                if let Some(refresh) = &current.refresh_token {
                    spike.insert("refresh_token".into(), Value::String(refresh.clone()));
                }
                if let Some(id_token) = &current.id_token {
                    spike.insert("id_token".into(), Value::String(id_token.clone()));
                }
                spike.insert("expires_in".into(), json!(current.expires_at - now_secs()));
                write_private(&path, &serde_json::to_vec_pretty(&spike).unwrap()).expect("save refreshed tokens");
                println!("token refreshed and saved back to the spike file");
            }
        }
    }

    #[test]
    fn login_callback_exchanges_code() {
        // The loopback half of the PKCE flow against a local fake token endpoint.
        tauri::async_runtime::block_on(async {
            let token_server = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let token_port = token_server.local_addr().unwrap().port();
            tauri::async_runtime::spawn(async move {
                let (mut socket, _) = token_server.accept().await.unwrap();
                let mut buf = vec![0u8; 4096];
                let _ = socket.read(&mut buf).await.unwrap();
                let body = r#"{"access_token":"at","refresh_token":"rt","expires_in":3600,"token_type":"Bearer"}"#;
                let reply = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                socket.write_all(reply.as_bytes()).await.unwrap();
            });
            let dir = crate::files::test_support::TempDir::new("siwc-login");
            let mut provider = SiwcProvider::new(Box::new(MemoryTokenStore::default()), Some(dir.path().join("reg.json")));
            provider.auth_base = format!("http://127.0.0.1:{token_port}");
            let pending = provider.begin_login().await.unwrap();
            assert!(pending.auth_url.contains("client_id=dynamic_agent_client"));
            assert!(pending.auth_url.contains("code_challenge_method=S256"));
            let state = url::Url::parse(&pending.auth_url)
                .unwrap()
                .query_pairs()
                .find(|(k, _)| k == "state")
                .map(|(_, v)| v.to_string())
                .unwrap();
            let redirect = pending.redirect_uri.clone();
            let browser = tauri::async_runtime::spawn(async move {
                let url = url::Url::parse(&redirect).unwrap();
                let mut socket = tokio::net::TcpStream::connect((url.host_str().unwrap(), url.port().unwrap())).await.unwrap();
                let request = format!("GET /callback?code=abc&state={state}&client_id=oaiapp_test HTTP/1.1\r\nHost: x\r\n\r\n");
                socket.write_all(request.as_bytes()).await.unwrap();
                let mut page = String::new();
                let _ = socket.read_to_string(&mut page).await;
                page
            });
            let account = provider.finish_login(pending).await.unwrap();
            assert!(account.logged_in);
            assert!(browser.await.unwrap().contains("200 OK"));
            assert_eq!(provider.current().unwrap().client_id, "oaiapp_test");
            let reg: Registration = serde_json::from_slice(&std::fs::read(dir.path().join("reg.json")).unwrap()).unwrap();
            assert_eq!(reg.client_id.as_deref(), Some("oaiapp_test"));
            assert!(reg.host_id.starts_with("urn:uuid:"));
            provider.logout().unwrap();
            assert!(!provider.account().logged_in);
        });
    }
}
