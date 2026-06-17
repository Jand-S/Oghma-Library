# Roadmap

> Para a ordem detalhada de execucao, backlog por area e o que ja foi construido, use [IMPLEMENTATION_PLAN.md](</C:/Users/Jandson/Documents/Oghma Library/docs/IMPLEMENTATION_PLAN.md>) como referencia principal. Este arquivo fica como visao macro por fases.

## Fase 0 - Fundacao do projeto

- Definir stack final.
- Criar monorepo com `apps/desktop`, `apps/api`, `packages/scraper` e `infra`.
- Criar modelos de dominio e schema inicial do banco.
- Criar contrato dos conectores de site.
- Criar pasta de referencias visuais e importar materiais do Figma.

## Fase 1 - MVP scraper

- Implementar um conector estatico simples.
- Implementar um conector com Playwright para site com JavaScript.
- Criar armazenamento de HTML bruto, capas e capitulos normalizados.
- Criar mecanismo incremental com cursor, hash e parada por capitulos conhecidos.
- Criar exportacao EPUB basica.
- Rodar manualmente no servidor local antes de automatizar.

## Fase 2 - API local

- Criar API para listar fontes, novels, capitulos e exports.
- Criar jobs de download/exportacao.
- Adicionar logs, status e historico.
- Adicionar autenticacao simples para rede local, se necessario.

## Fase 3 - Desktop MVP

- Criar app Tauri.
- Conectar ao servidor local.
- Implementar busca, detalhes da novel, selecao de capitulos e download/exportacao EPUB.
- Criar tela de configuracoes.
- Empacotar para Windows primeiro, depois Linux.

## Fase 4 - Operacao no servidor

- Criar Docker Compose para PostgreSQL, MinIO, API, worker e scheduler.
- Configurar armazenamento em `/srv/oghma`.
- Criar job mensal por site.
- Evoluir observabilidade: a versao inicial ja tem logs, `/monitor`, `/api/crawls`, `/api/stats` e alerta `STALE?`; falta historico filtravel e painel multi-site mais completo.

## Fase 5 - Biblioteca pessoal

- Importar EPUB/PDF locais.
- Editar metadados.
- Organizar colecoes.
- Exportar novamente.
- Preparar integracao com Kindle via USB.

## Fase 6 - IA e audio

- Traducao assistida por IA com fila, revisao e memoria de termos.
- TTS por capitulo.
- Geracao de audiobook por obra.
- Cache de vozes e controle de custo.

## Primeiros marcos praticos

1. Escolher stack final: Tauri + Python/FastAPI ou Qt + Python.
2. Criar o monorepo e containers de desenvolvimento.
3. Implementar o primeiro conector usando uma novel pequena como teste.
4. Gerar o primeiro EPUB valido.
5. Criar uma tela desktop simples consumindo dados reais.
