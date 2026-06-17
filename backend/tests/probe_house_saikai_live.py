"""Probe manual do House Saikai sem gravar no banco."""
from __future__ import annotations

import asyncio
import re

import httpx


URLS = [
    "https://housesaikai.net/",
    "https://housesaikai.net/series",
    "https://housesaikai.net/comics",
    "https://housesaikai.net/login",
]


async def main() -> None:
    async with httpx.AsyncClient(
        headers={
            "User-Agent": "Mozilla/5.0 OghmaProbe",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.6",
        },
        timeout=30,
        follow_redirects=True,
    ) as client:
        for url in URLS:
            print(f"\n=== {url} ===")
            try:
                resp = await client.get(url)
                resp.raise_for_status()
            except Exception as exc:
                print("ERR", type(exc).__name__, str(exc)[:300])
                continue
            text = resp.text
            print("final_url:", resp.url)
            print("content_type:", resp.headers.get("content-type"))
            print("bytes:", len(resp.content))
            title = re.search(r"<title[^>]*>(.*?)</title>", text, flags=re.S | re.I)
            print("title:", title.group(1).strip() if title else "-")
            print("sample:", re.sub(r"\s+", " ", text[:600]).strip())
            refs = re.findall(r"""(?:src|href)=["']([^"']+)["']""", text)
            print("refs:")
            for ref in refs[:80]:
                print(" ", ref)
            print("api-ish:")
            seen = set()
            for pattern in [
                r"/api/[^\"' <)]+",
                r"/_nuxt/[^\"' <)]+",
                r"api\.[a-z0-9.-]+",
                r"graphql",
                r"series",
                r"comics",
            ]:
                for match in re.findall(pattern, text, flags=re.I):
                    if match not in seen:
                        seen.add(match)
                        print(" ", match)

if __name__ == "__main__":
    asyncio.run(main())
