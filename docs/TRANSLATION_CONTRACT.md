# Translation contract: Rust engine ↔ React UI

Both agents follow this file exactly. Before changing anything in it, propose the change in your final report.

## Facts verified on 2026-10-02 (spike against the real ChatGPT Plus account)

Codex CLI version: 0.157.1. The app-server JSON schema is in `codex-schema/` (outside the repo); `codex_app_server_protocol.v2.schemas.json` is the source of truth. The spike script is `codex-spike/spike.py` (outside the repo).

**Process and handshake**
- Spawn `codex app-server` (stdio JSONL, JSON-RPC style).
- `initialize {clientInfo:{name,title,version}}`, then send the notification `initialized {}`.

**Account**
- `account/read {}` returns `{account:{type:"chatgpt", email?, planType:"plus"}|null, requiresOpenaiAuth}`.
- `requiresOpenaiAuth` is true even when the account is logged in. Use `account != null` to decide whether the user is logged in.

**Usage limits**
- `account/rateLimits/read` returns `{rateLimits:{primary:{usedPercent:int, windowDurationMins:300, resetsAt:unixSec}, secondary:{usedPercent, windowDurationMins:10080, resetsAt}, planType, rateLimitReachedType|null}, rateLimitsByLimitId?}`.
- Label each window by `windowDurationMins`, never by whether it is `primary` or `secondary`.
- The server also pushes the notification `account/rateLimits/updated {rateLimits}`.

**Starting a thread**
- `thread/start` params: `{model, cwd:<empty temp dir>, approvalPolicy:"never", sandbox:"read-only", ephemeral:true, baseInstructions:<translator prompt>}`.
- Response: `result.thread.id`.
- Passing `baseInstructions` replaces Codex's coding prompt. It cut input from about 14.5k to about 10.4k tokens per turn; the rest is built-in tool schemas.

**Running a turn**
- `turn/start {threadId, effort:"none", summary:"none", input:[{type:"text", text}]}`.
- Verified: `effort:"none"` gives 0 reasoning tokens, `"low"` also gave 0 in the spike, and `"minimal"` is REJECTED (`unsupported_value`).
- Notifications that follow:
  - `item/completed` with `params.item` = `{type:"agentMessage", text}`. Its text is the final output.
  - `thread/tokenUsage/updated` with `params.tokenUsage.last` = `{inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens}`.
  - `turn/completed` with `params.turn.status`, which is `"completed"` or `"failed"`.
  - `error` with `params.error.message` (a JSON string). It arrives on failures.
- Cancel a turn with `turn/interrupt {threadId, turnId}`.

**Login when no account is present**
- `account/login/start {type:"chatgpt"}` returns `{loginId, authUrl}`. Open `authUrl` with the opener plugin.
- Wait for the notification `account/login/completed {loginId, success, error?}`.
- Cancel with `account/login/cancel {loginId}`.

**Models**
- `gpt-6-luna` is "Rápido" and the default. `gpt-6-sol` is "Qualidade".
- Both translated a test paragraph well in about 4–5 s.
- Spawn one long-lived app-server and use a NEW ephemeral thread per chunk.

**Cost model**
- Each turn has a fixed overhead of about 10k input tokens (mostly cached), so use larger chunks: target about 1,500 words and never split a paragraph.
- 8 test turns moved `usedPercent` of the 5h window from 0 to 1.

## Rust engine: `apps/desktop/src-tauri/src/translation/`

Module files: `mod.rs`, `codex.rs`, `store.rs`, `source.rs`, `pipeline.rs`, `glossary.rs`, `runner.rs`, `verify.rs`, `pilot.rs`, `export.rs`, `commands.rs`.

**Codex client abstraction**
- `trait CodexClient` is async-capable, implemented by `AppServerClient`. A `FakeCodexClient` is used for tests.
- Methods:
  - `account()`
  - `rate_limits()`
  - `translate(model, effort, base_instructions, text) -> {text, usage}`
  - `login_start()`
  - `login_cancel(id)`

**Storage**
- SQLite file: `app_data_dir()/translation.db`, accessed with rusqlite (already a dependency).

**Translation output**
- Write a new library book through the existing staging flow in `src-tauri/src/staging.rs` (`begin_export`/`commit_export` logic; reuse the internal functions and do not go through IPC).
- Library id: `novel_id = "<sourceNovelId>:pt-BR"`. Title: `"<Title> (PT-BR)"`.
- Copy the cover. Manifest `.oghma-book.json` fields: `novel_id`, `title`, `language:"pt-BR"`, `source_novel_id`.
- Folder: the output root is the parent of the source book folder, so the new book is a sibling.

**Reading the source**
- Read the source EPUB with the `zip` crate. Use the spine order from `OEBPS/content.opf`.
- Chapter blocks are the top-level children of `<body>` of each spine xhtml. Skip nav and cover.
- App-generated EPUBs use `chapters/chapter-N.xhtml` with an `<h1>` title followed by `<p>`s.
- Keep the block HTML as-is. The `<h1>` title is translated as a block too.

**Prompt and validation**
- Prompt contract adapted from `~/Projetos/Scripts/mol/translate.py`:
  - Keep the same number, order and type of blocks.
  - Keep `<em>`. Brazilian Portuguese. Keep quotation marks.
  - Glossary filtered to the terms that occur in the chunk, marked authoritative.
  - Pass the last 400 characters of the previous translated chunk as context, marked "do NOT translate".
- `validate`: block count must match, and the char ratio must be within 0.6–2.0. Retry up to 3 times with the rejection reason. After that, fall back to one block per request and mark the chunk `needs_review`.

**Glossary**
- Candidates come from frequency heuristics: a port of `mol/glossary.py` and `mol/terms.py`, with an embedded English stopword list.
- One curation turn asks for a JSON `{keep:[...], translate:{en:pt}}` (prompt modeled on `mol/build_glossary.py`). Parse leniently: extract the first `{...}`.
- After each chunk, check that the target of every `translate` term in the chunk appears. Log the misses as warnings.

**Runner**
- Workers take whole chapters in parallel (default 2, max 3). Inside a chapter, chunks run sequentially.
- Only one runner at a time per project.
- Auto-pause: when the 5h `usedPercent` is at or above `pauseAtPercent` (default 90), or when `rateLimitReachedType` is not null.
  - Set status to `waiting_limit`.
  - Schedule a resume for `resetsAt` plus 60 s.
  - Re-read the limits before resuming.
- ETA: chunks per minute since the session started. The 5h-window % increase since the session started is used to compute `projectedWindows` for the remaining words.

**Pilot**
- Take the first about 1,500 words of chapter 1. Run them with each model in `["gpt-6-luna","gpt-6-sol"]`.
- Record: seconds, usage tokens, `usedPercentDelta` (read limits before and after; it may be 0 for a small sample, in which case estimate from the token share), `projectedBookPercent`, and `valid`.

**Verify**
- Port of `mol/verify.py`. Report per chapter:
  - `missingChunks`
  - `paragraphMismatch`
  - `tooShort` (output under 70% of the source words)
  - `englishLeft` (more than 4% English function words)
  - `needsReview`

## Tauri commands (camelCase args, serde camelCase)

| Command | Args | Returns |
|---|---|---|
| `translation_account` | — | `{installed:bool, version?:string, loggedIn:bool, email?:string, planType?:string}` |
| `translation_login` | — | `{authUrl}` (UI opens it; completion arrives as an event) |
| `translation_login_cancel` | — | `()` |
| `translation_usage` | — | `UsageSnapshot` |
| `translation_list_projects` | — | `ProjectSummary[]` |
| `translation_create_project` | `{sourceDir, sourceNovelId?, title, coverPath?}` | `ProjectSummary` (also starts glossary extraction in the background) |
| `translation_delete_project` | `{projectId}` | `()` |
| `translation_get_project` | `{projectId}` | `ProjectDetail` |
| `translation_update_settings` | `{projectId, model?, effort?, pauseAtPercent?, workers?, scope?: {kind:"all"} \| {kind:"range", from, to}}` | `ProjectDetail` |
| `translation_start` | `{projectId}` | `()` |
| `translation_pause` | `{projectId}` | `()` |
| `translation_cancel` | `{projectId}` | `()` |
| `translation_glossary` | `{projectId}` | `GlossaryEntry[]` |
| `translation_glossary_upsert` | `{projectId, entry: {term, kind:"keep"\|"translate", target?}}` | `GlossaryEntry[]` |
| `translation_glossary_delete` | `{projectId, term}` | `GlossaryEntry[]` |
| `translation_glossary_regenerate` | `{projectId}` | `()` (async; the event fires when done) |
| `translation_run_pilot` | `{projectId}` | `()` (async; the `pilot` event fires when done) |
| `translation_pilot` | `{projectId}` | `PilotRun \| null` |
| `translation_choose_model` | `{projectId, model}` | `ProjectDetail` |
| `translation_chapter` | `{projectId, chapterIndex}` | `{index, title, sourceHtml, translatedHtml?, status, issues: string[]}` |
| `translation_retranslate` | `{projectId, chapterIndex}` | `()` |
| `translation_verify` | `{projectId}` | `VerifyReport` |
| `translation_export` | `{projectId}` | `{outputDir, title}` (builds the PT-BR book; also runs automatically when everything is done) |
| `translation_log` | `{projectId, limit?}` | `LogEvent[]` |

## Types (TS shapes; Rust mirrors them with serde camelCase)

```ts
type UsageWindow = { usedPercent: number; windowMinutes: number | null; resetsAt: number | null }; // resetsAt unix sec
type UsageSnapshot = { session: UsageWindow | null; weekly: UsageWindow | null; planType: string | null; limitReached: string | null; fetchedAt: number };
type ProjectStatus = "preparing" | "ready" | "running" | "paused" | "waiting_limit" | "done" | "exported" | "error";
type ProjectSummary = { id: string; title: string; coverUrl?: string; sourceNovelId?: string; status: ProjectStatus;
  chaptersTotal: number; chaptersDone: number; chunksTotal: number; chunksDone: number; percent: number; outputDir?: string };
type ProjectDetail = ProjectSummary & {
  model: string; effort: "none" | "low"; pauseAtPercent: number; workers: number;
  scope: { kind: "all" } | { kind: "range"; from: number; to: number };
  wordsTotal: number; wordsDone: number; needsReview: number; errors: number; pending: number;
  chaptersInProgress: string[]; chunksPerMinute: number | null; etaSeconds: number | null;
  sessionUsageDelta: number | null; projectedWindows: number | null; resumeAt: number | null; glossaryStatus: "idle" | "running" | "ready" | "error" };
type GlossaryEntry = { term: string; kind: "keep" | "translate"; target: string | null; count: number; source: "auto" | "manual"; missed: number };
type PilotSample = { model: string; label: string; seconds: number; inputTokens: number; outputTokens: number; usedPercentDelta: number | null;
  projectedBookPercent: number | null; valid: boolean; html: string };
type PilotRun = { createdAt: number; sourceHtml: string; words: number; samples: PilotSample[]; status: "running" | "done" | "error"; error?: string };
type VerifyReport = { ok: boolean; chapters: { index: number; title: string; issues: string[] }[] };
type LogEvent = { at: number; level: "info" | "warn" | "error"; message: string };
```

## Events (`app.emit`, payload in camelCase)

| Event | Payload | When |
|---|---|---|
| `translation://usage` | `UsageSnapshot` | On every rate-limit update, after each chunk, and every 60 s while the app is open (only if the account is logged in) |
| `translation://project` | `ProjectDetail` | Whenever progress or status changes (throttled to at most 2/s per project) |
| `translation://log` | `{projectId, event: LogEvent}` | Whenever an event is logged |
| `translation://pilot` | `{projectId, run: PilotRun}` | When the pilot changes |
| `translation://glossary` | `{projectId, status}` | When glossary extraction changes |
| `translation://account` | `{loggedIn, email?, planType?}` | After the login completes |
| `translation://exported` | `{projectId, outputDir, title}` | After the PT-BR book is committed (the UI then refreshes the library) |

## UI (React, `apps/desktop/src/features/translation/`)

- **TS client:** `services/translationClient.ts` wraps `invoke` and `listen` (`@tauri-apps/api/core`, `@tauri-apps/api/event`). Outside Tauri it returns an "unavailable" account state, so the screen shows "Disponível no app desktop".
- **Layout:** follow the approved plan (section "UI de Tradução" of the translation plan, kept outside the repo).

## CHANGE (2026-10-02, supersedes the Codex translation path above)

The app translates through the official **Sign in with ChatGPT** "token sharing" flow. Calls go straight to `https://api.openai.com/v1/responses` and are paid from the user's Plus plan. The Codex app-server is used **only** to read usage % and reset times, as an optional extra.

Verified with spike `~/Documents/Oghma-wt/siwc-spike/{login.py,call.py,burst.py}`:

- **Login.** OAuth PKCE over a loopback redirect. No pre-registration and no secret.
  - Authorize URL: `https://auth.openai.com/api/accounts/authorize`. Parameters: `client_id=dynamic_agent_client` (first time only; afterwards use the issued `oaiapp_…` id), `agent_name_hint=Oghma Library`, `ext_agent_host_id=urn:uuid:<persisted per install>`, `response_type=code`, `redirect_uri=http://127.0.0.1:<port>/callback`, `scope=openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, `resource=https://api.openai.com/v1`, `state`, `nonce`, `code_challenge_method=S256`, `code_challenge`.
  - The callback carries `code`, `state` and `client_id=oaiapp_…`. Save that `client_id` for later logins.
  - Token exchange: POST, form-encoded, to `https://auth.openai.com/api/accounts/oauth/token` with `grant_type=authorization_code, client_id, code, code_verifier, redirect_uri, resource=https://api.openai.com/v1`.
  - The token response contains `access_token` (`expires_in` 3600), `refresh_token`, `id_token`, `earliest_refresh_at`, `scope` and `token_type`.
  - Refresh: `grant_type=refresh_token`, with `client_id`, `refresh_token` and `resource`.
  - Store the tokens in the macOS Keychain (`keyring` crate), or in an app-data file with mode 0600 if the Keychain is unavailable. Never log them.
  - Take the email from the `id_token` claims, decoding the JWT payload without verifying it.
- **Translate.** POST `https://api.openai.com/v1/responses` with header `Authorization: Bearer <access_token>`.
  - Body: `{model, instructions:<translator prompt>, input:[{role:"user", content:[{type:"input_text", text}]}], reasoning:{effort:"none"}, stream:true, store:false}`.
  - Required: `stream:true` and `store:false`. Not allowed: system-role messages, `temperature` and `max_output_tokens`.
  - Read the SSE stream:
    - `response.output_text.delta` delivers the text in pieces.
    - `response.completed` carries `response.usage` = `{input_tokens, output_tokens, output_tokens_details.reasoning_tokens}`.
    - `response.failed` or `error` means the request failed.
  - Measured: about 119 input tokens for a short paragraph, against about 10,400 through Codex. 800 words take about 26 s with ~1,040 tokens in and ~1,350 out, and `reasoning_tokens` is 0.
  - `GET /v1/models` returned an empty list. Use the fixed models `gpt-6-luna` (Rápido) and `gpt-6-sol` (Qualidade).
- **Errors** (from the response or the stream):
  - `subscription_sharing_usage_limit_exceeded` (429): set status `waiting_limit`.
  - `subscription_sharing_usage_unavailable` (503): back off with a limit.
  - `subscription_sharing_user_not_eligible` (403) or `subscription_sharing_invalid_user` (401): the user must log in again.
  - `subscription_sharing_unsupported_capability` (400): treat as a hard error.
  - On 401, refresh the token once, then ask for a new login.
- **Usage display.** There is **no** official API for a token-sharing quota. OpenAI said so in openai/sign-in-with-chatgpt-devkit#3. So:
  - (a) If the Codex CLI is installed and logged in, read `account/rateLimits/read` (see above) and show it labeled "Plano ChatGPT (conforme o Codex)". It is not verified whether direct usage shows up there: a 12k-word burst did not move the integer %.
  - (b) Always show the app's own counters: words and tokens translated in the last 5h and in the last 7 days, stored in `usage_log`.
  - (c) Link to `https://chatgpt.com/settings/usage`.
- **Auto-pause.**
  - When the Codex snapshot is available and its 5h `usedPercent` is at or above `pauseAtPercent`, pause, and resume at `resetsAt` + 60 s.
  - On `usage_limit_exceeded`, set `waiting_limit` and resume at the Codex `resetsAt` if known; otherwise retry every 15 min.
  - `pauseAtPercent` only applies when the Codex snapshot exists.
- **Chunk size.** Overhead is tiny now, so go back to about 1,000 words per chunk, as in mol.

### Contract changes

**Trait.** `trait ChatProvider { async fn translate(model, effort, instructions, text) -> Result<{text, usage}, ProviderError> }`. `SiwcProvider` is the real implementation and `FakeProvider` is used for tests. `CodexUsage` is a separate optional reader (spawn `codex app-server` only to read limits; reuse the reader code).

**Commands.**
- `translation_account` returns `{loggedIn, email?, planType?, codexInstalled:bool, codexLoggedIn:bool}`.
- `translation_login` runs the whole PKCE flow in Rust: it starts the loopback listener, opens the browser itself with the opener plugin, waits, then emits `translation://account`. It returns `()`.
- New `translation_logout` deletes the stored tokens.

**Types.**
- `UsageSnapshot` = `{ codex: { session, weekly, planType, limitReached } | null, local: { words5h, tokens5h, words7d, tokens7d }, settingsUrl: "https://chatgpt.com/settings/usage", fetchedAt }`.
- `ProjectDetail`: `resumeAt` is the scheduled retry time. `sessionUsageDelta` and `projectedWindows` are only filled when the Codex snapshot exists; otherwise they are null.

**Pilot.** Fill `usedPercentDelta` from Codex when available. In every case, also report `inputTokens` / `outputTokens` and `projectedBookTokens`.

## UPDATE (2026-10-02, limits research)

Source: learn.chatgpt.com/docs/sign-in-with-chatgpt and learn.chatgpt.com/docs/pricing.

**Shared pool.** Sign in with ChatGPT usage "counts toward your existing plan limits". Plus/Pro let apps "draw on the ChatGPT Work and Codex usage in their plan". That is the same 5h and 7-day windows Codex reports, so the Codex `rateLimits` snapshot DOES include our usage.
- Label it simply "Plano ChatGPT". Drop "conforme o Codex".
- The 12k-word burst didn't move the integer % because it was tiny in credits.

**Credits per 1M tokens (Standard):**

| Model | Input | Cached | Output |
|---|---|---|---|
| GPT-6 Luna | 2.5 | 0.25 | 12.5 |
| GPT-6.1 Sol | 50 | 2.5 | 250 |
| GPT-6 Astra | 250 | 25 | 1250 |

- Sol costs about 20× Luna. Reasoning tokens bill as output, which is why `effort: "none"` matters.

**Credits field.** Compute `credits` per request from usage with this table and store it in `usage_log`.
- Pilot/projections: show "créditos estimados" for the whole book per model.
- When the Codex snapshot exists, also show the % delta.

**Per-app weekly cap.** The user may set one in ChatGPT Settings → Usage. The limit error can therefore come from that cap, not the plan, and the app cannot tell which. Mention this in the `waiting_limit` banner tooltip.

**Default model.** Luna stays the default. Use Sol only when chosen after the pilot.

## FINAL DECISION (2026-10-02, owner): no usage % at all; limit warning only

- **Remove** the `CodexUsage` reader and every Codex dependency. The app uses only the Sign in with ChatGPT flow.
- **`UsageSnapshot`** becomes `{ local: { words5h, credits5h, words7d, credits7d }, limitReached: null | { at: number, window: "five_hour" | "weekly" | "unknown", nextRetryAt: number }, settingsUrl }`.
  - These are the app's own counters, plus the limit state.
- **On `subscription_sharing_usage_limit_exceeded`:**
  - set the project status to `waiting_limit` and fill `limitReached`;
  - retry automatically every 15 min, using a tiny probe request or the next real chunk;
  - clear the state on the first success.
  - If the error message or body mentions "five-hour" or "weekly", set `window` accordingly; otherwise use `"unknown"`.
- **Drop:**
  - the `pauseAtPercent` setting;
  - `sessionUsageDelta` and `projectedWindows`;
  - the % columns in the pilot.
- **Keep:**
  - credits and tokens per request;
  - `projectedBookCredits` in the pilot, labeled "créditos estimados";
  - Qualidade costs about 20× Rápido.
- **UI:**
  - Account card shows: "Usando seu plano ChatGPT", the email, a "Gerenciar uso" button (opens `settingsUrl`) and "Sair".
  - Limit banner: "Limite do ChatGPT atingido (janela de 5h / semanal). Tentando de novo em 12 min." The tooltip mentions the per-app cap.
  - A small, unobtrusive line shows the app's own counters: "Traduzido nas últimas 5h: N palavras (~X créditos)".

## UPDATE (glossary confidence and suggestions)

- **`GlossaryEntry.confidence`** is a number from 0 to 100. Manual entries always have 100.
- **`ProjectDetail.glossaryMinConfidence`** defaults to 60. It is changed with `translation_update_settings {projectId, glossaryMinConfidence}`.
  - Automatic entries below the minimum are not sent to the model.
  - They also don't count in "missed" checks.
- **`translation_glossary_suggest {projectId, terms[]}`** returns `[{term, kind:"keep"|"translate", target|null, reason}]`.
  - It makes one model call for all terms, with `effort:"none"`.
  - Up to 3 source sentences of context are sent per term.
- **Confidence formula:**
  - Base: 60 if the term was curated by the model, 35 if it came only from heuristics.
  - Frequency: plus 0 to 25, on a log scale; 50 or more occurrences give +25.
  - Signal adjustment:
    - names: +15 × the share of mid-sentence capitals
    - phrases and invented words: +10
    - lowercase bigrams: −15

## UPDATE (owner correction): confidence = "auto-approved", every term is used

- **All glossary entries are used in translation**, whatever their confidence.
- `ProjectDetail.glossaryHideAt` defaults to 80 and replaces `glossaryMinConfidence`.
  - Entries with `confidence >= glossaryHideAt` are auto-approved and hidden from the review list.
  - Lower ones are shown for review.
- Confidence now comes from the curation model: `"confidence": {term: 0-100}` in the curation JSON. The heuristic formula is only a fallback.
- Manual entries and accepted suggestions are 100 (approved).

## UPDATE (owner): glossary confidence removed from the UI

- The UI no longer filters, hides or badges by confidence. All terms are listed and all are used.
- The curation prompt no longer asks for a confidence value.
- The backend still stores `confidence` and `glossaryHideAt`, but they are unused and can be removed later.
- Kept: `translation_glossary_suggest`, used per term and in batch for auto "keep" terms, at most 40 per call.
