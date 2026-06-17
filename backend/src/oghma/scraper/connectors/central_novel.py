"""Conector Central Novel (WordPress / tema Madara/Tsundoku).

Seletores calibrados contra o HTML real em 2026-06-16. A pagina de obra ja
inclui a lista de capitulos no HTML, entao a primeira versao nao precisa de
AJAX/headless para o Central Novel.
"""
from __future__ import annotations

import re
from typing import Iterable, Optional

from selectolax.parser import HTMLParser

from ..base import ChapterRef, NormalizedChapter, NovelMeta, NovelRef, RawPage
from ..normalize import normalize
from ..registry import register

_SERIES_HREF = re.compile(r"/series/([a-z0-9][a-z0-9._-]*)/?(?:$|[?#])", re.I)
_CHAPTER_NUM = re.compile(r"cap(?:itulo|\.)?[-\s_]*([0-9]+(?:[.,-][0-9]+)?)", re.I)
_IGNORED_SERIES_SLUGS = {"list-mode"}


def _first_text(tree, selector: str) -> Optional[str]:
    node = tree.css_first(selector)
    if node is None:
        return None
    txt = node.text(strip=True)
    return txt or None


def _attr(node, name: str) -> Optional[str]:
    if node is None:
        return None
    return node.attributes.get(name)


class CentralNovelConnector:
    id = "central-novel"
    display_name = "Central Novel"
    base_url = "https://centralnovel.com/"
    capabilities = {"static_html", "incremental_listing"}
    rate_limit_seconds = 2.0

    # ---- seletores ----
    LIST_ITEM = ".soralist a[href*='/series/'], .listupd h2 a[href*='/series/']"
    NOVEL_TITLE = "h1.entry-title, .post-title h1, h1"
    NOVEL_COVER = ".bigcontent .thumb img, .summary_image img, .thumb img, img.wp-post-image"
    NOVEL_DESC = ".entry-content[itemprop='description'], .description-summary .summary__content, .entry-content"
    NOVEL_TAG = ".infox a[href*='/genre/'], .mgen a, .genres a"
    NOVEL_STATUS = ".infox .spe span, .status, .post-status .summary-content"
    CHAPTER_ITEM = ".eplister li > a, li.wp-manga-chapter > a, ul.main a[href*='-capitulo-']"
    CONTENT = ".epcontent, .entry-content, .reading-content, article .text-left, article"

    def slug_from_url(self, url: str) -> str:
        m = _SERIES_HREF.search(url)
        if m:
            return m.group(1)
        return url.rstrip("/").split("/")[-1].split("?")[0]

    def _series_url(self, slug: str) -> str:
        return f"{self.base_url}series/{slug}/"

    async def discover_novels(self, fetcher, limit: int | None = None) -> Iterable[NovelRef]:
        found: dict[str, NovelRef] = {}
        discovery_urls = [
            f"{self.base_url}series/list-mode/",
            f"{self.base_url}series/?status=&order=latest",
            f"{self.base_url}series/?status=&order=update",
            f"{self.base_url}series/",
        ]
        for url in discovery_urls:
            try:
                raw = await fetcher.get(url)
            except Exception:
                continue
            tree = HTMLParser(raw.html)
            for a in tree.css(self.LIST_ITEM):
                href = _attr(a, "href") or ""
                m = _SERIES_HREF.search(href)
                if not m:
                    continue
                slug = m.group(1)
                if slug in _IGNORED_SERIES_SLUGS:
                    continue
                if slug in found:
                    continue
                found[slug] = NovelRef(self.id, slug, self._series_url(slug))
                if limit and len(found) >= limit:
                    return list(found.values())
        return list(found.values())

    async def fetch_novel(self, fetcher, ref: NovelRef) -> NovelMeta:
        raw = await fetcher.get(ref.url)
        tree = HTMLParser(raw.html)
        title = _first_text(tree, self.NOVEL_TITLE) or ref.slug
        cover = _attr(tree.css_first(self.NOVEL_COVER), "src") or _attr(
            tree.css_first(self.NOVEL_COVER), "data-src"
        )
        desc = _first_text(tree, self.NOVEL_DESC)
        tags = []
        for t in tree.css(self.NOVEL_TAG):
            txt = t.text(strip=True)
            if txt and txt not in tags:
                tags.append(txt)
        status_txt = (_first_text(tree, self.NOVEL_STATUS) or "").lower()
        status = "complete" if ("complet" in status_txt or "concluí" in status_txt) else (
            "paused" if ("pausa" in status_txt or "hiato" in status_txt) else "ongoing"
        )
        return NovelMeta(
            source_id=self.id,
            slug=ref.slug,
            title=title,
            url=ref.url,
            cover_url=cover,
            description=desc,
            tags=tags[:12],
            status=status,
            language="pt-BR",
        )

    async def list_chapters(self, fetcher, novel: NovelMeta) -> list[ChapterRef]:
        raw = await fetcher.get(novel.url)
        chapters = self._parse_chapters(raw.html)
        if not chapters:
            # fallback Madara: endpoint ajax de capitulos
            for path in ("ajax/chapters/", "?ajax=chapters"):
                try:
                    raw2 = await fetcher.get(novel.url.rstrip("/") + "/" + path)
                    chapters = self._parse_chapters(raw2.html)
                    if chapters:
                        break
                except Exception:
                    continue
        chapters.sort(key=lambda c: c.number)
        return chapters

    def _parse_chapters(self, html: bytes) -> list[ChapterRef]:
        tree = HTMLParser(html)
        out: list[ChapterRef] = []
        seen: set[float] = set()
        for a in tree.css(self.CHAPTER_ITEM):
            href = _attr(a, "href") or ""
            if "/pdf/" in href:
                continue
            text = a.text(strip=True)
            m = _CHAPTER_NUM.search(href) or _CHAPTER_NUM.search(text)
            if not m:
                continue
            num = float(m.group(1).replace(",", ".").replace("-", "."))
            if num in seen:
                continue
            seen.add(num)
            title_node = a.css_first(".epl-title")
            title = title_node.text(strip=True) if title_node else text
            out.append(ChapterRef(number=num, title=title or f"Capitulo {num:g}", url=href))
        return out

    async def fetch_chapter(self, fetcher, url: str) -> RawPage:
        return await fetcher.get(url)

    def normalize_chapter(self, raw: RawPage) -> NormalizedChapter:
        return normalize(raw, self.CONTENT)


register(CentralNovelConnector())
