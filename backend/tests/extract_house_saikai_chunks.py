"""Extrai chunks Nuxt relevantes do House Saikai.

Probe manual. O HTML de `/series` redireciona para login, mas o bundle Nuxt
carrega rotas dinamicas. Este script tenta mapear os IDs dos chunks para URLs.
"""
from __future__ import annotations

import re
from urllib.parse import urljoin

import httpx


BASE = "https://housesaikai.net"
MAIN = f"{BASE}/_nuxt/71f48f1.js"
INTERESTING_IDS = {"151", "224", "226", "241"}


def _context(text: str, token: str, width: int = 700) -> str:
    idx = text.find(token)
    if idx < 0:
        return ""
    return text[max(0, idx - width): min(len(text), idx + len(token) + width)]


def _chunk_candidates(main_js: str) -> list[str]:
    candidates: set[str] = set()
    for match in re.finditer(r"""(?P<id>\d+):["'](?P<name>[^"']+)["']""", main_js):
        if match.group("id") in INTERESTING_IDS or any(
            part in match.group("name").lower()
            for part in ["series", "comics", "ler-series", "ler-comics"]
        ):
            candidates.add(match.group("name"))

    for match in re.finditer(r"""["']([^"']*(?:series|comics|ler-series|ler-comics)[^"']*\.js)["']""", main_js, re.I):
        candidates.add(match.group(1))

    out: list[str] = []
    for candidate in sorted(candidates):
        if candidate.startswith("http"):
            out.append(candidate)
        elif candidate.startswith("/"):
            out.append(urljoin(BASE, candidate))
        elif candidate.endswith(".js"):
            out.append(urljoin(f"{BASE}/_nuxt/", candidate))
    return out


def main() -> None:
    with httpx.Client(
        headers={"User-Agent": "Mozilla/5.0 OghmaProbe", "Accept-Language": "pt-BR,pt;q=0.9"},
        follow_redirects=True,
        timeout=30,
    ) as client:
        html = client.get(f"{BASE}/login").text
        initial_assets: list[str] = []
        for match in re.finditer(r"""(?:src|href)=["']([^"']+/_nuxt/[^"']+\.js)["']|(?:src|href)=["'](/_nuxt/[^"']+\.js)["']""", html):
            ref = match.group(1) or match.group(2)
            url = ref if ref.startswith("http") else urljoin(BASE, ref)
            if url not in initial_assets:
                initial_assets.append(url)

        bundle_texts: list[str] = []
        for asset in initial_assets:
            text = client.get(asset).text
            bundle_texts.append(text)
            print("asset", len(text), asset)
            for token in ["151:", "224:", "226:", "241:", ".u=function", "miniCssF", "jsonpScriptSrc", "chunks"]:
                ctx = _context(text, token)
                if ctx:
                    print(f"\n--- context {token} in {asset} ---")
                    print(ctx[:2200])

        print("\n--- candidates ---")
        candidates: set[str] = set()
        for text in bundle_texts:
            candidates.update(_chunk_candidates(text))
            for match in re.finditer(
                r"""(?P<prefix>["_+]?/?.*?_nuxt/)?(?P<file>(?:pages/)?[^"'+,;()]*?(?:series|comics|ler-series|ler-comics)[^"'+,;()]*?\.js)""",
                text,
                re.I,
            ):
                file_name = match.group("file")
                candidates.add(urljoin(f"{BASE}/_nuxt/", file_name))

        for url in sorted(candidates):
            try:
                resp = client.get(url)
                print(resp.status_code, len(resp.text), url)
                text = resp.text
                if "series" in text.lower() or "comic" in text.lower() or "$axios" in text:
                    for token in ["$axios", "/series", "series", "story", "comic", "release", "chapter"]:
                        ctx = _context(text, token, 260)
                        if ctx:
                            print(f"  token={token}: {ctx[:800]}")
            except Exception as exc:
                print("ERR", url, exc)


if __name__ == "__main__":
    main()
