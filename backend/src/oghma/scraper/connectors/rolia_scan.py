"""Conector RoliaScan.

O catalogo usa uma API WordPress com POST e filtro por tipo. Os capitulos usam
um endpoint publico com token horario calculado no frontend.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import time
from html import unescape
from typing import Iterable
from urllib.parse import urlencode, urljoin, urlparse

from selectolax.parser import HTMLParser, Node

from ..base import ChapterRef, NormalizedChapter, NovelMeta, NovelRef, RawPage
from ..normalize import normalize
from ..registry import register
from ._common import attr as _attr

_SPACE_RE = re.compile(r"\s+")
_MANGA_RE = re.compile(r"^/manga/(?P<slug>[^/?#]+)/?$")
_READ_RE = re.compile(r"/read/(?P<slug>[^/]+)/")



def _text(node: Node | None) -> str:
    if node is None:
        return ""
    return _clean_text(node.text(separator=" "))


def _clean_text(value: str | None) -> str:
    if not value:
        return ""
    return _SPACE_RE.sub(" ", unescape(value)).strip()


def _as_int(value, default: int = 0) -> int:
    try:
        return int(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return default


def _as_float(value, default: float = 0.0) -> float:
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return default


def _meta(tree: HTMLParser, key: str) -> str | None:
    for selector in (
        f"meta[property='{key}']",
        f'meta[property="{key}"]',
        f"meta[name='{key}']",
        f'meta[name="{key}"]',
    ):
        value = _attr(tree.css_first(selector), "content")
        if value:
            return value
    return None


def _slug_from_url(url: str) -> str | None:
    match = _MANGA_RE.match(urlparse(url).path)
    return match.group("slug") if match else None


def _status(value: str | None) -> str:
    text = (value or "").lower()
    if any(token in text for token in ("complete", "completed")):
        return "complete"
    if any(token in text for token in ("hiatus", "pause", "paused", "dropped")):
        return "paused"
    return "ongoing"


def _book_jsonld(html: bytes) -> dict:
    tree = HTMLParser(html)
    for node in tree.css("script[type='application/ld+json'], script[type=\"application/ld+json\"]"):
        raw = node.text(strip=True)
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        candidates = data if isinstance(data, list) else [data]
        for item in candidates:
            if isinstance(item, dict) and item.get("@type") == "Book":
                return item
    return {}


class RoliaScanConnector:
    id = "rolia-scan"
    display_name = "RoliaScan"
    base_url = "https://roliascan.com/"
    capabilities = {"wordpress_rest", "chapter_api", "static_html"}
    rate_limit_seconds = 1.0

    PRIORITY_REFS = [
        NovelRef(id, "unsheathed-novel", "https://roliascan.com/manga/unsheathed-novel/"),
    ]
    CONTENT = ".reader-text"

    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.7,pt;q=0.6",
        "Referer": base_url,
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/149.0.0.0 Safari/537.36"
        ),
    }

    def _catalog_url(self) -> str:
        return urljoin(self.base_url, "wp-json/manga/v1/load")

    def _catalog_body(self, page: int) -> dict:
        return {
            "page": page,
            "search": "",
            "years": "[]",
            "genres": "[]",
            "types": json.dumps(["Novel"]),
            "statuses": "[]",
            "sort": "post_desc",
            "genreMatchMode": "any",
        }

    def _chapter_token(self) -> tuple[str, int]:
        timestamp = int(time.time())
        hour = dt.datetime.now(dt.UTC).strftime("%Y%m%d%H")
        token = hashlib.md5(f"{timestamp}mng_ch_{hour}".encode("utf-8")).hexdigest()[:16]
        return token, timestamp

    def _chapters_url(self, manga_id: int, offset: int = 0, limit: int = 500) -> str:
        token, timestamp = self._chapter_token()
        query = urlencode(
            {
                "manga_id": manga_id,
                "offset": offset,
                "limit": limit,
                "order": "ASC",
                "_t": token,
                "_ts": timestamp,
            }
        )
        return urljoin(self.base_url, f"auth/manga-chapters?{query}")

    def _ref_from_item(self, item: dict) -> NovelRef | None:
        if item.get("type") != "Novel":
            return None
        url = item.get("url")
        slug = _slug_from_url(url) if isinstance(url, str) else None
        if not slug or not isinstance(url, str):
            return None
        return NovelRef(self.id, slug, url)

    async def discover_novels(self, fetcher, limit: int | None = None) -> Iterable[NovelRef]:
        refs: list[NovelRef] = []
        seen: set[str] = set()

        def add(ref: NovelRef) -> bool:
            if ref.slug in seen:
                return False
            seen.add(ref.slug)
            refs.append(ref)
            return limit is not None and len(refs) >= limit

        for ref in self.PRIORITY_REFS:
            if add(ref):
                return refs

        for page in range(1, 1000):
            payload = await fetcher.post_json(self._catalog_url(), self._catalog_body(page))
            if not isinstance(payload, list) or not payload:
                break
            page_added = 0
            for item in payload:
                if not isinstance(item, dict):
                    continue
                ref = self._ref_from_item(item)
                if ref is None:
                    continue
                page_added += 1
                if add(ref):
                    return refs
            if page_added == 0:
                break
        return refs

    async def fetch_novel(self, fetcher, ref: NovelRef) -> NovelMeta:
        raw = await fetcher.get(ref.url)
        tree = HTMLParser(raw.html)
        book = _book_jsonld(raw.html)

        title = _text(tree.css_first("h1"))
        if not title:
            title = _clean_text(str(book.get("name") or ""))
            title = re.sub(r"\s*\|\s*Read Online Free at roliascan\.com\s*$", "", title)
            title = re.sub(r"\s+Novel\s*$", "", title)
        title = title or ref.slug.replace("-", " ").title()

        author = None
        author_obj = book.get("author")
        if isinstance(author_obj, dict):
            author = _clean_text(str(author_obj.get("name") or ""))
        elif isinstance(author_obj, str):
            author = _clean_text(author_obj)

        tags: list[str] = []
        for node in tree.css("a[href*='/tag/']"):
            tag = _text(node)
            if tag and tag not in tags:
                tags.append(tag)

        manga_id = self._manga_id(tree)
        views = _as_int(_text(tree.css_first(".view-info")))
        rating, votes = self._rating(tree, book)

        return NovelMeta(
            source_id=self.id,
            slug=ref.slug,
            title=title,
            url=ref.url,
            cover_url=_meta(tree, "og:image") or (str(book.get("image")) if book.get("image") else None),
            description=_clean_text(str(book.get("description") or "")) or _meta(tree, "og:description"),
            author=author or None,
            tags=tags[:24],
            status=_status(str(book.get("status") or _text(tree.css_first(".status-info")))),
            language="en",
            source_chapter_count=_as_int(book.get("numberOfEpisodes")) or _as_int(_text(tree.css_first(".chapter-count")) or None) or None,
            extra={
                "rolia_scan_manga_id": manga_id,
                "type": "Novel",
                "views": views,
                "rating": rating,
                "rating_votes": votes,
                "date_published": book.get("datePublished"),
                "date_modified": book.get("dateModified"),
            },
        )

    def _manga_id(self, tree: HTMLParser) -> int:
        for selector in ("[data-manga-id]", ".chapter-list[data-manga-id]", ".add-to-library[data-manga-id]"):
            node = tree.css_first(selector)
            manga_id = _as_int(_attr(node, "data-manga-id"))
            if manga_id:
                return manga_id
        return 0

    def _rating(self, tree: HTMLParser, book: dict | None = None) -> tuple[float | None, int | None]:
        aggregate = book.get("aggregateRating") if isinstance(book, dict) else None
        if isinstance(aggregate, dict):
            rating = _as_float(aggregate.get("ratingValue"), -1.0)
            votes = _as_int(aggregate.get("ratingCount") or aggregate.get("reviewCount"), -1)
            if rating >= 0:
                return rating, votes if votes >= 0 else None
        rating = _as_float(_attr(tree.css_first("[data-rating]"), "data-rating"), -1.0)
        votes = _as_int(_attr(tree.css_first("[data-votes]"), "data-votes"), -1)
        text = _text(tree.css_first(".rating-info, .rating, .rating-badge"))
        match = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*/\s*5(?:\s*\((\d+)\))?", text)
        if match:
            rating = _as_float(match.group(1), rating)
            votes = _as_int(match.group(2), votes)
        return (rating if rating >= 0 else None, votes if votes >= 0 else None)

    async def list_chapters(self, fetcher, novel: NovelMeta) -> list[ChapterRef]:
        manga_id = _as_int((novel.extra or {}).get("rolia_scan_manga_id"))
        if not manga_id:
            meta = await self.fetch_novel(fetcher, NovelRef(self.id, novel.slug, novel.url))
            manga_id = _as_int(meta.extra.get("rolia_scan_manga_id"))
        if not manga_id:
            return []

        chapters: dict[float, ChapterRef] = {}
        offset = 0
        limit = 500
        while True:
            url = self._chapters_url(manga_id, offset=offset, limit=limit)
            payload = await fetcher.get_json(url)
            items = None
            if isinstance(payload, dict):
                items = payload.get("chapters")
                if not isinstance(items, list):
                    items = payload.get("data")
            if not isinstance(items, list):
                break
            if not items:
                break
            for item in items:
                if not isinstance(item, dict):
                    continue
                chapter_url = item.get("url")
                if not isinstance(chapter_url, str) or not chapter_url:
                    continue
                number = _as_float(item.get("chapter"), float(len(chapters) + 1))
                while number in chapters:
                    number = round(number + 0.01, 2)
                title = _clean_text(str(item.get("title") or "")) or f"Chapter {number:g}"
                chapters[number] = ChapterRef(
                    number=number,
                    title=title,
                    url=chapter_url,
                    published_at=item.get("date") if isinstance(item.get("date"), str) else None,
                )
            has_more = bool(payload.get("has_more")) if isinstance(payload, dict) else len(items) >= limit
            if not has_more:
                break
            offset += limit

        out = list(chapters.values())
        out.sort(key=lambda chapter: chapter.number)
        return out

    async def fetch_chapter(self, fetcher, url: str) -> RawPage:
        return await fetcher.get(url)

    def normalize_chapter(self, raw: RawPage) -> NormalizedChapter:
        tree = HTMLParser(raw.html)
        title = _text(tree.css_first("h1"))
        if not title:
            title = _clean_text(_meta(tree, "og:title")) or ""
            title = re.sub(r"\s*-\s*.*$", "", title)
        return normalize(raw, self.CONTENT, title=title)

    def expected_total_from_listing(self, html: bytes) -> int | None:
        text = html.decode("utf-8", errors="ignore")
        match = _READ_RE.search(text)
        if match:
            return 1
        return None


register(RoliaScanConnector())
