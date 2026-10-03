//! Translation engine: EN -> pt-BR through the user's ChatGPT plan, using the
//! official Sign in with ChatGPT token-sharing flow (`/v1/responses`). See
//! `docs/TRANSLATION_CONTRACT.md` for the binding contract.
//!
//! Layout:
//! - `provider`: `trait ChatProvider` (+ `FakeProvider`), usage, credits.
//! - `siwc`: Sign in with ChatGPT provider (PKCE login, tokens, `/v1/responses`).
//! - `store`: SQLite (`app_data_dir/translation.db`).
//! - `source`: EPUB reading and the tag-aware block splitter.
//! - `pipeline`: chunking, prompt, validation, retry and block fallback.
//! - `glossary`: candidate heuristics + one curation turn.
//! - `runner`: workers, pause/cancel, `waiting_limit` with 15-min retries, ETA.
//! - `pilot`, `verify`, `export`: pilot bake-off, QA report, PT-BR library book.
//! - `commands`: Tauri commands.

pub mod commands;
pub mod export;
pub mod glossary;
pub mod pilot;
pub mod pipeline;
pub mod provider;
pub mod runner;
pub mod siwc;
pub mod source;
pub mod store;
pub mod verify;

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use provider::ChatProvider;
use siwc::SiwcProvider;
use store::Store;

/// Locks a mutex even if a previous holder panicked. A panic in one task must not
/// leave the whole translation engine unusable ("poisoned" lock); the guarded
/// data here (SQLite connection, job maps, timers) stays consistent on its own.
pub(crate) trait LockExt<T> {
    fn lock_safe(&self) -> std::sync::MutexGuard<'_, T>;
}

impl<T> LockExt<T> for std::sync::Mutex<T> {
    fn lock_safe(&self) -> std::sync::MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}


// ---------------------------------------------------------------------------
// Contract types (serde camelCase, mirrors the TS shapes)
// ---------------------------------------------------------------------------

/// The app's own counters from `usage_log` (there is no official quota API).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct LocalUsage {
    #[serde(rename = "words5h")]
    pub words_5h: u64,
    #[serde(rename = "credits5h")]
    pub credits_5h: f64,
    #[serde(rename = "words7d")]
    pub words_7d: u64,
    #[serde(rename = "credits7d")]
    pub credits_7d: f64,
}

/// Set by `subscription_sharing_usage_limit_exceeded`, cleared on the first success.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitState {
    /// Unix seconds.
    pub at: i64,
    /// `five_hour` | `weekly` | `unknown`.
    pub window: String,
    /// Unix seconds.
    pub next_retry_at: i64,
}

pub const SETTINGS_USAGE_URL: &str = "https://chatgpt.com/settings/usage";

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub local: LocalUsage,
    pub limit_reached: Option<LimitState>,
    pub settings_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectStatus {
    Preparing,
    Ready,
    Running,
    Paused,
    WaitingLimit,
    Done,
    Exported,
    Error,
}

impl ProjectStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            ProjectStatus::Preparing => "preparing",
            ProjectStatus::Ready => "ready",
            ProjectStatus::Running => "running",
            ProjectStatus::Paused => "paused",
            ProjectStatus::WaitingLimit => "waiting_limit",
            ProjectStatus::Done => "done",
            ProjectStatus::Exported => "exported",
            ProjectStatus::Error => "error",
        }
    }

    pub fn parse(value: &str) -> ProjectStatus {
        match value {
            "preparing" => ProjectStatus::Preparing,
            "running" => ProjectStatus::Running,
            "paused" => ProjectStatus::Paused,
            "waiting_limit" => ProjectStatus::WaitingLimit,
            "done" => ProjectStatus::Done,
            "exported" => ProjectStatus::Exported,
            "error" => ProjectStatus::Error,
            _ => ProjectStatus::Ready,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Scope {
    All,
    Range { from: u32, to: u32 },
}

impl Scope {
    pub fn contains(&self, chapter: u32) -> bool {
        match self {
            Scope::All => true,
            Scope::Range { from, to } => chapter >= *from && chapter <= *to,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_novel_id: Option<String>,
    pub status: ProjectStatus,
    pub chapters_total: u32,
    pub chapters_done: u32,
    pub chunks_total: u32,
    pub chunks_done: u32,
    pub percent: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetail {
    #[serde(flatten)]
    pub summary: ProjectSummary,
    pub model: String,
    pub effort: String,
    pub workers: u32,
    pub scope: Scope,
    pub words_total: u64,
    pub words_done: u64,
    pub needs_review: u32,
    pub errors: u32,
    pub pending: u32,
    pub chapters_in_progress: Vec<String>,
    pub chunks_per_minute: Option<f64>,
    pub eta_seconds: Option<f64>,
    /// Next automatic retry while `waiting_limit` (unix seconds).
    pub resume_at: Option<i64>,
    pub glossary_status: String,
    /// Glossary entries at or above this confidence are auto-approved: hidden from the
    /// review list but still used. Lower ones are shown for review. All entries are used.
    pub glossary_hide_at: u8,
    /// Unix seconds of the last preview export (partial book).
    pub last_preview_at: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryEntry {
    pub term: String,
    pub kind: String,
    pub target: Option<String>,
    pub count: u64,
    pub source: String,
    pub missed: u64,
    /// 0–100. Manual entries are always 100; automatic ones are scored from the
    /// extraction signals (see `glossary::confidence`).
    #[serde(default = "full_confidence")]
    pub confidence: u8,
}

fn full_confidence() -> u8 {
    100
}

/// AI suggestion for one glossary term.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GlossarySuggestion {
    pub term: String,
    pub kind: String,
    pub target: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PilotSample {
    pub model: String,
    pub label: String,
    pub seconds: f64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    /// Credits spent by this sample (per-model table).
    pub credits: f64,
    pub projected_book_tokens: f64,
    pub projected_book_credits: f64,
    pub valid: bool,
    pub html: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PilotRun {
    /// Unix seconds.
    pub created_at: i64,
    pub source_html: String,
    pub words: u64,
    pub samples: Vec<PilotSample>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyChapter {
    pub index: u32,
    pub title: String,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyReport {
    pub ok: bool,
    pub chapters: Vec<VerifyChapter>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEvent {
    /// Unix seconds.
    pub at: i64,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterView {
    pub index: u32,
    pub title: String,
    pub source_html: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub translated_html: Option<String>,
    pub status: String,
    pub issues: Vec<String>,
    /// The chapter split in its chunks, with paragraph pairs for the review reader.
    pub chunks: Vec<ChunkView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkView {
    pub index: u32,
    pub status: String,
    pub reviewed: bool,
    /// Issue codes of this chunk (`"code"` or `"code: detail"`).
    pub issues: Vec<String>,
    /// English words left in the translation (to highlight).
    pub english_words: Vec<String>,
    /// Source/translation paragraphs aligned by position (None when one side is shorter).
    pub pairs: Vec<ParagraphPair>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphPair {
    pub source: Option<String>,
    pub translated: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    pub logged_in: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub output_dir: String,
    pub title: String,
}

// ---------------------------------------------------------------------------
// Host: what the engine needs from Tauri (events, library metadata, asset scope)
// ---------------------------------------------------------------------------

pub trait Host: Send + Sync {
    fn emit(&self, event: &str, payload: Value);
    /// Called after a PT-BR book is committed, with the library-meta keys whose `hidden` flag must reset.
    fn library_committed(&self, _keys: &[String]) {}
    /// Allows a cover file in the asset protocol scope.
    fn allow_asset(&self, _path: &Path) {}
    /// Opens a URL in the user's browser (login).
    fn open_url(&self, _url: &str) -> Result<(), String> {
        Err("Sem navegador disponível".into())
    }
}

pub mod events {
    pub const USAGE: &str = "translation://usage";
    pub const PROJECT: &str = "translation://project";
    pub const LOG: &str = "translation://log";
    pub const PILOT: &str = "translation://pilot";
    pub const GLOSSARY: &str = "translation://glossary";
    pub const ACCOUNT: &str = "translation://account";
    pub const EXPORTED: &str = "translation://exported";
}

pub const DEFAULT_MODEL: &str = "gpt-6-luna";
pub const QUALITY_MODEL: &str = "gpt-6-sol";
pub const PILOT_MODELS: [(&str, &str); 2] = [(DEFAULT_MODEL, "Rápido"), (QUALITY_MODEL, "Qualidade")];

#[derive(Debug, Clone)]
pub struct EngineConfig {
    pub chunk_words: usize,
    /// Wait between automatic retries after a usage-limit error (15 min).
    pub limit_retry_secs: i64,
    /// Minimum interval between `translation://project` events per project.
    pub project_event_interval: Duration,
    /// How long the runner waits for a running glossary extraction before starting.
    pub glossary_wait: Duration,
    pub pilot_words: usize,
}

impl Default for EngineConfig {
    fn default() -> Self {
        EngineConfig {
            chunk_words: pipeline::CHUNK_WORDS,
            limit_retry_secs: 15 * 60,
            project_event_interval: Duration::from_millis(500),
            glossary_wait: Duration::from_secs(300),
            pilot_words: 1500,
        }
    }
}

pub(crate) struct ThrottleState {
    last: Option<Instant>,
    pending: bool,
}

pub struct Engine {
    pub store: Store,
    pub provider: Arc<dyn ChatProvider>,
    /// The real login provider (absent in tests).
    pub siwc: Option<Arc<SiwcProvider>>,
    pub host: Arc<dyn Host>,
    pub config: EngineConfig,
    pub(crate) runners: Mutex<HashMap<String, runner::RunnerHandle>>,
    pub(crate) limit: Mutex<Option<LimitState>>,
    pub(crate) throttle: Mutex<HashMap<String, ThrottleState>>,
    pub(crate) glossary_jobs: Mutex<HashSet<String>>,
    pub(crate) pilot_jobs: Mutex<HashSet<String>>,
    pub(crate) background_started: AtomicBool,
}

impl Engine {
    #[cfg(test)]
    pub fn new(store: Store, provider: Arc<dyn ChatProvider>, host: Arc<dyn Host>, config: EngineConfig) -> Arc<Engine> {
        Self::with_login(store, provider, None, host, config)
    }

    pub fn with_login(
        store: Store,
        provider: Arc<dyn ChatProvider>,
        siwc: Option<Arc<SiwcProvider>>,
        host: Arc<dyn Host>,
        config: EngineConfig,
    ) -> Arc<Engine> {
        let limit = store
            .meta_get(LIMIT_META_KEY)
            .ok()
            .flatten()
            .and_then(|json| serde_json::from_str(&json).ok());
        Arc::new(Engine {
            store,
            provider,
            siwc,
            host,
            config,
            runners: Mutex::new(HashMap::new()),
            limit: Mutex::new(limit),
            throttle: Mutex::new(HashMap::new()),
            glossary_jobs: Mutex::new(HashSet::new()),
            pilot_jobs: Mutex::new(HashSet::new()),
            background_started: AtomicBool::new(false),
        })
    }

    pub fn emit(&self, event: &str, payload: impl Serialize) {
        if let Ok(value) = serde_json::to_value(payload) {
            self.host.emit(event, value);
        }
    }

    /// Logs into the project's event table and emits `translation://log`.
    pub fn log(&self, project_id: &str, level: &str, message: impl Into<String>) {
        let message = message.into();
        match self.store.log(project_id, level, &message) {
            Ok(event) => self.emit(
                events::LOG,
                serde_json::json!({ "projectId": project_id, "event": event }),
            ),
            Err(err) => eprintln!("translation log failed: {err}"),
        }
    }

    pub fn limit_state(&self) -> Option<LimitState> {
        self.limit.lock_safe().clone()
    }

    fn store_limit(&self, state: Option<LimitState>) {
        let json = state.as_ref().and_then(|s| serde_json::to_string(s).ok()).unwrap_or_default();
        let _ = self.store.meta_set(LIMIT_META_KEY, &json);
        {
            let mut limit = self.limit.lock_safe();
            *limit = state;
        }
        self.emit_usage();
    }

    /// Records a usage-limit hit; returns the next retry time.
    pub fn set_limit(&self, message: &str) -> LimitState {
        let now = now_secs();
        let state = LimitState {
            at: now,
            window: limit_window(message).to_string(),
            next_retry_at: now + self.config.limit_retry_secs,
        };
        self.store_limit(Some(state.clone()));
        state
    }

    /// First success after a limit: clears the banner.
    pub fn clear_limit(&self) {
        if self.limit_state().is_some() {
            self.store_limit(None);
        }
    }

    /// Local counters + the limit state.
    pub fn usage_snapshot(&self) -> UsageSnapshot {
        UsageSnapshot {
            local: self.store.local_usage().unwrap_or_default(),
            limit_reached: self.limit_state(),
            settings_url: SETTINGS_USAGE_URL.to_string(),
        }
    }

    pub fn emit_usage(&self) {
        self.emit(events::USAGE, self.usage_snapshot());
    }

    pub fn summary(&self, project_id: &str) -> Result<ProjectSummary, String> {
        Ok(self.detail(project_id)?.summary)
    }

    pub fn detail(&self, project_id: &str) -> Result<ProjectDetail, String> {
        let active = self.active_chapter_titles(project_id);
        let mut detail = self.store.project_detail(project_id, active)?;
        detail.summary.cover_url = cover_url(detail.summary.cover_url.as_deref(), self.host.as_ref());
        Ok(detail)
    }

    pub fn list(&self) -> Result<Vec<ProjectSummary>, String> {
        let ids = self.store.project_ids()?;
        ids.iter().map(|id| self.summary(id)).collect()
    }

    fn active_chapter_titles(&self, project_id: &str) -> Option<Vec<String>> {
        let runners = self.runners.lock_safe();
        let handle = runners.get(project_id)?;
        let active: BTreeSet<u32> = handle.active.lock_safe().clone();
        Some(
            active
                .into_iter()
                .filter_map(|index| self.store.chapter_title(project_id, index).ok())
                .collect(),
        )
    }

    /// Emits `translation://project`, at most once per `project_event_interval`;
    /// throttled calls schedule one trailing emit. `force` bypasses the throttle.
    pub fn emit_project(self: &Arc<Self>, project_id: &str, force: bool) {
        let interval = self.config.project_event_interval;
        let wait = {
            let mut map = self.throttle.lock_safe();
            let state = map
                .entry(project_id.to_string())
                .or_insert(ThrottleState { last: None, pending: false });
            let now = Instant::now();
            match state.last {
                Some(last) if !force && now.duration_since(last) < interval => {
                    if state.pending {
                        return;
                    }
                    state.pending = true;
                    Some(interval - now.duration_since(last))
                }
                _ => {
                    state.last = Some(now);
                    None
                }
            }
        };
        match wait {
            None => self.emit_project_now(project_id),
            Some(delay) => {
                let engine = Arc::clone(self);
                let id = project_id.to_string();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(delay).await;
                    {
                    let mut map = engine.throttle.lock_safe();
                        if let Some(state) = map.get_mut(&id) {
                            state.pending = false;
                            state.last = Some(Instant::now());
                        }
                    }
                    engine.emit_project_now(&id);
                });
            }
        }
    }

    fn emit_project_now(&self, project_id: &str) {
        if let Ok(detail) = self.detail(project_id) {
            self.emit(events::PROJECT, &detail);
        }
    }

    /// Startup recovery: `running` projects become `paused` (done chunks are kept);
    /// `waiting_limit` projects re-arm their automatic resume; interrupted
    /// glossary/pilot jobs are marked as errors.
    pub fn recover(self: &Arc<Self>) -> Result<(), String> {
        for id in self.store.project_ids()? {
            let row = self.store.project(&id)?;
            match row.status {
                ProjectStatus::Running | ProjectStatus::Preparing => {
                    self.store.set_status(&id, ProjectStatus::Paused)?;
                    self.log(&id, "info", "App reiniciado: tradução pausada. Clique em Retomar para continuar.");
                }
                ProjectStatus::WaitingLimit => {
                    self.log(&id, "info", "App reiniciado: aguardando o limite para retomar.");
                    self.start(&id)?;
                }
                _ => {}
            }
            if row.glossary_status == "running" {
                self.store.set_glossary_status(&id, "error")?;
            }
            if let Ok(Some(mut run)) = self.store.pilot(&id) {
                if run.status == "running" {
                    run.status = "error".into();
                    run.error = Some("Interrompido pelo fechamento do app".into());
                    self.store.save_pilot(&id, &run)?;
                }
            }
        }
        Ok(())
    }

    /// Starts the 60 s usage ticker once (counters roll even when idle; only while logged in).
    pub fn start_background(self: &Arc<Self>) {
        if self.background_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let engine = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(60)).await;
                if engine.provider.account().logged_in {
                    engine.emit_usage();
                }
            }
        });
    }

    pub fn account_status(&self) -> AccountStatus {
        let account = self.provider.account();
        AccountStatus { logged_in: account.logged_in, email: account.email, plan_type: account.plan_type }
    }

    fn emit_account(&self, error: Option<String>) {
        let account = self.provider.account();
        let mut payload = serde_json::json!({ "loggedIn": account.logged_in });
        if let Some(email) = account.email {
            payload["email"] = Value::String(email);
        }
        if let Some(plan) = account.plan_type {
            payload["planType"] = Value::String(plan);
        }
        if let Some(error) = error {
            payload["error"] = Value::String(error);
        }
        self.host.emit(events::ACCOUNT, payload);
    }

    /// Runs the PKCE login: binds the loopback listener, opens the browser and
    /// returns; the callback is awaited in the background and reported through
    /// `translation://account`.
    pub async fn login(self: &Arc<Self>) -> Result<(), String> {
        let siwc = self.siwc.clone().ok_or("Login indisponível")?;
        let pending = siwc.begin_login().await.map_err(|err| err.to_string())?;
        if let Err(err) = self.host.open_url(&pending.auth_url) {
            siwc.cancel_login();
            return Err(format!("Não foi possível abrir o navegador: {err}"));
        }
        let engine = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            match siwc.finish_login(pending).await {
                Ok(_) => {
                    engine.emit_account(None);
                    engine.emit_usage();
                }
                Err(provider::ProviderError::Cancelled) => engine.emit_account(Some("Login cancelado".into())),
                Err(err) => engine.emit_account(Some(err.to_string())),
            }
        });
        Ok(())
    }

    pub fn login_cancel(&self) {
        if let Some(siwc) = &self.siwc {
            siwc.cancel_login();
        }
    }

    pub fn logout(&self) -> Result<(), String> {
        if let Some(siwc) = &self.siwc {
            siwc.logout()?;
        }
        self.emit_account(None);
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Tauri wiring
// ---------------------------------------------------------------------------

struct TauriHost(tauri::AppHandle);

impl Host for TauriHost {
    fn emit(&self, event: &str, payload: Value) {
        use tauri::Emitter;
        let _ = self.0.emit(event, payload);
    }

    fn library_committed(&self, keys: &[String]) {
        if let Err(err) = crate::library_meta::reset_hidden(&self.0, keys) {
            eprintln!("Warning: could not reset hidden flag for translated book: {err}");
        }
    }

    fn allow_asset(&self, path: &Path) {
        use tauri::Manager;
        let _ = self.0.asset_protocol_scope().allow_file(path);
    }

    fn open_url(&self, url: &str) -> Result<(), String> {
        use tauri_plugin_opener::OpenerExt;
        self.0.opener().open_url(url, None::<&str>).map_err(|err| err.to_string())
    }
}

/// Opens `app_data_dir/translation.db`, registers the engine as Tauri state and
/// runs startup recovery. Called from `lib.rs` setup.
pub fn init(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Não foi possível localizar dados do app: {err}"))?;
    std::fs::create_dir_all(&dir).map_err(|err| format!("Não foi possível criar dados do app: {err}"))?;
    let store = Store::open(&dir.join("translation.db"))?;
    let tokens = siwc::FileTokenStore(dir.join("chatgpt-tokens.json"));
    let siwc = Arc::new(SiwcProvider::new(Box::new(tokens), Some(dir.join("chatgpt-client.json"))));
    let provider: Arc<dyn ChatProvider> = siwc.clone();
    let engine = Engine::with_login(
        store,
        provider,
        Some(siwc),
        Arc::new(TauriHost(app.clone())),
        EngineConfig::default(),
    );
    app.manage(Arc::clone(&engine));
    if let Err(err) = engine.recover() {
        eprintln!("translation recovery failed: {err}");
    }
    engine.start_background();
    Ok(())
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const LIMIT_META_KEY: &str = "limit_state";

/// `five_hour` / `weekly` / `unknown` from the limit error text.
pub fn limit_window(message: &str) -> &'static str {
    let lower = message.to_lowercase();
    if ["five-hour", "five_hour", "five hour", "5-hour", "5 hour", "5h"].iter().any(|k| lower.contains(k)) {
        "five_hour"
    } else if lower.contains("weekly") || lower.contains("week") {
        "weekly"
    } else {
        "unknown"
    }
}

pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn now_f64() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

/// `YYYY-MM-DDTHH:MM:SS.000Z` for a unix timestamp (UTC), like `Date.toISOString()`.
pub fn iso_utc(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.000Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Same URL `convertFileSrc` builds for the asset protocol.
pub fn asset_url(path: &Path) -> String {
    let raw = path.to_string_lossy();
    let mut encoded = String::new();
    for byte in raw.as_bytes() {
        let ch = *byte as char;
        if ch.is_ascii_alphanumeric() || "-_.!~*'()".contains(ch) {
            encoded.push(ch);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    if cfg!(windows) {
        format!("http://asset.localhost/{encoded}")
    } else {
        format!("asset://localhost/{encoded}")
    }
}

pub(crate) fn cover_url(path: Option<&str>, host: &dyn Host) -> Option<String> {
    let path = PathBuf::from(path?);
    if !path.is_file() {
        return None;
    }
    host.allow_asset(&path);
    Some(asset_url(&path))
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;

    #[derive(Default)]
    pub struct RecordingHost {
        pub events: Mutex<Vec<(String, Value)>>,
        pub committed: Mutex<Vec<Vec<String>>>,
    }

    impl RecordingHost {
        pub fn count(&self, event: &str) -> usize {
            self.events.lock().unwrap().iter().filter(|(name, _)| name == event).count()
        }

        pub fn last(&self, event: &str) -> Option<Value> {
            self.events
                .lock()
                .unwrap()
                .iter()
                .rev()
                .find(|(name, _)| name == event)
                .map(|(_, value)| value.clone())
        }
    }

    impl Host for RecordingHost {
        fn emit(&self, event: &str, payload: Value) {
            self.events.lock().unwrap().push((event.to_string(), payload));
        }

        fn library_committed(&self, keys: &[String]) {
            self.committed.lock().unwrap().push(keys.to_vec());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_and_asset_url() {
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_utc(1_790_000_000), "2026-09-21T14:13:20.000Z");
        let url = asset_url(Path::new("/a b/cover.jpg"));
        if !cfg!(windows) {
            assert_eq!(url, "asset://localhost/%2Fa%20b%2Fcover.jpg");
        }
    }

    #[test]
    fn scope_and_status_serialize_like_the_contract() {
        assert_eq!(serde_json::to_value(Scope::All).unwrap(), serde_json::json!({"kind":"all"}));
        assert_eq!(
            serde_json::to_value(Scope::Range { from: 2, to: 5 }).unwrap(),
            serde_json::json!({"kind":"range","from":2,"to":5})
        );
        let parsed: Scope = serde_json::from_value(serde_json::json!({"kind":"range","from":1,"to":3})).unwrap();
        assert_eq!(parsed, Scope::Range { from: 1, to: 3 });
        assert_eq!(serde_json::to_value(ProjectStatus::WaitingLimit).unwrap(), "waiting_limit");
    }

    #[test]
    fn usage_snapshot_matches_the_contract() {
        assert_eq!(limit_window("You hit your five-hour limit"), "five_hour");
        assert_eq!(limit_window("weekly usage limit reached"), "weekly");
        assert_eq!(limit_window("subscription_sharing_usage_limit_exceeded"), "unknown");
        let snapshot = UsageSnapshot {
            local: LocalUsage { words_5h: 10, credits_5h: 0.5, words_7d: 20, credits_7d: 1.0 },
            limit_reached: Some(LimitState { at: 1, window: "weekly".into(), next_retry_at: 901 }),
            settings_url: SETTINGS_USAGE_URL.into(),
        };
        assert_eq!(
            serde_json::to_value(&snapshot).unwrap(),
            serde_json::json!({
                "local": {"words5h": 10, "credits5h": 0.5, "words7d": 20, "credits7d": 1.0},
                "limitReached": {"at": 1, "window": "weekly", "nextRetryAt": 901},
                "settingsUrl": "https://chatgpt.com/settings/usage"
            })
        );
    }
}
