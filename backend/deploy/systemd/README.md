# Serviços da VPS

Instalação (como root), a partir do clone em `/opt/oghma/app`:

```bash
cp /opt/oghma/app/backend/deploy/systemd/oghma-*.service /opt/oghma/app/backend/deploy/systemd/oghma-*.timer /etc/systemd/system/
install -m 440 /opt/oghma/app/backend/deploy/systemd/oghma-sudoers /etc/sudoers.d/oghma && visudo -c
systemctl daemon-reload
systemctl enable --now oghma-backup.timer oghma-disk.timer oghma-discovery.timer
systemctl enable --now oghma-rodizio          # só depois da Fase 3 (dados): com banco vazio coletaria tudo do zero
systemctl enable --now oghma-autoconnector    # só depois dos logins do Codex/Claude do usuário oghma
```

`/opt/oghma/.env` (600, dono oghma) precisa de `OGHMA_DATABASE_URL`, `OGHMA_STORAGE_ROOT`,
`OGHMA_S3_*`, `OGHMA_S3_PRIVATE_BUCKET` (raw e backups; nunca o bucket público), `BRAIN_URL`,
`BRAIN_TOKEN` e `OGHMA_PUBLISH` (0 no período de teste em paralelo).

## Parecidos (`oghma-discovery`)

Toda madrugada (05:00 UTC): `oghma discovery-fichas` escreve, com o Codex do `oghma-agent`, a
ficha da história das obras novas (ou com sinopse nova) e `oghma discovery-build` recalcula os
parecidos de todo o catálogo e publica `discovery/similar-<ts>.json.gz`. O modelo de embeddings
precisa do extra: `pip install -e "backend[discovery]"`. Arquivos em `/srv/oghma/discovery`
(fichas, cache de vetores, modelo). A geração de fichas para sozinha com o plano do Codex em 85%
(5 h) ou 90% (semana) e continua na noite seguinte.
