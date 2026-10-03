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

