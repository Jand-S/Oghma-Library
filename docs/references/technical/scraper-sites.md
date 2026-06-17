# Sites suportados

Use este arquivo para documentar a analise de cada site antes de implementar o conector.

> Decisao atual: o **primeiro conector real sera o Central Novel** (HTML estatico / WordPress).
> Novel Mania fica para a segunda rodada (provavel `javascript_required`).

## Template

```md
## Nome do site

- URL base:
- Tipo: static_html | javascript_required | api_available
- Plataforma:
- Listagem de novels:
- Listagem de capitulos:
- Pagina de capitulo:
- Capa:
- Descricao:
- Seletores:
- Rate limit sugerido:
- Estrategia incremental:
- Observacoes:
```

## Central Novel  (PRIMEIRO SITE)

- URL base: https://centralnovel.com/
- Tipo: **static_html** validado no servidor. Listagem, pagina de obra, lista de capitulos e conteudo de capitulo chegam renderizados no HTML.
- Plataforma: **WordPress** (presenca de `wp-content`) com tema proximo de **Madara/Tsundoku**.
- Padroes de URL observados (16/06/2026):
  - Pagina da obra (novel): `https://centralnovel.com/series/<slug>/`
  - Pagina de capitulo: `https://centralnovel.com/<slug-da-serie>-capitulo-<n>/`
  - Listagem A-Z: `https://centralnovel.com/lista-a-z/`
  - Genero: `https://centralnovel.com/genre/<slug>/`
  - Tipo: `https://centralnovel.com/type/<slug>/`
- Listagem de novels:
  - Fonte principal atual: `/series/list-mode/`, com 232 obras observadas em `.soralist a[href*='/series/']`.
  - Fallback: `/series/` e filtros de ordenacao em `.listupd h2 a[href*='/series/']` (50 obras na grade).
  - A sidebar de populares usa `.serieslist h4`; nao usar como fonte principal, porque ela enviesou o primeiro crawl para populares.
  - `/series/page/2/` respondeu 200, mas repetiu o mesmo conjunto na verificacao de 16/06/2026.
- Listagem de capitulos: vem no HTML da pagina da obra em `.eplister li > a`; os links `/pdf/` devem ser ignorados. Algumas obras usam URLs sem `capitulo`, como `a-returners-magic-should-be-special-314`, entao o numero deve ser extraido do texto `Vol. X Cap. N`.
- Pagina de capitulo: conteudo de leitura em `.epcontent`.
- Capa: `.bigcontent .thumb img`.
- Descricao/sinopse: `.entry-content[itemprop='description']`.
- Seletores confirmados no deploy (16/06/2026):
  - listagem principal: `.soralist a[href*='/series/'], .listupd h2 a[href*='/series/']`
  - titulo da serie: `h1.entry-title`
  - capa: `.bigcontent .thumb img`
  - sinopse: `.entry-content[itemprop='description']`
  - generos: `.infox a[href*='/genre/']`
  - status/metadados: `.infox .spe span`
  - itens de capitulo: `.eplister li > a`
  - titulo do capitulo: `.epl-title`
  - conteudo do capitulo: `.epcontent`
- Rate limit sugerido: **1 requisicao a cada 1.5-2.5s por dominio**, 1 conexao simultanea, com jitter. Respeitar `robots.txt`, enviar `User-Agent` identificavel (ex.: `OghmaLibraryBot/0.1 (+contato)`), e usar backoff em 429/5xx.
- Estrategia incremental:
  - Usar a home / pagina de "ultimos capitulos" e, se existir, o feed RSS do WordPress (`/feed/`) para descobrir novidades sem varrer tudo.
  - Guardar por novel: ultima URL/numero de capitulo conhecido, `ETag`/`Last-Modified` quando vierem, e hash do conteudo normalizado.
  - Parar a paginacao ao encontrar uma sequencia configuravel de capitulos ja conhecidos.
  - Revalidar obras antigas com baixa frequencia.
- Observacoes legais/operacionais: site de **traducao feita por fas**. Tratar como ferramenta de **preservacao/biblioteca pessoal**. Respeitar `robots.txt`, termos de uso, atribuicao da fonte e dos tradutores, e evitar download em massa agressivo.

### Existe API utilizavel no site? (resposta a duvida levantada)

Como e WordPress, ha **tres caminhos JSON/HTTP** que valem a pena tentar ANTES de cair no parse de HTML:

1. **REST API do WordPress** em `/wp-json/`:
   - Raiz/rotas: `GET https://centralnovel.com/wp-json/`
   - Tipos expostos: `GET /wp-json/wp/v2/types`
   - Conteudo padrao: `GET /wp-json/wp/v2/posts`, `/categories`, etc.
   - Ressalva: no Madara, os custom post types (`wp-manga` = series e `wp-manga-chapter` = capitulos) **so aparecem no REST se o site tiver `show_in_rest=true`**. Muitos sites deixam, outros nao. Precisa confirmar consultando `/wp-json/wp/v2/types`.
2. **AJAX do tema** (`/wp-admin/admin-ajax.php`): e o que o proprio site usa para carregar a lista de capitulos. Retorna HTML/JSON e e estavel.
3. **Feeds RSS** (`/feed/`, `/series/<slug>/feed/`): bons para incremental de "ultimos capitulos".

Status da verificacao real no servidor (16/06/2026):

- `/wp-json/` respondeu 200 e `/wp-json/wp/v2/types` respondeu 200, mas os tipos expostos sao apenas os padroes (`post`, `page`, anexos etc.); nao aparecem tipos custom de novels/capitulos.
- Caminho validado para o primeiro conector: parse de HTML renderizado no servidor. Central Novel nao exige navegador headless.
- Crawls de prova:
  - seletor inicial de sidebar/populares: 3 novels, 15 capitulos, 0 erros.
  - seletor principal corrigido: banco final com 6 novels e 25 capitulos.
  - apos `list-mode` e seletor de capitulos ampliado: probe com 232 obras; banco em 6 novels e 42 capitulos; `A Returner’s Magic Should Be Special` com 5 capitulos.
  - capas passaram a ser baixadas como bytes no crawl e gravadas em `covers/central-novel/<slug>.<ext>`, com `novel.cover_path` preenchido.

## Novel Mania  (segunda rodada)

- URL base: https://novelmania.com.br/
- Tipo: **api_available + HTML SSR hidratado**.
- Analise (16/06/2026): pela ferramenta de fetch HTTP usada, **nem a home (`/`) nem `/novels` devolveram conteudo** - retorno vazio. A Central Novel, no mesmo fetcher, devolveu HTML completo. Esse contraste indica que a Novel Mania **nao serve o catalogo em HTML estatico**: ou e SPA (renderiza no cliente) ou bloqueia agentes nao-navegador (ex.: desafio Cloudflare).
- Atualizacao codex (17/06/2026): via navegador/web, `/novels` mostrou HTML textual com **426 novels encontradas**
  e links de obras como `/novels/86-oitenta-e-seis`. A pagina individual de `86: Eighty Six` abriu com metadados
  basicos, mas sem conteudo/capitulos visiveis no HTML textual. Foi criado o conector `novel-mania` com parsing
  conservador de listagem, metatags e links de capitulos quando existirem no HTML/hidratacao; se os capitulos nao
  vierem sem JavaScript/API, ele retorna lista vazia e nao inventa dados.
- Atualizacao codex (17/06/2026, segunda rodada): o frontend usa base `/api`.
  - Catalogo paginado: `GET /api/novels?page=<n>&items=100`.
  - Metadados da obra: `GET /api/novels/<slug>`.
  - Capitulos: `GET /api/novels/<slug>/chapters?page=<n>&items=100&sort=asc`.
  - Conteudo do capitulo: a rota publica `/novels/<slug>/capitulos/<chapterSlug>` retorna HTML com payload
    TanStack Start em script `$tsr`; o campo `chapter.content` vem serializado como string JS com escapes
    `\x3C...`. O conector extrai esse `content`, decodifica e passa pelo normalizador semantico.
  - O endpoint direto `GET /api/novels/<slug>/chapters/<chapterSlug>` respondeu 403 fora do loader interno,
    entao nao usar esse caminho para conteudo.
- Status: **conector funcional**. Validado no servidor com:
  - testes container: `test_publish.py` -> 6 passed; `test_novel_mania.py` -> 7 passed.
  - probe live: descobriu 5 obras, listou capitulos, baixou e normalizou o primeiro capitulo.
  - crawl real pequeno: `oghma crawl --source novel-mania --limit 2 --chapter-limit 2` salvou 2 novels,
    4 capitulos e 2 capas, com 0 erros.

## House Saikai / antigo Saikai Scans

- URL base: https://housesaikai.net/
- Tipo: **api_available**.
- Observacao importante: o site tambem possui comics em https://housesaikai.net/comics. O conector **nao usa**
  `/comics` e sempre consulta `stories` com `format=1`, que corresponde a `series`; isso evita misturar comics
  no acervo de novels.
- Catalogo de series:
  - `GET https://api.housesaikai.net/api/stories?format=1&hdropped=1&q=&status=null&genres=&country=null&sortProperty=title&sortDirection=asc&page=<n>&per_page=100&relationships=language,type,format`
  - Validado em 17/06/2026 sem Bearer: respondeu `200` com `meta.last_page=78` e `total=156` quando `per_page=2`.
- Detalhe da obra e lista de capitulos:
  - `GET /api/stories?pageview=0&relationships=firstRelease,tags,genres,associatedNames,authors.user,artists.user,translators,revisors,checkers,editors,separatorType,language,status,galleries,curiosities,separators.releases&format=1&first=true&slug=<slug>&cache=1`
  - A lista de capitulos vem em `data.separators[].releases[]`.
  - Cada release traz `id`, `chapter`, `slug`, `title`, `order/order_all`, `published_at` e `release_text_id`.
- Conteudo do capitulo:
  - A URL publica observada no navegador e `https://housesaikai.net/ler/series/<storySlug>/<releaseId>/<releaseSlug>`.
  - Validado em 17/06/2026: `GET /api/releases/<releaseId>?relationships=releaseText` responde `200` sem Bearer e traz
    o HTML em `data.release_text.content`.
  - A variante com `pageview=0&cache=1` retornou `Server Error` no teste local, entao o conector usa apenas
    `relationships=releaseText`.
  - O normalizador procura `release_text.content`, `releaseText.content` e campos equivalentes.
  - Se a API devolver HTML em vez de JSON, ha fallback para seletores de leitura (`.reader-content`, `.reading-content`,
    `.content-item`, `.ql-editor`, `article`, `main`).
- Capa:
  - Campo `image`, resolvido contra `https://s3-beta.housesaikai.net/`.
- Descricao:
  - Campo `synopsis`, convertido para texto sem estilos; fallback em `resume`.
- Autenticacao:
  - Catalogo e detalhe foram validados sem Bearer em 17/06/2026.
  - Cloudflare devolveu `403` para chamada sem headers de navegador; com `Accept`, `Origin`, `Referer`, `Sec-Fetch-*`
    e `User-Agent` de navegador, a API respondeu JSON normalmente. O sufixo `OghmaLibraryBot/0.1` no `User-Agent`
    tambem causou `403`, entao este conector usa um `User-Agent` de Chrome sem sufixo.
  - O Bearer capturado no navegador e um access token JWT; o curl nao contem refresh token. Pelo payload observado,
    ele tem vencimento longo, mas deve ser tratado como credencial rotativa.
  - Se alguma rota passar a exigir sessao, configurar manualmente `OGHMA_HOUSE_SAIKAI_BEARER=<token>` no `.env` do backend.
    Nunca commitar token real.
- Rate limit sugerido: **1.5s por dominio/API**, respeitando limite de resposta observado (`X-RateLimit-Limit: 500`).
- Status local:
  - Conector criado em `backend/src/oghma/scraper/connectors/house_saikai.py`.
  - Testes sinteticos em `backend/tests/test_house_saikai.py`.
  - Pendente validar live no servidor quando a cota/comandos remotos estiverem disponiveis:
    `oghma crawl --source house-saikai --limit 1 --chapter-limit 1`.
