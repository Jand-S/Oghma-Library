# Checkpoints com Git (e o incidente de 2026-06-16)

## Por que isso existe

Em 2026-06-16, durante a edição do desktop, vários arquivos grandes em
`apps/desktop/src/` foram **truncados/corrompidos** (cortados no meio de uma linha,
ou preenchidos com bytes NUL no final). Atingidos: `App.tsx`, `appUi.tsx`, `types.ts`,
`main.tsx`, `mockBackend.ts` e `App.test.tsx`.

Causa: instabilidade do mount/ferramentas de arquivo ao escrever arquivos grandes.
Agravante: **o repositório não tinha nenhum commit** e `apps/desktop/src/` estava
*untracked* — ou seja, zero backup. Sem isso, parte do `App.test.tsx` (7 de ~15 testes)
não pôde ser recuperada com exatidão.

Recuperação feita: arquivos pequenos reescritos do conteúdo íntegro; cauda do
`appUi.tsx` reconstruída; `App.test.tsx` restaurado do histórico da sessão (8 testes).
`tsc` voltou a passar limpo.

## Regra de ouro

**Commit local frequente.** Um commit é um snapshot completo no seu disco; não precisa
de `push` e não envia nada pra lugar nenhum. É a rede de segurança contra esse tipo de
perda.

## Setup (uma vez)

O `.gitignore` na raiz já exclui `node_modules/`, `target/`, `__pycache__/`, `.env` e os
artefatos do acervo (`*.sqlite.gz`, `*.tar.gz`, etc).

Identidade local do repo (não afeta seu git global nem push):

```powershell
git config user.name "Jandson"
git config user.email "jandson.macedo2301@gmail.com"
```

## Rotina de checkpoint (PowerShell, um comando por linha)

Você já fica dentro de `C:\Users\Jandson\Documents\Oghma Library`, então **não** rode
`cd "Oghma Library"`. O PowerShell antigo também não aceita `&&` — uma linha por comando:

```powershell
git add -A
git commit -m "checkpoint: <descricao curta>"
```

Para ver o que mudou antes de commitar:

```powershell
git status
git diff --stat
```

Faça isso antes e depois de cada bloco de mudanças grandes. Sem `push` necessário —
fica tudo local e recuperável (`git log`, `git checkout <hash> -- <arquivo>`).
