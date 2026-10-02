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
    source_dir: String,
    source_novel_id: Option<String>,
    title: String,
    cover_path: Option<String>,
) -> Result<ProjectSummary, String> {
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
    glossary_min_confidence: Option<u8>,
) -> Result<ProjectDetail, String> {
    let engine = engine(&state);
    if let Some(value) = glossary_min_confidence {
        engine.store.set_glossary_min_confidence(&project_id, value.min(100))?;
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
pub async fn translation_verify(state: EngineState<'_>, project_id: String) -> Result<VerifyReport, String> {
    blocking(engine(&state), move |engine| engine.verify(&project_id)).await
}

/// Builds the PT-BR book now (it also runs automatically when everything is done).
#[tauri::command]
pub async fn translation_export(state: EngineState<'_>, project_id: String) -> Result<ExportResult, String> {
    blocking(engine(&state), move |engine| engine.export_project(&project_id)).await
}

#[tauri::command]
pub async fn translation_log(
    state: EngineState<'_>,
    project_id: String,
    limit: Option<u32>,
) -> Result<Vec<LogEvent>, String> {
    state.store.events(&project_id, limit.unwrap_or(200).clamp(1, 2000))
}
