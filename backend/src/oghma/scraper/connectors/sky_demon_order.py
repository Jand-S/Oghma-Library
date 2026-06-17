"""Conector Sky Demon Order.

O catalogo e as paginas de capitulos livres respondem como HTML publico. A
lista de capitulos na pagina da obra e carregada por Livewire lazy-load, entao
o conector descobre os capitulos free caminhando pelo fluxo publico:
Start Reading -> NEXT -> NEXT, parando no fim ou quando encontra paywall.
"""
from __future__ import annotations

import re
from typing import Iterable
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit

from selectolax.parser import HTMLParser

from ...config import get_settings
from ..base import ChapterRef, NormalizedChapter, NovelMeta, NovelRef, RawPage
from ..normalize import normalize
from ..registry import register

_PROJECT_HREF = re.compile(
    r"https?://skydemonorder\.com/projects/(?P<slug>[a-z0-9][a-z0-9._-]*)/?(?:$|[?#\"' <])",
    re.I,
)
_CHAPTER_HREF = re.compile(
    r"https?://skydemonorder\.com/projects/(?P<project>[a-z0-9][a-z0-9._-]*)/"
    r"(?P<chapter>[a-z0-9][a-z0-9._-]*)/?(?:$|[?#\"' <])",
    re.I,
)
_CHAPTER_NUMBER = re.compile(r"^(\d+)(?:-|$)")
_PROJECT_TOTAL = re.compile(r"([0-9][0-9,]*)\s+results", re.I)
_PUBLISHED_RE = re.compile(r'"datePublished"\s*:\s*"([^"]+)"')
_TITLE_PREFIX_RE = re.compile(r"\s+--?\s+Sky Demon Order\s*$", re.I)
_COVER_URL_RE = re.compile(r"https://skydemonorder\.nyc3\.cdn\.digitaloceanspaces\.com/covers/[^'\"\s]+", re.I)


def _attr(node, name: str) -> str | None:
    if node is None:
        return None
    value = node.attributes.get(name)
    return value.strip() if value else None


def _first_text(tree: HTMLParser, selector: str) -> str | None:
    node = tree.css_first(selector)
    if node is None:
        return None
    text = node.text(separator=" ", strip=True)
    return text or None


def _meta_content(tree: HTMLParser, *names: str) -> str | None:
    for name in names:
        node = tree.css_first(f"meta[property='{name}'], meta[name='{name}']")
        value = _attr(node, "content")
        if value:
            return value
    return None


def _cover_url(tree: HTMLParser) -> str | None:
    for img in tree.css("main img"):
        for name in ("src", "data-src", ":src", "x-bind:src"):
            value = _attr(img, name)
            if not value:
                continue
            match = _COVER_URL_RE.search(value)
            if match:
                return match.group(0)
            if "/covers/" in value and "mature-placeholder" not in value:
                return value
    fallback = _meta_content(tree, "og:image", "twitter:image")
    if fallback and "mature-placeholder" not in fallback:
        return fallback
    return fallback


def _status(text: str) -> str:
    lowered = text.lower()
    if "complete" in lowered:
        return "complete"
    if "hiatus" in lowered or "paused" in lowered:
        return "paused"
    return "ongoing"


def _chapter_number_from_url(url: str) -> float | None:
    segment = urlsplit(url).path.rstrip("/").split("/")[-1]
    match = _CHAPTER_NUMBER.search(segment)
    if not match:
        return None
    return float(match.group(1))


def _clean_chapter_title(title: str, number: float) -> str:
    title = re.sub(r"\s+", " ", title).strip()
    title = re.sub(r"^Ep\.?\s*\d+\s*:\s*", "", title, flags=re.I)
    return title or f"Chapter {number:g}"


class SkyDemonOrderConnector:
    id = "sky-demon-order"
    display_name = "Sky Demon Order"
    base_url = "https://skydemonorder.com/"
    capabilities = {"static_html", "paginated_listing", "free_chapter_walk"}
    rate_limit_seconds = 2.0
    http2 = False

    LISTING_LINK = "a[href*='skydemonorder.com/projects/']"
    NOVEL_TITLE = "h1"
    NOVEL_COVER = "main img[src*='/covers/'], meta[property='og:image']"
    NOVEL_DESC = "main [x-ref='desc'] p, main .line-clamp-3 p"
    NOVEL_TAG = "a[href*='/projects?g='], a[href*='/projects?t=']"
    CONTENT = "#chapter-body"
    MAX_FREE_CHAPTERS = 500

    def request_headers(self) -> dict[str, str]:
        headers = {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.7,pt;q=0.6",
            "Referer": self.base_url,
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/149.0.0.0 Safari/537.36"
            ),
        }
        cookie = get_settings().sky_demon_order_cookie
        if cookie:
            headers["Cookie"] = cookie
        return headers

    def _project_url(self, slug: str) -> str:
        return urljoin(self.base_url, f"projects/{slug}")

    def _listing_url(self, page: int, per_page: int = 48) -> str:
        params = {"m": "all", "pp": per_page}
        if page > 1:
            params["pg"] = page
        return urljoin(self.base_url, "projects") + "?" + urlencode(params)

    def _slug_from_url(self, url: str) -> str:
        match = _PROJECT_HREF.search(url)
        if match:
            return match.group("slug")
        return urlsplit(url).path.rstrip("/").split("/")[-1]

    def _parse_project_refs(self, html: bytes) -> list[NovelRef]:
        text = html.decode("utf-8", errors="ignore")
        tree = HTMLParser(html)
        found: dict[str, NovelRef] = {}

        def add(url: str) -> None:
            match = _PROJECT_HREF.search(url)
            if not match:
                return
            slug = match.group("slug")
            if slug in found:
                return
            found[slug] = NovelRef(self.id, slug, self._project_url(slug))

        for link in tree.css(self.LISTING_LINK):
            href = _attr(link, "href")
            if href:
                add(urljoin(self.base_url, href))
        for match in _PROJECT_HREF.finditer(text):
            add(match.group(0))

        return list(found.values())

    def _next_listing_page(self, html: bytes, current_page: int) -> int | None:
        tree = HTMLParser(html)
        next_page = None
        for link in tree.css("a[href*='pg=']"):
            href = _attr(link, "href") or ""
            qs = parse_qs(urlsplit(href).query)
            try:
                page = int((qs.get("pg") or ["0"])[0])
            except ValueError:
                continue
            if page > current_page and (next_page is None or page < next_page):
                next_page = page
        return next_page

    async def discover_novels(self, fetcher, limit: int | None = None) -> Iterable[NovelRef]:
        found: dict[str, NovelRef] = {}
        page = 1
        while True:
            raw = await fetcher.get(self._listing_url(page))
            before = len(found)
            for ref in self._parse_project_refs(raw.html):
                found.setdefault(ref.slug, ref)
                if limit and len(found) >= limit:
                    return list(found.values())
            next_page = self._next_listing_page(raw.html, page)
            if next_page is None or len(found) == before:
                return list(found.values())
            page = next_page

    async def fetch_novel(self, fetcher, ref: NovelRef) -> NovelMeta:
        raw = await fetcher.get(ref.url)
        tree = HTMLParser(raw.html)
        fallback = ref.slug.replace("-", " ").title()
        title = _first_text(tree, self.NOVEL_TITLE) or _meta_content(tree, "og:title", "twitter:title") or fallback
        title = _TITLE_PREFIX_RE.sub("", title).strip() or fallback
        cover = _cover_url(tree)
        description = _first_text(tree, self.NOVEL_DESC) or _meta_content(tree, "description", "og:description")

        tags: list[str] = []
        for node in tree.css(self.NOVEL_TAG):
            text = node.text(separator=" ", strip=True)
            if text and text not in tags and len(text) <= 60:
                tags.append(text)

        header_text = " ".join(node.text(separator=" ", strip=True) for node in tree.css("main span"))
        language = "en"
        if "Korean" in header_text:
            language = "ko"
        elif "Japanese" in header_text:
            language = "ja"
        elif "Chinese" in header_text:
            language = "zh"

        return NovelMeta(
            source_id=self.id,
            slug=ref.slug,
            title=title,
            url=ref.url,
            cover_url=urljoin(raw.url, cover) if cover else None,
            description=description,
            tags=tags[:12],
            status=_status(header_text),
            language=language,
        )

    def _start_url(self, html: bytes, novel: NovelMeta) -> str | None:
        tree = HTMLParser(html)
        for link in tree.css(f"a[href*='/projects/{novel.slug}/']"):
            href = _attr(link, "href")
            if href and _CHAPTER_HREF.search(urljoin(novel.url, href)):
                text = link.text(separator=" ", strip=True).lower()
                if "start reading" in text or not text:
                    return urljoin(novel.url, href)
        return None

    def _chapter_from_page(self, html: bytes, url: str) -> ChapterRef | None:
        tree = HTMLParser(html)
        if tree.css_first(self.CONTENT) is None:
            return None
        number = _chapter_number_from_url(url)
        if number is None:
            return None
        title = _first_text(tree, "h1") or f"Chapter {number:g}"
        match = _PUBLISHED_RE.search(html.decode("utf-8", errors="ignore"))
        return ChapterRef(
            number=number,
            title=_clean_chapter_title(title, number),
            url=url,
            published_at=match.group(1) if match else None,
        )

    def _next_chapter_url(self, html: bytes, novel_slug: str, current_url: str) -> str | None:
        tree = HTMLParser(html)
        candidates: list[str] = []
        for link in tree.css(f"a[href*='/projects/{novel_slug}/']"):
            href = _attr(link, "href")
            if not href:
                continue
            absolute = urljoin(current_url, href)
            if absolute.rstrip("/") == current_url.rstrip("/"):
                continue
            text = link.text(separator=" ", strip=True).lower()
            if "next" in text or _chapter_number_from_url(absolute):
                candidates.append(absolute)
        current_number = _chapter_number_from_url(current_url) or 0.0
        numbered = [
            (number, url)
            for url in candidates
            if (number := _chapter_number_from_url(url)) is not None and number > current_number
        ]
        if not numbered:
            return None
        numbered.sort(key=lambda item: item[0])
        return numbered[0][1]

    async def list_chapters(self, fetcher, novel: NovelMeta) -> list[ChapterRef]:
        raw = await fetcher.get(novel.url)
        current = self._start_url(raw.html, novel)
        if not current:
            return []

        chapters: dict[float, ChapterRef] = {}
        seen_urls: set[str] = set()
        while current and current not in seen_urls and len(chapters) < self.MAX_FREE_CHAPTERS:
            seen_urls.add(current)
            page = await fetcher.get(current)
            chapter = self._chapter_from_page(page.html, str(page.url))
            if chapter is None:
                break
            chapters.setdefault(chapter.number, chapter)
            current = self._next_chapter_url(page.html, novel.slug, str(page.url))

        out = list(chapters.values())
        out.sort(key=lambda chapter: chapter.number)
        return out

    async def fetch_chapter(self, fetcher, url: str) -> RawPage:
        return await fetcher.get(url)

    def normalize_chapter(self, raw: RawPage) -> NormalizedChapter:
        return normalize(raw, self.CONTENT)

    def expected_total_from_listing(self, html: bytes) -> int | None:
        match = _PROJECT_TOTAL.search(html.decode("utf-8", errors="ignore"))
        if not match:
            return None
        return int(match.group(1).replace(",", ""))


register(SkyDemonOrderConnector())
