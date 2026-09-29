# Redesign 2026-10: v1.0.0 × nova interface

Comparação entre a v1.0.0 (branch `main`) e o redesign (branch `redesign/ui-2026-10`): desempenho, teste de carga da fila, usabilidade e visual. Números de 29/09/2026 no MacBook, Chromium headless via Playwright, 7 rodadas por versão (mediana; p95 nos arquivos brutos).

## Resumo

- **Mais rápido onde importa:** os primeiros 24 cards aparecem 39% antes (−41% com CPU 4×). O trabalho que trava a tela na abertura (TBT) caiu 69%. A Biblioteca com 500 livros abre 50% mais rápido (−29% com CPU 4×).
- **Cancelar agora funciona:** a v1 continuava baixando e gravando o livro cancelado. A nova aborta a requisição, não grava nenhum arquivo do livro cancelado e começa o próximo em ~0,3 s (antes, ~3,1 s).
- **Tarefas mais curtas:** trocar a pasta de saída caiu de 62 interações para 3 (seletor nativo). Rebaixar e enviar ao Kindle viraram ações diretas da Biblioteca.
- **CSS consistente:** de 154 cores hex diferentes espalhadas para 28, todas em `tokens.css`, sem `!important`. O `npm run lint:css` impede regressões.
- **Custos:** o bundle de entrada cresceu (96 → 125 KB gzip) e a busca tem um debounce de 120 ms de propósito (o trabalho por tecla ficou 71% menor).

## Método

- Harness em `apps/desktop/bench/` (veja o `README.md` de lá). Fixtures determinísticas: catálogo de 5.000 novels, biblioteca de 500 livros, bundles falsos. Um shim de `__TAURI_INTERNALS__` responde os comandos Rust, então as duas versões rodam sem mudar o código delas.
- As duas versões são compiladas com os mesmos flags (`vite build --minify`) e servidas por `vite preview`.
- Duas passadas: CPU normal e CPU 4× mais lenta (mais estável, simula uma máquina fraca).
- Resultados brutos: `apps/desktop/bench/results/final-2026-09-29/` (`perf.md`, `cpu4x/perf.md`, `usability.md`, JSON e screenshots). Linha de base anterior ao redesign: `results/baseline-2026-09-29/`.

```bash
cd apps/desktop/bench
node lib/build.mjs
node run.mjs --serve --runs 7 --out results/<dir>
node run.mjs --serve --runs 7 --cpu-throttle 4 --skip-queue --out results/<dir>/cpu4x
node screens.mjs --serve --out results/<dir>/screens
node usability.mjs --serve --out results/<dir>
```

## Desempenho

| Métrica (mediana) | v1.0.0 | nova | Δ | CPU 4×: v1 → nova |
| --- | --- | --- | --- | --- |
| Splash some / app visível | 613 ms | 482 ms | −21% | 1.289 → 978 ms (−24%) |
| Primeiros 24 cards | 330 ms | 202 ms | −39% | 1.267 → 746 ms (−41%) |
| TBT na abertura | 135 ms | 42 ms | −69% | 874 → 337 ms (−61%) |
| Biblioteca (500 livros) aberta | 61 ms | 31 ms | −50% | 148 → 105 ms (−29%) |
| TBT durante a busca | 977 ms | 279 ms | −71% | 6.749 → 1.729 ms (−74%) |
| Tecla → resultados da busca | 20 ms | 152 ms | +669%¹ | 62 → 185 ms |
| Rolagem | 60 fps | 60 fps | = | 60 → 60 fps |
| Heap JS após Biblioteca | 21,6 MB | 24,2 MB | +12% | igual |
| Nós DOM após Biblioteca | 8.556 | 10.915 | +28% | igual |
| First Contentful Paint | 48 ms | 56 ms | +17% | 124 → 152 ms |

¹ A busca tem um debounce de 120 ms: espera o usuário parar de digitar antes de filtrar. Na v1 cada tecla filtrava na hora, mas travava a tela (TBT 977 ms). Agora o custo real por busca é ~30 ms e a tela não trava.

### Tamanho dos arquivos

| | v1.0.0 | nova |
| --- | --- | --- |
| JS de entrada (gzip) | 96 KB | 125 KB |
| JS total (gzip) | 101 KB | 156 KB |
| CSS (gzip) | 10 KB | 20 KB |
| Cores hex diferentes no CSS | 154 | 28 (todas em tokens) |
| Variáveis CSS definidas | 24 | 154 |
| `!important` | 2 | 0 |

O JS cresceu por causa da fila de download, do sistema de componentes e das telas novas (Kindle, Ajustes completos, detalhes da Biblioteca). As telas secundárias ficam em chunks separados, carregados depois da abertura, então só o entry pesa no início.

### Otimizações feitas depois da primeira medição

A primeira rodada mostrou regressões. Todas foram corrigidas:

- **Splash:** um timer fixo segurava a tela por 520 ms após o boot. Caiu para 180 ms + 200 ms de fade (splash: +55% → −21%).
- **Bundle:** as telas secundárias passaram a ser carregadas sob demanda e pré-carregadas após o boot (entry: 142 → 125 KB gzip).
- **Suspense do React 19:** ele segura o conteúdo por ~300 ms depois de mostrar o fallback. Views já em cache agora renderizam sem Suspense (Biblioteca: 367 → 31 ms).
- **Biblioteca:** `content-visibility: auto` nos cards pula o layout dos que estão fora da tela (CPU 4×: 199 → 105 ms).
- **Busca:** debounce de 250 → 120 ms.

## Teste de carga da fila

Enfileirar o máximo de livros e cancelar o download ativo no meio, com bundles atrasados artificialmente.

| Verificação | v1.0.0 | nova |
| --- | --- | --- |
| Downloads simultâneos | 1 | 1 |
| Requisição do livro cancelado foi abortada | não | **sim** |
| Arquivos gravados do livro cancelado após cancelar | 2 | **0** |
| Próximo download começa após cancelar | 3.099 ms | **304 ms** |
| Livros aceitos | 12 (sem limite) | 11 (1 ativo + 10 na fila) |

## Usabilidade (cliques + teclas por tarefa)

| Tarefa | v1.0.0 | nova |
| --- | --- | --- |
| Baixar um livro | 9 | 9 |
| Cancelar o download ativo | 2 | 3 (pede confirmação) |
| Rebaixar um livro da Biblioteca | 10 (pela Busca, sem ação na Biblioteca) | 9 (Biblioteca → "Baixar novamente") |
| Enviar um livro ao Kindle | não automatizável (fluxo de fila no modo Kindle) | 9 (detalhes → "Enviar ao Kindle") |
| Trocar a pasta de saída | 62 (campo de texto; Ctrl+A bloqueado) | 3 (Ajustes → Downloads → Escolher…) |

Cancelar ganhou um clique de propósito: a confirmação evita perder um download longo sem querer.

## Visual

As galerias lado a lado ficam em `apps/desktop/bench/results/final-2026-09-29/screens/index.html` (Windows) e `screens-macos/index.html` (UA do macOS), em 1280×800 e 1120×720.

- **Ajustes:** eram três painéis soltos com rótulos sem acento. Agora é um cartão com navegação por categorias (Geral, Downloads, Fontes e servidor, Kindle, Áudio e tradução, Sobre), descrição em cada grupo, validação inline e seletor de pasta.
- **Configuração inicial:** era um modal com stepper de 7 colunas de texto. Agora são 5 passos em tela cheia, com indicador de progresso e rodapé fixo.
- **Biblioteca:** ganhou página de detalhes com hero, ações diretas (Enviar ao Kindle, Baixar novamente, Converter) e "Zona de perigo" com confirmação.
- **Downloads:** card principal com progresso, velocidade e tempo restante reais, e fila reordenável.
- **Barra de título:** no macOS usa os semáforos nativos. No Windows/Linux fica a barra customizada, com o ícone de restaurar quando maximizada.

## Pendências conhecidas

- **Semáforos nativos do macOS:** o app nativo compilou e abriu, mas a captura de tela falhou porque o terminal não tem permissão de Gravação de Tela. A config (`tauri.macos.conf.json`) e as capturas com UA de macOS estão corretas; falta conferir no app real.
- **Windows:** barra de título e maximizar/restaurar não foram testados em Windows real.
- **Pausar recomeça do zero:** o bundle é um arquivo único, sem retomada parcial.
- **Tradução:** continua em prévia (trabalhos em memória), agora sinalizado na tela.
