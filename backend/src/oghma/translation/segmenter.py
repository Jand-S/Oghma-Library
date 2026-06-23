"""Stable HTML segmentation for translated novel chapters."""
from __future__ import annotations

from collections import Counter
import hashlib
from html import escape
from html.parser import HTMLParser

from .contracts import TranslationSegment, TranslatedSegment

_TOP_LEVEL_TAGS = {"p", "blockquote", "img", "hr"}
_CONTAINER_TAGS = {"p", "blockquote", "em", "strong"}
_VOID_TAGS = {"img", "hr"}
_ALLOWED_TAGS = _TOP_LEVEL_TAGS | _CONTAINER_TAGS


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _render_starttag(tag: str, attrs: list[tuple[str, str | None]]) -> str:
    if tag != "img":
        return f"<{tag}>"

    attrs_dict = {name.lower(): value or "" for name, value in attrs}
    rendered: list[str] = []
    src = attrs_dict.get("src", "").strip()
    if src:
        rendered.append(f'src="{escape(src, quote=True)}"')
    alt = attrs_dict.get("alt", "").strip()
    if alt:
        rendered.append(f'alt="{escape(alt, quote=True)}"')
    title = attrs_dict.get("title", "").strip()
    if title:
        rendered.append(f'title="{escape(title, quote=True)}"')
    return f"<img {' '.join(rendered)}>" if rendered else "<img>"


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.parts.append(data.strip())

    def text(self) -> str:
        return " ".join(self.parts)


def html_text(fragment: str) -> str:
    parser = _TextExtractor()
    parser.feed(fragment)
    parser.close()
    return parser.text()


class _StructureParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.signature: list[str] = []
        self.forbidden_tags: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag not in _ALLOWED_TAGS:
            self.forbidden_tags.append(tag)
            return
        self.signature.append(f"<{tag}>")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in _CONTAINER_TAGS:
            self.signature.append(f"</{tag}>")


def html_structure(fragment: str) -> tuple[tuple[str, ...], tuple[str, ...]]:
    parser = _StructureParser()
    parser.feed(fragment)
    parser.close()
    return tuple(parser.signature), tuple(parser.forbidden_tags)


class _SegmentParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.counters: Counter[str] = Counter()
        self.segments: list[TranslationSegment] = []
        self.buffer: list[str] = []
        self.current_kind: str | None = None
        self.depth = 0

    def _next_key(self, kind: str) -> str:
        self.counters[kind] += 1
        return f"{kind}{self.counters[kind]:04d}"

    def _emit(self) -> None:
        if not self.current_kind or not self.buffer:
            self.buffer = []
            self.current_kind = None
            self.depth = 0
            return
        source_html = "".join(self.buffer).strip()
        if source_html:
            self.segments.append(
                TranslationSegment(
                    key=self._next_key(self.current_kind),
                    kind=self.current_kind,
                    source_html=source_html,
                    source_text=html_text(source_html),
                    source_hash=_sha256(source_html),
                )
            )
        self.buffer = []
        self.current_kind = None
        self.depth = 0

    def _emit_text_as_paragraph(self, text: str) -> None:
        stripped = text.strip()
        if not stripped:
            return
        source_html = f"<p>{escape(stripped, quote=False)}</p>"
        self.segments.append(
            TranslationSegment(
                key=self._next_key("p"),
                kind="p",
                source_html=source_html,
                source_text=stripped,
                source_hash=_sha256(source_html),
            )
        )

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag not in _ALLOWED_TAGS:
            return

        if self.depth == 0 and tag in _VOID_TAGS:
            source_html = _render_starttag(tag, attrs)
            self.segments.append(
                TranslationSegment(
                    key=self._next_key(tag),
                    kind=tag,
                    source_html=source_html,
                    source_text="",
                    source_hash=_sha256(source_html),
                )
            )
            return

        if self.depth == 0 and tag in _TOP_LEVEL_TAGS:
            self.current_kind = tag
            self.buffer = [_render_starttag(tag, attrs)]
            self.depth = 1
            return

        if self.depth > 0 and tag in _CONTAINER_TAGS:
            self.buffer.append(_render_starttag(tag, attrs))
            self.depth += 1

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if self.depth <= 0 or tag not in _CONTAINER_TAGS:
            return
        self.buffer.append(f"</{tag}>")
        self.depth -= 1
        if self.depth == 0:
            self._emit()

    def handle_data(self, data: str) -> None:
        if self.depth > 0:
            self.buffer.append(escape(data, quote=False))
        else:
            self._emit_text_as_paragraph(data)

    def close(self) -> None:
        super().close()
        self._emit()


def segment_html(html: str) -> list[TranslationSegment]:
    parser = _SegmentParser()
    parser.feed(html.lstrip("\ufeff"))
    parser.close()
    return parser.segments


def render_translated_html(
    source_segments: list[TranslationSegment],
    translated_segments: list[TranslatedSegment],
) -> str:
    by_key = {segment.key: segment for segment in translated_segments}
    return "".join(by_key[segment.key].translated_html for segment in source_segments if segment.key in by_key)
