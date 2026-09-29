# Proximos passos da ferramenta de traducao

Data: 2026-07-02

Esta doc consolida as proximas implementacoes da feature de traducao do Oghma, com
base nas decisoes atuais:

- traducao principal sem etapa humana obrigatoria;
- glossario e memoria automatizados;
- selecao dinamica de modelo por custo/qualidade;
- modo automatico para escolher o melhor modelo por novel;
- estimativa e telemetria atualizadas durante o processamento;
- reaproveitamento de capitulos ja traduzidos.

## Estado atual

Ja existe:

- pipeline backend para traduzir HTML por segmentos;
- QA deterministico, reparo e sidecars;
- providers OpenAI e OpenRouter;
- runner de avaliacao e grader cego;
- planner inicial de custo/modelo;
- rota `POST /api/translations/estimate`;
- tela de Traducao consumindo estimativas e cards de recomendacao.
- coverage inicial por indice local, com rota `GET /api/translations/coverage`;
- tela de Traducao mostrando reaproveitamento, faltantes, faixas e economia estimada.
- registry inicial de jobs por indice local, com APIs de criar/listar/consultar/pausar/retomar/cancelar.
- plano automatico inicial, com rota `POST /api/translations/automatic-plan`;
- historico inicial de selecao automatica, com rota `GET /api/translations/selection-history`;
- tela de Traducao com opcao `Automatico (escolher melhor)` no seletor de modelo.

Ainda falta transformar isso em fluxo de producao persistente.

## Decisao de produto

O Oghma nao tera um unico modelo fixo. Ele tera:

- **modelo recomendado padrao**, calculado pelo planner;
- **modo Automatico / Escolher o melhor**;
- escolha manual de modelos;
- estimativa antes de iniciar;
- custo real e ETA durante a execucao;
- reaproveitamento automatico de capitulos ja traduzidos.

## Marco 1 - Coverage de traducoes existentes

Objetivo: saber quais capitulos de uma novel ja possuem traducao reaproveitavel.

Status: base inicial implementada em:

```text
backend/src/oghma/translation/coverage.py
GET /api/translations/coverage
apps/desktop/src/views/translation.tsx
```

O MVP atual usa um indice JSON local em:

```text
<storage_root>/translations/coverage-index.json
```

Tambem aceita override por ambiente:

```text
OGHMA_TRANSLATION_COVERAGE_INDEX=C:\...\coverage-index.json
```

Isso permite validar a UX e o contrato antes de criar tabelas permanentes.

O CLI de traducao tambem consegue registrar outputs no indice:

```powershell
python -m oghma.translation.cli input.html `
  --provider fake `
  --output output.html `
  --novel-id minha-novel `
  --chapter-number 1 `
  --coverage-index translation-workspace/coverage-index.json
```

Registros com `draft_with_warnings` sao salvos para auditoria, mas nao contam como
reaproveitamento seguro enquanto `coverage.py` mantiver `REUSABLE_STATUSES` restrito
a traducoes aprovadas/concluidas.

### Backend

Criar modelo/tabela ou storage indexado para `translation_chapter`:

```text
id
novel_id
chapter_id
chapter_number
target_language
profile_id
translated_path
sidecar_path
source_hash
translated_hash
status
quality_score
model
provider
prompt_version
public_reusable
origin
created_at
updated_at
```

Estados de freshness:

```text
fresh       # source_hash bate com o capitulo atual
stale       # fonte mudou
unknown     # importado/sem hash
needs_review
```

Criar API:

```text
GET /api/translations/coverage?novelId=x&chapterFrom=1&chapterTo=500
```

Resposta:

```json
{
  "selectedCount": 500,
  "translatedCount": 301,
  "missingCount": 199,
  "coveragePercent": 60.2,
  "ranges": ["200-500"],
  "staleRanges": [],
  "estimatedSavingsUsd": 7.66,
  "estimatedSavingsBrl": 42.18
}
```

### Desktop

Mostrar nos cards de novel:

- indicador verde quando houver traducao disponivel;
- indicador parcial quando houver apenas algumas faixas;
- tooltip curta com quantidade e ranges, por exemplo `10-13, 15-19, 200-500`;
- limite visual: primeiras 3 faixas + `+N faixas`.

Na tela de Traducao:

- mostrar capitulos ja traduzidos no range selecionado;
- estimar economia;
- permitir escolher:
  - usar traducoes existentes;
  - traduzir apenas faltantes;
  - retraduzir tudo;
  - atualizar capitulos antigos.

## Marco 2 - Job real de traducao

Objetivo: transformar estimativa em execucao acompanhavel e retomavel.

Status: contrato/API inicial implementado em:

```text
backend/src/oghma/translation/jobs.py
backend/src/oghma/translation/worker.py
POST /api/translations/jobs
GET  /api/translations/jobs
GET  /api/translations/jobs/{jobId}
POST /api/translations/jobs/{jobId}/pause
POST /api/translations/jobs/{jobId}/resume
POST /api/translations/jobs/{jobId}/cancel
POST /api/translations/jobs/{jobId}/run
python -m oghma.cli translation-worker
```

O MVP atual persiste jobs em:

```text
<storage_root>/translations/jobs-index.json
```

Tambem aceita override:

```text
OGHMA_TRANSLATION_JOBS_INDEX=C:\...\jobs-index.json
```

O worker ja consome jobs `queued`, traduz capitulos baixados em lotes paralelos
controlados por `worker_count`, salva HTML/sidecar, atualiza coverage e progresso.
Por seguranca, o comando so roda
providers pagos quando recebe `--allow-paid-providers`.

Exemplo seguro com provider `fake`:

```powershell
python -m oghma.cli translation-worker --max-jobs 1
```

Exemplo permitindo provider real:

```powershell
python -m oghma.cli translation-worker --max-jobs 1 --allow-paid-providers
```

O proximo passo deste marco e ligar a criacao/execucao do job na tela, com botoes de
iniciar, pausar, retomar e cancelar.

Status adicional:

- a tela de Traducao ja cria jobs `queued` a partir dos lotes preparados;
- o mock/static backend simulam criacao/listagem de jobs;
- o worker salva outputs e atualiza progresso/coverage;
- o worker respeita `worker_count` e traduz capitulos em lotes paralelos, gravando
  outputs/coverage de forma sequencial para evitar corrida no indice JSON;
- a API possui endpoint seguro para disparar job em background;
- `run` bloqueia providers pagos a menos que receba `allowPaidProviders=true`;
- o desktop client ja possui metodos para criar/listar/rodar/pausar/retomar/cancelar jobs;
- a tela de Traducao ja permite executar, pausar, retomar e cancelar jobs criados;
- a execucao pela UI usa o modo seguro por padrao, sem liberar providers pagos automaticamente.
- a tela possui toggle explicito para liberar providers pagos quando o usuario quiser executar jobs reais.

Criar `translation_job`:

```text
id
project_id
novel_id
chapter_from
chapter_to
target_language
mode
strategy
status
selected_model
provider
worker_count
reuse_existing
stats jsonb
created_at
started_at
finished_at
```

Status:

```text
queued
planning
sampling
translating
repairing
paused
failed
done
cancelled
```

APIs:

```text
POST /api/translations/jobs
GET  /api/translations/jobs
GET  /api/translations/jobs/{jobId}
POST /api/translations/jobs/{jobId}/pause
POST /api/translations/jobs/{jobId}/resume
POST /api/translations/jobs/{jobId}/cancel
```

O job deve salvar:

- progresso por capitulo;
- custo real acumulado;
- tokens reais;
- modelo/provider usado;
- warnings e repairs;
- paths de HTML traduzido;
- sidecars.

## Marco 3 - Modo Automatico / Escolher o melhor

Objetivo: o usuario seleciona um range grande e o Oghma escolhe o melhor modelo por
tras dos panos.

Status: base inicial implementada em:

```text
backend/src/oghma/translation/auto_select.py
POST /api/translations/automatic-plan
apps/desktop/src/services/backendClient.ts
apps/desktop/src/views/translation.tsx
```

O MVP atual seleciona capitulos de amostra representativos a partir dos capitulos
baixados, calcula custo estimado da amostra para os modelos candidatos e disponibiliza
isso para a tela de Traducao. A UI ja permite escolher `Automatico (escolher melhor)`
e cria jobs com `strategy=automatic`.

O worker ja executa jobs automaticos em duas fases:

```text
sampling -> resolve modelo/provider vencedor -> translating
```

Durante `sampling`, ele traduz amostras com os modelos candidatos, calcula metricas
deterministicas/QA, escolhe o maior score, atualiza o job com o modelo vencedor e
grava um sidecar:

```text
<storage_root>/translations/outputs/<novel>/<idioma>/job-<id>.automatic-selection.json
```

O grader LLM pareado ja existe como etapa opcional no fluxo automatico. Ele fica
desligado por padrao e so roda quando a execucao libera providers pagos e tambem
autoriza explicitamente o grader editorial.

Ainda falta evoluir o historico para um score agregado mais robusto por novel/range,
com decaimento temporal e confianca por quantidade de amostras.

Status adicional:

- o vencedor automatico ja e salvo em um indice JSON local;
- a API ja expoe `GET /api/translations/selection-history`;
- o desktop client/mock/static ja conhecem o contrato de leitura do historico.
- o endpoint de plano automatico e o worker ja priorizam modelos que venceram
  anteriormente na mesma novel/idioma.
- a tela de Traducao ja mostra um resumo do historico automatico da novel selecionada.
- a tela possui toggle separado para `Usar grader editorial`, dependente de
  `Liberar providers pagos`;
- o sidecar `automatic-selection.json` inclui `editorial_grades` quando o grader roda.
- o plano automatico retorna estimativa separada do custo do grader editorial;
- a tela mostra esse custo opcional quando `Automatico (escolher melhor)` esta ativo.
- o historico de selecao registra `editorial_grade_count` e `editorial_cost_usd`;
- a tela indica quando uma vitoria historica teve grades editoriais.
- jobs possuem `max_cost_usd` opcional;
- a API bloqueia execucao quando a estimativa ultrapassa o orcamento;
- o worker interrompe o job se o custo real acumulado ultrapassar o orcamento;
- a tela ja permite informar `Orcamento maximo BRL`.
- a tela atualiza jobs criados por polling e mostra progresso/status/custo real quando disponivel.
- a tela ja permite informar `Workers paralelos` por lote.
- jobs agora registram telemetria dinamica: custo restante estimado, custo medio por
  capitulo, tempo medio por capitulo, ETA, retries, reparos, falhas, rate limits,
  workers efetivos e motivo da variacao da estimativa;
- o worker ajusta o paralelismo efetivo dentro do limite configurado quando detecta
  retries, rate limits ou falhas;
- a tela mostra uso real, restante/ETA e detalhes compactos por lote.

Indice atual:

```text
<storage_root>/translations/selection-history.json
```

Override por ambiente:

```text
OGHMA_TRANSLATION_SELECTION_HISTORY=C:\...\selection-history.json
```

Fluxo:

```text
usuario escolhe novel + range
-> seleciona Automatico / Escolher o melhor
-> Oghma calcula coverage e economias
-> escolhe amostra representativa
-> traduz amostra com 2-4 modelos
-> roda QA/grader automatico
-> atualiza score daquela novel
-> escolhe modelo para o lote completo
-> inicia job real
```

Amostra sugerida:

- capitulo 1;
- um capitulo inicial;
- um capitulo do meio;
- um capitulo tardio;
- capitulo com alta densidade de termos, se detectado.

Modelos iniciais candidatos:

```text
google/gemini-3-flash-preview
gpt-5.4-mini
gpt-4.1-mini
deepseek/deepseek-v4-pro
deepseek/deepseek-v4-flash # experimental ate passar gates
```

Regra: o modo Automatico nao deve interromper pedindo aprovacao humana durante a
traducao principal. Ele pode gerar sugestoes depois.

## Marco 4 - Glossario automatico e memoria da novel

Objetivo: manter consistencia sem exigir input manual.

Status: base inicial implementada em:

```text
backend/src/oghma/translation/memory.py
backend/src/oghma/translation/post_edit.py
GET /api/translations/memory
POST /api/translations/memory/terms
backend/src/oghma/translation/worker.py
apps/desktop/src/views/translation.tsx
```

O MVP atual extrai termos conhecidos de xianxia/cultivo e nomes proprios recorrentes,
persiste em indice JSON local e injeta termos enforced no `TranslationContext` do
worker antes do sampling automatico e da traducao final.

Indice atual:

```text
<storage_root>/translations/memory-index.json
```

Override por ambiente:

```text
OGHMA_TRANSLATION_MEMORY_INDEX=C:\...\memory-index.json
```

Status suportados pelo glossario enforced:

```text
approved
locked
approved_auto
locked_auto
```

Ainda falta refinamento por IA para descobrir conceitos menos obvios, consolidar
sinonimos e permitir edicao visual limpa pelo usuario.

Status adicional:

- o worker injeta memoria automatica no `TranslationContext` antes do sampling e
  antes da traducao final;
- a tela mostra um resumo dos termos automaticos da novel selecionada;
- `post_edit.py` ja possui replace seguro sem token para texto HTML, sem alterar
  tags/atributos e respeitando fronteiras de palavra.
- termos manuais agora sao persistidos na memoria da novel via
  `POST /api/translations/memory/terms`;
- o endpoint pode aplicar a correcao em traducoes existentes usando coverage e
  replace seguro, sem gastar token;
- o botao atual de adicionar termo na tela ja grava o termo manual na memoria.
- a memoria ja detecta conflitos deterministico sem custo de token:
  `same_source_different_target`, `same_target_different_source` e
  `near_duplicate_source`;
- a API ja expoe `GET /api/translations/memory/conflicts`;
- a tela de Traducao ja mostra a contagem e um resumo dos alertas do glossario.
- a API ja expoe sugestoes deterministicas em
  `GET /api/translations/memory/conflict-suggestions`;
- a API ja permite aplicar uma resolucao segura em
  `POST /api/translations/memory/conflicts/resolve`;
- a tela ja mostra sugestoes aplicaveis e permite travar o termo sugerido sem
  aplicar replace automatico nos HTMLs existentes.
- a tela ja possui controle explicito `Aplicar em traducoes existentes`; quando
  ativado, termos manuais e sugestoes de conflito chamam o post-edit seguro e
  mostram quantos arquivos foram alterados/ignorados.

Criar processo automatico:

```text
preflight de capitulos
-> extrair entidades/termos candidatos
-> normalizar nomes, ranks, tecnicas, lugares, objetos
-> classificar status: candidate, approved_auto, locked_auto
-> usar termos no prompt
-> atualizar memoria conforme capitulos sao traduzidos
-> detectar divergencias
-> reparar apenas segmentos afetados
```

O usuario pode revisar depois, mas nao precisa parar a traducao.

### Ajustes sem token

Quando o usuario mudar um termo depois da traducao:

- aplicar replace seguro quando for termo exato;
- usar regras para plural/genero/capitalizacao simples;
- chamar IA apenas para segmentos ambiguos.

Isso evita retraduzir obras inteiras.

## Marco 5 - Telemetria dinamica durante execucao

Objetivo: a estimativa deve melhorar enquanto o job roda.

Status: base inicial implementada no `TranslationJobStats`, worker e tela de
Traducao. O calculo usa os capitulos ja processados para recalcular custo restante,
tempo medio e ETA. O motivo exibido diferencia custo projetado maior/menor, retries,
rate limit e reparos automaticos.

Status concluido desta etapa:

- custo real, restante projetado, media por capitulo, ETA e motivo sao atualizados
  depois de cada capitulo;
- medias de tokens de entrada/saida e a razao output/input usam o usage real;
- retries e reparos possuem contagem e taxa percentual;
- custo por minuto e estabilidade do provider ficam disponiveis na API e na tela;
- callbacks do worker persistem cada snapshot de telemetria diretamente em
  `translation_job`.

Registrar em tempo real:

- custo real acumulado;
- custo estimado restante;
- tokens medios por capitulo;
- output/input ratio real;
- tempo medio por capitulo;
- ETA;
- taxa de reparo;
- taxa de retry/rate limit;
- capitulos reaproveitados;
- capitulos faltantes;
- economia obtida por coverage.

Exemplo de comportamento:

```text
Estimativa inicial: R$ 180, 9h
Apos 40 capitulos: R$ 245, 13h
Motivo: capitulos 34-40 tiveram output 38% maior e 2 reparos por capitulo.
```

No modo Automatico, o sistema pode:

- reduzir paralelismo em rate limit;
- aumentar paralelismo quando estavel;
- trocar estrategia para capitulos futuros se custo/latencia fugir muito;
- escalar capitulos problematicos para modelo melhor.

## Marco 6 - Workers paralelos com controle adaptativo

Objetivo: diminuir tempo sem destruir consistencia.

Status: base inicial implementada. O `worker_count` continua sendo o teto escolhido
pelo usuario, mas o worker efetivo reduz quando um lote tem retry, rate limit ou
falha, e volta a subir gradualmente em lotes estaveis.

O controle adaptativo tambem reduz o paralelismo quando a estabilidade observada do
provider cai abaixo de 90% ou quando o custo por minuto ultrapassa o limite opcional:

```text
OGHMA_TRANSLATION_MAX_COST_PER_MINUTE_USD=0.50
```

O aumento ocorre gradualmente, somente depois de dois lotes estaveis, e nunca passa
do `worker_count` configurado no job.

Nao usar threads soltas. Usar fila de workers:

```text
translation_job
-> chapter tasks
-> worker pool
-> save progress
-> update memory
-> repair queue
```

Perfis:

```text
seguro      1-2 workers
balanceado 3-5 workers
rapido      6-10 workers
agressivo   limitado por budget/rate limit
```

Cuidados:

- respeitar rate limits por provider;
- limitar custo por minuto;
- nao vazar eventos de capitulos futuros para capitulos anteriores;
- consolidar memoria por janelas;
- retomar job se o app/backend cair.

Estrutura sugerida:

```text
janela 1: capitulos 1-20 com paralelismo baixo
consolida glossario/book bible
janela 2: capitulos 21-60 com paralelismo medio
consolida memoria
janela 3: capitulos 61-100 ...
```

## Marco 7 - Pricing catalog dinamico

Objetivo: estimativas nao dependerem de valores hardcoded.

Status: implementado em:

```text
backend/src/oghma/translation/pricing.py
python -m oghma.cli translation-pricing-refresh --provider openrouter
GET  /api/translations/pricing
POST /api/translations/pricing/refresh
```

O pricing usa `translation_pricing_snapshot` como storage primario e mantem um
espelho local em:

```text
<storage_root>/translations/pricing-snapshot.json
```

Tambem aceita override:

```text
OGHMA_TRANSLATION_PRICING_INDEX=C:\...\pricing-snapshot.json
```

Nao ha mais tabela de precos hardcoded usada nas estimativas. Antes de estimar,
planejar automaticamente ou criar um job, a API garante snapshots frescos dos
modelos envolvidos. Se o catalogo oficial estiver indisponivel e nao houver preco
fresco, retorna erro explicito em vez de estimar custo zero.

Fontes implementadas:

- OpenRouter Models API, em JSON estruturado;
- pagina oficial de pricing da OpenAI;
- pagina oficial de pricing da Gemini Developer API;
- pagina oficial de pricing da DeepSeek.

Os parsers dos providers diretos usam a tabela Standard, guardam `source_url`,
`fetched_at` e `expires_at`, e foram validados contra as paginas oficiais reais em
2026-07-02. Para contabilizar um job ja iniciado, o ultimo snapshot conhecido pode
ser usado mesmo se expirar durante a execucao; novas estimativas exigem freshness.
Quando uma pagina direta deixa de listar um modelo antigo ainda suportado, o catalogo
aceita o alias equivalente e atualizado do OpenRouter, preferindo sempre a cotacao
direta quando ambas existem.

## Marco 8 - Persistencia robusta do MVP JSON

Objetivo: reduzir risco de corrupcao enquanto a migracao para tabelas nao acontece.

Status: base inicial implementada em:

```text
backend/src/oghma/translation/json_index.py
```

Os indices de jobs, coverage, memoria, historico de selecao e pricing agora usam
escrita atomica com lockfile. Isso ainda nao substitui banco transacional, mas torna
o MVP local mais resistente a concorrencia entre API e worker.

Status adicional:

- as tabelas de traducao ja estao registradas no metadata SQLAlchemy e serao criadas
  por `Base.metadata.create_all` em bancos novos:
  - `translation_job`;
  - `translation_chapter`;
  - `translation_memory_term`;
  - `translation_selection_history`;
  - `translation_pricing_snapshot`.

As APIs e os dois caminhos do worker (background da API e CLI) agora escrevem
prioritariamente nessas tabelas. JSON ficou como espelho de compatibilidade,
recuperacao local e importacao.

Status adicional de jobs:

- a API de jobs (`create/list/get/pause/resume/cancel/run`) ja usa
  `translation_job` como persistencia primaria quando ha sessao de banco;
- o indice JSON continua sendo mantido como espelho/fallback;
- cada atualizacao intermediaria do worker e persistida em `translation_job`, e nao
  apenas o resultado final.

Status adicional de coverage:

- a API de coverage ja faz merge DB + JSON usando `translation_chapter` como
  persistencia de longo prazo e JSON como fallback/importacao;
- a criacao de jobs usa esse merge para estimar reaproveitamento/economia;
- cada capitulo concluido e persistido imediatamente em `translation_chapter`;
- a sincronizacao final permanece como reconciliacao defensiva.

Status adicional de memoria:

- as rotas de memoria, conflitos e sugestoes agora fazem merge DB + JSON usando
  `translation_memory_term` como persistencia de longo prazo;
- termos manuais e resolucoes de conflito sao gravados em JSON e em
  `translation_memory_term`;
- ao fim da execucao em background, os termos automaticos gerados pelo worker sao
  sincronizados de volta para `translation_memory_term`.
- antes de executar, memoria existente somente no banco e reidratada no contexto do
  worker, preservando o glossario mesmo apos restauracao sem os JSONs.

Status adicional de selection history:

- `GET /api/translations/selection-history` ja faz merge DB + JSON usando
  `translation_selection_history`;
- ao fim de jobs automaticos, os registros de selecao gerados pelo worker sao
  sincronizados de volta para `translation_selection_history`;
- historico existente somente no banco volta a participar da escolha automatica;
- o JSON permanece apenas como espelho/fallback.

Status adicional de pricing:

- `GET /api/translations/pricing` faz merge DB + JSON, preferindo `fetched_at` mais
  recente;
- refreshes gravam banco e espelho;
- o CLI de refresh tambem persiste em `translation_pricing_snapshot`.

O fallback JSON agora protege todo o ciclo read-modify-write com lock, escrita
atomica e recuperacao de lock abandonado. Isso evita lost updates entre processos,
nao apenas arquivos parcialmente escritos.

Criar:

```text
translation_pricing_snapshot
provider
model
input_usd_per_1m
cached_input_usd_per_1m
output_usd_per_1m
source_url
fetched_at
expires_at
```

Prioridade:

1. OpenRouter Models API;
2. OpenAI pricing/docs;
3. Gemini direto;
4. DeepSeek direto;
5. erro explicito quando nenhum snapshot fresco puder ser obtido.

A UI deve mostrar:

```text
Preco consultado em 2026-07-02 23:10
```

Se o preco estiver antigo:

```text
Estimativa incerta: preco nao atualizado ha 48h
```

## Marco 9 - Analise real de livros locais

Objetivo: nao estimar novels locais por uma media fixa quando o catalogo nao consegue
associar o arquivo a uma novel conhecida.

Status implementado:

- downloads novos salvam `.oghma-book.json` com capitulos, caracteres, palavras e
  metricas por capitulo enquanto o bundle ja esta em memoria;
- a abertura da biblioteca somente le esse manifesto pequeno e nunca descompacta EPUBs;
- livros antigos nao sao varridos nem descompactados automaticamente;
- para obter as novas metricas, o livro deve ser baixado novamente;
- quando nao ha manifesto, a associacao com o catalogo ainda fornece a contagem conhecida;
- a tela envia ao planner os caracteres proporcionais ao range escolhido;
- custo e duracao usam volume real/equivalente, nao apenas quantidade de capitulos;
- o modo Automatico soma traducao completa e amostra comparativa. Antes, a tela
  mostrava apenas o custo da amostra.

Ainda falta um importador de EPUB/AZW3 para transformar livros locais sem `novel_id`
em capitulos executaveis pelo backend. A estimativa agora e coerente, mas um job real
continua exigindo capitulos registrados no storage de traducao.

## Ordem recomendada de implementacao

1. Coverage de traducoes existentes.
2. Job real de traducao com status/progresso.
3. Modo Automatico / Escolher o melhor.
4. Glossario automatico persistente.
5. Concluido: pricing em tabela real com espelho/importacao JSON.
6. Concluido: worker atualiza jobs e capitulos diretamente durante a execucao.
7. Expor refresh manual e freshness do pricing com mais destaque na UI.
8. Evoluir o limite global de custo/minuto para limites por provider/modelo.
9. Validar fluxo ponta a ponta com providers reais e ranges longos.
10. Adotar Alembic antes da primeira alteracao de coluna em producao.

## MVP pratico

Para uma primeira versao utilizavel:

1. `coverage` basico por novel/range.
2. `translation_job` simples, com `worker_count` controlado.
3. tela mostra progresso, custo real e reaproveitamento.
4. modo manual com modelos recomendados.
5. automatico roda amostra pequena e escolhe um modelo.

Depois disso, adicionar paralelismo e pricing online.
