# Oghma bench — 2026-09-29

Runs: 7 · CPU throttle: 1× · Catalog: 5000 novels (primary site) · Library: 500 books · Search queries: `kraken, zephyr, quokka, mago, sombra`

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
| Cold load: FCP (ms) | 48.0 / 48.0 | 48.0 / 48.0 | +0% |
| Cold load: shell mounted (ms) | 31.2 / 34.8 | 31.4 / 33.5 | +1% |
| Cold load: shell visible / splash gone (ms) | 611.8 / 618.1 | 613.2 / 617.2 | +0% |
| Cold load: first card (ms) | 332.4 / 344.2 | 328.8 / 334.8 | -1% |
| Cold load: 24 cards (ms) | 332.4 / 344.2 | 328.8 / 334.8 | -1% |
| TBT cold load (ms) | 139.0 / 146.9 | 138.0 / 139.0 | -1% |
| Search keystroke → results, per-run median (ms) | 19.6 / 20.4 | 20.3 / 20.5 | +3% |
| Search keystroke → results, per-run max (ms) | 78.3 / 84.6 | 77.7 / 78.5 | -1% |
| Search clear → full list (ms) | 104.8 / 119.3 | 120.8 / 122.8 | +15% |
| TBT during search (ms) | 993.0 / 1,029 | 991.0 / 1,031 | -0% |
| Scroll FPS (3 s scripted) | 60.0 / 60.0 | 60.0 / 60.0 | +0% |
| Scroll frame p95 (ms) | 16.7 / 16.8 | 16.7 / 16.8 | +0% |
| Scroll jank frames (>1.5× median) | 0.0 / 0.0 | 0.0 / 0.0 | — |
| Library nav → 24 cards (ms) | 53.4 / 64.5 | 61.8 / 73.1 | +16% |
| Library nav → all books rendered (ms) | 53.4 / 64.5 | 61.8 / 73.1 | +16% |
| TBT library nav (ms) | 1.0 / 11.7 | 9.0 / 21.1 | +800% |
| JS heap idle shell (MB, after GC) | 18.4 / 18.4 | 18.4 / 18.4 | +0% |
| JS heap after Library (MB, after GC) | 21.6 / 21.6 | 21.6 / 21.6 | +0% |
| DOM nodes idle shell | 1,341 / 1,341 | 1,341 / 1,341 | +0% |
| DOM nodes after Library | 8,556 / 8,556 | 8,556 / 8,556 | +0% |

Pooled search keystroke latency (all measured keystrokes): old p50 19.8 ms / p95 77.8 ms (n=98) · new p50 20.3 ms / p95 76.9 ms (n=98)

## Queue load test (enqueue max, cancel active mid-download)

| Check | old | new |
| --- | --- | --- |
| Books requested / accepted by UI | 12 / 12 | 12 / 12 |
| Bundle requests in flight at cancel | 1 | 1 |
| Cancelled bundle request kept running (finished after cancel) | true | true |
| Cancelled bundle request aborted | false | false |
| save_export_file invokes after cancel (any book) | 4 | 6 |
| save_export_file for the CANCELLED book after cancel | 2 | 3 |
| Next download started after cancel (ms) | 3098 | 3122 |
| Max concurrent bundle requests | 1 | 1 |
| Toasts after cancel | “Download cancelado.”<br>“1: Blade of Montanha Azul salvo em ~/Documents/Oghma Library”<br>“1: Saint of Torre de Marfim salvo em ~/Documents/Oghma Libra” | “Download cancelado.”<br>“1: Blade of Montanha Azul salvo em ~/Documents/Oghma Library”<br>“1: Saint of Torre de Marfim salvo em ~/Documents/Oghma Libra” |

Notes: times are from the in-page event timestamp to the next animation frame after the DOM matched (MutationObserver). FPS is capped by the headless compositor (~60 Hz) — compare relative values only. TBT = Σ(longtask − 50 ms) in the window.
