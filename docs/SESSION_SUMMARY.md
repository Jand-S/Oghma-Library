# Resumo da sessão — integração B2/CDN + desktop (2026-06-17)

Estado consolidado para o próximo agente (codex) continuar.

## O que está funcionando ponta a ponta

1. **Publish estático (servidor)** — `oghma.publish` gera e sobe para o B2:
   - `catalog/<site>-<ts>.sqlite.gz` (catálogo SQLite, uso pesado futuro)
   - `catalog/<site>-<ts>.json.gz` (catálogo leve consumido pelo desktop) **[novo]**
   - `content/<site>/<slug>/<slug>.v<n>.tar.gz` (bundles: `meta.json` + `chapters/<n>.html`)
   - `covers/<site>/<slug>.<ext>` (capas soltas)
   - `index.json` por último (atômico), agora com `catalogJsonKey` por site.
   - Comando: `docker compose run --rm crawler python -m oghma.publish --source central-novel --out /srv/oghma/publish`
   - **Atenção:** o código fica embutido na imagem Docker — após editar `src/**`, rodar `docker compose build` antes do publish.

2. **Distribuição B2 + Cloudflare** — bucket `oghma-acervo`, domínio `https://b2.jandson.me`.
   - **CORS resolvido:** Cloudflare → Rules → Transform Rules → *Modify Response Header* →
     regra "All incoming requests" → Set static `Access-Control-Allow-Origin: *`.
     (Sem isso o webview dá `Failed to fetch`; curl funciona porque não aplica CORS.)

3. **Desktop lê do acervo real** — `apps/desktop/src/services/staticBackend.ts`:
   - `index.json` → para cada site com `catalogJsonKey`, baixa `catalog.json.gz`, faz gunzip nativo
     (`DecompressionStream`) e mapeia para os tipos da UI. Sem SQLite/WASM no cliente.
   - Selecionado em `main.tsx` conforme `serverUrl` (mock se `VITE_USE_MOCK=1`).
   - 26 novels aparecendo com capas. `serverUrl` padrão = `https://b2.jandson.me`.

4. **Motor de download (testado e ligado na fila)**:
   - `services/bundle.ts`: baixa `.tar.gz`, gunzip + untar minimalista (sem deps), extrai
     `meta.json` + `chapters/*.html`; gera TXT e HTML autocontido.
   - `services/downloadManager.ts`: orquestra fetch → gera saídas → salva (fs do Tauri se
     disponível, senão download no navegador); reporta progresso. `Novel` agora tem `bundleKey`.
   - Testes: `bundle.test.ts` (5) e `downloadManager.test.ts` (4) — rodam com `npm test`.

5. **UI** — estado de erro de bootstrap repaginado e centralizado; Ajustes acessível mesmo com
   erro; títulos removidos de Fontes/Biblioteca/Ajustes; seção "Endpoints planejados" removida;
   onboarding responsivo; drag da fila com efeito "flutuar" + linha de destino; desmarca após
   adicionar à fila + pulso no ícone Downloads.

## Validação possível neste ambiente
- `tsc --noEmit` verde. `vitest` **não roda** no sandbox Linux (falta binário nativo do rolldown;
  npm bloqueado) — rodar `npm test` na máquina Windows.

## Pendências (prioridade aproximada)
1. **Evoluir exportadores**: EPUB basico ja e gerado no desktop; PDF ainda usa HTML intermediario ate termos renderizador dedicado.
   Requer `@tauri-apps/plugin-fs` (npm + Cargo + capabilities) para gravar em disco; sem ele cai no
   download do navegador.
2. **EPUB/PDF reais** — hoje TXT é real e EPUB/PDF geram HTML autocontido como base.
3. **Drag completo** — abrir lacuna física entre os cards + animação atravessando a tela até a aba
   Downloads (hoje: linha de destino + pulso no ícone).
4. **Backfill de capas** — 3+ novels sem `cover_path` (retry/backoff no crawl).
5. **Catálogo completo / multi-site** — além das 26; descoberta via `/lista-a-z/`, AJAX para
   novels longas, cron mensal, e segundo site (Novel Mania).
6. **Testes do desktop** — `App.test.tsx` foi restaurado parcialmente (8 de ~15 testes) após
   corrupção; faltam ~7 (downloads/sources/queue).

## ⚠️ Importante: corrupção de arquivos + git
Durante a sessão, vários arquivos grandes foram **truncados/corrompidos** pelo sync do mount
(`App.tsx`, `appUi.tsx`, `styles.css`, `types.ts`, `mockBackend.ts`, `App.test.tsx`). Tudo foi
recuperado, mas **o repositório não tinha commits** — sem rede de segurança. Regra: **commit local
frequente** (`git add -A` / `git commit -m "..."`), não precisa push. Ver `docs/GIT_CHECKPOINTS.md`.

## Arquivos-chave criados/alterados nesta sessão
- `backend/src/oghma/publish/{catalog,runner}.py` — emissão do `catalog.json.gz`.
- `backend/docs/MONITOR_PUBLISH_BUTTON.md` — guia do botão de publish no `/monitor` (para o codex).
- `apps/desktop/src/services/{staticBackend,bundle,downloadManager}.ts` (+ testes).
- `apps/desktop/src/{App,appUi,main,types,appConfig,styles.css}` — UI + wiring + CSS restaurado.
- `.gitignore`, `docs/GIT_CHECKPOINTS.md`, este arquivo.
