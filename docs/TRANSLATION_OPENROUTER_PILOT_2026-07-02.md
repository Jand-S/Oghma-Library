# Piloto OpenRouter - 2026-07-02

## Escopo

Objetivo: validar o adapter OpenRouter e obter um primeiro sinal operacional em
modelos externos baratos para traducao EN -> pt-BR.

Corpus executado:

- `chapter-007-clean.html`, com glossario xianxia local;
- uma traducao smoke adicional de `chapter-001.html` com `deepseek/deepseek-v4-flash`.

Esta rodada ainda nao escolhe modelo padrao. Ela possui apenas um capitulo comparavel
entre os tres modelos e ainda nao passou por grader editorial cego.

## Modelos testados

| Modelo | Status | Duracao | Input | Output | Reasoning | Reparos | Issues | Custo USD |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `deepseek/deepseek-v4-flash` | `draft_with_warnings` | 98.35s | 8,147 | 9,765 | 4,854 | 2 | 1 | 0.002486 |
| `deepseek/deepseek-v4-pro` | `approved_auto` | 224.39s | 6,737 | 13,545 | 7,757 | 0 | 0 | 0.014715 |
| `google/gemini-3-flash-preview` | `approved_auto` | 21.83s | 7,788 | 3,982 | 0 | 1 | 0 | 0.015840 |

Resumo operacional:

- `deepseek/deepseek-v4-flash` foi muito barato, mas falhou em glossario e gerou
  mojibake em trecho traduzido.
- `deepseek/deepseek-v4-pro` passou nos gates sem reparo, mas foi o mais lento.
- `google/gemini-3-flash-preview` passou nos gates e foi muito mais rapido, mas
  precisa de avaliacao editorial porque produziu saida bem menor.

## Avaliacao editorial cega

Depois da execucao, os tres resultados foram comparados por pares com dois graders:
`gpt-5.4` e `gpt-5.4-mini`. Foram 6 julgamentos, com custo real de USD 0.125139.

| Modelo | Vitorias | Derrotas | Pontos | Score medio |
|---|---:|---:|---:|---:|
| `google/gemini-3-flash-preview` | 3 | 1 | 3.0 | 81.750 |
| `deepseek/deepseek-v4-pro` | 2 | 2 | 2.0 | 77.958 |
| `deepseek/deepseek-v4-flash` | 1 | 3 | 1.0 | 79.417 |

Leitura desta rodada:

- `google/gemini-3-flash-preview` foi o melhor sinal inicial: venceu mais pares,
  teve maior score medio, foi o mais rapido e passou nos gates.
- `deepseek/deepseek-v4-pro` continua relevante por passar nos gates sem reparo,
  mas foi muito lento nesta amostra.
- `deepseek/deepseek-v4-flash` nao deve ser descartado ainda pelo preco, mas precisa
  corrigir mojibake/glossario antes de entrar como opcao recomendada.

Este resultado nao promove um modelo padrao. Ele so define quais modelos merecem
continuar na bateria maior.

## Achados

O `deepseek/deepseek-v4-flash` retornou texto com sinais de encoding quebrado, como
`vocÃªs`, e tambem nao obedeceu perfeitamente o termo locked `aperture -> abertura`
em um segmento. O QA anterior detectava o glossario, mas nao marcava mojibake como
issue propria.

Mitigacao implementada nesta rodada:

- novo gate deterministico `mojibake`;
- teste cobrindo traducao com encoding quebrado;
- adapter OpenRouter usando structured outputs e `provider.require_parameters=true`.

## Proximos passos

1. Rodar grader editorial cego nos tres resultados do capitulo 7.
2. Repetir o capitulo 7 apos o novo gate de mojibake para medir reparo/falha real.
3. Testar pelo menos tres novels com capitulos 1-5, 46-50 e saltos distantes.
4. Adicionar provider de grading configuravel para julgar via OpenRouter quando fizer sentido.
5. Manter `deepseek/deepseek-v4-pro` e `google/gemini-3-flash-preview` na proxima bateria.
6. Tratar `deepseek/deepseek-v4-flash` como candidato de baixo custo apenas se passar
   nos gates depois de ajustes de prompt/reparo.
