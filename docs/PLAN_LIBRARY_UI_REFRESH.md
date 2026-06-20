# Plano de ajustes da Biblioteca local

Data: 2026-06-20

## Objetivo

A tela de Biblioteca local deve ficar visualmente mais proxima da tela de busca, sem perder a funcao principal: encontrar livros ja baixados, selecionar um item e converter/abrir os arquivos locais.

## Problemas observados

- A Biblioteca usa uma composicao propria, enquanto a busca ja tem um padrao mais maduro de toolbar, filtros rapidos e painel lateral.
- O resumo grande dentro dos filtros ocupa espaco e repete uma informacao que funciona melhor no cabecalho da lista.
- O botao de filtro fica no topo junto do botao de conversao, diferente da busca, onde o botao de filtro ficou mais ligado a linha de filtros ativos.
- O painel de detalhes nao tem cabecalho proprio e parece menos organizado que o painel de detalhes da busca.
- Os cards mostram informacoes locais, mas a hierarquia ainda esta pesada: autor desconhecido, capitulos locais e formatos competem entre si.
- A acao de abrir pasta existe no card, mas nao aparece no detalhe lateral, onde o usuario naturalmente espera uma acao contextual.

## Direcao visual

- Reaproveitar o padrao da tela Discover onde fizer sentido:
  - toolbar no topo da area central;
  - linha de filtros rapidos logo abaixo;
  - botao de filtro icon-only;
  - pills para filtros ativos;
  - painel lateral com titulo "Detalhes".
- Manter a Biblioteca mais operacional do que exploratoria:
  - menos filtros do que Discover;
  - mais foco em arquivo, formato, tamanho e pasta local.
- Evitar criar um segundo design system paralelo.

## Fase 1 - Ajustes imediatos

- Remover o resumo grande dos filtros e mover contagem para o cabecalho.
- Trocar o cabecalho de resultados para o mesmo estilo de toolbar usado na busca.
- Mover o botao de abrir/ocultar filtros para a linha de filtros rapidos.
- Criar pills rapidas para:
  - busca ativa, clicando limpa;
  - formato ativo, clicando volta para "Todos";
  - selecao ativa, apenas informativa.
- Deixar "Converter" com altura equivalente aos botoes principais recentes.
- Reestruturar o painel de detalhes com:
  - cabecalho "Detalhes";
  - subtitulo "Livro selecionado";
  - acao "Abrir pasta";
  - metadados em pills/linhas mais claras.

## Fase 2 - Refinamento dos cards

- Reduzir informacoes de baixo valor quando forem "Desconhecido" ou "Capitulos locais".
- Ajustar alinhamento dos badges de formato para nao competir com o botao de pasta.
- Avaliar um layout compacto/lista para bibliotecas grandes.
- Adicionar estado vazio mais util quando nao houver resultado filtrado.

## Fase 3 - Funcionalidades futuras

- Ordenacao alfabetica e por data local.
- Filtro por fonte local quando os metadados estiverem confiaveis.
- Acoes por item no detalhe: abrir pasta, abrir EPUB/HTML, reenviar para Kindle.
- Separar biblioteca por "baixado", "convertido" e "enviado ao Kindle" quando esses estados existirem.

## Validacao

- Build TypeScript/Vite deve passar.
- Fluxos a verificar manualmente:
  - filtrar por texto;
  - filtrar por formato;
  - ocultar/exibir filtros;
  - selecionar/desselecionar livro;
  - converter selecionado;
  - abrir pasta pelo card e pelo detalhe.
