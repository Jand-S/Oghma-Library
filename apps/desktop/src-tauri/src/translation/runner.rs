//! Project lifecycle and the runner: whole chapters in parallel (1-3 workers),
//! chunks in order inside a chapter, one runner per project, pause/cancel,
//! `waiting_limit` on the plan's usage limit with a retry every 15 min, and
//! resume from the db.

use std::collections::{BTreeSet, VecDeque};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::watch;

use super::glossary::check_misses;
use super::pipeline::{tail_text, translate_fragment, TAIL_CHARS};
use super::provider::ProviderError;
use super::source::{find_epub, read_epub, text_of};
use super::store::NewProject;
use super::{now_secs, ChapterView, Engine, ProjectDetail, ProjectStatus, ProjectSummary, Scope, DEFAULT_MODEL};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Signal {
    Run,
    Pause,
    Cancel,
}

pub(crate) struct RunnerHandle {
    pub signal: watch::Sender<Signal>,
    pub active: Arc<Mutex<BTreeSet<u32>>>,
}

#[derive(Debug, Clone)]
enum Outcome {
    Completed,
    Limit(String),
    Stopped(Signal),
    Fatal(String),
}

async fn wait_stop(rx: &mut watch::Receiver<Signal>) -> Signal {
    loop {
        let current = *rx.borrow();
        if current != Signal::Run {
            return current;
        }
        if rx.changed().await.is_err() {
            return Signal::Cancel;
        }
    }
}

impl Engine {
    // -- project lifecycle ----------------------------------------------------

    /// Reads the book's EPUB, stores chapters and chunks, and starts the glossary
    /// extraction in the background. A second call for the same folder returns the
    /// existing project.
    pub fn create_project(
        self: &Arc<Self>,
        source_dir: &str,
        source_novel_id: Option<String>,
        title: &str,
        cover_path: Option<String>,
    ) -> Result<ProjectSummary, String> {
        let dir = crate::paths::expand_home(source_dir);
        if let Some(existing) = self.store.find_by_source(&dir.to_string_lossy())? {
            return self.summary(&existing);
        }
        let epub = find_epub(&dir)?;
        let book = read_epub(&epub)?;
        let source_novel_id = source_novel_id
            .filter(|id| !id.trim().is_empty())
            .or_else(|| crate::files::read_manifest(&dir).and_then(|m| m.novel_id().map(str::to_string)));
        let cover_path = cover_path
            .filter(|p| Path::new(p).is_file())
            .or_else(|| crate::files::pick_cover(&dir).map(|p| p.to_string_lossy().to_string()));
        let id = self.store.create_project(
            &NewProject {
                title: title.trim().to_string(),
                source_dir: dir.to_string_lossy().to_string(),
                source_epub: epub.to_string_lossy().to_string(),
                source_novel_id,
                cover_path,
                model: DEFAULT_MODEL.to_string(),
                effort: "none".to_string(),
            },
            &book,
            self.config.chunk_words,
        )?;
        let detail = self.detail(&id)?;
        self.log(
            &id,
            "info",
            format!(
                "Projeto criado: {} capítulos, {} trechos, {} palavras.",
                detail.summary.chapters_total, detail.summary.chunks_total, detail.words_total
            ),
        );
        self.start_glossary(&id);
        self.emit_project(&id, true);
        Ok(detail.summary)
    }

    pub fn delete_project(&self, id: &str) -> Result<(), String> {
        if let Some(handle) = self.runners.lock().ok().and_then(|mut r| r.remove(id)) {
            let _ = handle.signal.send(Signal::Cancel);
        }
        self.store.delete_project(id)
    }

    pub fn update_settings(
        self: &Arc<Self>,
        id: &str,
        model: Option<String>,
        effort: Option<String>,
        workers: Option<u32>,
        scope: Option<Scope>,
    ) -> Result<ProjectDetail, String> {
        let effort = match effort.as_deref() {
            None => None,
            Some(e @ ("none" | "low")) => Some(e.to_string()),
            Some(other) => return Err(format!("Esforço inválido: {other}")),
        };
        let scope = match scope {
            Some(Scope::Range { from, to }) if from == 0 || from > to => {
                return Err("Intervalo de capítulos inválido".into())
            }
            other => other,
        };
        self.store.update_settings(
            id,
            model.as_deref().filter(|m| !m.trim().is_empty()),
            effort.as_deref(),
            workers.map(|w| w.clamp(1, 3)),
            scope.as_ref(),
        )?;
        let row = self.store.project(id)?;
        if scope.is_some() && matches!(row.status, ProjectStatus::Done | ProjectStatus::Exported) {
            let open = self.store.chapters_to_run(id, &row.scope)?;
            if !open.is_empty() {
                self.store.set_status(id, ProjectStatus::Ready)?;
            }
        }
        self.emit_project(id, true);
        self.detail(id)
    }

    pub fn chapter_view(&self, id: &str, chapter: u32) -> Result<ChapterView, String> {
        let title = self.store.chapter_title(id, chapter)?;
        let chunks = self.store.chunks(id, chapter)?;
        let source_html = chunks.iter().map(|c| c.src_html.as_str()).collect::<Vec<_>>().join("\n");
        let translated: Vec<&str> = chunks.iter().filter_map(|c| c.dst_html.as_deref()).collect();
        let status = chapter_status(chunks.iter().map(|c| c.status.as_str()));
        let issues = super::verify::chapter_issues(&chunks);
        Ok(ChapterView {
            index: chapter,
            title,
            source_html,
            translated_html: (!translated.is_empty()).then(|| translated.join("\n")),
            status,
            issues,
        })
    }

    /// Resets a chapter's chunks and runs it again (even outside the scope).
    pub fn retranslate(self: &Arc<Self>, id: &str, chapter: u32) -> Result<(), String> {
        self.store.chapter_title(id, chapter)?;
        self.store.reset_chapter(id, chapter)?;
        let title = self.store.chapter_title(id, chapter)?;
        self.log(id, "info", format!("Retraduzindo o capítulo {chapter}: {title}"));
        let running = self.is_running(id);
        if running {
            // The current run picks it up only if it already drained its queue; queue a new run after it.
            self.log(id, "info", "O capítulo entra na fila quando a rodada atual terminar.");
        } else {
            self.store.set_status(id, ProjectStatus::Ready)?;
        }
        self.emit_project(id, true);
        if !running {
            self.start(id)?;
        }
        Ok(())
    }

    // -- runner control -------------------------------------------------------

    pub fn is_running(&self, id: &str) -> bool {
        self.runners.lock().map(|r| r.contains_key(id)).unwrap_or(false)
    }

    pub fn start(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let row = self.store.project(id)?;
        if row.status == ProjectStatus::Exported && self.store.chapters_to_run(id, &row.scope)?.is_empty() {
            // Nothing left to translate; `translation_export` rebuilds the book on demand.
            self.emit_project(id, true);
            return Ok(());
        }
        let (rx, active) = {
            let mut runners = self.runners.lock().map_err(|_| "Estado do tradutor indisponível")?;
            if runners.contains_key(id) {
                return Ok(());
            }
            let (tx, rx) = watch::channel(Signal::Run);
            let active = Arc::new(Mutex::new(BTreeSet::new()));
            runners.insert(id.to_string(), RunnerHandle { signal: tx, active: Arc::clone(&active) });
            (rx, active)
        };
        self.start_background();
        let engine = Arc::clone(self);
        let id = id.to_string();
        tauri::async_runtime::spawn(async move {
            let mut rx = rx;
            engine.run_project(&id, &mut rx, &active).await;
            if let Ok(mut runners) = engine.runners.lock() {
                runners.remove(&id);
            }
            engine.emit_project(&id, true);
        });
        Ok(())
    }

    pub fn pause(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let sent = self
            .runners
            .lock()
            .ok()
            .and_then(|r| r.get(id).map(|h| h.signal.send(Signal::Pause).is_ok()))
            .unwrap_or(false);
        if !sent {
            let row = self.store.project(id)?;
            if matches!(row.status, ProjectStatus::Running | ProjectStatus::WaitingLimit) {
                self.store.set_status(id, ProjectStatus::Paused)?;
                self.store.set_resume_at(id, None)?;
            }
            self.emit_project(id, true);
        }
        Ok(())
    }

    pub fn cancel(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let sent = self
            .runners
            .lock()
            .ok()
            .and_then(|r| r.get(id).map(|h| h.signal.send(Signal::Cancel).is_ok()))
            .unwrap_or(false);
        if !sent {
            let row = self.store.project(id)?;
            if matches!(row.status, ProjectStatus::Running | ProjectStatus::WaitingLimit | ProjectStatus::Paused) {
                self.store.set_status(id, ProjectStatus::Ready)?;
                self.store.set_resume_at(id, None)?;
            }
            self.emit_project(id, true);
        }
        Ok(())
    }

    // -- the run --------------------------------------------------------------

    async fn run_project(self: &Arc<Self>, id: &str, rx: &mut watch::Receiver<Signal>, active: &Arc<Mutex<BTreeSet<u32>>>) {
        if !self.provider.account().logged_in {
            let _ = self.store.set_status(id, ProjectStatus::Error);
            self.log(id, "error", "Conecte o ChatGPT para traduzir.");
            return;
        }
        if !self.wait_for_glossary(id, rx).await {
            self.apply_stop(id, *rx.borrow());
            return;
        }
        let _ = self.store.start_session(id);
        let mut announced = false;

        loop {
            let Ok(row) = self.store.project(id) else { return };
            let _ = self.store.set_resume_at(id, None);
            let _ = self.store.set_status(id, ProjectStatus::Running);
            let chapters = match self.store.chapters_to_run(id, &row.scope) {
                Ok(chapters) => chapters,
                Err(err) => {
                    let _ = self.store.set_status(id, ProjectStatus::Error);
                    self.log(id, "error", err);
                    return;
                }
            };
            if !announced {
                self.log(
                    id,
                    "info",
                    format!(
                        "Iniciando: modelo {}, {} capítulo(s) na fila, {} tradução(ões) simultânea(s).",
                        row.model,
                        chapters.len(),
                        row.workers
                    ),
                );
                announced = true;
            }
            self.emit_project(id, true);
            if chapters.is_empty() {
                self.finish(id).await;
                return;
            }

            match self.run_workers(id, chapters, row.workers, rx, active).await {
                Outcome::Completed => {
                    self.finish(id).await;
                    return;
                }
                Outcome::Stopped(signal) => {
                    self.apply_stop(id, signal);
                    return;
                }
                Outcome::Fatal(message) => {
                    let _ = self.store.set_status(id, ProjectStatus::Error);
                    self.log(id, "error", message);
                    return;
                }
                Outcome::Limit(message) => {
                    // The next real chunk is the probe: it is retried every 15 min.
                    let state = self.set_limit(&message);
                    if !self.wait_limit(id, state.next_retry_at, &state.window, rx).await {
                        return;
                    }
                }
            }
        }
    }

    /// Waits while the glossary extraction runs (bounded); false when stopped.
    async fn wait_for_glossary(&self, id: &str, rx: &mut watch::Receiver<Signal>) -> bool {
        let deadline = tokio::time::Instant::now() + self.config.glossary_wait;
        let mut logged = false;
        loop {
            let running = self.glossary_jobs.lock().map(|jobs| jobs.contains(id)).unwrap_or(false);
            if !running || tokio::time::Instant::now() >= deadline {
                return true;
            }
            if !logged {
                self.log(id, "info", "Aguardando o glossário automático terminar…");
                logged = true;
            }
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(250)) => {}
                _ = wait_stop(rx) => return false,
            }
        }
    }

    /// `waiting_limit` until `until` (unix sec); false when paused/cancelled meanwhile.
    async fn wait_limit(self: &Arc<Self>, id: &str, until: i64, window: &str, rx: &mut watch::Receiver<Signal>) -> bool {
        let _ = self.store.set_status(id, ProjectStatus::WaitingLimit);
        let _ = self.store.set_resume_at(id, Some(until));
        let minutes = ((until - now_secs()).max(0) + 59) / 60;
        let label = match window {
            "five_hour" => "janela de 5h",
            "weekly" => "semanal",
            _ => "plano ou limite do app",
        };
        self.log(
            id,
            "warn",
            format!("Limite do ChatGPT atingido ({label}). Tentando de novo em ~{minutes} min."),
        );
        self.emit_project(id, true);
        let delay = Duration::from_secs((until - now_secs()).max(0) as u64);
        tokio::select! {
            _ = tokio::time::sleep(delay) => {
                self.log(id, "info", "Tentando de novo após o limite…");
                true
            }
            signal = wait_stop(rx) => {
                self.apply_stop(id, signal);
                false
            }
        }
    }

    fn apply_stop(&self, id: &str, signal: Signal) {
        let _ = self.store.set_resume_at(id, None);
        match signal {
            Signal::Cancel => {
                let _ = self.store.set_status(id, ProjectStatus::Ready);
                self.log(id, "info", "Tradução cancelada. O que já foi traduzido fica salvo.");
            }
            _ => {
                let _ = self.store.set_status(id, ProjectStatus::Paused);
                self.log(id, "info", "Tradução pausada.");
            }
        }
    }

    /// End of a run: everything done -> `done` + automatic export; errors -> `error`.
    async fn finish(self: &Arc<Self>, id: &str) {
        let Ok(detail) = self.detail(id) else { return };
        let row = match self.store.project(id) {
            Ok(row) => row,
            Err(_) => return,
        };
        let open = self.store.chapters_to_run(id, &row.scope).unwrap_or_default();
        if detail.errors > 0 || !open.is_empty() {
            let _ = self.store.set_status(id, ProjectStatus::Error);
            self.log(
                id,
                "error",
                format!("{} trecho(s) falharam. Clique em Retomar para tentar de novo.", detail.errors.max(1)),
            );
            return;
        }
        let _ = self.store.set_status(id, ProjectStatus::Done);
        self.log(
            id,
            "info",
            format!(
                "Tradução concluída: {} trechos ({} para revisar). Gerando o livro PT-BR…",
                detail.summary.chunks_done, detail.needs_review
            ),
        );
        self.emit_project(id, true);
        let engine = Arc::clone(self);
        let project = id.to_string();
        let result = tauri::async_runtime::spawn_blocking(move || engine.export_project(&project)).await;
        // `export_project` logs its own failures.
        if let Err(err) = result {
            self.log(id, "error", format!("Falha ao gerar o livro PT-BR: {err}"));
        }
    }

    async fn run_workers(
        self: &Arc<Self>,
        id: &str,
        chapters: Vec<u32>,
        workers: u32,
        rx: &watch::Receiver<Signal>,
        active: &Arc<Mutex<BTreeSet<u32>>>,
    ) -> Outcome {
        let workers = (workers.clamp(1, 3) as usize).min(chapters.len()).max(1);
        let queue = Arc::new(Mutex::new(chapters.into_iter().collect::<VecDeque<u32>>()));
        let stop: Arc<Mutex<Option<Outcome>>> = Arc::new(Mutex::new(None));
        let mut handles = Vec::new();
        for _ in 0..workers {
            let engine = Arc::clone(self);
            let id = id.to_string();
            let queue = Arc::clone(&queue);
            let stop = Arc::clone(&stop);
            let active = Arc::clone(active);
            let mut rx = rx.clone();
            handles.push(tauri::async_runtime::spawn(async move {
                loop {
                    if stop.lock().map(|s| s.is_some()).unwrap_or(true) || *rx.borrow() != Signal::Run {
                        break;
                    }
                    let Some(chapter) = queue.lock().ok().and_then(|mut q| q.pop_front()) else { break };
                    if let Ok(mut set) = active.lock() {
                        set.insert(chapter);
                    }
                    engine.emit_project(&id, false);
                    let result = engine.translate_chapter(&id, chapter, &mut rx, &stop).await;
                    if let Ok(mut set) = active.lock() {
                        set.remove(&chapter);
                    }
                    if let Err(outcome) = result {
                        if let Ok(mut slot) = stop.lock() {
                            slot.get_or_insert(outcome);
                        }
                        break;
                    }
                }
            }));
        }
        for handle in handles {
            let _ = handle.await;
        }
        if let Some(outcome) = stop.lock().ok().and_then(|mut s| s.take()) {
            return outcome;
        }
        match *rx.borrow() {
            Signal::Run => Outcome::Completed,
            signal => Outcome::Stopped(signal),
        }
    }

    async fn translate_chapter(
        self: &Arc<Self>,
        id: &str,
        chapter: u32,
        rx: &mut watch::Receiver<Signal>,
        stop: &Arc<Mutex<Option<Outcome>>>,
    ) -> Result<(), Outcome> {
        let chunks = self.store.chunks(id, chapter).map_err(Outcome::Fatal)?;
        let title = self.store.chapter_title(id, chapter).unwrap_or_default();
        let mut prev_tail = String::new();
        for chunk in &chunks {
            if chunk.is_translated() {
                prev_tail = tail_text(chunk.dst_html.as_deref().unwrap_or(""), TAIL_CHARS);
                continue;
            }
            if stop.lock().map(|s| s.is_some()).unwrap_or(true) {
                return Ok(());
            }
            let signal = *rx.borrow();
            if signal != Signal::Run {
                return Err(Outcome::Stopped(signal));
            }
            let row = self.store.project(id).map_err(Outcome::Fatal)?;
            if text_of(&chunk.src_html).is_empty() {
                // Images/separators only: nothing to translate.
                let _ = self.store.save_chunk(chunk.id, &chunk.src_html, "done", None, &row.model, 0, 0);
                continue;
            }
            let glossary = self.store.glossary(id).unwrap_or_default();
            let translation =
                translate_fragment(self.provider.as_ref(), &row.model, &row.effort, &chunk.src_html, &glossary, &prev_tail);
            let result = tokio::select! {
                result = translation => result,
                signal = wait_stop(rx) => return Err(Outcome::Stopped(signal)),
            };
            match result {
                Ok(fragment) => {
                    let status = if fragment.note.is_some() { "needs_review" } else { "done" };
                    self.store
                        .save_chunk(
                            chunk.id,
                            &fragment.html,
                            status,
                            fragment.note.as_deref(),
                            &row.model,
                            fragment.usage.input_tokens,
                            fragment.usage.output_tokens,
                        )
                        .map_err(Outcome::Fatal)?;
                    let _ = self.store.log_usage(Some(id), &row.model, chunk.src_words, &fragment.usage);
                    if let Some(note) = &fragment.note {
                        self.log(id, "warn", format!("Cap. {chapter} ({title}), trecho {}: {note}", chunk.index + 1));
                    }
                    let misses = check_misses(&glossary, &chunk.src_html, &fragment.html);
                    if !misses.is_empty() {
                        let terms: Vec<String> = misses.iter().map(|(term, _)| term.clone()).collect();
                        let _ = self.store.glossary_add_missed(id, &terms);
                        let listed: Vec<String> = misses.iter().map(|(t, p)| format!("{t} → {p}")).collect();
                        self.log(
                            id,
                            "warn",
                            format!("Glossário não aplicado no cap. {chapter}, trecho {}: {}", chunk.index + 1, listed.join(", ")),
                        );
                    }
                    prev_tail = tail_text(&fragment.html, TAIL_CHARS);
                    self.clear_limit();
                    self.emit_usage();
                    self.emit_project(id, false);
                }
                Err(ProviderError::UsageLimit(message)) => return Err(Outcome::Limit(message)),
                Err(ProviderError::NotLoggedIn(message)) => {
                    return Err(Outcome::Fatal(format!("Conecte o ChatGPT novamente: {message}")));
                }
                Err(ProviderError::Cancelled) => return Err(Outcome::Stopped(Signal::Cancel)),
                Err(err) => {
                    let _ = self.store.mark_chunk_error(chunk.id, &err.to_string());
                    self.log(id, "error", format!("Cap. {chapter}, trecho {} falhou: {err}", chunk.index + 1));
                    self.emit_project(id, false);
                }
            }
        }
        let finished = self
            .store
            .chunks(id, chapter)
            .map(|chunks| chunks.iter().all(|c| c.is_translated()))
            .unwrap_or(false);
        if finished {
            let _ = self.store.clear_forced(id, chapter);
            self.log(id, "info", format!("Capítulo {chapter} pronto: {title}"));
        }
        Ok(())
    }
}

/// `pending` | `running` (partly translated) | `done` | `needs_review` | `error` from chunk statuses.
pub fn chapter_status<'a>(statuses: impl Iterator<Item = &'a str>) -> String {
    let statuses: Vec<&str> = statuses.collect();
    if statuses.iter().any(|s| *s == "error") {
        "error"
    } else if statuses.iter().all(|s| *s == "pending") {
        "pending"
    } else if statuses.iter().any(|s| *s == "pending") {
        "running"
    } else if statuses.iter().any(|s| *s == "needs_review") {
        "needs_review"
    } else {
        "done"
    }
    .to_string()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::files::test_support::TempDir;
    use crate::translation::provider::fake::FakeProvider;
    use crate::translation::source::test_epub::write_app_epub;
    use crate::translation::store::Store;
    use crate::translation::test_support::RecordingHost;
    use crate::translation::{events, EngineConfig};

    pub struct Fixture {
        pub _root: TempDir,
        pub book_dir: std::path::PathBuf,
        pub engine: Arc<Engine>,
        pub provider: Arc<FakeProvider>,
        pub host: Arc<RecordingHost>,
    }

    /// A 3-chapter library book (`<root>/Livro/Livro.epub` + cover + manifest).
    pub fn fixture(chunk_words: usize) -> Fixture {
        let root = TempDir::new("translation");
        let book_dir = root.path().join("Livro");
        std::fs::create_dir_all(&book_dir).unwrap();
        let para = |n: usize, w: &str| vec![w; n].join(" ");
        write_app_epub(
            &book_dir.join("Livro.epub"),
            &[
                ("Chapter One", vec![para(30, "alpha"), para(30, "beta"), para(30, "gamma"), "See <img src=\"../assets/map.png\"/> here.".into()]),
                ("Chapter Two", vec![para(40, "delta"), para(40, "epsilon")]),
                ("Chapter Three", vec![para(20, "zeta")]),
            ],
            true,
        );
        std::fs::write(book_dir.join("cover.png"), b"\x89PNG cover").unwrap();
        std::fs::write(
            book_dir.join(crate::files::LOCAL_BOOK_MANIFEST),
            r#"{"novel_id":"cn:livro","title":"Livro"}"#,
        )
        .unwrap();
        let provider = FakeProvider::new();
        let host = Arc::new(RecordingHost::default());
        let config = EngineConfig {
            chunk_words,
            limit_retry_secs: 1,
            project_event_interval: Duration::from_millis(0),
            glossary_wait: Duration::from_secs(5),
            pilot_words: 60,
        };
        let engine = Engine::new(Store::open_in_memory().unwrap(), provider.clone(), host.clone(), config);
        Fixture { _root: root, book_dir, engine, provider, host }
    }

    pub async fn wait_until(mut check: impl FnMut() -> bool) {
        for _ in 0..400 {
            if check() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("condition not reached");
    }

    pub fn create(f: &Fixture) -> String {
        let summary = f
            .engine
            .create_project(&f.book_dir.to_string_lossy(), None, "Livro", None)
            .unwrap();
        summary.id
    }

    pub async fn glossary_settled(f: &Fixture, id: &str) {
        let engine = Arc::clone(&f.engine);
        let id = id.to_string();
        wait_until(move || !engine.glossary_jobs.lock().unwrap().contains(&id)).await;
    }

    #[test]
    fn runner_translates_everything_then_exports() {
        tauri::async_runtime::block_on(async {
            let f = fixture(70);
            let id = create(&f);
            let summary = f.engine.summary(&id).unwrap();
            assert_eq!(summary.status, ProjectStatus::Ready);
            assert_eq!(summary.chapters_total, 3);
            assert!(summary.cover_url.is_some());
            glossary_settled(&f, &id).await;

            f.engine.start(&id).unwrap();
            let engine = Arc::clone(&f.engine);
            let pid = id.clone();
            wait_until(move || engine.store.project(&pid).unwrap().status == ProjectStatus::Exported).await;

            let detail = f.engine.detail(&id).unwrap();
            assert_eq!(detail.summary.chunks_done, detail.summary.chunks_total);
            assert_eq!(detail.summary.percent, 100.0);
            assert_eq!(detail.summary.chapters_done, 3);
            assert_eq!(detail.pending, 0);
            assert!(detail.summary.output_dir.is_some());
            assert!(f.host.count(events::PROJECT) > 3);
            assert!(f.host.count(events::USAGE) >= 1);
            assert!(f.host.last(events::EXPORTED).is_some());
            let local = f.engine.store.local_usage().unwrap();
            assert!(local.words_5h > 0 && local.words_7d >= local.words_5h && local.credits_5h > 0.0);
            // Chapter one: h1 + 3 paragraphs over 70 words + image block (no text) -> chunks.
            let view = f.engine.chapter_view(&id, 1).unwrap();
            assert_eq!(view.status, "done");
            assert!(view.translated_html.unwrap().contains("termo"));
            assert!(view.issues.is_empty(), "{:?}", view.issues);
        });
    }

    #[test]
    fn pause_cancel_and_resume_from_db() {
        tauri::async_runtime::block_on(async {
            let f = fixture(35);
            let id = create(&f);
            glossary_settled(&f, &id).await;
            f.engine.update_settings(&id, None, None, Some(1), None).unwrap();
            *f.provider.delay.lock().unwrap() = Duration::from_millis(40);
            f.engine.start(&id).unwrap();
            let engine = Arc::clone(&f.engine);
            let pid = id.clone();
            wait_until(move || engine.detail(&pid).unwrap().summary.chunks_done >= 2).await;
            f.engine.pause(&id).unwrap();
            let engine = Arc::clone(&f.engine);
            let pid = id.clone();
            wait_until(move || !engine.is_running(&pid)).await;
            let paused = f.engine.detail(&id).unwrap();
            assert_eq!(paused.summary.status, ProjectStatus::Paused);
            let done_at_pause = paused.summary.chunks_done;
            assert!(done_at_pause >= 2 && done_at_pause < paused.summary.chunks_total);

            // Simulated app restart: a project left "running" becomes "paused", done chunks stay.
            f.engine.store.set_status(&id, ProjectStatus::Running).unwrap();
            f.engine.recover().unwrap();
            assert_eq!(f.engine.store.project(&id).unwrap().status, ProjectStatus::Paused);

            let calls_before = f.provider.call_count();
            f.engine.start(&id).unwrap();
            let engine = Arc::clone(&f.engine);
            let pid = id.clone();
            wait_until(move || engine.detail(&pid).unwrap().summary.chunks_done > done_at_pause).await;
            f.engine.cancel(&id).unwrap();
            let engine = Arc::clone(&f.engine);
            let pid = id.clone();
            wait_until(move || !engine.is_running(&pid)).await;
            assert_eq!(f.engine.store.project(&id).unwrap().status, ProjectStatus::Ready);

            *f.provider.delay.lock().unwrap() = Duration::ZERO;
            f.engine.start(&id).unwrap();
            let engine = Arc::clone(&f.engine);
            let pid = id.clone();
            wait_until(move || engine.store.project(&pid).unwrap().status == ProjectStatus::Exported).await;
            // Resumed from the db: each chunk was translated once (no duplicates beyond the aborted ones).
            let total = f.engine.detail(&id).unwrap().summary.chunks_total as usize;
            let translated_calls = f.provider.call_count();
            assert!(translated_calls >= total && translated_calls <= total + 2, "{translated_calls} calls for {total} chunks");
            assert!(calls_before >= done_at_pause as usize);
            let log = f.engine.store.events(&id, 100).unwrap();
            assert!(log.iter().any(|e| e.message.contains("pausada")));
            assert!(log.iter().any(|e| e.message.contains("cancelada")));
        });
    }

    #[test]
    fn usage_limit_waits_retries_and_clears() {
        tauri::async_runtime::block_on(async {
            let f = fixture(1000);
            let id = create(&f);
            glossary_settled(&f, &id).await;
            // Every request fails with the plan limit until `allow` flips.
            let allow = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let gate = Arc::clone(&allow);
            f.provider.set_responder(Box::new(move |_, _| {
                (!gate.load(std::sync::atomic::Ordering::SeqCst)).then(|| {
                    Err(ProviderError::UsageLimit("subscription_sharing_usage_limit_exceeded: five-hour limit".into()))
                })
            }));
            f.engine.start(&id).unwrap();
            let engine = Arc::clone(&f.engine);
            let pid = id.clone();
            wait_until(move || engine.store.project(&pid).unwrap().status == ProjectStatus::WaitingLimit).await;
            let detail = f.engine.detail(&id).unwrap();
            assert_eq!(detail.summary.chunks_done, 0, "the chunk stays pending");
            let limit = f.engine.usage_snapshot().limit_reached.expect("limit state");
            assert_eq!(limit.window, "five_hour");
            assert_eq!(detail.resume_at, Some(limit.next_retry_at));
            assert_eq!(f.host.last(events::USAGE).unwrap()["limitReached"]["window"], "five_hour");
            let log = f.engine.store.events(&id, 50).unwrap();
            assert!(log.iter().any(|e| e.level == "warn" && e.message.contains("Limite do ChatGPT atingido (janela de 5h)")));

            // Pausing while waiting.
            f.engine.pause(&id).unwrap();
            let engine = Arc::clone(&f.engine);
            let pid = id.clone();
            wait_until(move || !engine.is_running(&pid)).await;
            assert_eq!(f.engine.store.project(&id).unwrap().status, ProjectStatus::Paused);
            assert_eq!(f.engine.detail(&id).unwrap().resume_at, None);

            // Resume: still limited -> waits (1 s in tests), then the limit lifts.
            f.engine.start(&id).unwrap();
            let engine = Arc::clone(&f.engine);
            let pid = id.clone();
            wait_until(move || engine.store.project(&pid).unwrap().status == ProjectStatus::WaitingLimit).await;
            allow.store(true, std::sync::atomic::Ordering::SeqCst);
            let engine = Arc::clone(&f.engine);
            let pid = id.clone();
            wait_until(move || engine.store.project(&pid).unwrap().status == ProjectStatus::Exported).await;
            assert!(f.engine.usage_snapshot().limit_reached.is_none(), "cleared on the first success");
        });
    }

    #[test]
    fn errors_mark_chunks_and_retranslate_resets_a_chapter() {
        tauri::async_runtime::block_on(async {
            let f = fixture(1000);
            let id = create(&f);
            glossary_settled(&f, &id).await;
            f.provider.set_responder(Box::new(|_, prompt| {
                prompt.contains("zeta").then(|| Err(ProviderError::Fatal("unsupported_capability".into())))
            }));
            f.engine.start(&id).unwrap();
            let engine = Arc::clone(&f.engine);
            let pid = id.clone();
            wait_until(move || engine.store.project(&pid).unwrap().status == ProjectStatus::Error && !engine.is_running(&pid)).await;
            let detail = f.engine.detail(&id).unwrap();
            assert_eq!(detail.errors, 1);
            assert_eq!(f.engine.chapter_view(&id, 3).unwrap().status, "error");

            *f.provider.responder.lock().unwrap() = None;
            f.engine.update_settings(&id, None, None, None, Some(Scope::Range { from: 1, to: 2 })).unwrap();
            f.engine.retranslate(&id, 3).unwrap();
            let engine = Arc::clone(&f.engine);
            let pid = id.clone();
            wait_until(move || engine.store.project(&pid).unwrap().status == ProjectStatus::Exported).await;
            assert_eq!(f.engine.chapter_view(&id, 3).unwrap().status, "done", "forced chapter outside the scope");
        });
    }

    #[test]
    fn not_logged_in_is_an_error() {
        tauri::async_runtime::block_on(async {
            let f = fixture(1000);
            let id = create(&f);
            glossary_settled(&f, &id).await;
            f.provider.logged_in.store(false, std::sync::atomic::Ordering::SeqCst);
            f.engine.start(&id).unwrap();
            let engine = Arc::clone(&f.engine);
            let pid = id.clone();
            wait_until(move || !engine.is_running(&pid)).await;
            assert_eq!(f.engine.store.project(&id).unwrap().status, ProjectStatus::Error);
        });
    }

    #[test]
    fn chapter_status_rules() {
        assert_eq!(chapter_status(["pending", "pending"].into_iter()), "pending");
        assert_eq!(chapter_status(["done", "pending"].into_iter()), "running");
        assert_eq!(chapter_status(["done", "needs_review"].into_iter()), "needs_review");
        assert_eq!(chapter_status(["done", "error"].into_iter()), "error");
        assert_eq!(chapter_status(["done"].into_iter()), "done");
    }
}
