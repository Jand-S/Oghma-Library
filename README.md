# Oghma Library

Oghma Library e um projeto para preservar novels traduzidas por fas, baixar capitulos de sites externos suportados e manter uma biblioteca local exportavel para formatos como EPUB.

O objetivo inicial e simples: catalogar novels, baixar capas/metadados/capitulos com respeito a limites dos sites, armazenar tudo localmente no servidor e permitir que o usuario baixe/exporte os livros por uma interface desktop moderna.

## Visao geral

- Scrapers adaptaveis por site, com controle de velocidade, estado incremental e suporte a paginas estaticas ou renderizadas por JavaScript.
- Armazenamento local no servidor, preferencialmente em `/srv`, com objetos grandes em storage S3-compativel e metadados em banco relacional.
- Aplicativo desktop leve e multiplataforma para buscar novels, selecionar capitulos, baixar, exportar EPUB e futuramente gerenciar biblioteca local.
- Fundacao preparada para recursos futuros de IA, como traducao assistida, TTS/audiobook e organizacao/exportacao para Kindle.

## Documentacao

- [Arquitetura proposta](docs/ARCHITECTURE.md)
- [Operacao local e monitoramento](docs/OPERATIONS.md)
- [Roadmap](docs/ROADMAP.md)
- [Referencias de design e Figma](docs/references/README.md)

## Backend local

Backend atual no servidor:

- API: `http://192.168.0.42:8010`
- Monitor visual do crawler: `http://192.168.0.42:8010/monitor`
- Swagger/OpenAPI: `http://192.168.0.42:8010/docs`

O monitor visual atualiza sozinho e mostra progresso por run/fonte, obra atual, capitulo atual, heartbeat e alerta de possivel travamento.

## Recomendacao inicial de stack

Para a primeira versao, a opcao mais equilibrada parece ser:

- Backend/scraper: Python com Crawlee Python, Playwright, BeautifulSoup/lxml, SQLAlchemy, PostgreSQL e MinIO/S3.
- Desktop: Tauri 2 com Rust no lado nativo e React/TypeScript no frontend.
- Exportacao: EPUB como formato principal no MVP, com uma camada propria de geracao/exportacao para abrir caminho para Kindle depois.

Essa combinacao favorece iteracao rapida nos scrapers, aplicativo leve no desktop e um caminho claro para empacotar em Windows, Linux e macOS.

## Observacao legal e operacional

O projeto deve ser pensado como ferramenta de preservacao e biblioteca pessoal. Cada conector precisa respeitar robots.txt quando aplicavel, limites de requisicao, atribuicao da fonte e regras de uso de cada site. O download em massa deve ser configuravel e cuidadoso para reduzir impacto nos servidores das comunidades.
