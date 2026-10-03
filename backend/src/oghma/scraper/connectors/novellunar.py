"""NovelLunar: HTML metadata and reader, with a public chapter API."""
from __future__ import annotations

import math
import re
from html import escape
from typing import Iterable
from urllib.parse import urljoin, urlsplit

from selectolax.parser import HTMLParser

from ..base import ChapterRef, NormalizedChapter, NovelMeta, NovelRef, RawPage
from ..normalize import chapter_problem, normalize
from ..registry import register


class NovelLunarConnector:
    id = "novellunar"
    display_name = "NovelLunar"
    base_url = "https://novellunar.com/"
    capabilities = {"api_available", "paginated_listing"}
    rate_limit_seconds = 1.5
    NOVEL_TITLE = "h1.text-2xl"
    NOVEL_DESC = "p.whitespace-pre-wrap"
    CONTENT = 'article > div[style*="white-space:pre-wrap"]'

    def ref_from_url(self, url: str) -> NovelRef | None:
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or parsed.netloc.lower() != "novellunar.com":
            return None
        match = re.fullmatch(r"/novel/([\w-]+)/?", parsed.path)
        if not match:
            return None
        slug = match.group(1)
        return NovelRef(self.id, slug, f"{self.base_url}novel/{slug}")

    async def discover_novels(self, fetcher, limit: int | None = None) -> Iterable[NovelRef]:
        if limit is not None and limit <= 0:
            return []
        found: dict[str, NovelRef] = {}
        page = 1
        while True:
            raw = await fetcher.get(f"{self.base_url}new?page={page}")
            tree = HTMLParser(raw.html)
            previous_count = len(found)
            for link in tree.css('div.grid a[href^="/novel/"]'):
                ref = self.ref_from_url(urljoin(self.base_url, link.attributes.get("href", "")))
                if ref:
                    found.setdefault(ref.slug, ref)
                    if limit is not None and len(found) >= limit:
                        return list(found.values())
            if len(found) == previous_count or not tree.css_first(f'a[href="/new?page={page + 1}"]'):
                return list(found.values())
            page += 1

    async def fetch_novel(self, fetcher, ref: NovelRef) -> NovelMeta:
        raw = await fetcher.get(ref.url)
        tree = HTMLParser(raw.html)
        title = tree.css_first(self.NOVEL_TITLE)
        if title is None or not title.text(strip=True):
            raise ValueError(f"NovelLunar novel missing: {ref.url}")
        details = title.parent.parent.parent
        author = details.css_first('a[href^="/author/"]')
        cover = details.css_first("img")
        badge = details.css_first("div.relative > span")
        status_text = badge.text(strip=True).lower() if badge else "ongoing"
        status = {"completed": "complete", "complete": "complete", "hiatus": "paused"}.get(status_text, "ongoing")
        description = tree.css_first(self.NOVEL_DESC)
        tags = []
        for heading in tree.css("h3"):
            if heading.text(strip=True) == "Tags":
                tags = list(dict.fromkeys(a.text(strip=True) for a in heading.parent.css("a")))
                break
        count = re.search(r"(\d+)\s+chapters", details.text(separator=" ", strip=True))
        return NovelMeta(
            source_id=self.id, slug=ref.slug, title=title.text(strip=True), url=ref.url,
            cover_url=urljoin(self.base_url, cover.attributes["src"]) if cover and cover.attributes.get("src") else None,
            description=description.text() if description else None,
            author=author.text(strip=True) if author else None,
            tags=tags, status=status, language="en",
            source_chapter_count=int(count.group(1)) if count else None,
        )

    async def list_chapters(self, fetcher, novel: NovelMeta) -> list[ChapterRef]:
        chapters: dict[float, ChapterRef] = {}
        page = 1
        while True:
            data = await fetcher.get_json(
                f"{self.base_url}api/novels/chapters",
                params={"novelSlug": novel.slug, "page": page, "limit": 50, "sort": "asc"},
            )
            if not isinstance(data, dict) or not isinstance(data.get("data"), list):
                raise ValueError(f"Invalid NovelLunar chapter listing: {novel.slug}, page {page}")
            items = data["data"]
            previous_count = len(chapters)
            for item in items:
                number = float(item["chapterNumber"])
                if not math.isfinite(number) or number < 0:
                    raise ValueError("Invalid NovelLunar chapter number")
                chapters.setdefault(number, ChapterRef(
                    number=number, title=item.get("title") or f"Chapter {number:g}",
                    url=f"{self.base_url}novel/{novel.slug}/chapter/{number:g}",
                    published_at=item.get("createdAt"),
                ))
            if len(items) < 50:
                return sorted(chapters.values(), key=lambda chapter: chapter.number)
            if len(chapters) == previous_count:
                raise ValueError(f"Repeated NovelLunar chapter page: {page}")
            page += 1

    async def fetch_chapter(self, fetcher, url: str) -> RawPage:
        return await fetcher.get(url)

    def normalize_chapter(self, raw: RawPage) -> NormalizedChapter:
        tree = HTMLParser(raw.html)
        content = tree.css_first(self.CONTENT)
        if content is None:
            raise ValueError(f"NovelLunar chapter content missing: {raw.url}")
        for noise in content.css("script, style, ins, iframe, nav, button"):
            noise.decompose()
        text = content.text(separator="").replace("\r\n", "\n").strip()
        paragraphs = re.split(r"\n\s*\n", text)
        html = '<div id="chapter-content">' + "".join(f"<p>{escape(p.strip())}</p>" for p in paragraphs if p.strip()) + "</div>"
        normalized = normalize(RawPage(url=raw.url, html=html.encode("utf-8")), "#chapter-content")
        if chapter_problem(normalized.html):
            raise ValueError(f"NovelLunar chapter is empty or a placeholder: {raw.url}")
        return normalized


register(NovelLunarConnector())
