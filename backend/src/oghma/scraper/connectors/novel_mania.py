"""Conector Novel Mania.

O site novo da Novel Mania serve a listagem `/novels` com HTML renderizado,
mas paginas internas podem depender de payload de frontend. Por isso este
conector combina seletores HTML com regex no HTML bruto/hidratado e falha de
forma conservadora quando capitulos nao aparecem sem API/headless.
"""
from __future__ import annotations

import re
import json
from typing import Iterable, Optional
from urllib.parse import urljoin, urlsplit

from selectolax.parser import HTMLParser

from ..base import ChapterRef, NormalizedChapter, NovelMeta, NovelRef, RawPage
from ..normalize import normalize
from ..registry import register

_NOVEL_HREF = re.compile(
    r"(?P<url>(?:https?://novelmania\.com\.br)?/novels/(?P<slug>[a-z0-9][a-z0-9._-]*))"
    r"(?=$|[/?#\"' <\\])",
    re.I,
)
_CHAPTER_NUM = re.compile(
    r"(?:cap(?:itulo|\u00edtulo|\.)?|chapter|ch\.?)\D*([0-9]+(?:[.,][0-9]+)?)",
    re.I,
)
_LAST_SEGMENT_NUMBER = re.compile(r"([0-9]+)(?:[-,.]([0-9]+))?$")
_TOTAL_RE = re.compile(r"([0-9][0-9.]*)\s+novels?\s+encontrad", re.I)
_SERIALIZED_CONTENT_RE = re.compile(r'content:"((?:\\.|[^"\\])*)"', re.S)
_IGNORED_SLUGS = {"novels", "search", "login", "entrar"}
_IGNORED_CHAPTER_SEGMENTS = {
    "avaliacoes",
    "comments",
    "comentarios",
    "reviews",
    "similar",
    "similares",
}


def _decode(html: bytes) -> str:
    return html.decode("utf-8", errors="ignore").replace("\\/", "/")


def _first_text(tree: HTMLParser, selector: str) -> Optional[str]:
    node = tree.css_first(selector)
    if node is None:
        return None
    text = node.text(separator=" ", strip=True)
    return text or None


def _attr(node, name: str) -> Optional[str]:
    if node is None:
        return None
    value = node.attributes.get(name)
    return value.strip() if value else None


def _meta_content(tree: HTMLParser, *names: str) -> Optional[str]:
    for name in names:
        node = tree.css_first(f"meta[property='{name}'], meta[name='{name}']")
        value = _attr(node, "content")
        if value:
            return value
    return None


def _clean_title(value: str, fallback: str) -> str:
    title = re.sub(r"^\s*Novel\s+", "", value, flags=re.I)
    title = re.sub(r"\s*(?:\u2022|-)\s*Novel Mania\s*$", "", title, flags=re.I).strip()
    return title or fallback


def _normalize_status(text: str) -> str:
    lowered = text.lower()
    if "complet" in lowered or "conclu" in lowered or "finaliz" in lowered:
        return "complete"
    if "paus" in lowered or "hiato" in lowered:
        return "paused"
    return "ongoing"


def _chapter_number(href: str, text: str) -> float | None:
    text_match = _CHAPTER_NUM.search(text)
    if text_match:
        return float(text_match.group(1).replace(",", "."))

    last_segment = urlsplit(href).path.rstrip("/").split("/")[-1]
    slug_match = _CHAPTER_NUM.search(last_segment)
    if slug_match:
        return float(slug_match.group(1).replace(",", "."))

    number_match = _LAST_SEGMENT_NUMBER.search(last_segment)
    if not number_match:
        return None
    whole, decimal = number_match.groups()
    return float(f"{whole}.{decimal}" if decimal else whole)


def _chapter_title(text: str, number: float) -> str:
    compact = " ".join(text.split())
    return compact or f"Capitulo {number:g}"


def _decode_js_string(value: str) -> str:
    json_compatible = re.sub(r"\\x([0-9a-fA-F]{2})", r"\\u00\1", value)
    try:
        return json.loads(f'"{json_compatible}"')
    except json.JSONDecodeError:
        return ""


def _extract_serialized_content(html: bytes) -> str:
    text = _decode(html)
    candidates: list[str] = []
    for match in _SERIALIZED_CONTENT_RE.finditer(text):
        decoded = _decode_js_string(match.group(1))
        lowered = decoded.lower()
        if any(tag in lowered for tag in ("<p", "<h1", "<h2", "<blockquote", "<img")):
            candidates.append(decoded)
    if not candidates:
        return ""
    return max(candidates, key=len)


class NovelManiaConnector:
    id = "novel-mania"
    display_name = "Novel Mania"
    base_url = "https://novelmania.com.br/"
    capabilities = {"api_available", "static_html", "hydrated_html", "paginated_listing"}
    rate_limit_seconds = 2.5

    LISTING = "a[href*='/novels/']"
    NOVEL_TITLE = "h1, [data-testid='novel-title'], [class*='title'], title"
    NOVEL_COVER = "main img, article img, img[alt*='capa'], img[src*='cover'], img[src*='uploads']"
    NOVEL_DESC = (
        "[data-testid='synopsis'], [class*='synopsis'], [class*='description'], "
        "section p, article p"
    )
    NOVEL_TAG = (
        "a[href*='/genres/'], a[href*='/generos/'], a[href*='/categories/'], "
        "a[href*='/categorias/'], [class*='badge'], [class*='tag']"
    )
    NOVEL_STATUS = "[class*='status'], [data-testid='status']"
    CHAPTER_ITEM = "a[href*='/novels/']"
    CONTENT = (
        "[data-slot='prose-content'], [class*='ProseContent'], article, "
        "main [class*='chapter'], main [class*='reader'], main [class*='content'], main"
    )

    def _api_url(self, path: str) -> str:
        return urljoin(self.base_url, f"api/{path.lstrip('/')}")

    def _novel_url(self, slug: str) -> str:
        return urljoin(self.base_url, f"novels/{slug}")

    def _chapter_url(self, novel_slug: str, chapter_slug: str) -> str:
        return urljoin(self.base_url, f"novels/{novel_slug}/capitulos/{chapter_slug}")

    def _catalog_urls(self, limit: int | None) -> list[str]:
        max_pages = 1 if limit else 30
        return [urljoin(self.base_url, "novels")] + [
            urljoin(self.base_url, f"novels?page={page}") for page in range(2, max_pages + 1)
        ]

    def _parse_novel_refs(self, html: bytes) -> list[NovelRef]:
        tree = HTMLParser(html)
        found: dict[str, NovelRef] = {}

        def add(href: str) -> None:
            absolute = urljoin(self.base_url, href)
            match = _NOVEL_HREF.search(absolute)
            if not match:
                return
            slug = match.group("slug")
            if slug in _IGNORED_SLUGS or slug in found:
                return
            found[slug] = NovelRef(self.id, slug, self._novel_url(slug))

        for link in tree.css(self.LISTING):
            href = _attr(link, "href")
            if href:
                add(href)

        # Frameworks como Next/Remix podem serializar links nos scripts.
        for match in _NOVEL_HREF.finditer(_decode(html)):
            add(match.group("url"))

        return list(found.values())

    async def _get_json(self, fetcher, url: str) -> dict:
        raw = await fetcher.get(url)
        data = json.loads(raw.html.decode("utf-8", errors="ignore"))
        return data if isinstance(data, dict) else {}

    def _ref_from_api_novel(self, item: dict) -> NovelRef | None:
        slug = item.get("slug")
        if not isinstance(slug, str) or not slug:
            return None
        return NovelRef(self.id, slug, self._novel_url(slug))

    def _meta_from_api_novel(self, item: dict, ref: NovelRef) -> NovelMeta:
        category = item.get("category") if isinstance(item.get("category"), dict) else {}
        tags: list[str] = []
        for value in [category.get("name"), item.get("kind"), item.get("nationality")]:
            if isinstance(value, str) and value and value not in tags:
                tags.append(value)
        for category_item in item.get("categories") or []:
            if not isinstance(category_item, dict):
                continue
            name = category_item.get("name")
            if isinstance(name, str) and name and name not in tags:
                tags.append(name)

        cover = item.get("cover") if isinstance(item.get("cover"), dict) else {}
        cover_url = cover.get("original") or cover.get("large") or cover.get("small") or cover.get("thumb")
        return NovelMeta(
            source_id=self.id,
            slug=ref.slug,
            title=str(item.get("title") or ref.slug.replace("-", " ").title()),
            url=ref.url,
            cover_url=cover_url if isinstance(cover_url, str) else None,
            description=item.get("synopsis") if isinstance(item.get("synopsis"), str) else None,
            author=item.get("author") if isinstance(item.get("author"), str) else None,
            tags=tags[:12],
            status=_normalize_status(str(item.get("status") or "")),
            language="pt-BR",
        )

    async def discover_novels(self, fetcher, limit: int | None = None) -> Iterable[NovelRef]:
        found: dict[str, NovelRef] = {}
        try:
            page = 1
            while True:
                data = await self._get_json(fetcher, self._api_url(f"novels?page={page}&items=100"))
                items = data.get("data") if isinstance(data.get("data"), list) else []
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    ref = self._ref_from_api_novel(item)
                    if ref is None:
                        continue
                    found.setdefault(ref.slug, ref)
                    if limit and len(found) >= limit:
                        return list(found.values())
                meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
                pages = int(meta.get("pages") or page)
                if page >= pages or not items:
                    return list(found.values())
                page += 1
        except Exception:
            found.clear()

        stagnant_pages = 0
        for url in self._catalog_urls(limit):
            before = len(found)
            try:
                raw = await fetcher.get(url)
            except Exception:
                break
            for ref in self._parse_novel_refs(raw.html):
                found.setdefault(ref.slug, ref)
                if limit and len(found) >= limit:
                    return list(found.values())
            stagnant_pages = stagnant_pages + 1 if len(found) == before else 0
            if stagnant_pages >= 1:
                break
        return list(found.values())

    async def fetch_novel(self, fetcher, ref: NovelRef) -> NovelMeta:
        try:
            data = await self._get_json(fetcher, self._api_url(f"novels/{ref.slug}"))
            item = data.get("data")
            if isinstance(item, dict):
                return self._meta_from_api_novel(item, ref)
        except Exception:
            pass

        raw = await fetcher.get(ref.url)
        tree = HTMLParser(raw.html)
        fallback_title = ref.slug.replace("-", " ").title()
        title = _first_text(tree, self.NOVEL_TITLE)
        title = title or _meta_content(tree, "og:title", "twitter:title")
        title = _clean_title(title or fallback_title, fallback_title)

        cover = _attr(tree.css_first(self.NOVEL_COVER), "src")
        cover = cover or _attr(tree.css_first(self.NOVEL_COVER), "data-src")
        cover = cover or _meta_content(tree, "og:image", "twitter:image")
        cover = urljoin(raw.url, cover) if cover else None

        description = _first_text(tree, self.NOVEL_DESC)
        description = description or _meta_content(tree, "og:description", "description")

        tags: list[str] = []
        for node in tree.css(self.NOVEL_TAG):
            text = node.text(separator=" ", strip=True)
            if text and text not in tags and len(text) <= 40:
                tags.append(text)

        status_text = _first_text(tree, self.NOVEL_STATUS) or ""
        author = _meta_content(tree, "article:author", "author")
        return NovelMeta(
            source_id=self.id,
            slug=ref.slug,
            title=title,
            url=ref.url,
            cover_url=cover,
            description=description,
            author=author,
            tags=tags[:12],
            status=_normalize_status(status_text),
            language="pt-BR",
        )

    async def list_chapters(self, fetcher, novel: NovelMeta) -> list[ChapterRef]:
        try:
            chapters: dict[float, ChapterRef] = {}
            page = 1
            while True:
                data = await self._get_json(
                    fetcher,
                    self._api_url(f"novels/{novel.slug}/chapters?page={page}&items=100&sort=asc"),
                )
                items = data.get("data") if isinstance(data.get("data"), list) else []
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    number = item.get("position")
                    slug = item.get("slug")
                    if not isinstance(slug, str) or number is None:
                        continue
                    try:
                        chapter_number = float(number)
                    except (TypeError, ValueError):
                        continue
                    title = item.get("longTitle") or item.get("title") or f"Capitulo {chapter_number:g}"
                    chapters.setdefault(
                        chapter_number,
                        ChapterRef(
                            number=chapter_number,
                            title=str(title),
                            url=self._chapter_url(novel.slug, slug),
                            published_at=item.get("publishedAt") if isinstance(item.get("publishedAt"), str) else None,
                        ),
                    )
                meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
                pages = int(meta.get("pages") or page)
                if page >= pages or not items:
                    out = list(chapters.values())
                    out.sort(key=lambda chapter: chapter.number)
                    return out
                page += 1
        except Exception:
            pass

        raw = await fetcher.get(novel.url)
        return self._parse_chapters(raw.html, novel.slug, raw.url)

    def _parse_chapters(self, html: bytes, novel_slug: str, base_url: str | None = None) -> list[ChapterRef]:
        base = base_url or self._novel_url(novel_slug)
        tree = HTMLParser(html)
        out: dict[float, ChapterRef] = {}

        for link in tree.css(self.CHAPTER_ITEM):
            href = _attr(link, "href")
            if not href:
                continue
            absolute = urljoin(base, href)
            path = urlsplit(absolute).path.strip("/")
            parts = path.split("/")
            if len(parts) <= 2 or parts[0] != "novels" or parts[1] != novel_slug:
                continue
            if parts[2] in _IGNORED_CHAPTER_SEGMENTS:
                continue
            text = link.text(separator=" ", strip=True)
            number = _chapter_number(absolute, text)
            if number is None or number in out:
                continue
            out[number] = ChapterRef(number=number, title=_chapter_title(text, number), url=absolute)

        chapters = list(out.values())
        chapters.sort(key=lambda chapter: chapter.number)
        return chapters

    async def fetch_chapter(self, fetcher, url: str) -> RawPage:
        return await fetcher.get(url)

    def normalize_chapter(self, raw: RawPage) -> NormalizedChapter:
        serialized = _extract_serialized_content(raw.html)
        if serialized:
            return normalize(RawPage(url=raw.url, html=serialized.encode("utf-8")), "body")
        return normalize(raw, self.CONTENT)

    def expected_total_from_listing(self, html: bytes) -> int | None:
        match = _TOTAL_RE.search(_decode(html))
        if not match:
            return None
        return int(match.group(1).replace(".", ""))


register(NovelManiaConnector())
