"""Conector Golden Novel.

O site e WordPress. As novels sao categorias filhas, os generos sao categorias
pai e os capitulos sao posts dentro da categoria da novel. A REST API publica
permite listar capitulos e baixar o HTML renderizado sem depender da UI.
"""
from __future__ import annotations

import json
import re
from html import unescape
from typing import Iterable
from urllib.parse import urljoin

from selectolax.parser import HTMLParser

from ..base import ChapterRef, NormalizedChapter, NovelMeta, NovelRef, RawPage
from ..normalize import normalize
from ..registry import register

_CHAPTER_NUM = re.compile(r"(?:chapter|chap\.?|ch\.?)\D*([0-9]+(?:[.,][0-9]+)?)", re.I)
_AUTHOR_RE = re.compile(r"(?:author|作者)\s*[:：]\s*(?P<author>[^\n\r<]+)", re.I)
_BR_RE = re.compile(r"<br\s*/?>", re.I)
_TAG_RE = re.compile(r"<[^>]+>")


def _attr(node, name: str) -> str | None:
    if node is None:
        return None
    value = node.attributes.get(name)
    return value.strip() if value else None


def _decode_json(raw: RawPage) -> object:
    return json.loads(raw.html.decode("utf-8", errors="ignore"))


def _clean_html_text(value: str | None) -> str:
    if not value:
        return ""
    value = _BR_RE.sub("\n", value)
    value = _TAG_RE.sub("", value)
    lines = [unescape(line).strip() for line in value.splitlines()]
    return "\n".join(line for line in lines if line)


def _chapter_number(title: str, slug: str, fallback: int) -> float:
    match = _CHAPTER_NUM.search(title) or _CHAPTER_NUM.search(slug)
    if match:
        try:
            return float(match.group(1).replace(",", "."))
        except ValueError:
            pass
    return float(fallback)


def _chapter_title(item: dict, fallback: int) -> str:
    title = item.get("title") if isinstance(item.get("title"), dict) else {}
    rendered = title.get("rendered")
    if isinstance(rendered, str) and rendered:
        return _clean_html_text(rendered) or f"Chapter {fallback:g}"
    return f"Chapter {fallback:g}"


class GoldenNovelConnector:
    id = "golden-novel"
    display_name = "Golden Novel"
    base_url = "https://goldennovel.com/"
    capabilities = {"wordpress_api", "static_html", "category_catalog"}
    rate_limit_seconds = 1.0

    CONTENT = "#golden-novel-content"

    headers = {
        "Accept": "application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.7,pt;q=0.6",
        "Referer": base_url,
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/149.0.0.0 Safari/537.36"
        ),
    }

    def __init__(self) -> None:
        self._categories_by_slug: dict[str, dict] = {}
        self._categories_by_id: dict[int, dict] = {}

    def _api_url(self, path: str) -> str:
        return urljoin(self.base_url, f"index.php/wp-json/wp/v2/{path.lstrip('/')}")

    def _post_api_url(self, post_id: int) -> str:
        return self._api_url(f"posts/{post_id}?_fields=id,slug,link,title,content,date")

    async def _get_json(self, fetcher, url: str) -> object:
        return _decode_json(await fetcher.get(url))

    async def _load_categories(self, fetcher, limit: int | None = None) -> list[dict]:
        if self._categories_by_slug:
            novels = [
                category
                for category in self._categories_by_slug.values()
                if self._is_novel_category(category)
            ]
            novels.sort(key=lambda item: str(item.get("name") or "").lower())
            return novels[:limit] if limit else novels

        page = 1
        while True:
            url = self._api_url(
                "categories?per_page=100"
                f"&page={page}"
                "&_fields=id,name,slug,count,parent,link,description"
            )
            data = await self._get_json(fetcher, url)
            items = data if isinstance(data, list) else []
            for item in items:
                if not isinstance(item, dict):
                    continue
                category_id = int(item.get("id") or 0)
                slug = item.get("slug")
                if category_id <= 0 or not isinstance(slug, str) or not slug:
                    continue
                self._categories_by_id[category_id] = item
                self._categories_by_slug[slug] = item
            if len(items) < 100:
                break
            page += 1

        novels = [
            category
            for category in self._categories_by_slug.values()
            if self._is_novel_category(category)
        ]
        novels.sort(key=lambda item: str(item.get("name") or "").lower())
        return novels[:limit] if limit else novels

    def _is_novel_category(self, category: dict) -> bool:
        return int(category.get("parent") or 0) > 0 and int(category.get("count") or 0) > 0

    def _ref_from_category(self, category: dict) -> NovelRef | None:
        slug = category.get("slug")
        link = category.get("link")
        if not isinstance(slug, str) or not slug or not isinstance(link, str) or not link:
            return None
        return NovelRef(self.id, slug, link)

    async def _category_for_ref(self, fetcher, ref: NovelRef) -> dict:
        cached = self._categories_by_slug.get(ref.slug)
        if cached:
            return cached
        data = await self._get_json(
            fetcher,
            self._api_url(
                f"categories?slug={ref.slug}&_fields=id,name,slug,count,parent,link,description"
            ),
        )
        if isinstance(data, list) and data and isinstance(data[0], dict):
            category = data[0]
            category_id = int(category.get("id") or 0)
            if category_id > 0:
                self._categories_by_id[category_id] = category
            self._categories_by_slug[ref.slug] = category
            return category
        return {"slug": ref.slug, "name": ref.slug.replace("-", " ").title(), "link": ref.url}

    def _genre_for_category(self, category: dict) -> str | None:
        parent_id = int(category.get("parent") or 0)
        parent = self._categories_by_id.get(parent_id)
        name = parent.get("name") if isinstance(parent, dict) else None
        return _clean_html_text(name) if isinstance(name, str) and name else None

    def _cover_from_html(self, html: bytes) -> str | None:
        tree = HTMLParser(html)
        cover = _attr(tree.css_first("#description .cover img, .cover img"), "src")
        cover = cover or _attr(tree.css_first("meta[property='og:image'], meta[name='twitter:image']"), "content")
        return cover

    async def discover_novels(self, fetcher, limit: int | None = None) -> Iterable[NovelRef]:
        refs: list[NovelRef] = []
        for category in await self._load_categories(fetcher, limit=limit):
            ref = self._ref_from_category(category)
            if ref is not None:
                refs.append(ref)
        return refs

    async def fetch_novel(self, fetcher, ref: NovelRef) -> NovelMeta:
        category = await self._category_for_ref(fetcher, ref)
        raw = await fetcher.get(ref.url)
        description = _clean_html_text(category.get("description") if isinstance(category.get("description"), str) else "")
        author_match = _AUTHOR_RE.search(description)
        author = author_match.group("author").strip() if author_match else None
        genre = self._genre_for_category(category)
        tags = [genre] if genre else []
        return NovelMeta(
            source_id=self.id,
            slug=ref.slug,
            title=_clean_html_text(str(category.get("name") or "")) or ref.slug.replace("-", " ").title(),
            url=ref.url,
            cover_url=self._cover_from_html(raw.html),
            description=description or None,
            author=author,
            tags=tags,
            status="ongoing",
            language="en",
            source_chapter_count=int(category.get("count") or 0) or None,
            extra={
                "golden_novel_category_id": int(category.get("id") or 0),
                "genre": genre,
            },
        )

    async def list_chapters(self, fetcher, novel: NovelMeta) -> list[ChapterRef]:
        category_id = int((novel.extra or {}).get("golden_novel_category_id") or 0)
        if category_id <= 0:
            category = await self._category_for_ref(fetcher, NovelRef(self.id, novel.slug, novel.url))
            category_id = int(category.get("id") or 0)
        if category_id <= 0:
            return []

        chapters: dict[float, ChapterRef] = {}
        page = 1
        fallback = 1
        while True:
            url = self._api_url(
                f"posts?categories={category_id}"
                "&per_page=100"
                f"&page={page}"
                "&orderby=date&order=asc"
                "&_fields=id,slug,link,title,date"
            )
            data = await self._get_json(fetcher, url)
            items = data if isinstance(data, list) else []
            for item in items:
                if not isinstance(item, dict):
                    continue
                post_id = int(item.get("id") or 0)
                slug = item.get("slug") if isinstance(item.get("slug"), str) else ""
                title = _chapter_title(item, fallback)
                number = _chapter_number(title, slug, fallback)
                if post_id <= 0 or number in chapters:
                    fallback += 1
                    continue
                chapters[number] = ChapterRef(
                    number=number,
                    title=title,
                    url=self._post_api_url(post_id),
                    published_at=item.get("date") if isinstance(item.get("date"), str) else None,
                )
                fallback += 1
            if len(items) < 100:
                break
            page += 1

        out = list(chapters.values())
        out.sort(key=lambda chapter: chapter.number)
        return out

    async def fetch_chapter(self, fetcher, url: str) -> RawPage:
        raw = await fetcher.get(url)
        try:
            data = _decode_json(raw)
        except json.JSONDecodeError:
            return raw
        if not isinstance(data, dict):
            return raw
        link = data.get("link")
        return RawPage(
            url=link if isinstance(link, str) and link else raw.url,
            html=raw.html,
            etag=raw.etag,
            last_modified=raw.last_modified,
            content_type=raw.content_type,
        )

    def normalize_chapter(self, raw: RawPage) -> NormalizedChapter:
        try:
            data = _decode_json(raw)
        except json.JSONDecodeError:
            return normalize(raw, ".content, article, main")
        if not isinstance(data, dict):
            return normalize(raw, ".content, article, main")
        content = data.get("content") if isinstance(data.get("content"), dict) else {}
        title = data.get("title") if isinstance(data.get("title"), dict) else {}
        rendered = content.get("rendered")
        if isinstance(rendered, str) and rendered.strip():
            html = f'<div id="golden-novel-content">{rendered}</div>'.encode("utf-8")
            return normalize(
                RawPage(url=raw.url, html=html),
                self.CONTENT,
                title=_clean_html_text(title.get("rendered") if isinstance(title.get("rendered"), str) else ""),
            )
        return normalize(raw, ".content, article, main")

    def expected_total_from_listing(self, html: bytes) -> int | None:
        try:
            data = json.loads(html.decode("utf-8", errors="ignore"))
        except json.JSONDecodeError:
            return None
        if not isinstance(data, list):
            return None
        return len([item for item in data if isinstance(item, dict) and self._is_novel_category(item)])


register(GoldenNovelConnector())
