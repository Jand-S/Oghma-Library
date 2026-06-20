# Plano: novo filtro de tags da tela Discover

Data da analise: 2026-06-19

## Objetivo

Redesenhar os filtros da tela Discover para suportar uma taxonomia grande e
consistente entre fontes em portugues e ingles.

Requisitos obrigatorios:

- manter a busca por titulo/autor;
- separar tags em Formato, Genero e Tema;
- permitir tres estados por tag;
- primeiro clique: a novel deve conter a tag;
- segundo clique: a novel nao pode conter a tag;
- terceiro clique: remover a tag do filtro;
- permitir buscar tags por nome e alias;
- exibir os nomes canonicos em portugues quando houver traducao confiavel;
- preservar em ingles as tags sem traducao segura;
- normalizar tags de crawlers em ingles, inicialmente Sky Demon Order;
- nao depender do layout atual do painel de filtros.

Este documento e apenas planejamento. Nenhuma mudanca de UI, banco, crawler
ou container faz parte desta etapa.

## Inventario real do banco

Foi executado um `DISTINCT` sobre `unnest(novel.tags)` no Postgres, incluindo
contagem por fonte.

Resumo global:

| Metrica | Quantidade |
| --- | ---: |
| Associacoes novel/tag | 7.240 |
| Tags distintas globais | 396 |
| Pares fonte/tag | 476 |

Distribuicao por fonte:

| Fonte | Associacoes | Tags distintas | Usadas 1 vez | Usadas no maximo 2 vezes | Usadas em 10+ novels |
| --- | ---: | ---: | ---: | ---: | ---: |
| Central Novel | 1.013 | 46 | 5 | 12 | 22 |
| House Saikai | 1.455 | 243 | 99 | 141 | 37 |
| Novel Mania | 3.577 | 52 | 3 | 4 | 40 |
| Sky Demon Order | 1.195 | 135 | 34 | 49 | 39 |

Conclusoes do inventario:

- renderizar todas as tags diretamente no painel atual de 240 px nao e uma
  experiencia adequada;
- House Saikai possui uma cauda longa muito grande;
- tags populares devem aparecer primeiro, sem esconder o catalogo completo;
- busca de tags e obrigatoria;
- frequencia deve ajudar na ordenacao, mas nao deve eliminar tags raras;
- a taxonomia precisa ser compartilhada entre backend, catalogo B2 e desktop;
- simples comparacao de strings nao e suficiente.

## Problemas encontrados nos dados

### Idiomas misturados

Exemplos equivalentes ou proximos:

- `Action` e `Acao`;
- `Adventure` e `Aventura`;
- `Fantasy` e `Fantasia`;
- `Magic` e `Magia`;
- `Martial Arts` e `Artes Marciais`;
- `Reincarnation` e `Reencarnacao`;
- `Character Growth` e `Crescimento do Personagem`;
- `Weak To Strong` e `Fraco A Forte`.

### Variacoes de escrita

- `Sci-fi`, `Ficcao Cientifica` e `Ficção Científica`;
- `One-shot` e `Oneshot`;
- `Magia` e `Magica`;
- `Escolar`, `Vida Escolar` e `School Life`;
- `Adulto`, `Adult`, `Mature`, `+18`, `18+` e `Publico Adulto`;
- `Adaptado de um Manhua` e `Adaptado para um Manhua`;
- `Horror` e `Terror`;
- `Slice of Life` e `Cotidiano`.

### Conceitos diferentes no mesmo array

O campo atual mistura:

- formato editorial: `Light Novel`, `Webnovel`, `Original`, `One-shot`;
- origem: `Brasileira`, `Chinesa`, `Coreana`, `Japonesa`;
- genero: `Fantasia`, `Romance`, `Terror`;
- tema/trope: `Reencarnacao`, `Sistema`, `Academia`;
- publico: `Shounen`, `Seinen`, `Josei`;
- conteudo sensivel: `Adulto`, `Smut`, `BDSM`, `Gore`;
- adaptacoes: `Adaptado para um Anime`, `Adaptado para um Manhua`.

O novo filtro deve apresentar apenas tres secoes, mas o modelo interno deve
saber por que uma tag foi colocada em cada secao.

## Taxonomia proposta

Cada tag canonica deve possuir:

```text
key            identificador estavel, sem depender do texto exibido
label_pt       rotulo principal mostrado no desktop
category       format | genre | theme
aliases        nomes encontrados nas fontes e termos de busca
search_terms   termos adicionais, sem alterar o significado
review_status  curated | inferred | unknown
```

Exemplos:

```json
{
  "key": "genre.action",
  "label_pt": "Ação",
  "category": "genre",
  "aliases": ["Ação", "Action"],
  "review_status": "curated"
}
```

### Formato

Esta secao agrupa atributos bibliograficos que nao descrevem a historia:

- Light Novel;
- Webnovel;
- Original;
- One-shot;
- Antologia;
- Conto;
- Fan-fiction;
- adaptacoes para anime, manga, manhwa, manhua, filme, jogo e drama;
- origem editorial: Brasileira, Chinesa, Coreana, Japonesa, Americana e
  Angolana.

A origem fica em Formato porque o requisito limita a interface a tres grupos.
No modelo interno ela pode receber `subcategory: origin`, permitindo criar uma
secao propria no futuro sem migrar novamente os dados.

### Genero

Generos descrevem a classificacao ampla da obra:

- Acao, Aventura, Fantasia, Romance, Drama, Comedia;
- Misterio, Terror, Suspense, Psicologico;
- Ficcao Cientifica, Fantasia Sombria e Fantasia Urbana;
- Artes Marciais, Militar, Historico, Esporte e Mecha;
- Cotidiano, Escolar, Isekai, Wuxia, Xianxia e Xuanhuan;
- Shounen, Shoujo, Seinen, Josei, Boys Love, Yaoi e Yuri;
- Adulto, Ecchi e Erotico.

### Tema

Tema e a secao de maior volume e inclui:

- ambientacao: Academia, Medieval, Dias Modernos, Pos-apocaliptico;
- progressao: Cultivo, Sistema, Sistema de Nivel, Fraco a Forte;
- protagonista: Feminina, Masculino, Maligno, Super Poderoso;
- criaturas: Dragoes, Demonios, Deuses, Vampiros, Zumbis;
- relacionamentos: Harem, Casamento Arranjado, Amor de Infancia;
- ocupacoes e faccoes: Cavaleiros, Assassinos, Guildas, Mercenarios;
- conteudo sensivel e avisos;
- qualquer tag desconhecida ainda nao classificada.

Tags desconhecidas entram provisoriamente no final de Tema, mantendo o texto
original e `review_status: unknown`. Elas nao devem ser descartadas.

## De-para inicial ingles -> portugues

O de-para deve usar chaves canonicas, nao substituicao solta de texto. A lista
abaixo cobre os aliases ingleses mais relevantes encontrados no banco.

### Generos e classificacoes

| Rotulo canonico | Aliases atuais |
| --- | --- |
| Ação | Action |
| Aventura | Adventure |
| Fantasia | Fantasy |
| Romance | Romance |
| Drama | Drama |
| Comédia | Comedy |
| Artes Marciais | Martial Arts |
| Sobrenatural | Supernatural |
| Mistério | Mystery |
| Psicológico | Psychological |
| Terror | Horror, Terror |
| Ficção Científica | Sci-fi, Sci-Fi |
| Tragédia | Tragedy |
| Cotidiano | Slice of Life |
| Fantasia Sombria | Dark Fantasy |
| Fantasia Urbana | Urban Fantasy |
| Histórico | Historical |
| Militar | Military |
| Erótico | Smut |
| Erótico Explícito | Heavy Smut |
| Adulto | Adult, Mature, 18+, +18, Publico Adulto |
| Shounen | Shounen |
| Seinen | Seinen |
| Josei | Josei |
| Boys Love | Boys Love |
| Wuxia | Wuxia |
| Cultivo | Cultivation |

Termos consolidados no mercado, como Isekai, Wuxia, Xianxia, Xuanhuan,
Shounen, Seinen, Josei, Ecchi e Boys Love, podem permanecer como rotulo mesmo
quando originados do ingles.

### Temas e tropes

| Rotulo canonico | Aliases atuais |
| --- | --- |
| Protagonista Masculino | Male Protagonist |
| Protagonista Feminina | Female Protagonist |
| Crescimento do Personagem | Character Growth |
| Protagonista Inteligente | Clever Protagonist |
| Protagonista Astuto | Cunning Protagonist |
| Protagonista Super Poderoso | Overpowered Protagonist |
| Protagonista Maligno | Evil Protagonist |
| Magia | Magic |
| Magia Negra | Black Magic |
| Harém | Harem |
| Aristocracia | Aristocracy |
| Cavaleiros | Knights |
| Sistema de Nivel | Level System |
| Interesses Amorosos Carinhosos | Doting Love Interests |
| Interesses Amorosos Devotados | Devoted Love Interests |
| Nobres | Nobles |
| Transportado para Outro Mundo | Transported to Another World |
| Demônios | Demons |
| Guildas | Guilds |
| Esquemas e Conspirações | Schemes And Conspiracies |
| Calabouços | Dungeons |
| Política | Politics |
| Reencarnação | Reincarnation |
| Dias Modernos | Modern Day |
| Magos | Wizards |
| Academia | Academy |
| Despertar | Awakening |
| Habilidades | Skills |
| Regressão de Idade | Age Regression |
| Relacionamentos Proibidos | Forbidden Relationships |
| Segunda Chance | Second Chance |
| Assassinos | Assassins |
| Ambientação Europeia | European Ambience |
| Reinos | Kingdoms |
| Garotas Monstro | Monster Girls |
| Redenção | Redemption |
| Portador de Espada | Sword Wielder |
| Chantagem | Blackmail |
| Lorde Demônio | Demon Lord |
| Amor Obsessivo | Obsessive Love |
| Apocalipse | Apocalypse |
| Construção de Reino | Kingdom Building |
| Deuses | Gods |
| Interesse Amoroso se Apaixona Primeiro | Love Interest Falls in Love First |
| Mercenários | Mercenaries |
| Mal-entendidos | Misunderstandings |
| Vinganca | Revenge |
| Amizade Colorida | Sex Friends |
| Sexo a Tres | Threesome |
| Sombrio | Dark |
| Não Consensual | Nonconsensual |
| Possessão | Possession |
| Amor Puro | Pure Love |
| Espíritos | Spirits |
| Sobrevivência | Survival |
| Guerras | Wars |
| Anjos | Angels |
| Administração de Negócios | Business Management |
| Constelação | Constellation |
| Demi-Humanos | Demi Humans |
| Detetives | Detectives |
| Linguagem Explicita | Dirty Talk |
| Casamento Forcado | Forced Marriage |
| Espiões | Spies |
| Passado Trágico | Tragic Past |
| Voyeurismo | Voyeurism |
| Casamento Arranjado | Arranged Marriage |
| Ferreiro | Blacksmith |
| Nora | Daughter-In-Law |
| Dominação | Dominance |
| Caçadores de Dragões | Dragon Slayers |
| Impérios | Empires |
| Deuses Malignos | Evil Gods |
| Sogro | Father-In-Law |
| Elementos de Jogos | Game Elements |
| Barreira Linguística | Language Barrier |
| Advogados | Lawyers |
| Amor | Love |
| Masculino para Feminino | Male to Female |
| Necromante | Necromancer |
| Ninjas | Ninjas |
| Vida Escolar | School Life, Escolar |
| Escravidão Sexual | Sex Slaves |
| Romance de Desenvolvimento Lento | Slow Burn Romance |
| Jogo de Sobrevivencia | Survival Game |
| Transmigracao | Transmigration |
| Fraco a Forte | Weak To Strong |
| Zumbis | Zombies |

### Termos mantidos inicialmente em ingles

Alguns termos nao devem receber uma traducao apressada, seja por serem nomes
de trope consolidados ou por risco de alterar o significado:

- BDSM;
- Buff;
- Face Slapping;
- Fusion Fantasy;
- Gacha;
- Gender Bender;
- Jack of All Trades;
- LitRPG;
- MILF e DILF;
- Tsundere;
- Cross-dressing;
- termos sexuais especificos sem equivalente de uso consistente.

Esses termos continuam pesquisaveis e aparecem com o nome original ate uma
revisao manual.

## Modelo de dados recomendado

Nao substituir ou apagar as tags originais. Adicionar uma representacao
canonica paralela.

### Novel

Adicionar:

```text
tag_keys TEXT[]
```

Manter:

```text
tags TEXT[]  # tags originais recebidas da fonte
```

Criar indice GIN em `tag_keys`.

Vantagens:

- preserva o dado original para auditoria;
- permite corrigir o de-para sem recrawlear a novel;
- evita armazenar rotulos traduzidos como identificadores;
- torna o filtro rapido com operadores de array do Postgres;
- permite mudar o texto em portugues sem migrar novels.

### Fonte unica da taxonomia

Criar um arquivo versionado, por exemplo:

```text
backend/src/oghma/taxonomy/tags.json
```

O backend deve exportar a mesma taxonomia para o catalogo B2. O desktop nao
deve manter uma segunda lista manual de traducoes.

O catalogo estatico deve conter:

```json
{
  "taxonomyVersion": 1,
  "tags": [
    {
      "key": "genre.action",
      "label": "Ação",
      "category": "genre",
      "count": 701,
      "aliases": ["Action"]
    }
  ]
}
```

## Normalizacao no crawler

Criar uma funcao compartilhada:

```text
normalize_tags(raw_tags, source_id, source_language) -> tag_keys
```

Pipeline:

1. aplicar Unicode NFKC;
2. remover espacos extras;
3. comparar aliases com `casefold` e sem diferenca de acentos;
4. encontrar a chave canonica;
5. deduplicar chaves equivalentes;
6. preservar a tag original em `novel.tags`;
7. gerar uma chave `raw.<slug>` para desconhecidas;
8. registrar desconhecidas em relatorio para revisao.

O orquestrador deve aplicar essa funcao para todas as fontes. Sky Demon Order
sera o primeiro beneficiado, mas aliases como `Sci-fi`, `Horror`, `Oneshot` e
`Slice of Life` tambem serao corrigidos nas fontes em portugues.

## Backfill da base atual

Criar um comando CLI:

```text
oghma normalize-tags --source all --dry-run
oghma normalize-tags --source all --apply
```

O relatorio deve mostrar:

- quantidade de novels por fonte;
- tags originais encontradas;
- chave canonica escolhida;
- aliases consolidados;
- tags desconhecidas;
- conflitos onde um alias aponta para mais de uma chave;
- novels alteradas;
- contagem antes e depois da deduplicacao.

Executar primeiro em `dry-run`, revisar o relatorio e somente depois aplicar.

## Semantica do filtro

Estado no desktop:

```ts
type TagFilterState = {
  include: string[];
  exclude: string[];
};
```

Ciclo de clique:

```text
neutral -> include -> exclude -> neutral
```

Regra de correspondencia:

```text
TODAS as tags de include devem existir na novel
NENHUMA tag de exclude pode existir na novel
```

Formula:

```ts
include.every((key) => novel.tagKeys.includes(key))
&& exclude.every((key) => !novel.tagKeys.includes(key))
```

Nao adicionar agora modo `qualquer uma`/OR. A regra AND e previsivel e segue o
pedido de que cada tag marcada deve estar presente. OR pode ser uma evolucao
posterior.

## Proposta de experiencia desktop

### Painel compacto permanente

Manter o painel esquerdo com 240 px, reorganizado:

1. Busca, sempre visivel;
2. Fonte;
3. resumo de Tags;
4. tags ativas obrigatorias e proibidas;
5. botao `Escolher tags`;
6. secao recolhivel `Mais filtros` para status, idioma, capitulos, capa e
   atualizacao.

O painel nao deve tentar renderizar as 396 tags.

Resumo sugerido:

```text
Tags                         Editar
3 obrigatorias  1 proibida
[+ Fantasia] [+ Magia] [- Harem]
```

### Editor lateral de tags

O botao `Escolher tags` abre um side sheet desktop sobre a area de resultados,
sem deslocar permanentemente a grade.

Dimensoes propostas:

- largura entre 560 e 680 px;
- altura igual a area util da janela;
- cabecalho e rodape fixos;
- conteudo central com scroll;
- nao cobrir a barra de navegacao do app;
- adaptar para ocupar quase toda a largura em janelas pequenas.

Estrutura:

```text
Tags                                            Limpar
[ Buscar tags...                                      ]

Obrigatorias 3   Proibidas 1

Formato                                      Ver todas
[Webnovel] [Light Novel] [Original] ...

Genero                                       Ver todas
[Acao] [Fantasia] [Romance] ...

Tema                                         Ver todas
[Magia] [Reencarnacao] [Sistema] ...

Cancelar                         Mostrar 42 resultados
```

### Tags populares e catalogo completo

Sem busca:

- tags selecionadas aparecem primeiro;
- depois aparecem as 20 a 30 mais frequentes de cada grupo;
- `Ver todas` expande a secao completa;
- frequencia ordena apenas tags nao selecionadas;
- tags raras continuam disponiveis.

Com busca:

- pesquisar em `label_pt`, aliases e termos sem acento;
- exibir todos os resultados correspondentes;
- manter a divisao Formato, Genero e Tema;
- expandir automaticamente grupos com resultado;
- `action` deve encontrar `Acao`;
- `ficcao` deve encontrar `Ficcao Cientifica`;
- `school` deve encontrar `Vida Escolar`.

### Aplicacao em rascunho

O editor usa um estado de rascunho. Clicar nas tags nao deve refazer a grade a
cada clique.

- `Mostrar N resultados` aplica e fecha;
- `Cancelar` descarta alteracoes do rascunho;
- `Esc` equivale a Cancelar;
- `Limpar` limpa apenas o rascunho de tags;
- o contador de resultados e atualizado com debounce.

Essa abordagem evita a grade se movendo atras do painel durante a montagem de
um filtro complexo.

### Estados visuais

Nao depender somente de cor:

- neutra: fundo discreto, sem icone;
- obrigatoria: destaque verde/teal com icone `Check`;
- proibida: destaque vermelho contido com icone `Minus` ou `Ban`;
- hover: tooltip com a proxima acao;
- foco: contorno visivel;
- teclado: `Enter` e `Space` percorrem os tres estados.

Textos de acessibilidade devem acompanhar o estado:

```text
Fantasia: sem filtro. Ativar para exigir.
Fantasia: obrigatoria. Ativar para proibir.
Fantasia: proibida. Ativar para remover o filtro.
```

## Contratos do backend

### Taxonomia

Adicionar:

```text
GET /api/tags?sourceId=<id>
```

Resposta:

```json
{
  "taxonomyVersion": 1,
  "items": [
    {
      "key": "genre.action",
      "label": "Acao",
      "category": "genre",
      "aliases": ["Action"],
      "count": 135
    }
  ]
}
```

Contagens devem respeitar `sourceId`, pois a fonte e atualmente obrigatoria na
tela Discover.

### Busca de novels

Adicionar parametros repetidos:

```text
GET /api/novels?includeTag=genre.action&includeTag=theme.magic
                &excludeTag=theme.harem
```

SQL esperado:

```text
tag_keys @> ARRAY[include...]
AND NOT (tag_keys && ARRAY[exclude...])
```

Validar chaves recebidas e limitar a quantidade de tags por consulta.

## Contrato do desktop e catalogo B2

Alterar `Filters`:

```ts
type Filters = {
  query: string;
  sourceId: string;
  includeTags: string[];
  excludeTags: string[];
  // demais filtros existentes
};
```

Alterar `Novel`:

```ts
tagKeys: string[];
tags: string[]; // rotulos apresentados nos detalhes
```

Os tres backends do desktop devem obedecer a mesma semantica:

- backend HTTP;
- catalogo estatico do B2;
- mockBackend dos testes.

O catalogo B2 deve incluir `tagKeys` nas novels e uma taxonomia versionada por
fonte ou no indice global. Assim o filtro funciona offline depois de baixar o
catalogo.

## Integracao com detalhes da novel

Na aba Detalhes:

- exibir os rotulos canonicos em portugues;
- opcionalmente mostrar a tag original em tooltip quando ela foi traduzida;
- clicar em uma tag pode futuramente adiciona-la como obrigatoria;
- nao implementar essa acao na primeira entrega para manter o escopo pequeno.

## Fases de implementacao

### Fase 1 - Taxonomia e relatorio

1. criar o arquivo de taxonomia;
2. cadastrar aliases portugueses e ingleses encontrados no inventario;
3. criar normalizador puro e testes;
4. criar CLI de dry-run;
5. revisar desconhecidas e conflitos.

### Fase 2 - Banco e crawler

1. adicionar `novel.tag_keys` e indice GIN;
2. executar backfill revisado;
3. integrar normalizacao no orquestrador;
4. manter tags originais;
5. validar Sky Demon Order e depois as fontes em portugues.

### Fase 3 - API e publish

1. adicionar `/api/tags`;
2. adicionar include/exclude em `/api/novels`;
3. publicar `tagKeys` e taxonomia no B2;
4. versionar o schema do catalogo;
5. manter compatibilidade durante uma versao de transicao.

### Fase 4 - Estado e filtragem desktop

1. alterar `Filters`;
2. atualizar staticBackend, HTTP backend e mockBackend;
3. implementar reducer do ciclo de tres estados;
4. implementar busca sem acentos e por aliases;
5. adicionar debounce do contador de resultados.

### Fase 5 - Nova interface

1. reorganizar o painel compacto;
2. criar resumo de tags ativas;
3. criar side sheet;
4. criar secoes Formato, Genero e Tema;
5. adicionar populares, `Ver todas` e busca;
6. adicionar estados visuais, teclado e acessibilidade;
7. ajustar comportamento em diferentes larguras da janela.

### Fase 6 - Migracao e validacao

1. gerar catalogos novos;
2. validar contagens por fonte;
3. comparar resultados antigos e novos;
4. validar filtros combinados;
5. remover a lista fixa de seis tags de `constants/ui.ts`;
6. remover o campo antigo `filters.tags` apos a transicao.

## Testes obrigatorios

### Normalizacao

- `Action` e `Ação` geram `genre.action`;
- `Sci-fi` e `Ficção Científica` geram a mesma chave;
- aliases ignoram caixa, espacos e acentos;
- tags desconhecidas sao preservadas;
- duas tags equivalentes nao geram duplicata;
- tags originais continuam armazenadas.

### Regra do filtro

- clique 1 adiciona em include;
- clique 2 move de include para exclude;
- clique 3 remove de exclude;
- include usa AND;
- exclude remove qualquer novel que contenha a tag;
- include e exclude nunca possuem a mesma chave;
- limpar tags nao limpa a busca textual;
- trocar de fonte preserva tags canonicas selecionadas.

### Interface

- busca encontra rotulo e alias;
- busca funciona sem acentos;
- selecionadas permanecem visiveis mesmo fora das populares;
- Cancelar nao altera os filtros aplicados;
- Aplicar atualiza resultados e chips do painel;
- Esc fecha descartando o rascunho;
- foco e leitura por teclado percorrem os tres estados;
- texto nao estoura chips ou secoes;
- drawer funciona com painel de detalhes/fila aberto;
- nenhuma tag fica inacessivel em janela pequena.

### API e catalogo

- operadores include/exclude produzem os mesmos resultados no HTTP e no B2;
- indice GIN e usado nas consultas;
- contagens de tags respeitam a fonte;
- catalogo antigo recebe fallback controlado;
- taxonomia desconhecida nao quebra a tela.

## Criterios de aceite

- todas as 396 tags atuais podem ser encontradas;
- tags inglesas mapeadas aparecem em portugues;
- tags sem traducao permanecem com o nome original;
- nenhum dado original e perdido;
- o usuario distingue neutral, obrigatoria e proibida sem depender apenas de
  cor;
- o painel principal continua compacto;
- o filtro funciona igualmente online e com catalogo B2;
- o crawler aplica o mesmo de-para usado pela interface;
- novas tags aparecem como desconhecidas e entram no fluxo de revisao;
- desempenho permanece fluido com pelo menos 1.000 tags futuras.

## Decisoes recomendadas

- usar chaves canonicas e manter tags originais;
- manter uma unica taxonomia no backend e exporta-la ao desktop;
- usar side sheet amplo em vez de colocar centenas de chips na barra lateral;
- usar rascunho com botao `Mostrar N resultados`;
- usar AND para tags obrigatorias e exclusao por overlap;
- mostrar populares primeiro, sem esconder tags raras;
- classificar desconhecidas provisoriamente em Tema;
- nao traduzir automaticamente com IA durante o crawl;
- revisar o dicionario em codigo antes de aplicar o backfill;
- implementar taxonomia e dados antes da nova interface.
