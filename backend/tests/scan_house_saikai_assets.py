"""Varre assets Nuxt do House Saikai procurando API/GraphQL.

Probe manual, nao faz parte da suite automatica. Ele imprime contextos ao redor
de tokens uteis porque o bundle Nuxt do site vem minificado.
"""
from __future__ import annotations

import asyncio
import re
from urllib.parse import urljoin

import httpx


BASE = "https://housesaikai.net"
TOKENS = [
    "api.housesaikai.net",
    "baseURL",
    "$axios",
    ".get(",
    ".post(",
    "series/",
    "/series",
    "comics/",
    "/comics",
    "releases",
    "chapters",
    "story_id",
    "slug",
    "graphql",
]


def _context(text: str, token: str, width: int = 260) -> list[str]:
    out: list[str] = []
    start = 0
    lowered = text.lower()
    token_lower = token.lower()
    while True:
        idx = lowered.find(token_lower, start)
        if idx < 0:
            break
        begin = max(0, idx - width)
        end = min(len(text), idx + len(token) + width)
        snippet = text[begin:end].replace("\n", " ")
        snippet = re.sub(r"\s+", " ", snippet)
        if snippet not in out:
            out.append(snippet)
        start = idx + len(token)
        if len(out) >= 12:
            break
    return out


def _string_literals(text: str) -> list[str]:
    values: list[str] = []
    for match in re.finditer(r"""["'`]([^"'`]{3,180})["'`]""", text):
        value = match.group(1)
        if any(token in value.lower() for token in ["api", "series", "comic", "chapter", "release", "storie", "novel"]):
            values.append(value)
    return sorted(set(values))


async def main() -> None:
    async with httpx.AsyncClient(
        headers={
            "User-Agent": "Mozilla/5.0 OghmaProbe",
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.6",
        },
        follow_redirects=True,
        timeout=30,
    ) as client:
        html = (await client.get(f"{BASE}/login")).text
        refs = re.findall(r"""(?:src|href)=["']([^"']+/_nuxt/[^"']+\.js)["']|(?:src|href)=["'](/_nuxt/[^"']+\.js)["']""", html)
        assets = []
        for absolute, relative in refs:
            ref = absolute or relative
            url = ref if ref.startswith("http") else urljoin(BASE, ref)
            if url not in assets:
                assets.append(url)
        print("assets", len(assets))
        for url in assets:
            js = (await client.get(url)).text
            hits: list[str] = []
            for pattern in [
                r"https?://[^\"'` )]+",
                r"api\.[a-z0-9.-]+",
                r"graphql[^\"'` )]{0,120}",
                r"series[^\"'`]{0,160}",
                r"comics[^\"'`]{0,160}",
                r"chapter[^\"'`]{0,160}",
                r"gql`[^`]+`",
                r"query\s+[A-Za-z0-9_]+[^`\"']{0,240}",
                r"mutation\s+[A-Za-z0-9_]+[^`\"']{0,240}",
            ]:
                for match in re.findall(pattern, js, flags=re.I):
                    if isinstance(match, tuple):
                        match = next((part for part in match if part), "")
                    if match and match not in hits:
                        hits.append(match)
            interesting = [
                hit for hit in hits
                if any(token in hit.lower() for token in ["api", "graphql", "series", "comic", "chapter"])
            ]
            if interesting:
                print(f"\n--- {url} ({len(js)} bytes) ---")
                for hit in interesting[:120]:
                    print(hit[:500])

                print("\n  contexts:")
                for token in TOKENS:
                    contexts = _context(js, token)
                    if contexts:
                        print(f"\n  token={token}")
                        for snippet in contexts[:4]:
                            print("   ", snippet[:900])

                literals = _string_literals(js)
                if literals:
                    print("\n  literals:")
                    for value in literals[:180]:
                        print("   ", value[:220])


if __name__ == "__main__":
    asyncio.run(main())
