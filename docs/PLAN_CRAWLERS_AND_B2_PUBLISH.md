# Plano: crawlers incrementais e publish no B2

Data da analise: 2026-06-19

## Objetivo

Planejar as proximas correcoes sem alterar agora os containers, o banco ou o
fluxo de publish. O foco e:

1. confirmar o alcance da politica de capas com validade de 180 dias;
2. entender se o publish no B2 cria containers ou arquivos muito grandes;
3. definir quais otimizacoes de crawl sao globais e quais sao exclusivas do
   Sky Demon Order;
4. tornar o publish isolado, observavel, retomavel e com consumo limitado.

## Conclusoes da analise

### 1. Politica de capas por 180 dias

A politica foi implementada no orquestrador comum, nao no conector do Sky
Demon Order. Portanto, ela vale para Central Novel, House Saikai, Novel Mania
e Sky Demon Order quando cada fonte rodar com uma imagem nova do crawler.

Comportamento atual planejado pelo codigo:

- capa ausente ou arquivo local ausente: baixa novamente;
- URL da capa mudou: baixa novamente;
- ultima verificacao tem 180 dias ou mais: baixa novamente;
- arquivo existe, URL nao mudou e ainda nao completou 180 dias: nao acessa o
  CDN da capa;
- para registros antigos sem `cover_checked_at`, o `mtime` do arquivo local e
  usado como referencia inicial.

Situacao dos containers no momento da analise:

- Sky Demon Order foi reiniciado com a imagem nova e ja usa a politica;
- Central Novel e House Saikai continuam nos containers antigos, conforme
  solicitado, e so usarao a politica na proxima execucao;
- Novel Mania ja havia terminado e usara a politica no proximo crawl.

Melhoria futura recomendada: trocar o valor em `novel.extra.cover_checked_at`
por uma coluna explicita `cover_checked_at`. Isso facilita consultas,
monitoramento e futuras migracoes, mas nao e necessario para o funcionamento
atual.

### 2. O publish no B2 nao cria um container novo

O botao do monitor chama `POST /api/publish/run`. O FastAPI agenda
`publish_jobs.run_publish()` como `BackgroundTask`, dentro do processo e do
container ja existente da API (`oghma-api-1`).

Nao existe `docker compose run`, criacao de container ou montagem temporaria
por clique no botao.

Os arquivos sao criados em:

```text
/srv/oghma/publish
```

Esse caminho e um volume montado a partir do armazenamento do host. Portanto,
os bundles nao aumentam a camada gravavel do container da API e nao explicam
o crescimento do `/var`.

O `/var` cheio foi associado principalmente a imagens/cache do Docker e ao
containerd do MicroK8s. O publish pode ter aumentado a carga de CPU, memoria e
I/O no mesmo periodo, mas nao ha evidencia de que tenha criado um container
gigante ou sido, sozinho, a causa do reboot.

### 3. Problemas reais do publish atual

Apesar de nao criar container, o desenho atual pode pressionar o servidor:

- `read_source()` carrega todas as novels e todos os metadados de capitulos de
  uma fonte na memoria;
- o publish de `source=all` processa as fontes em sequencia, mas cada fonte
  grande ainda pode conter dezenas de milhares de capitulos em memoria;
- todos os bundles alterados sao construidos antes de iniciar os uploads;
- os bundles locais permanecem em `/srv/oghma/publish` depois do envio;
- quatro uploads podem ocorrer em paralelo, ao mesmo tempo em que crawlers e
  Postgres usam o servidor;
- o job e o lock existem somente na memoria da API;
- reiniciar a API perde o status do job;
- uma falha antes de salvar `publish_state.json` faz a proxima tentativa
  reconstruir novamente os bundles ainda nao consolidados;
- o monitor nao mostra bytes processados, velocidade, memoria, espaco
  temporario ou ETA.

O maior risco nao e o tamanho de um container. E a combinacao de memoria da
API, compressao, leitura intensa do HDD e varios uploads simultaneos.

### 4. Alcance das otimizacoes dos crawlers

As mudancas se dividem em duas categorias.

Globais, disponiveis para todas as fontes em imagens novas:

- validade de capa por 180 dias;
- download imediato quando a URL da capa muda;
- metricas `covers_skipped` e `covers_refreshed`;
- etapas de monitor mais precisas para listagem e verificacao de capitulos;
- suporte opcional do orquestrador a uma listagem incremental.

Exclusivas do Sky Demon Order:

- leitura do total geral de capitulos exibido na pagina da novel;
- atalho quando o banco ja possui todos os capitulos publicados;
- inicio da verificacao pelo ultimo capitulo gratuito salvo;
- caminhada apenas pelos novos links `NEXT`, ate encontrar o paywall;
- varredura completa somente em primeiro crawl, fallback ou `--refresh`.

Central Novel, House Saikai e Novel Mania nao receberam uma nova estrategia de
capitulos, pois seus mecanismos atuais ja listam e pulam capitulos rapidamente.
Aplicar o algoritmo do Sky nessas fontes sem necessidade aumentaria o risco sem
ganho relevante.

## Arquitetura recomendada para o publish

### Fase 1 - Medir antes de redesenhar

Executar um publish completo instrumentado e registrar:

- RSS e CPU do container da API;
- uso de `/var` e `/srv` antes, durante e depois;
- quantidade e tamanho total dos bundles alterados;
- tempo de leitura do banco, build, upload e finalizacao;
- quantidade maxima de arquivos temporarios simultaneos;
- latencia de `/health` e `/monitor` durante o job;
- impacto nos heartbeats dos crawlers.

Essa medicao deve confirmar quanto da lentidao vem de memoria, compressao,
HDD ou rede para o B2.

### Fase 2 - Separar o publish da API

Criar um servico `publisher` dedicado no Compose. A API nao deve receber o
socket do Docker nem criar containers sob demanda.

Fluxo recomendado:

```text
Monitor -> API cria publish_job no Postgres -> publisher busca o job
        -> build/upload incremental -> publisher atualiza progresso
        -> API apenas consulta e exibe o status
```

Criar uma tabela `publish_job` com, no minimo:

- `id`, `source_id` e `status`;
- `created_at`, `started_at`, `finished_at` e `heartbeat_at`;
- `phase`, `current_source` e `current_novel`;
- `novels_total`, `novels_done` e `bundles_changed`;
- `bytes_total`, `bytes_uploaded` e `upload_items`;
- `error` e resumo final.

O lock deve ser persistente no Postgres, de preferencia com advisory lock ou
uma restricao que permita apenas um job ativo. Assim, reiniciar a API nao
libera um segundo publish acidentalmente.

### Fase 3 - Processar uma novel por vez

Alterar o runner para nao materializar a fonte inteira em memoria.

Para cada novel:

1. ler somente seus metadados e capitulos;
2. calcular o hash incremental;
3. pular se nao mudou;
4. construir um bundle temporario;
5. enviar o bundle ao B2;
6. validar tamanho/hash;
7. remover o arquivo temporario local;
8. salvar checkpoint do job;
9. seguir para a proxima novel.

Os objetos enviados ainda nao serao visiveis aos clientes, pois `catalog` e
`index.json` continuarao sendo publicados por ultimo. Isso preserva a
atomicidade atual sem manter todos os bundles no disco local.

Usar uma fila com backpressure:

- um produtor de bundles;
- no maximo dois bundles aguardando upload;
- dois uploads simultaneos como valor inicial;
- limite configuravel, com teto conservador;
- build de apenas uma novel por vez para evitar disputa no HDD.

O valor atual de quatro uploads deve ser mantido apenas se as metricas
mostrarem que nao prejudica os crawlers ou a API.

### Fase 4 - Upload robusto e retomavel

Substituir `put_object` por `upload_file` com `TransferConfig` para bundles
grandes. Isso oferece multipart upload, retries e limites de concorrencia mais
adequados.

Persistir checkpoints por bundle:

- hash e versao planejada;
- caminho/chave no B2;
- status `pending`, `uploaded` ou `failed`;
- bytes e tentativas;
- confirmacao do objeto remoto.

Ao reiniciar o worker, bundles confirmados devem ser pulados. O
`publish_state.json` definitivo e o `index.json` continuam sendo atualizados
somente quando todo o job terminar com sucesso.

### Fase 5 - Temporarios e retencao

Usar um diretorio por job:

```text
/srv/oghma/publish/tmp/<job-id>/
```

Politica recomendada:

- apagar cada bundle temporario depois do upload confirmado;
- apagar diretorios de jobs concluidos;
- manter temporarios de jobs com erro por ate sete dias para diagnostico;
- remover catalogos locais antigos, mantendo apenas o mais recente de cada
  fonte;
- configurar lifecycle no B2 para versoes antigas, se elas nao precisarem ser
  mantidas indefinidamente.

### Fase 6 - Isolamento de recursos

Configurar limites para o servico `publisher`:

- memoria maxima definida depois do benchmark;
- limite de CPU;
- prioridade de I/O reduzida quando possivel;
- concorrencia global, nao uma concorrencia independente por fonte;
- opcao de aguardar crawlers terminarem antes de iniciar um publish grande.

Recomendacao inicial: enfileirar o publish quando houver crawlers pesados em
execucao. Se publish e crawl precisarem coexistir, iniciar com um build e dois
uploads simultaneos.

## Plano de validacao

### Crawlers

- confirmar que cada fonte baixa uma capa ausente;
- confirmar que uma capa recente nao gera requisicao ao CDN;
- confirmar refresh quando a URL muda;
- confirmar refresh apos 180 dias;
- confirmar que `--refresh` do Sky ainda percorre a lista completa;
- comparar tempo por novel antes e depois em cada fonte;
- nao aplicar listagem incremental a outro conector sem benchmark e teste de
  consistencia.

### Publish

- publicar todas as fontes com a API respondendo durante todo o job;
- definir e respeitar um teto de memoria;
- garantir que temporarios sejam criados somente em `/srv`;
- interromper o worker no meio e confirmar retomada sem rebuild completo;
- confirmar que `index.json` antigo continua valido durante uma falha;
- conferir hash e tamanho dos bundles no B2;
- confirmar limpeza do diretorio temporario depois do sucesso;
- confirmar que nenhum container adicional e criado por clique;
- confirmar que crawlers mantem heartbeat durante o publish.

## Ordem sugerida de implementacao

1. instrumentar o publish atual e executar um benchmark controlado;
2. criar `publish_job` persistente e endpoints por ID;
3. criar o servico `publisher` dedicado;
4. mudar leitura/build para uma novel por vez;
5. adicionar upload com backpressure e multipart;
6. adicionar checkpoint e retomada;
7. adicionar limpeza automatica e retencao;
8. validar com uma fonte pequena;
9. validar com Central Novel e depois com `source=all`;
10. habilitar o novo fluxo no botao do monitor.

## Decisoes recomendadas

- Nao permitir que a API execute compressao e upload pesado diretamente.
- Nao expor o socket Docker para a API.
- Usar Postgres como fila persistente inicial; nao adicionar Redis apenas para
  este fluxo.
- Manter fontes sequenciais e paralelizar somente uploads com limite global.
- Construir e apagar bundles um por vez.
- Manter a atomicidade publicando catalogos e `index.json` por ultimo.
- Adiar qualquer reinicio dos crawlers atuais ate seus runs terminarem.
