# Connector spec — contrato do scraper por site

Este documento define o **contrato executavel** que todo conector de site deve implementar, e o **plano concreto do primeiro conector (Central Novel)**. Serve de base para `packages/scraper`.

## 1. Visao geral

Um conector e o componente que sabe falar com **um site especifico** e devolver dados normalizados para o nucleo (`packages/core`). Ele nao conhece banco, API HTTP nem UI — so sabe descobrir/baixar/normalizar.

Fluxo padrao por execucao:

```
discover_novels()      -> lista de novels novas/atualizadas
fetch_novel(ref)       -> metadados da obra (titulo, capa, sinopse, tags, status)
list_chapters(novel)   -> lista de capitulos (numero, titulo, url, data)
fetch_chapter(chapter) -> html bruto do capitulo
normalize_chapter(raw) -> conteudo limpo + hash
```

O orquestrador (worker) e quem decide quando chamar cada passo, aplica rate limit, salva raw/asset e grava no banco.

## 2. Contrato (Python, sugestao)

```python
# packages/scraper/base.py
from dataclasses import dataclass
from typing import Iterable, Literal, Optional

Capability = Literal["static_html", "javascript_required", "api_available", "incremental_listing"]

@dataclass
class NovelRef:
    source_id: str
    source_slug: str          # slug no site (ex.: "supreme-magus")
    url: str

@dataclass
class NovelMeta:
    source_id: str
    source_slug: str
    title: str
    url: str
    cover_url: Optional[str]
    description: Optional[str]
    authors: list[str]
    tags: list[str]
    status: Literal["ongoing", "complete", "paused", "unknown"]
    language: str

@dataclass
class ChapterRef:
    novel_slug: str
    number: float             # float p/ capitulos "10.5"
    title: str
    url: str
    published_at: Optional[str]

@dataclass
class RawPage:
    url: str
    html: bytes
    fetched_at: str
    etag: Optional[str] = None
    last_modified: Optional[str] = None

@dataclass
class NormalizedChapter:
    title: str
    html: str                 # HTML semantico limpo, sem wrapper/estilos/classes do site
    text_hash: str            # hash do texto normalizado (deteccao de mudanca)
    word_count: int

class SiteConnector:
    id: str                       # ex.: "central-novel"
    display_name: str
    base_url: str
    capabilities: set[Capability]
    rate_limit_seconds: float     # delay minimo por dominio

    def discover_novels(self, cursor: Optional[dict] = None) -> Iterable[NovelRef]: ...
    def fetch_novel(self, ref: NovelRef) -> NovelMeta: ...
    def list_chapters(self, novel: NovelMeta) -> list[ChapterRef]: ...
    def fetch_chapter(self, chapter: ChapterRef) -> RawPage: ...
    def normalize_chapter(self, raw: RawPage) -> NormalizedChapter: ...
```

Regras transversais (impostas pelo orquestrador, nao pelo conector):
- 1 conexao por dominio, `rate_limit_seconds` + jitter entre requisicoes.
- backoff exponencial em 429/5xx.
- `User-Agent` identificavel do projeto.
- salvar **raw html antes de normalizar** (reprocessavel sem novo download).
- salvar `content_path` como HTML semantico allowlist: `<p>`, `<em>`, `<strong>`, `<img>`, `<blockquote>`, `<hr>`.
- remover wrappers/classes/estilos inline do site no `content_path`; tipografia e tema pertencem ao app/EPUB.
- cursor incremental persistido por fonte/novel.

## 3. Conector Central Novel — plano concreto

- `id = "central-novel"`, `base_url = "https://centralnovel.com/"`.
- `capabilities = {static_html, incremental_listing}` (sem navegador).
- Plataforma: WordPress + tema Madara.

### Estrategia "API-first, fallback HTML"

Tentar nesta ordem (cair para o proximo se nao cobrir):

1. **REST API do WordPress** (`/wp-json/`):
   - `GET /wp-json/` (rotas), `GET /wp-json/wp/v2/types` (ver se `wp-manga`/`wp-manga-chapter` estao expostos).
   - Se expostos: listar series e capitulos como posts/CPT (paginado, com cursor por data).
2. **AJAX do Madara** para a lista de capitulos: `POST /wp-admin/admin-ajax.php` (`action=manga_get_chapters` / equivalente). Retorno HTML/JSON, estavel.
3. **RSS** (`/feed/`, `/series/<slug>/feed/`) para descobrir "ultimos capitulos" no incremental.
4. **Parse de HTML** das paginas renderizadas (home, `/lista-a-z/`, `/series/<slug>/`, pagina de capitulo) como ultimo recurso.

> A confirmar na 1a sessao de implementacao (com httpx + UA de navegador): se `/wp-json` responde, se os CPT estao em REST, e qual `action` do admin-ajax retorna os capitulos. Documentar os achados de volta em `scraper-sites.md`.

### Mapeamento de seletores (fallback HTML — padrao Madara, confirmar)

- listagem: `.page-item-detail .post-title a` -> `NovelRef`
- titulo: `h1` / `.post-title h1`
- capa: `.summary_image img[src]` -> `cover_url`
- sinopse: `.description-summary .summary__content` -> `description`
- capitulos: `li.wp-manga-chapter a` (+ `.chapter-release-date`) -> `ChapterRef`
- conteudo: `.reading-content` (remover script/nav/ads) -> `normalize_chapter`

### Incremental
- guardar por novel: ultimo `number`/url conhecido, `ETag`/`Last-Modified`, `text_hash`.
- parar paginacao ao bater N capitulos ja conhecidos.

## 4. Mapeamento dominio -> DTO -> tipos da UI

```
Conector (NovelMeta/ChapterRef/NormalizedChapter)
  -> packages/core (entidades: source_site, novel, chapter, asset)
  -> banco (Postgres) + storage (raw/cover/content/epub)
  -> API local DTO (JSON do backend)
  -> httpBackendClient (desktop) adapta para os tipos da UI (Novel, Chapter, ...)
  -> appUi.tsx (sem mudanca)
```

Pontos de atencao (ver `API_CONTRACTS.md` > "DTO real x tipos da UI"):
- `cover_url` (real) -> hoje a UI usa `coverClass`. Decidir: backend manda `coverUrl` e a UI passa a aceitar imagem real (recomendado), com `coverClass` so de fallback.
- `Novel.id` canonico = `central-novel:<source_slug>`.
- `status` do site -> `NovelStatus` da UI (`ongoing|complete|paused`).

## 5. Definicao de pronto (primeiro conector)

1. lista pelo menos N novels reais do Central Novel.
2. para uma novel, lista capitulos reais (via API/AJAX/HTML).
3. baixa e normaliza 1 capitulo (raw salvo + conteudo limpo + hash).
4. grava `novel` + `chapter` no banco e a capa no storage.
5. gera 1 EPUB valido a partir dos capitulos baixados.
6. tudo respeitando rate limit e robots.txt.
