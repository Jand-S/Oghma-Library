"""Conector House Saikai (antigo Saikai Scans).

O site tambem possui comics em `/comics`; este conector usa exclusivamente
`format=1` na API de stories, que corresponde a series/novels.
"""
from __future__ import annotations

import json
import re
from html import unescape
from typing import Iterable
from urllib.parse import quote, urlencode, urljoin

from selectolax.parser import HTMLParser

from ...config import get_settings
from ..base import ChapterRef, NormalizedChapter, NovelMeta, NovelRef, RawPage
from ..normalize import normalize
from ..registry import register

API_BASE = "https://api.housesaikai.net/api/"
STORAGE_BASE = "https://s3-beta.housesaikai.net/"
_HTML_RE = re.compile(r"<(?:p|div|section|article|blockquote|img|br|hr)\b", re.I)
_CHAPTER_NUM_RE = re.compile(r"(\d+(?:[,.]\d+)?)")


def _story_url(slug: str) -> str:
    return f"https://housesaikai.net/series/{slug}"


def _api_url(path: str, params: dict[str, object] | None = None) -> str:
    url = urljoin(API_BASE, path.lstrip("/"))
    if not params:
        return url
    return f"{url}?{urlencode(params)}"


def _first_text_from_html(value: str | None) -> str | None:
    if not value:
        return None
    tree = HTMLParser(value.encode("utf-8"))
    text = tree.text(separator=" ", strip=True)
    text = re.sub(r"\s+([.,;:!?])", r"\1", text)
    return text or None


def _image_url(path: object) -> str | None:
    if not isinstance(path, str) or not path:
        return None
    if path.startswith(("http://", "https://")):
        return path
    return urljoin(STORAGE_BASE, path)


def _names(items: object, limit: int = 12) -> list[str]:
    out: list[str] = []
    if not isinstance(items, list):
        return out
    for item in items:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        if isinstance(name, str) and name and name not in out:
            out.append(name)
        if len(out) >= limit:
            break
    return out


def _normalize_status(item: dict) -> str:
    status = item.get("status")
    if isinstance(status, dict):
        text = str(status.get("name") or "")
    else:
        status_id = item.get("status_id")
        text = str(status_id or "")
    lowered = text.lower()
    if "conclu" in lowered:
        return "complete"
    if "paus" in lowered or "hiato" in lowered:
        return "paused"
    return "ongoing"


def _chapter_number(item: dict) -> float:
    for key in ("order_all", "order"):
        value = item.get(key)
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value.replace(",", "."))
            except ValueError:
                pass
    chapter = str(item.get("chapter") or "")
    match = _CHAPTER_NUM_RE.search(chapter)
    if match:
        return float(match.group(1).replace(",", "."))
    release_id = item.get("id")
    return float(release_id) if isinstance(release_id, int) else 0.0


def _release_title(item: dict, number: float) -> str:
    title = item.get("title")
    chapter = item.get("chapter")
    prefix = f"Capitulo {number:g}"
    if isinstance(chapter, str) and chapter.strip():
        prefix = f"Capitulo {chapter.strip()}"
    if isinstance(title, str) and title.strip():
        return f"{prefix} - {title.strip()}"
    return prefix


def _find_html_content(value: object) -> str:
    if isinstance(value, str):
        text = unescape(value)
        return text if _HTML_RE.search(text) else ""
    if isinstance(value, dict):
        for key in ("content", "html", "body", "text"):
            found = _find_html_content(value.get(key))
            if found:
                return found
        for key in ("releaseText", "release_text", "release_texts"):
            found = _find_html_content(value.get(key))
            if found:
                return found
    return ""


class HouseSaikaiConnector:
    id = "house-saikai"
    display_name = "House Saikai"
    base_url = "https://housesaikai.net/"
    capabilities = {"api_available", "paginated_listing"}
    rate_limit_seconds = 1.5

    STORY_RELATIONSHIPS = (
        "firstRelease,tags,genres,associatedNames,authors.user,artists.user,"
        "translators,revisors,checkers,editors,separatorType,language,status,"
        "galleries,curiosities,separators.releases"
    )
    CONTENT = (
        ".reader-content, .reading-content, .content-item, .ql-editor, "
        "[class*='reader'], [class*='content'], article, main"
    )

    def request_headers(self) -> dict[str, str]:
        settings = get_settings()
        headers = {
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
            "Origin": self.base_url.rstrip("/"),
            "Referer": self.base_url,
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/149.0.0.0 Safari/537.36"
            ),
        }
        if settings.house_saikai_bearer:
            headers["Authorization"] = f"Bearer {settings.house_saikai_bearer}"
        return headers

    async def _get_json(self, fetcher, url: str) -> dict:
        raw = await fetcher.get(url)
        data = json.loads(raw.html.decode("utf-8", errors="ignore"))
        return data if isinstance(data, dict) else {}

    def _listing_url(self, page: int, per_page: int = 100) -> str:
        return _api_url(
            "stories",
            {
                "format": 1,
                "hdropped": 1,
                "q": "",
                "status": "null",
                "genres": "",
                "country": "null",
                "sortProperty": "title",
                "sortDirection": "asc",
                "page": page,
                "per_page": per_page,
                "relationships": "language,type,format",
            },
        )

    def _detail_url(self, slug: str) -> str:
        return _api_url(
            "stories",
            {
                "pageview": 0,
                "relationships": self.STORY_RELATIONSHIPS,
                "format": 1,
                "first": "true",
                "slug": slug,
                "cache": 1,
            },
        )

    def _release_url(self, release_id: int) -> str:
        return _api_url(
            f"releases/{release_id}",
            {
                "relationships": "releaseText",
            },
        )

    def _ref_from_story(self, item: dict) -> NovelRef | None:
        slug = item.get("slug")
        if not isinstance(slug, str) or not slug:
            return None
        if item.get("format_id") not in (None, 1):
            return None
        return NovelRef(self.id, slug, _story_url(slug))

    def _meta_from_story(self, item: dict, ref: NovelRef) -> NovelMeta:
        tags = _names(item.get("genres"))
        for tag in _names(item.get("tags")):
            if tag not in tags:
                tags.append(tag)
        authors = _names(item.get("authors"), limit=3)
        description = _first_text_from_html(item.get("synopsis")) or item.get("resume")
        return NovelMeta(
            source_id=self.id,
            slug=ref.slug,
            title=str(item.get("title") or ref.slug.replace("-", " ").title()),
            url=ref.url,
            cover_url=_image_url(item.get("image")),
            description=description if isinstance(description, str) else None,
            author=", ".join(authors) if authors else None,
            tags=tags[:12],
            status=_normalize_status(item),
            language="pt-BR",
        )

    async def discover_novels(self, fetcher, limit: int | None = None) -> Iterable[NovelRef]:
        found: dict[str, NovelRef] = {}
        page = 1
        while True:
            data = await self._get_json(fetcher, self._listing_url(page))
            items = data.get("data") if isinstance(data.get("data"), list) else []
            for item in items:
                if not isinstance(item, dict):
                    continue
                ref = self._ref_from_story(item)
                if ref is None:
                    continue
                found.setdefault(ref.slug, ref)
                if limit and len(found) >= limit:
                    return list(found.values())
            meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
            last_page = int(meta.get("last_page") or page)
            if not items or page >= last_page:
                return list(found.values())
            page += 1

    async def fetch_novel(self, fetcher, ref: NovelRef) -> NovelMeta:
        data = await self._get_json(fetcher, self._detail_url(ref.slug))
        item = data.get("data")
        if not isinstance(item, dict):
            raise ValueError(f"House Saikai story not found: {ref.slug}")
        return self._meta_from_story(item, ref)

    async def list_chapters(self, fetcher, novel: NovelMeta) -> list[ChapterRef]:
        data = await self._get_json(fetcher, self._detail_url(novel.slug))
        item = data.get("data")
        if not isinstance(item, dict):
            return []
        chapters: dict[float, ChapterRef] = {}
        for separator in item.get("separators") or []:
            if not isinstance(separator, dict):
                continue
            for release in separator.get("releases") or []:
                if not isinstance(release, dict) or not release.get("is_active", 1):
                    continue
                release_id = release.get("id")
                if not isinstance(release_id, int):
                    continue
                number = _chapter_number(release)
                if number in chapters:
                    continue
                chapters[number] = ChapterRef(
                    number=number,
                    title=_release_title(release, number),
                    url=self._release_url(release_id),
                    published_at=release.get("published_at") if isinstance(release.get("published_at"), str) else None,
                )
        out = list(chapters.values())
        out.sort(key=lambda chapter: chapter.number)
        return out

    async def fetch_chapter(self, fetcher, url: str) -> RawPage:
        return await fetcher.get(url)

    def normalize_chapter(self, raw: RawPage) -> NormalizedChapter:
        try:
            data = json.loads(raw.html.decode("utf-8", errors="ignore"))
        except json.JSONDecodeError:
            data = None
        if isinstance(data, dict):
            content = _find_html_content(data.get("data", data))
            if content:
                payload = RawPage(url=raw.url, html=content.encode("utf-8"))
                return normalize(payload, "body")
        return normalize(raw, self.CONTENT)

    def chapter_public_url(self, story_slug: str, release_id: int, release_slug: str) -> str:
        return f"{self.base_url}ler/series/{quote(story_slug)}/{release_id}/{quote(release_slug)}"


register(HouseSaikaiConnector())
