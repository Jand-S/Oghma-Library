# Checkpoint: filtros de tags e taxonomia

Data: 2026-06-20

Este documento registra o pacote de mudanças feito na tela Discover e no fluxo de catalogo/publicacao para suportar filtros de tags mais completos, normalizacao de tags vindas de fontes em ingles e classificacao de conteudo.

## Objetivo

Melhorar a busca de novels no Discover para aguentar um catalogo crescente sem depender de uma lista pequena e fixa de chips. A solucao passou a separar tags por formato, genero e tema, permitir inclusao/exclusao de tags, e adicionar uma classificacao de conteudo simples para filtrar obras seguras, sugestivas ou eroticas.

## Desktop

- A tela Discover recebeu um editor lateral de tags com busca, secoes por categoria e selecao em tres estados:
  - primeiro clique: tag obrigatoria;
  - segundo clique: tag proibida;
  - terceiro clique: remove o filtro.
- As tags selecionadas aparecem no resumo do painel de filtros e na linha de filtros ativos.
- As tags nao mudam mais de posicao quando sao clicadas dentro da lista, evitando o problema de tentar clicar duas vezes rapido para marcar como proibida.
- O filtro antigo de tags simples foi substituido por `includeTags` e `excludeTags`.
- Foi adicionado o filtro `Classificacao de conteudo` com tres opcoes:
  - `Seguro`: nenhuma tag sugestiva ou erotica;
  - `Sugestivo`: tags como `Ecchi`, `Harem`, `Loli`, `Shota`, `Monster Girls`, etc., desde que nao haja tag erotica;
  - `Erotico`: tags como `Adulto`, `18+`, `Smut`, `BDSM`, `Incesto`, `Nonconsensual`, etc.
- A classificacao erotica tem prioridade sobre sugestiva quando uma novel possui tags dos dois grupos.

## Taxonomia

- Foi criado um modulo central de taxonomia no backend em `backend/src/oghma/taxonomy/`.
- A taxonomia define chaves canonicas por categoria:
  - `format.*`
  - `genre.*`
  - `theme.*`
  - `raw.*` para tags ainda desconhecidas.
- Tags em ingles e portugues passam por aliases para chegar na mesma chave canonica. Exemplos:
  - `Action` e `Acao` viram `genre.action`;
  - `Fantasy` e `Fantasia` viram `genre.fantasy`;
  - `Adult`, `Mature`, `18+` e `Adulto` viram `genre.adult`.
- Tags desconhecidas nao sao descartadas. Elas ficam como `raw.*`, aparecem como `theme` e podem ser revisadas depois.

## Publicacao B2 / catalogo estatico

- O catalogo JSON publicado agora carrega:
  - `taxonomyVersion`;
  - `taxonomy`;
  - `tagKeys` por novel.
- O desktop usa a taxonomia publicada quando ela existe.
- Se um catalogo antigo nao tiver taxonomia, o desktop gera uma taxonomia local de fallback a partir das novels.
- O catalogo SQLite tambem recebeu `tag_keys` para manter compatibilidade com o fluxo de publicacao e consultas futuras.

## API e banco

- `Novel` passou a ter `tag_keys` no backend.
- O endpoint `/api/tags` foi adicionado para retornar a taxonomia agregada por fonte.
- O endpoint `/api/novels` aceita:
  - `includeTag`;
  - `excludeTag`;
  - `contentRating`.
- A filtragem por tag usa arrays e operadores do PostgreSQL (`contains` e `overlap`), mantendo a consulta barata para catalogos grandes.
- Foi adicionado o comando:
  - `python -m oghma.cli normalize-tags --apply`
- Esse comando recalcula `novel.tag_keys` a partir das tags brutas existentes e lista tags desconhecidas para curadoria.

## Crawler

- O orquestrador do scraper agora grava `tag_keys` quando salva metadados da novel.
- Isso faz com que novas novels ja entrem normalizadas, sem depender de um reparo posterior.

## Testes

Foram adicionados/ajustados testes para:

- normalizacao de aliases da taxonomia;
- preservacao de tags desconhecidas como `raw.*`;
- publicacao de `tagKeys` no catalogo;
- filtros por tags no mock/static backend;
- classificacao de conteudo no desktop.

Comandos validados neste checkpoint:

```powershell
cd "C:\Users\Jandson\Documents\Oghma Library\apps\desktop"
npm run build -- --mode development
npm test -- --run src/test/tagFilters.test.ts src/test/mockBackend.test.ts src/test/staticBackend.test.ts
```

```powershell
cd "C:\Users\Jandson\Documents\Oghma Library"
python -m py_compile backend/src/oghma/api/routes.py
```

## Observacoes

- Algumas labels/aliases ainda estao sem acento por compatibilidade com o estado atual dos arquivos e para evitar churn visual desnecessario.
- Existem aliases com texto mojibake herdado de dados anteriores. Eles foram mantidos de proposito para continuar reconhecendo tags antigas que ja entraram assim na base.
- A taxonomia deve ser tratada como versionada: sempre que novas tags comuns aparecerem como `raw.*`, vale promover essas tags para aliases canonicos.

## Proximos passos sugeridos

- Rodar `normalize-tags --apply` no servidor depois de publicar/atualizar o schema, se ainda houver novels antigas sem `tag_keys`.
- Conferir periodicamente as tags `raw.*` mais frequentes e transformar em aliases oficiais.
- Adicionar contadores por classificacao de conteudo no painel de filtros caso fique util para curadoria.
- Avaliar se `Boys Love` e `Girls Love` devem permanecer neutros ou virar sugestivos dependendo do comportamento real dos sites.
