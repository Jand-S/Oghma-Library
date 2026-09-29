# Plano de avaliacao de modelos de traducao

## Objetivo

Escolher o modelo e a estrategia padrao do Oghma com base em qualidade literaria,
consistencia de longo prazo, custo total e velocidade observados. A decisao nao deve
ser tomada por uma unica traducao nem apenas pelo preco por token.

O experimento deve responder:

- qual modelo traduz melhor EN -> pt-BR por si so;
- quanto glossario, Book Bible e memoria recuperada reduzem o drift;
- se um modelo pequeno consegue ser o tradutor principal;
- se modelos diferentes por etapa superam um unico modelo;
- quanto QA, reparos e repeticoes acrescentam ao custo real;
- qual configuracao mantem qualidade em capitulos consecutivos e distantes.

## Situacao atual

O pipeline ja traduz HTML, aplica glossario, executa QA deterministico, tenta reparo
e registra uso/custo. Ainda faltam persistencia, memoria longa, runner de evals e
telemetria de latencia. Os sidecars antigos tambem nao possuem tokens porque foram
gerados antes da instrumentacao atual.

Antes de escolher um padrao, implementar o minimo necessario para que toda execucao
seja reproduzivel e comparavel.

## Modelos candidatos

Precos abaixo sao os precos Standard publicados pela OpenAI em 2026-07-01, em USD
por 1 milhao de tokens. Devem ser versionados junto de cada rodada, pois podem mudar.

| Modelo | Papel no experimento | Input | Cached input | Output | Hipotese |
|---|---|---:|---:|---:|---|
| `gpt-5.5` | teto de qualidade | 5.00 | 0.50 | 30.00 | Melhor referencia, provavelmente caro para todos os capitulos. |
| `gpt-5.4` | tradutor/revisor forte | 2.50 | 0.25 | 15.00 | Pode entregar qualidade proxima ao teto pela metade do preco. |
| `gpt-5.4-mini` | principal candidato a padrao | 0.75 | 0.075 | 4.50 | Melhor equilibrio inicial entre qualidade, velocidade e custo. |
| `gpt-5-mini` | baseline economico anterior | 0.25 | 0.025 | 2.00 | Pode continuar competitivo em traducao bem especificada. |
| `gpt-5.4-nano` | extracao, resumo e triagem | 0.20 | 0.02 | 1.25 | Muito barato; improvavel como tradutor literario unico, mas deve ser medido. |
| `gpt-4.1-mini` | baseline sem reasoning | 0.40 | 0.10 | 1.60 | Baixa latencia e boa obediencia a instrucoes podem favorecer prosa. |

Nao usar modelos `pro` no primeiro ciclo. O custo nao combina com traducao em massa
e eles so entram se os modelos acima falharem em um tipo critico de trecho.

### Candidatos externos para o proximo ciclo

Incluir alguns provedores externos na proxima bateria, mas manter a matriz pequena.
O objetivo e descobrir se algum modelo fora da OpenAI supera a fronteira atual de
custo-beneficio formada por `gpt-4.1-mini`, `gpt-5.4-mini` e `gpt-5.4-nano`.

Precos abaixo foram consultados em 2026-07-02 e devem ser reconfirmados antes da
execucao. Para motores de traducao por caractere, a comparacao com tokens e apenas
aproximada; o custo real deve vir da telemetria do provedor.

| Provedor/modelo | Tipo | Preco publicado | Motivo para testar | Risco/observacao |
|---|---|---:|---|---|
| `deepseek/deepseek-v4-flash` via OpenRouter | LLM | USD 0.09 input / 0.18 output por 1M tokens; cache hit USD 0.018 | Muito barato, 1M de contexto e suporte a structured outputs; bom candidato para traducao principal economica. | Precisa validar qualidade literaria pt-BR, confiabilidade, privacidade e comportamento em termos locked. |
| `deepseek/deepseek-v4-pro` via OpenRouter | LLM | USD 0.435 input / 0.87 output por 1M tokens; cache hit USD 0.003625 | Ainda barato frente a `gpt-5.4-mini`, com chance de melhor semantica que Flash. | Mesmo risco de qualidade/editorial; testar em amostra menor primeiro. |
| `google/gemini-3-flash-preview` via OpenRouter | LLM | USD 0.50 input / 3.00 output por 1M tokens; cache hit USD 0.05 | Preco entre `gpt-4.1-mini` e `gpt-5.4-mini`; bom candidato para tradutor principal e revisao rapida. | Modelo preview pode mudar; checar estabilidade e suporte pratico a structured outputs no adapter. |
| `anthropic/claude-haiku-4.5` via OpenRouter | LLM | USD 1.00 input / 5.00 output por 1M tokens; cache hit USD 0.10 | Anthropic declara suporte multilingue; pode ser bom em voz/prosa. | Mais caro que `gpt-5.4-mini`; entra como challenger de qualidade, nao de preco. |
| `mistral-medium`/linha Medium atual | LLM | precos variam por modelo atual; confirmar na console antes da rodada | Historicamente competitivo em custo/desempenho; pode ser bom baseline europeu/multilingue. | A pagina publica de modelos muda; so incluir se o preco atual ficar perto de `gpt-5.4-mini` ou menor. |
| DeepL API | motor especializado | cobranca por caractere; confirmar plano/regiao antes da rodada | Tradutor especializado, suporta pt-BR e glossario; bom baseline de traducao literal/natural. | Deve sofrer com terminologia de novel, contexto longo e estilo; nao substitui Book Bible/RAG. |
| Amazon Translate | motor especializado | USD 15 por 1M caracteres para texto/HTML | Barato por caractere e suporta HTML; bom baseline operacional. | Menos controle literario; usar como comparador, nao como candidato favorito. |
| Google Cloud Translation | motor especializado | NMT a partir de USD 20 por 1M caracteres apos franquia | Suporta glossario/custom translation; baseline de motor dedicado. | Custo por caractere pode ficar pior que LLM pequeno; qualidade literaria incerta. |

Para a proxima bateria pratica, testar primeiro apenas:

- `deepseek/deepseek-v4-flash`;
- `deepseek/deepseek-v4-pro`;
- `google/gemini-3-flash-preview`;
- `anthropic/claude-haiku-4.5`, se aceitarmos um challenger mais caro;
- DeepL ou Amazon Translate como baseline de motor especializado.

Nao vale testar todos os motores especializados de uma vez. Eles servem para medir
"traducao automatica classica" contra LLM com memoria, glossario e QA, mas a chance
de vencerem em xianxia/novel longa sem reescrita posterior e menor.

### Estimativa ilustrativa

Usando apenas como exemplo 3.600 tokens de entrada e 4.300 de saida por capitulo,
sem QA, reparo, reasoning adicional ou cache:

| Modelo | USD/capitulo | USD/1.000 capitulos |
|---|---:|---:|
| `gpt-5.5` | 0.1470 | 147.00 |
| `gpt-5.4` | 0.0735 | 73.50 |
| `gpt-5.4-mini` | 0.0221 | 22.05 |
| `gpt-5-mini` | 0.0095 | 9.50 |
| `gpt-5.4-nano` | 0.0061 | 6.10 |
| `gpt-4.1-mini` | 0.0083 | 8.32 |

Esses valores nao servem para previsao final. A metrica oficial do experimento sera
o custo total observado, incluindo extracao, resumo, QA, reparos e respostas falhas.

## Estrategias concorrentes

Testar pelo menos quatro pipelines:

### S1 - Um unico modelo

O mesmo modelo faz traducao e reparo. E o baseline operacional mais simples.

### S2 - Mini principal com escalonamento

- `gpt-5.4-nano`: extracao de termos, entidades e resumos;
- `gpt-5.4-mini`: traducao principal;
- QA deterministico sempre;
- `gpt-5.4`: revisao/reparo apenas de segmentos sinalizados.

Esta e a hipotese inicial de melhor custo-beneficio. O modelo caro recebe poucos
segmentos, nao o capitulo inteiro.

### S3 - Mini em todas as etapas

- `gpt-5.4-mini`: traducao, QA bilingue e reparo;
- `gpt-5.4-nano`: tarefas estruturadas auxiliares.

Mede se a simplicidade compensa uma possivel taxa maior de falso negativo no QA.

### S4 - Modelo forte como tradutor

- `gpt-5.4`: traducao;
- `gpt-5.4-mini`: QA;
- `gpt-5.4` ou `gpt-5.5`: reparo critico.

Compara qualidade premium sem pagar `gpt-5.5` em toda a obra.

`gpt-5.5` traduzira uma amostra menor como teto de qualidade. Ele nao sera assumido
como vencedor por ser o modelo maior.

## Corpus de teste

Usar de 3 a 5 obras com conteudo autorizado pelo usuario para envio ao provedor:

- xianxia/cultivation com terminologia, filosofia e hierarquias;
- fantasia com muitos nomes, lugares, titulos e sistema de poder;
- obra centrada em dialogo, voz de personagem e humor;
- obra com narracao introspectiva ou linguagem figurada;
- opcionalmente, texto moderno com girias e mudancas de registro.

Evitar avaliar apenas trechos curtos. Cada obra deve contribuir com capitulos
inteiros e manter HTML original preservado.

### Amostragem por obra

1. **Sequencial curta:** capitulos 1-5.
2. **Sequencial media:** uma janela posterior de 5 capitulos, como 46-50.
3. **Saltos:** capitulos 1, 10, 50, 100 e um capitulo tardio disponivel.
4. **Desafios:** capitulos escolhidos por alta densidade de termos, dialogo,
   combate, humor ou exposicao cultural.

Nos saltos, testar dois modos:

- `cold`: apenas glossario/Book Bible inicial;
- `memory`: glossario, entidades, resumos e memorias que estariam disponiveis
  naquele ponto cronologico, sem vazar eventos de capitulos futuros.

Isso separa a capacidade do modelo da qualidade do nosso RAG.

## Protocolo controlado

Para cada celula modelo x estrategia x capitulo:

- usar o mesmo HTML limpo, segmentacao, glossario e contexto recuperado;
- fixar versao do prompt, snapshot do modelo quando disponivel e reasoning effort;
- executar pelo menos duas repeticoes nos finalistas para medir variancia;
- salvar resposta bruta, HTML, segmentos, issues, uso e configuracao;
- medir tempo de fila, tempo da chamada, tempo total e numero de tentativas;
- nao deixar uma traducao anterior do mesmo modelo contaminar outra rodada;
- randomizar a ordem das traducoes apresentadas aos avaliadores automaticos.

Rodar primeiro em Standard para medir latencia comparavel. Depois repetir o pipeline
vencedor em Batch: a OpenAI informa desconto de 50%, com conclusao em ate 24 horas.
Batch deve ser opcao para obras completas, nao para piloto interativo.

Organizar o prompt com instrucoes e schemas estaveis no prefixo e dados do capitulo
no final. O Prompt Caching exige prefixo exato, funciona automaticamente a partir de
1.024 tokens e pode reduzir custo de input e latencia. Registrar `cached_tokens` e
taxa de cache hit em vez de presumir a economia.

## Metricas

### Gates deterministas

- 100% de aderencia aos termos `locked`;
- 100% de preservacao das chaves de segmento e HTML valido;
- nenhum segmento ausente ou duplicado;
- nenhum nome proprio conhecido alterado;
- idioma residual abaixo do limite definido, exceto termos permitidos.

Falhar em gate impede a promocao, mesmo que a prosa pareca melhor.

### Qualidade editorial automatizada

- fidelidade semantica e ausencia de invencoes;
- naturalidade e fluidez em pt-BR;
- preservacao de voz, humor, formalidade e subtexto;
- tratamento de ambiguidades culturais;
- consistencia de nomes, pronomes, titulos e termos;
- estabilidade entre capitulos sequenciais e distantes;
- taxa de omissao, traducao excessivamente literal e ingles residual.

Usar avaliacao cega por pares e pelo menos dois graders de familias/configuracoes
diferentes. Um modelo nao deve ser o unico juiz de sua propria traducao. Empates e
discordancias entram como incerteza, nao como vitoria forcada.

### Operacao e custo

- tokens de input, cached input, reasoning e output por operacao;
- USD e BRL por capitulo, 10 mil palavras e obra estimada;
- custo antes e depois de QA/reparo;
- percentual de capitulos e segmentos escalonados ao modelo forte;
- chamadas, retries, timeouts e respostas invalidas;
- latencia p50/p95, capitulos/hora e palavras/minuto;
- taxa de cache hit e economia obtida com Batch.

Criar tambem `quality_adjusted_cost`: custo total dividido pela pontuacao de qualidade
acima do gate. Preco barato com muitos reparos nao deve parecer artificialmente bom.

## Criterio de escolha

Selecionar primeiro por gates, depois por fronteira de Pareto entre qualidade, custo
e velocidade. Um candidato vira padrao quando:

- passa todos os gates deterministas;
- fica no maximo 3 pontos percentuais abaixo do melhor score editorial;
- reduz custo materialmente ou melhora velocidade;
- nao aumenta drift em sequencias e saltos;
- mantem baixa variancia entre repeticoes.

Se nenhum modelo pequeno cumprir isso, adotar roteamento seletivo. O objetivo nao e
forcar um unico modelo, e pagar inteligencia maior apenas onde ela produz ganho real.

## Proximos passos revisados

1. Instrumentar duracao, reasoning tokens, retries e payload versionado no provider.
2. Criar sidecar de eval com modelo/snapshot, prompt, contexto e precos da rodada.
3. Implementar runner que execute matriz sem sobrescrever resultados.
4. Criar validadores deterministas e relatorio CSV/JSON/Markdown.
5. Montar corpus inicial autorizado com 3 obras e amostragem sequencial/espacada.
6. Rodar triagem barata com `gpt-5.4-mini`, `gpt-5-mini`, `gpt-5.4-nano` e
   `gpt-4.1-mini`, adicionando `deepseek/deepseek-v4-flash`,
   `deepseek/deepseek-v4-pro` e `google/gemini-3-flash-preview` via OpenRouter
   se os adapters/API keys estiverem disponiveis.
7. Rodar `gpt-5.4` e uma amostra `gpt-5.5` nos mesmos casos.
8. Selecionar dois finalistas e repetir com memoria longa habilitada.
9. Comparar pipeline unico contra escalonamento seletivo.
10. Publicar decisao versionada do modelo padrao e manter o suite como regressao.

Depois desta rodada, continuar a infraestrutura persistente do backend. O runner de
eval deve reutilizar o mesmo pipeline de producao, para que a escolha nao seja baseada
em um script com comportamento diferente do produto.

## Runner implementado

O runner inicial esta em `backend/src/oghma/translation/eval_runner.py`. Ele usa um
manifesto JSON, cria um diretorio imutavel por sessao e produz `summary.json`,
`summary.csv`, HTML e sidecar por execucao.

Pre-visualizar o piloto sem gastar:

```powershell
cd backend
.\.venv\Scripts\python.exe -m oghma.translation.eval_runner `
  translation-workspace/eval-manifest.openai-mini-pilot.json
```

Executar exige as duas confirmacoes `--execute` e `--max-estimated-usd`:

```powershell
.\.venv\Scripts\python.exe -m oghma.translation.eval_runner `
  translation-workspace/eval-manifest.openai-mini-pilot.json `
  --execute --max-estimated-usd 1.00
```

O teto usa uma estimativa conservadora local para impedir uma matriz acidentalmente
grande. O custo real continua sendo registrado a partir do `usage` retornado pela API.

Avaliar uma sessao concluida sem revelar os modelos aos julgadores:

```powershell
.\.venv\Scripts\python.exe -m oghma.translation.grade_runner `
  translation-workspace/evals/<manifesto>/<sessao> `
  --execute --max-estimated-usd 1.00
```

O grader compara todos os pares por capitulo com `gpt-5.4` e `gpt-5.4-mini`, inverte
os rotulos A/B entre os julgadores, registra scores por dimensao, vitorias, motivos,
discordancias, tokens, tempo e custo. Termos locked persistidos no sidecar sao enviados
como restricoes editoriais obrigatorias.

## OpenRouter

O adapter inicial esta em `backend/src/oghma/translation/providers/openrouter_provider.py`.
Ele usa o endpoint Chat Completions compativel do OpenRouter, `response_format` com
JSON Schema e `provider.require_parameters=true` para evitar rota para endpoint sem
structured outputs.

Variaveis de ambiente:

```powershell
$env:OGHMA_OPENROUTER_API_KEY="..."
$env:OGHMA_OPENROUTER_TITLE="Oghma Library"
```

Pre-visualizar o piloto OpenRouter:

```powershell
cd backend
.\.venv\Scripts\python.exe -m oghma.translation.eval_runner `
  translation-workspace/eval-manifest.openrouter-pilot.json
```

Executar exige teto de custo, como no provider OpenAI:

```powershell
.\.venv\Scripts\python.exe -m oghma.translation.eval_runner `
  translation-workspace/eval-manifest.openrouter-pilot.json `
  --execute --max-estimated-usd 1.00
```

## Referencias oficiais consultadas

- Modelos: https://developers.openai.com/api/docs/models
- GPT-5.5: https://developers.openai.com/api/docs/models/gpt-5.5
- GPT-5.4: https://developers.openai.com/api/docs/models/gpt-5.4
- GPT-5.4 mini: https://developers.openai.com/api/docs/models/gpt-5.4-mini
- GPT-5.4 nano: https://developers.openai.com/api/docs/models/gpt-5.4-nano
- GPT-5 mini: https://developers.openai.com/api/docs/models/gpt-5-mini
- GPT-4.1 mini: https://developers.openai.com/api/docs/models/gpt-4.1-mini
- Batch API: https://developers.openai.com/api/docs/guides/batch
- Prompt Caching: https://developers.openai.com/api/docs/guides/prompt-caching
- Anthropic modelos e precos: https://platform.claude.com/docs/en/about-claude/models/overview
- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- DeepSeek models e pricing: https://api-docs.deepseek.com/quick_start/pricing
- Mistral models overview: https://docs.mistral.ai/models/overview
- DeepL API: https://www.deepl.com/en/pro
- Amazon Translate pricing: https://aws.amazon.com/translate/pricing/
- Google Cloud Translation pricing: https://cloud.google.com/translate/pricing
- OpenRouter Quickstart: https://openrouter.ai/docs/quickstart
- OpenRouter Structured Outputs: https://openrouter.ai/docs/guides/features/structured-outputs
- OpenRouter Models API: https://openrouter.ai/api/v1/models
