//! Deterministic QA over the translated text (port of `mol/verify.py`, zero cost).
//!
//! Issues are strings `"<code>: <detail>"`; the code is one of `missingChunks`,
//! `paragraphMismatch`, `tooShort`, `englishLeft`, `needsReview`
//! (`issue.split(":")[0]`). Only `needsReview` does not fail the report.

use std::sync::OnceLock;

use regex::Regex;

use super::source::{split_blocks, text_of};
use super::store::ChunkRow;
use super::{Engine, VerifyChapter, VerifyReport};

pub const SHORT_RATIO: f64 = 0.70;
pub const ENGLISH_THRESHOLD: f64 = 0.04;

/// English words with no Portuguese collision: high density = untranslated text.
fn english_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(
            r"(?i)\b(the|and|was|were|with|his|her|they|their|would|could|should|there|which|been|that|what|when|from|have|this|about|after|before|because|something|anything|nothing|through|where|while|these|those|though|into|only|very|also|just)\b",
        )
        .expect("valid regex")
    })
}

pub fn english_ratio(text: &str) -> f64 {
    let words = text.split_whitespace().count();
    if words == 0 {
        return 0.0;
    }
    english_re().find_iter(text).count() as f64 / words as f64
}

fn pct(value: f64) -> String {
    format!("{:.1}%", value * 100.0).replace('.', ",")
}

/// Issues of one translated chunk (codes without the "trecho N" detail). Reviewed
/// chunks report nothing: the user accepted them as they are.
pub fn chunk_issues(chunk: &ChunkRow) -> Vec<String> {
    let Some(dst_html) = chunk.dst_html.as_deref() else { return Vec::new() };
    if chunk.reviewed {
        return Vec::new();
    }
    let mut issues = Vec::new();
    let (n_src, n_dst) = (split_blocks(&chunk.src_html).len(), split_blocks(dst_html).len());
    if n_src != n_dst {
        issues.push(format!("paragraphMismatch: {n_src} → {n_dst}"));
    }
    let src_words = text_of(&chunk.src_html).split_whitespace().count();
    let text = text_of(dst_html);
    let dst_words = text.split_whitespace().count();
    if src_words > 0 && (dst_words as f64 / src_words as f64) < SHORT_RATIO {
        issues.push(format!("tooShort: {} das palavras", pct(dst_words as f64 / src_words as f64)));
    }
    if dst_words >= 30 {
        let ratio = english_ratio(&text);
        if ratio > ENGLISH_THRESHOLD {
            issues.push(format!("englishLeft: {}", pct(ratio)));
        }
    }
    if chunk.status == "needs_review" {
        issues.push("needsReview".to_string());
    }
    issues
}

/// English function words left in a translated text (lowercase, unique), to highlight.
pub fn english_words(text: &str) -> Vec<String> {
    let mut out: Vec<String> = english_re().find_iter(text).map(|m| m.as_str().to_lowercase()).collect();
    out.sort();
    out.dedup();
    out
}

/// Issues of one chapter, from its chunks ("code: trecho N (detail)").
pub fn chapter_issues(chunks: &[ChunkRow]) -> Vec<String> {
    let mut issues = Vec::new();
    let missing = chunks.iter().filter(|c| c.dst_html.is_none()).count();
    if missing > 0 {
        issues.push(format!("missingChunks: {missing} de {} trechos", chunks.len()));
        return issues;
    }
    for chunk in chunks {
        for issue in chunk_issues(chunk) {
            let (code, detail) = issue.split_once(": ").map(|(c, d)| (c, Some(d))).unwrap_or((issue.as_str(), None));
            issues.push(match detail {
                Some(detail) => format!("{code}: trecho {} ({detail})", chunk.index + 1),
                None => format!("{code}: trecho {}", chunk.index + 1),
            });
        }
    }
    issues
}

pub fn is_blocking(issue: &str) -> bool {
    !issue.starts_with("needsReview")
}

impl Engine {
    /// Report for the chapters in scope (and chapters forced by "retranslate").
    pub fn verify(&self, id: &str) -> Result<VerifyReport, String> {
        let row = self.store.project(id)?;
        let mut chapters = Vec::new();
        let mut ok = true;
        for chapter in self.store.chapters(id)? {
            if !row.scope.contains(chapter.index) && !chapter.forced {
                continue;
            }
            let chunks = self.store.chunks(id, chapter.index)?;
            // Chapters not started yet are not "problems": they just aren't translated.
            // They keep the book incomplete (ok = false) but stay out of the issue list.
            if !chunks.is_empty() && chunks.iter().all(|c| c.dst_html.is_none()) {
                ok = false;
                continue;
            }
            let issues = chapter_issues(&chunks);
            if issues.iter().any(|issue| is_blocking(issue)) {
                ok = false;
            }
            if !issues.is_empty() {
                chapters.push(VerifyChapter { index: chapter.index, title: chapter.title, issues });
            }
        }
        Ok(VerifyReport { ok, chapters })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::translation::runner::tests::{create, fixture, glossary_settled, wait_until};
    use crate::translation::ProjectStatus;
    use std::sync::Arc;

    fn chunk(index: u32, src: &str, dst: Option<&str>, status: &str) -> ChunkRow {
        ChunkRow {
            id: index as i64,
            index,
            src_html: src.into(),
            src_words: 0,
            dst_html: dst.map(str::to_string),
            status: status.into(),
            reviewed: false,
        }
    }

    #[test]
    fn chapter_issue_codes() {
        let en = "<p>".to_string() + &"the man and the woman were there with their dog ".repeat(4) + "</p>";
        let pt = "<p>".to_string() + &"o homem e a mulher estavam lá com o seu cão ".repeat(4) + "</p>";
        assert!(chapter_issues(&[chunk(0, &en, Some(&pt), "done")]).is_empty());
        assert_eq!(chapter_issues(&[chunk(0, &en, None, "pending"), chunk(1, &en, Some(&pt), "done")]), vec!["missingChunks: 1 de 2 trechos"]);
        let issues = chapter_issues(&[chunk(0, &format!("{en}{en}"), Some(&en), "needs_review")]);
        assert_eq!(issues.len(), 4, "{issues:?}");
        assert_eq!(issues[0], "paragraphMismatch: trecho 1 (2 → 1)");
        assert_eq!(issues[1], "tooShort: trecho 1 (50,0% das palavras)");
        assert!(issues[2].starts_with("englishLeft: trecho 1 ("));
        assert_eq!(issues[3], "needsReview: trecho 1");
        assert!(!is_blocking(&issues[3]) && is_blocking(&issues[0]));

        let mut reviewed = chunk(0, &format!("{en}{en}"), Some(&en), "done");
        reviewed.reviewed = true;
        assert!(chapter_issues(&[reviewed]).is_empty(), "reviewed chunks report nothing");
        assert_eq!(english_words("the man and o homem"), vec!["and".to_string(), "the".to_string()]);
    }

    #[test]
    fn verify_report_over_a_project() {
        tauri::async_runtime::block_on(async {
            let f = fixture(1000);
            let id = create(&f);
            glossary_settled(&f, &id).await;
            let report = f.engine.verify(&id).unwrap();
            assert!(!report.ok, "untranslated book is not ok");
            assert!(report.chapters.is_empty(), "chapters not started are not listed as problems");

            f.engine.start(&id).unwrap();
            let engine = Arc::clone(&f.engine);
            let pid = id.clone();
            wait_until(move || engine.store.project(&pid).unwrap().status == ProjectStatus::Exported).await;
            let report = f.engine.verify(&id).unwrap();
            assert!(report.ok, "{:?}", report.chapters);
            assert!(report.chapters.is_empty());
        });
    }

    #[test]
    fn chunk_level_review_actions() {
        tauri::async_runtime::block_on(async {
            let f = fixture(1000);
            let id = create(&f);
            glossary_settled(&f, &id).await;
            f.engine.start(&id).unwrap();
            let engine = Arc::clone(&f.engine);
            let pid = id.clone();
            wait_until(move || engine.store.project(&pid).unwrap().status == ProjectStatus::Exported).await;

            let chapter = f.engine.chapter_view(&id, 1).unwrap();
            assert!(!chapter.chunks.is_empty());
            let first = &chapter.chunks[0];
            assert!(!first.pairs.is_empty());
            assert!(first.pairs.iter().all(|p| p.source.is_some() && p.translated.is_some()), "pairs align");

            // Force an issue on chunk 0, then accept it as reviewed.
            f.engine.store.save_chunk(first_chunk_id(&f, &id), "<p>x</p>", "needs_review", Some("nota"), "m", 0, 0).unwrap();
            assert!(!f.engine.chapter_view(&id, 1).unwrap().chunks[0].issues.is_empty());
            let view = f.engine.mark_chunk_reviewed(&id, 1, 0).unwrap();
            assert!(view.chunks[0].reviewed && view.chunks[0].issues.is_empty());
            assert_eq!(view.chunks[0].status, "done");

            // Retranslating one chunk resets only that chunk and runs again.
            f.engine.retranslate_chunk(&id, 1, 0).unwrap();
            let engine = Arc::clone(&f.engine);
            let pid = id.clone();
            wait_until(move || {
                let chunks = engine.store.chunks(&pid, 1).unwrap();
                chunks[0].dst_html.as_deref().is_some_and(|h| h != "<p>x</p>") && !chunks[0].reviewed
            })
            .await;
            assert!(f.engine.retranslate_chunk(&id, 1, 999).is_err());
        });
    }

    fn first_chunk_id(f: &crate::translation::runner::tests::Fixture, id: &str) -> i64 {
        f.engine.store.chunks(id, 1).unwrap()[0].id
    }
}
