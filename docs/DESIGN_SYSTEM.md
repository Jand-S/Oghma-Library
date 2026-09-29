# Design system do Oghma Library (desktop)

Guia do design system do app desktop (`apps/desktop`). Este arquivo e a galeria ao vivo são a
fonte da verdade da interface: tokens, camadas CSS, primitivas, shell e regras de revisão.

- **Galeria ao vivo:** em `apps/desktop`, rode `npm run dev` e abra `http://127.0.0.1:5173/?gallery`.
  O código fica em `src/dev/Gallery.tsx`. Ela só existe em dev (`import.meta.env.DEV`) e não vai
  para o build de produção.
- **Tokens:** `apps/desktop/src/styles/tokens.css`. Se esta página divergir do arquivo, vale o arquivo.
  Nesse caso, corrija esta página.
- **Lint:** `npm run lint:css` (`scripts/check-css.mjs`).

> `docs/design-system/index.html` era um mock estático antigo. Hoje ele só aponta para cá.

## Sumário

1. [Princípios](#1-princípios)
2. [Arquitetura de camadas](#2-arquitetura-de-camadas)
3. [Convenções de nomes](#3-convenções-de-nomes)
4. [Tokens](#4-tokens)
5. [Regras do `lint:css`](#5-regras-do-lintcss)
6. [Catálogo de primitivas](#6-catálogo-de-primitivas)
7. [Shell e plataforma](#7-shell-e-plataforma)
8. [Como adicionar uma tela](#8-como-adicionar-uma-tela)
9. [Tema claro (futuro)](#9-tema-claro-futuro)
10. [Movimento e `prefers-reduced-motion`](#10-movimento-e-prefers-reduced-motion)
11. [Ícones](#11-ícones)
12. [Checklist de revisão de PR de UI](#12-checklist-de-revisão-de-pr-de-ui)
13. [Telas](#13-telas)

---

## 1. Princípios

A referência visual é o **Hydra Launcher** (fork `Jand-S/hydra`). A marca continua sendo o teal do Oghma.

- **Escuro neutro.** O fundo é preto neutro, sem tom azulado: `#0d0d0d` na sidebar e `#121212` no
  app. As superfícies sobem em degraus de cinza (`--surface-1/2/3`). Não há gradientes decorativos.
- **Um acento só.** O teal `#00796b` (`--accent`) marca ação primária, item ativo, foco e progresso.
  Não use o acento em áreas grandes nem em texto corrido. As cores de status (`--danger`,
  `--warning`, `--success`, `--info`) só servem para comunicar estado.
- **Vidro (glass).** Painéis flutuantes e botões sobre imagem usam fundo branco translúcido
  (`--glass`, `--glass-strong`) com `backdrop-filter: blur(var(--glass-blur))`. Use com moderação:
  vidro sobre vidro vira ruído.
- **Grade de 8px.** Todo espaçamento vem de `--space-*` (4, 8, 12, 16, 24, 32, 40, 48, 64). Os
  controles têm 32, 40 ou 48px de altura (`--control-sm/md/lg`).
- **Capas grandes 2:3.** O livro é o protagonista. Capas usam `--cover-ratio: 2 / 3` e o
  componente `Cover`, que mostra as iniciais do título quando não há imagem.
- **Movimento curto e discreto.** O padrão é `transition: all var(--dur-base) var(--ease)`, que dá a
  sensação "`all .2s ease`" do Hydra. Nada pisca nem quica. Tudo zera com `prefers-reduced-motion`.
- **Semântica antes de estilo.** Componentes expõem papéis e rótulos ARIA corretos. Os testes
  consultam por role, label e `data-testid`, nunca por classe CSS.
- **Textos em pt-BR com acentos.** Strings visíveis ficam em `src/strings/*`. Identificadores,
  comentários e mensagens de commit ficam em inglês.
- **Só tema escuro por enquanto.** Como os tokens são semânticos, um tema claro é só um bloco de
  override (veja a [seção 9](#9-tema-claro-futuro)).

## 2. Arquitetura de camadas

O CSS é global e simples, sem CSS-in-JS nem CSS Modules, organizado em **cascade layers**.
`src/styles/index.css` declara a ordem uma única vez, antes de qualquer outro CSS:

```css
@layer reset, tokens, base, layout, components, features, legacy, utilities;
```

`main.tsx` importa `./styles/index.css` **antes** de qualquer componente. Assim a declaração de
ordem sempre chega primeiro, mesmo que o CSS de uma primitiva seja importado por outro módulo.

| Camada | Onde fica | O que contém |
|---|---|---|
| `reset` | `styles/reset.css` | Reset moderno mínimo: `box-sizing`, margens zeradas, `img/svg` em bloco, `[hidden]`. |
| `tokens` | `styles/tokens.css` | Custom properties em `:root`, override de `[data-platform="macos"]` e zeragem de durações com `prefers-reduced-motion`. É o **único** arquivo com hex, rgba e px crus. |
| `base` | `styles/base.css` | Estilos de elementos (`body`, `h1–h3`, `a`, inputs simples), `:focus-visible`, scrollbar fina, `@keyframes` e regra global de movimento reduzido. |
| `layout` | `styles/layout.css` | Grade do shell: `.o-app` e `.o-app__*` (titlebar, sidebar, main, content, bottom). |
| `components` | `src/ui/*.css`, `src/shell/*.css` | Primitivas `.o-*` e partes do shell. Cada `.tsx` importa o próprio `.css`. |
| `features` | CSS colocado junto de cada tela | Estilos de tela com prefixo de feature (`.discover-*`, `.library-*`...). |
| `legacy` | `styles/legacy/*` | CSS antigo das telas, **temporário**. O P2 o remove tela por tela. |
| `utilities` | `styles/utilities.css` | Helpers de propósito único (`.sr-only`, `.truncate`, `.stack`, `.cluster`, `.grow`, `.text-muted`). |

**Por que camadas:**

- Com camadas, quem vence é a camada, não a especificidade. Um `.o-button` em `components` perde
  para uma regra de `features`, mesmo que o seletor da feature seja mais fraco. Por isso não precisamos
  de `!important`, que o lint proíbe, nem de seletores inflados.
- `legacy` fica **acima** de `features` de propósito. Enquanto uma tela antiga não é migrada, o CSS
  antigo continua valendo como antes. Quando a tela migra, o CSS dela sai de `legacy` e passa a
  morar em `features`.
- `utilities` fica no topo para que `.sr-only` e `.truncate` sempre funcionem.
- `tokens` fica abaixo de tudo. Qualquer escopo (`[data-theme]`, `[data-platform]` ou uma variável
  local de componente) pode sobrescrever um token.

**Regras práticas:**

- Todo arquivo CSS novo envolve **todas** as regras em `@layer <nome> { … }`. Uma regra fora de
  camada ganharia de todas as camadas, e o lint acusa `unlayered`.
- Primitivas usam `@layer components`, telas usam `@layer features`.
- Não importe CSS de feature dentro de `src/ui/`. Primitivas não conhecem telas.
- Não crie camadas novas sem atualizar `index.css` e este guia.

## 3. Convenções de nomes

### Primitivas e shell: `.o-` + BEM

```text
.o-<bloco>                  .o-button
.o-<bloco>__<elemento>      .o-button__icon, .o-modal__footer
.o-<bloco>--<modificador>   .o-button--primary, .o-button--sm, .o-progress--indeterminate
```

- **Estados** usam `is-*` combinado com o bloco: `.o-button.is-loading`, `.o-sidebar__item.is-active`,
  `.o-segmented__option.is-selected`. Quando existe atributo ARIA equivalente (`aria-pressed`,
  `aria-checked`, `aria-current`), o componente **também** o define, e os testes usam o atributo.
- **Variáveis locais de componente** usam o nome do bloco, como `--button-h` e `--chip-bg`. Elas
  são definidas no bloco e trocadas pelos modificadores.
- O shell usa o mesmo prefixo: `.o-app`, `.o-sidebar`, `.o-titlebar`, `.o-page-header`,
  `.o-bottom-panel`, `.o-splash`, `.o-window-controls`.

### Telas (features): prefixo da feature

| Feature | Prefixo | Pasta |
|---|---|---|
| Buscar | `.discover-*` | `src/features/discover/` |
| Biblioteca | `.library-*` | `src/features/library/` |
| Downloads | `.downloads-*` | `src/features/downloads/` |
| Ajustes | `.settings-*` | `src/features/settings/` |
| Onboarding | `.onboarding-*` | `src/features/onboarding/` |
| Fontes | `.sources-*` | `src/features/sources/` |
| Tradução | `.translation-*` | `src/features/translation/` |
| Kindle | `.kindle-*` | `src/features/kindle/` |

Dentro da feature, siga a mesma forma BEM: `.library-card`, `.library-card__title`, `.library-card--compact`.

### Ganchos de comportamento: `data-*`

Não use classe CSS como gancho de JavaScript nem de teste. Para "clicar no fundo fecha o
painel", por exemplo, prefira `data-*` ou refs. Os handlers antigos de `views/discover.tsx` e
`views/library.tsx` ainda usam `closest(".toolbar")`, `.content-area`, `.book-grid` e outras
classes. Se você renomear essas classes, atualize os handlers junto (veja o `BRIEF.md` do redesign).

### Helpers

- `cx(...parts)` (`src/ui/cx.ts`) junta classes e ignora valores falsos.
- `getFocusable(root)` (`src/ui/focus.ts`) lista os elementos focáveis, na ordem do DOM.

## 4. Tokens

Todos ficam em `src/styles/tokens.css`, dentro de `@layer tokens`, em `:root` (com
`color-scheme: dark`). Use sempre `var(--token)`. Os tokens `*-rgb` guardam **canais** (`0 121 107`)
para compor transparência: `rgb(var(--accent-rgb) / 0.14)`. Não use `color-mix` para isso.

### Superfícies

| Token | Valor | Uso |
|---|---|---|
| `--bg-app` | `#121212` | Fundo do app, da área principal e da borda interna do anel de foco. |
| `--bg-sidebar` | `#0d0d0d` | Fundo da sidebar e da titlebar, o plano mais escuro. |
| `--surface-1` | `#1a1a1a` | Cards, painéis e inputs. |
| `--surface-2` | `#222` | Superfície elevada: hover de card, menus, modais. |
| `--surface-3` | `#2c2c2c` | Superfície mais alta: trilho de switch, skeleton, fundo de capa sem imagem. |
| `--glass` | `rgba(255,255,255,.06)` | Fundo de vidro: botão `glass`, chip, badge neutro, ícone de EmptyState. |
| `--glass-strong` | `rgba(255,255,255,.1)` | Hover do vidro, chip selecionado. |
| `--glass-blur` | `16px` | Raio do `backdrop-filter: blur()` em vidro, modal e painel `glass`. |
| `--backdrop` | `rgba(0,0,0,.7)` | Véu atrás de modais. |
| `--hover` | `rgba(255,255,255,.08)` | Fundo de hover de itens neutros (menu, sidebar, ghost). |
| `--active` | `rgba(255,255,255,.12)` | Fundo de pressionado/ativo de itens neutros. |

### Bordas

| Token | Valor | Uso |
|---|---|---|
| `--border` | `rgba(255,255,255,.08)` | Borda padrão (hairline) de cards, inputs e divisórias. |
| `--border-strong` | `rgba(255,255,255,.16)` | Borda em hover, botão `outline`, thumb da scrollbar. |

### Texto

| Token | Valor | Uso |
|---|---|---|
| `--text` | `#f0f1f7` | Texto principal e títulos. |
| `--text-2` | `#d0d1d7` | Texto secundário com boa leitura (descrições, corpo de card). |
| `--text-muted` | `#9a9ba3` | Metadados, hints, `<small>`, rótulos auxiliares. |
| `--text-disabled` | `#5f6068` | Placeholder e itens desabilitados. |

### Marca

| Token | Valor | Uso |
|---|---|---|
| `--accent` | `#00796b` | Ação primária, item ativo, progresso, borda de foco do input. |
| `--accent-hover` | `#00897b` | Hover do primário e cor de links. |
| `--accent-press` | `#00695c` | Estado pressionado do primário. |
| `--accent-fg` | `#fff` | Texto e ícone sobre `--accent`. |
| `--accent-rgb` | `0 121 107` | Canais para tons translúcidos: `rgb(var(--accent-rgb) / .14)`. |
| `--accent-text` | `#d7f4ef` | Texto sobre fundo de acento suave (badge e chip `accent`). |
| `--danger-text` | `#f2b3bc` | Texto sobre fundo de perigo suave (badge/chip `danger`, erro de campo, item de menu `danger`). |

### Status

| Token | Valor | Uso |
|---|---|---|
| `--danger` / `--danger-rgb` | `#c94b5b` / `201 75 91` | Erro, ação destrutiva, botão `danger`. |
| `--warning` / `--warning-rgb` | `#d9a441` / `217 164 65` | Aviso, estado pausado. |
| `--success` / `--success-rgb` | `#76b878` / `118 184 120` | Concluído, Kindle conectado. |
| `--info` / `--info-rgb` | `#4fb7e8` / `79 183 232` | Toast informativo. |
| `--black-rgb` | `0 0 0` | Canais para sombras e véus compostos. Reservado para o tema claro. |
| `--white-rgb` | `255 255 255` | Canais para brilhos (sheen da capa). |

### Foco

| Token | Valor | Uso |
|---|---|---|
| `--focus-ring` | `0 0 0 2px var(--bg-app), 0 0 0 4px rgb(var(--accent-rgb) / .7)` | `box-shadow` de `:focus-visible` (em `base.css`). Tem um anel interno da cor do fundo e um externo teal. |

### Espaçamento (unidade de 8px)

| Token | Valor | Uso típico |
|---|---|---|
| `--space-0-5` | `4px` | Gap entre ícone e texto pequeno, folgas finas. |
| `--space-1` | `8px` | Gap padrão entre controles, padding de item de menu. |
| `--space-1-5` | `12px` | Padding horizontal de botão `sm`, gap de card. |
| `--space-2` | `16px` | Padding de botão `md`, padding de painel, gap de pilha (`.stack`). |
| `--space-3` | `24px` | Padding de modal e de seções, padding de botão `lg`. |
| `--space-4` | `32px` | Margem entre blocos grandes, padding de tela vazia. |
| `--space-5` | `40px` | Espaço vertical generoso. |
| `--space-6` | `48px` | Espaço entre seções de página. |
| `--space-8` | `64px` | Espaços de hero e larguras mínimas (EmptyState, modais). |

### Raios

| Token | Valor | Uso |
|---|---|---|
| `--radius-xs` | `4px` | Badges, capas pequenas, handles. |
| `--radius-sm` | `6px` | Inputs simples, itens de menu. |
| `--radius-md` | `8px` | Botões, cards, capas. |
| `--radius-lg` | `12px` | Modais, painéis, toasts. |
| `--radius-pill` | `999px` | Chips, switches, barras de progresso, scrollbar. |

### Tipografia

| Token | Valor | Uso |
|---|---|---|
| `--font-sans` | `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Roboto, sans-serif` | Fonte da interface. |
| `--font-mono` | `"JetBrains Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace` | `code`, `kbd`, `pre`, caminhos e detalhes de erro. |
| `--fs-xs` | `12px` | `<small>`, metadados, badges. |
| `--fs-sm` | `13px` | Botão `sm`, hints, `h3`. |
| `--fs-md` | `14px` | Corpo (padrão do `body`). |
| `--fs-lg` | `16px` | `h2`, botão `lg`, títulos de card grandes. |
| `--fs-xl` | `20px` | Título de modal e de seção de destaque. |
| `--fs-2xl` | `24px` | `h1`, título do PageHeader. |
| `--fs-3xl` | `32px` | Números de destaque e hero. Ainda não é usado. |
| `--lh-tight` | `1.25` | Títulos e controles. |
| `--lh-base` | `1.5` | Corpo de texto. |
| `--fw-regular` | `400` | Corpo. |
| `--fw-medium` | `500` | Itens de navegação, rótulos. |
| `--fw-semibold` | `600` | Botões, títulos de card. |
| `--fw-bold` | `700` | `h1–h3`. |

### Controles e ícones

| Token | Valor | Uso |
|---|---|---|
| `--control-sm` | `32px` | Altura de botão, IconButton e segmented `sm`. |
| `--control-md` | `40px` | Altura padrão de controles. |
| `--control-lg` | `48px` | Botões grandes e CTAs. |
| `--icon-sm` | `16px` | Ícone em botão, chip, menu, campo, spinner `sm`. |
| `--icon-md` | `20px` | Ícone de IconButton `md` e da sidebar; base do Switch. |
| `--icon-lg` | `24px` | IconButton `lg`, logo da sidebar. |

### Layout

| Token | Valor | Uso |
|---|---|---|
| `--app-min-w` | `1120px` | `min-width` do `body`. Igual ao `minWidth` da janela no `tauri.conf.json`. |
| `--sidebar-w` | `240px` | Largura padrão da sidebar. |
| `--sidebar-w-min` | `200px` | Largura mínima ao redimensionar. |
| `--sidebar-w-max` | `320px` | Largura máxima ao redimensionar. |
| `--sidebar-w-collapsed` | `72px` | Sidebar recolhida (só ícones). |
| `--sidebar-handle` | `5px` | Largura da alça de redimensionar. |
| `--titlebar-h` | `35px` (`0px` em `[data-platform="macos"]`) | Linha da titlebar customizada na grade do shell. |
| `--mac-inset-top` | `40px` | Padding superior da sidebar no macOS, que abre espaço para os semáforos nativos. |
| `--header-h` | `56px` | Altura do PageHeader. |
| `--bottom-panel-h` | `28px` | Altura do BottomPanel. Os toasts também se posicionam acima dele. |
| `--cover-ratio` | `2 / 3` | `aspect-ratio` das capas. |
| `--scrollbar` | `9px` | Largura/altura da scrollbar WebKit. |
| `--hairline` | `1px` | Espessura de linhas finas quando o valor precisa entrar em `calc()`. |
| `--ring-width` | `2px` | Bordas grossas: anel de seleção, borda interna da scrollbar, thumb do switch. |

A largura atual da sidebar vive em `--sidebar-current`, uma variável local que o `AppShell` escreve
inline ao redimensionar. Não é token.

### Z-index

| Token | Valor | Uso |
|---|---|---|
| `--z-sticky` | `10` | Elementos sticky dentro do conteúdo, BottomPanel. |
| `--z-header` | `20` | PageHeader. |
| `--z-sidebar` | `30` | Sidebar e a alça de resize. |
| `--z-dropdown` | `40` | DropdownMenu e menus de contexto. |
| `--z-backdrop` | `50` | Véus soltos. Reservado, o Modal usa a própria camada. |
| `--z-modal` | `60` | Modal e o véu dele. |
| `--z-toast` | `70` | Região de toasts. |
| `--z-titlebar` | `80` | Titlebar (Windows/Linux), sempre arrastável. |
| `--z-splash` | `90` | SplashScreen, acima de tudo. |

### Movimento

| Token | Valor | Uso |
|---|---|---|
| `--ease` | `cubic-bezier(0.2, 0, 0, 1)` | Curva padrão de todas as transições e animações. |
| `--dur-fast` | `120ms` (`0ms` com movimento reduzido) | Hover, cor de borda, microfeedback. |
| `--dur-base` | `200ms` (`0ms` com movimento reduzido) | Transições padrão e entrada de tela (`fade-in`). |
| `--dur-slow` | `320ms` (`0ms` com movimento reduzido) | Modais, splash, recolher a sidebar. |

### Sombras

| Token | Valor | Uso |
|---|---|---|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,.4)` | Capas, thumb do Switch. |
| `--shadow-md` | `0 8px 24px rgba(0,0,0,.4)` | Menus, toasts. |
| `--shadow-lg` | `0 18px 48px rgba(0,0,0,.5)` | Modais. |

### Keyframes (em `styles/base.css`)

`fade-in`, `scale-fade-in`, `toast-in`, `shimmer` (skeleton), `spin` (spinner), `splash-in`,
`splash-out` e `countdown` (barra de tempo do toast). Use sempre com as durações e a curva dos tokens:

```css
animation: scale-fade-in var(--dur-slow) var(--ease) both;
```

## 5. Regras do `lint:css`

```bash
cd apps/desktop
npm run lint:css             # falha (exit 1) se houver erro fora de styles/legacy/
node scripts/check-css.mjs --verbose   # também lista os avisos do legacy
```

O script `scripts/check-css.mjs` não tem dependências. Ele varre `src/**/*.css`, exceto
`styles/tokens.css`, e aponta:

| Código | Regra |
|---|---|
| `raw-hex` | Cor hex crua (`#fff`). Use um token de cor. |
| `raw-color` | `rgb()`/`rgba()`/`hsl()`/`hsla()` com canais literais. Só vale `rgb(var(--x-rgb) / a)`. |
| `raw-px` | Literal em `px` diferente de `0`, `1px` e `-1px`. Use `--space-*`, `--control-*`, `--icon-*`, `--hairline`, `--ring-width` ou `calc()` com tokens. Condições de `@media`/`@container` não são checadas. |
| `important` | `!important` é proibido. Resolva com camadas. |
| `unlayered` | Regra fora de `@layer`. |
| `duplicate` | Seletor repetido na mesma camada e no mesmo contexto de at-rule. Junte as duas regras. |

- `url(...)` e strings entre aspas são ignorados, então data URIs e `content: "…"` não disparam o lint.
- `rem`, `em`, `%`, `vh`, `fr` e números sem unidade são permitidos. Prefira token quando o valor
  representar espaço, tamanho de controle ou tipografia.
- Arquivos em `styles/legacy/` só geram **avisos** e nunca falham a execução. É dívida do P2.
- `style={{ … }}` inline em TSX não é checado. Use inline só para valores dinâmicos, como largura
  de progresso, `--sidebar-current` ou tamanho de Skeleton, e nunca para cores fixas.

## 6. Catálogo de primitivas

Todas ficam em `src/ui/` e são exportadas por `src/ui/index.ts`:

```tsx
import { Button, IconButton, Modal, useToast } from "../ui";
```

Cada `X.tsx` importa o próprio `X.css` (`@layer components`). Os campos compartilham `fields.css`.
Todas aceitam `className` para ajustes da tela, que ficam em `@layer features`.

### Button

Botão de texto com ícone opcional.

| Prop | Tipo | Padrão | Notas |
|---|---|---|---|
| `variant` | `"primary" \| "outline" \| "ghost" \| "danger" \| "glass"` | `"outline"` | |
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | Altura 32/40/48px. |
| `icon` | `ReactNode` | | Ícone à esquerda. |
| `iconRight` | `ReactNode` | | Ícone à direita. Some durante `loading`. |
| `loading` | `boolean` | `false` | Mostra Spinner, define `aria-busy` e desabilita o botão. |
| `block` | `boolean` | `false` | Ocupa a largura do contêiner. |
| `type` | | `"button"` | Nunca envia formulário sem querer. |
| ...nativos | `ComponentPropsWithRef<"button">` | | Inclui `ref` (React 19). |

```tsx
<Button variant="primary" icon={<Download />} loading={saving} onClick={save}>
  Baixar
</Button>
```

- **A11y:** o ícone recebe `aria-hidden`. O nome acessível é o texto. `loading` desabilita e anuncia ocupado.
- **Faça:** um único `primary` por região. Use `danger` só para ações destrutivas. Use `glass` sobre capas e imagens.
- **Não faça:** botão só com ícone. Para isso use `IconButton`. Também não troque o texto do botão enquanto ele carrega.

### IconButton

Botão só com ícone.

| Prop | Tipo | Padrão | Notas |
|---|---|---|---|
| `label` | `string` | obrigatório | Vira `aria-label` e `title` (tooltip nativo). |
| `icon` | `ReactNode` | obrigatório | |
| `variant` | `ButtonVariant` | `"ghost"` | |
| `size` | `ButtonSize` | `"md"` | Ícones de 16/20/24px. |
| `loading` | `boolean` | `false` | |
| `noTooltip` | `boolean` | `false` | Tira o `title` quando já existe rótulo visível ao lado. |

```tsx
<IconButton label="Mais ações" icon={<MoreHorizontal />} onClick={openMenu} />
```

- **A11y:** o `label` é obrigatório por tipo. Os testes acham o botão com `getByLabelText(label)`.
- **Não faça:** rótulos genéricos como "Botão" ou "Ícone". Descreva a ação ("Remover da fila").

### TextField

Input de texto com rótulo, hint e erro.

| Prop | Tipo | Padrão | Notas |
|---|---|---|---|
| `label` | `string` | obrigatório | `<label htmlFor>` real. |
| `hint` | `ReactNode` | | Texto de ajuda, ligado por `aria-describedby`. |
| `error` | `ReactNode` | | Mensagem de erro. Define `aria-invalid` e `.o-field--invalid`. |
| `leading` / `trailing` | `ReactNode` | | Adornos, como ícone de busca ou botão de limpar. |
| `hideLabel` | `boolean` | `false` | Esconde o rótulo só visualmente (`.sr-only`). |
| `fieldClassName` | `string` | | Classe do wrapper `.o-field`. O `className` vai para o `<input>`. |
| `id` | `string` | `useId()` | |
| ...nativos | `ComponentPropsWithRef<"input">` sem `size` | | |

```tsx
<TextField
  label="Buscar"
  hideLabel
  leading={<Search />}
  value={query}
  onChange={(event) => setQuery(event.target.value)}
/>
```

- **A11y:** o rótulo existe sempre, mesmo escondido. Hint e erro entram em `aria-describedby`.
- **Não faça:** usar placeholder como rótulo.

### SelectField

`<select>` nativo estilizado.

| Prop | Tipo | Notas |
|---|---|---|
| `label` | `string` | obrigatório |
| `options` | `ReadonlyArray<{ value: T; label: string; disabled?: boolean }>` | Genérico em `T extends string`. |
| `hint` | `ReactNode` | |
| `hideLabel`, `fieldClassName`, `id` | | Iguais aos do TextField. |

```tsx
<SelectField
  label="Formato"
  options={[{ value: "EPUB", label: "EPUB" }, { value: "AZW3", label: "AZW3 (Kindle)" }]}
  value={format}
  onChange={(event) => setFormat(event.target.value as Format)}
/>
```

- **A11y:** é nativo, então teclado e leitor de tela funcionam sem código extra. O chevron é decorativo.

### CheckboxField

Checkbox nativo com rótulo e descrição.

| Prop | Tipo | Notas |
|---|---|---|
| `label` | `ReactNode` | obrigatório |
| `description` | `ReactNode` | Ligada por `aria-describedby`. |
| ...nativos | `ComponentPropsWithRef<"input">` sem `type` | `checked`, `onChange`, `disabled`. |

```tsx
<CheckboxField label="Gerar audiobook" description="Leva mais tempo" checked={audio} onChange={(event) => setAudio(event.target.checked)} />
```

### Switch

Liga/desliga imediato, como em ajustes. É um `<button role="switch">`.

| Prop | Tipo | Notas |
|---|---|---|
| `label` | `ReactNode` | obrigatório (`aria-labelledby`) |
| `description` | `ReactNode` | `aria-describedby` |
| `checked` | `boolean` | obrigatório (controlado) |
| `onChange` | `(checked: boolean) => void` | Recebe o novo valor. |
| `disabled`, `className` | | |

```tsx
<Switch label="Enviar ao Kindle automaticamente" checked={auto} onChange={setAuto} />
```

- **Faça:** use Switch quando o efeito é imediato. Use `CheckboxField` quando a escolha só vale ao confirmar um formulário.

### SegmentedControl

Escolha única entre 2 a 5 opções, como grade/lista ou filtros de status.

| Prop | Tipo | Notas |
|---|---|---|
| `options` | `ReadonlyArray<{ value: T; label: ReactNode; icon?: ReactNode; disabled?: boolean }>` | |
| `value` | `T` | Controlado. |
| `onChange` | `(value: T) => void` | |
| `aria-label` | `string` | obrigatório |
| `size` | `"sm" \| "md"` | Padrão `"md"`. |

```tsx
<SegmentedControl
  aria-label="Visualização"
  value={mode}
  onChange={setMode}
  options={[{ value: "grid", label: "Grade", icon: <LayoutGrid /> }, { value: "list", label: "Lista", icon: <List /> }]}
/>
```

- **A11y:** `role="radiogroup"` e `role="radio"` com `aria-checked`. Tem tabindex móvel: só a opção
  selecionada recebe Tab. Setas, Home e End mudam a seleção.

### Chip

Rótulo compacto: tag, filtro alternável ou filtro removível.

| Prop | Tipo | Padrão | Notas |
|---|---|---|---|
| `children` | `ReactNode` | | Texto. |
| `selected` | `boolean` | | Exposto como `aria-pressed` quando `onToggle` existe. |
| `onToggle` | `() => void` | | Transforma o chip num botão alternável. |
| `onRemove` | `() => void` | | Adiciona um botão ✕. |
| `removeLabel` | `string` | `"Remover {children}"` | Rótulo do botão ✕. |
| `tone` | `"neutral" \| "accent" \| "danger" \| "warning" \| "success"` | `"neutral"` | |
| `icon`, `disabled`, `className` | | | |

```tsx
<Chip selected={active} onToggle={() => toggleTag(tag)} onRemove={() => removeTag(tag)}>{tag}</Chip>
```

- **A11y:** o botão ✕ tem rótulo próprio, e os testes consultam `aria-pressed`.
- **Não faça:** usar Chip como botão de ação ("Baixar"). Para isso existe o `Button size="sm"`.

### Badge

Etiqueta estática de status ou contagem.

| Prop | Tipo | Padrão |
|---|---|---|
| `tone` | `"neutral" \| "accent" \| "success" \| "warning" \| "danger"` | `"neutral"` |
| ...nativos | `ComponentPropsWithoutRef<"span">` | |

```tsx
<Badge tone="success">Concluído</Badge>
```

- **Não faça:** colocar informação que só existe na cor. O texto precisa bastar sozinho.

### ProgressBar

| Prop | Tipo | Padrão | Notas |
|---|---|---|---|
| `label` | `string` | obrigatório | Nome acessível (`aria-label`). |
| `value` | `number` | `0` | Limitado a `[0, max]`. |
| `max` | `number` | `100` | |
| `size` | `"sm" \| "md"` | `"md"` | |
| `indeterminate` | `boolean` | `false` | Omite `aria-valuenow` e define `aria-busy`. |
| `valueText` | `string` | | `aria-valuetext`, por exemplo "42% · 1,2 MB/s". |
| `tone` | `"accent" \| "success" \| "danger"` | `"accent"` | |

```tsx
<ProgressBar label={`Baixando ${title}`} value={job.progress.percent} valueText={detail} />
```

- **A11y:** `role="progressbar"` com `aria-valuemin`, `aria-valuemax` e `aria-valuenow`. A barra anima
  por `transform: scaleX()`, que é barato.

### Spinner

| Prop | Tipo | Padrão | Notas |
|---|---|---|---|
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | |
| `label` | `string` | | Com label vira `role="status"`. Sem label fica `aria-hidden`, para quando o controle já anuncia `aria-busy`. |

### Cover

Capa de livro 2:3 com fallback de iniciais.

| Prop | Tipo | Padrão | Notas |
|---|---|---|---|
| `title` | `string` | obrigatório | Vira `alt` da imagem e `aria-label` do fallback. |
| `src` | `string \| null` | | Se faltar ou der erro (`onError`), mostra as iniciais (`coverInitials`). |
| `size` | `"sm" \| "md" \| "lg" \| "fill"` | `"md"` | 48, 120 ou 180px de largura, ou a largura do contêiner. |
| `sheen` | `boolean` | `false` | Brilho sutil. |

```tsx
<Cover src={book.coverUrl} title={book.title} size="fill" sheen />
```

- Tem `data-testid="cover"`, `loading="lazy"` e `draggable={false}`.
- **Faça:** use `size="fill"` em grades, porque quem define a largura é a grade.
- **Não faça:** esticar a capa para outra proporção. Também não passe capa em base64 da biblioteca local; use a URL do asset protocol (veja `docs/ARCHITECTURE.md`).

### Modal

Diálogo modal em portal.

| Prop | Tipo | Padrão | Notas |
|---|---|---|---|
| `open` | `boolean` | obrigatório | |
| `onClose` | `() => void` | obrigatório | Chamado por Esc, clique no véu e botão ✕. |
| `title` | `ReactNode` | obrigatório | `aria-labelledby`. |
| `description` | `ReactNode` | | `aria-describedby`. |
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | |
| `footer` | `ReactNode` | | Botões de ação. |
| `dismissible` | `boolean` | `true` | Com `false`, Esc, véu e ✕ ficam inativos (use enquanto salva). |
| `initialFocus` | `RefObject<HTMLElement>` | | Senão, o foco vai para o primeiro focável do corpo. |

```tsx
<Modal
  open={open}
  onClose={close}
  title="Editar tags"
  footer={<Button variant="primary" onClick={save}>Salvar</Button>}
>
  <TextField label="Nova tag" />
</Modal>
```

- **A11y:** `role="dialog"` com `aria-modal`. Prende o foco (Tab e Shift+Tab circulam) e devolve o
  foco ao elemento anterior ao fechar. Com modais empilhados, só o **do topo** reage a Esc e Tab.
  O véu usa `--backdrop` com blur.
- **Não faça:** abrir modal sobre modal sem necessidade, nem usar modal para mensagens de sucesso (use toast).

### ConfirmationModal

Atalho para confirmar ou cancelar.

| Prop | Tipo | Padrão | Notas |
|---|---|---|---|
| `open`, `onClose` | | | Iguais aos do Modal. |
| `onConfirm` | `() => void` | obrigatório | |
| `title` | `ReactNode` | obrigatório | |
| `description` | `ReactNode` | | |
| `confirmLabel` / `cancelLabel` | `string` | `"Confirmar"` / `"Cancelar"` | Vêm de `uiStrings`. |
| `tone` | `"default" \| "danger"` | `"default"` | `danger` deixa o botão vermelho e **foca Cancelar primeiro**. |
| `loading` | `boolean` | `false` | Bloqueia o fechamento e mostra spinner no confirmar. |

```tsx
<ConfirmationModal
  open={confirming}
  tone="danger"
  title="Apagar 3 livros?"
  description="Os arquivos serão removidos da pasta de saída."
  confirmLabel="Apagar"
  onConfirm={deleteBooks}
  onClose={() => setConfirming(false)}
/>
```

### DropdownMenu e `useContextMenu`

Menu de ações que abre ancorado num gatilho ou como menu de contexto nas coordenadas do ponteiro.

| Prop | Tipo | Notas |
|---|---|---|
| `items` | `ReadonlyArray<MenuItem>` | `{ label, icon?, onSelect, danger?, disabled?, separatorBefore? }` |
| `label` | `string` | Nome acessível do menu. |
| `align` | `"start" \| "end"` | Alinhamento ao gatilho. Padrão `"start"`. |
| `trigger` | `ReactElement` | **Modo âncora.** Recebe `onClick`, `onKeyDown`, `aria-haspopup`, `aria-expanded` e `aria-controls`. |
| `open`, `position`, `onClose` | | **Modo contexto** (controlado). Use com `useContextMenu()`. |

```tsx
<DropdownMenu
  label="Ações do livro"
  align="end"
  trigger={<IconButton label="Mais ações" icon={<MoreHorizontal />} />}
  items={[
    { label: "Abrir pasta", icon: <FolderOpen />, onSelect: openFolder },
    { label: "Apagar", icon: <Trash2 />, onSelect: askDelete, danger: true, separatorBefore: true }
  ]}
/>

const menu = useContextMenu();
<div onContextMenu={menu.onContextMenu}>…</div>
<DropdownMenu items={items} open={menu.open} position={menu.position} onClose={menu.onClose} />
```

- **A11y:** `role="menu"` e `role="menuitem"`. Setas, Home e End navegam. Esc fecha e devolve o foco ao
  gatilho. Tab fecha. Clique fora, blur da janela e resize também fecham. O menu fica sempre dentro da viewport.
- **Não faça:** colocar formulários dentro do menu. Para isso existe o Modal.

### ToastProvider e `useToast`

Notificações efêmeras no canto inferior direito, acima do BottomPanel. Aparecem no máximo 3.

```tsx
const { toast, dismiss } = useToast();
toast({ message: "Livro salvo na biblioteca", tone: "success", action: { label: "Abrir", onClick: openBook } });
toast("Texto simples"); // tom info, 4 s
```

| Opção | Tipo | Padrão | Notas |
|---|---|---|---|
| `message` | `ReactNode` | obrigatório | |
| `tone` | `"info" \| "success" \| "warning" \| "danger"` | `"info"` | |
| `action` | `{ label, onClick }` | | Fecha o toast depois do clique. |
| `duration` | `number` (ms) | `4000` (`DEFAULT_TOAST_DURATION`) | `0` mantém até fechar. |

- **A11y:** `danger` usa `role="alert"` com `aria-live="assertive"`. Os demais usam `role="status"`
  com `aria-live="polite"`. Hover ou foco pausa a contagem e a barra `countdown`. O botão ✕ tem rótulo.
- `useToast` precisa estar dentro de `<ToastProvider>`, senão lança erro.

### EmptyState

Tela ou região vazia, de erro ou de "conecte algo".

| Prop | Tipo | Notas |
|---|---|---|
| `icon` | `ReactNode` | Decorativo. |
| `title` | `ReactNode` | obrigatório (renderiza `<h2>`) |
| `description` | `ReactNode` | |
| `action` | `ReactNode` | Botões. |
| `children` | `ReactNode` | Extra, como um detalhe de erro em mono. |
| `tone` | `"neutral" \| "danger"` | Padrão `"neutral"`. |

```tsx
<EmptyState icon={<BookOpenText />} title="Biblioteca vazia" description="Baixe um livro em Buscar." action={<Button variant="primary" onClick={goDiscover}>Buscar novels</Button>} />
```

- **Faça:** sempre ofereça o próximo passo em `action`.

### Skeleton

Placeholder de carregamento com `shimmer`. É `aria-hidden`.

| Prop | Tipo | Padrão |
|---|---|---|
| `width` | `number \| string` (número = px) | `"100%"` |
| `height` | `number \| string` | `"1em"` |
| `radius` | `number \| string` | |

- **Faça:** reproduza a forma do conteúdo real, por exemplo uma capa 2:3 e duas linhas de texto.
  Anuncie o carregamento em outro lugar (`aria-busy` na região).

### Panel e Section

| Componente | Props | Uso |
|---|---|---|
| `Panel` | `title?`, `description?`, `actions?`, `glass?`, `className?` | Cartão com superfície (`.o-panel`). `glass` aplica vidro com blur. |
| `Section` | `title?`, `description?`, `actions?`, `className?` | Grupo com título e sem superfície (`.o-section`), para seções de página. |

Os dois renderizam `<section aria-labelledby>` quando há título, com `<h2>` no cabeçalho.

```tsx
<Panel title="Pasta de saída" description="Onde os livros são salvos" actions={<Button size="sm">Alterar</Button>}>
  <code>{outputPath}</code>
</Panel>
```

### SortableList

Lista reordenável por arraste (com alça) ou por teclado.

| Prop | Tipo | Notas |
|---|---|---|
| `items` | `ReadonlyArray<T>` | |
| `getId` | `(item: T) => string` | Chave estável. |
| `onReorder` | `(next: T[]) => void` | Recebe a nova ordem. |
| `renderItem` | `(item, { index, dragging, handleProps }) => ReactNode` | Espalhe `handleProps` na alça ou use `<SortableList.Handle {...handleProps} />`. |
| `getLabel` | `(item: T) => string` | Nome humano, usado no rótulo da alça e no anúncio. Padrão: `getId`. |
| `aria-label` | `string` | obrigatório |
| `disabled` | `boolean` | |

```tsx
<SortableList
  aria-label="Fila de downloads"
  items={queued}
  getId={(job) => job.id}
  getLabel={(job) => job.title}
  onReorder={(next) => queue.reorder(next.map((job) => job.id))}
  renderItem={(job, { handleProps }) => (
    <div className="downloads-row">
      <SortableList.Handle {...handleProps} />
      <span className="truncate">{job.title}</span>
    </div>
  )}
/>
```

- **A11y:** cada `<li>` é focável. **Alt+↑ e Alt+↓** movem o item e mantêm o foco nele. Cada
  movimento é anunciado numa região `aria-live` ("{título} movido para a posição X de N").
- `moveItem(list, from, to)` também é exportado para lógica pura.

## 7. Shell e plataforma

O shell fica em `src/shell/` e é exportado por `src/shell/index.ts`.

```text
┌───────────────────────── o-app__titlebar (35px; 0 no macOS) ─────────────────────────┐
│ o-app__sidebar │ o-app__main                                                          │
│  (Sidebar)     │  PageHeader (56px)                                                   │
│                │  o-app__content (tela ativa; key=view → anima fade-in)               │
├────────────────┴──────────────────────────────────────────────────────────────────────┤
│ o-app__bottom (BottomPanel, 28px)                                                      │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### AppShell

Monta a grade `.o-app` (`styles/layout.css`).

| Prop | Tipo | Notas |
|---|---|---|
| `active` | `AppView` | Tela atual. Vira `data-view` no contêiner. |
| `onNavigate` | `(view) => void` | |
| `sidebarStatus` | `{ downloading?, flashKey?, kindleConnected? }` | Indicadores da sidebar. |
| `header` | `PageHeaderProps` | |
| `bottomPanel` | `BottomPanelProps` | |
| `contentClassName` | `string` | Classes da área de conteúdo. Hoje as telas legadas usam `workspace …`. |
| `overlays` | `ReactNode` | Renderizados depois da grade, como o onboarding. |
| `platform` | `Platform` | Padrão `getPlatform()`. Em `macos` não renderiza `TitleBar`. |

A largura e o estado recolhido da sidebar persistem em `localStorage` (`oghma.sidebar.width` e
`oghma.sidebar.collapsed`). O contêiner tem `data-testid="app-shell"`.

### Sidebar

- Pode ser redimensionada entre 200 e 320px (`SIDEBAR_WIDTH`, que espelha os tokens) pela alça
  `role="separator"`. A alça aceita setas (passo de 8px), Home e End, e o duplo clique restaura 240px.
- Pode ser recolhida para 72px. O botão de alternar tem `aria-label` "Recolher menu" ou "Expandir
  menu" e `aria-expanded`.
- A navegação vem de `shell/nav.ts`: Buscar, Downloads, Biblioteca, Kindle, Tradução e Fontes, com
  Ajustes fixo embaixo. Cada item tem `data-testid="nav-<id>"`, `data-nav` e `aria-current="page"`
  quando ativo.
- Indicadores: Downloads acende com `downloading` e pisca quando `flashKey` muda. Kindle mostra um
  ponto online/offline e tem texto `sr-only` equivalente.

### TitleBar e WindowControls (Windows/Linux)

- `TitleBar` é a barra customizada de 35px (`data-testid="titlebar"`, `data-tauri-drag-region`) com
  logo, nome e `WindowControls`.
- `WindowControls` tem minimizar, maximizar/restaurar e fechar (`role="group"`). O ícone de maximizar
  alterna para restaurar via `watchMaximized` (`isMaximized` + `onResized`) em `core/windowControls.ts`.
- Fora do Tauri (navegador ou testes), as ações disparam o `CustomEvent` `oghma-window-action`, e os
  testes verificam isso.

### PageHeader

| Prop | Tipo | Notas |
|---|---|---|
| `title` | `ReactNode` | `<h1>` |
| `onBack` | `() => void` | Mostra o botão "Voltar". Normalmente é `navigation.back` quando `canGoBack`. |
| `actions` | `ReactNode` | À direita. |
| `search` | `ReactNode` | Controle depois do título. |

O cabeçalho inteiro é `data-tauri-drag-region`, então a janela pode ser arrastada por ele, inclusive no macOS.

### BottomPanel

| Prop | Tipo | Notas |
|---|---|---|
| `active` | `{ title, progress, speedBps?, etaSec? } \| null` | Download em andamento. |
| `queuedCount` | `number` | Mostra "N na fila" quando for maior que 0. |
| `kindle` | `{ connected, deviceName?, mountPath? } \| null` | |
| `onOpenDownloads` | `() => void` | Chamado ao clicar no status. |

A linha de status é gerada por `describeActiveDownload`, no formato
`Baixando {título}… 42% · 1,2 MB/s · 0:35`. `formatSpeed` usa vírgula decimal pt-BR e unidades de
base 1024. `formatEta` produz `m:ss` ou `h:mm:ss`.

### SplashScreen

| Prop | Tipo | Notas |
|---|---|---|
| `steps` | `{ id, label, status: "pending" \| "active" \| "done" \| "error" }[]` | Passos **reais** do boot (`bootSteps` em `App.tsx`). |
| `leaving` | `boolean` | Toca `splash-out`. O pai desmonta o componente em seguida. |

Mostra o passo atual (`role="status"`) e o progresso por passos concluídos. Nunca exibe texto de mock.

### Plataforma: `html[data-platform]`

`main.tsx` chama `applyPlatform()` antes do primeiro render. Ela lê `navigator.userAgent` e grava
`document.documentElement.dataset.platform` como `"macos"`, `"windows"` ou `"linux"`. Em testes ou
sem o atributo, `getPlatform()` devolve `"linux"`. O CSS reage ao atributo:

```css
[data-platform="macos"] { --titlebar-h: 0px; }          /* tokens.css */
[data-platform="macos"] .o-sidebar { padding-top: var(--mac-inset-top); }   /* Sidebar.css */
```

**macOS: semáforos nativos.** O arquivo `src-tauri/tauri.macos.conf.json` é mesclado sobre o
`tauri.conf.json` só no build para macOS. Ele define `decorations: true`, `titleBarStyle: "Overlay"`,
`hiddenTitle: true` e `trafficLightPosition: { x: 16, y: 20 }`. Os botões nativos ficam sobre o topo
da sidebar, que ganha 40px de padding (`--mac-inset-top`) e uma faixa arrastável (`.o-sidebar__drag`).
Não há titlebar customizada.

**Windows e Linux: titlebar customizada.** O `tauri.conf.json` base usa `decorations: false`, e o
`AppShell` renderiza `TitleBar` com `WindowControls`.

> **Pegadinha do JSON Merge Patch.** O Tauri mescla o arquivo de plataforma usando JSON Merge Patch
> (RFC 7396). Nesse formato, **arrays são substituídos inteiros, não mesclados**. Como `app.windows` é
> um array, o `tauri.macos.conf.json` precisa repetir **todos** os campos da janela (`label`, `title`,
> `width`, `height`, `minWidth`, `minHeight`, `resizable`, `fullscreen`, `shadow`...), e não só os que
> mudam. Ao alterar a janela no `tauri.conf.json`, altere também no `tauri.macos.conf.json`. Senão o
> macOS perde o ajuste sem nenhum aviso.

Outras regras do shell:

- Áreas que arrastam a janela levam `data-tauri-drag-region`. Botões dentro delas param o
  `mousedown`, como faz o `WindowControls`.
- `--app-min-w` (1120px) precisa bater com `minWidth` nos dois arquivos de configuração do Tauri.

### Navegação (`src/app/NavigationContext.tsx`)

`NavigationProvider` e `useNavigation()` expõem `{ view, params, history, canGoBack, navigate, back }`.

- `navigate(view, params?, { root?, replace? })`. A sidebar usa `root: true`, que limpa o histórico.
  Navegar para a mesma tela com os mesmos params não empilha nada. O histórico guarda até 30 entradas.
- `AppView` é `ViewId | "kindle"`.

## 8. Como adicionar uma tela

Exemplo: uma tela `history`.

1. **Tipo e navegação**
   - Acrescente o id em `ViewId` (`src/core/types.ts`), ou em `AppView` se a tela for só do shell.
   - Acrescente o item em `navItems` (`src/shell/nav.ts`) com um ícone lucide, se ela aparecer na sidebar.
2. **Strings** (`src/strings/`)
   - Título em `pageTitleStrings` e rótulo em `navStrings` (`strings/common.ts`).
   - Textos próprios em `src/strings/history.ts` (`export const historyStrings = { … } as const`).
   - Views e testes importam daí. Não escreva texto visível solto no JSX.
3. **Pasta da feature** (`src/features/history/`)
   - `useHistoryController.ts` é o hook com estado e ações. Ele não renderiza nada e exporta
     `type HistoryController = ReturnType<typeof useHistoryController>`.
   - `HistoryView.tsx` é a tela. Ela recebe o controller e compõe primitivas de `src/ui`.
   - `history.css` fica **todo** em `@layer features { … }`, com prefixo `.history-*`, só com tokens.
     A view o importa (`import "./history.css"`).
4. **Registro** (`src/app/viewRegistry.ts`)
   - Adicione o controller em `AppControllers` (montado no `App.tsx`).
   - Crie `HistoryPage({ app })` e a entrada
     `history: { id: "history", title: pageTitleStrings.history, icon: iconFor("history"), component: HistoryPage }`.
   - `contentClassName` é opcional. Sem ele, o conteúdo recebe a classe legada `workspace single`.
     Telas novas devem definir a própria classe (por exemplo `() => "history-page"`).
5. **Testes** (`src/test/app/history.test.tsx`)
   - Use `renderReadyApp()` e `setupUser()` de `src/test/renderApp.tsx`, e navegue com `getByTestId("nav-history")`.
   - Consulte por `getByRole`, `getByLabelText`, `getByTestId` e pelas strings de `src/strings/*`.
     **Nunca** consulte por classe CSS.
   - Dê `data-testid` estável a regiões e itens repetidos (`history-item`) e use `aria-pressed` ou
     `aria-current` para estados.
6. **Verificação**
   ```bash
   cd apps/desktop
   npx vitest run && npx tsc --noEmit && npm run lint:css
   ```
   Confira também na galeria (`/?gallery`) se criou ou alterou alguma primitiva.

## 9. Tema claro (futuro)

Hoje o app só tem tema escuro. Para criar o claro, basta um bloco em `tokens.css`, **dentro de
`@layer tokens`**, que sobrescreve os tokens semânticos de cor. Nada em componentes ou telas deve mudar.

```css
@layer tokens {
  [data-theme="light"] {
    color-scheme: light;
    --bg-app: …;  --bg-sidebar: …;
    --surface-1: …;  --surface-2: …;  --surface-3: …;
    /* … demais tokens da lista abaixo … */
  }
}
```

**Tokens que precisam de override:**

- Superfícies: `--bg-app`, `--bg-sidebar`, `--surface-1`, `--surface-2`, `--surface-3`.
- Translúcidos: `--glass`, `--glass-strong`, `--hover`, `--active` e `--backdrop`. No escuro são branco
  com alfa. No claro devem virar preto com alfa, como `rgb(var(--black-rgb) / .06)`.
- Bordas: `--border` e `--border-strong`, que também passam de branco para preto com alfa.
- Texto: `--text`, `--text-2`, `--text-muted` e `--text-disabled`.
- Marca: `--accent-hover`, `--accent-press`, `--accent-text` e `--danger-text`. `--accent`,
  `--accent-rgb` e `--accent-fg` podem ficar como estão, mas confira o contraste.
- Status: `--danger`, `--warning`, `--success` e `--info`, com os respectivos `*-rgb`. Tons mais
  escuros costumam ser necessários para passar AA sobre fundo claro.
- Sombras: `--shadow-sm`, `--shadow-md` e `--shadow-lg`, mais suaves.
- `--focus-ring` não precisa mudar, porque se ajusta sozinho via `--bg-app`.

**Não mudam:** espaçamento, raios, tipografia, controles, layout, z-index e movimento.

**Pré-requisitos:**

- Todo CSS fora de `tokens.css` precisa usar só tokens semânticos. O lint já garante isso fora do legacy.
- Revise usos de `rgb(var(--white-rgb) / …)`, como o brilho da capa, que assumem fundo escuro.
- O `legacy` precisa ter sido removido antes.
- A preferência (`data-theme` no `<html>`) entra nos Ajustes. Um valor "Sistema" pode seguir
  `prefers-color-scheme`.

## 10. Movimento e `prefers-reduced-motion`

- **Durações:** `--dur-fast` (120ms) para hover e bordas, `--dur-base` (200ms) para o padrão,
  `--dur-slow` (320ms) para modais, splash e sidebar. **Curva:** sempre `var(--ease)`.
- Padrão de transição dos controles: `transition: all var(--dur-base) var(--ease)`. Se o elemento
  tiver muitas propriedades mudando, liste só as necessárias (`background-color`, `border-color`,
  `opacity`, `transform`).
- Anime só `opacity` e `transform`/`translate`/`scale` quando possível. Evite animar `width`,
  `height` e `top`. A barra de progresso usa `scaleX` por esse motivo.
- A troca de tela anima com `fade-in`, porque `.o-app__content` tem `key={view}`.
- **Movimento reduzido.** São duas camadas de proteção:
  1. `tokens.css` zera `--dur-fast`, `--dur-base` e `--dur-slow`.
  2. `base.css` força `animation-duration: 0ms`, `animation-iteration-count: 1`,
     `transition-duration: 0ms` e `scroll-behavior: auto` em todos os elementos.
- Com isso, spinner, shimmer e indeterminado ficam parados. Estado importante nunca pode depender
  **só** de animação: o texto ou o ARIA precisa comunicar o mesmo.
- Timers de UI (piscar da sidebar, duração de toast) não são animação CSS. Mantenha-os curtos e
  nunca bloqueie interação por eles.

## 11. Ícones

- A biblioteca é **`lucide-react`**. Não misture outros sets nem SVGs soltos, exceto os logos em
  `public/icons/`.
- **Tamanho vem do CSS, não da prop.** Passe `<Download />` sem `size`. A primitiva dimensiona o
  `svg` com os tokens:

  | Token | Tamanho | Onde |
  |---|---|---|
  | `--icon-sm` | 16px | Button, Chip, campos, SegmentedControl, itens de menu, IconButton `sm`, Spinner `sm`, controles de janela |
  | `--icon-md` | 20px | IconButton `md`, ícones da Sidebar, Spinner `md`, Switch |
  | `--icon-lg` | 24px | IconButton `lg`, logo da Sidebar |

- Em CSS de feature, dimensione assim: `.library-card__icon svg { width: var(--icon-sm); height: var(--icon-sm); }`.
- Cor: os ícones herdam `currentColor`. Mude a cor do texto do pai, não o `stroke`.
- **A11y:** ícones são decorativos. As primitivas envolvem o ícone em `aria-hidden`. Ícone solto em
  JSX de feature leva `aria-hidden="true"`. Se o ícone é o único conteúdo de um controle, use
  `IconButton` com `label`.

## 12. Checklist de revisão de PR de UI

**CSS e tokens**
- [ ] `npm run lint:css` sem erros. Nenhum hex, rgba ou px cru, nenhum `!important`.
- [ ] Todo CSS novo está em `@layer components` (primitiva ou shell) ou em `@layer features` (tela).
- [ ] Classes seguem `.o-` BEM (primitiva) ou o prefixo da feature. Estados usam `is-*` ou atributo ARIA.
- [ ] Nenhuma regra nova em `styles/legacy/`, que só pode encolher.
- [ ] Nenhum token novo sem entrada neste guia, com valor e uso.

**Componentes**
- [ ] Usa as primitivas de `src/ui` em vez de recriar botão, modal, menu, campo ou toast.
- [ ] Botões só com ícone usam `IconButton` com `label` descritivo.
- [ ] Textos visíveis vêm de `src/strings/*`, em pt-BR com acentos.
- [ ] Capas usam `Cover` e respeitam 2:3.
- [ ] Primitiva nova ou alterada aparece na galeria (`src/dev/Gallery.tsx`) e tem teste em `src/test/ui/`.

**Acessibilidade**
- [ ] Tudo funciona só com teclado: Tab, Enter/Espaço, Esc fecha, setas em menus e grupos, e o foco fica visível (`--focus-ring`).
- [ ] Todo controle tem nome acessível, e campos têm `<label>` (mesmo `hideLabel`).
- [ ] Estados são expostos por ARIA (`aria-pressed`, `aria-checked`, `aria-current`, `aria-busy`, `aria-expanded`).
- [ ] Informação não depende só de cor, e o contraste do texto é AA sobre a superfície usada.
- [ ] Nada depende de animação para comunicar estado. A tela foi conferida com movimento reduzido.

**Plataforma e shell**
- [ ] Layout conferido em 1120px de largura (mínimo) e com a sidebar recolhida e expandida.
- [ ] macOS: nada fica sob os semáforos, e o arraste continua funcionando nas áreas `data-tauri-drag-region`.
- [ ] Mudanças na janela foram feitas em `tauri.conf.json` **e** `tauri.macos.conf.json` (merge patch substitui o array).

**Testes**
- [ ] Testes consultam por role, label, `data-testid` ou strings, nunca por classe CSS.
- [ ] `npx vitest run` e `npx tsc --noEmit` passam.
- [ ] Handlers que usam `closest(".classe")` foram atualizados se alguma classe foi renomeada.

## 13. Telas

Convenções específicas de cada tela: layout, componentes locais, `data-testid` e decisões de UX.
Os agentes do P2 e mudanças futuras **acrescentam** uma subseção `### <Tela>` aqui. Siga o formato:

```markdown
### Biblioteca (`src/features/library/`)

- Prefixo CSS: `.library-*`; arquivo `library.css` em `@layer features`.
- Controller: `useLibraryController`.
- Estrutura: …
- `data-testid`: `library-card`, …
- Decisões: …
```

### Biblioteca (`src/features/library/`)

- Prefixo CSS: `.library-*`; arquivo `library.css` em `@layer features`. Os cards usam `.library-tile*` e a barra
  usa `.library-bar*`, porque `.library-card` e `.library-toolbar` ainda existem no CSS legado.
- Controller: `useLibraryController` (seleção do Kindle, `sendToKindle(ids)`, `prepareConversion(ids)`,
  `conversionTarget`/`conversionIds`, `refresh`, `outputPath`, metadados, remover/excluir, baixar novamente).
- Estrutura: `LibraryView` (página e roteamento por `params.book`), `LibraryToolbar` (contagem, busca, chips de
  formato + Favoritos, ordenação Recentes/Título/Tamanho, grade/lista, Atualizar), `LibraryCollection` (grade de
  capas 2:3 e lista densa com menu de contexto único), `LibraryDetails` (hero com capa desfocada, barra de
  ações, Sua leitura, Zona de perigo), `useBookActions` (itens de menu e diálogos), `ConvertDialog`,
  `libraryModel.ts` (filtro, ordenação, estado de job por livro).
- Detalhes são uma "página" dentro da Biblioteca: `navigate("library", { book: id })`. O botão Voltar do
  cabeçalho e o Esc voltam à grade, que mantém busca, filtros e rolagem.
- `data-testid`: `library-page`, `library-toolbar`, `library-count`, `library-search`, `library-results`,
  `library-grid`, `library-card`, `card-title`, `library-job-badge`, `library-list`, `library-row`,
  `library-detail`, `detail-cover`, `library-redownload`.
- Decisões: clique no card abre os detalhes (não seleciona mais); todas as ações ficam no menu de contexto e
  no botão ⋮. "Remover da biblioteca" (oculta, mantém arquivos) e "Excluir arquivos" (apaga a pasta) sempre
  passam por `ConfirmationModal` com texto que explica a diferença. Livros em download/conversão mostram
  selo "Atualizando… 42%", "Convertendo…" ou "Na fila" a partir da fila de downloads.

### Kindle (`src/features/kindle/`)

- Prefixo CSS: `.kindle-*`; arquivo `kindle.css` em `@layer features`.
- Usa o `LibraryController` (não há controller próprio).
- Estrutura: hero de status do aparelho (conectado/desconectado, pasta, formato), passos "Como conectar"
  quando não há Kindle, e o fluxo de envio: cards com checkbox à esquerda, painel "Enviar ao Kindle" à
  direita com formato AZW3, `SortableList` (ordem de envio, Alt+↑/↓), progresso por item e o botão
  "Enviar N livros".
- `data-testid`: `kindle-page`, `kindle-hero`, `kindle-connected`/`kindle-disconnected`, `kindle-book`,
  `kindle-queue`, `library-queue-card`, `kindle-send`.
- Decisões: o arrastar-e-soltar customizado (e o "soltar na grade para remover") foi trocado por
  `SortableList` + botão ✕ por item.
