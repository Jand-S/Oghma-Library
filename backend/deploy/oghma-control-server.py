#!/usr/bin/env python3
"""Servidor HTTP minimo para o ESP32 disparar o crawl diario no host.

Roda fora do Docker, no servidor local. Ele existe porque o container da API nao
deve controlar Docker nem desligar o host.
"""
from __future__ import annotations

import hmac
import json
import os
import sys
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


HOST = os.environ.get("OGHMA_CONTROL_HOST", "0.0.0.0")
PORT = int(os.environ.get("OGHMA_CONTROL_PORT", "8020"))
TOKEN = os.environ.get("OGHMA_CONTROL_TOKEN", "")
SCRIPT = os.environ.get("OGHMA_DAILY_SCRIPT", "/home/codex/oghma/deploy/crawl-daily-completed.sh")

state_lock = threading.Lock()
state: dict[str, object] = {
    "running": False,
    "started_at": None,
    "finished_at": None,
    "exit_code": None,
    "shutdown_when_done": None,
}


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def authorized(handler: BaseHTTPRequestHandler, query: dict[str, list[str]]) -> bool:
    """So o cabecalho X-Oghma-Control-Token (o ESP32 ja usa): token na URL vai parar em logs.
    Sem token configurado nada passa (o servidor nem sobe, ver main)."""
    if not TOKEN:
        return False
    header = handler.headers.get("X-Oghma-Control-Token", "")
    return hmac.compare_digest(header.encode(), TOKEN.encode())


def run_script(shutdown_when_done: bool) -> None:
    args = [SCRIPT]
    if shutdown_when_done:
        args.append("--shutdown-when-done")

    with state_lock:
        state.update(
            {
                "running": True,
                "started_at": now(),
                "finished_at": None,
                "exit_code": None,
                "shutdown_when_done": shutdown_when_done,
            }
        )

    try:
        proc = subprocess.run(args, check=False)
        exit_code = proc.returncode
    except Exception:
        exit_code = 127

    with state_lock:
        state.update({"running": False, "finished_at": now(), "exit_code": exit_code})


class Handler(BaseHTTPRequestHandler):
    server_version = "OghmaControl/0.1"

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}", flush=True)

    def send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)

        if parsed.path == "/health":
            self.send_json(200, {"ok": True})
            return

        if parsed.path == "/status":
            if not authorized(self, query):
                self.send_json(401, {"ok": False, "reason": "unauthorized"})
                return
            with state_lock:
                payload = dict(state)
            payload["ok"] = True
            self.send_json(200, payload)
            return

        self.send_json(404, {"ok": False, "reason": "not_found"})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)

        if parsed.path != "/trigger":
            self.send_json(404, {"ok": False, "reason": "not_found"})
            return

        if not authorized(self, query):
            self.send_json(401, {"ok": False, "reason": "unauthorized"})
            return

        shutdown_when_done = query.get("shutdownWhenDone", ["0"])[0] in ("1", "true", "yes")
        with state_lock:
            if state["running"]:
                self.send_json(409, {"ok": False, "reason": "already_running", **state})
                return

        thread = threading.Thread(target=run_script, args=(shutdown_when_done,), daemon=True)
        thread.start()
        self.send_json(202, {"ok": True, "started": True, "shutdown_when_done": shutdown_when_done})


def main() -> int:
    if len(TOKEN) < 16:
        # Este servidor dispara a coleta e pode desligar o host: sem token forte ele nao sobe.
        print("OGHMA_CONTROL_TOKEN ausente ou curto (minimo 16 caracteres); recusando iniciar.", file=sys.stderr)
        return 2
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"oghma-control-server listening on {HOST}:{PORT}", flush=True)
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

