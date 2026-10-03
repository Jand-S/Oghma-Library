# Roadmap

Este roteiro saiu da revisão crítica de outubro de 2026, que olhou arquitetura, código,
design e produto. O relatório completo, com as capturas de tela, foi publicado como Artifact
e tem o link na nota `oghma-library` do docs.jandson.me. O roteiro antigo, de junho de 2026,
está em `archive/ROADMAP_2026-06.md`.

Estado em 2026-10-03: as Fases 0 a 4 estão no ar (VPS e app instalado). A Fase 5 está quase
no fim.

## Fase 0 — Segurança e integridade ✅

- **Autoconnector**
  - Os agentes rodam sem segredos (ambiente por allowlist) e como o usuário `oghma-agent`.
  - Ids validados, argumentos com quoting e deploy só com aprovação no brain.
- **App**
  - CSP estrita.
  - Pasta de saída guardada no Rust para todos os comandos de arquivo.
  - Token do ChatGPT gravado de forma privada.
- **Servidor:** API e Postgres só em `127.0.0.1`; o control server exige token forte.
- **Publicação**
  - Capas trocadas são reenviadas.
  - `Cache-Control` por tipo de objeto.
  - O SHA-256 de bundles e catálogos é conferido no app.
- **Coleta**
  - Um capítulo lento não aborta mais a novel; o motivo do erro fica registrado.
  - O total de capítulos do site é publicado.
  - Capítulos indisponíveis viram uma página no livro.

## Fase 1 — Catálogo e busca ✅

- **Busca**
  - Busca em todas as fontes de uma vez, sem acento, por título, autor, sinopse e tags
    (`catalogIndex.ts`).
  - Boot em paralelo: uma fonte fora do ar não derruba as outras.
- **Catálogo:** nota normalizada, votos, views e datas reais (`firstSeenAt`, `lastChapterAt`)
  no lugar do `extra` cru.
- **Taxonomia:** o Python é a fonte única, com acentos; um teste mantém a lista do app em dia.
- **Bugs corrigidos:** grade vazia no boot; metadados da Biblioteca presos aos filtros do
  Buscar; URL do servidor que só valia depois de reiniciar.

## Fase 2 — Limpeza de UX ✅

- **Funções removidas da interface:** audiobook, "PDF" que gerava HTML e ajustes que não
  faziam nada.
- **Biblioteca:** livros removidos aparecem em "Ocultos" e podem voltar.
- **Buscar:** a faixa de capítulos pode ser apagada e digitada de novo.
- **Sem travamentos:** comandos de arquivo e de Kindle rodam fora da thread principal.
- **Kindle:** só um Kindle de verdade é detectado (exige as pastas `documents` + `system`).
- **Avisos:** tom de erro explícito; data da fonte com rótulo honesto.

## Fase 3 — Descoberta ✅

- **Tela Início:** continuar lendo, capítulos novos, para você e recém-chegadas.
- **Buscar**
  - A mesma obra em várias fontes aparece como edições.
  - Novels parecidas no detalhe.
  - Ordenações por nota, popularidade, capítulos e novidade.
  - Cards com mais informação.
- **Biblioteca:** selo "+N cap." quando a fonte publicou capítulos depois do download.

## Fase 4 — Filtro inteligente ✅ (falta validar com conta real)

- **No Buscar:** uma frase vira uma intenção (tags, status, idioma, faixa de capítulos,
  "parecido com X"), que é aplicada ao índice local com o motivo de cada resultado.
- **Com login ChatGPT:** a intenção vem do modelo (`smart_filter_ask`, no Rust).
- **Sem login:** regras locais interpretam o pedido.
- **Pendente:** testar com a conta do Jandson. Usar os tokens dele num teste automático
  trocaria o refresh token e o deslogaria.
- **Depois:** chat com várias rodadas e tool calling (`search_catalog`, `similar_to`,
  `get_my_library`), caso o modo `chatgpt.tokens.use.direct` aceite `tools`. Também
  similaridade por embedding da sinopse, calculada no servidor (`discovery.json.gz`).

## Fase 5 — Dívida técnica (quase no fim)

- ✅ **Removidos:** a tradução antiga do backend (~10,7 mil linhas, `ebooklib` incluso) e o
  catálogo SQLite que ninguém lia.
- ✅ **EPUB:** grava autor, sinopse e idioma reais.
- ✅ **Conectores:** helpers comuns em `connectors/_common.py`. O portão do autoconnector
  exige tags e a listagem completa de capítulos.
- ✅ **Docs atualizadas:** `STRUCTURE`, `ARCHITECTURE`, `KINDLE`, este roteiro; os planos
  encerrados foram para `archive/`.
- ⏳ **Dividir `SettingsSections.tsx`** (~800 linhas).
- ⏸ **Um só gerador de EPUB** — junto com o download no Rust (retomada por `Range` e `.part`).
  Ver "Decisões em aberto" em `ARCHITECTURE.md`.
- ⏸ **Remover a API FastAPI** — depois de uma semana estável só com a VPS: mover `raw` para
  o bucket privado e arquivar o xeonserver.

## Pendências que dependem do Jandson

- **`oghma publish-prune`**: libera ~30 GB de versões antigas no B2 e não tem volta. Rodar
  depois da primeira volta completa do rodízio.
- **Login do Claude Code como `oghma-agent`** na VPS (interativo; o Codex já está logado).
- **Sky Demon Order e Light Novel Pub** devolvem 403 e precisam de uma estratégia (cookie,
  impersonate ou proxy).

## Ideias para depois

- **Leitor embutido** com progresso (reaproveitando `features/translation/Reader.tsx`). É o
  melhor sinal de gosto para as recomendações.
- **Paleta ⌘K**, que também abriria o filtro inteligente.
- **Tema claro.**
- **Estatísticas de leitura.**
- **Backup e exportação da biblioteca.**
- **Download incremental**, só com os capítulos novos.
