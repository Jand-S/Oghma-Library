# Operacao local

Guia rapido para acompanhar o backend, o crawler e os dados salvos no servidor local.

## URLs principais

Servidor atual:

- API: `http://192.168.0.42:8010`
- Monitor visual: `http://192.168.0.42:8010/monitor`
- Swagger/OpenAPI: `http://192.168.0.42:8010/docs`
- Crawls em JSON: `http://192.168.0.42:8010/api/crawls?limit=20`
- Resumo em JSON: `http://192.168.0.42:8010/api/stats`
- Novels em JSON: `http://192.168.0.42:8010/api/novels?limit=20`

## Monitor visual

A pagina `/monitor` existe para acompanhar o crawler sem precisar abrir Swagger ou consultar SQL.

Ela atualiza automaticamente a cada 2 segundos e mostra:

- quantidade de crawls ativos;
- totais de novels, capitulos e capas preservadas;
- runs recentes;
- fonte do run (`sourceId`);
- etapa atual (`stage`);
- obra atual;
- progresso de novels;
- progresso de capitulos da obra atual;
- capitulo atual;
- quantidade de capitulos novos e pulados;
- ultimo evento;
- heartbeat mais recente.

## Como funciona

O crawler grava progresso vivo na tabela `crawl_run`, dentro da coluna `stats`.

O monitor consome dois endpoints:

- `GET /api/crawls?limit=12`: lista os runs recentes e seus campos de progresso.
- `GET /api/stats`: devolve contagens globais para os cards de resumo.

Campos mais importantes dentro de `stats`:

- `stage`: etapa atual do crawl.
- `novels_total`: total de novels descobertas para a fonte.
- `novels_done`: novels finalizadas.
- `novels_failed`: novels que falharam.
- `current_novel_index`: posicao da novel atual na fila da fonte.
- `current_novel_title`: titulo da novel atual.
- `current_novel_chapters_total`: total de capitulos da novel atual.
- `current_novel_chapters_done`: capitulos processados na novel atual.
- `current_chapter_number`: numero do capitulo atual.
- `current_chapter_title`: titulo do capitulo atual.
- `chapters_new`: capitulos novos salvos neste run.
- `chapters_skipped`: capitulos ja existentes que foram pulados.
- `covers_new`: capas novas preservadas neste run.
- `errors`: erros gerais.
- `cover_errors`: erros de capa.
- `last_event`: descricao curta do que acabou de acontecer.
- `last_heartbeat_at`: ultimo sinal de vida do crawler.

## Alerta de possivel travamento

Se um run estiver com `status = running` e `last_heartbeat_at` ficar mais de 10 minutos sem atualizar, a pagina e o script de status devem tratar como possivel travamento (`STALE?`).

Isso nao significa necessariamente que os dados foram perdidos. O crawl e incremental:

- capitulos ja salvos sao pulados em uma proxima execucao;
- capitulos novos sao identificados por `chapter.id`;
- `Novel.chapter_count` e atualizado durante novels longas;
- o run pode ser reiniciado sem baixar tudo do zero.

## Comandos uteis no servidor

Status consolidado:

```bash
ssh codex@192.168.0.42 "/home/codex/oghma/deploy/crawl-status.sh"
```

Log ao vivo:

```bash
ssh codex@192.168.0.42 "tail -f /srv/oghma/logs/crawl-central-novel.log"
```

Rodar crawl manual:

```bash
ssh codex@192.168.0.42 "cd /home/codex/oghma && docker compose run --rm crawler oghma crawl --source central-novel"
```

Reprocessar conteudo limpo a partir do raw salvo, sem rebaixar do site:

```bash
ssh codex@192.168.0.42 "cd /home/codex/oghma && docker compose run --rm crawler oghma reprocess-content --source central-novel"
```

Ver cron instalado:

```bash
ssh codex@192.168.0.42 "crontab -l"
```

## Cron mensal

O cron atual roda no dia 1 de cada mes, as 03:00:

```text
0 3 1 * * /home/codex/oghma/deploy/crawl-monthly.sh
```

O script usa `flock`, entao uma nova execucao mensal nao deve iniciar se outra ainda estiver rodando.

## Banco de dados

Conexao para DBeaver, Beekeeper ou outro cliente PostgreSQL:

```text
Host: 192.168.0.42
Porta: 5432
Database: oghma
User: oghma
Senha: oghma
```

Via terminal:

```bash
ssh codex@192.168.0.42
cd /home/codex/oghma
docker compose exec db psql -U oghma -d oghma
```

Consultas uteis:

```sql
select count(*) from novel;
select count(*) from chapter;
select id, status, stats, started_at, finished_at
from crawl_run
order by id desc
limit 5;
```

## Preparacao para multi-site

O monitor ja considera o campo `sourceId`/`source_id`.

Quando tivermos crawlers paralelos por site, a regra sera:

- cada site cria seu proprio `crawl_run`;
- cada run atualiza seu proprio `stats`;
- a pagina mostra uma linha/cartao por fonte em execucao;
- o alerta de heartbeat continua independente por run.
