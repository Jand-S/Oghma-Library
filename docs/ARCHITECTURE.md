# Arquitetura proposta

## Objetivo

Criar uma plataforma local para catalogar, baixar, preservar e exportar novels traduzidas por fas. A primeira versao deve baixar livros/capitulos e gerar EPUB. Versoes futuras podem adicionar biblioteca pessoal, envio para Kindle, traducao por IA e audiobook por TTS.

## Decisoes recomendadas

### Desktop

Recomendacao: Tauri 2 + React + TypeScript + Rust.

Motivos:

- Tauri usa o WebView nativo do sistema, o que tende a gerar aplicativos menores que Electron.
- Permite frontend moderno com React/TypeScript sem abrir mao de integracoes nativas via Rust.
- O site oficial do Tauri destaca suporte cross-platform para Linux, macOS, Windows, Android e iOS, com logica em Rust e frontend web.

Alternativa forte: Qt 6/QML.

Motivos para considerar:

- Qt e maduro, nativo e muito usado em aplicacoes desktop complexas.
- A documentacao oficial cobre C++, QML e Python, alem de tooling para Figma/Qt Design Studio.

Trade-off:

- Qt pode ser excelente para uma aplicacao extremamente nativa, mas tende a exigir mais disciplina visual em QML/C++ e mais cuidado com licenciamento/distribuicao.
- Tauri combina melhor com a ideia de interface moderna baseada em design do Figma e portabilidade leve.

### Scraper/backend

Recomendacao: Python como primeira linguagem do crawler.

Componentes:

- Crawlee Python para fila, retries, estado de crawl e suporte a navegacao com browser quando necessario.
- Playwright para paginas que dependem de JavaScript.
- httpx + BeautifulSoup/lxml para paginas HTML estaticas.
- PostgreSQL para metadados, estado de sincronizacao e busca.
- MinIO ou outro S3 compativel para capas, HTML bruto, EPUBs gerados e assets.
- Meilisearch ou Tantivy futuramente para busca textual rapida.

O Crawlee tambem existe para JavaScript/Python e sua documentacao oficial descreve suporte a scraping, browsers, proxies e bloqueios. Isso encaixa bem com sites que variam entre HTML estatico e conteudo renderizado.

### Armazenamento

Modelo recomendado:

- PostgreSQL: entidades e estado.
- MinIO/S3: arquivos grandes e versionaveis.
- Disco local em `/srv/oghma`: caminho base no servidor.

Estrutura sugerida no servidor:

```text
/srv/oghma/
  data/
    postgres/
    minio/
    meilisearch/
  exports/
  logs/
  tmp/
```

Buckets sugeridos:

- `oghma-covers`: capas.
- `oghma-raw`: HTML bruto e snapshots.
- `oghma-content`: capitulos normalizados.
- `oghma-exports`: EPUBs e futuros MOBI/AZW3/PDF.

## Modelo de dominio

Entidades principais:

- `SourceSite`: site suportado, configuracao de rate limit, tipo de renderizacao e politicas.
- `Novel`: obra, titulo, aliases, descricao, capa, autores, tags, status, idioma e fonte.
- `Chapter`: capitulo, ordem, titulo, URL canonica, hash de conteudo, data de publicacao e estado de download.
- `CrawlRun`: execucao do scraper, com inicio/fim, status, contadores e erros.
- `CrawlCursor`: estado incremental por site/novel/listagem.
- `Asset`: capa, HTML bruto, conteudo normalizado e exportacoes.
- `Export`: arquivo gerado, formato, capitulos inclusos e caminho no storage.

## Scraping incremental

O scraper nao deve varrer o site inteiro a cada execucao. Cada conector deve ter uma estrategia incremental:

- Guardar URLs conhecidas, hashes de conteudo, ETag/Last-Modified quando disponiveis e data da ultima verificacao.
- Priorizar paginas de listagem recentes, paginas de "ultimos capitulos" e paginas de novel ja cadastradas.
- Parar a paginacao quando encontrar uma sequencia configuravel de capitulos ja conhecidos.
- Revalidar periodicamente obras antigas com baixa frequencia.
- Salvar HTML bruto antes da normalizacao para permitir reprocessamento sem novo download.

## Arquitetura dos conectores

Cada site deve implementar uma interface comum:

```text
SiteConnector
  id
  display_name
  base_url
  capabilities
  rate_limit
  discover_novels()
  fetch_novel(source_id_or_url)
  list_chapters(novel)
  fetch_chapter(chapter)
  normalize_chapter(raw_page)
```

Capacidades:

- `static_html`: funciona com HTTP simples.
- `javascript_required`: precisa de Playwright.
- `api_available`: possui API aberta ou endpoint interno estavel.
- `incremental_listing`: tem pagina de recentes/listagens util para atualizacao.

## Fluxo de dados

1. Scheduler dispara um `CrawlRun` por site.
2. O conector consulta paginas recentes ou API.
3. Novels/capitulos novos sao comparados com o banco.
4. HTML bruto e assets sao salvos no storage.
5. Conteudo e normalizado, limpo e salvo como documento estruturado.
6. Metadados sao indexados para busca.
7. O desktop consulta a API local, mostra catalogo e solicita download/exportacao.

## API local

Mesmo com app desktop, vale ter uma API local no servidor para separar responsabilidades.

Endpoints iniciais:

- `GET /sources`
- `GET /novels?source=&query=&status=`
- `GET /novels/{id}`
- `GET /novels/{id}/chapters`
- `POST /downloads`
- `POST /exports`
- `GET /devices/kindle/status`
- `POST /devices/kindle/send`
- `GET /exports/{id}`

Regras novas para Kindle:

- O app so deve habilitar envio direto para itens concluidos com `EPUB` disponivel.
- O backend converte `EPUB` para `AZW3` antes da copia para o dispositivo.
- O envio deve ser tratado como job assincrono com progresso consultavel.

Stack sugerida: FastAPI + Pydantic + SQLAlchemy.

## Interface desktop

Primeira versao:

- Assistente de primeira abertura para servidor, pasta de saida, fontes ativas, preferencias padrao e sincronizacao inicial dos indices.
- Tela de fontes suportadas, com selecao de sites.
- Busca global por titulo.
- Pagina da novel com capa, descricao, tags, status e lista de capitulos.
- Selecao de capitulos, download e exportacao EPUB.
- Historico de downloads/exportacoes.
- Preferencias: pasta local, servidor, limites de download, tema e idioma.

Versoes futuras:

- Biblioteca pessoal com livros importados pelo usuario.
- Sincronizacao com servidor local.
- Envio para Kindle via USB com conversao automatica para AZW3.
- Fila de traducao por IA.
- Fila de TTS/audiobook.

## Estrutura atual do desktop

Depois da rodada de refatoracao estrutural, o mock desktop ficou dividido assim:

```text
apps/desktop/src/
  App.tsx
  appUi.tsx
  appConfig.ts
  windowControls.ts
  mockBackend.ts
  services/
    backendClient.ts
  types.ts
```

Responsabilidades:

- `App.tsx`: orquestracao de estado, efeitos, retries, onboarding e composicao das telas.
- `appUi.tsx`: componentes visuais e constantes de navegacao/etapas do onboarding.
- `appConfig.ts`: defaults, persistencia local, normalizacao e resiliencia da configuracao salva.
- `windowControls.ts`: ponte dos botoes de janela entre navegador comum e runtime Tauri.
- `services/backendClient.ts`: contrato do cliente de dados consumido pelo frontend.
- `mockBackend.ts`: implementacao mockada atual do contrato de backend.

### Regra de acoplamento adotada

O frontend nao deve mais depender diretamente da implementacao mockada para definir sua arquitetura.

A regra agora e:

- a UI conversa com um contrato `BackendClient`
- o mock e apenas uma implementacao desse contrato
- o backend HTTP real deve substituir o mock por outra implementacao do mesmo contrato

Isso reduz o risco de reescrever telas quando trocarmos o mock por chamadas reais.

### Persistencia local

A configuracao local do app agora segue uma etapa de normalizacao antes de entrar no estado React.

Objetivos dessa camada:

- tolerar `localStorage` corrompido
- aceitar schema parcial durante futuras migracoes
- preencher defaults sem quebrar a inicializacao
- manter uma unica fonte de verdade para os defaults do onboarding e dos Ajustes

## Jobs e concorrencia

Regras iniciais:

- Concorrencia entre sites e permitida.
- Concorrencia dentro do mesmo site deve ser baixa e configuravel.
- Usar backoff em 429/5xx.
- Respeitar delay minimo por dominio.
- Registrar user-agent identificavel do projeto.
- Guardar logs por execucao e erros por capitulo.

## Qualidade de conteudo

Normalizacao minima:

- Remover menus, anuncios, rodapes e botoes de navegacao.
- Preservar paragrafos, quebras importantes, notas de tradutor e imagens relevantes.
- Detectar capitulos vazios ou muito curtos.
- Gerar hash do texto normalizado para detectar mudancas.
- Salvar origem e data de captura.

## Referencias oficiais consultadas

- Tauri: https://tauri.app/
- Qt Docs: https://doc.qt.io/
- Crawlee: https://crawlee.dev/
- MinIO Docs: https://docs.min.io/aistor/

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

> Estado em 2026-09-29: a fila e o staging estão implementados e testados, mas a ligação com as
> telas acontece na integração do P2. Até lá, o `App.tsx` ainda usa `useDownloadProcessor`.
> `prepareExportRoot` já roda no `useLocalLibrary`.

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
