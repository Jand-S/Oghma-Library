#!/usr/bin/env bash
# Teste ponta a ponta local de "Importar EPUB" (docs/IMPORT_EPUB.md): sobe o moto (S3 falso) e o
# oghma-accounts numa porta livre, entra com um e-mail de teste (código do log) e roda o teste
# Rust ignorado `account_files::e2e_tests` com os EPUBs reais. Depois roda os gates (cargo test
# --lib e pytest do backend), a menos que OGHMA_E2E_GATES=0. Para tudo o que subiu ao sair.
#
# Uso:
#   OGHMA_E2E_VENV=<venv com o backend, moto[server] e boto3> \
#   OGHMA_REAL_EPUBS=<pasta com os 4 volumes de Unsheathed> \
#   [OGHMA_E2E_TMP=<pasta de trabalho>] [CARGO_TARGET_DIR=...] backend/scripts/e2e_import_epub.sh
#
# Nada aqui toca o servidor de produção: tudo roda em 127.0.0.1 com chaves falsas.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
VENV="${OGHMA_E2E_VENV:-$REPO/backend/.venv}"
PY="$VENV/bin/python"
EPUBS="${OGHMA_REAL_EPUBS:?defina OGHMA_REAL_EPUBS com a pasta dos EPUBs reais}"
WORK="${OGHMA_E2E_TMP:-$(mktemp -d -t oghma-e2e)}"
WORK="$WORK/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$WORK"
export PATH="$HOME/.cargo/bin:$PATH"

[ -x "$PY" ] || { echo "venv não encontrado: $VENV" >&2; exit 1; }
[ -x "$VENV/bin/moto_server" ] || { echo "falta moto[server] no venv: uv pip install -p $PY 'moto[server]'" >&2; exit 1; }

PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  # Sai só depois que eles pararam.
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && wait "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

free_port() { "$PY" -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])'; }

# Espera até ~20 s a URL responder (sem laço infinito).
wait_for() {
  for _ in $(seq 1 40); do
    curl -s -o /dev/null "$1" && return 0
    sleep 0.5
  done
  echo "não respondeu: $1 (log em $2)" >&2
  tail -n 20 "$2" >&2
  exit 1
}

MOTO_PORT="$(free_port)"
"$VENV/bin/moto_server" -H 127.0.0.1 -p "$MOTO_PORT" >"$WORK/moto.log" 2>&1 &
PIDS+=($!)
wait_for "http://127.0.0.1:$MOTO_PORT/" "$WORK/moto.log"

export AWS_ACCESS_KEY_ID=e2e AWS_SECRET_ACCESS_KEY=e2e AWS_DEFAULT_REGION=us-east-1
"$PY" -c "import boto3,sys; boto3.client('s3', endpoint_url=sys.argv[1], region_name='us-east-1').create_bucket(Bucket='oghma-contas')" \
  "http://127.0.0.1:$MOTO_PORT"

ACC_PORT="$(free_port)"
# Roda fora de backend/ para não ler nenhum .env local.
(
  cd "$WORK"
  exec env PYTHONPATH="$REPO/backend/src" \
    OGHMA_ACCOUNTS_DATABASE_URL="sqlite+aiosqlite:///$WORK/acc.db" \
    OGHMA_ACCOUNTS_SECRET="$("$PY" -c 'import secrets; print(secrets.token_hex(32))')" \
    OGHMA_ACCOUNTS_MAILER=log \
    OGHMA_ACCOUNTS_PUBLIC_URL="http://127.0.0.1:$ACC_PORT" \
    OGHMA_ACCOUNTS_FILES_BUCKET=oghma-contas \
    OGHMA_ACCOUNTS_S3_ENDPOINT="http://127.0.0.1:$MOTO_PORT" \
    OGHMA_ACCOUNTS_S3_REGION=us-east-1 \
    OGHMA_ACCOUNTS_S3_ACCESS_KEY_ID=e2e \
    OGHMA_ACCOUNTS_S3_SECRET_ACCESS_KEY=e2e \
    "$PY" -m uvicorn oghma.accounts.app:app --host 127.0.0.1 --port "$ACC_PORT"
) >"$WORK/accounts.log" 2>&1 &
PIDS+=($!)
ACC="http://127.0.0.1:$ACC_PORT"
wait_for "$ACC/health" "$WORK/accounts.log"

EMAIL="e2e-import@example.com"
curl -sf -X POST "$ACC/v1/auth/code" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"deviceName\":\"e2e\",\"platform\":\"macos\"}" >/dev/null
CODE="$(grep -o "Código de login para $EMAIL: [0-9]*" "$WORK/accounts.log" | tail -n 1 | awk '{print $NF}')"
[ -n "$CODE" ] || { echo "código não apareceu no log" >&2; tail -n 20 "$WORK/accounts.log" >&2; exit 1; }
TOKEN="$(curl -sf -X POST "$ACC/v1/auth/verify" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"code\":\"$CODE\",\"deviceName\":\"e2e\",\"platform\":\"macos\"}" \
  | "$PY" -c 'import json,sys; print(json.load(sys.stdin)["token"])')"

echo "== e2e (moto :$MOTO_PORT, contas :$ACC_PORT, dados em $WORK)"
cd "$REPO/apps/desktop/src-tauri"
OGHMA_E2E_ACCOUNT_URL="$ACC" OGHMA_E2E_TOKEN="$TOKEN" OGHMA_REAL_EPUBS="$EPUBS" OGHMA_E2E_TMP="$WORK" \
  cargo test --lib account_files::e2e_tests -- --ignored --nocapture 2>&1 | tee "$WORK/e2e.log" | tail -n 15
[ "${PIPESTATUS[0]}" -eq 0 ] || { echo "e2e falhou; logs em $WORK" >&2; exit 1; }

if [ "${OGHMA_E2E_GATES:-1}" != "0" ]; then
  echo "== cargo test --lib"
  cargo test --lib -q 2>&1 | tail -n 5
  echo "== pytest (backend)"
  (cd "$REPO/backend" && PYTHONPATH=src "$PY" -m pytest -q 2>&1 | tail -n 5)
fi
echo "ok; logs e Bibliotecas em $WORK"
