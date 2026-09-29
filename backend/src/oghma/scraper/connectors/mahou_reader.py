"""Conector Mahou Reader.

O site e um app Next.js: catalogo, detalhe da obra e capitulos vem
serializados no `__NEXT_DATA__` das paginas publicas. A API de EPUB exige
sessao, entao mantemos o pipeline padrao do Oghma: capitulos HTML por faixa.
"""
from __future__ import annotations

import json
import re
from typing import Iterable
from urllib.parse import urljoin, urlsplit

from selectolax.parser import HTMLParser

from ..base import ChapterRef, NormalizedChapter, NovelMeta, NovelRef, RawPage
from ..normalize import normalize
from ..registry import register

_NEXT_DATA_RE = re.compile(
    r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(?P<json>.*?)</script>',
    re.S | re.I,
)


def _attr(node, name: str) -> str | None:
    if node is None:
        return None
    value = node.attributes.get(name)
    return value.strip() if value else None


def _next_data(html: bytes) -> dict:
    text = html.decode("utf-8", errors="ignore")
    match = _NEXT_DATA_RE.search(text)
    if not match:
        return {}
    try:
        data = json.loads(match.group("json"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _page_props(html: bytes) -> dict:
    data = _next_data(html)
    props = data.get("props") if isinstance(data.get("props"), dict) else {}
    page_props = props.get("pageProps") if isinstance(props.get("pageProps"), dict) else {}
    return page_props


def _as_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _as_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _status(value) -> str:
    status = _as_int(value)
    if status == 3:
        return "complete"
    if status == 1:
        return "paused"
    return "ongoing"


class MahouReaderConnector:
    id = "mahou-reader"
    display_name = "Mahou Reader"
    base_url = "https://mahoureader.com/"
    capabilities = {"next_data", "static_html", "catalog_listing"}
    rate_limit_seconds = 1.0

    CONTENT = "body"

    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.7,en;q=0.6",
        "Referer": base_url,
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/149.0.0.0 Safari/537.36"
        ),
    }

    def _works_url(self) -> str:
        return urljoin(self.base_url, "works")

    def _series_url(self, serie_id: int, slug: str) -> str:
        return urljoin(self.base_url, f"series/{serie_id}/{slug}")

    def _chapter_url(self, serie_id: int, chapter_id: int) -> str:
        return urljoin(self.base_url, f"series/{serie_id}/ler/{chapter_id}")

    def _series_id_from_url(self, url: str) -> int:
        parts = [part for part in urlsplit(url).path.split("/") if part]
        if len(parts) >= 2 and parts[0] == "series":
            return _as_int(parts[1])
        return 0

    def _cover_url(self, serie: dict) -> str | None:
        serie_id = _as_int(serie.get("id"))
        image = serie.get("posterImage") or serie.get("coverImage")
        if not isinstance(image, str) or not image:
            return None
        if image.startswith(("http://", "https://")):
            return image
        if serie_id <= 0:
            return None
        return f"https://cdn.mahoureader.com/series/{serie_id}/{image.lstrip('/')}"

    def _ref_from_series(self, serie: dict) -> NovelRef | None:
        if serie.get("mediaType") != "NOVEL":
            return None
        serie_id = _as_int(serie.get("id"))
        slug = serie.get("slug")
        if serie_id <= 0 or not isinstance(slug, str) or not slug:
            return None
        return NovelRef(self.id, slug, self._series_url(serie_id, slug))

    def _meta_from_payload(self, serie: dict, ratings: dict | None, ref: NovelRef) -> NovelMeta:
        ratings = ratings or {}
        authors: list[str] = []
        for author in serie.get("authors") or []:
            if not isinstance(author, dict):
                continue
            name = author.get("name")
            if isinstance(name, str) and name and name not in authors:
                authors.append(name)

        tags: list[str] = []
        for genre in serie.get("genres") or []:
            if not isinstance(genre, dict):
                continue
            name = genre.get("name") or genre.get("text")
            if isinstance(name, str) and name and name not in tags:
                tags.append(name)

        serie_id = _as_int(serie.get("id") or self._series_id_from_url(ref.url))
        chapter_count = serie.get("chaptersCount")
        if chapter_count is None and isinstance(serie.get("_count"), dict):
            chapter_count = serie["_count"].get("chapters")

        return NovelMeta(
            source_id=self.id,
            slug=ref.slug,
            title=str(serie.get("title") or ref.slug.replace("-", " ").title()).strip(),
            url=ref.url,
            cover_url=self._cover_url(serie),
            description=(
                serie.get("synopsis")
                if isinstance(serie.get("synopsis"), str) and serie.get("synopsis")
                else serie.get("description")
                if isinstance(serie.get("description"), str)
                else None
            ),
            author=", ".join(authors) or None,
            tags=tags[:16],
            status=_status(serie.get("status")),
            language="pt-BR",
            source_chapter_count=_as_int(chapter_count) or None,
            extra={
                "mahou_reader_id": serie_id,
                "media_type": serie.get("mediaType"),
                "subtype": serie.get("subtype"),
                "released_at": serie.get("releasedAt"),
                "adult": bool(serie.get("adult")),
                "rating": _as_float(ratings.get("averageRating")),
                "ratings_count": _as_int(ratings.get("ratingsCount")),
                "favorites": _as_int(ratings.get("favorites")),
                "views": _as_int(serie.get("views")),
                "monthly_views": _as_int(ratings.get("monthlyViews")),
            },
        )

    async def discover_novels(self, fetcher, limit: int | None = None) -> Iterable[NovelRef]:
        raw = await fetcher.get(self._works_url())
        series = _page_props(raw.html).get("series")
        found: dict[str, NovelRef] = {}
        if isinstance(series, list):
            for item in series:
                if not isinstance(item, dict):
                    continue
                ref = self._ref_from_series(item)
                if ref is None:
                    continue
                found.setdefault(ref.slug, ref)
                if limit and len(found) >= limit:
                    break
        return list(found.values())

    async def fetch_novel(self, fetcher, ref: NovelRef) -> NovelMeta:
        raw = await fetcher.get(ref.url)
        props = _page_props(raw.html)
        serie = props.get("serie") if isinstance(props.get("serie"), dict) else None
        if serie is not None:
            ratings = props.get("ratings") if isinstance(props.get("ratings"), dict) else {}
            return self._meta_from_payload(serie, ratings, ref)

        tree = HTMLParser(raw.html)
        title = tree.css_first("h1")
        description = tree.css_first("meta[name='description'], meta[property='og:description']")
        cover = _attr(tree.css_first("meta[property='og:image'], meta[name='twitter:image']"), "content")
        return NovelMeta(
            source_id=self.id,
            slug=ref.slug,
            title=(title.text(separator=" ", strip=True) if title else ref.slug.replace("-", " ").title()),
            url=ref.url,
            cover_url=cover,
            description=_attr(description, "content"),
            language="pt-BR",
        )

    async def list_chapters(self, fetcher, novel: NovelMeta) -> list[ChapterRef]:
        raw = await fetcher.get(novel.url)
        props = _page_props(raw.html)
        serie = props.get("serie") if isinstance(props.get("serie"), dict) else {}
        serie_id = _as_int(serie.get("id") or self._series_id_from_url(novel.url))
        chapters: dict[float, ChapterRef] = {}
        for item in serie.get("chapters") or []:
            if not isinstance(item, dict):
                continue
            chapter_id = _as_int(item.get("id"))
            number = _as_float(item.get("index"), -1.0)
            if chapter_id <= 0 or number < 0:
                continue
            title = item.get("name") if isinstance(item.get("name"), str) and item.get("name") else None
            chapters.setdefault(
                number,
                ChapterRef(
                    number=number,
                    title=title or f"Capitulo {number:g}",
                    url=self._chapter_url(serie_id, chapter_id),
                    published_at=item.get("createdAt") if isinstance(item.get("createdAt"), str) else None,
                ),
            )
        out = list(chapters.values())
        out.sort(key=lambda chapter: chapter.number)
        return out

    async def fetch_chapter(self, fetcher, url: str) -> RawPage:
        return await fetcher.get(url)

    def normalize_chapter(self, raw: RawPage) -> NormalizedChapter:
        props = _page_props(raw.html)
        chapter = props.get("chapter") if isinstance(props.get("chapter"), dict) else {}
        novel_chapter = chapter.get("novelChapter") if isinstance(chapter.get("novelChapter"), dict) else {}
        content = novel_chapter.get("content")
        if isinstance(content, str) and content.strip():
            title = f"Capitulo {_as_float(chapter.get('index')):g}"
            if isinstance(chapter.get("name"), str) and chapter["name"]:
                title = chapter["name"]
            html = f'<div id="mahou-reader-content">{content}</div>'.encode("utf-8")
            return normalize(RawPage(url=raw.url, html=html), "#mahou-reader-content", title=title)
        return normalize(raw, ".chapter-section", title="")

    def expected_total_from_listing(self, html: bytes) -> int | None:
        series = _page_props(html).get("series")
        if isinstance(series, list):
            return len([item for item in series if isinstance(item, dict) and item.get("mediaType") == "NOVEL"])
        return None


register(MahouReaderConnector())
