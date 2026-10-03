"""Conector Light Novel Pub.

O site e estatico o bastante para descoberta/metadados, mas usa Cloudflare com
mais rigor em algumas paginas de capitulo. O conector detecta esse HTML de
challenge para falhar cedo em vez de salvar conteudo quebrado.
"""
from __future__ import annotations

import json
import re
from html import unescape
from typing import Iterable
from urllib.parse import urljoin, urlparse

import httpx
from selectolax.parser import HTMLParser, Node

from ...config import get_settings
from ..base import ChapterRef, NormalizedChapter, NovelMeta, NovelRef, RawPage
from ..normalize import normalize
from ..registry import register
from ._common import attr as _attr

_BR_RE = re.compile(r"<br\s*/?>", re.I)
_TAG_RE = re.compile(r"<[^>]+>")
_SPACE_RE = re.compile(r"\s+")
_CHAPTER_RE = re.compile(r"\bchapter\D*(?P<num>\d+)(?:\D+(?P<part>\d{1,3}))?", re.I)
_BOOK_RE = re.compile(r"^/book/(?P<slug>[^/?#]+)/*$")
_LIST_LAST_RE = re.compile(r"/list/[^/]+/(?P<page>\d+)")



def _text(node: Node | None) -> str:
    if node is None:
        return ""
    return _clean_text(node.text(separator=" "))


def _clean_text(value: str | None) -> str:
    if not value:
        return ""
    value = _BR_RE.sub("\n", value)
    value = _TAG_RE.sub("", value)
    value = unescape(value)
    lines = [_SPACE_RE.sub(" ", line).strip() for line in value.splitlines()]
    return "\n".join(line for line in lines if line)


def _meta(tree: HTMLParser, key: str) -> str | None:
    for selector in (
        f"meta[property='{key}']",
        f'meta[property="{key}"]',
        f"meta[name='{key}']",
        f'meta[name="{key}"]',
        f"meta[itemprop='{key}']",
        f'meta[itemprop="{key}"]',
    ):
        value = _attr(tree.css_first(selector), "content")
        if value:
            return value
    return None


def _slug_from_url(url: str) -> str | None:
    parsed = urlparse(url)
    match = _BOOK_RE.match(parsed.path)
    return match.group("slug") if match else None


def _status(value: str | None) -> str:
    text = (value or "").strip().lower()
    if any(token in text for token in ("complete", "completed")):
        return "complete"
    if any(token in text for token in ("hiatus", "pause", "dropped")):
        return "paused"
    return "ongoing"


def _title_case_tag(value: str) -> str:
    value = _clean_text(value).replace("_", " ").replace("-", " ")
    fixed = {
        "sci fi": "Sci-Fi",
        "sci-fi": "Sci-Fi",
        "xianxia": "Xianxia",
        "xuanhuan": "Xuanhuan",
        "wuxia": "Wuxia",
        "yaoi": "Yaoi",
        "ecchi": "Ecchi",
    }
    key = value.lower()
    return fixed.get(key, value.title())


def _chapter_number(title: str, url: str, fallback: int) -> float:
    haystacks = [title, urlparse(url).path.rsplit("/", 1)[-1]]
    for value in haystacks:
        match = _CHAPTER_RE.search(value)
        if not match:
            continue
        number = int(match.group("num"))
        part = match.group("part")
        if part:
            try:
                return float(f"{number}.{int(part)}")
            except ValueError:
                pass
        return float(number)
    return float(fallback)


def _is_cloudflare_challenge(html: bytes) -> bool:
    text = html[:8192].decode("utf-8", errors="ignore").lower()
    return "challenge-error-text" in text or "__cf_chl_" in text


class LightNovelPubConnector:
    id = "light-novel-pub"
    display_name = "Light Novel Pub"
    base_url = "https://lightnovelpub.me/"
    capabilities = {"static_html", "paginated_listing", "chapter_index"}
    rate_limit_seconds = 1.0

    PRIORITY_REFS = [
        NovelRef(id, "unsheathed", "https://lightnovelpub.me/book/unsheathed"),
    ]
    LIST_PATHS = (
        "list/latest-novels/",
        "list/latest-release-novels/",
        "list/most-popular-novels/",
        "list/completed-novels/",
    )
    CONTENT = ".chapter-content, .chapter-c, .m-read .txt, #chapter-content, article"

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

    def request_headers(self) -> dict[str, str]:
        headers = dict(self.headers)
        cookie = get_settings().light_novel_pub_cookie
        if cookie:
            headers["Cookie"] = cookie
        return headers

    def _list_url(self, path: str, page: int = 1) -> str:
        if page <= 1:
            return urljoin(self.base_url, path)
        return urljoin(self.base_url, f"{path.rstrip('/')}/{page}")

    def _chapter_catalog_url(self, novel_slug: str, chapter_id: str) -> str:
        return urljoin(
            self.base_url,
            f"ajax/get-list-chapter?novel_id={novel_slug}&chapter_id={chapter_id}",
        )

    def _refs_from_listing(self, html: bytes) -> list[NovelRef]:
        tree = HTMLParser(html)
        refs: list[NovelRef] = []
        seen: set[str] = set()
        for node in tree.css(".ul-list1 h3.tit a[href*='/book/'], .ul-list1 a[href*='/book/']"):
            href = _attr(node, "href")
            if not href:
                continue
            absolute = urljoin(self.base_url, href)
            slug = _slug_from_url(absolute)
            if not slug or slug in seen:
                continue
            seen.add(slug)
            refs.append(NovelRef(self.id, slug, absolute))
        return refs

    def _last_listing_page(self, html: bytes) -> int:
        tree = HTMLParser(html)
        pages = [1]
        for node in tree.css(".pagination a[href*='/list/']"):
            href = _attr(node, "href") or ""
            match = _LIST_LAST_RE.search(href)
            if match:
                pages.append(int(match.group("page")))
        return max(pages)

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

        for path in self.LIST_PATHS:
            first = await fetcher.get(self._list_url(path))
            last_page = self._last_listing_page(first.html)
            for page in range(1, last_page + 1):
                raw = first if page == 1 else await fetcher.get(self._list_url(path, page))
                page_refs = self._refs_from_listing(raw.html)
                if not page_refs:
                    break
                for ref in page_refs:
                    if add(ref):
                        return refs
        return refs

    async def fetch_novel(self, fetcher, ref: NovelRef) -> NovelMeta:
        raw = await fetcher.get(ref.url)
        tree = HTMLParser(raw.html)
        genres = _meta(tree, "og:novel:genre") or ""
        tags = [_title_case_tag(tag) for tag in genres.split(",") if _clean_text(tag)]
        description = _text(tree.css_first(".m-desc .txt .inner"))
        if not description:
            description = _clean_text(_meta(tree, "og:description"))
            prefix = f"{ref.slug.replace('-', ' ').title()} - "
            if description.startswith(prefix):
                description = description[len(prefix) :]
        rating, votes = self._rating(tree)
        return NovelMeta(
            source_id=self.id,
            slug=ref.slug,
            title=_clean_text(_meta(tree, "og:novel:novel_name")) or _text(tree.css_first(".m-desc h1.tit")) or ref.slug.replace("-", " ").title(),
            url=ref.url,
            cover_url=_meta(tree, "og:image") or _attr(tree.css_first(".m-book1 .pic img"), "src"),
            description=description or None,
            author=_clean_text(_meta(tree, "og:novel:author")) or _text(tree.css_first(".m-book1 .glyphicon-user + .right")),
            tags=tags,
            status=_status(_meta(tree, "og:novel:status")),
            language="en",
            source_chapter_count=self._source_chapter_count(tree),
            extra={
                "light_novel_pub_category": _meta(tree, "og:novel:category"),
                "light_novel_pub_update_time": _meta(tree, "og:novel:update_time"),
                "light_novel_pub_latest_chapter_name": _meta(tree, "og:novel:lastest_chapter_name"),
                "light_novel_pub_first_chapter_id": self._chapter_id_from_url(_meta(tree, "og:novel:read_url")),
                "rating": rating,
                "rating_votes": votes,
            },
        )

    def _rating(self, tree: HTMLParser) -> tuple[float | None, int | None]:
        text = _text(tree.css_first(".score .vote"))
        match = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*/\s*5\s*\(\s*([0-9,]+)", text)
        if not match:
            return None, None
        return float(match.group(1)), int(match.group(2).replace(",", ""))

    def _source_chapter_count(self, tree: HTMLParser) -> int | None:
        latest = _meta(tree, "og:novel:lastest_chapter_name") or ""
        number = _chapter_number(latest, latest, 0)
        if number > 0:
            return int(number)
        options = tree.css("#indexselect option")
        if not options:
            return None
        text = _text(options[-1])
        numbers = [int(value) for value in re.findall(r"\d+", text)]
        return max(numbers) if numbers else None

    def _chapter_pages(self, html: bytes, novel_url: str) -> list[str]:
        tree = HTMLParser(html)
        pages = [novel_url]
        for node in tree.css("#indexselect option"):
            value = _attr(node, "value")
            if value and value.isdigit() and int(value) > 1:
                pages.append(f"{novel_url.rstrip('/')}/{int(value)}")
        if len(pages) == 1:
            last = _attr(tree.css_first(".page a.index-container-btn[href*='/book/']:last-child"), "href")
            match = re.search(r"/(\d+)$", last or "")
            if match:
                pages.extend(f"{novel_url.rstrip('/')}/{page}" for page in range(2, int(match.group(1)) + 1))
        return pages

    def _chapter_id_from_url(self, url: str | None) -> str | None:
        if not url:
            return None
        path = urlparse(url).path.strip("/")
        marker = "/chapter-"
        if marker not in f"/{path}":
            return None
        return path.rsplit("/", 1)[-1] or None

    def _parse_chapters(self, html: bytes, fallback_start: int = 1) -> list[ChapterRef]:
        tree = HTMLParser(html)
        chapters: dict[float, ChapterRef] = {}
        fallback = fallback_start
        for node in tree.css(".m-newest2 .ul-list5 a.con[href*='/chapter-']"):
            href = _attr(node, "href")
            if not href:
                continue
            absolute = urljoin(self.base_url, href)
            title = _attr(node, "title") or _text(node) or f"Chapter {fallback}"
            number = _chapter_number(title, absolute, fallback)
            while number in chapters:
                number += 0.001
            chapters[number] = ChapterRef(number=number, title=_clean_text(title), url=absolute)
            fallback += 1
        return list(chapters.values())

    def _parse_catalog_chapters(self, html: bytes, novel: NovelMeta) -> list[ChapterRef]:
        try:
            data = json.loads(html.decode("utf-8", errors="ignore"))
        except json.JSONDecodeError:
            return []
        items = data.get("chapters") if isinstance(data, dict) else None
        if not isinstance(items, list):
            return []
        chapters: dict[float, ChapterRef] = {}
        fallback = 1
        for item in items:
            if not isinstance(item, dict):
                continue
            chapter_id = item.get("chapter_id")
            title = item.get("chapter_name")
            if not isinstance(chapter_id, str) or not chapter_id:
                continue
            clean_title = _clean_text(title if isinstance(title, str) else "") or f"Chapter {fallback}"
            url = urljoin(self.base_url, f"book/{novel.slug}/{chapter_id}")
            number = _chapter_number(clean_title, url, fallback)
            while number in chapters:
                number += 0.001
            chapters[number] = ChapterRef(number=number, title=clean_title, url=url)
            fallback += 1
        out = list(chapters.values())
        out.sort(key=lambda chapter: chapter.number)
        return out

    async def list_chapters(self, fetcher, novel: NovelMeta) -> list[ChapterRef]:
        first = await fetcher.get(novel.url)
        first_chapter_id = (novel.extra or {}).get("light_novel_pub_first_chapter_id")
        if not isinstance(first_chapter_id, str) or not first_chapter_id:
            first_chapters = self._parse_chapters(first.html)
            if first_chapters:
                first_chapter_id = self._chapter_id_from_url(first_chapters[0].url)
        if first_chapter_id:
            catalog = await fetcher.get(self._chapter_catalog_url(novel.slug, first_chapter_id))
            catalog_chapters = self._parse_catalog_chapters(catalog.html, novel)
            if catalog_chapters:
                return catalog_chapters

        chapters: dict[float, ChapterRef] = {}
        fallback = 1
        for page_url in self._chapter_pages(first.html, novel.url):
            raw = first if page_url.rstrip("/") == novel.url.rstrip("/") else await fetcher.get(page_url)
            for chapter in self._parse_chapters(raw.html, fallback):
                chapters.setdefault(chapter.number, chapter)
                fallback += 1
        out = list(chapters.values())
        out.sort(key=lambda chapter: chapter.number)
        return out

    async def fetch_chapter(self, fetcher, url: str) -> RawPage:
        try:
            return await fetcher.get(url)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 403:
                raise RuntimeError(
                    "Light Novel Pub chapter content is blocked by Cloudflare/novellive.app; "
                    "catalog metadata was available, but chapter HTML needs a browser/session fallback"
                ) from exc
            raise

    def normalize_chapter(self, raw: RawPage) -> NormalizedChapter:
        if _is_cloudflare_challenge(raw.html):
            raise ValueError("Light Novel Pub chapter returned Cloudflare challenge instead of content")
        return normalize(raw, self.CONTENT)

    def expected_total_from_listing(self, html: bytes) -> int | None:
        return len(self._refs_from_listing(html)) or None


register(LightNovelPubConnector())
