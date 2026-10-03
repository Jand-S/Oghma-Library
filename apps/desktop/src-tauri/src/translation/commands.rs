//! Tauri commands of the translation contract (camelCase args, serde camelCase
//! results). The engine is Tauri managed state (`Arc<Engine>`, registered by
//! `translation::init`). Every command is async so SQLite/EPUB work never runs
//! on the main thread; the heavier ones go through `spawn_blocking`.

use std::sync::Arc;

use serde::Deserialize;
use tauri::State;

use super::{
    AccountStatus, ChapterView, Engine, ExportResult, GlossaryEntry, LogEvent, PilotRun, ProjectDetail,
    ProjectSummary, Scope, UsageSnapshot, VerifyReport, GlossarySuggestion,
};

type EngineState<'a> = State<'a, Arc<Engine>>;

fn engine(state: &EngineState<'_>) -> Arc<Engine> {
    Arc::clone(state.inner())
}

/// Runs blocking engine work off the async runtime threads.
async fn blocking<T: Send + 'static>(
    engine: Arc<Engine>,
    work: impl FnOnce(&Arc<Engine>) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || work(&engine))
        .await
        .map_err(|err| format!("Falha interna do tradutor: {err}"))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryInput {
    pub term: String,
    pub kind: String,
    #[serde(default)]
    pub target: Option<String>,
}

// -- account & usage -----------------------------------------------------------

#[tauri::command]
pub async fn translation_account(state: EngineState<'_>) -> Result<AccountStatus, String> {
    Ok(state.account_status())
}

/// Runs the PKCE login: opens the browser itself; completion arrives as `translation://account`.
#[tauri::command]
pub async fn translation_login(state: EngineState<'_>) -> Result<(), String> {
    engine(&state).login().await
}

#[tauri::command]
pub async fn translation_login_cancel(state: EngineState<'_>) -> Result<(), String> {
    state.login_cancel();
    Ok(())
}

#[tauri::command]
pub async fn translation_logout(state: EngineState<'_>) -> Result<(), String> {
    state.logout()
}

#[tauri::command]
pub async fn translation_usage(state: EngineState<'_>) -> Result<UsageSnapshot, String> {
    Ok(state.usage_snapshot())
}

// -- projects --------------------------------------------------------------------

#[tauri::command]
pub async fn translation_list_projects(state: EngineState<'_>) -> Result<Vec<ProjectSummary>, String> {
    blocking(engine(&state), |engine| engine.list()).await
}

#[tauri::command]
pub async fn translation_create_project(
    state: EngineState<'_>,
    root: tauri::State<'_, crate::export_root::ExportRoot>,
    source_dir: String,
    source_novel_id: Option<String>,
    title: String,
    cover_path: Option<String>,
) -> Result<ProjectSummary, String> {
    // The source book and its cover come from the output folder.
    root.require_inside(std::path::Path::new(&source_dir))?;
    if let Some(cover) = &cover_path {
        root.require_inside(std::path::Path::new(cover))?;
    }
    blocking(engine(&state), move |engine| {
        engine.create_project(&source_dir, source_novel_id, &title, cover_path)
    })
    .await
}

#[tauri::command]
pub async fn translation_delete_project(state: EngineState<'_>, project_id: String) -> Result<(), String> {
    state.delete_project(&project_id)
}

#[tauri::command]
pub async fn translation_get_project(state: EngineState<'_>, project_id: String) -> Result<ProjectDetail, String> {
    state.detail(&project_id)
}

#[tauri::command]
pub async fn translation_update_settings(
    state: EngineState<'_>,
    project_id: String,
    model: Option<String>,
    effort: Option<String>,
    workers: Option<u32>,
    scope: Option<Scope>,
    glossary_hide_at: Option<u8>,
) -> Result<ProjectDetail, String> {
    let engine = engine(&state);
    if let Some(value) = glossary_hide_at {
        engine.store.set_glossary_hide_at(&project_id, value.min(100))?;
    }
    engine.update_settings(&project_id, model, effort, workers, scope)
}

// -- runner ----------------------------------------------------------------------

#[tauri::command]
pub async fn translation_start(state: EngineState<'_>, project_id: String) -> Result<(), String> {
    engine(&state).start(&project_id)
}

#[tauri::command]
pub async fn translation_pause(state: EngineState<'_>, project_id: String) -> Result<(), String> {
    engine(&state).pause(&project_id)
}

#[tauri::command]
pub async fn translation_cancel(state: EngineState<'_>, project_id: String) -> Result<(), String> {
    engine(&state).cancel(&project_id)
}

// -- glossary --------------------------------------------------------------------

#[tauri::command]
pub async fn translation_glossary(state: EngineState<'_>, project_id: String) -> Result<Vec<GlossaryEntry>, String> {
    state.store.project(&project_id)?;
    state.store.glossary(&project_id)
}

#[tauri::command]
pub async fn translation_glossary_upsert(
    state: EngineState<'_>,
    project_id: String,
    entry: GlossaryInput,
) -> Result<Vec<GlossaryEntry>, String> {
    blocking(engine(&state), move |engine| {
        engine.glossary_upsert(&project_id, &entry.term, &entry.kind, entry.target)
    })
    .await
}

#[tauri::command]
pub async fn translation_glossary_delete(
    state: EngineState<'_>,
    project_id: String,
    term: String,
) -> Result<Vec<GlossaryEntry>, String> {
    state.store.glossary_delete(&project_id, &term)?;
    state.store.glossary(&project_id)
}

#[tauri::command]
pub async fn translation_glossary_suggest(
    state: EngineState<'_>,
    project_id: String,
    terms: Vec<String>,
) -> Result<Vec<GlossarySuggestion>, String> {
    engine(&state).glossary_suggest(&project_id, terms).await
}

/// Async: `translation://glossary` fires when the extraction finishes.
#[tauri::command]
pub async fn translation_glossary_regenerate(state: EngineState<'_>, project_id: String) -> Result<(), String> {
    state.store.project(&project_id)?;
    engine(&state).start_glossary(&project_id);
    Ok(())
}

// -- pilot -------------------------------------------------------------------------

/// Async: `translation://pilot` fires on each step.
#[tauri::command]
pub async fn translation_run_pilot(state: EngineState<'_>, project_id: String) -> Result<(), String> {
    engine(&state).start_pilot(&project_id)
}

#[tauri::command]
pub async fn translation_pilot(state: EngineState<'_>, project_id: String) -> Result<Option<PilotRun>, String> {
    state.store.pilot(&project_id)
}

#[tauri::command]
pub async fn translation_choose_model(
    state: EngineState<'_>,
    project_id: String,
    model: String,
) -> Result<ProjectDetail, String> {
    engine(&state).choose_model(&project_id, &model)
}

// -- chapters, QA, export, log -------------------------------------------------------

#[tauri::command]
pub async fn translation_chapter(
    state: EngineState<'_>,
    project_id: String,
    chapter_index: u32,
) -> Result<ChapterView, String> {
    blocking(engine(&state), move |engine| engine.chapter_view(&project_id, chapter_index)).await
}

#[tauri::command]
pub async fn translation_retranslate(
    state: EngineState<'_>,
    project_id: String,
    chapter_index: u32,
) -> Result<(), String> {
    engine(&state).retranslate(&project_id, chapter_index)
}

#[tauri::command]
pub async fn translation_retranslate_chunk(
    state: EngineState<'_>,
    project_id: String,
    chapter_index: u32,
    chunk_index: u32,
) -> Result<(), String> {
    engine(&state).retranslate_chunk(&project_id, chapter_index, chunk_index)
}

#[tauri::command]
pub async fn translation_mark_reviewed(
    state: EngineState<'_>,
    project_id: String,
    chapter_index: u32,
    chunk_index: u32,
) -> Result<ChapterView, String> {
    engine(&state).mark_chunk_reviewed(&project_id, chapter_index, chunk_index)
}

#[tauri::command]
pub async fn translation_verify(state: EngineState<'_>, project_id: String) -> Result<VerifyReport, String> {
    blocking(engine(&state), move |engine| engine.verify(&project_id)).await
}

/// Builds the PT-BR book now (it also runs automatically when everything is done).
#[tauri::command]
pub async fn translation_export(
    state: EngineState<'_>,
    project_id: String,
    partial: Option<bool>,
) -> Result<ExportResult, String> {
    engine(&state).export_book(&project_id, partial.unwrap_or(false)).await
}

#[tauri::command]
pub async fn translation_log(
    state: EngineState<'_>,
    project_id: String,
    limit: Option<u32>,
) -> Result<Vec<LogEvent>, String> {
    state.store.events(&project_id, limit.unwrap_or(200).clamp(1, 2000))
}

// -- smart filter (Buscar) ---------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartAnswer {
    text: String,
    input_tokens: i64,
    output_tokens: i64,
    credits: f64,
}

/// "Filtro inteligente" in Buscar: short questions to the user's own ChatGPT plan (the
/// translation login), on Luna. The first reads the request into JSON filters (no reasoning);
/// the second reads the candidates' synopses and keeps the ones that really share story
/// elements with the reference (`effort: "low"`). The usage goes to the same counters as the
/// translation.
#[tauri::command]
pub async fn smart_filter_ask(
    app: tauri::AppHandle,
    state: EngineState<'_>,
    instructions: String,
    text: String,
    effort: Option<String>,
) -> Result<SmartAnswer, String> {
    let engine = engine(&state);
    if !engine.provider.account().logged_in {
        return Err("not_logged_in".to_string());
    }
    let model = super::DEFAULT_MODEL;
    let effort = smart_filter_effort(effort.as_deref());
    let out = engine
        .provider
        .translate(model, effort, &instructions, &text)
        .await
        .map_err(|err| err.to_string())?;
    let credits = engine.store.log_usage(None, model, 0, &out.usage).unwrap_or(0.0);
    engine.emit_usage();
    log_smart_exchange(&app, effort, &text, &out.text, out.usage.input_tokens, out.usage.output_tokens);
    Ok(SmartAnswer {
        text: out.text,
        input_tokens: out.usage.input_tokens,
        output_tokens: out.usage.output_tokens,
        credits,
    })
}

/// Keeps the last smart filter exchanges in `app_data_dir/smart-filter.log` (JSON lines; the
/// request text and the model answer, never tokens) so a bad recommendation can be looked at
/// afterwards. Rotates to `.old` past 2 MB. Failures are ignored: it is only a diagnostic.
fn log_smart_exchange(app: &tauri::AppHandle, effort: &str, text: &str, answer: &str, input_tokens: i64, output_tokens: i64) {
    use std::io::Write;
    use tauri::Manager;
    let Ok(dir) = app.path().app_data_dir() else { return };
    let path = dir.join("smart-filter.log");
    if std::fs::metadata(&path).map(|meta| meta.len() > 2 * 1024 * 1024).unwrap_or(false) {
        let _ = std::fs::rename(&path, dir.join("smart-filter.log.old"));
    }
    let line = serde_json::json!({
        "at": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs())
            .unwrap_or(0),
        "effort": effort,
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "text": text,
        "answer": answer,
    });
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{line}");
    }
}

/// Only the efforts the Sign in with ChatGPT spike validated; anything else reads as "none".
fn smart_filter_effort(effort: Option<&str>) -> &'static str {
    match effort {
        Some("low") => "low",
        _ => "none",
    }
}
