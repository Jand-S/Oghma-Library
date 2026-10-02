//! Pilot (port of `mol/pilot.py`): the first ~1,500 words of chapter 1
//! translated by each model ("Rápido" and "Qualidade"), with time, tokens,
//! credits and the projection for the whole book ("créditos estimados").

use super::LockExt;
use std::sync::Arc;
use std::time::Instant;

use serde_json::json;

use super::pipeline::{translate_fragment, validate};
use super::provider::credits;
use super::source::{split_blocks, word_count};
use super::{events, now_secs, Engine, PilotRun, PilotSample, PILOT_MODELS};

/// First blocks of the first chapter in scope, up to about `words`.
fn sample(engine: &Engine, id: &str, words: usize) -> Result<(String, u64), String> {
    let row = engine.store.project(id)?;
    let chapter = engine
        .store
        .chapters(id)?
        .into_iter()
        .find(|c| row.scope.contains(c.index))
        .ok_or("Nenhum capítulo no escopo")?;
    let mut blocks = Vec::new();
    let mut total = 0;
    'outer: for chunk in engine.store.chunks(id, chapter.index)? {
        for block in split_blocks(&chunk.src_html) {
            total += word_count(&block);
            blocks.push(block);
            if total >= words {
                break 'outer;
            }
        }
    }
    if blocks.is_empty() {
        return Err("O capítulo 1 está vazio".into());
    }
    Ok((blocks.join("\n"), total as u64))
}

impl Engine {
    fn emit_pilot(&self, id: &str, run: &PilotRun) {
        let _ = self.store.save_pilot(id, run);
        self.emit(events::PILOT, json!({ "projectId": id, "run": run }));
    }

    /// Starts the pilot in the background; `translation://pilot` reports each step.
    pub fn start_pilot(self: &Arc<Self>, id: &str) -> Result<(), String> {
        if !self.provider.account().logged_in {
            return Err("Conecte o ChatGPT para rodar o piloto.".into());
        }
        let (source_html, words) = sample(self, id, self.config.pilot_words)?;
        {
            let mut jobs = self.pilot_jobs.lock_safe();
            if !jobs.insert(id.to_string()) {
                return Ok(());
            }
        }
        let run = PilotRun { created_at: now_secs(), source_html, words, samples: Vec::new(), status: "running".into(), error: None };
        self.emit_pilot(id, &run);
        self.log(id, "info", format!("Piloto iniciado: {words} palavras do capítulo 1 em {} modelos.", PILOT_MODELS.len()));
        let engine = Arc::clone(self);
        let id = id.to_string();
        tauri::async_runtime::spawn(async move {
            engine.run_pilot(&id, run).await;
            {
                let mut jobs = engine.pilot_jobs.lock_safe();
                jobs.remove(&id);
            }
        });
        Ok(())
    }

    async fn run_pilot(&self, id: &str, mut run: PilotRun) {
        let book_words = self.detail(id).map(|d| d.words_total).unwrap_or(0) as f64;
        let effort = self.store.project(id).map(|r| r.effort).unwrap_or_else(|_| "none".into());
        let glossary = self.store.glossary(id).unwrap_or_default();
        let mut errors = Vec::new();
        for (model, label) in PILOT_MODELS {
            let started = Instant::now();
            match translate_fragment(self.provider.as_ref(), model, &effort, &run.source_html, &glossary, "").await {
                Ok(fragment) => {
                    let spent = self.store.log_usage(Some(id), model, run.words, &fragment.usage).unwrap_or_else(|_| {
                        credits(model, &fragment.usage)
                    });
                    let tokens = (fragment.usage.input_tokens + fragment.usage.output_tokens) as f64;
                    let per_word = |value: f64| if run.words > 0 { value / run.words as f64 * book_words } else { 0.0 };
                    run.samples.push(PilotSample {
                        model: model.to_string(),
                        label: label.to_string(),
                        seconds: (started.elapsed().as_secs_f64() * 10.0).round() / 10.0,
                        input_tokens: fragment.usage.input_tokens,
                        output_tokens: fragment.usage.output_tokens,
                        credits: spent,
                        projected_book_tokens: per_word(tokens).round(),
                        projected_book_credits: per_word(spent),
                        valid: fragment.note.is_none() && validate(&run.source_html, &fragment.html).is_none(),
                        html: fragment.html,
                    });
                    self.clear_limit();
                    self.emit_usage();
                    self.log(
                        id,
                        "info",
                        format!("Piloto {label}: {:.1} s, ~{:.0} créditos estimados para o livro.", started.elapsed().as_secs_f64(), per_word(spent)),
                    );
                }
                Err(err) => {
                    if let super::provider::ProviderError::UsageLimit(message) = &err {
                        self.set_limit(message);
                    }
                    self.log(id, "warn", format!("Piloto {label} falhou: {err}"));
                    errors.push(format!("{label}: {err}"));
                }
            }
            self.emit_pilot(id, &run);
        }
        run.status = if run.samples.is_empty() { "error".into() } else { "done".into() };
        run.error = (!errors.is_empty()).then(|| errors.join("; "));
        self.emit_pilot(id, &run);
    }

    /// "Usar este modelo".
    pub fn choose_model(self: &Arc<Self>, id: &str, model: &str) -> Result<super::ProjectDetail, String> {
        if model.trim().is_empty() {
            return Err("Modelo inválido".into());
        }
        self.store.set_model(id, model)?;
        let label = PILOT_MODELS.iter().find(|(m, _)| *m == model).map(|(_, l)| *l).unwrap_or(model);
        self.log(id, "info", format!("Modelo escolhido: {label} ({model})."));
        self.emit_project(id, true);
        self.detail(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::translation::runner::tests::{create, fixture, glossary_settled, wait_until};

    #[test]
    fn pilot_compares_both_models() {
        tauri::async_runtime::block_on(async {
            let f = fixture(1000);
            let id = create(&f);
            glossary_settled(&f, &id).await;
            f.engine.start_pilot(&id).unwrap();
            let engine = Arc::clone(&f.engine);
            let pid = id.clone();
            wait_until(move || engine.store.pilot(&pid).unwrap().is_some_and(|run| run.status == "done")).await;
            let run = f.engine.store.pilot(&id).unwrap().unwrap();
            assert_eq!(run.samples.len(), 2);
            assert!(run.words >= 60, "about pilot_words words: {}", run.words);
            let (fast, quality) = (&run.samples[0], &run.samples[1]);
            assert_eq!((fast.label.as_str(), quality.label.as_str()), ("Rápido", "Qualidade"));
            assert!(fast.valid && quality.valid);
            assert!(fast.projected_book_tokens > 0.0);
            // Sol costs ~20x Luna per token.
            let ratio = quality.projected_book_credits / fast.projected_book_credits;
            assert!((ratio - 20.0).abs() < 0.5, "ratio {ratio}");
            let json = serde_json::to_value(fast).unwrap();
            for key in ["model", "label", "seconds", "inputTokens", "outputTokens", "projectedBookTokens", "projectedBookCredits", "valid", "html"] {
                assert!(json.get(key).is_some(), "missing {key}");
            }
            assert!(f.host.count(events::PILOT) >= 3);
            let detail = f.engine.choose_model(&id, "gpt-6-sol").unwrap();
            assert_eq!(detail.model, "gpt-6-sol");
        });
    }
}
