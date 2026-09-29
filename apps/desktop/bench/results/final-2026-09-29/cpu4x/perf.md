# Oghma bench — 2026-09-29

Runs: 7 · CPU throttle: 4× · Catalog: 5000 novels (primary site) · Library: 500 books · Search queries: `kraken, zephyr, quokka, mago, sombra`

- **old** = v1.0.0 — http://127.0.0.1:4174/
- **new** = redesign (current branch) — http://127.0.0.1:4173/

## Static assets (dist-bench, vite build --minify)

| Metric | old | new |
| --- | --- | --- |
| JS total raw / gzip / brotli (KB) | 344.0 / 100.8 / 86.9 | 499.2 / 156.1 / 135.9 |
| JS entry raw / gzip / brotli (KB) | 327.5 / 96.4 / 83.0 | 395.5 / 124.7 / 107.7 |
| CSS raw / gzip / brotli (KB) | 54.7 / 10.1 / 9.0 | 103.8 / 19.9 / 17.5 |
| CSS rules total / style rules / selectors | 584 / 578 / 696 | 941 / 906 / 990 |
| CSS @media / @keyframes / @layer | 5 / 1 / 0 | 7 / 12 / 12 |
| CSS declarations | 2062 | 3402 |
| CSS hex colour literals (unique) | 250 (154) | 34 (28) |
| CSS var() refs / custom props defined | 322 / 24 | 2008 / 154 |
| CSS !important | 2 | 0 |

## Runtime (median / p95 over runs)

| Metric | old median / p95 | new median / p95 | Δ median |
| --- | --- | --- | --- |
| Cold load: FCP (ms) | 124.0 / 128.0 | 152.0 / 164.4 | +23% |
| Cold load: shell mounted (ms) | 97.7 / 99.4 | 108.4 / 113.9 | +11% |
| Cold load: shell visible / splash gone (ms) | 1,289 / 1,304 | 978.1 / 991.8 | -24% |
| Cold load: first card (ms) | 1,267 / 1,278 | 746.0 / 761.0 | -41% |
| Cold load: 24 cards (ms) | 1,267 / 1,278 | 746.0 / 761.0 | -41% |
| TBT cold load (ms) | 874.0 / 883.7 | 337.0 / 345.7 | -61% |
| Search keystroke → results, per-run median (ms) | 61.6 / 62.8 | 184.8 / 188.1 | +200% |
| Search keystroke → results, per-run max (ms) | 315.8 / 316.5 | 457.3 / 463.0 | +45% |
| Search clear → full list (ms) | 389.5 / 392.7 | 506.2 / 509.7 | +30% |
| TBT during search (ms) | 6,749 / 7,036 | 1,729 / 1,746 | -74% |
| Scroll FPS (3 s scripted) | 60.0 / 60.0 | 60.0 / 60.0 | +0% |
| Scroll frame p95 (ms) | 16.7 / 16.8 | 16.8 / 16.8 | +1% |
| Scroll jank frames (>1.5× median) | 0.0 / 0.0 | 0.0 / 0.0 | — |
| Library nav → 24 cards (ms) | 147.7 / 149.5 | 104.9 / 106.4 | -29% |
| Library nav → all books rendered (ms) | 147.7 / 149.5 | 104.9 / 106.4 | -29% |
| TBT library nav (ms) | 91.0 / 92.7 | 52.0 / 53.7 | -43% |
| JS heap idle shell (MB, after GC) | 18.3 / 18.3 | 18.9 / 18.9 | +3% |
| JS heap after Library (MB, after GC) | 21.6 / 21.6 | 24.2 / 24.2 | +12% |
| DOM nodes idle shell | 1,341 / 1,341 | 1,250 / 1,250 | -7% |
| DOM nodes after Library | 8,556 / 8,556 | 10,915 / 10,915 | +28% |

Pooled search keystroke latency (all measured keystrokes): old p50 62.0 ms / p95 314.7 ms (n=98) · new p50 188.7 ms / p95 456.9 ms (n=98)

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
