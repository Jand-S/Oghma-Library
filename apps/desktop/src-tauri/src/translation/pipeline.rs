//! Port of `mol/translate.py`: chunking, prompt, validation, retry with the
//! rejection reason, and the one-block-per-request fallback.

use super::provider::{ChatProvider, ProviderError, TokenUsage};
use super::source::{block_tag, split_blocks, text_of, word_count, xml_escape};
use super::GlossaryEntry;

/// Overhead per request is tiny with Sign in with ChatGPT: ~1,000 words, as in mol.
pub const CHUNK_WORDS: usize = 1000;
pub const MAX_ATTEMPTS: u32 = 3;
pub const TAIL_CHARS: usize = 400;

pub const SYSTEM_PROMPT: &str = r#"You are a professional literary translator rendering an English web novel into Brazilian Portuguese (pt-BR).

OUTPUT CONTRACT - follow exactly:
- The input is an HTML fragment of block elements.
- Return ONLY the translated HTML fragment: no preamble, no commentary, no code fences.
- Preserve the exact number, order and type of block tags. If the input has N <p> elements, the output must have exactly N <p> elements, in the same order. Headings stay headings.
- Preserve inline tags (<em>, <strong>, <br>) wrapping the corresponding translated words. Italics mark telepathic speech and emphasis and are meaningful - never drop <em>.
- Keep attributes and non-text elements (images, links) exactly as they are.
- Translate every sentence. Never summarize, omit, merge, split or add content.

STYLE:
- Natural, fluent, contemporary Brazilian Portuguese. Never European Portuguese: use "você", avoid lusitanian constructions and "tu" conjugations.
- Keep the original quotation marks for dialogue. Do NOT convert dialogue to travessão (em dash).
- Preserve the narrative voice, person and tense, and the plain modern diction.
- Render idioms idiomatically rather than literally, but never invent content that is not there.
- Proper nouns follow the glossary. Any name not listed stays exactly as in the original."#;

#[derive(Debug, Clone, PartialEq)]
pub struct ChunkPlan {
    pub html: String,
    pub words: usize,
    pub blocks: usize,
}

/// Groups blocks into chunks of about `target` words without splitting a block.
pub fn make_chunks(blocks: &[String], target: usize) -> Vec<ChunkPlan> {
    let mut chunks = Vec::new();
    let mut current: Vec<&str> = Vec::new();
    let mut words = 0;
    for block in blocks {
        let w = word_count(block);
        if !current.is_empty() && words + w > target {
            chunks.push(ChunkPlan { html: current.join("\n"), words, blocks: current.len() });
            current.clear();
            words = 0;
        }
        current.push(block);
        words += w;
    }
    if !current.is_empty() {
        chunks.push(ChunkPlan { html: current.join("\n"), words, blocks: current.len() });
    }
    chunks
}

/// Glossary filtered to the terms present in the chunk.
pub fn glossary_text(entries: &[GlossaryEntry], src_html: &str) -> String {
    let low = text_of(src_html).to_lowercase();
    let mut translate: Vec<(&str, &str)> = Vec::new();
    let mut keep: Vec<&str> = Vec::new();
    for entry in entries {
        if entry.term.is_empty() || !low.contains(&entry.term.to_lowercase()) {
            continue;
        }
        match (entry.kind.as_str(), entry.target.as_deref()) {
            ("translate", Some(target)) if !target.trim().is_empty() => translate.push((&entry.term, target)),
            _ => keep.push(&entry.term),
        }
    }
    translate.sort();
    keep.sort();
    let mut lines: Vec<String> = translate.iter().map(|(en, pt)| format!("  {en} -> {pt}")).collect();
    if !keep.is_empty() {
        lines.push(format!("  Keep untranslated: {}", keep.join(", ")));
    }
    lines.join("\n")
}

pub fn build_prompt(src_html: &str, glossary: &[GlossaryEntry], prev_tail: &str, strict_note: Option<&str>) -> String {
    let mut parts = Vec::new();
    let g = glossary_text(glossary, src_html);
    if !g.is_empty() {
        parts.push(format!("GLOSSARY (authoritative):\n{g}"));
    }
    if !prev_tail.trim().is_empty() {
        parts.push(format!(
            "CONTINUITY - this is the end of the previous passage, already translated. Do NOT translate or repeat it. Use it only to stay consistent in names, tone and tense:\n{prev_tail}"
        ));
    }
    let n = split_blocks(src_html).len();
    parts.push(format!(
        "TRANSLATE THE FOLLOWING FRAGMENT. It contains exactly {n} block elements; your output must contain exactly {n}.\n\n{src_html}"
    ));
    if let Some(note) = strict_note {
        parts.push(format!("IMPORTANT: {note}"));
    }
    parts.join("\n\n")
}

/// Strips code fences.
pub fn clean_output(text: &str) -> String {
    let mut out = text.trim();
    if let Some(rest) = out.strip_prefix("```") {
        out = rest.trim_start_matches("html").trim_start_matches("HTML");
        out = out.trim_start();
    }
    if let Some(rest) = out.strip_suffix("```") {
        out = rest;
    }
    out.trim().to_string()
}

/// `None` when the translation is aligned with the source, else the rejection reason.
pub fn validate(src_html: &str, dst_html: &str) -> Option<String> {
    if dst_html.trim().is_empty() {
        return Some("resposta vazia".into());
    }
    let src = split_blocks(src_html);
    let dst = split_blocks(dst_html);
    if src.len() != dst.len() {
        return Some(format!("blocos: origem {}, tradução {}", src.len(), dst.len()));
    }
    for (index, (a, b)) in src.iter().zip(&dst).enumerate() {
        let (ta, tb) = (block_tag(a), block_tag(b));
        if ta != tb {
            return Some(format!(
                "bloco {}: <{}> virou <{}>",
                index + 1,
                ta.unwrap_or_default(),
                tb.unwrap_or_default()
            ));
        }
    }
    let src_chars = text_of(src_html).chars().count();
    let dst_chars = text_of(dst_html).chars().count();
    if src_chars > 0 {
        let ratio = dst_chars as f64 / src_chars as f64;
        if !(0.6..=2.0).contains(&ratio) {
            return Some(format!("tamanho fora da faixa: {ratio:.2}"));
        }
    }
    None
}

/// Last `n` characters of the visible text.
pub fn tail_text(html: &str, n: usize) -> String {
    let text = text_of(html);
    let count = text.chars().count();
    text.chars().skip(count.saturating_sub(n)).collect()
}

#[derive(Debug, Clone, PartialEq)]
pub struct FragmentResult {
    pub html: String,
    pub usage: TokenUsage,
    /// `Some` when the block fallback was used (the chunk then needs review).
    pub note: Option<String>,
    pub requests: u32,
}

/// Translates one chunk: up to `MAX_ATTEMPTS` whole-chunk tries (each retry tells
/// the model why the previous one was rejected), then one request per block.
pub async fn translate_fragment(
    provider: &dyn ChatProvider,
    model: &str,
    effort: &str,
    src_html: &str,
    glossary: &[GlossaryEntry],
    prev_tail: &str,
) -> Result<FragmentResult, ProviderError> {
    let mut usage = TokenUsage::default();
    let mut requests = 0;
    let mut note: Option<String> = None;
    let mut last_problem = String::new();

    for _ in 0..MAX_ATTEMPTS {
        let prompt = build_prompt(src_html, glossary, prev_tail, note.as_deref());
        let out = provider.translate(model, effort, SYSTEM_PROMPT, &prompt).await?;
        usage.add(&out.usage);
        requests += 1;
        let dst = clean_output(&out.text);
        match validate(src_html, &dst) {
            None => return Ok(FragmentResult { html: dst, usage, note: None, requests }),
            Some(problem) => {
                note = Some(format!(
                    "Your previous attempt was rejected ({problem}). Return exactly one translated block element per source block element, same order, nothing else."
                ));
                last_problem = problem;
            }
        }
    }

    // Fallback: one block per request guarantees 1:1 alignment.
    let mut pieces = Vec::new();
    let mut tail = prev_tail.to_string();
    for block in split_blocks(src_html) {
        if text_of(&block).is_empty() {
            pieces.push(block);
            continue;
        }
        let out = provider
            .translate(model, effort, SYSTEM_PROMPT, &build_prompt(&block, glossary, &tail, None))
            .await?;
        usage.add(&out.usage);
        requests += 1;
        let mut piece = clean_output(&out.text);
        if split_blocks(&piece).len() != 1 {
            let tag = block_tag(&block).unwrap_or_else(|| "p".into());
            piece = format!("<{tag}>{}</{tag}>", xml_escape(&text_of(&piece)));
        }
        tail = tail_text(&piece, TAIL_CHARS);
        pieces.push(piece);
    }
    Ok(FragmentResult {
        html: pieces.join("\n"),
        usage,
        note: Some(format!("fallback bloco a bloco ({last_problem})")),
        requests,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::translation::provider::fake::{fake_translate_html, fragment_of, FakeProvider};

    fn para(words: usize, label: &str) -> String {
        format!("<p>{}</p>", vec![label; words].join(" "))
    }

    #[test]
    fn chunks_never_split_a_paragraph() {
        let blocks: Vec<String> = vec![para(400, "a"), para(400, "b"), para(400, "c"), para(1500, "d"), para(10, "e")];
        let chunks = make_chunks(&blocks, 1000);
        let sizes: Vec<(usize, usize)> = chunks.iter().map(|c| (c.words, c.blocks)).collect();
        assert_eq!(sizes, vec![(800, 2), (400, 1), (1500, 1), (10, 1)]);
        assert_eq!(chunks[0].html, format!("{}\n{}", blocks[0], blocks[1]));
        assert!(make_chunks(&[], 1000).is_empty());
    }

    #[test]
    fn prompt_filters_glossary_and_marks_continuity() {
        let glossary = vec![
            GlossaryEntry { term: "Crimson Moon".into(), kind: "translate".into(), target: Some("Lua Carmesim".into()), count: 3, source: "auto".into(), missed: 0, confidence: 100 },
            GlossaryEntry { term: "Lin Feng".into(), kind: "keep".into(), target: None, count: 9, source: "auto".into(), missed: 0, confidence: 100 },
            GlossaryEntry { term: "Elder".into(), kind: "translate".into(), target: Some("Ancião".into()), count: 2, source: "auto".into(), missed: 0, confidence: 100 },
        ];
        let prompt = build_prompt("<p>Lin Feng saw the Crimson Moon.</p>", &glossary, "fim do trecho", Some("be strict"));
        assert!(prompt.contains("Crimson Moon -> Lua Carmesim"));
        assert!(prompt.contains("Keep untranslated: Lin Feng"));
        assert!(!prompt.contains("Ancião"), "terms absent from the chunk are filtered");
        assert!(prompt.contains("Do NOT translate or repeat it"));
        assert!(prompt.contains("exactly 1 block elements"));
        assert!(prompt.ends_with("IMPORTANT: be strict"));
        assert_eq!(fragment_of(&prompt), "<p>Lin Feng saw the Crimson Moon.</p>");
    }

    #[test]
    fn validation_rules() {
        let src = "<h1>Title</h1>\n<p>One two three four.</p>";
        assert_eq!(validate(src, "<h1>Título</h1><p>Um dois três quatro.</p>"), None);
        assert!(validate(src, "").unwrap().contains("vazia"));
        assert!(validate(src, "<h1>Título</h1>").unwrap().contains("blocos"));
        assert!(validate(src, "<p>Título</p><p>Um dois três quatro.</p>").unwrap().contains("<h1> virou <p>"));
        assert!(validate(src, "<h1>T</h1><p>Um.</p>").unwrap().contains("tamanho"));
        assert_eq!(clean_output("```html\n<p>x</p>\n```"), "<p>x</p>");
        assert_eq!(tail_text("<p>abcdef</p>", 3), "def");
    }

    #[test]
    fn retries_with_reason_then_falls_back_block_by_block() {
        tauri::async_runtime::block_on(async {
            let provider = FakeProvider::new();
            // Whole-chunk requests always drop a block; single-block requests are fine.
            provider.set_responder(Box::new(|_, prompt| {
                let fragment = fragment_of(prompt);
                let blocks = split_blocks(&fragment);
                if blocks.len() > 1 {
                    Some(Ok(fake_translate_html(&blocks[0])))
                } else {
                    None
                }
            }));
            let src = "<h1>Title here</h1>\n<p>First paragraph words.</p>\n<p>Second paragraph words.</p>";
            let result = translate_fragment(provider.as_ref(), "gpt-6-luna", "none", src, &[], "").await.unwrap();
            assert_eq!(result.requests, MAX_ATTEMPTS + 3);
            assert!(result.note.as_deref().unwrap().contains("fallback"));
            assert_eq!(split_blocks(&result.html).len(), 3);
            assert_eq!(validate(src, &result.html), None);
            let calls = provider.calls.lock().unwrap();
            assert!(!calls[0].1.contains("IMPORTANT"));
            assert!(calls[1].1.contains("IMPORTANT: Your previous attempt was rejected (blocos: origem 3, tradução 1)"));
            // Fallback requests carry the previous block's translation as continuity.
            assert!(calls[MAX_ATTEMPTS as usize + 1].1.contains("CONTINUITY"));
        });
    }

    #[test]
    fn fallback_wraps_misaligned_single_block_output() {
        tauri::async_runtime::block_on(async {
            let provider = FakeProvider::new();
            provider.set_responder(Box::new(|_, _| Some(Ok("Sem tags <b>nenhuma</b> aqui e ali".into()))));
            let src = "<p>Some words</p>\n<h2>Head</h2>";
            let result = translate_fragment(provider.as_ref(), "m", "none", src, &[], "").await.unwrap();
            assert_eq!(result.html, "<p>Sem tags nenhuma aqui e ali</p>\n<h2>Sem tags nenhuma aqui e ali</h2>");
        });
    }

    #[test]
    fn usage_limit_propagates() {
        tauri::async_runtime::block_on(async {
            let provider = FakeProvider::new();
            provider.set_responder(Box::new(|_, _| Some(Err(ProviderError::UsageLimit("x".into())))));
            let result = translate_fragment(provider.as_ref(), "m", "none", "<p>a b</p>", &[], "").await;
            assert!(matches!(result, Err(ProviderError::UsageLimit(_))));
            assert_eq!(provider.call_count(), 1);
        });
    }
}
