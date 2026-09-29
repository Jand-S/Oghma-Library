# Oghma usability — 2026-09-29

- **old** = v1.0.0 — http://127.0.0.1:4174/
- **new** = wip (current branch) — http://127.0.0.1:4173/

Targets: download `4: Blade of Reino do Norte e o Kraken` (query `kraken`); library book `Quokka: 50: Villainess of São Magnólia` (query `quokka`). New output folder: `/Users/bench/Livros Oghma`.

Counting starts in the listed start view; keystrokes include typed search/path text (identical across versions) and shortcuts.

| Task | Start | old | new |
| --- | --- | --- | --- |
| Download one book | discover | 3 clicks + 6 keys = **9** | 3 clicks + 6 keys = **9** |
| Cancel the active download | discover | 2 clicks + 0 keys = **2** | 2 clicks + 0 keys = **2** |
| Re-download a book already in the library | library | 4 clicks + 6 keys = **10** | 4 clicks + 6 keys = **10** |
| Send a library book to Kindle | library | 4 clicks + 6 keys = **10** | 4 clicks + 6 keys = **10** |
| Change the output folder | discover | 2 clicks + 60 keys = **62** | 2 clicks + 60 keys = **62** |

## Notes

- old / Re-download a book already in the library: no re-download action in Library; done via Discover search + queue
- old / Change the output folder: free-text input (no folder picker); Ctrl/Cmd+A does not select (app cancels selectstart) -> cleared with End + Backspace per char
- new / Re-download a book already in the library: no re-download action in Library; done via Discover search + queue
- new / Change the output folder: free-text input (no folder picker); Ctrl/Cmd+A does not select (app cancels selectstart) -> cleared with End + Backspace per char

## Step logs

- **old · Download one book** (ok, 1105 ms): click locator('#query').first() → type “kraken” → click locator('.book-grid .book-card:not(.skeleton-card)').filter({ has: loc → click getByRole('button', { name: 'Adicionar a fila', exact: true })
- **old · Cancel the active download** (ok, 581 ms): click locator('[data-testid="nav-downloads"]').or(getByRole('navigation', {  → click locator('.download-row.downloading').first().getByRole('button', { nam
- **old · Re-download a book already in the library** (ok, 1180 ms): click locator('[data-testid="nav-discover"]').or(getByRole('navigation', { n → click locator('#query').first() → type “quokka” → click locator('.book-grid .book-card:not(.skeleton-card)').filter({ has: loc → click getByRole('button', { name: 'Adicionar a fila', exact: true })
- **old · Send a library book to Kindle** (ok, 318 ms): click locator('#library-query').first() → type “quokka” → click locator('.library-book-card').filter({ has: locator('.book-info strong → click getByRole('tab', { name: /^Fila/ }) → click getByRole('button', { name: 'Enviar para o Kindle', exact: true })
- **old · Change the output folder** (ok, 8638 ms): click locator('[data-testid="nav-settings"]').or(getByRole('navigation', { n → click getByLabel('Pasta de saida', { exact: true }).or(locator('.field-group → key ControlOrMeta+A → key End → key Backspace×33 → type “/Users/bench/Livros Oghma”
- **new · Download one book** (ok, 1122 ms): click locator('[data-testid="discover-search"], #query').first() → type “kraken” → click locator('[data-testid="discover-card"], .book-grid .book-card:not(.ske → click getByRole('button', { name: /^(Adicionar [aà] fila\|Baixar)$/ })
- **new · Cancel the active download** (ok, 580 ms): click locator('[data-testid="nav-downloads"]').or(getByRole('navigation', {  → click locator('[data-testid="download-active"], .download-row.downloading').
- **new · Re-download a book already in the library** (ok, 1216 ms): click locator('[data-testid="nav-discover"]').or(getByRole('navigation', { n → click locator('[data-testid="discover-search"], #query').first() → type “quokka” → click locator('[data-testid="discover-card"], .book-grid .book-card:not(.ske → click getByRole('button', { name: /^(Adicionar [aà] fila\|Baixar)$/ })
- **new · Send a library book to Kindle** (ok, 324 ms): click locator('[data-testid="library-search"], #library-query').first() → type “quokka” → click locator('[data-testid="library-card"], .library-book-card').filter({ h → click getByRole('tab', { name: /^Fila/ }) → click getByRole('button', { name: /^Enviar (para o\|ao) Kindle$/ })
- **new · Change the output folder** (ok, 4629 ms): click locator('[data-testid="nav-settings"]').or(getByRole('navigation', { n → click getByLabel('Pasta de saida', { exact: true }).or(locator('.field-group → key ControlOrMeta+A → key End → key Backspace×33 → type “/Users/bench/Livros Oghma”
