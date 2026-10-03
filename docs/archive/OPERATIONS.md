# Operacao local

Guia rapido para acompanhar o backend, o crawler e os dados salvos no servidor local.

## URLs principais

Servidor atual:

- API: `http://192.168.0.42:8010`
- Monitor visual: `http://192.168.0.42:8010/monitor`
- Swagger/OpenAPI: `http://192.168.0.42:8010/docs`
- Crawls em JSON: `http://192.168.0.42:8010/api/crawls?limit=20`
- Resumo em JSON: `http://192.168.0.42:8010/api/stats`
- Status do publish: `http://192.168.0.42:8010/api/publish/status`
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
- botao **Publicar no B2**, que dispara a geracao/upload do acervo estatico.

## Como funciona

O crawler grava progresso vivo na tabela `crawl_run`, dentro da coluna `stats`.

O monitor consome dois endpoints:

- `GET /api/crawls?limit=12`: lista os runs recentes e seus campos de progresso.
- `GET /api/stats`: devolve contagens globais para os cards de resumo.
- `GET /api/publish/status`: acompanha o publish estatico para o B2.

O botao **Publicar no B2** chama:

- `POST /api/publish/run`: inicia o publish real para a fonte `central-novel`.

Existe lock em memoria no processo da API: se um publish ja estiver rodando, uma segunda chamada retorna `already_running`.

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

Publicar manualmente pelo endpoint, equivalente ao botao do monitor:

```bash
curl -X POST "http://192.168.0.42:8010/api/publish/run?source=central-novel"
curl "http://192.168.0.42:8010/api/publish/status"
```

Ver cron instalado:

```bash
ssh codex@192.168.0.42 "crontab -l"
```

## Armazenamento do servidor

Layout ativo desde 21/06/2026:

- NVMe: sistema operacional, `/usr`, codigo e arquivos pequenos sensiveis a latencia;
- HDD de 4 TB em `/srv`: acervo Oghma, Docker, imagens/snapshots do MicroK8s, caches grandes e dados de jogos;
- journal persistente limitado a 300 MB por `/etc/systemd/journald.conf.d/oghma-storage.conf`.

Bind mounts persistidos em `/etc/fstab`:

```text
/srv/oghma /var/snap/docker/common/oghma none bind 0 0
/srv/docker/var-lib-docker /var/snap/docker/common/var-lib-docker none bind 0 0
/srv/microk8s/containerd /var/snap/microk8s/common/var/lib/containerd none bind 0 0
```

Outros caminhos mantidos por symlink:

```text
/home/codex/.cache/pip -> /srv/cache/codex-pip
/home/jandson/servers -> /srv/game-data/jandson/servers
/home/jandson/hytale-server -> /srv/game-data/jandson/hytale-server
/home/jandson/minecraft -> /srv/game-data/jandson/minecraft
```

Validacao depois de um reboot:

```bash
df -hT / /var /home /srv
findmnt /var/snap/docker/common/var-lib-docker
findmnt /var/snap/microk8s/common/var/lib/containerd
sudo findmnt --verify --tab-file /etc/fstab
docker ps
sudo microk8s kubectl get pods -A
curl -fsS http://localhost:8010/health
```

Os mounts do Docker e MicroK8s devem mostrar `/dev/sda1` como origem. Se `/srv` nao estiver montado, nao inicie esses servicos ate corrigir o HDD.

## Cron mensal

O cron atual roda no dia 1 de cada mes, as 03:00:

```text
0 3 1 * * /home/codex/oghma/deploy/crawl-monthly.sh
```

O script usa `flock`, entao uma nova execucao mensal nao deve iniciar se outra ainda estiver rodando.

## Daily crawl com ESP32

O fluxo novo usa o ESP32 como agendador diario e Wake-on-LAN. O VPS nao entra
no caminho principal.

Arquivos no repo:

```text
backend/deploy/crawl-daily-completed.sh
backend/deploy/discord-dm.py
backend/deploy/oghma-control-server.py
backend/deploy/oghma-control.service.example
backend/deploy/daily-crawl.env.example
backend/deploy/esp32-oghma-wol/esp32-oghma-wol.ino
```

Instalar env no servidor:

```bash
sudo install -m 600 /home/codex/oghma/deploy/daily-crawl.env.example /srv/oghma/.env.daily-crawl
sudo nano /srv/oghma/.env.daily-crawl
```

Campos obrigatorios:

```text
OGHMA_CONTROL_TOKEN=...
DISCORD_BOT_TOKEN=...
DISCORD_USER_ID=...
```

Instalar o control server:

```bash
chmod +x /home/codex/oghma/deploy/crawl-daily-completed.sh
chmod +x /home/codex/oghma/deploy/discord-dm.py
chmod +x /home/codex/oghma/deploy/oghma-control-server.py
sudo cp /home/codex/oghma/deploy/oghma-control.service.example /etc/systemd/system/oghma-control.service
sudo systemctl daemon-reload
sudo systemctl enable --now oghma-control.service
```

Testar o control server:

```bash
curl -fsS http://192.168.0.42:8020/health
curl -fsS -H "X-Oghma-Control-Token: $OGHMA_CONTROL_TOKEN" http://192.168.0.42:8020/status
```

Disparar teste sem desligar:

```bash
curl -X POST -H "X-Oghma-Control-Token: $OGHMA_CONTROL_TOKEN" \
  "http://192.168.0.42:8020/trigger?shutdownWhenDone=0"
```

Para teste rapido, coloque temporariamente no env:

```text
OGHMA_CRAWL_LIMIT=1
OGHMA_CHAPTER_LIMIT=3
```

O ESP32 deve usar o mesmo `OGHMA_CONTROL_TOKEN` em `CONTROL_TOKEN`. O MAC do
servidor local usado para Wake-on-LAN e:

```text
0a:e0:af:a7:01:d1
```

O servidor desliga ao final quando o ESP32 disparar com
`shutdownWhenDone=1`, mesmo se uma fonte falhar parcialmente.

Depois dos crawlers, a rotina publica no B2 por fonte. Para teste sem upload
real, coloque temporariamente no env:

```text
OGHMA_PUBLISH_NO_UPLOAD=1
```

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
