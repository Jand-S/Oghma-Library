# Piloto preliminar de modelos economicos - 2026-07-01

## Escopo

Primeira validacao do runner e da telemetria com dois capitulos ja autorizados para
envio a OpenAI. Esta rodada nao escolhe o modelo padrao: nao possui corpus amplo,
capitulos sequenciais, memoria longa nem graders editoriais.

Sessao:

```text
backend/translation-workspace/evals/openai-mini-pilot/20260702T004532Z-65556b43
```

Foram planejadas 8 execucoes: 2 capitulos x 4 modelos. Seis concluiram e duas
falharam. O custo real das traducoes concluidas foi USD 0.107809.

## Resultados operacionais

| Modelo | Capitulo | Resultado | Tempo (s) | Input | Output | Reasoning | Reparos | USD |
|---|---|---|---:|---:|---:|---:|---:|---:|
| `gpt-5.4-mini` | 001 | approved_auto | 45.92 | 8,291 | 7,388 | 2,939 | 0 | 0.039464 |
| `gpt-5.4-mini` | 007 | approved_auto | 35.75 | 6,671 | 6,291 | 2,542 | 0 | 0.033313 |
| `gpt-5-mini` | 001 | falha de protocolo | 185.94 | - | - | - | - | - |
| `gpt-5-mini` | 007 | falha de protocolo | 185.94 | - | - | - | - | - |
| `gpt-5.4-nano` | 001 | approved_auto | 40.50 | 8,291 | 5,530 | 997 | 0 | 0.008571 |
| `gpt-5.4-nano` | 007 | approved_auto | 35.66 | 6,671 | 5,035 | 1,286 | 0 | 0.007628 |
| `gpt-4.1-mini` | 001 | approved_auto | 51.85 | 8,293 | 4,246 | 0 | 0 | 0.010111 |
| `gpt-4.1-mini` | 007 | approved_auto | 48.83 | 7,414 | 3,598 | 0 | 1 | 0.008722 |

Os tempos de falha do `gpt-5-mini` foram calculados pelos timestamps do sidecar. As
duas chamadas terminaram em `RemoteProtocolError` depois dos retries configurados.

## Leitura preliminar

- `gpt-5.4-mini`, `gpt-5.4-nano` e `gpt-4.1-mini` preservaram estrutura e glossario
  segundo o QA deterministico atual.
- `gpt-5.4-nano` custou aproximadamente 22% do `gpt-5.4-mini` nesta amostra.
- `gpt-4.1-mini` teve custo proximo ao nano, mas precisou de um reparo no capitulo 7.
- Nenhuma chamada recebeu cached input; ainda precisamos otimizar prefixos/cache key.
- `approved_auto` hoje prova integridade estrutural e termos locked, nao qualidade
  literaria. Nao usar esse status para declarar o nano equivalente ao mini.
- A falha do `gpt-5-mini` precisa ser repetida isoladamente antes de excluir o modelo.

## Proxima rodada

1. Adicionar graders editoriais cegos e metricas de idioma residual/omissao.
2. Montar corpus com no minimo 3 obras e janelas sequenciais.
3. Repetir os tres modelos funcionais com duas repeticoes.
4. Retestar `gpt-5-mini` isoladamente com timeout e log de tentativas melhorados.
5. Incluir `gpt-5.4` e uma amostra `gpt-5.5` como referencias de qualidade.
6. Comparar modo `cold` contra modo `memory` quando a persistencia estiver pronta.

## Avaliacao editorial cega

Foram executados 12 julgamentos: todos os pares dos tres modelos funcionais, nos dois
capitulos, avaliados por `gpt-5.4` e `gpt-5.4-mini`. O segundo julgador recebeu A/B
invertidos. A rodada custou USD 0.238854; traducao mais grading somaram USD 0.346663.

| Modelo | Vitorias | Derrotas | Score editorial medio |
|---|---:|---:|---:|
| `gpt-4.1-mini` | 6 | 2 | 77.938 |
| `gpt-5.4-mini` | 4 | 4 | 79.583 |
| `gpt-5.4-nano` | 2 | 6 | 74.667 |

Media por dimensao:

| Modelo | Fidelidade | Fluidez | Voz/tom | Nuance | Terminologia | Completude |
|---|---:|---:|---:|---:|---:|---:|
| `gpt-4.1-mini` | 81.00 | 76.25 | 76.00 | 75.50 | 75.25 | 83.62 |
| `gpt-5.4-mini` | 81.62 | 76.12 | 77.38 | 77.75 | 77.25 | 87.38 |
| `gpt-5.4-nano` | 76.12 | 70.75 | 72.38 | 72.88 | 69.75 | 86.12 |

Os julgadores discordaram em 3 dos 6 pares. Portanto, a lideranca por vitorias do
`gpt-4.1-mini` nao e suficiente para promove-lo, assim como o maior score medio do
`gpt-5.4-mini` nao o torna automaticamente vencedor.

Achados qualitativos importantes:

- `gpt-5.4-mini` teve o melhor score medio, mas inseriu caracteres hebraicos no
  capitulo 7. Isso era invisivel ao QA anterior e agora virou gate deterministico.
- `gpt-4.1-mini` inverteu uma informacao temporal importante: "daqui a dois meses"
  virou "dois meses atras".
- `gpt-5.4-nano` cometeu erros semanticos mais graves, como inverter quem aceitou
  quem como meio discipulo e traduzir `chinaware` como "porcelana de tipo chines".
- O capitulo 1 fonte ja possui uma fala truncada; isso contaminou todas as traducoes
  e mostra que precisamos de preflight de integridade do texto fonte.
- Parte da discordancia veio de `Rank`/`Grau`/`patamar`, termo nao travado no
  glossario. O runner agora persiste e envia termos locked aos graders.
- A entrada do capitulo 7 continha mojibake. O sanitizador foi ampliado para corrigir
  UTF-8 mal decodificado antes da traducao.

Conclusao desta rodada: nenhum modelo esta pronto para ser padrao. O candidato mais
promissor continua sendo `gpt-5.4-mini`, possivelmente com QA/reparo seletivo, mas a
proxima rodada deve usar fonte limpa, glossario completo e o novo gate de scripts.
