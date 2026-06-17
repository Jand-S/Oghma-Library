"""Testa endpoints provaveis da API House Saikai."""
from __future__ import annotations

import asyncio
import json

import httpx


URLS = [
    "https://api.housesaikai.net/api",
    "https://api.housesaikai.net/api/series",
    "https://api.housesaikai.net/api/series?page=1",
    "https://api.housesaikai.net/api/series?limit=10",
    "https://api.housesaikai.net/api/comics",
    "https://api.housesaikai.net/api/graphql",
    "https://api.housesaikai.net/graphql",
]


async def main() -> None:
    async with httpx.AsyncClient(
        headers={
            "User-Agent": "Mozilla/5.0 OghmaProbe",
            "Accept": "application/json,text/plain,*/*",
            "Origin": "https://housesaikai.net",
            "Referer": "https://housesaikai.net/",
        },
        follow_redirects=True,
        timeout=30,
    ) as client:
        for url in URLS:
            print(f"\n=== {url} ===")
            try:
                resp = await client.get(url)
            except Exception as exc:
                print("ERR", type(exc).__name__, str(exc)[:200])
                continue
            print("status", resp.status_code, "type", resp.headers.get("content-type"), "bytes", len(resp.content))
            print(resp.text[:1000])
            try:
                data = resp.json()
            except json.JSONDecodeError:
                continue
            print("json", list(data.keys()) if isinstance(data, dict) else type(data).__name__)


if __name__ == "__main__":
    asyncio.run(main())
