# Oghma usability — 2026-09-29

- **old** = v1.0.0 — http://127.0.0.1:4174/
- **new** = redesign (current branch) — http://127.0.0.1:4173/

Targets: download `4: Blade of Reino do Norte e o Kraken` (query `kraken`); library book `Quokka: 50: Villainess of São Magnólia` (query `quokka`). New output folder: `/Users/bench/Livros Oghma`.

Counting starts in the listed start view; keystrokes include typed search/path text (identical across versions) and shortcuts.

| Task | Start | old | new |
| --- | --- | --- | --- |
| Download one book | discover | 3 clicks + 6 keys = **9** | 3 clicks + 6 keys = **9** |
| Cancel the active download | discover | 2 clicks + 0 keys = **2** | 3 clicks + 0 keys = **3** |
| Re-download a book already in the library | library | 4 clicks + 6 keys = **10** | 3 clicks + 6 keys = **9** |
| Send a library book to Kindle | library | error: locator.waitFor: Timeout 30000ms exceeded. | 3 clicks + 6 keys = **9** |
| Change the output folder | discover | 2 clicks + 60 keys = **62** | 3 clicks + 0 keys = **3** |

## Notes

- old / Re-download a book already in the library: no re-download action in Library; done via Discover search + queue
- old / Change the output folder: free-text input (no folder picker); Ctrl/Cmd+A does not select (app cancels selectstart) -> cleared with End + Backspace per char
- new / Download one book: card -> detail panel -> Baixar
- new / Re-download a book already in the library: Library card -> details -> Baixar novamente
- new / Send a library book to Kindle: Library card -> details -> Enviar ao Kindle
- new / Change the output folder: Ajustes -> Downloads -> Escolher… (native folder picker)

## Step logs

- **old · Download one book** (ok, 1139 ms): click locator('#query').first() → type “kraken” → click locator('.book-grid .book-card:not(.skeleton-card)').filter({ has: loc → click getByRole('button', { name: 'Adicionar a fila', exact: true })
- **old · Cancel the active download** (ok, 602 ms): click locator('[data-testid="nav-downloads"]').or(getByRole('navigation', {  → click locator('.download-row.downloading').first().getByRole('button', { nam
- **old · Re-download a book already in the library** (ok, 1260 ms): click locator('[data-testid="nav-discover"]').or(getByRole('navigation', { n → click locator('#query').first() → type “quokka” → click locator('.book-grid .book-card:not(.skeleton-card)').filter({ has: loc → click getByRole('button', { name: 'Adicionar a fila', exact: true })
- **old · Send a library book to Kindle** (error, — ms): 
- **old · Change the output folder** (ok, 4266 ms): click locator('[data-testid="nav-settings"]').or(getByRole('navigation', { n → click getByLabel('Pasta de saida', { exact: true }).or(locator('.field-group → key ControlOrMeta+A → key End → key Backspace×33 → type “/Users/bench/Livros Oghma”
- **new · Download one book** (ok, 705 ms): click locator('[data-testid="discover-search"]').first() → type “kraken” → click locator('[data-testid="book-card"]').filter({ has: locator('[data-test → click locator('[data-testid="add-to-queue"]').filter({ hasText: /^(Baixar\|B
- **new · Cancel the active download** (ok, 1648 ms): click locator('[data-testid="nav-downloads"]').or(getByRole('navigation', {  → click locator('[data-testid="download-active"]').first().getByRole('button', → click getByRole('dialog').getByRole('button', { name: 'Cancelar download', e
- **new · Re-download a book already in the library** (ok, 241 ms): click locator('[data-testid="library-search"]').first() → type “quokka” → click locator('[data-testid="library-card"]').filter({ has: locator('[data-t → click locator('[data-testid="library-redownload"]').first()
- **new · Send a library book to Kindle** (ok, 154 ms): click locator('[data-testid="library-search"]').first() → type “quokka” → click locator('[data-testid="library-card"]').filter({ has: locator('[data-t → click locator('[data-testid="library-detail"]').getByRole('button', { name: 
- **new · Change the output folder** (ok, 962 ms): click locator('[data-testid="nav-settings"]').or(getByRole('navigation', { n → click locator('[data-testid="settings-tab-downloads"]').first() → click locator('[data-testid="pick-output-folder"]').first()
