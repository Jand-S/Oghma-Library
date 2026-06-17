"""Inspeciona chunks de series/leitura do House Saikai."""
from __future__ import annotations

import re

import httpx


URLS = [
    "https://housesaikai.net/_nuxt/e2b0a1e.js",  # /series
    "https://housesaikai.net/_nuxt/d1b3708.js",  # /ler/series/:story
    "https://housesaikai.net/_nuxt/d73796b.js",  # /ler/series/:story/:release/:other
]

TOKENS = [
    "$axios",
    "stories",
    "releases",
    "release-texts",
    "release_text",
    "releaseText",
    "story_id",
    "storyId",
    "order",
    "separator",
    "content",
    "nextRelease",
    "previousRelease",
]


def _context(text: str, token: str, width: int = 700) -> list[str]:
    out: list[str] = []
    low = text.lower()
    start = 0
    token_low = token.lower()
    while True:
        idx = low.find(token_low, start)
        if idx < 0:
            break
        snippet = re.sub(r"\s+", " ", text[max(0, idx - width): idx + width])
        if snippet not in out:
            out.append(snippet)
        start = idx + len(token)
        if len(out) >= 8:
            break
    return out


def main() -> None:
    with httpx.Client(headers={"User-Agent": "Mozilla/5.0 OghmaProbe"}, timeout=30) as client:
        for url in URLS:
            text = client.get(url).text
            print("\nURL", url, "bytes", len(text))
            for token in TOKENS:
                contexts = _context(text, token)
                if contexts:
                    print("\nTOKEN", token)
                    for snippet in contexts[:5]:
                        print(snippet[:1800])
                        print("---")
            literals = sorted(set(re.findall(r"""["'`]([^"'`]{3,180})["'`]""", text)))
            print("\nLITERALS")
            for value in literals:
                if any(word in value.lower() for word in ["stories", "release", "story", "chapter", "separator"]):
                    print(value[:240])


if __name__ == "__main__":
    main()
