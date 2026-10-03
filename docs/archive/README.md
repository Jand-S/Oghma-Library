# Arquivo

Documentos que já cumpriram seu papel: planos executados, pilotos, relatos de sessões e
desenhos que mudaram. Ficam aqui como histórico das decisões; **não descrevem o sistema
atual**. Para o estado de hoje, veja `../ARCHITECTURE.md`, `../STRUCTURE.md` e `../ROADMAP.md`.

| Arquivo | Por que saiu |
|---|---|
| `ARCHITECTURE_PROPOSTA_2026-06.md`, `BACKEND_STACK.md`, `API_CONTRACTS.md`, `DISTRIBUTION.md` | Desenho inicial (Postgres + MinIO + API local, catálogo SQLite). Hoje o app lê só arquivos estáticos do B2. |
| `ROADMAP_2026-06.md`, `IMPLEMENTATION_PLAN.md`, `PROJECT_STATE.md` | Roteiro e diário de junho de 2026, substituídos por `../ROADMAP.md`. |
| `TRANSLATION_*.md` | Pipeline de tradução do backend, removido em outubro de 2026. A tradução vive no app (`src-tauri/src/translation/`, contrato em `../TRANSLATION_CONTRACT.md`). |
| `PLAN_*.md`, `REFACTOR_PLAN.md`, `REORG_FOR_CODEX.md` | Planos já executados. |
| `SESSION_*.md`, `COORDINATION.md`, `GIT_CHECKPOINTS.md` | Coordenação entre agentes e incidentes do mount antigo. |
| `OPERATIONS.md` | Operação do servidor local (xeonserver). A VPS está em `backend/deploy/RUNTIME.md`. |
| `CONNECTOR_SPEC.md` | Contrato do primeiro conector. Conectores novos seguem `backend/autoconnector/CONTEXT.md`. |
| `INCIDENT_EMPTY_CHAPTERS_2026-09-12.md` + auditoria JSON | Incidente encerrado. |
