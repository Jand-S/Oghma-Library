# Oghma bench — 2026-09-29

Runs: 7 · CPU throttle: 1× · Catalog: 5000 novels (primary site) · Library: 500 books · Search queries: `kraken, zephyr, quokka, mago, sombra`

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
| Cold load: FCP (ms) | 48.0 / 59.2 | 56.0 / 56.0 | +17% |
| Cold load: shell mounted (ms) | 31.0 / 41.2 | 35.2 / 36.5 | +14% |
| Cold load: shell visible / splash gone (ms) | 613.4 / 637.0 | 482.4 / 483.3 | -21% |
| Cold load: first card (ms) | 329.7 / 356.0 | 201.7 / 205.7 | -39% |
| Cold load: 24 cards (ms) | 329.7 / 356.0 | 201.7 / 205.7 | -39% |
| TBT cold load (ms) | 135.0 / 140.4 | 42.0 / 46.0 | -69% |
| Search keystroke → results, per-run median (ms) | 19.7 / 20.5 | 151.5 / 155.3 | +669% |
| Search keystroke → results, per-run max (ms) | 77.7 / 78.7 | 213.4 / 214.9 | +175% |
| Search clear → full list (ms) | 110.4 / 122.6 | 246.3 / 253.8 | +123% |
| TBT during search (ms) | 977.0 / 993.6 | 279.0 / 296.0 | -71% |
| Scroll FPS (3 s scripted) | 60.0 / 60.0 | 60.0 / 60.0 | +0% |
| Scroll frame p95 (ms) | 16.7 / 16.8 | 16.7 / 16.8 | +0% |
| Scroll jank frames (>1.5× median) | 0.0 / 0.0 | 0.0 / 0.0 | — |
| Library nav → 24 cards (ms) | 61.0 / 64.7 | 30.7 / 31.3 | -50% |
| Library nav → all books rendered (ms) | 61.0 / 64.7 | 30.7 / 31.3 | -50% |
| TBT library nav (ms) | 8.0 / 12.1 | 0.0 / 0.0 | -100% |
| JS heap idle shell (MB, after GC) | 18.4 / 18.4 | 18.9 / 18.9 | +3% |
| JS heap after Library (MB, after GC) | 21.6 / 21.6 | 24.2 / 25.9 | +12% |
| DOM nodes idle shell | 1,341 / 1,341 | 1,250 / 1,250 | -7% |
| DOM nodes after Library | 8,556 / 8,556 | 10,915 / 10,915 | +28% |

Pooled search keystroke latency (all measured keystrokes): old p50 19.9 ms / p95 77.3 ms (n=98) · new p50 152.3 ms / p95 210.9 ms (n=98)

## Queue load test (enqueue max, cancel active mid-download)

| Check | old | new |
| --- | --- | --- |
| Books requested / accepted by UI | 12 / 12 | 12 / 11 |
| Bundle requests in flight at cancel | 1 | 1 |
| Cancelled bundle request kept running (finished after cancel) | true | false |
| Cancelled bundle request aborted | false | true |
| save_export_file invokes after cancel (any book) | 4 | 6 |
| save_export_file for the CANCELLED book after cancel | 2 | 0 |
| Next download started after cancel (ms) | 3099 | 304 |
| Max concurrent bundle requests | 1 | 1 |
| Toasts after cancel | “Download cancelado.”<br>“1: Blade of Montanha Azul salvo em ~/Documents/Oghma Library”<br>“1: Saint of Torre de Marfim salvo em ~/Documents/Oghma Libra” | “Download de 2: Hero of Vale das Almas cancelado.”<br>“2: Saint of Montanha Azul salvo na bibliotecaAbrir pasta” |

Notes: times are from the in-page event timestamp to the next animation frame after the DOM matched (MutationObserver). FPS is capped by the headless compositor (~60 Hz) — compare relative values only. TBT = Σ(longtask − 50 ms) in the window.
