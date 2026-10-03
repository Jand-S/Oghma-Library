# Arquitetura

O Oghma preserva novels fan-traduzidas. Uma VPS coleta o acervo e publica arquivos
estáticos no Backblaze B2, servidos pelo Cloudflare em `https://b2.jandson.me`. O app
desktop lê só esses arquivos: não fala com banco nem com API, e funciona com o servidor
desligado. Esta é a descrição do sistema como está em outubro de 2026. A proposta inicial
(Postgres + MinIO + API local, junho de 2026) está em `archive/ARCHITECTURE_PROPOSTA_2026-06.md`.

## Visão geral

```text
sites ──► VPS (oghma-rodizio) ──► Postgres + /srv/oghma ──► publish ──► B2 + Cloudflare ──► app desktop
              ▲                                                            (index.json,
              │ conectores novos                                            catálogos, bundles,
   oghma-autoconnector ──► aprovação no brain.jandson.me                    capas, ícones)
```

## Servidor (VPS)

Dois serviços systemd em `/opt/oghma`, com os dados em `/srv/oghma` (link para
`/srv/oghma-data`). O contrato de execução (comandos, variáveis, unit) está em
`backend/deploy/RUNTIME.md`.

- **`oghma-rodizio`** — coleta contínua: uma fonte por vez (ou duas em paralelo), publica
  quando termina e manda novels antigas para o armazenamento frio no B2 para liberar disco.
  - Erros transitórios (timeout, 5xx) marcam só aquele capítulo para nova tentativa; a novel
    segue. Cinco seguidos encerram a novel com erro registrado, e o resumo do rodízio mostra
    o último erro. (Antes, um timeout no capítulo 468 de Unsheathed cortava a novel e ela era
    publicada pela metade sem aviso.)
  - O catálogo guarda `source_chapter_count` quando o site anuncia o total de capítulos.
- **`oghma-autoconnector`** — fábrica de conectores. Recebe pedidos de fonte nova vindos do
  app, faz um agente de IA (Codex ou Claude Code) escrever o conector numa worktree e roda o
  portão de qualidade (`oghma probe-connector`).
  - Os agentes rodam como o usuário Unix `oghma-agent`, com ambiente por allowlist: não
    enxergam `/opt/oghma/.env` (chaves do B2, banco, `BRAIN_TOKEN`) nem `.ssh`.
  - Depois do portão, o pedido vai para aprovação no brain (`connector_deploy`). O merge, o
    push e o deploy só acontecem com aprovação humana.
  - O portão exige capítulos com texto, capa, sinopse, tags e, quando o site anuncia o total,
    uma listagem que chegue a ele (tolerância de 2%).
- **Publicação** (`oghma.publish`) — sempre sob `publish.lock`. A ordem garante que o
  `index.json` só aponta para arquivos que já existem:
  1. bundles das novels que mudaram;
  2. capas novas ou trocadas (decididas pelo SHA-256 da capa, guardado no estado);
  3. ícone da fonte (favicon, guardado com hash no nome; nova tentativa semanal se falhar);
  4. catálogo JSON da fonte;
  5. `index.json`, por último.

## Arquivos publicados

```text
index.json                                   # no-cache; aponta para tudo abaixo
catalog/<fonte>-<YYYYMMDD-HHMMSS>.json.gz    # imutável; um por fonte e por publicação
content/<fonte>/<slug>/<slug>.v<N>.tar.gz    # imutável; capítulos + imagens da novel
covers/<fonte>/<slug>.<ext>                  # cache de 1 dia
sources/<fonte>-<sha12>.<ext>                # ícone da fonte; imutável
```

- **`index.json`** — por fonte: `id`, `name`, `baseUrl`, `language` (idioma dominante),
  `iconKey`/`iconSha256`, `catalogJsonKey`/`catalogJsonSha256`, `novelCount`, `updatedAt`.
  Os campos `catalogKey`/`catalogSha256` existem por compatibilidade e apontam para o JSON.
  O catálogo SQLite deixou de ser gerado.
- **Catálogo JSON** — campos públicos por novel: título, autor, sinopse, tags e `tagKeys`,
  status, idioma, `rating` (normalizado para 0–5), `ratingVotes`, `views`, `firstSeenAt`,
  `lastChapterAt`, `sourceChapterCount`, capítulos e o bundle (chave, versão, SHA-256,
  bytes). O `extra` cru das fontes não é publicado.

## App desktop

Tauri 2 + React 19 + TypeScript. Mapa de arquivos em `STRUCTURE.md`.

- **Boot** — baixa o `index.json` e os catálogos das fontes ativas em paralelo
  (`Promise.allSettled`). O SHA-256 de cada catálogo é conferido; uma fonte que falha fica
  offline sem derrubar as outras. O cache HTTP reaproveita catálogos já baixados, porque as
  chaves são imutáveis.
- **Índice local** (`catalogIndex.ts`) — montado uma vez com todas as fontes. Busca sem
  acento em título, autor, sinopse e tags; prefixo de palavra; agrupa a mesma obra entre
  fontes (edições); calcula parecidas por tags; ordena por relevância, nota, popularidade,
  capítulos ou novidade.
- **Filtro inteligente** (`smartFilter.ts`) — uma frase vira uma intenção estruturada
  (tags incluídas e excluídas, status, idioma, faixa de capítulos, "parecido com X"), aplicada ao índice local. Cada
  resultado mostra o motivo.
  - Com login ChatGPT, a intenção vem do modelo pelo comando Rust `smart_filter_ask`. Os
    tokens nunca saem do Rust.
  - Sem login, regras locais interpretam o pedido.
  - A IA nunca escolhe novels fora do catálogo: ela só gera filtros.
- **Downloads** — ver a seção da fila abaixo. O bundle é conferido pelo SHA-256 enquanto
  é baixado. Capítulos que a fonte não entregou viram uma página "capítulo indisponível" no
  livro, e o job termina com aviso. O EPUB grava autor, sinopse e idioma do catálogo.
- **Segurança**
  - CSP estrita no `tauri.conf.json`.
  - Pasta de saída guardada no Rust (`export_root.rs`): todo caminho vindo da webview é
    canonicalizado e precisa estar dentro dela.
  - Tokens do ChatGPT gravados com permissão restrita.
- **Kindle** — ver `KINDLE.md`.

## Decisões em aberto

- **Um único gerador de EPUB.** Hoje há dois: o TS (`downloadManager.ts`, livros baixados)
  e o Rust (`translation/export.rs`, livros traduzidos). A unificação fica para quando o
  download passar para o Rust, junto com retomada por `Range` e arquivos `.part`. Mover só o
  EPUB agora obrigaria a passar o bundle inteiro pela ponte Tauri.
- **API FastAPI** (`backend/src/oghma/api`) — sem cliente no app. Só o runtime Docker antigo
  (xeonserver) a usa. Sai depois de uma semana estável só com a VPS.

## Desktop: fila de download e exportação atômica (2026-10)

Esta rodada do redesign trocou o processador de downloads antigo por uma fila com **um job ativo
por vez** e passou a gravar cada livro numa **pasta temporária de staging**. A pasta final só é
trocada de forma atômica no fim. Antes, baixar de novo reaproveitava AZW3 e capa antigos, não
reexibia livros ocultos e identificava o livro pelo título.

Arquivos:

| Lado | Arquivo | Papel |
|---|---|---|
| TS | `apps/desktop/src/services/downloadQueue.ts` | Store da fila, loop do runner e persistência. |
| TS | `apps/desktop/src/services/jobRunner.ts` | Executa um job: staging, download/conversão e commit. |
| TS | `apps/desktop/src/services/exportStaging.ts` | Ponte para os comandos Rust `begin/commit/abort_export`. |
| TS | `apps/desktop/src/app/useDownloadQueue.ts` | Hook React (`useSyncExternalStore`) sobre o singleton. |
| TS | `apps/desktop/src/services/downloadManager.ts`, `bundle.ts` | `runDownload` com `AbortSignal`, bundle por streaming e progresso em bytes. |
| Rust | `apps/desktop/src-tauri/src/staging.rs` | Staging, resolução da pasta final, troca atômica e limpeza. |
| Rust | `apps/desktop/src-tauri/src/files.rs` | `save_export_file` (capa única), `list_export_library` (camelCase, `coverPath`, asset protocol). |
| Rust | `apps/desktop/src-tauri/src/kindle.rs` | AZW3 sempre atualizado em relação ao EPUB. |
| Rust | `apps/desktop/src-tauri/src/library_meta.rs` | `reset_hidden` chamado no commit. |

> Estado em 2026-09-29: a fila e o staging estão ligados ao app. O `App.tsx` cria o singleton,
> chama `start()` depois do boot e reage a `onEvent`; as telas usam `useDownloadsController`
> (sobre `useDownloadQueue`). `prepareExportRoot` roda no `useLocalLibrary`.

### Store da fila (`downloadQueue.ts`)

- É um store sem framework, com `subscribe` e `getSnapshot`. O snapshot é
  `{ active, queued, completed, paused }`. O loop (`pump`) roda **no store**, não em efeitos React,
  e isso garante que só um job execute por vez.
- `getDownloadQueue()` cria o singleton com o runner real e `autoStart: false`. A integração chama
  `start()` depois do boot, para retomar os jobs restaurados da sessão anterior.
- **Limites:** até `MAX_QUEUED = 10` jobs na fila e `MAX_COMPLETED = 50` no histórico de concluídos.
  `enqueue` devolve `added`, `duplicate` ou `full`. A deduplicação é por `novelId`: um livro ativo ou
  já na fila não entra de novo, e a chamada devolve o job existente.
- **Ações:** `enqueue`, `cancel`, `pause`, `resume`, `move(id, "up"|"down"|"top"|"bottom")`,
  `reorder(ids)`, `retry(id)` (reenfileira no fim um job `error`, `canceled` ou `done`), `remove`,
  `clearCompleted`, `whenSettled(id)`, `onEvent` (`committed`, `failed`, `canceled`) e `idle()`.
- **Status do job:** `queued`, `downloading`, `converting`, `saving`, `paused`, `done`, `error` e
  `canceled`. O progresso fino fica em `progress.stage` (`waiting`, `preparing`, `fetching`,
  `building`, `saving`, `converting`, `committing`, `done`), com `percent`, `bytesReceived/Total`,
  `speedBps` (EWMA), `etaSec` e `chaptersDone/Total`. As atualizações só de progresso não gravam em disco.
- **Persistência:** `localStorage["oghma.queue.v1"]` guarda `{ version: 1, paused, jobs }`, ou seja,
  o job ativo mais a fila, todos zerados para `queued`. Concluídos não são persistidos.
- `jobToQueueItem` e `downloadInputFromQueueItem`/`convertInputFromQueueItem` fazem a ponte com o
  tipo antigo `QueueItem` durante a migração das telas.

### Cancelar e pausar

Cada job ativo tem um `AbortController`. O `signal` é passado para `fetch` do bundle (streaming com
gunzip e untar incrementais), `fetch` da capa, montagem do EPUB/TXT/HTML e loop de gravação
(`yieldToUi` e `throwIfAborted`). A interrupção acontece de fato: rede e disco param, e o
`runDownload` rejeita com `DOMException("AbortError")`.

- **Cancelar o ativo:** marca a intenção `cancel`, chama `abort()` e mostra o status `canceled` na
  hora. O runner cai no `catch`, chama `abort_export`, que apaga o staging, e o job vai para
  `completed` como `canceled`. A pasta do livro anterior **não é tocada**.
- **Cancelar um job na fila:** remove o job e emite `canceled`.
- **Pausar:** pausa a fila inteira. Se há um job ativo, ele é abortado com intenção `pause` e volta
  para a **cabeça** da fila como `paused`, com o progresso zerado. `resume()` reinicia a fila.
  **Pausar equivale a recomeçar:** não há retomada por HTTP Range, então o download volta do zero
  num staging novo.
- **Ponto sem volta:** depois do último `throwIfAborted`, o runner chama `commit_export`. Se o commit
  terminar, o job fica `done` mesmo que um cancel tenha chegado durante a troca.
- A conversão AZW3 nativa em si não pode ser interrompida. O `signal` é checado antes e depois dela.

### Runner (`jobRunner.ts`)

- **Download** (`kind: "download"`):
  1. `begin_export(outputRoot, novelId, title)` devolve `{ stagingDir, finalDir }`.
  2. `runDownload` grava dentro do `stagingDir`: EPUB/TXT/HTML, `cover.<ext>`, `.oghma-book.json`
     e, se pedido, o AZW3, que é gerado **dentro do staging** a partir do EPUB novo com a capa
     embutida.
  3. `commit_export(stagingDir, finalDir, novelId)`.
  4. Qualquer erro ou abort antes do commit chama `abort_export(stagingDir)`.
- **Conversão** (`kind: "convert"`, vinda da Biblioteca):
  - Se não falta nenhum formato, não faz nada.
  - Se falta **só** AZW3 e já existe EPUB, converte na própria pasta (`convert_export_to_azw3`),
    o que só acrescenta um arquivo.
  - Nos outros casos, reexporta o livro pelo staging com os formatos existentes mais os pedidos.
- Fora do Tauri (navegador e testes), `exportStaging.ts` grava direto em
  `<outputRoot>/<título sanitizado>`: `stagingDir === finalDir`, e commit e abort viram no-op.
  `abortExport` nunca apaga a pasta real nesse modo.

### Staging e troca atômica (Rust, `staging.rs`)

- **`begin_export`** cria `<outputRoot>/.oghma-staging/<novelId saneado>-<unixMillis>` e marca o
  caminho como "em uso" neste processo. A pasta final é resolvida assim:
  1. uma pasta existente cujo `.oghma-book.json` tem o **mesmo `novel_id`**. Se houver mais de uma,
     vence a que tem o nome do título;
  2. senão, `<outputRoot>/<título sanitizado>`, se estiver livre, sem manifesto ou com o mesmo id.
     A sanitização é igual à do `sanitizeFileName` do TS, e o nome nunca começa com ponto;
  3. senão, `<título> (2)`, `(3)` e assim por diante, quando o nome já pertence a outro `novel_id`.
- **`commit_export`**:
  1. Valida que o staging está em `<root>/.oghma-staging/` e que a pasta final é filha direta de
     `<root>` e não começa com ponto. Caminhos fora disso são recusados.
  2. Renomeia a pasta final para `<root>/.oghma-trash/<nome>-<ms>`.
  3. Renomeia o staging para a pasta final.
  4. Se o passo 3 falhar, desfaz o passo 2 (rollback). Se o próprio rollback falhar, a mensagem de
     erro diz onde ficou a versão anterior.
  5. Apaga a lixeira e as pastas `.oghma-*` vazias.

  O resultado é que a pasta do livro é **substituída por inteiro**: não sobra AZW3, capa nem arquivo
  de uma versão antiga. Se o rename falhar porque há arquivo aberto (Windows), o erro pergunta se
  algum arquivo está aberto e a versão anterior fica intacta.
- **`abort_export`** apaga o staging e não faz nada se ele não existir.
- **`cleanup_export_root`**, chamado pelo TS via `prepareExportRoot` em `useLocalLibrary`, remove
  sobras de `.oghma-staging` e `.oghma-trash` deixadas por crash ou app morto. Caminhos marcados
  como em uso neste processo são preservados.
- `list_export_library` ignora pastas que começam com ponto, então staging e lixeira nunca
  aparecem na biblioteca.

### Identidade do livro por `novel_id`

- A identidade vem do manifesto `.oghma-book.json` de cada pasta (`novel_id`, `title` com acentos,
  análise de conteúdo). O título e o nome da pasta deixaram de ser a chave.
- `list_export_library` devolve itens em camelCase: `novelId`, `title`, `folderName`, `coverPath` e
  `mtimeMs`. `coverDataUrl` só é preenchido com `includeCoverData: true`, para compatibilidade.
- Metadados da biblioteca (favorito, status de leitura, tags, `hidden`) usam a chave
  `novel:<id>` quando há manifesto. O caminho da pasta continua como chave legada, e
  `metaForEntry` prefere `novel:<id>` e cai no caminho se não achar. Renomear a pasta ou mudar o
  título não perde mais os metadados.
- O id de conteúdo do Kindle (`kindle_content_seed`) também parte do `novel_id` do manifesto.

### Capas

- **Uma capa por pasta:** quando `save_export_file` grava `cover.*`, ele apaga os `cover.*` de outras
  extensões na mesma pasta. `pick_cover` escolhe de forma determinística o `cover.{jpg,jpeg,png,webp}`
  mais recente e desempata por extensão e nome.
- **Asset protocol em vez de base64:** `list_export_library` devolve `coverPath` e libera cada
  arquivo no escopo do asset protocol em tempo de execução (`asset_protocol_scope().allow_file`).
  O escopo estático no `tauri.conf.json` fica vazio (`scope: []`). O TS converte o caminho com
  `convertFileSrc` e acrescenta `?v=<mtimeMs>` para furar o cache quando a capa muda
  (`coverUrlForRow` em `services/localFiles.ts`).
- Para isso funcionar, o `tauri.conf.json` precisa de `app.security.assetProtocol.enable: true` e o
  `Cargo.toml` precisa da feature `protocol-asset` do crate `tauri`. Um sem o outro quebra o build.

### AZW3 sempre atualizado

- `ensure_fresh_azw3` (`kindle.rs`) reaproveita um AZW3 existente só se ele for **pelo menos tão
  novo quanto o EPUB** (mtime). Se não existir EPUB, o AZW3 é mantido. Caso contrário, regera o AZW3
  a partir do EPUB, com a capa de `pick_cover`, e apaga os outros `.azw3` da pasta para sobrar uma
  única versão. `convert_export_to_azw3` e `send_to_kindle` usam essa função.
- A conversão grava num arquivo temporário oculto (`.<nome>.oghma-tmp-<sufixo>.azw3`) e depois o
  renomeia. Assim uma conversão interrompida nunca deixa um AZW3 parcial que pareça atualizado.
- Com o staging, o download grava o AZW3 junto com o EPUB novo. O caso de "EPUB novo com AZW3 velho"
  só pode vir de pastas gravadas antes do redesign ou de edição manual, e o mtime detecta.

### Reexibir ao baixar de novo

- `commit_export` chama `library_meta::reset_hidden` para as chaves `novel:<id>` e para as formas
  do caminho final (bruta, com `~` expandido e canônica). Um livro que o usuário tinha ocultado volta
  a aparecer quando é baixado de novo.
- Os arquivos já estão no lugar nesse momento, então uma falha ao atualizar os metadados só gera
  aviso no log e não falha a exportação.

### Testes

```bash
cd apps/desktop
npx vitest run src/test/downloadQueue.test.ts src/test/downloadManager.test.ts src/test/bundle.test.ts src/test/localLibrary.test.ts
export PATH="$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml    # staging, files, kindle, library_meta
```
