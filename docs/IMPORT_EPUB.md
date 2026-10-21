# Importar EPUBs próprios (séries) e guardá-los na conta

Este é o contrato entre servidor, Rust e app. Quem precisar mudar um nome ou um formato combina
antes, porque as três partes dependem dele.

## Objetivo

A pessoa importa EPUBs que já tem, como os 4 volumes de "Unsheathed"
(`Unsheathed - Volume 1 - Caged Sparrow.epub`). Eles aparecem na Biblioteca agrupados como uma
**série**, ficam guardados na **conta** e podem ser baixados em outro computador (Mac ou Windows).
Também vão para o **Kindle** como qualquer livro baixado.

O app **copia** o arquivo, e o original fica onde estava. Por enquanto só aceita EPUB.

Os EPUBs reais de teste não têm `dc:creator` nem capa no OPF. A importação precisa funcionar
assim mesmo (veja "Capa e autor").

## Identidade

- **Chave:** `import:<sha256 do EPUB, 64 hex minúsculos>`. Ela vale para tudo: linha do
  `library_meta`, entrada na conta, `novel_id` do marcador e content id do Kindle.
- **Mesmo arquivo, mesma chave.** Importar de novo o mesmo arquivo não duplica, e importar em
  dois computadores leva à mesma entrada.
- **O arquivo guardado é o original, byte a byte.** O EPUB não é alterado, porque o sha é a
  identidade.
- **Livro importado nasce `private: true`.** Não aparece para amigos (perfil, atividade,
  `/v1/friends/{id}/library`) nem gera atividade, mesmo que alguém mude `private` depois.

## Série

```json
"series": { "id": "series:<slug>", "name": "Unsheathed", "volume": 1 }
```

- **`slug`:** o nome em minúsculas, sem acento, com `[^a-z0-9]+` trocado por `-` e sem `-` nas
  pontas.
  - Nome sem nenhuma letra latina nem dígito (só CJK, por exemplo) daria slug vazio. Nesse caso o
    slug são os 12 primeiros dígitos hex do sha256 do nome (`series:0123456789ab`), para séries
    diferentes não se juntarem.
- **`volume`:** número com no máximo 1 casa decimal (1, 2, 2.5) ou `null`.
- **No servidor:** o id precisa casar com `series:[a-z0-9]+(-[a-z0-9]+)*`; se não casar, a série é
  descartada. O volume é arredondado para 1 casa decimal.
- **Livro sem série:** o campo fica ausente.

A série vem da primeira fonte que existir, nesta ordem:

1. **OPF do Calibre:** `<meta name="calibre:series" content="…"/>` e
   `<meta name="calibre:series_index" content="…"/>`.
2. **EPUB3:** `<meta property="belongs-to-collection" id="c">…</meta>` e
   `<meta refines="#c" property="group-position">…</meta>`.
3. **Nome do arquivo**, sem `.epub`), pela regex (sem diferenciar maiúsculas)
   `^(.+?)\s*[-–—]\s*(?:vol(?:ume)?\.?|v\.?|livro|book)\s*(\d+(?:[.,]\d)?)(?:\s*[-–—:]\s*(.+))?$`.
   O grupo 1 é a série, o 2 o volume e o 3 o subtítulo.
   Exemplo: "Unsheathed - Volume 1 - Caged Sparrow" dá série "Unsheathed", volume 1 e
   subtítulo "Caged Sparrow".

**Título**
- Se o nome do arquivo casou com a regex, o título sugerido é o subtítulo, ou
  "Volume N" quando não há subtítulo.
- Se não casou, o título é o `dc:title`, ou o nome do arquivo quando o OPF não tiver título.

A pré-visualização deixa editar título, autor, série e volume.

## Capa e autor

**Ordem da capa:**
1. A capa do EPUB, achada pelo `coverimage_id` do kindling, pela capa do EPUB3 ou pela primeira
   imagem do manifesto com "cover" no id ou no href.
2. A capa de outro livro da mesma série que já esteja na Biblioteca (pasta local).
3. Se nada disso existir, uma **capa tipográfica gerada pelo app**. O app desenha num canvas:
   nome da série, "Volume N" e o subtítulo, no design system atual. O PNG é passado ao commit
   como bytes.

**Autor:**
1. `dc:creator`.
2. O autor de outro livro da mesma série na Biblioteca.
3. O autor de uma novel do catálogo cujo título normalizado seja igual ao nome da série (o app
   faz isso com o `catalogIndex`).
4. Vazio.

## Pasta e marcador

**Pasta:** `<ExportRoot>/<Série> - Vol <N> - <Título>/`. Sem série, a pasta é só `<Título>`.
- O nome passa por `sanitize_file_name`.
- Se o nome já existir, ganha o sufixo ` (2)`, como hoje.
  - Uma pasta com o mesmo nome mas sem `.oghma-book.json` é da pessoa: a importação e o "Baixar
    da conta" nunca a reaproveitam nem a substituem (`begin_import_at`), e vão para ` (2)`. Só o
    export do catálogo ainda reaproveita pasta sem marcador (export antigo).
- A pasta é escrita pelo staging atômico que já existe (`staging.rs`).

**Arquivos dentro da pasta:**
- `<Título>.epub`: cópia byte a byte do original.
- `cover.<jpg|png|webp>`.
- `.oghma-book.json`, que leva os campos de sempre e mais estes:

```json
{
  "schema_version": 1,
  "novel_id": "import:<sha>",
  "origin": "import",
  "title": "Caged Sparrow",
  "author": "Feng Huo Xi Zhu Hou",
  "language": "pt-BR",
  "series": { "id": "series:unsheathed", "name": "Unsheathed", "volume": 1 },
  "source_file_name": "Unsheathed - Volume 1 - Caged Sparrow.epub",
  "file_sha256": "<sha>",
  "file_size": 1878579,
  "generated_at": "<rfc3339>"
}
```

## `library_meta` e a sincronização

A chave da linha é `import:<sha>`, com `onShelf=1`, `private=1`, `addedAt` e `dirty=1`.

**Snapshot** (JSON opaco no Rust; o servidor valida):

```json
{
  "title": "Caged Sparrow",
  "author": "…",
  "origin": "import",
  "language": "pt-BR",
  "series": { "id": "series:unsheathed", "name": "Unsheathed", "volume": 1 },
  "fileSize": 1878579,
  "coverExt": "jpg"
}
```

- **Cliente:** os filtros `key LIKE 'novel:%'` de pending, apply e mark-all-dirty passam a
  aceitar `novel:` **e** `import:`. Chaves de caminho de pasta continuam só locais.
- **Servidor:** a chave do fio continua sendo `key`.
  - `clean_entry` aceita `import:` seguido de 64 hex.
  - Grava `novel_id = "import:<sha>"`, a chave inteira, na mesma tabela.
  - `entry_out` devolve `key = novel_id` quando ele começa com `import:`, e `novel:<id>` nos
    outros casos.
  - `clean_snapshot` passa a aceitar `origin` (só `"import"`), `language`, `series` (id, name com
    até 200 caracteres, volume), `fileSize` e `coverExt` (`jpg|png|webp`).
  - Uma entrada `import:` é sempre gravada com `private: true`.
  - Mensagem (indicação a um amigo) com `novelId` `import:` dá `400 invalid_novel`.

## Arquivos na conta (servidor `oghma-accounts`)

**Armazenamento:** bucket **privado**, nas chaves `accounts/<user_id>/files/<sha>.epub` e
`accounts/<user_id>/files/<sha>.cover.<ext>`.

**Config:**
- `OGHMA_ACCOUNTS_FILES_BUCKET` (vazio desliga o recurso, e as rotas respondem 503
  `files_disabled`).
- `OGHMA_ACCOUNTS_S3_ENDPOINT`, `OGHMA_ACCOUNTS_S3_REGION`, `OGHMA_ACCOUNTS_S3_ACCESS_KEY_ID` e
  `OGHMA_ACCOUNTS_S3_SECRET_ACCESS_KEY`.
- `OGHMA_ACCOUNTS_FILE_QUOTA_MB` (padrão 2048) e `OGHMA_ACCOUNTS_MAX_FILE_MB` (padrão 200).
- `OGHMA_ACCOUNTS_FILE_URL_SECONDS` (padrão 900).

**Tabela `account_file`:** `id`, `user_id`, `sha256` (64), `kind` (`epub` ou `cover`), `ext`,
`size`, `created_at`, `confirmed_at` (nulo até a confirmação), `deleted_at`. É única por
(`user_id`, `sha256`, `kind`).

A cota soma o `size` dos arquivos confirmados e não apagados, mais os pendentes com menos de 1 hora.

### Rotas (sessão obrigatória; mesmo formato de erro `{"error": code}` das outras)

**`POST /v1/me/files`**
- Corpo: `{sha256, kind, ext, size}`.
- Respostas:
  - `200 {"exists": true}`, quando o arquivo já está confirmado. Não precisa enviar.
  - `200 {"exists": false, "uploadUrl": "...", "method": "PUT", "headers": {"Content-Type": "..."}, "expiresIn": 900}`.
  - `413 {"error":"file_too_large"}` e `409 {"error":"quota_exceeded","usedBytes":..,"quotaBytes":..}`.
  - `400 invalid_file`, para sha, kind, ext ou size inválidos.
- Pedidos ao mesmo tempo do mesmo arquivo não dão erro: o segundo relê a linha e responde igual.
- Pedir de novo um pendente com outra `ext` (capa png → jpg) apaga o objeto da `ext` antiga.

**`POST /v1/me/files/{sha256}/confirm`**
- Corpo: `{kind}`.
- O servidor faz HEAD no objeto e confere se o tamanho é igual.
- Confere a cota de novo, pois a reserva do pedido vale só 1 hora: a soma dos arquivos já
  confirmados com este precisa caber.
- Respostas: `200 {"ok": true}`, `409 {"error":"upload_missing"}`,
  `409 {"error":"size_mismatch"}` (este apaga o objeto) ou
  `409 {"error":"quota_exceeded","usedBytes":..,"quotaBytes":..}` (também apaga o objeto;
  `usedBytes` soma só os confirmados).

**`GET /v1/me/files/{sha256}?kind=epub|cover`**
- `200 {"downloadUrl": "...", "size": n, "ext": "..."}`.
- `404 {"error":"file_not_found"}`, só para arquivos confirmados.
- `400 {"error":"invalid_file"}`, para `kind` inválido.

**`GET /v1/me/files/usage`**
- `200 {"usedBytes": n, "quotaBytes": n, "files": n}`.

**Limpeza** (`oghma-accounts-files-gc`, comando CLI e timer diário): apaga do bucket e da tabela
- os arquivos cujo `import:<sha>` não tem entrada viva há mais de 30 dias (tombstone ou ausente);
- os pendentes não confirmados com mais de 1 dia.

## Comandos Tauri (Rust)

A webview nunca recebe caminhos arbitrários nem o token.

- **Limite de tamanho:** a pré-visualização, a importação e o envio recusam EPUB com mais de
  200 MB antes de calcular o sha (`MAX_EPUB_BYTES`; o envio devolve `file_too_large`).
- **URLs presignadas:** o cliente HTTP das transferências não segue redirecionamento; um 3xx é
  erro (`upload_failed` ou `download_failed`).
- O hash e a leitura e escrita dos arquivos nas transferências rodam em `spawn_blocking`.

```text
import_epub_pick() -> Vec<PickedFile>
    Diálogo nativo, várias seleções, filtro .epub.
    PickedFile { id: String, fileName: String, size: u64 }; os caminhos ficam no estado do Rust.
    O drop de arquivos .epub na janela (DragDrop) registra os caminhos do mesmo jeito e emite o
    evento "import-epub-dropped" com Vec<PickedFile>.

import_epub_preview(ids: Vec<String>) -> Vec<ImportPreview>
    ImportPreview {
      id, fileName, sha256, size,
      title, author: Option, language: Option,
      series: Option<{ id, name, volume: Option<f64> }>,
      seriesSource: "calibre" | "epub3" | "filename" | null,
      coverDataUrl: Option<String>,   // capa do EPUB em data:URL (miniatura até 600px)
      coverFromLibrary: Option<String>, // id do livro da Biblioteca cuja capa seria usada
      alreadyImported: Option<{ outputDir }>,
      error: Option<String>           // EPUB inválido; o item não pode ser importado
    }

import_epub_commit(items: Vec<ImportCommitItem>) -> Vec<ImportResult>
    ImportCommitItem { id, title, author, series: Option<{name, volume}>, coverPng: Option<Vec<u8>> }
    (O Rust recalcula o id da série; coverPng só é usado quando o EPUB não tem capa
     nem há capa de outro volume.)
    ImportResult { id, key: "import:<sha>", outputDir: Option, error: Option }
    Grava a pasta e o marcador, cria a linha do library_meta e chama mark_downloaded.

account_file_upload(key: String) -> UploadResult
    Envia o EPUB e a capa da pasta do livro, que precisa estar dentro do ExportRoot:
    POST /v1/me/files -> PUT na URL presignada -> confirm.
    UploadResult { key, state: "uploaded" | "already" | "failed", error: Option<code> }
    Emite "account-file-progress" { key, sent, total }.

account_file_download(key: String, title: String) -> DownloadResult
    GET /v1/me/files/{sha}?kind=epub e ?kind=cover -> baixa para o staging -> confere o sha256
    (diferente: apaga e devolve o erro "sha_mismatch") -> commit da pasta com o marcador
    (o marcador sai do snapshot da linha).
    DownloadResult { key, outputDir: Option, error: Option<code> }
    Emite "account-file-progress".

account_files_usage() -> { usedBytes, quotaBytes, files }
```

**Kindle**
- O content id de um livro `import:` vem do sha.
- O título no Kindle é `"<Série> <N> – <Título>"`, para os volumes ficarem em ordem.
- Gravar a série nos metadados do AZW3 é opcional, e só pode entrar se não quebrar o content id
  (`kindle.rs:451-457`).
- Para o envio sem fio (Send to Kindle), se o EPUB não tiver capa, o app manda uma **cópia
  temporária** com a capa embutida. O original na Biblioteca nunca muda.

## App (UI)

**Importar**
- Botão "Importar EPUB" na Biblioteca, e a janela inteira aceita soltar arquivos.
- Uma folha de pré-visualização lista cada arquivo com:
  - capa (do EPUB, de outro volume ou gerada);
  - título, autor, série e volume editáveis;
  - a origem da série;
  - o aviso "Já está na biblioteca";
  - o erro, quando houver.
- O botão "Importar N livros" grava os livros. Depois o arquivo sobe para a conta em segundo
  plano, se houver login.
  - O resultado é conferido por arquivo enviado: um arquivo sem resposta (ou com erro) fica na
    folha com o erro e não entra no aviso de sucesso.
- Volume inválido só bloqueia enquanto há série; sem série, o volume é ignorado.
- A capa gerada é redesenhada 250 ms depois de parar de digitar.
- O app nunca cria a linha `import:` pela estante (`shelfAdditions`): quem cria é o Rust ao
  importar. Toda gravação de uma linha `import:` vai com `private: true`.
- "Indicar" nunca aparece para livros `import:` (Biblioteca, perfil do amigo e a própria janela
  de indicar).

**Série na Biblioteca**
- Os itens com o mesmo `series.id` viram um card de série: "Unsheathed · 4 volumes", com as capas
  empilhadas. Fica no mesmo padrão das pilhas de edições (`stackEditions`, `libraryModel.ts`).
- O detalhe da série lista os volumes em ordem.
- Ações: "Enviar série ao Kindle" e, em cada volume, abrir, enviar e remover.

**Envio para a conta**
- O selo de cada livro mostra "Enviando…", "Na conta" ou "Não enviado · Tentar de novo".
- Sem login, o selo diz "Só neste computador".

**Outro computador**
- A linha `import:` sem pasta vira um item da estante com "Baixar da conta". Ele chama
  `account_file_download` e não usa o catálogo.

**Cota:** Ajustes › Conta mostra "Livros importados: X de Y".

## Testes que precisam existir

- **Servidor:**
  - `import:` aceito e devolvido com a mesma chave;
  - `private` forçado;
  - fora da biblioteca dos amigos;
  - presign com S3 falso;
  - deduplicação (`exists`);
  - cota e tamanho;
  - confirm com tamanho errado;
  - download de arquivo não confirmado dá 404;
  - limpeza.
- **Rust:**
  - série pelas 3 fontes (fixtures pequenas geradas no teste);
  - regex com os nomes reais;
  - commit grava pasta, marcador e capa;
  - reimportar dá `alreadyImported`;
  - filtros de sync com `import:`;
  - download com sha errado é recusado;
  - content id do Kindle para `import:`.
- **App:**
  - agrupamento de série e ordem dos volumes;
  - item `import:` na estante com "Baixar da conta";
  - folha de pré-visualização (edição e commit);
  - capa gerada quando não há capa.
