"""Inspeciona runtime Nuxt para mapear ids de chunk para arquivos."""
from __future__ import annotations

import re
from urllib.parse import urljoin

import httpx


BASE = "https://housesaikai.net"


def context(text: str, token: str, width: int = 900) -> str:
    idx = text.find(token)
    if idx < 0:
        return ""
    return re.sub(r"\s+", " ", text[max(0, idx - width): idx + width])


def main() -> None:
    with httpx.Client(headers={"User-Agent": "Mozilla/5.0 OghmaProbe"}, timeout=30, follow_redirects=True) as client:
        html = client.get(f"{BASE}/login").text
        assets = []
        for match in re.finditer(r"""(?:src|href)=["']([^"']+/_nuxt/[^"']+\.js)["']|(?:src|href)=["'](/_nuxt/[^"']+\.js)["']""", html):
            ref = match.group(1) or match.group(2)
            url = ref if ref.startswith("http") else urljoin(BASE, ref)
            if url not in assets:
                assets.append(url)
        for url in assets:
            text = client.get(url).text
            print("\nASSET", url, len(text))
            for token in [
                "jsonpScriptSrc",
                ".u=function",
                ".u = function",
                "u=function",
                "chunkFilename",
                "miniCssF",
                '+"."+',
                "151:",
                "241:",
            ]:
                snippet = context(text, token)
                if snippet:
                    print("TOKEN", token, snippet[:2400])
            for pattern in [
                r"""(\d+):["']([^"']+)["']""",
                r"""(\d+):function\([^)]*\)\{return["']([^"']+)["']""",
            ]:
                hits = re.findall(pattern, text)
                interesting = [
                    hit for hit in hits
                    if hit[0] in {"151", "224", "226", "241"}
                    or any(word in hit[1].lower() for word in ["series", "comics", "ler"])
                ]
                if interesting:
                    print("PATTERN", pattern)
                    for hit in interesting[:80]:
                        print(" ", hit)


if __name__ == "__main__":
    main()
