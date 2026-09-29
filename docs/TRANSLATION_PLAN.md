# Plano de traducao de novels

## Objetivo

Criar uma feature de traducao EN -> pt-BR para novels longas, com foco principal em qualidade literaria, consistencia de termos e preservacao de sutilezas culturais. A primeira versao nao deve tentar ser apenas um "tradutor por capitulo". Para funcionar em obras com centenas ou milhares de capitulos, ela precisa se comportar como uma pequena editoria: manter glossario, memoria, entidades, estilo, revisoes e historico de decisoes.

O ponto central: a qualidade nao vem de colocar "mais capitulos anteriores" no prompt. Isso estoura contexto, encarece e ainda assim perde consistencia. A qualidade vem de memoria editorial persistente, recuperacao seletiva de contexto e validacao continua.

## Diagnostico do problema

Problemas observados em tradutores simples:

- o mesmo termo muda de traducao entre capitulos;
- nomes, titulos, tecnicas, reinos de cultivo e cargos aparecem ora em ingles, ora traduzidos;
- o modelo interpreta termos xianxia/wuxia de forma literal demais;
- nuances de confucionismo, taoismo, budismo, hierarquia familiar, honra, senioridade e etiqueta se perdem;
- o ingles de origem ja e uma traducao do mandarim, entao algumas ambiguidades ja chegam deformadas;
- a qualidade piora com o tamanho da obra porque a ferramenta nao tem memoria confiavel;
- rever um capitulo depois de traduzido nao atualiza os proximos capitulos nem registra decisoes.

## Decisao recomendada

Nao comecar com MCP como nucleo da feature.

MCP e util para expor ferramentas a agentes e para integrar servicos externos, mas o nucleo da traducao deve ser um pipeline proprio no backend `oghma.translation`. O backend ja tem Postgres, storage local, capitulos normalizados e jobs operacionais. Isso combina melhor com uma feature que precisa ser reexecutavel, versionavel, auditavel e integrada ao desktop.

Uso recomendado de MCP, mais tarde:

- MCP interno para depuracao e operacao assistida por agente: buscar glossario, ler capitulos, inspecionar memorias, comparar revisoes.
- MCP de terminologia, caso queiramos conectar fontes externas/dicionarios autorizados.
- MCP para um "translation editor agent" auxiliar, nao para a fila principal.

O primeiro MVP deve usar servicos Python diretos no backend. Depois podemos expor partes como MCP sem prender a arquitetura nele.

Tambem nao recomendo comecar por LangChain. Para esta feature, o valor esta em controle fino de contexto, retries, versoes, structured outputs, custos, caching e avaliacao. Um orquestrador proprio e mais previsivel.

## Principios de qualidade

1. Glossario e lei, nao sugestao.
   Termos aprovados precisam ser aplicados de forma deterministica e auditavel.

2. A memoria deve ser por obra.
   Cada novel tem seu proprio perfil editorial, lista de entidades, escolhas de estilo, termos travados e linha do tempo.

3. Traducao e revisao sao etapas separadas.
   Um modelo traduzir e validar a si mesmo em uma unica chamada tende a esconder erros.

4. O sistema deve saber dizer "incerto".
   Se uma expressao em ingles parece vir de um termo chines especifico, mas o original nao esta disponivel, a ferramenta deve registrar incerteza em vez de inventar uma etimologia.

5. A traducao principal nao pode depender de intervencao humana.
   O sistema deve tomar decisoes conservadoras, registrar incertezas e seguir. Intervencao humana entra como melhoria posterior, nao como portao no meio do job.

6. O usuario precisa ter alavancas editoriais depois da traducao.
   Para qualidade alta, precisamos permitir aprovar termos, corrigir escolhas e propagar decisoes para reprocessamentos futuros, mas isso nao deve bloquear a fila principal.

7. Tudo deve ser reprocessavel.
   Como o Oghma ja salva `raw_path` e `content_path`, a traducao deve ser derivada desses artefatos e poder ser refeita quando o glossario mudar.

## Arquitetura proposta

```text
content/*.html
  -> segmentador
  -> analise da obra
  -> glossario/entidades/memoria
  -> traducao por capitulo
  -> QA bilingue
  -> reparo segmentado
  -> finalizacao unattended
  -> armazenamento versionado
  -> export EPUB/PDF/TXT/Kindle
```

Componentes novos:

- `oghma.translation.segmenter`: transforma HTML limpo em segmentos estaveis.
- `oghma.translation.profile`: cria e atualiza o perfil editorial da obra.
- `oghma.translation.glossary`: extrai, aprova, trava e aplica termos.
- `oghma.translation.memory`: guarda traducoes anteriores e faz recuperacao por termo/embedding.
- `oghma.translation.engine`: chama o provedor de IA.
- `oghma.translation.qa`: valida fidelidade, consistencia, HTML e estilo.
- `oghma.translation.repair`: corrige apenas segmentos problematicos.
- `oghma.translation.jobs`: orquestra fila, progresso, retries e retomada.

## Fluxo detalhado

### 1. Preparacao da obra

Antes de traduzir centenas de capitulos, rodar uma etapa de leitura editorial:

- sinopse, titulo, tags, status e autor;
- primeiros 3 a 10 capitulos;
- alguns capitulos do meio, se ja estiverem baixados;
- lista de titulos de capitulos;
- amostra de paragrafos com alta densidade de termos proprios.

Saida esperada:

- tom da obra;
- publico-alvo e registro de linguagem;
- convencoes de nomes;
- politica para honorificos;
- termos candidatos;
- entidades principais;
- termos que devem ficar transliterados;
- termos que devem ser traduzidos;
- alertas de ambiguidade.

Esse resultado vira o `translation_profile` da novel.

### 2. Segmentacao estavel

Cada capitulo deve ser dividido em blocos com IDs estaveis:

```text
chapter_id = central-novel:obra#42
segment_id = central-novel:obra#42:p0007
source_html = <p>...</p>
source_text = ...
```

Regras:

- preservar ordem e tags semanticas permitidas;
- nao misturar paragrafos distantes;
- preservar falas, italicos, negrito, imagens e blockquotes;
- gerar hash por segmento;
- permitir retraduzir apenas segmentos alterados.

### 3. Extracao de termos e entidades

Antes da traducao de cada lote, extrair candidatos:

- nomes de personagens;
- aliases e titulos;
- seitas, clas, familias, reinos, cidades;
- tecnicas, habilidades, artes marciais, mantras;
- reinos de cultivo e estagios;
- artefatos, pilulas, bestas espirituais;
- honorificos e formas de tratamento;
- expressoes idiomaticas e conceitos filosoficos.

Cada termo deve ter estado:

- `candidate`: encontrado, ainda nao aprovado;
- `approved`: aprovado pelo sistema ou usuario;
- `locked`: nao pode variar sem revisao explicita;
- `deprecated`: substituido por outra escolha.

Exemplo de glossario:

```json
{
  "source": "Foundation Establishment",
  "target": "Estabelecimento de Fundacao",
  "category": "cultivation_realm",
  "status": "locked",
  "notes": "Usar como reino de cultivo, nao como construcao literal.",
  "firstSeenChapter": 12
}
```

### 4. Memoria de traducao

A memoria deve misturar busca exata e busca semantica:

- busca exata por termos travados;
- busca fuzzy por frases semelhantes;
- embeddings para recuperar segmentos parecidos;
- ultimas decisoes editoriais da novel;
- resumo dos capitulos anteriores;
- linha do tempo e relacoes de personagens.

Como o backend ja usa PostgreSQL, a primeira opcao e adicionar `pgvector` quando formos usar embeddings. Se isso complicar o deploy inicial, comecar com FTS/trigram + tabelas relacionais e deixar `pgvector` como fase 2.

### 5. Traducao do capitulo

Entrada recomendada para o modelo:

- instrucoes fixas de tradutor literario EN -> pt-BR;
- perfil editorial da novel;
- glossario locked/approved relevante;
- entidades mencionadas no capitulo;
- memoria recuperada por similaridade;
- resumo dos ultimos capitulos;
- segmentos do capitulo atual.

Saida:

- HTML traduzido preservando estrutura;
- sidecar JSON com avisos, termos novos, incertezas e decisoes propostas.

Para reduzir drift, o prompt deve dizer claramente:

- nunca trocar traducao de termo travado;
- manter nomes proprios como definidos;
- traduzir para pt-BR natural, nao literal;
- preservar o sentido do ingles, sem inventar detalhes do mandarim ausente;
- sinalizar ambiguidade cultural ou terminologica;
- manter notas de tradutor quando existirem no original, mas nao criar notas novas sem configuracao explicita.

### 6. QA bilingue

Depois da traducao, rodar uma revisao separada:

- fidelidade semantica;
- omissoes;
- acrescimos inventados;
- consistencia de glossario;
- tom literario;
- portugues brasileiro natural;
- pontuacao de dialogos;
- HTML quebrado;
- termos deixados em ingles sem justificativa;
- nomes proprios alterados.

O QA deve produzir structured output, por exemplo:

```json
{
  "passed": false,
  "issues": [
    {
      "segmentId": "central-novel:obra#42:p0007",
      "severity": "high",
      "type": "glossary_mismatch",
      "message": "Foundation Establishment foi traduzido diferente do glossario.",
      "expected": "Estabelecimento de Fundacao"
    }
  ]
}
```

### 7. Reparo segmentado

Se o QA encontrar problemas, nao retraduzir o capitulo inteiro. Corrigir os segmentos afetados com contexto minimo:

- segmento original;
- traducao atual;
- problema detectado;
- glossario relevante;
- estilo da obra.

Isso reduz regressao e custo.

### 8. Finalizacao unattended

O modo padrao deve traduzir sem perguntas no meio do processo.

Fluxo:

- se o capitulo passar nos validadores e no QA, salvar como `approved_auto`;
- se ainda houver issues apos retries/reparo, salvar a melhor versao como `draft_with_warnings`;
- registrar todas as incertezas e problemas para revisao posterior;
- continuar para o proximo capitulo sem esperar decisao humana.

So devem interromper a geracao de artefato final erros fatais:

- HTML irrecuperavel;
- resposta vazia do provedor;
- perda de segmentos apos retries;
- falha total de provider ou credenciais.

Issues de qualidade alta nao devem virar pergunta ao usuario durante o job. Elas devem acionar reparo automatico primeiro e, se persistirem, virar warning pos-traducao.

Depois do lote, o sistema pode agrupar warnings parecidos e sugerir melhorias globais:

- travar uma traducao de termo recorrente;
- substituir uma variante ruim por outra em capitulos afetados;
- ajustar regra de honorifico ou parentesco;
- reforcar uma instrucao de estilo;
- reprocessar apenas os segmentos impactados.

Esse ciclo melhora traducoes futuras sem transformar o usuario em gargalo da traducao principal.

### 9. Atualizacao da memoria

Ao concluir um capitulo:

- salvar traducao versionada;
- salvar memoria por segmento;
- atualizar resumo do capitulo;
- atualizar timeline;
- registrar termos novos como `candidate`;
- registrar decisoes automaticas com confianca;
- registrar pendencias para revisao posterior sem bloquear o job principal.

## Modelo de dados sugerido

Tabelas novas:

- `translation_project`
  - `id`, `novel_id`, `source_language`, `target_language`, `profile_name`, `status`, `style_guide`, `created_at`, `updated_at`.

- `translation_job`
  - `id`, `project_id`, `preset`, `chapter_from`, `chapter_to`, `status`, `progress`, `stats`, `error`, `started_at`, `finished_at`.

- `translation_chapter`
  - `id`, `project_id`, `chapter_id`, `source_hash`, `translated_path`, `revision`, `status`, `qa_score`, `issue_count`, `translated_at`.
  - status principais: `queued`, `translating`, `translated`, `approved_auto`, `draft_with_warnings`, `failed`.

- `translation_segment`
  - `id`, `translation_chapter_id`, `segment_key`, `source_text`, `translated_text`, `source_hash`, `target_hash`, `status`, `qa`.

- `translation_glossary_term`
  - `id`, `project_id`, `source_term`, `target_term`, `category`, `status`, `notes`, `first_chapter_id`, `last_seen_chapter_id`, `confidence`.

- `translation_entity`
  - `id`, `project_id`, `canonical_name`, `aliases`, `entity_type`, `gender`, `description`, `relationship_notes`, `status`.

- `translation_memory_entry`
  - `id`, `project_id`, `chapter_id`, `segment_id`, `source_text`, `target_text`, `embedding`, `terms`, `created_at`.

- `translation_issue`
  - `id`, `project_id`, `chapter_id`, `segment_id`, `severity`, `type`, `message`, `status`, `created_at`, `resolved_at`.

- `translation_eval_run`
  - `id`, `project_id`, `model`, `prompt_version`, `sample_set`, `scores`, `created_at`.

Storage:

```text
/srv/oghma/
  translations/
    <source>/<slug>/<target-lang>/<profile>/
      chapters/<number>.html
      chapters/<number>.json
      revisions/<number>/<revision>.html
      profile.json
      glossary.json
      issues.jsonl
```

## API planejada

Adicionar ao backend:

```text
POST   /api/translations/projects
GET    /api/novels/{novelId}/translation-profile
PATCH  /api/translations/projects/{projectId}/style
GET    /api/translations/projects/{projectId}/glossary
PATCH  /api/translations/projects/{projectId}/glossary/{termId}
POST   /api/translations/jobs
GET    /api/translations/jobs/{jobId}
GET    /api/translations/projects/{projectId}/chapters/{chapterId}
GET    /api/translations/projects/{projectId}/issues
POST   /api/translations/issues/{issueId}/resolve
```

O `POST /api/downloads` ja tem `translate: boolean`, mas isso e pouco para qualidade. A recomendacao e evoluir para projeto de traducao separado. Downloads/export devem escolher entre:

- original;
- traducao pt-BR `approved_auto`;
- traducao pt-BR `draft_with_warnings`, se o usuario permitir.

## Interface desktop

Fluxo recomendado:

1. Na Biblioteca, selecionar uma novel.
2. Acao `Traduzir`.
3. Modal com idioma alvo, perfil, modelo/provedor, faixa de capitulos e modo de qualidade.
4. Tela de progresso com capitulos, termos novos e issues.
5. Tela de melhorias pos-traducao:
   - original e traducao lado a lado;
   - glossario da obra;
   - termos candidatos;
   - issues de QA;
   - acao para aprovar/travar termos em reprocessamentos futuros.
6. Exportar EPUB/PDF/TXT usando a variante traduzida.

Modos de qualidade:

- `draft`: rapido, menos QA, bom para leitura pessoal imediata;
- `balanced`: traducao + QA + reparo;
- `editorial`: preparacao da obra + glossary lock + QA rigoroso + registro de ambiguidades.

Como o foco atual e qualidade, o primeiro modo realmente util deve ser `balanced`; `draft` pode vir depois como atalho.

## Xianxia, wuxia e termos culturais

Criar pacotes de dominio:

```text
translation/domain_packs/
  xianxia.yaml
  wuxia.yaml
  xuanhuan.yaml
  confucian_terms.yaml
  honorifics_kinship.yaml
```

Cada pacote deve conter:

- termos frequentes em ingles;
- traducao pt-BR recomendada;
- alternativas aceitaveis;
- notas de contexto;
- quando preservar transliteracao;
- quando traduzir;
- exemplos ruins a evitar.

Categorias importantes:

- reinos de cultivo;
- tecnicas e artes;
- titulos de seita;
- hierarquia familiar;
- senioridade;
- honorificos;
- conceitos filosoficos;
- expressoes idiomaticas;
- artefatos e alquimia;
- bestas, demonios, espiritos e imortais.

Politica recomendada:

- termos consagrados pelo genero podem ficar transliterados: `qi`, `dantian`, `dao`, `nascent soul` conforme decisao de glossario;
- termos que o leitor pt-BR espera traduzidos devem ser traduzidos: cargos, titulos, relacoes familiares e expressoes comuns;
- nomes proprios nao devem ser traduzidos sem decisao explicita;
- quando o ingles esta ambiguo, registrar nota interna de incerteza e manter uma traducao conservadora.

## Prompting e provedores

Para OpenAI, a documentacao atual recomenda usar a Responses API para casos com raciocinio, ferramentas e multi-turn, e o guia mais recente aponta GPT-5.5 como modelo atual para workflows complexos. A feature deve tratar o modelo como configuracao, nao como constante espalhada pelo codigo.

Recomendacao inicial:

- tradutor principal: modelo de alta qualidade configuravel, com `reasoning.effort` entre `medium` e `high` conforme evals;
- extracao de glossario/entidades: modelo menor quando os evals aceitarem;
- QA/editorial: modelo forte, possivelmente com mais reasoning;
- embeddings: usar modelo de embeddings para memoria semantica;
- batch: usar para lotes grandes que nao precisam voltar imediatamente.

Structured outputs devem ser usados para:

- glossario extraido;
- entidades;
- relatorios de QA;
- issues;
- resumos;
- decisoes propostas.

Nao usar structured output para forcar toda a prosa literaria se isso piorar estilo. Uma boa abordagem e traduzir segmentos em JSON apenas durante a fase interna, depois renderizar HTML preservando a estrutura.

Prompt caching deve ser considerado desde o inicio:

- instrucoes fixas primeiro;
- guia de estilo e termos locked depois;
- contexto dinamico por capitulo no fim;
- cache key por novel/perfil/modelo/prompt_version.

## Evals

O protocolo detalhado para comparar modelos, combinacoes de pipeline, capitulos
sequenciais e capitulos distantes esta em `docs/TRANSLATION_MODEL_EVALUATION.md`.
Ele deve ser executado antes de promover um modelo a padrao de producao.

Antes de traduzir uma obra enorme, montar um conjunto pequeno de avaliacao.

Samples por genero:

- 10 trechos com dialogo;
- 10 trechos com termos de cultivo;
- 10 trechos com combate;
- 10 trechos com exposicao filosofica/cultural;
- 10 trechos com humor, ironia ou linguagem emocional;
- 10 trechos longos com continuidade de personagens.

Metricas:

- aderencia ao glossario;
- fidelidade semantica;
- fluidez pt-BR;
- consistencia de nomes e pronomes;
- preservacao de HTML;
- taxa de omissao;
- taxa de termos em ingles sem justificativa;
- custo por 10k palavras;
- tempo por capitulo.

Gates minimos para seguir:

- 0 erros de HTML em capitulos aprovados;
- 100% de aderencia a termos `locked`;
- nenhum nome proprio alterado;
- issues `high` acionam repair/retry e removem o selo `approved_auto` se persistirem;
- regressao de glossario reprova nova versao de prompt/modelo.

## Plano de implementacao

### Fase 0 - Prova editorial offline

- Escolher 1 novel EN com termos xianxia ou fantasia densa.
- Separar 20 a 50 trechos representativos.
- Criar o primeiro `style_guide` e `domain_pack`.
- Rodar prompts manualmente ou script simples.
- Medir qualidade antes de mexer na UI.

Entregavel: `translation_eval_set` e decisao de prompt/modelo inicial.

### Fase 1 - Infra de traducao no backend

- Criar tabelas de projeto/job/capitulo/segmento/glossario.
- Criar storage `translations/`.
- Criar segmentador de HTML.
- Criar jobs com progresso e retomada.
- Criar endpoints basicos.

Entregavel: traduzir 1 capitulo e salvar variante versionada.

### Fase 2 - Glossario e perfil da obra

- Criar analise inicial da obra.
- Extrair termos candidatos.
- Implementar estados `candidate`, `approved`, `locked`, `deprecated`.
- Aplicar glossario no prompt e no QA.

Entregavel: traduzir 10 capitulos mantendo termos consistentes.

### Fase 3 - QA e reparo

- Criar QA bilingue com structured output.
- Criar reparo por segmento.
- Criar issues persistentes.
- Finalizar como `approved_auto` ou `draft_with_warnings` sem aguardar revisao humana.

Entregavel: pipeline `translate -> qa -> repair -> finalize`.

### Fase 4 - Memoria longa

- Salvar memoria por segmento.
- Adicionar recuperacao por termo/fuzzy.
- Adicionar embeddings/pgvector se necessario.
- Criar resumos por capitulo e "book bible" compactada a cada N capitulos.

Entregavel: traduzir 100+ capitulos sem drift significativo.

### Fase 5 - UI de revisao

- Tela de projeto de traducao.
- Progresso de jobs.
- Glossario editavel.
- Issues de QA.
- Preview original/traduzido.
- Export usando variante traduzida com status e warnings visiveis.

Entregavel: fluxo utilizavel no desktop.

### Fase 6 - Escala e custo

- Batch API para lotes grandes.
- Prompt caching.
- cache de embeddings.
- retries e rate limits por provedor.
- perfis `balanced` e `editorial`.
- comparacao entre provedores/modelos por eval.

Entregavel: traducao de obras longas com custo previsivel.

## Riscos e mitigacoes

| Risco | Mitigacao |
|---|---|
| Drift de termos ao longo de 1000 capitulos | glossario locked + QA deterministico + memoria por obra |
| Modelo inventar contexto chines ausente | regra explicita de nao inferir original inexistente + campo de incerteza |
| Traducao literal demais | guia de estilo pt-BR + evals de fluidez + QA editorial |
| Custo alto | batch, caching, modelo menor para extracao, repair segmentado |
| HTML quebrado | segmentador + validacao estrutural antes de salvar |
| Mudanca de glossario tarde demais | versionamento + reprocessamento por segmentos afetados |
| UI ficar complexa | comecar por job/progresso/glossario minimo, depois editor lado a lado |
| Dependencia de provedor unico | interface `TranslationProvider` e modelo configuravel |

## Base em pesquisa

As escolhas principais seguem achados recorrentes em pesquisa de traducao com LLMs:

- traduzir blocos literarios com contexto costuma ser melhor que traduzir frase isolada, mas ainda exige deteccao de erros criticos;
- document-level MT melhora quando o contexto e selecionado, resumido e relevante, nao quando o prompt recebe tudo sem criterio;
- consistencia terminologica precisa de restricoes explicitas, glossario e refinamento posterior;
- ciclos `translate -> estimate/qa -> refine/repair` melhoram qualidade e sao compativeis com traducao unattended;
- post-edicao automatica ajuda, mas precisa ser validada para evitar edits alucinados;
- avaliacao util precisa apontar erros por trecho/segmento, nao so uma nota global.

## Recomendacao final

Construir a feature como uma camada editorial persistente no backend, nao como chamada avulsa de LLM. A traducao deve ser uma variante versionada do capitulo, com glossario e memoria por obra. O primeiro sucesso nao e traduzir rapido; e traduzir 10 a 20 capitulos mantendo nomes, termos de cultivo, estilo e HTML sem regressao. Depois disso, escalar para 100, 500 e 1000 capitulos vira um problema de fila, custo e UX, nao de qualidade fundamental.

## Referencias tecnicas

- Literary/document-level translation with LLMs: https://arxiv.org/abs/2304.03245
- Context-Aware Prompting for document-level MT: https://arxiv.org/abs/2406.07081
- Terminology-Aware Translation with constrained decoding and LLM prompting: https://arxiv.org/abs/2310.05824
- TEaR self-refinement for MT: https://arxiv.org/abs/2402.16379
- GPT-4 automatic translation post-editing: https://arxiv.org/abs/2305.14878
- xCOMET fine-grained MT evaluation: https://arxiv.org/abs/2310.10482
- OpenAI latest model guide: https://developers.openai.com/api/docs/guides/latest-model
- OpenAI structured outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI embeddings: https://developers.openai.com/api/docs/guides/embeddings
- OpenAI prompt caching: https://developers.openai.com/api/docs/guides/prompt-caching
- OpenAI Batch API: https://developers.openai.com/api/docs/guides/batch
- OpenAI evals: https://developers.openai.com/api/docs/guides/evals
