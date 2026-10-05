# Publicar uma versão do app (atualização automática)

O app desktop se atualiza sozinho pelo updater do Tauri. A cada poucas horas ele consulta
`https://b2.jandson.me/atualizacoes/latest.json` (bucket `oghma-acervo`, servido pela Cloudflare como
o catálogo). Se houver uma versão maior que a instalada, aparece o botão **Atualizar** no canto
superior direito, e um clique baixa, instala e reabre o app.

## Chave de assinatura

- O app só aceita pacotes assinados com a chave do Oghma. A **chave pública** está em
  `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).
- A **chave privada** e a senha ficam fora do repo, em `~/.config/oghma/updater.key` e
  `updater.key.password` (0600).
- **Faça backup das duas** (gerenciador de senhas). Sem elas, os apps instalados não aceitam mais
  atualizações e cada um teria de ser reinstalado à mão.

## Publicar

1. Suba a versão (semver) em `src-tauri/tauri.conf.json`, `package.json` e `src-tauri/Cargo.toml`.
2. Rode, no computador da plataforma (o Mac publica macOS; o Windows publica Windows):

```bash
cd apps/desktop
export CARGO_TARGET_DIR=$HOME/Documents/Oghma-wt/cargo-target   # opcional
node scripts/release.mjs --notes "O que mudou nesta versão"
```

O script compila assinando, envia o pacote para `atualizacoes/<versão>/` no bucket (pela VPS, com as
credenciais de `/opt/oghma/.env`) e reescreve o `latest.json`. Uma plataforma que ainda não tem a
versão nova sai do `latest.json` até ser publicada, para nenhum app receber o pacote de outra versão.

- `--skip-build`: reaproveita o último build assinado.
- `--notes-file notas.md`: lê as novidades de um arquivo.

**Build sem publicar:** como o bundle gera os artefatos de atualização, o `tauri build` precisa da chave:

```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.config/oghma/updater.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat ~/.config/oghma/updater.key.password)" npm run tauri:build
```

## Windows

- Copie `updater.key` e `updater.key.password` para `%USERPROFILE%\.config\oghma\`.
- Rode o mesmo comando. O pacote é o instalador NSIS (`*-setup.exe` + `.sig`), instalado em modo
  `passive` (só a barra de progresso).
