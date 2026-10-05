//! The LLM abstraction the pipeline talks to. `siwc::SiwcProvider` is the real
//! one (Sign in with ChatGPT, `/v1/responses`); tests use `fake::FakeProvider`.

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use serde::{Deserialize, Serialize};

pub type BoxFut<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Debug, Clone, PartialEq)]
pub enum ProviderError {
    /// No tokens, invalid user, not eligible, or a 401 that survived a refresh.
    NotLoggedIn(String),
    /// `subscription_sharing_usage_limit_exceeded` (plan limit or the per-app weekly cap).
    UsageLimit(String),
    /// `subscription_sharing_usage_unavailable` (503): back off, a bounded number of times.
    Unavailable(String),
    /// Network errors, timeouts, 5xx, per-minute throttling.
    Transient(String),
    /// Hard errors (`unsupported_capability`, other 4xx).
    Fatal(String),
    Cancelled,
}

impl ProviderError {
    pub fn is_retryable(&self) -> bool {
        matches!(self, ProviderError::Transient(_) | ProviderError::Unavailable(_))
    }
}

impl std::fmt::Display for ProviderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProviderError::NotLoggedIn(msg) => write!(f, "Conecte o ChatGPT novamente: {msg}"),
            ProviderError::UsageLimit(msg) => write!(f, "Limite de uso atingido: {msg}"),
            ProviderError::Unavailable(msg) => write!(f, "Uso indisponível no momento: {msg}"),
            ProviderError::Transient(msg) => write!(f, "Falha temporária: {msg}"),
            ProviderError::Fatal(msg) => write!(f, "Erro do ChatGPT: {msg}"),
            ProviderError::Cancelled => write!(f, "Cancelado"),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TokenUsage {
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    /// Includes reasoning tokens (they bill as output).
    pub output_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
}

impl TokenUsage {
    pub fn add(&mut self, other: &TokenUsage) {
        self.input_tokens += other.input_tokens;
        self.cached_input_tokens += other.cached_input_tokens;
        self.output_tokens += other.output_tokens;
        self.reasoning_output_tokens += other.reasoning_output_tokens;
        self.total_tokens += other.total_tokens;
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ChatOutput {
    pub text: String,
    pub usage: TokenUsage,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct AccountInfo {
    pub logged_in: bool,
    pub email: Option<String>,
    pub plan_type: Option<String>,
}

pub trait ChatProvider: Send + Sync {
    /// Current login state (no network).
    fn account(&self) -> AccountInfo;
    fn translate<'a>(
        &'a self,
        model: &'a str,
        effort: &'a str,
        instructions: &'a str,
        text: &'a str,
    ) -> BoxFut<'a, Result<ChatOutput, ProviderError>>;
}

/// Credits per 1M tokens (input, cached input, output), from learn.chatgpt.com/docs/pricing.
pub fn credit_rates(model: &str) -> (f64, f64, f64) {
    let model = model.to_ascii_lowercase();
    if model.contains("astra") {
        (250.0, 25.0, 1250.0)
    } else if model.contains("sol") {
        (50.0, 2.5, 250.0)
    } else {
        (2.5, 0.25, 12.5)
    }
}

pub fn credits(model: &str, usage: &TokenUsage) -> f64 {
    let (input, cached, output) = credit_rates(model);
    let cached_tokens = usage.cached_input_tokens.clamp(0, usage.input_tokens.max(0));
    let fresh = (usage.input_tokens - cached_tokens).max(0);
    (fresh as f64 * input + cached_tokens as f64 * cached + usage.output_tokens.max(0) as f64 * output) / 1_000_000.0
}

/// Retries `call` on retryable errors, sleeping `delays[n]` before attempt n+2.
pub async fn with_retry<T, F, Fut>(delays: &[Duration], mut call: F) -> Result<T, ProviderError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, ProviderError>>,
{
    let mut attempt = 0;
    loop {
        match call().await {
            Err(err) if err.is_retryable() && attempt < delays.len() => {
                tokio::time::sleep(delays[attempt]).await;
                attempt += 1;
            }
            other => return other,
        }
    }
}

#[cfg(test)]
pub mod fake {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use super::*;

    pub type Responder = Box<dyn Fn(&str, &str) -> Option<Result<String, ProviderError>> + Send + Sync>;

    /// Deterministic stand-in. By default it "translates" every word of the
    /// fragment to `termo`, keeping the tags, so validation and verify pass.
    pub struct FakeProvider {
        pub calls: Mutex<Vec<(String, String)>>,
        pub delay: Mutex<Duration>,
        /// Optional override: `(model, prompt) -> Some(result)`; `None` falls back to the default.
        pub responder: Mutex<Option<Responder>>,
        pub logged_in: AtomicBool,
        /// Calls running right now, and the most seen at once (parallel workers).
        pub in_flight: AtomicUsize,
        pub max_in_flight: AtomicUsize,
    }

    impl FakeProvider {
        pub fn new() -> Arc<Self> {
            Arc::new(FakeProvider {
                calls: Mutex::new(Vec::new()),
                delay: Mutex::new(Duration::ZERO),
                responder: Mutex::new(None),
                logged_in: AtomicBool::new(true),
                in_flight: AtomicUsize::new(0),
                max_in_flight: AtomicUsize::new(0),
            })
        }

        pub fn set_responder(&self, responder: Responder) {
            *self.responder.lock().unwrap() = Some(responder);
        }

        pub fn call_count(&self) -> usize {
            self.calls.lock().unwrap().len()
        }
    }

    /// The fragment the pipeline asked to translate (after the header line).
    pub fn fragment_of(prompt: &str) -> String {
        let Some(at) = prompt.find("TRANSLATE THE FOLLOWING FRAGMENT") else { return prompt.to_string() };
        let rest = &prompt[at..];
        let body = rest.find("\n\n").map(|p| &rest[p + 2..]).unwrap_or(rest);
        body.split("\n\nIMPORTANT:").next().unwrap_or(body).to_string()
    }

    /// Replaces each word of the text nodes by `termo` (tags untouched).
    pub fn fake_translate_html(html: &str) -> String {
        let mut out = String::with_capacity(html.len());
        let mut in_tag = false;
        let mut word = false;
        for ch in html.chars() {
            if in_tag {
                out.push(ch);
                if ch == '>' {
                    in_tag = false;
                }
                continue;
            }
            if ch == '<' {
                in_tag = true;
                word = false;
                out.push(ch);
            } else if ch.is_alphanumeric() || matches!(ch, '\'' | '&' | ';' | '#' | '’') {
                if !word {
                    out.push_str("termo");
                    word = true;
                }
            } else {
                word = false;
                out.push(ch);
            }
        }
        out
    }

    impl ChatProvider for FakeProvider {
        fn account(&self) -> AccountInfo {
            let logged_in = self.logged_in.load(Ordering::SeqCst);
            AccountInfo {
                logged_in,
                email: logged_in.then(|| "leitor@example.com".to_string()),
                plan_type: logged_in.then(|| "plus".to_string()),
            }
        }

        fn translate<'a>(
            &'a self,
            model: &'a str,
            _effort: &'a str,
            _instructions: &'a str,
            text: &'a str,
        ) -> BoxFut<'a, Result<ChatOutput, ProviderError>> {
            Box::pin(async move {
                let delay = *self.delay.lock().unwrap();
                let now = self.in_flight.fetch_add(1, Ordering::SeqCst) + 1;
                self.max_in_flight.fetch_max(now, Ordering::SeqCst);
                if !delay.is_zero() {
                    tokio::time::sleep(delay).await;
                }
                self.in_flight.fetch_sub(1, Ordering::SeqCst);
                self.calls.lock().unwrap().push((model.to_string(), text.to_string()));
                let custom = self.responder.lock().unwrap().as_ref().and_then(|respond| respond(model, text));
                let result = custom.unwrap_or_else(|| Ok(fake_translate_html(&fragment_of(text))));
                result.map(|out| {
                    let input = text.len() as i64 / 4;
                    let output = out.len() as i64 / 4;
                    ChatOutput {
                        usage: TokenUsage {
                            input_tokens: input,
                            cached_input_tokens: 0,
                            output_tokens: output,
                            reasoning_output_tokens: 0,
                            total_tokens: input + output,
                        },
                        text: out,
                    }
                })
            })
        }
    }

    #[test]
    fn fake_keeps_block_structure() {
        use crate::translation::source::{block_tag, split_blocks};
        let out = fake_translate_html("<h1>Chapter One</h1>\n<p>Hello <em>there</em>, friend.</p>");
        assert_eq!(out, "<h1>termo termo</h1>\n<p>termo <em>termo</em>, termo.</p>");
        assert_eq!(block_tag(&split_blocks(&out)[0]).as_deref(), Some("h1"));
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;

    #[test]
    fn credits_follow_the_table() {
        let usage = TokenUsage { input_tokens: 1_000_000, cached_input_tokens: 0, output_tokens: 1_000_000, ..Default::default() };
        assert!((credits("gpt-6-luna", &usage) - 15.0).abs() < 1e-9);
        assert!((credits("gpt-6-sol", &usage) - 300.0).abs() < 1e-9);
        let cached = TokenUsage { input_tokens: 1_000_000, cached_input_tokens: 1_000_000, ..Default::default() };
        assert!((credits("gpt-6-luna", &cached) - 0.25).abs() < 1e-9);
    }

    #[test]
    fn retry_backs_off_only_on_retryable_errors() {
        tauri::async_runtime::block_on(async {
            let calls = Arc::new(Mutex::new(0));
            let counter = Arc::clone(&calls);
            let result: Result<u32, ProviderError> = with_retry(&[Duration::from_millis(1); 3], || {
                let counter = Arc::clone(&counter);
                async move {
                    let mut n = counter.lock().unwrap();
                    *n += 1;
                    if *n < 3 {
                        Err(ProviderError::Transient("x".into()))
                    } else {
                        Ok(*n)
                    }
                }
            })
            .await;
            assert_eq!(result, Ok(3));

            let calls2 = Arc::new(Mutex::new(0));
            let counter = Arc::clone(&calls2);
            let result: Result<u32, ProviderError> = with_retry(&[Duration::from_millis(1); 3], || {
                let counter = Arc::clone(&counter);
                async move {
                    *counter.lock().unwrap() += 1;
                    Err(ProviderError::UsageLimit("x".into()))
                }
            })
            .await;
            assert!(matches!(result, Err(ProviderError::UsageLimit(_))));
            assert_eq!(*calls2.lock().unwrap(), 1);
        });
    }
}
