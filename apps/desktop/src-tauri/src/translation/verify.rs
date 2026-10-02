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

/// Issues of one chapter, from its chunks.
pub fn chapter_issues(chunks: &[ChunkRow]) -> Vec<String> {
    let mut issues = Vec::new();
    let missing = chunks.iter().filter(|c| c.dst_html.is_none()).count();
    if missing > 0 {
        issues.push(format!("missingChunks: {missing} de {} trechos", chunks.len()));
        return issues;
    }
    let src_html = chunks.iter().map(|c| c.src_html.as_str()).collect::<Vec<_>>().join("\n");
    let dst_html = chunks.iter().filter_map(|c| c.dst_html.as_deref()).collect::<Vec<_>>().join("\n");
    let (n_src, n_dst) = (split_blocks(&src_html).len(), split_blocks(&dst_html).len());
    if n_src != n_dst {
        issues.push(format!("paragraphMismatch: {n_src} → {n_dst}"));
    }
    let src_words = text_of(&src_html).split_whitespace().count();
    let dst_words = text_of(&dst_html).split_whitespace().count();
    if src_words > 0 && (dst_words as f64 / src_words as f64) < SHORT_RATIO {
        issues.push(format!("tooShort: {} das palavras", pct(dst_words as f64 / src_words as f64)));
    }
    for chunk in chunks {
        let text = text_of(chunk.dst_html.as_deref().unwrap_or(""));
        if text.split_whitespace().count() >= 30 {
            let ratio = english_ratio(&text);
            if ratio > ENGLISH_THRESHOLD {
                issues.push(format!("englishLeft: trecho {} ({})", chunk.index + 1, pct(ratio)));
            }
        }
        if chunk.status == "needs_review" {
            issues.push(format!("needsReview: trecho {}", chunk.index + 1));
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
            chapter: 1,
            index,
            src_html: src.into(),
            src_words: 0,
            src_blocks: 0,
            dst_html: dst.map(str::to_string),
            status: status.into(),
            error: None,
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
        assert!(issues[0].starts_with("paragraphMismatch: 2 → 1"));
        assert!(issues[1].starts_with("tooShort: 50,0%"));
        assert!(issues[2].starts_with("englishLeft: trecho 1"));
        assert_eq!(issues[3], "needsReview: trecho 1");
        assert!(!is_blocking(&issues[3]) && is_blocking(&issues[0]));
    }

    #[test]
    fn verify_report_over_a_project() {
        tauri::async_runtime::block_on(async {
            let f = fixture(1000);
            let id = create(&f);
            glossary_settled(&f, &id).await;
            let report = f.engine.verify(&id).unwrap();
            assert!(!report.ok);
            assert_eq!(report.chapters.len(), 3);
            assert!(report.chapters[0].issues[0].starts_with("missingChunks"));

            f.engine.start(&id).unwrap();
            let engine = Arc::clone(&f.engine);
            let pid = id.clone();
            wait_until(move || engine.store.project(&pid).unwrap().status == ProjectStatus::Exported).await;
            let report = f.engine.verify(&id).unwrap();
            assert!(report.ok, "{:?}", report.chapters);
            assert!(report.chapters.is_empty());
        });
    }
}
