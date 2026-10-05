# Publicar uma versão do app

Uma versão nova sai para **Mac e Windows** de uma vez: um comando no Mac cria a tag, e o GitHub
Actions (`.github/workflows/release.yml`) faz o resto.
- compila e assina as duas plataformas;
- publica a release no GitHub (a página `https://oghma.dev` baixa dela);
- atualiza o `latest.json` do updater, e os apps instalados mostram o botão **Atualizar**.

## Lançar uma versão

```bash
cd apps/desktop
node scripts/release.mjs 2.0.4 --notes "O que mudou nesta versão"
```

- O script exige a árvore limpa e uma versão maior que a atual.
- Ele sobe a versão em `tauri.conf.json`, `package.json`, `Cargo.toml` e `Cargo.lock`, faz o commit `Versão X`, cria a tag anotada `vX` (a mensagem vira as notas da release e do botão Atualizar) e envia o branch e a tag.
- Acompanhe em `https://github.com/Jand-S/Oghma-Library/actions`. Leva ~15 min a frio e ~6 min com cache.

**O que o workflow faz:**

1. `prepare`: confere se a tag bate com a versão dos arquivos e cria o rascunho da release.
2. `build` (macos-14 e windows-latest): `tauri build` assinado. Os arquivos sobem com nomes fixos:
   - `Oghma-Library-macOS.dmg`
   - `Oghma-Library_X_aarch64.app.tar.gz` + `.sig`
   - `Oghma-Library-Windows.exe` + `.sig`
3. `publish`: confere os arquivos, tira a release do rascunho (vira a "Latest") e **só depois** sobe o `latest.json` no bucket (`oghma-acervo/atualizacoes/latest.json`, lido pelos apps em `https://b2.jandson.me/atualizacoes/latest.json`). As URLs dos pacotes apontam para a release versionada.

**Testar sem publicar:** Actions → Release → *Run workflow*, com o branch e `dry_run` marcado. Compila e deixa os arquivos nos artefatos do run, sem release nem `latest.json`.

## Segredos do repositório (uma vez)

Postos pelo Jandson; ninguém passa chaves por chat ou nota.

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY -R Jand-S/Oghma-Library < ~/.config/oghma/updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R Jand-S/Oghma-Library < ~/.config/oghma/updater.key.password
gh secret set B2_KEY_ID -R Jand-S/Oghma-Library            # pede o valor
gh secret set B2_APPLICATION_KEY -R Jand-S/Oghma-Library   # pede o valor
```

A chave do B2: Backblaze → *Application Keys* → *Add a New Application Key*, só no bucket
`oghma-acervo`, com *File name prefix* `atualizacoes/` e *Read and Write*.

## Chave de assinatura

- A **pública** está em `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).
- A **privada** e a senha ficam em `~/.config/oghma/updater.key` e `updater.key.password`, e nos segredos do GitHub.
- **Faça backup das duas** (gerenciador de senhas). Sem elas, os apps instalados não aceitam mais atualizações.

## Emergência (sem CI)

`node scripts/release.mjs --local --notes "..."` compila neste computador, envia o pacote pela VPS
(credenciais do bucket em `/opt/oghma/.env`) e publica só a plataforma local no `latest.json`.
