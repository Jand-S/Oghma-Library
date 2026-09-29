# Oghma desktop bench

Benchmark and visual-comparison harness for the UI redesign. It runs the **old** build (v1.0.0) and the
**new** build (this branch) side by side in Playwright/Chromium, using fake data and a fake Tauri runtime:

- **Fixtures**: a deterministic 5,000-novel catalog, bundles and covers, served with `page.route`.
  Nothing goes to the live B2 server, and every other external request is blocked.
- **Fake Tauri runtime** (`tauri-shim.js`): gives the app a 500-book library, a Kindle and a fake file system.
- **Seeded setup**: onboarding is marked as done, or cleared for the onboarding screenshots.

Playwright is a dependency of this folder only, not of the app.

## Setup (once)

```bash
cd apps/desktop/bench
npm ci                              # or: npm i
npx playwright install chromium
node fixtures/generate.mjs          # -> fixtures/out/ (gitignored, regenerated automatically if missing)
```

The old version needs a v1.0.0 checkout. By default it is `../../../../v1`, relative to this folder
(the `Oghma-wt/v1` worktree). Set `OGHMA_V1_DIR=/path/to/v1` to use another location.

```bash
git worktree add ../../../../v1 v1.0.0          # if you don't have it yet
(cd ../../../../v1 && npm ci)
(cd .. && npm ci)                               # apps/desktop
```

## Build both apps identically

Both apps set `minify:false` in `vite.config.ts`, so the benchmark overrides it on the command line:

```bash
# old (v1: app lives at the repo root)
(cd ../../../../v1 && npx vite build --minify --outDir dist-bench)
# new (apps/desktop)
(cd .. && npx vite build --minify --outDir dist-bench)
# or both:
node lib/build.mjs
```

## Serve

```bash
(cd ../../../../v1 && npx vite preview --outDir dist-bench --port 4174 --strictPort --host 127.0.0.1)   # old
(cd .. && npx vite preview --outDir dist-bench --port 4173 --strictPort --host 127.0.0.1)                # new
```

Every script also takes `--serve`, which starts both preview servers itself (or reuses ones already
running on 4174/4173). `--build` rebuilds first, and `--only old|new` runs a single version.

## Run

```bash
OUT=results/$(date +%F)

# 1. performance (median + p95 over runs) + queue/cancel test -> $OUT/perf.json, perf.md
node run.mjs --old http://127.0.0.1:4174 --new http://127.0.0.1:4173 --runs 7 --out $OUT
node run.mjs --serve --runs 7 --cpu-throttle 4 --skip-queue --out $OUT/cpu4x      # more discriminating

# 2. screenshots + side-by-side gallery -> $OUT/screens/index.html
node screens.mjs --old http://127.0.0.1:4174 --new http://127.0.0.1:4173 --out $OUT/screens
node screens.mjs --serve --platform macos --out $OUT/screens-macos                  # macOS Safari/WebKit UA

# 3. usability task paths (clicks/keystrokes) -> $OUT/usability.json, usability.md
node usability.mjs --old http://127.0.0.1:4174 --new http://127.0.0.1:4173 --out $OUT
```

### Useful options

| Script | Option | Default | Meaning |
| --- | --- | --- | --- |
| run | `--runs` | 7 | Cold-load runs per version (old/new order alternates) |
| run | `--cpu-throttle` | 1 | CDP `Emulation.setCPUThrottlingRate` |
| run | `--search` | `kraken,zephyr,quokka,mago,sombra` | Discover queries typed one character at a time |
| run | `--queue-size` / `--queue-delay` | 12 / 4000 ms | Queue test: books to enqueue; artificial delay per bundle |
| run | `--old-dist` / `--new-dist` | `<app>/dist-bench` | Where to read asset sizes from |
| screens | `--viewports` / `--dpr` | `1280x800,1120x720` / 2 | Screenshot sizes |
| screens | `--format` / `--max-mb` | `auto` / 25 | `auto` saves PNG, or JPEG at quality 80 if the PNG set is larger than `--max-mb` |
| screens | `--platform` | `windows` | `windows` (WebView2 UA), `macos` (Safari/WebKit UA) or `linux`. The shim also sets `navigator.platform` and `__TAURI_OS_PLUGIN_INTERNALS__` |
| all | `--headed` | off | Show the browser window |

## What is measured

| Metric | How |
| --- | --- |
| JS/CSS bytes | `dist-bench/assets/*.{js,css}` measured raw, gzip -9 and brotli q11 (node zlib). Entry chunks are also reported on their own |
| CSS rules | Parsed by the browser's CSSOM (`CSSStyleSheet.replaceSync`), counting nested rules as well |
| Hex literals, `var()`, `!important` | Regex over declaration blocks only, so `#id` selectors are not counted |
| Cold load | Fresh context and cache disabled for each run. An init-script MutationObserver records when the shell mounts, when the splash is gone, the first card and 24 cards (ms from navigation start) |
| TBT | Σ(long task − 50 ms) from a `longtask` PerformanceObserver, over a window: cold load (until 24 cards and shell visible), search (first keystroke → last clear) and Library navigation |
| Search keystroke → results | From the `keydown` `event.timeStamp` to the next rAF after every visible card belongs to the expected result set (same filter and sort as the app, computed in Node from the fixtures) and the card count matches. Only keystrokes that change what is visible are measured. "Clear" means select-all + Backspace until the full list is back |
| Scroll FPS | 3 s rAF-scripted scroll at 2000 px/s over 240 result cards (after clicking "Mostrar mais"). Reports FPS, p95/max frame time and jank frames (>1.5× the median frame) |
| Library | Click on the nav item → 24 cards, and → all 500 cards rendered |
| Heap | CDP `HeapProfiler.collectGarbage` ×2, then `Performance.getMetrics` (`JSHeapUsedSize`, `Nodes`), taken on the idle shell and after opening the Library |
| Queue test | Enqueues as many books as the UI allows (capped at `--queue-size`) with bundles delayed by `--queue-delay`, then cancels the active download mid-flight. Records: bundle requests still in flight and whether they finished or were aborted (`request*` events), `save_export_file` invokes after the cancel (from the shim), zombie saves for the cancelled book, the time until the next download starts, and toasts |

## Files

- `fixtures/generate.mjs` builds the fixtures in `fixtures/out/`:
  - `index.json`
  - `catalog/<site>-bench.json.gz`, in the `staticBackend.ts` shape. `acervo-alfa` has 5,000 novels and `acervo-beta` has 400. Titles include accents, tags come from the canonical taxonomy, chapter counts are log-uniform from 1 to 3000, and each novel carries at most 50 chapter entries (`--max-chapter-entries`).
  - `covers/c00..c47.png`
  - `bundles/bundle-{0..3}.tar.gz`: ustar archives with `meta.json`, `chapters/N.html` and `assets/`. Each `content/**.tar.gz` URL gets `bundle-<hash(slug)%4>`.
  - `library.json`: 500 rows shaped like the Rust `ExportLibraryItem`.
  - `manifest.json`
- `tauri-shim.js`: the fake `window.__TAURI_INTERNALS__` (`invoke`, `transformCallback`, `metadata`, `convertFileSrc`). It seeds localStorage, sets the platform, and records every call in `window.__BENCH__`. It answers these commands:
  - `save_export_file`, `open_local_path`, `list_export_library`, `delete_export_library_item`
  - `detect_kindle`, `convert_export_to_azw3`, `send_to_kindle`
  - `list_library_meta`, `save_library_meta`, `delete_library_meta`
  - `plugin:window|*`, `plugin:event|listen/unlisten/emit`, `plugin:os|*`, `plugin:dialog|open` (returns `dialogPath`), `plugin:opener|*`

  Unknown commands return `null` and are listed in `__BENCH__.unknown`.
- `lib/probe.js`: an in-page probe for milestones, long tasks, toasts and one-shot "event → DOM condition" waiters.
- `lib/fixtures.mjs` handles routes and request tracking. `lib/context.mjs` sets up the context, user agents and CDP helpers. `lib/assets.mjs` computes the bundle and CSS stats. `lib/actor.mjs` counts clicks and keystrokes. `lib/common.mjs` holds the args, stats and preview-server helpers.
- `versions.mjs`: the **only** place with selectors, accessible names and UI flows for each version.

## Updating `versions.mjs` when the redesign lands

`newVersion` already accepts `[data-testid=…]`, with the legacy CSS as fallback (`tid()`), and matches
nav names by regex (for example `Buscar|Descobrir`). Expect to change:

1. **Test ids.** Add them in the new UI (`app-shell`, `titlebar`, `nav-<view>`, `discover-search`, `discover-card`, `card-title`, `card-select`, `discover-detail`, `library-card`, `library-search`, `library-detail`, `download-row`, `download-active`, `download-queued`, `onboarding`, `kindle-connected`). Then drop the legacy fallbacks in `newDef.sel`.
2. **Splash.** Set `sel.splash` to `null` if there is no splash overlay. The "shell visible" metric then equals "shell mounted".
3. **Page size.** Set `discoverPageSize` to `null` if the grid is virtualized or infinite. `expandResults` should then scroll instead of clicking "Mostrar mais".
4. **Queue model.** Set `maxQueueSelection` and rewrite `enqueueMany` / `selectForDownload` / `addSelectedToQueue` for "1 active + queue" (for example a per-card "Baixar" button). `cancelActiveDownload` should target the active item's cancel button.
5. **Tasks.**
   - `redownload`: use the Library's "download again" action. v1 has none and has to go through Discover.
   - `changeOutputFolder`: click the folder picker. The shim answers `plugin:dialog|open` with `/Users/bench/Livros Oghma`.
   - `sendToKindle`: follow the new Library flow.
6. **Probe.** `probeWatchers()` is shared. If "cards" means something else in the new grid, override it.

## Known limitations

- Headless Chromium caps rAF at 60 Hz, so scroll FPS saturates on a fast machine. Use `--cpu-throttle 4`, or look at jank frames and TBT.
- The fixture server returns each bundle in one piece after `--queue-delay`, so there is no byte streaming. "Kept running" means the request completed after the cancel instead of failing with `net::ERR_ABORTED`.
- v1 cancels `selectstart` globally (`installInteractionGuards`), so Ctrl/Cmd+A does not select text in inputs. The usability script falls back to End + Backspace×N and says so. The search-clear benchmark uses `el.select()` because it measures how the app responds, not the gesture.
- Kindle detection in v1 is overwritten by the backend's `connected:false` at boot and corrected by the 5 s poll. The Kindle task waits up to 12 s for the indicator before it starts counting.
