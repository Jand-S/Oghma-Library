# Oghma bench — 2026-09-29

Runs: 7 · CPU throttle: 4× · Catalog: 5000 novels (primary site) · Library: 500 books · Search queries: `kraken, zephyr, quokka, mago, sombra`

- **old** = v1.0.0 — http://127.0.0.1:4174/
- **new** = wip (current branch) — http://127.0.0.1:4173/

## Static assets (dist-bench, vite build --minify)

| Metric | old | new |
| --- | --- | --- |
| JS total raw / gzip / brotli (KB) | 344.0 / 100.8 / 86.9 | 368.6 / 107.6 / 92.6 |
| JS entry raw / gzip / brotli (KB) | 327.5 / 96.4 / 83.0 | 352.1 / 103.2 / 88.7 |
| CSS raw / gzip / brotli (KB) | 54.7 / 10.1 / 9.0 | 57.6 / 10.5 / 9.3 |
| CSS rules total / style rules / selectors | 584 / 578 / 696 | 610 / 604 / 726 |
| CSS @media / @keyframes / @layer | 5 / 1 / 0 | 5 / 1 / 0 |
| CSS declarations | 2062 | 2171 |
| CSS hex colour literals (unique) | 250 (154) | 265 (163) |
| CSS var() refs / custom props defined | 322 / 24 | 344 / 24 |
| CSS !important | 2 | 2 |

## Runtime (median / p95 over runs)

| Metric | old median / p95 | new median / p95 | Δ median |
| --- | --- | --- | --- |
| Cold load: FCP (ms) | 124.0 / 124.0 | 124.0 / 128.0 | +0% |
| Cold load: shell mounted (ms) | 96.3 / 98.3 | 97.9 / 98.4 | +2% |
| Cold load: shell visible / splash gone (ms) | 1,299 / 1,310 | 1,300 / 1,305 | +0% |
| Cold load: first card (ms) | 1,274 / 1,283 | 1,272 / 1,278 | -0% |
| Cold load: 24 cards (ms) | 1,274 / 1,283 | 1,272 / 1,278 | -0% |
| TBT cold load (ms) | 884.0 / 887.7 | 880.0 / 883.0 | -0% |
| Search keystroke → results, per-run median (ms) | 61.4 / 62.9 | 61.8 / 62.6 | +1% |
| Search keystroke → results, per-run max (ms) | 317.8 / 321.6 | 316.7 / 321.7 | -0% |
| Search clear → full list (ms) | 389.1 / 391.1 | 388.6 / 392.7 | -0% |
| TBT during search (ms) | 6,804 / 6,860 | 6,810 / 6,844 | +0% |
| Scroll FPS (3 s scripted) | 60.0 / 60.0 | 60.0 / 60.0 | +0% |
| Scroll frame p95 (ms) | 16.7 / 16.8 | 16.7 / 16.8 | +0% |
| Scroll jank frames (>1.5× median) | 0.0 / 0.0 | 0.0 / 0.0 | — |
| Library nav → 24 cards (ms) | 151.5 / 154.8 | 149.2 / 165.6 | -2% |
| Library nav → all books rendered (ms) | 151.5 / 154.8 | 149.2 / 165.6 | -2% |
| TBT library nav (ms) | 95.0 / 98.4 | 93.0 / 109.2 | -2% |
| JS heap idle shell (MB, after GC) | 18.3 / 18.3 | 18.3 / 18.3 | +0% |
| JS heap after Library (MB, after GC) | 21.6 / 21.6 | 21.6 / 21.6 | +0% |
| DOM nodes idle shell | 1,341 / 1,341 | 1,341 / 1,341 | +0% |
| DOM nodes after Library | 8,556 / 8,556 | 8,556 / 8,556 | +0% |

Pooled search keystroke latency (all measured keystrokes): old p50 62.8 ms / p95 315.3 ms (n=98) · new p50 61.8 ms / p95 313.5 ms (n=98)

## Queue load test (enqueue max, cancel active mid-download)

| Check | old | new |
| --- | --- | --- |
| Books requested / accepted by UI | — / — | — / — |
| Bundle requests in flight at cancel | — | — |
| Cancelled bundle request kept running (finished after cancel) | — | — |
| Cancelled bundle request aborted | — | — |
| save_export_file invokes after cancel (any book) | — | — |
| save_export_file for the CANCELLED book after cancel | — | — |
| Next download started after cancel (ms) | — | — |
| Max concurrent bundle requests | — | — |
| Toasts after cancel | — | — |

Notes: times are from the in-page event timestamp to the next animation frame after the DOM matched (MutationObserver). FPS is capped by the headless compositor (~60 Hz) — compare relative values only. TBT = Σ(longtask − 50 ms) in the window.
