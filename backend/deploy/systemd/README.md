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

## Conta (`oghma-accounts`)

API pública da conta Oghma (login por código no e-mail, apelido/avatar e a biblioteca
sincronizada), em `oghma.accounts.app`. Só tem rotas de conta; as de administração dos crawlers
nunca passam por ela. Escuta em `127.0.0.1:8096`; o Caddy publica em HTTPS. As tabelas
(`account_*`) são criadas na partida, no mesmo Postgres.

Variáveis no `/opt/oghma/.env`:

| Variável | Uso |
|---|---|
| `OGHMA_ACCOUNTS_DATABASE_URL` | normalmente igual a `OGHMA_DATABASE_URL` |
| `OGHMA_ACCOUNTS_SECRET` | 32+ caracteres aleatórios (`openssl rand -hex 32`); assina códigos e tokens. Trocar derruba todas as sessões |
| `OGHMA_ACCOUNTS_MAILER` | `resend` em produção (`log` escreve o código no journal, para teste) |
| `OGHMA_ACCOUNTS_RESEND_API_KEY` | chave da Resend |
| `OGHMA_ACCOUNTS_MAIL_FROM` | remetente num domínio verificado na Resend (SPF/DKIM), ex.: `Oghma <noreply@oghma.dev>` |

Roda de uma worktree própria, para o deploy da conta não mexer no checkout dos crawlers
(`/opt/oghma/app`); usa o mesmo venv (FastAPI, SQLAlchemy e asyncpg já estão nele).

```bash
sudo -u oghma git -C /opt/oghma/app fetch origin feature/library-account
sudo -u oghma git -C /opt/oghma/app worktree add /opt/oghma/accounts origin/feature/library-account   # 1ª vez
sudo -u oghma git -C /opt/oghma/accounts checkout --detach origin/feature/library-account             # atualizar
cp /opt/oghma/accounts/backend/deploy/systemd/oghma-accounts.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now oghma-accounts   # restart para atualizar
curl -s http://127.0.0.1:8096/health
```

Caddy (o domínio precisa apontar para a VPS):

```caddy
conta.oghma.dev {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8096
}
```

O app usa `https://conta.oghma.dev` como servidor da conta (Ajustes > Conta > Servidor; padrão
em `apps/desktop/src/features/account/oghmaAccount.ts`).
