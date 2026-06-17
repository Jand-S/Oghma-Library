"""Probe manual do Novel Mania sem gravar no banco.

Uso no container/servidor:
PYTHONPATH=src python tests/probe_novel_mania_live.py
"""
from __future__ import annotations

import asyncio
import json

from oghma.scraper.connectors.novel_mania import NovelManiaConnector
from oghma.scraper.fetcher import HttpFetcher


async def main() -> None:
    connector = NovelManiaConnector()
    fetcher = HttpFetcher(connector.rate_limit_seconds)
    try:
        refs = list(await connector.discover_novels(fetcher, limit=5))
        print(json.dumps(
            {
                "discovered": len(refs),
                "refs": [{"slug": ref.slug, "url": ref.url} for ref in refs],
            },
            ensure_ascii=False,
            indent=2,
        ))
        for ref in refs[:2]:
            meta = await connector.fetch_novel(fetcher, ref)
            chapters = await connector.list_chapters(fetcher, meta)
            normalized = None
            if chapters:
                raw = await connector.fetch_chapter(fetcher, chapters[0].url)
                norm = connector.normalize_chapter(raw)
                normalized = {
                    "first_chapter_words": norm.word_count,
                    "first_chapter_html_sample": norm.html[:240],
                }
            print(json.dumps(
                {
                    "slug": ref.slug,
                    "title": meta.title,
                    "cover": bool(meta.cover_url),
                    "tags": meta.tags[:5],
                    "chapters": len(chapters),
                    "chapter_sample": [
                        {"number": chapter.number, "title": chapter.title, "url": chapter.url}
                        for chapter in chapters[:3]
                    ],
                    "normalized": normalized,
                },
                ensure_ascii=False,
                indent=2,
            ))
    finally:
        await fetcher.aclose()


if __name__ == "__main__":
    asyncio.run(main())
