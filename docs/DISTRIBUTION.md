# Distribuicao estatica (sem servidor 24/7)

Objetivo: depois do crawl, publicar o acervo como **arquivos estaticos** num bucket S3-compativel
(Cloudflare R2 ou Backblaze B2 + Cloudflare). O app desktop le direto do bucket; **o servidor so liga no
cron mensal** para crawl + publish, e depois desliga.

Dois "bancos", nao confundir:
- **Postgres no servidor** = banco de *build* (crawl/incremental). Nao e exposto a ninguem.
- **`catalog.sqlite`** = *snapshot read-only derivado* do Postgres, feito para o app. O app fala com o
  sqlite local + bucket; **nunca** com o Postgres.

## 1. Artefatos no bucket

```
<bucket>/
  index.json                                    # manifesto MULTI-SITE (atualizado POR ULTIMO)
  catalog/
    <source>-<YYYYMMDD-HHMM>.sqlite.zst          # UM catalogo por site (versionado, imutavel)
  content/
    <source>/<slug>/<slug>.v<version>.tar.zst    # bundle de capitulos por novel (imutavel por versao)
  covers/
    <source>/<slug>.<ext>                         # capa: arquivo SOLTO (nao dentro do bundle), 1 por novel
```

**Um `catalog.sqlite` por site** (nao um global). Motivos: publish e download independentes/incrementais
por site; o usuario baixa so os sites que habilitou; isolamento de falha. A busca *global* (cruzar sites)
e resolvida no cliente, que **mescla** os catalogos habilitados num unico `library.sqlite` local (secao 7).

Regra: **arquivos versionados sao imutaveis**. Atualizacao = subir arquivo novo com versao nova; nunca
sobrescrever (evita cache/condicao de corrida e deixa rollback trivial).

`index.json` (manifesto multi-site):
```json
{
  "schema": 1,
  "builtAt": "2026-07-01T03:14:00Z",
  "sites": [
    { "id": "central-novel", "name": "Central Novel",
      "catalogKey": "catalog/central-novel-20260701-0300.sqlite.zst",
      "catalogSha256": "…", "catalogVersion": 7, "novelCount": 1873, "updatedAt": "…" }
  ]
}
```

## 2. Esquema do `catalog.sqlite`

```sql
CREATE TABLE source (
  id TEXT PRIMARY KEY, name TEXT, base_url TEXT, novel_count INTEGER, last_sync TEXT
);
CREATE TABLE novel (
  id TEXT PRIMARY KEY,            -- "<source>:<slug>"
  source_id TEXT, slug TEXT, title TEXT, author TEXT, description TEXT,
  cover_url TEXT, language TEXT, status TEXT,
  tags TEXT,                      -- JSON array (ou tabela novel_tag p/ filtro melhor)
  chapter_count INTEGER, updated_at TEXT,
  bundle_key TEXT,               -- content/<source>/<slug>/<slug>.v<n>.tar.zst
  bundle_version INTEGER,
  bundle_sha256 TEXT,
  bundle_bytes INTEGER
);
CREATE TABLE chapter (
  id TEXT PRIMARY KEY,           -- "<novelId>#<number>"
  novel_id TEXT, number REAL, title TEXT, published_at TEXT, word_count INTEGER
  -- NAO guarda o conteudo aqui; o texto vem do bundle.
);
CREATE INDEX ix_chapter_novel ON chapter(novel_id, number);
CREATE INDEX ix_novel_status ON novel(status);
CREATE INDEX ix_novel_count  ON novel(chapter_count);
-- Busca:
CREATE VIRTUAL TABLE novel_fts USING fts5(title, author, content='novel', content_rowid='rowid');
```

> Tudo que o app precisa para **buscar/filtrar/listar capitulos** esta no sqlite (rapido, offline). O
> **texto** do capitulo so e baixado quando a pessoa abre/exporta a novel (vem do bundle).

## 3. Bundle por novel

`<slug>.v<version>.tar.zst` contendo:
```
meta.json                 # id, slug, title, bundle_version, gerado_em, lista de capitulos (number->arquivo)
chapters/<number>.html    # conteudo normalizado de cada capitulo
```
- Compressao **zstd** (texto comprime muito). Opcional: dicionario zstd treinado nos capitulos da propria
  novel para ganho extra em muitos capitulos pequenos.
- `bundle_version` = inteiro que sobe quando o conteudo muda. `bundle_sha256` no catalogo permite o cliente
  validar e cachear.

## 4. `version` de conteudo (o que dispara re-upload)

Por novel, calcular um hash estavel do conteudo:
```
content_hash = sha256( join(sorted( f"{chapter.number}:{chapter.content_hash}" )) )
```
Se mudou em relacao ao ultimo publicado -> `bundle_version += 1`, regenerar e subir o bundle. Senao, pula.
Guardar o estado publicado (key/version/hash por novel) numa tabela local `publish_state` no Postgres
(ou um `published.json` no /srv) para o publish ser incremental.

## 5. Ordem de upload (ATOMICIDADE — critico)

Sempre nesta ordem, para o cliente nunca ver um estado pela metade:
1. subir os **bundles** novos/alterados (`content/...`), imutaveis.
2. subir o **catalog do site** novo (`catalog/<source>-<ts>.sqlite.zst`), imutavel.
3. **por ultimo**, sobrescrever `index.json` apontando para o novo catalog daquele site.

Se o job morrer no meio, `index.json` ainda aponta para os catalogos antigos (consistente). Cada site
publica de forma independente. Os arquivos orfaos sao limpos depois (passo de prune).

## 6. Comando `oghma publish` (a implementar)

```
oghma publish --source central-novel \
  --bucket s3://oghma-acervo --endpoint <r2/b2 endpoint> [--dict] [--prune-keep 2] [--dry-run]
```
Passos internos:
1. ler `publish_state`; descobrir novels com `content_hash` alterado (ou todas, se `--full`).
2. para cada alterada: montar `<slug>.vN.tar.zst`, calcular sha256/bytes, `bundle_version += 1`.
3. gerar `catalog/<source>-<ts>.sqlite.zst` do Postgres (so do site publicado), com
   bundle_key/version/sha de TODAS as novels daquele site (as inalteradas mantem a versao anterior).
4. **upload na ordem da secao 5** (bundles -> catalog do site -> index.json). Imutavel/`If-None-Match`.
5. atualizar `publish_state`. Opcional: `--prune-keep N` remove catalogos e bundles antigos alem dos N
   ultimos (cuidado: so prune o que o `index.json` atual nao referencia).
6. cliente S3: `boto3` (funciona com R2 e B2 via endpoint S3-compativel). Credenciais por env
   (`OGHMA_S3_*`), nunca commitadas.

Cron mensal passa a ser: `oghma crawl ... && oghma publish ...`.

## 7. Lado do cliente (desktop)

Nova implementacao de `BackendClient`: **`StaticBundleBackendClient`** (so mais uma impl atras da fronteira;
a UI nao muda):
- no boot: baixa `index.json` -> para cada site **habilitado** cujo `catalogVersion` mudou, baixa o
  `catalog/<source>-*.sqlite.zst`, valida o sha, descompacta.
- **mescla** os catalogos dos sites habilitados num unico `library.sqlite` local (INSERT ... SELECT, ou
  `ATTACH` + `UNION ALL`). So re-mescla quando algum site muda. (Tauri: `tauri-plugin-sql`/`rusqlite`.)
- busca/filtros/listagem de capitulos: **query no `library.sqlite` local** (instantaneo, offline, cruza
  todos os sites numa query so).
- abrir/exportar uma novel: baixa `bundle_key` (se ainda nao tiver a `bundle_version` em cache), valida
  `bundle_sha256`, descompacta no cache local, monta EPUB/PDF/TXT **localmente**.
- cache de bundles por `version`; so re-baixa o que mudou.

Onboarding: o campo "servidor de index" deixa de ser um IP e passa a ser a **URL base do bucket/CDN**
(ex.: `https://acervo.seudominio.com`). `validateServer` baixa `index.json` e mostra os sites/contagens disponiveis.

## 8. Hospedagem

- **R2 (Cloudflare)**: egress gratis nativo, setup simples. Recomendado para comecar.
- **B2 + Cloudflare** (Bandwidth Alliance): storage mais barato, egress gratis **se servido pelo CDN da
  Cloudflare** (dominio na Cloudflare na frente do bucket). Compensa se o acervo crescer muito.
- Ambos S3-compativeis -> o `oghma publish` nao muda, so o endpoint/credenciais.
- Publico vs privado: para acervo pessoal, bucket privado + um Worker/Token simples, ou bucket com nomes
  imprevisiveis. Distribuicao publica abre a discussao de direitos/comunidade (ver secao 9).

## 9. Nota legal/comunidade

Sincronizar o **seu** acervo entre os **seus** dispositivos = ok. **Redistribuir publicamente** conteudo
traduzido por fas tira trafego/sustento de quem traduz e entra em direitos/ToS — vai contra o principio de
"respeitar atribuicao e tradutores" do projeto. Se for compartilhar, considerar: so indice + link para a
fonte, atribuicao visivel, ou conteudo opt-in. Decisao de produto.

## 10. Ordem de implementacao (depois do crawl do Central Novel funcionar)

1. `oghma build-catalog` -> gera `catalog.sqlite` do Postgres (sem upload).
2. `oghma build-bundles` -> gera os `.tar.zst` por novel + content_hash/version.
3. `oghma publish` -> upload incremental na ordem atomica + `publish_state`.
4. desktop: `StaticBundleBackendClient` + leitura de SQLite + cache de bundles.
5. onboarding aceitando URL de bucket como "servidor".
