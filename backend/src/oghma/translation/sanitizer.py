"""HTML cleanup for local translation inputs."""
from __future__ import annotations

import re
from html import escape
from html.parser import HTMLParser

_NOISE_TAGS = {
    "script",
    "style",
    "iframe",
    "ins",
    "nav",
    "noscript",
    "button",
    "form",
    "svg",
    "head",
    "title",
}
_TAG_MAP = {
    "p": "p",
    "em": "em",
    "i": "em",
    "strong": "strong",
    "b": "strong",
    "blockquote": "blockquote",
    "img": "img",
    "hr": "hr",
}
_CONTAINER_TAGS = {"p", "em", "strong", "blockquote"}
_VOID_TAGS = {"img", "hr"}
_SPACE_RE = re.compile(r"\s+")
_SPACE_BEFORE_CLOSE_RE = re.compile(r"\s+</")
_EMPTY_P_RE = re.compile(r"<p>\s*</p>")
_MOJIBAKE_MARKERS = ("â€œ", "â€", "â€™", "â€“", "Â")


_MOJIBAKE_MARKERS_V2 = ("\u00e2\u20ac", "\u00c3", "\u00c2")


def _safe_src(src: str) -> str:
    src = src.strip()
    if not src or src.lower().startswith(("javascript:", "data:")):
        return ""
    return src


def repair_common_mojibake(text: str) -> str:
    repaired = text
    for _ in range(2):
        candidate = _repair_mojibake_pass(repaired)
        if candidate == repaired:
            break
        repaired = candidate
    return repaired


def _repair_mojibake_pass(text: str) -> str:
    if not _mojibake_score(text):
        return text
    try:
        repaired = _encode_mojibake_bytes(text).decode("utf-8")
    except UnicodeError:
        parts = re.split(r"(\s+)", text)
        repaired = "".join(_repair_mojibake_chunk(part) for part in parts)
    return repaired if _mojibake_score(repaired) < _mojibake_score(text) else text


def _repair_mojibake_chunk(value: str) -> str:
    if not _mojibake_score(value):
        return value
    try:
        return _encode_mojibake_bytes(value).decode("utf-8")
    except UnicodeError:
        return value


def _mojibake_score(value: str) -> int:
    return sum(value.count(marker) for marker in _MOJIBAKE_MARKERS_V2)


def _encode_mojibake_bytes(value: str) -> bytes:
    output = bytearray()
    for character in value:
        codepoint = ord(character)
        if 0x80 <= codepoint <= 0x9F:
            output.append(codepoint)
        else:
            output.extend(character.encode("cp1252"))
    return bytes(output)


class _TranslationHTMLSanitizer(HTMLParser):
    def __init__(self, *, require_body: bool) -> None:
        super().__init__(convert_charrefs=True)
        self.require_body = require_body
        self.body_depth = 0
        self.skip_depth = 0
        self.parts: list[str] = []
        self.open_tags: list[str] = []

    @property
    def active(self) -> bool:
        return not self.require_body or self.body_depth > 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "body":
            self.body_depth += 1
            return
        if self.skip_depth:
            if tag in _NOISE_TAGS:
                self.skip_depth += 1
            return
        if tag in _NOISE_TAGS:
            self.skip_depth = 1
            return
        if not self.active:
            return

        mapped = _TAG_MAP.get(tag)
        if mapped is None:
            return
        if mapped == "p" and self.open_tags and self.open_tags[-1] == "p":
            self.parts.append("</p>")
            self.open_tags.pop()
        if mapped == "img":
            attrs_dict = {name.lower(): value or "" for name, value in attrs}
            src = _safe_src(attrs_dict.get("src", ""))
            if not src:
                return
            rendered = [f'src="{escape(src, quote=True)}"']
            alt = attrs_dict.get("alt", "").strip()
            if alt:
                rendered.append(f'alt="{escape(alt, quote=True)}"')
            self.parts.append(f"<img {' '.join(rendered)}>")
            return
        if mapped == "hr":
            self.parts.append("<hr>")
            return

        self.parts.append(f"<{mapped}>")
        self.open_tags.append(mapped)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "body":
            self.body_depth = max(0, self.body_depth - 1)
            return
        if self.skip_depth:
            if tag in _NOISE_TAGS:
                self.skip_depth -= 1
            return
        if not self.active:
            return

        mapped = _TAG_MAP.get(tag)
        if mapped is None or mapped in _VOID_TAGS or mapped not in _CONTAINER_TAGS:
            return
        while self.open_tags:
            current = self.open_tags.pop()
            self.parts.append(f"</{current}>")
            if current == mapped:
                break

    def handle_data(self, data: str) -> None:
        if self.skip_depth or not self.active:
            return
        text = _SPACE_RE.sub(" ", data)
        if not text.strip():
            return
        if self.open_tags:
            self.parts.append(escape(text, quote=False))
        else:
            self.parts.append(f"<p>{escape(text.strip(), quote=False)}</p>")

    def close(self) -> None:
        super().close()
        while self.open_tags:
            self.parts.append(f"</{self.open_tags.pop()}>")

    def html(self) -> str:
        self.close()
        html = "".join(self.parts)
        html = _SPACE_BEFORE_CLOSE_RE.sub("</", html)
        return _EMPTY_P_RE.sub("", html).strip()


def clean_translation_html(html: str) -> str:
    require_body = "<html" in html[:1000].lower() or "<body" in html[:2000].lower()
    parser = _TranslationHTMLSanitizer(require_body=require_body)
    parser.feed(repair_common_mojibake(html).lstrip("\ufeff"))
    return parser.html()
