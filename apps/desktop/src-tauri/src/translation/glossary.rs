//! Automatic glossary: candidate terms by frequency heuristics (port of
//! `mol/glossary.py` + `mol/terms.py`), then ONE curation request returning
//! `{keep:[...], translate:{en:pt}}` (prompt modelled on `mol/build_glossary.py`).

use super::LockExt;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, OnceLock};

use regex::Regex;
use serde_json::{json, Value};

use super::pipeline::clean_output;
use super::provider::ProviderError;
use super::source::text_of;
use super::{events, Engine, GlossaryEntry};

/// Capitalized words that are not names (sentence starters, pronouns, days, …).
const STOP: &str = "The A An And But Or So Yet For Nor If When While Then Than That This These Those There Here
He She It They We You I His Her Its Their Our Your My Him Them Us Me Himself Herself Itself
What Who Whom Whose Which Why How Where Whatever Whenever However
Not No Yes Well Oh Ah Hmm Huh Hey Okay OK Sure Maybe Perhaps Still Just Only Even Also
Of In On At To From By With Without Into Onto Over Under After Before During Through Between
Is Was Are Were Be Been Being Am Do Does Did Done Have Has Had Having Will Would Shall Should
Can Could May Might Must Let Lets Go Going Went Come Came Get Got Give Gave Take Took Make Made
Now Once Again Another Any All Both Each Every Some Most Much Many Few More Less Least Best
One Two Three Four Five Six Seven Eight Nine Ten First Second Third Last Next Other Same
Mr Mrs Ms Sir Madam Lady Lord Miss
Day Night Morning Evening Afternoon Today Tomorrow Yesterday Monday Tuesday Wednesday
Thursday Friday Saturday Sunday January February March April May June July August September
October November December Chapter Epilogue Afterword Prologue
Actually Finally Fortunately Unfortunately Suddenly Instead Besides Anyway Meanwhile Eventually
Since Because Although Though Unless Until Whether Either Neither Nothing Something Anything
Everything Someone Anyone Everyone Nobody Somebody Everybody";

/// English function words: excluded from lowercase bigrams.
const FUNCTION_WORDS: &str = "the a an and or but of in on at to from by with without into onto over under after before
is was are were be been being am do does did done have has had having will would shall should
can could may might must let not no yes so than then that this these those there here
he she it they we you i his her its their our your my him them us me as if when while for nor
very much many more most some any all each every both few own same other another such only
just even still again once now too own out up down off away back over around through
one two three four five six seven eight nine ten first second third last next";

/// Leftovers of contractions ("aren't" -> "aren").
const CONTRACTION_STUBS: &str = "aren didn doesn don hadn hasn haven isn mustn needn shan shouldn wasn weren won wouldn couldn ain let";

const SUFFIXES: &[(&str, &str)] = &[
    ("s", ""), ("es", ""), ("ed", ""), ("d", ""), ("ing", ""), ("ing", "e"), ("ly", ""), ("er", ""),
    ("est", ""), ("ies", "y"), ("ied", "y"), ("ier", "y"), ("iest", "y"), ("ness", ""), ("ment", ""), ("ers", ""),
];

fn set(words: &'static str) -> HashSet<&'static str> {
    words.split_whitespace().collect()
}

fn stop() -> &'static HashSet<&'static str> {
    static S: OnceLock<HashSet<&'static str>> = OnceLock::new();
    S.get_or_init(|| set(STOP))
}

fn function_words() -> &'static HashSet<&'static str> {
    static S: OnceLock<HashSet<&'static str>> = OnceLock::new();
    S.get_or_init(|| set(FUNCTION_WORDS))
}

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("valid regex"))
}

const CAP: &str = r"[A-Z][a-z][A-Za-z\-]{1,}";

fn cap1() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, &format!(r"\b({CAP})\b"))
}
fn cap2() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, &format!(r"\b({CAP})\s+({CAP})\b"))
}
fn cap3() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, &format!(r"\b({CAP})\s+({CAP})\s+({CAP})\b"))
}
fn low1() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r"\b([a-z][a-z\-]{2,})\b")
}
fn low2() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r"\b([a-z][a-z\-]{2,})\s+([a-z][a-z\-]{2,})\b")
}
fn sentence_end() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r#"[.!?"“]\s+$"#)
}

/// The system word list (`/usr/share/dict/words` on macOS), used to spot invented words.
pub fn load_dictionary() -> Option<HashSet<String>> {
    let text = std::fs::read_to_string("/usr/share/dict/words").ok()?;
    Some(text.lines().map(|line| line.trim().to_lowercase()).collect())
}

/// The dictionary only has base forms; inflections are reduced.
fn known(word: &str, dictionary: &HashSet<String>) -> bool {
    if dictionary.contains(word) {
        return true;
    }
    for (suffix, replacement) in SUFFIXES {
        if !word.ends_with(suffix) || word.len() <= suffix.len() + 1 {
            continue;
        }
        let base = format!("{}{}", &word[..word.len() - suffix.len()], replacement);
        if dictionary.contains(&base) {
            return true;
        }
        let bytes = base.as_bytes();
        if bytes.len() > 2 && bytes[bytes.len() - 1] == bytes[bytes.len() - 2] && dictionary.contains(&base[..base.len() - 1]) {
            return true;
        }
    }
    word.contains('-') && word.split('-').filter(|part| part.len() > 2).all(|part| known(part, dictionary))
}

#[derive(Debug, Clone, Default)]
pub struct Candidates {
    /// Single-word proper names (mid-sentence capitalized, rarely lowercase).
    pub names: Vec<(String, usize)>,
    /// Capitalized 2-3 word sequences (titles, orders, places).
    pub phrases: Vec<(String, usize)>,
    /// Frequent words missing from the dictionary (invented vocabulary).
    pub invented: Vec<(String, usize)>,
    /// Lowercase bigrams with high mutual information ("time loop").
    pub common: Vec<(String, usize)>,
}

impl Candidates {
    pub fn counts(&self) -> HashMap<String, usize> {
        self.names
            .iter()
            .chain(&self.phrases)
            .chain(&self.invented)
            .chain(&self.common)
            .cloned()
            .collect()
    }

    pub fn is_empty(&self) -> bool {
        self.names.is_empty() && self.phrases.is_empty() && self.invented.is_empty() && self.common.is_empty()
    }
}

fn top(mut items: Vec<(String, usize)>, limit: usize) -> Vec<(String, usize)> {
    items.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    items.truncate(limit);
    items
}

/// Plain text of each chapter's HTML (curly apostrophes normalized).
pub fn corpus_texts(chapters_html: &[String]) -> Vec<String> {
    chapters_html.iter().map(|html| text_of(html).replace('\u{2019}', "'")).collect()
}

/// Candidate terms from the corpus. Thresholds scale down for short books
/// (mol's values were tuned for ~800k words).
pub fn candidates(texts: &[String], dictionary: Option<&HashSet<String>>) -> Candidates {
    let total_words: usize = texts.iter().map(|t| t.split_whitespace().count()).sum();
    let scale = (total_words as f64 / 300_000.0).clamp(0.0, 1.0);
    let threshold = |base: f64, floor: usize| ((base * scale).round() as usize).max(floor);
    let (min_name, min_cap2, min_cap3, min_invented, min_low2) =
        (threshold(8.0, 3), threshold(6.0, 3), threshold(4.0, 3), threshold(12.0, 4), threshold(30.0, 5));

    let stop = stop();
    let function = function_words();
    let mut names: HashMap<String, usize> = HashMap::new();
    let mut mid: HashMap<String, usize> = HashMap::new();
    let mut lower: HashMap<String, usize> = HashMap::new();
    let mut c2: HashMap<String, usize> = HashMap::new();
    let mut c3: HashMap<String, usize> = HashMap::new();
    let mut l2: HashMap<String, usize> = HashMap::new();

    for text in texts {
        for m in low1().captures_iter(text) {
            *lower.entry(m[1].to_string()).or_default() += 1;
        }
        for m in low2().captures_iter(text) {
            if !function.contains(&m[1]) && !function.contains(&m[2]) {
                *l2.entry(format!("{} {}", &m[1], &m[2])).or_default() += 1;
            }
        }
        for m in cap3().captures_iter(text) {
            if ![&m[1], &m[2], &m[3]].iter().any(|w| stop.contains(*w)) {
                *c3.entry(format!("{} {} {}", &m[1], &m[2], &m[3])).or_default() += 1;
            }
        }
        for m in cap2().captures_iter(text) {
            if !stop.contains(&m[1]) && !stop.contains(&m[2]) {
                *c2.entry(format!("{} {}", &m[1], &m[2])).or_default() += 1;
            }
        }
        for m in cap1().captures_iter(text) {
            let token = &m[1];
            if stop.contains(token) {
                continue;
            }
            *names.entry(token.to_string()).or_default() += 1;
            let start = m.get(1).map(|g| g.start()).unwrap_or(0);
            let before: String = {
                let chars: Vec<char> = text[..start].chars().rev().take(3).collect();
                chars.into_iter().rev().collect()
            };
            if !(before.is_empty() || sentence_end().is_match(&before)) {
                *mid.entry(token.to_string()).or_default() += 1;
            }
        }
    }

    let single: Vec<(String, usize)> = names
        .iter()
        .filter(|(token, n)| {
            let n = **n;
            let mid_count = mid.get(*token).copied().unwrap_or(0);
            n >= min_name
                && mid_count >= 3.max((0.3 * n as f64) as usize)
                && (lower.get(&token.to_lowercase()).copied().unwrap_or(0) as f64) <= 0.25 * n as f64
        })
        .map(|(t, n)| (t.clone(), *n))
        .collect();

    let mut phrases: Vec<(String, usize)> = c3.into_iter().filter(|(_, n)| *n >= min_cap3).collect();
    let longer: Vec<String> = phrases.iter().map(|(p, _)| p.clone()).collect();
    phrases.extend(
        c2.into_iter()
            .filter(|(p, n)| *n >= min_cap2 && !longer.iter().any(|q| q.contains(p.as_str()))),
    );

    let stubs = set(CONTRACTION_STUBS);
    let invented: Vec<(String, usize)> = match dictionary {
        Some(dictionary) if !dictionary.is_empty() => lower
            .iter()
            .filter(|(w, n)| **n >= min_invented && w.len() > 3 && !stubs.contains(w.as_str()) && !known(w, dictionary))
            .map(|(w, n)| (w.clone(), *n))
            .collect(),
        _ => Vec::new(),
    };

    // Mutual information separates terms ("time loop") from chance pairs ("know what").
    let total_low = lower.values().sum::<usize>().max(1) as f64;
    let mut scored: Vec<(f64, String, usize)> = l2
        .into_iter()
        .filter(|(_, n)| *n >= min_low2)
        .filter_map(|(pair, n)| {
            let (a, b) = pair.split_once(' ')?;
            let pa = lower.get(a).copied().unwrap_or(1) as f64 / total_low;
            let pb = lower.get(b).copied().unwrap_or(1) as f64 / total_low;
            let pmi = ((n as f64 / total_low) / (pa * pb)).ln();
            Some((pmi, pair, n))
        })
        .collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let common: Vec<(String, usize)> = scored.into_iter().take(45).map(|(_, p, n)| (p, n)).collect();

    Candidates {
        names: top(single, 150),
        phrases: top(phrases, 120),
        invented: top(invented, 80),
        common,
    }
}

pub const CURATION_INSTRUCTIONS: &str = "You build glossaries for literary translation from English into Brazilian Portuguese (pt-BR). Reply with a single JSON object only: no commentary, no code fences.";

/// One prompt for the whole curation (names, entities and terminology).
pub fn curation_prompt(candidates: &Candidates) -> String {
    let list = |items: &[(String, usize)]| items.iter().map(|(t, _)| format!("- {t}")).collect::<Vec<_>>().join("\n");
    format!(
        r#"These are candidate terms harvested automatically from an English novel being translated into Brazilian Portuguese (pt-BR). The lists are noisy.

Build the glossary used for the whole book:
- "keep": personal names and invented place/creature names that must stay EXACTLY as in English.
- "translate": descriptive titles, nicknames, orders, guilds, institutions and setting-specific terminology (magic-system vocabulary, invented disciplines, recurring in-world concepts), each with the ONE natural pt-BR rendering used everywhere.
- DISCARD ordinary English words and everyday phrases that need no fixed translation.

Reply with JSON only, exactly in this shape:
{{"keep": ["Name", ...], "translate": {{"English term": "tradução", ...}}}}

PROPER NAME CANDIDATES:
{}

MULTI-WORD ENTITIES:
{}

TERMINOLOGY CANDIDATES:
{}
"#,
        list(&candidates.names),
        list(&candidates.phrases),
        list(&candidates.invented.iter().chain(&candidates.common).cloned().collect::<Vec<_>>()),
    )
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Curated {
    pub keep: Vec<String>,
    pub translate: Vec<(String, String)>,
}

fn balanced_object(text: &str, start: usize) -> Option<&str> {
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    for (offset, ch) in text[start..].char_indices() {
        if in_string {
            match ch {
                _ if escaped => escaped = false,
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&text[start..start + offset + ch.len_utf8()]);
                }
            }
            _ => {}
        }
    }
    None
}

/// Lenient parse: the first `{...}` of the reply. Accepts `{keep, translate}` and
/// also a flat `{term: rendering}` map (identical rendering = keep).
pub fn parse_curation(text: &str) -> Result<Curated, String> {
    let cleaned = clean_output(text);
    let start = cleaned.find('{').ok_or("resposta sem JSON")?;
    let value: Value = cleaned
        .rfind('}')
        .and_then(|end| serde_json::from_str(&cleaned[start..=end]).ok())
        .or_else(|| balanced_object(&cleaned, start).and_then(|obj| serde_json::from_str(obj).ok()))
        .ok_or("JSON do glossário inválido")?;
    let object = value.as_object().ok_or("JSON do glossário inválido")?;

    let mut curated = Curated::default();
    let push_pair = |term: &str, target: &str, curated: &mut Curated| {
        let (term, target) = (term.trim(), target.trim());
        if term.is_empty() || target.is_empty() {
            return;
        }
        if term == target {
            curated.keep.push(term.to_string());
        } else {
            curated.translate.push((term.to_string(), target.to_string()));
        }
    };
    if object.contains_key("keep") || object.contains_key("translate") {
        match object.get("keep") {
            Some(Value::Array(items)) => {
                for item in items.iter().filter_map(Value::as_str) {
                    if !item.trim().is_empty() {
                        curated.keep.push(item.trim().to_string());
                    }
                }
            }
            Some(Value::Object(map)) => curated.keep.extend(map.keys().cloned()),
            _ => {}
        }
        if let Some(Value::Object(map)) = object.get("translate") {
            for (term, target) in map {
                if let Some(target) = target.as_str() {
                    push_pair(term, target, &mut curated);
                }
            }
        }
    } else {
        for (term, target) in object {
            if let Some(target) = target.as_str() {
                push_pair(term, target, &mut curated);
            }
        }
    }
    curated.keep.sort();
    curated.keep.dedup();
    Ok(curated)
}

/// Case-sensitive occurrences of `term` across the corpus texts.
pub fn count_occurrences(texts: &[String], term: &str) -> usize {
    if term.is_empty() {
        return 0;
    }
    texts.iter().map(|text| text.matches(term).count()).sum()
}

/// Turns the curated result into automatic glossary entries.
pub fn entries_from(curated: &Curated, candidates: &Candidates, texts: &[String]) -> Vec<GlossaryEntry> {
    let counts = candidates.counts();
    let count = |term: &str| counts.get(term).copied().unwrap_or_else(|| count_occurrences(texts, term)) as u64;
    let mut seen = HashSet::new();
    let mut entries = Vec::new();
    for (term, target) in &curated.translate {
        if seen.insert(term.clone()) {
            entries.push(GlossaryEntry {
                term: term.clone(),
                kind: "translate".into(),
                target: Some(target.clone()),
                count: count(term),
                source: "auto".into(),
                missed: 0,
            });
        }
    }
    for term in &curated.keep {
        if seen.insert(term.clone()) {
            entries.push(GlossaryEntry {
                term: term.clone(),
                kind: "keep".into(),
                target: None,
                count: count(term),
                source: "auto".into(),
                missed: 0,
            });
        }
    }
    entries
}

/// Fallback when curation fails: the heuristic names, kept as-is.
pub fn heuristic_entries(candidates: &Candidates) -> Vec<GlossaryEntry> {
    candidates
        .names
        .iter()
        .map(|(term, n)| GlossaryEntry {
            term: term.clone(),
            kind: "keep".into(),
            target: None,
            count: *n as u64,
            source: "auto".into(),
            missed: 0,
        })
        .collect()
}

/// `translate` entries present in the source chunk whose target is missing from the translation.
pub fn check_misses(entries: &[GlossaryEntry], src_html: &str, dst_html: &str) -> Vec<(String, String)> {
    let src = text_of(src_html).to_lowercase();
    let dst = text_of(dst_html).to_lowercase();
    entries
        .iter()
        .filter(|entry| entry.kind == "translate")
        .filter_map(|entry| {
            let target = entry.target.as_deref()?.trim();
            if target.is_empty() || !src.contains(&entry.term.to_lowercase()) || dst.contains(&target.to_lowercase()) {
                return None;
            }
            Some((entry.term.clone(), target.to_string()))
        })
        .collect()
}

impl Engine {
    fn emit_glossary(self: &Arc<Self>, id: &str, status: &str) {
        self.emit(events::GLOSSARY, json!({ "projectId": id, "status": status }));
        self.emit_project(id, true);
    }

    /// Runs the automatic extraction in the background (`translation://glossary`).
    pub fn start_glossary(self: &Arc<Self>, id: &str) {
        {
            let mut jobs = self.glossary_jobs.lock_safe();
            if !jobs.insert(id.to_string()) {
                return;
            }
        }
        let _ = self.store.set_glossary_status(id, "running");
        self.emit_glossary(id, "running");
        let engine = Arc::clone(self);
        let id = id.to_string();
        tauri::async_runtime::spawn(async move {
            let result = engine.build_glossary(&id).await;
            let status = match result {
                Ok(count) => {
                    engine.log(&id, "info", format!("Glossário automático pronto: {count} termos. Revise na aba Glossário."));
                    "ready"
                }
                Err(err) => {
                    engine.log(&id, "warn", format!("Glossário automático incompleto: {err}"));
                    "error"
                }
            };
            let _ = engine.store.set_glossary_status(&id, status);
            {
                let mut jobs = engine.glossary_jobs.lock_safe();
                jobs.remove(&id);
            }
            engine.emit_glossary(&id, status);
        });
    }

    async fn build_glossary(&self, id: &str) -> Result<usize, String> {
        let chapters = self.store.corpus(id)?;
        let (found, texts) = tauri::async_runtime::spawn_blocking(move || {
            let texts = corpus_texts(&chapters);
            let dictionary = load_dictionary();
            (candidates(&texts, dictionary.as_ref()), texts)
        })
        .await
        .map_err(|err| err.to_string())?;
        if found.is_empty() {
            self.store.glossary_replace_auto(id, &[])?;
            return Ok(0);
        }
        let fallback = |engine: &Engine, reason: String| -> Result<usize, String> {
            engine.store.glossary_replace_auto(id, &heuristic_entries(&found))?;
            Err(format!("{reason} Os nomes detectados foram mantidos sem curadoria."))
        };
        if !self.provider.account().logged_in {
            return fallback(self, "ChatGPT não conectado.".into());
        }
        let model = self.store.project(id)?.model;
        let reply = self
            .provider
            .translate(&model, "none", CURATION_INSTRUCTIONS, &curation_prompt(&found))
            .await;
        match reply {
            Ok(out) => {
                let _ = self.store.log_usage(Some(id), &model, 0, &out.usage);
                self.clear_limit();
                match parse_curation(&out.text) {
                    Ok(curated) => {
                        let entries = entries_from(&curated, &found, &texts);
                        self.store.glossary_replace_auto(id, &entries)?;
                        Ok(entries.len())
                    }
                    Err(err) => fallback(self, format!("{err}.")),
                }
            }
            Err(err) => {
                if let ProviderError::UsageLimit(message) = &err {
                    self.set_limit(message);
                }
                fallback(self, format!("{err}."))
            }
        }
    }

    /// Adds or edits a manual entry (manual entries survive regeneration).
    pub fn glossary_upsert(&self, id: &str, term: &str, kind: &str, target: Option<String>) -> Result<Vec<GlossaryEntry>, String> {
        let term = term.trim();
        if term.is_empty() {
            return Err("Termo vazio".into());
        }
        let kind = match kind {
            "keep" | "translate" => kind,
            other => return Err(format!("Tipo inválido: {other}")),
        };
        let target = target.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
        if kind == "translate" && target.is_none() {
            return Err("Informe a tradução do termo".into());
        }
        let texts = corpus_texts(&self.store.corpus(id)?);
        let previous_missed = self
            .store
            .glossary(id)?
            .into_iter()
            .find(|e| e.term == term)
            .map(|e| e.missed)
            .unwrap_or(0);
        self.store.glossary_upsert(
            id,
            &GlossaryEntry {
                term: term.to_string(),
                kind: kind.to_string(),
                target: if kind == "keep" { None } else { target },
                count: count_occurrences(&texts, term) as u64,
                source: "manual".into(),
                missed: previous_missed,
            },
        )?;
        self.store.glossary(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synthetic_book() -> Vec<String> {
        let mut chapters = Vec::new();
        for i in 0..12 {
            chapters.push(format!(
                "<p>The morning came. Zorian walked to the Cyoria Academy with Kael, and Zorian said nothing. \
                 Later that day Kael asked whether the Cyoria Academy had opened. Then Zorian cast a spell of \
                 shaping with his mana, the mana flowing like water through the time loop. \
                 Everyone in the Cyoria Academy knew Kael. The time loop restarted and Zorian woke again. \
                 He felt the shaping skill grow, using xorvexian runes and more xorvexian runes {i}.</p>"
            ));
        }
        chapters
    }

    #[test]
    fn heuristics_find_names_phrases_and_terms() {
        let texts = corpus_texts(&synthetic_book());
        let dictionary: HashSet<String> = "the morning came walked academy with and said nothing later that day asked whether had opened then cast spell shaping his mana flowing like water through time loop everyone knew restarted woke again felt skill grow using runes more"
            .split_whitespace()
            .map(str::to_string)
            .collect();
        let found = candidates(&texts, Some(&dictionary));
        let names: Vec<&str> = found.names.iter().map(|(n, _)| n.as_str()).collect();
        assert!(names.contains(&"Zorian"), "names: {names:?}");
        assert!(names.contains(&"Kael"));
        assert!(!names.contains(&"The") && !names.contains(&"Then"));
        let phrases: Vec<&str> = found.phrases.iter().map(|(n, _)| n.as_str()).collect();
        assert!(phrases.contains(&"Cyoria Academy"), "phrases: {phrases:?}");
        let invented: Vec<&str> = found.invented.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(invented, vec!["xorvexian"]);
        assert!(found.common.iter().any(|(p, _)| p == "time loop"), "common: {:?}", found.common);
        let prompt = curation_prompt(&found);
        assert!(prompt.contains("- Zorian") && prompt.contains("- Cyoria Academy") && prompt.contains("- xorvexian"));
    }

    #[test]
    fn curation_parsing_is_lenient() {
        let reply = "Sure! Here it is:\n```json\n{\"keep\": [\"Zorian\", \"Kael\", \"\"], \"translate\": {\"Cyoria Academy\": \"Academia de Cyoria\", \"time loop\": \"loop temporal\", \"Zach\": \"Zach\"}}\n```\nHope it helps {not json}";
        let curated = parse_curation(reply).unwrap();
        assert_eq!(curated.keep, vec!["Kael", "Zach", "Zorian"]);
        assert!(curated.translate.contains(&("Cyoria Academy".into(), "Academia de Cyoria".into())));
        assert_eq!(curated.translate.len(), 2);

        let flat = parse_curation("{\"Red Robe\": \"Manto Vermelho\", \"Zorian\": \"Zorian\"}").unwrap();
        assert_eq!(flat.keep, vec!["Zorian"]);
        assert_eq!(flat.translate, vec![("Red Robe".to_string(), "Manto Vermelho".to_string())]);
        assert!(parse_curation("no json here").is_err());
    }

    #[test]
    fn extraction_runs_on_create_and_manual_entries_survive() {
        use crate::translation::provider::fake::FakeProvider;
        use crate::translation::runner::tests::{create, fixture, glossary_settled};
        tauri::async_runtime::block_on(async {
            let f = fixture(1000);
            let provider: &FakeProvider = &f.provider;
            provider.set_responder(Box::new(|_, prompt| {
                prompt.contains("PROPER NAME CANDIDATES").then(|| {
                    Ok("```json\n{\"keep\":[\"Alpha\"],\"translate\":{\"Beta Order\":\"Ordem Beta\"}}\n```".to_string())
                })
            }));
            let id = create(&f);
            glossary_settled(&f, &id).await;
            assert_eq!(f.engine.store.project(&id).unwrap().glossary_status, "ready");
            assert_eq!(f.host.last(events::GLOSSARY).unwrap()["status"], "ready");

            let list = f.engine.glossary_upsert(&id, "alpha", "translate", Some("alfa".into())).unwrap();
            let alpha = list.iter().find(|e| e.term == "alpha").unwrap();
            assert_eq!(alpha.source, "manual");
            assert_eq!(alpha.target.as_deref(), Some("alfa"));
            assert_eq!(alpha.count, 30, "occurrences in the source");
            assert!(f.engine.glossary_upsert(&id, "x", "translate", None).is_err());
            f.engine.start_glossary(&id);
            glossary_settled(&f, &id).await;
            let after = f.engine.store.glossary(&id).unwrap();
            assert!(after.iter().any(|e| e.term == "alpha" && e.source == "manual"), "manual entry kept");
        });
    }

    #[test]
    fn misses_are_detected() {
        let entries = vec![GlossaryEntry {
            term: "Cyoria Academy".into(),
            kind: "translate".into(),
            target: Some("Academia de Cyoria".into()),
            count: 1,
            source: "auto".into(),
            missed: 0,
        }];
        let src = "<p>He reached the Cyoria Academy.</p>";
        assert!(check_misses(&entries, src, "<p>Ele chegou à Academia de Cyoria.</p>").is_empty());
        assert_eq!(check_misses(&entries, src, "<p>Ele chegou à Cyoria Academy.</p>").len(), 1);
        assert!(check_misses(&entries, "<p>nothing</p>", "<p>nada</p>").is_empty());
    }
}
