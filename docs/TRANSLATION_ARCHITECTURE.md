# Arquitetura da ferramenta de traducao

Data: 2026-06-23

Base: `docs/TRANSLATION_PLAN.md`

## Objetivo

Definir a arquitetura tecnica para desenvolver a ferramenta de traducao EN -> pt-BR do Oghma, com foco inicial em qualidade editorial para novels longas. A traducao deve ser reprocessavel, versionada, auditavel e integrada ao backend/desktop existentes.

Esta doc transforma o plano conceitual em escolhas de tecnologia, modulos, dados, jobs, APIs e fases de implementacao.

## Decisao central

A ferramenta de traducao deve ser um subsistema do backend Python:

```text
backend/src/oghma/translation/
```

Nao deve nascer como um script solto, nem como um fluxo LangChain, nem como um MCP server principal. O nucleo precisa controlar armazenamento, versoes, memoria, retries, QA, exportacao e progresso. MCP pode vir depois como uma interface auxiliar para agentes inspecionarem e operarem a traducao.

## Leitura da pesquisa externa

Fontes oficiais, tecnicas e de pesquisa consultadas indicam algumas direcoes relevantes:

- OpenAI recomenda a Responses API para casos com raciocinio, ferramentas e multi-turn, e o guia atual aponta GPT-5.5 como modelo forte para workflows complexos. O mesmo guia recomenda ajustar `reasoning.effort`, usar structured outputs, prompt caching e evals em vez de tratar modelo novo como troca direta.
- Structured Outputs permite validar JSON por schema, o que combina com extracao de glossario, entidades, issues e relatorios de QA. Nao deve ser usado para engessar prosa literaria inteira se isso piorar estilo.
- Embeddings sao adequados para memoria semantica e recuperacao de segmentos parecidos.
- Prompt caching beneficia prompts com prefixos estaticos, entao o prompt deve colocar instrucoes, estilo e glossario estavel antes do contexto dinamico do capitulo.
- Batch API serve para traducao/revisao em lote quando o resultado nao precisa ser imediato.
- pgvector permite manter vetores no proprio Postgres, junto de dados relacionais, com busca exata ou aproximada.
- PostgreSQL `pg_trgm` ajuda na busca fuzzy de termos e frases, algo util para detectar variacoes de glossario.
- arq e uma opcao de fila async com Redis para quando o worker simples e Postgres nao forem suficientes.
- DeepL e Google Cloud Translation tem suporte a glossarios, mas devem ser vistos como provedores auxiliares/baseline, nao como nucleo de qualidade literaria.

Pesquisa em traducao com LLMs reforca pontos especificos do desenho:

- Traducao literaria melhora quando o modelo recebe contexto de paragrafo/documento, em vez de traduzir frase isolada; ainda assim, erros criticos persistem. Decisao: segmentar por blocos literarios estaveis e sempre rodar QA/reparo separado.
- Document-level MT com LLMs depende de selecao de contexto. Decisao: recuperar memoria relevante, resumos e entidades, em vez de jogar capitulos inteiros no prompt.
- Trabalhos de terminology-aware translation mostram que restricoes terminologicas e refinamento posterior aumentam aderencia a termos. Decisao: glossario `locked` + detector de mismatch + repair segmentado.
- Frameworks de self-refinement como Translate/Estimate/Refine apontam melhora quando a traducao recebe diagnostico de erro antes da revisao. Decisao: pipeline `translate -> qa -> repair -> finalize`.
- Pesquisas de automatic post-editing com GPT-4 mostram ganho de qualidade, mas tambem risco de edits alucinados. Decisao: reparar com fonte, traducao atual, issue e glossario, e validar estrutura depois.
- Avaliadores finos como xCOMET apontam valor em detectar spans/erros localizados, nao apenas uma nota global. Decisao: persistir `translation_issue` por segmento, severidade e tipo.

## Stack recomendada

| Camada | Escolha MVP | Evolucao provavel | Motivo |
|---|---|---|---|
| Backend | Python 3.11 async | manter | Alinhado ao backend atual. |
| API | FastAPI + Pydantic v2 | manter | Ja usado; bom contrato com desktop. |
| ORM | SQLAlchemy async | manter | Ja usado. |
| Migracoes | Alembic | obrigatorio antes das tabelas de traducao | O schema vai crescer e precisa migracao real. |
| Banco | PostgreSQL 16 | manter | Ja e fonte de verdade do acervo. |
| Busca lexical | FTS + `pg_trgm` | manter | Termos, titulos, frases parecidas, fuzzy matching. |
| Busca vetorial | fase 1 sem vetor, fase 2 `pgvector` | HNSW quando houver escala | Evita novo banco vetorial no inicio. |
| Storage | filesystem `/srv/oghma/translations` | S3/MinIO se virar multi-no | Ja existe padrao local. |
| Fila | worker CLI com Postgres lock | arq + Redis | Comecar simples; Redis so quando paralelismo justificar. |
| Provedor IA | OpenAI provider por interface | outros providers via adapter | Qualidade + structured outputs + embeddings + batch. |
| MT classico | nenhum no MVP | DeepL/Google como baseline opcional | Glossarios existem, mas qualidade literaria ainda precisa pipeline editorial. |
| UI | Tauri/React existente | editor lado a lado | Integrar na Biblioteca/Downloads. |
| MCP | nao no nucleo | MCP interno de operacao/debug | Bom para agentes, ruim como fila principal. |

## Arquitetura alvo

```text
Desktop
  -> BackendClient
    -> FastAPI /api/translations/*
      -> translation.jobs
        -> translation.segmenter
        -> translation.profile
        -> translation.glossary
        -> translation.memory
        -> translation.providers
        -> translation.qa
        -> translation.repair
        -> storage translations/
        -> Postgres translation_* tables
```

Fluxo de dados:

```text
chapter.content_path
  -> segmentacao estavel
  -> contexto editorial
  -> memoria lexical/semantica
  -> chamada LLM
  -> validacao de schema/HTML
  -> QA bilingue
  -> reparo segmentado
  -> salvar variante traduzida
  -> exportar EPUB/PDF/TXT/AZW3
```

## Modulos no backend

Estrutura proposta:

```text
backend/src/oghma/translation/
  __init__.py
  models.py              # modelos SQLAlchemy da traducao
  schemas.py             # DTOs/API e structured outputs internos
  routes.py              # FastAPI router /api/translations
  storage.py             # paths, leitura/escrita de variantes traduzidas
  segmenter.py           # HTML limpo -> segmentos estaveis
  profile.py             # perfil editorial/book bible
  glossary.py            # termos, estados, matching, aplicacao
  memory.py              # memoria lexical e semantica
  prompts.py             # templates versionados e builders
  providers/
    base.py              # TranslationProvider
    openai_provider.py
    deepl_provider.py    # futuro opcional
  qa.py                  # revisao bilingue e validadores
  repair.py              # reparo por segmento
  jobs.py                # orquestracao e retomada
  evals.py               # datasets, metricas, comparacao de prompts/modelos
  domain_packs/
    xianxia.yaml
    wuxia.yaml
    xuanhuan.yaml
    confucian_terms.yaml
    honorifics_kinship.yaml
```

## Modelo de dados

### Tabelas principais

`translation_project`

- um projeto por novel, idioma alvo e perfil editorial;
- guarda configuracoes, estilo, provider/modelo padrao e status.

Campos:

```text
id
novel_id
source_language
target_language
profile_name
status
quality_mode
provider
model
style_guide jsonb
domain_pack_ids varchar[]
created_at
updated_at
```

`translation_job`

- representa execucao de traducao/QA/reparo/export;
- deve ser retomavel.

Campos:

```text
id
project_id
job_type
preset
chapter_from
chapter_to
status
progress
stats jsonb
error
lease_owner
lease_until
started_at
finished_at
created_at
```

`job_type` principais:

```text
translate_range
repair_chapter
reprocess_segments
improvement_suggestions
export
```

`translation_chapter`

- variante traduzida de um capitulo original;
- cada traducao tem revisao e hash do original.

Campos:

```text
id
project_id
chapter_id
source_hash
translated_path
sidecar_path
revision
status
qa_score
issue_count
auto_approved
reviewed_at nullable
translated_at
updated_at
```

Status principais:

```text
queued
translating
translated
approved_auto
draft_with_warnings
failed
```

`translation_segment`

- unidade minima de traducao/reparo.

Campos:

```text
id
translation_chapter_id
segment_key
source_html
source_text
translated_html
translated_text
source_hash
target_hash
status
qa jsonb
created_at
updated_at
```

`translation_glossary_term`

- memoria terminologica por obra.

Campos:

```text
id
project_id
source_term
target_term
category
status
notes
variants varchar[]
forbidden_targets varchar[]
first_chapter_id
last_seen_chapter_id
confidence
created_by
updated_at
```

Estados:

```text
candidate
approved
locked
deprecated
rejected
```

`translation_entity`

- personagens, seitas, lugares, artefatos, titulos.

Campos:

```text
id
project_id
canonical_name
target_name
aliases varchar[]
entity_type
description
relationship_notes
status
first_chapter_id
last_seen_chapter_id
updated_at
```

`translation_memory_entry`

- segmentos aprovados para recuperacao.

Campos:

```text
id
project_id
chapter_id
segment_id
source_text
target_text
source_hash
target_hash
terms varchar[]
embedding vector(...) nullable
created_at
```

`translation_issue`

- problemas encontrados pelo QA ou pelo usuario.

Campos:

```text
id
project_id
chapter_id
segment_id
severity
issue_type
message
expected
actual
status
created_at
resolved_at
```

`translation_prompt_version`

- prompts precisam ser versionados para comparar qualidade.

Campos:

```text
id
name
provider
model_family
prompt_type
content_hash
body
schema jsonb
created_at
```

`translation_eval_run`

- comparacao de modelos/prompts em amostras fixas.

Campos:

```text
id
project_id nullable
sample_set
provider
model
prompt_version_id
scores jsonb
cost_estimate jsonb
created_at
```

### Indices recomendados

```text
translation_project(novel_id, target_language, profile_name)
translation_job(status, lease_until)
translation_chapter(project_id, chapter_id)
translation_segment(translation_chapter_id, segment_key)
translation_glossary_term(project_id, source_term)
translation_glossary_term(project_id, status)
translation_entity(project_id, canonical_name)
translation_issue(project_id, status, severity)
translation_memory_entry(project_id, chapter_id)
```

Para busca:

```text
GIN trigram em source_term, target_term, canonical_name
FTS em source_text/target_text se for util
pgvector HNSW em embedding na fase 2
```

## Storage

Layout:

```text
/srv/oghma/
  translations/
    <source>/<slug>/<target-lang>/<profile>/
      profile.json
      glossary.json
      chapters/
        000001.html
        000001.json
      revisions/
        000001/
          r0001.html
          r0001.json
          r0002.html
      evals/
        samples.jsonl
        runs/
      logs/
        job-<id>.jsonl
```

`chapters/<n>.html` contem a variante atual.

`chapters/<n>.json` contem sidecar:

```json
{
  "projectId": "uuid",
  "chapterId": "central-novel:obra#1",
  "sourceHash": "sha256",
  "revision": 2,
  "provider": "openai",
  "model": "gpt-5.5",
  "promptVersion": "translator-v1",
  "qa": {
    "passed": true,
    "score": 0.93
  },
  "termsUsed": [],
  "issues": []
}
```

## Segmentacao

O segmentador deve transformar o HTML limpo existente em blocos estaveis:

```text
p0001
p0002
blockquote0001:p0001
img0001
hr0001
```

Regras:

- preservar tags permitidas: `p`, `em`, `strong`, `img`, `blockquote`, `hr`;
- nao traduzir atributos de imagem;
- preservar ordem;
- gerar hash por segmento;
- manter o HTML fonte e o texto fonte;
- permitir que reparo substitua apenas um segmento.

Saida interna:

```json
{
  "chapterId": "central-novel:obra#1",
  "segments": [
    {
      "key": "p0001",
      "html": "<p>...</p>",
      "text": "...",
      "hash": "sha256"
    }
  ]
}
```

## Pipeline de traducao

### 1. PrepareProject

Cria/atualiza:

- `translation_project`;
- style guide inicial;
- domain packs aplicaveis;
- glossario vazio ou importado;
- prompt versions iniciais.

### 2. BuildBookBible

Analisa:

- sinopse;
- titulo;
- tags;
- primeiros capitulos;
- capitulos amostrados;
- titulos de capitulos.

Produz:

- estilo;
- convencoes de nomes;
- termos candidatos;
- entidades principais;
- regras de honorificos;
- notas de incerteza.

### 3. SegmentChapter

Le `chapter.content_path`, gera segmentos e hashes. Se o hash nao mudou e ja existe traducao `approved_auto`, pula.

### 4. ExtractTerms

Extrai candidatos por capitulo e cruza com glossario existente.

Structured output:

```json
{
  "terms": [
    {
      "source": "Foundation Establishment",
      "suggestedTarget": "Estabelecimento de Fundacao",
      "category": "cultivation_realm",
      "confidence": 0.86,
      "reason": "Realm/stage term, not literal construction."
    }
  ],
  "entities": []
}
```

### 5. RetrieveContext

Monta contexto curto e relevante:

- termos `locked` e `approved` citados no capitulo;
- entidades citadas;
- ultimos resumos;
- segmentos parecidos por FTS/trigram;
- segmentos parecidos por embedding quando `pgvector` estiver ativo;
- notas de estilo.

Ordem de prioridade:

1. termos locked;
2. entidades;
3. memoria exata/fuzzy;
4. memoria semantica;
5. resumo narrativo.

### 6. TranslateChapter

Chamada principal de traducao. Deve ser deterministica o bastante para aderir ao glossario, mas nao tao restritiva que mate o estilo.

Saida recomendada:

```json
{
  "segments": [
    {
      "segmentKey": "p0001",
      "translatedHtml": "<p>...</p>",
      "notes": []
    }
  ],
  "newTermCandidates": [],
  "uncertainties": []
}
```

### 7. ValidateStructure

Validador local antes de QA LLM:

- todos os `segmentKey` retornaram;
- nenhuma tag proibida entrou;
- tags permitidas continuam balanceadas;
- imagens/hrs preservados;
- texto nao esta vazio;
- nomes locked nao foram alterados quando deveriam permanecer.

### 8. BilingualQA

Revisao separada:

- compara original e traducao;
- detecta omissoes/acrescimos;
- confere glossario;
- confere nomes e entidades;
- avalia pt-BR natural;
- gera `translation_issue`.

### 9. RepairSegments

Corrige apenas segmentos problematicos, usando:

- original;
- traducao atual;
- issue;
- glossario relevante;
- estilo.

### 10. FinalizeUnattended

O job principal nao espera intervencao humana.

Se nao houver issues graves:

- salva HTML final;
- atualiza memoria;
- atualiza resumo;
- marca capitulo como `translated`;
- marca como `approved_auto` se passar todos os gates.

Se ainda houver issues graves apos retries/reparo:

- salva a melhor versao disponivel;
- marca como `draft_with_warnings`;
- registra issues para revisao posterior;
- continua para o proximo capitulo.

Excecoes fatais que nao devem gerar arquivo final:

- HTML irrecuperavel;
- falha total do provider ou credenciais;
- resposta vazia;
- perda de segmentos apos retries.

### 11. PostTranslationImprovementLoop

Depois que o lote terminar, o sistema pode transformar issues e incertezas em sugestoes de melhoria:

- consolidar termos candidatos repetidos;
- propor `locked` terms para a proxima execucao;
- detectar variacoes de uma mesma traducao;
- sugerir ajustes de estilo;
- criar job de reprocessamento apenas para capitulos/segmentos afetados.

Esse loop e opcional e pos-traducao. Ele atualiza glossario, memoria, prompts e capitulos reprocessados, mas nao bloqueia o job principal.

## Provider interface

Interface recomendada:

```python
class TranslationProvider(Protocol):
    id: str

    async def translate_segments(self, request: TranslateRequest) -> TranslateResult:
        ...

    async def extract_terms(self, request: TermExtractionRequest) -> TermExtractionResult:
        ...

    async def qa_chapter(self, request: QARequest) -> QAResult:
        ...

    async def repair_segments(self, request: RepairRequest) -> RepairResult:
        ...

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        ...
```

### OpenAIProvider

Responsabilidades:

- usar Responses API para tarefas com raciocinio/contexto;
- usar structured outputs para JSON validavel;
- expor configuracao de `reasoning.effort` por etapa;
- usar prompt caching por design de prompt;
- usar embeddings para memoria semantica;
- no futuro, usar Batch API para lotes grandes.

Configuracao:

```text
OGHMA_TRANSLATION_PROVIDER=openai
OGHMA_OPENAI_API_KEY=...
OGHMA_TRANSLATION_MODEL=gpt-5.5
OGHMA_TRANSLATION_QA_MODEL=gpt-5.5
OGHMA_TRANSLATION_EMBEDDING_MODEL=text-embedding-3-large
OGHMA_TRANSLATION_REASONING=medium
OGHMA_TRANSLATION_HUMAN_GATE=false
OGHMA_TRANSLATION_UNRESOLVED_POLICY=draft_with_warnings
OGHMA_TRANSLATION_MAX_REPAIR_ATTEMPTS=2
```

### DeepLProvider opcional

Uso possivel:

- baseline rapido;
- comparacao em evals;
- traducao bruta de trechos simples;
- provider opcional quando o usuario quiser custo/velocidade.

Limite:

- glossarios ajudam, mas nao substituem memoria narrativa, entidades, QA e book bible.

### GoogleTranslationProvider opcional

Uso semelhante ao DeepL: baseline e comparacao. Nao entra no MVP se atrasar a arquitetura principal.

## Prompts

Cada prompt deve ter:

- nome;
- versao;
- tipo (`profile`, `term_extraction`, `translate`, `qa`, `repair`, `summary`);
- provider/modelo alvo;
- schema esperado quando houver structured output;
- fixtures/evals associados.

Regras:

- instrucoes fixas primeiro;
- guia de estilo e glossario locked depois;
- contexto recuperado depois;
- capitulo/segmentos por ultimo;
- usar `prompt_cache_key` por `project_id + prompt_version + provider + model`;
- nao depender de contexto conversacional invisivel para traduzir capitulos;
- registrar `prompt_version_id` no sidecar da traducao.

## Memoria

### Fase 1: memoria lexical sem vetores

Usar Postgres:

- termos locked/approved;
- entidades;
- resumos;
- FTS para busca textual;
- `pg_trgm` para fuzzy matching de termos e frases.

### Fase 2: memoria semantica com pgvector

Adicionar:

- `embedding vector(N)` em `translation_memory_entry`;
- embeddings por segmento aprovado;
- HNSW quando houver volume suficiente;
- filtros por `project_id`, `chapter_id`, `terms`.

Motivo para pgvector:

- evita operar Qdrant/Weaviate/Milvus no inicio;
- mantem consistencia transacional com os dados editoriais;
- permite JOINs e filtros por obra/capitulo/status.

## Jobs e concorrencia

### MVP: Postgres worker

Criar comando:

```text
oghma translate-worker
```

E comandos auxiliares:

```text
oghma translate-plan --novel-id ... --target pt-BR
oghma translate-run --project-id ... --from 1 --to 10
oghma translate-eval --sample-set ...
```

O worker:

- pega jobs `queued`;
- define `lease_owner` e `lease_until`;
- atualiza heartbeat em `translation_job.stats`;
- salva progresso por capitulo;
- e idempotente;
- pode retomar se cair.

Para evitar concorrencia indevida:

- um job por project/range em execucao;
- capitulo travado durante traducao;
- reparo pode rodar em paralelo por segmento apenas depois.

### Fase 2: arq + Redis

Entrar quando:

- houver multiplos workers;
- precisarmos de agendamento/retries mais robustos;
- jobs demorarem demais para processo unico;
- quisermos separar API e worker em containers diferentes.

Mesmo com arq, Postgres continua fonte de verdade do status. Redis vira fila, nao banco principal.

## API backend

Endpoints recomendados:

```text
POST   /api/translations/projects
GET    /api/translations/projects/{projectId}
PATCH  /api/translations/projects/{projectId}

GET    /api/novels/{novelId}/translation-projects
POST   /api/novels/{novelId}/translation-projects

GET    /api/translations/projects/{projectId}/profile
PATCH  /api/translations/projects/{projectId}/profile

GET    /api/translations/projects/{projectId}/glossary
POST   /api/translations/projects/{projectId}/glossary
PATCH  /api/translations/projects/{projectId}/glossary/{termId}

GET    /api/translations/projects/{projectId}/entities
PATCH  /api/translations/projects/{projectId}/entities/{entityId}

POST   /api/translations/jobs
GET    /api/translations/jobs/{jobId}
GET    /api/translations/jobs?projectId=&status=
POST   /api/translations/jobs/{jobId}/cancel

GET    /api/translations/projects/{projectId}/chapters
GET    /api/translations/projects/{projectId}/chapters/{chapterId}

GET    /api/translations/projects/{projectId}/issues
PATCH  /api/translations/issues/{issueId}

POST   /api/translations/projects/{projectId}/evals
GET    /api/translations/projects/{projectId}/evals
```

DTOs importantes:

```text
TranslationProjectOut
TranslationJobOut
TranslationGlossaryTermOut
TranslationEntityOut
TranslationChapterOut
TranslationIssueOut
TranslationEvalRunOut
```

## Desktop

Integracao por fases:

### Fase UI 1: controle basico

Na Biblioteca:

- acao `Traduzir`;
- modal para criar projeto;
- escolher idioma alvo, range e modo de qualidade;
- iniciar job;
- ver progresso.

### Fase UI 2: melhorias pos-traducao

- lista de termos candidatos;
- aprovar/travar/rejeitar termos para proximas execucoes;
- lista de issues;
- abrir preview traduzido;
- reprocessar capitulos afetados por mudancas de glossario.

### Fase UI 3: editor opcional pos-traducao

- original e traducao lado a lado;
- filtro por issue;
- editar segmento;
- aplicar termo no glossario;
- retraduzir segmento/capitulo;
- marcar capitulo como revisado.

## Evals

Evals sao parte do produto, nao apenas teste de desenvolvimento.

Criar:

```text
backend/tests/translation_eval_sets/
  xianxia_smoke.jsonl
  dialogue_smoke.jsonl
  glossary_regression.jsonl
```

Metricas:

- `locked_glossary_accuracy`;
- `proper_name_preservation`;
- `html_validity`;
- `omission_rate`;
- `hallucination_rate`;
- `ptbr_fluency_score`;
- `style_consistency_score`;
- `cost_per_10k_words`;
- `seconds_per_10k_words`.

Gates:

- termo `locked` errado aciona repair/retry e remove `approved_auto` se persistir;
- HTML invalido aciona repair/retry e vira falha fatal se persistir;
- nomes proprios alterados acionam repair/retry e removem `approved_auto` se persistirem;
- omissao grave gera `draft_with_warnings` e fila de melhoria se persistir apos reparo;
- prompt/modelo novo so substitui anterior se ganhar ou empatar qualidade com custo aceitavel.

## Testes automatizados

Unidade:

- segmentador;
- renderizador de HTML;
- matching de glossario;
- validacao de structured outputs;
- storage de variantes;
- lease de jobs.

Integracao:

- traduzir capitulo fixture com provider fake;
- QA gera issue e repair corrige;
- job retoma apos interrupcao;
- export usa traducao `approved_auto` ou `draft_with_warnings` conforme configuracao.

Snapshot:

- fixture EN -> pt-BR para trechos pequenos;
- regressao de termos locked.

Provider:

- testes offline com fixtures;
- testes reais manuais/opt-in, nunca na suite default.

## Operacao

Variaveis:

```text
OGHMA_TRANSLATION_ENABLED=false
OGHMA_TRANSLATION_PROVIDER=openai
OGHMA_OPENAI_API_KEY=
OGHMA_TRANSLATION_MODEL=gpt-5.5
OGHMA_TRANSLATION_QA_MODEL=gpt-5.5
OGHMA_TRANSLATION_EMBEDDING_MODEL=text-embedding-3-large
OGHMA_TRANSLATION_MAX_CONCURRENCY=1
OGHMA_TRANSLATION_HUMAN_GATE=false
OGHMA_TRANSLATION_UNRESOLVED_POLICY=draft_with_warnings
OGHMA_TRANSLATION_MAX_REPAIR_ATTEMPTS=2
OGHMA_TRANSLATION_DAILY_BUDGET_USD=
OGHMA_TRANSLATION_STORAGE_ROOT=/srv/oghma/translations
```

Monitor:

- adicionar traducao ao `/monitor`;
- mostrar jobs ativos;
- progresso por capitulo;
- issues e warnings por severidade;
- custo estimado;
- ultimo heartbeat.

Logs:

- um JSONL por job;
- logar ids, capitulos, provider/modelo, tokens/custo estimado;
- nunca logar API key;
- nao logar conteudo integral em logs de aplicacao, apenas no storage controlado.

## Seguranca e privacidade

- API keys so em `.env` do servidor.
- Traducao envia conteudo de capitulos ao provedor; precisa ficar explicito nas configuracoes.
- Suportar `provider=local` no futuro para quem nao quiser enviar texto externo.
- Registrar provider/modelo usado em cada traducao.
- Permitir apagar projeto de traducao e artefatos derivados.

## Decisoes para agora

1. Criar Alembic antes de adicionar as tabelas de traducao.
2. Criar `oghma.translation` com provider fake primeiro.
3. Implementar segmentador e storage antes de chamar IA.
4. Criar projeto/job/capitulo/segmento/glossario com SQLAlchemy.
5. Implementar worker simples com Postgres lease.
6. Implementar OpenAIProvider apos provider fake passar no pipeline.
7. Criar eval set pequeno antes de traduzir obra grande.
8. Adiar pgvector ate a memoria lexical nao bastar.
9. Adiar arq/Redis ate termos necessidade real de paralelismo.
10. Adiar MCP ate o pipeline estar utilizavel via API/CLI.

## Roadmap

### Marco 1: traducao fixture offline

Aceite:

- `segmenter` converte HTML limpo em segmentos;
- provider fake traduz segmentos;
- HTML final e salvo em `translations/`;
- testes unitarios passam.

### Marco 2: job real no backend

Aceite:

- criar projeto via CLI/API;
- enfileirar range 1..1;
- worker processa;
- progresso aparece no job;
- capitulo traduzido fica recuperavel via API.

### Marco 3: glossario minimo

Aceite:

- termos candidatos sao extraidos;
- usuario/sistema pode marcar `locked`;
- traducao usa termos locked;
- QA detecta mismatch.

### Marco 4: OpenAIProvider

Aceite:

- traducao real de 1 capitulo;
- structured output validado;
- QA separado;
- repair segmentado;
- custo/tokens registrados.

### Marco 5: 10 capitulos balanced

Aceite:

- mesma obra, 10 capitulos;
- nenhum termo locked varia;
- HTML valido;
- issues high acionam repair/retry e, se persistirem, geram `draft_with_warnings`;
- export EPUB consegue usar variante traduzida.

### Marco 6: memoria longa

Aceite:

- resumos por capitulo;
- memoria por segmento;
- busca fuzzy;
- pgvector se necessario;
- 100 capitulos sem drift material nos termos monitorados.

## Referencias consultadas

- Literary/document-level translation with LLMs: https://arxiv.org/abs/2304.03245
- Document-Level Machine Translation with Large Language Models: https://arxiv.org/abs/2304.02210
- Context-Aware Prompting for document-level MT: https://arxiv.org/abs/2406.07081
- Multilingual Contextualization for document-level MT: https://arxiv.org/abs/2504.12140
- Terminology-Aware Translation with constrained decoding and LLM prompting: https://arxiv.org/abs/2310.05824
- TEaR self-refinement for MT: https://arxiv.org/abs/2402.16379
- GPT-4 automatic translation post-editing: https://arxiv.org/abs/2305.14878
- xCOMET fine-grained MT evaluation: https://arxiv.org/abs/2310.10482
- OpenAI latest model guide: https://developers.openai.com/api/docs/guides/latest-model
- OpenAI Responses API migration/state: https://developers.openai.com/api/docs/guides/migrate-to-responses
- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI Embeddings: https://developers.openai.com/api/docs/guides/embeddings
- OpenAI Prompt Caching: https://developers.openai.com/api/docs/guides/prompt-caching
- OpenAI Batch API: https://developers.openai.com/api/docs/guides/batch
- OpenAI Evals: https://developers.openai.com/api/docs/guides/evals
- OpenAI MCP and connectors: https://developers.openai.com/api/docs/guides/tools-connectors-mcp
- pgvector: https://github.com/pgvector/pgvector
- PostgreSQL Full Text Search: https://www.postgresql.org/docs/current/textsearch.html
- PostgreSQL pg_trgm: https://www.postgresql.org/docs/current/pgtrgm.html
- Alembic: https://alembic.sqlalchemy.org/en/latest/
- arq: https://arq-docs.helpmanual.io/
- DeepL glossaries: https://developers.deepl.com/api-reference/multilingual-glossaries
- Google Cloud Translation glossaries: https://docs.cloud.google.com/translate/docs/advanced/glossary
