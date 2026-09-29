#!/usr/bin/env python3
"""Envia uma mensagem direta pelo bot do Discord.

Requer:
- DISCORD_BOT_TOKEN
- DISCORD_USER_ID
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request


API = "https://discord.com/api/v10"


def request(method: str, path: str, token: str, payload: dict[str, object]) -> dict[str, object]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{API}{path}",
        data=body,
        method=method,
        headers={
            "Authorization": f"Bot {token}",
            "Content-Type": "application/json",
            "User-Agent": "OghmaLibraryBot/0.1",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read()
    return json.loads(data.decode("utf-8"))


def main() -> int:
    token = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
    user_id = os.environ.get("DISCORD_USER_ID", "").strip()
    if not token or not user_id:
        print("discord-dm: DISCORD_BOT_TOKEN ou DISCORD_USER_ID ausente; pulando notificacao")
        return 0

    if len(sys.argv) > 1:
        with open(sys.argv[1], "r", encoding="utf-8") as fh:
            content = fh.read().strip()
    else:
        content = sys.stdin.read().strip()

    if not content:
        print("discord-dm: mensagem vazia; pulando notificacao")
        return 0

    if len(content) > 1900:
        content = content[:1800] + "\n\n... mensagem truncada. Consulte o log completo no servidor."

    try:
        dm = request("POST", "/users/@me/channels", token, {"recipient_id": user_id})
        channel_id = str(dm["id"])
        request("POST", f"/channels/{channel_id}/messages", token, {"content": content})
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        print(f"discord-dm: falha HTTP {exc.code}: {details}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"discord-dm: falha: {exc}", file=sys.stderr)
        return 1

    print("discord-dm: enviado")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

