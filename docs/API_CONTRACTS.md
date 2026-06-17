# API contracts

Contrato planejado para o backend real, **alinhado 1:1 com a fronteira `apps/desktop/src/services/backendClient.ts`** e com os tipos em `apps/desktop/src/types.ts`.

Regra de ouro: o desktop **so fala com `BackendClient`**. Trocar o mock pelo backend real = implementar esse mesmo contrato num cliente HTTP. A UI nao deve mudar.

## Mapa metodo do BackendClient -> endpoint HTTP

| BackendClient | HTTP | Retorno (tipo da UI) |
|---|---|---|
| `bootstrap()` | `GET /api/bootstrap` | `BootstrapPayload` |
| `validateServer(serverUrl, indexMode)` | `POST /api/server/validate` | `ServerProbe` |
| `searchNovels(filters)` | `GET /api/novels` | `Novel[]` |
| `getNovelChapters(novelId)` | `GET /api/novels/:id/chapters` | `Chapter[]` |
| `syncSource(sourceId)` | `POST /api/sources/:id/sync` | `SourceSite` |
| `createDownloads(selections)` | `POST /api/downloads` | `QueueItem[]` |
| `getKindleStatus()` | `GET /api/kindle/status` | `KindleDeviceStatus` |
| `sendToKindle(items)` | `POST /api/kindle/send` | `KindleTransferResult` |
| (listar fontes) | `GET /api/sources` | `SourceSite[]` |
| (acompanhar crawls) | `GET /api/crawls` | `CrawlRun[]` |
| (publicar acervo estatico) | `POST /api/publish/run` | `PublishRunResult` |
| (status de publicacao) | `GET /api/publish/status` | `PublishJob` |

## Endpoints

### `GET /api/bootstrap`
Estado inicial da UI.
```json
{ "sources": [], "novels": [], "queue": [], "library": [] }
```

### `POST /api/server/validate`
Valida o servidor de index do onboarding.
Payload: `{ "serverUrl": "http://192.168.0.42:8000", "indexMode": "incremental_recent" }`
`indexMode` ∈ `catalog_only | incremental_recent | guarded_refresh`.
Resposta (`ServerProbe`):
```json
{
  "serverUrl": "http://192.168.0.42:8000",
  "status": "online",
  "serverName": "Oghma Index Node",
  "version": "0.4.2",
  "latencyMs": 96,
  "sourceCount": 3,
  "storageRoot": "/srv/oghma"
}
```

### `GET /api/sources`  /  `POST /api/sources/:id/sync`
Lista/atualiza fontes. Objeto `SourceSite`:
`id, name, baseUrl, count, status(online|syncing|offline), enabled, mode(static_html|javascript_required|api_available), lastSync, delayMs`.
`sync` inicia sincronizacao incremental e devolve o `SourceSite` atualizado.

### `GET /api/crawls`
Lista execucoes de crawler para acompanhamento em tempo real.

Query:
- `limit` (default `20`, max `100`)
- `sourceId` opcional, ex.: `central-novel`
- `status` opcional, ex.: `running`, `done`, `error`

Resposta (`CrawlRun[]`):
```json
[{
  "id": 7,
  "sourceId": "central-novel",
  "status": "running",
  "stats": {
    "source_id": "central-novel",
    "stage": "downloading_chapter",
    "discovered_total": 232,
    "novels_total": 232,
    "novels_done": 3,
    "novels_failed": 0,
    "current_novel_index": 4,
    "current_novel_title": "A Will Eternal",
    "current_novel_chapters_done": 100,
    "current_novel_chapters_total": 1315,
    "current_chapter_number": 100,
    "current_chapter_title": "Ainda nao se desculpara com o Tio da Seita Bai?",
    "chapters_seen": 499,
    "chapters_new": 31,
    "chapters_skipped": 467,
    "covers_new": 0,
    "cover_errors": 0,
    "errors": 0,
    "last_event": "A Will Eternal: downloading chapter 100/1315 #100",
    "last_heartbeat_at": "2026-06-16T18:14:25.585380+00:00"
  },
  "error": "",
  "startedAt": "2026-06-16T18:13:01.354815+00:00",
  "finishedAt": ""
}]
```

Regra para UI/status: se `status = running` e `last_heartbeat_at` ficar mais de 10 minutos sem atualizar, mostrar como possivel travamento (`STALE?`). Isso nao mata automaticamente o processo; apenas indica que precisa de investigacao.

### `GET /api/stats`
Resumo rapido para dashboards operacionais.
```json
{
  "sources": 1,
  "novels": 7,
  "chapters": 659,
  "covers": 4,
  "runningCrawls": 1
}
```

### `GET /monitor`
Pagina HTML simples servida pelo proprio backend para acompanhar o crawler sem abrir Swagger.

Ela faz polling a cada 2 segundos em:
- `GET /api/crawls?limit=12`
- `GET /api/stats`
- `GET /api/publish/status`

Uso atual: abrir `http://192.168.0.42:8010/monitor`.

Detalhes operacionais, comandos de apoio e interpretacao dos campos ficam em [OPERATIONS.md](</C:/Users/Jandson/Documents/Oghma Library/docs/OPERATIONS.md>).

### `POST /api/publish/run`
Dispara um publish real para o B2/Cloudflare usando o `oghma.publish.runner.run()` dentro do processo da API.

Query:
- `source` opcional, default `central-novel`.

Resposta quando inicia:
```json
{
  "ok": true,
  "job": {
    "status": "running",
    "source": "central-novel",
    "startedAt": 1781640000.0,
    "finishedAt": null,
    "summary": null,
    "error": null
  }
}
```

Resposta quando ja existe publish em andamento:
```json
{
  "ok": false,
  "reason": "already_running",
  "job": { "status": "running" }
}
```

### `GET /api/publish/status`
Retorna o estado em memoria do ultimo publish.

Estados:
- `idle`: nenhum publish disparado desde o boot da API.
- `running`: publish em andamento.
- `done`: ultimo publish concluiu.
- `error`: ultimo publish falhou.

Quando `done`, `summary` contem campos como `novels`, `bundles_changed`, `covers`, `catalog_key`, `catalog_json_key` e `uploaded`.

### `GET /api/novels`
Busca com filtros (query string): `query, sourceId, status, language, tags[], onlyCovered, minChapters, maxChapters, updatedOnly`.
Retorna `Novel[]`.

### `GET /api/novels/:id/chapters`
Lista capitulos. Para obras longas o backend real **deve paginar e filtrar**.
Query: `page, pageSize, from, to, downloaded`.
Resposta paginada sugerida:
```json
{ "items": [], "page": 1, "pageSize": 100, "total": 2064 }
```
> O mock atual devolve `Chapter[]` direto (amostra). O cliente HTTP real deve consumir a versao paginada e entregar `Chapter[]` para a UI.

### `GET /api/chapters/:id/content`
Devolve o HTML limpo do capitulo salvo em `content_path`.

Regra do conteudo:
- `raw_path`: preserva o HTML bruto do site, com wrappers e atributos originais, para auditoria/reprocessamento.
- `content_path`: serve somente HTML semantico limpo, sem wrapper do site, classes ou estilos inline.
- Tags permitidas no HTML servido/exportado: `<p>`, `<em>`, `<strong>`, `<img>`, `<blockquote>`, `<hr>`.

Exemplo de resposta:
```json
{
  "id": "central-novel:a-will-eternal-20230516#1",
  "title": "Capitulo 1",
  "html": "<p>Primeira linha.</p><blockquote><p>Uma <strong>fala</strong>.</p></blockquote>"
}
```

### `POST /api/downloads`
Cria pacotes de download a partir das selecoes por novel. Payload = `ChapterSelection[]`:
```json
[{
  "novelId": "forgotten-kingdom",
  "preset": "range",
  "start": 1,
  "end": 50,
  "formats": ["EPUB", "PDF"],
  "translate": false,
  "audiobook": false
}]
```
`preset` ∈ `all | range`. `formats[]` ∈ `EPUB | PDF | TXT`.
Retorna `QueueItem[]` (itens enfileirados).

### `GET /api/kindle/status`
`KindleDeviceStatus`: `{ id, deviceName, connected, mountPath, targetFormat: "AZW3" }`.

### `POST /api/kindle/send`
Body: `QueueItem[]` (apenas concluidos com `EPUB`). Converte `EPUB -> AZW3` e envia.
Resposta (`KindleTransferResult`): `{ "sentIds": ["..."], "convertedFormat": "AZW3" }`.

### (planejados, ainda sem metodo no BackendClient)
- `POST /api/exports` — gera export num formato escolhido (EPUB/PDF/TXT). Hoje o mock embute formato na propria selecao de download; quando o export virar job separado, adicionar metodo no `BackendClient`.
- `GET /api/jobs/:id` — status de job (download/export/conversao) com progresso.
- `POST /api/translations`, `POST /api/audiobooks` — filas de IA/TTS (pos-MVP).

## Gap importante: DTO real x tipos da UI (camada de adaptacao)

Os tipos de hoje sao **moldados para o mock**, nao para um backend real. O cliente HTTP real precisa **adaptar** os DTOs do backend para esses tipos da UI (ou evoluimos os tipos). Campos a tratar:

- `Novel.coverClass` — hoje e uma classe CSS de gradiente (mock). O backend real devolve **URL de capa**; o adaptador deve mapear `coverUrl -> coverClass`/`coverUrl` (ou a UI passa a renderizar `<img src>`). **Sugestao:** o backend expoe `coverUrl`; o desktop adiciona suporte a imagem real e usa `coverClass` so como fallback.
- `Novel.chapters` (numero), `updatedAt` (string "Hoje") — o backend deve devolver contagem real e timestamp ISO; o adaptador formata para exibicao.
- `Chapter.pages`, `Chapter.sizeMb`, `Chapter.downloaded` — sao aproximacoes do mock; no real viram metadados verdadeiros (ou somem da UI).
- `QueueItem.rangeLabel`, `progress`, `state`, `chaptersTotal`, `coverClass` — sao estado de fila do mock; no real vem de **status de job** (`GET /api/jobs/:id`). O adaptador converte job -> `QueueItem`.
- `SourceSite.count`, `lastSync` (string), `delayMs` — `count`/`lastSync` viram dados reais; `delayMs` (rate-limit) e detalhe de backend e pode sair do DTO publico.

> Recomendacao: manter a UI estavel e concentrar TODA a traducao "DTO real -> tipo da UI" no cliente HTTP (`apps/desktop/src/services/httpBackendClient.ts`, a criar). Assim o backend evolui sem mexer em `appUi.tsx`.

## IDs canonicos

- `Novel.id` = `<sourceId>:<slug-da-serie>` (ex.: `central-novel:supreme-magus`).
- `Chapter.id` = `<novelId>#<numero>` ou o slug do capitulo.
- Isso evita colisao entre fontes e da estabilidade ao incremental.
