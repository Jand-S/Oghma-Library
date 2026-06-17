"""Normalizacao de capitulo: tira lixo e devolve conteudo semantico + hash."""
from __future__ import annotations

import re
from html import escape
from html.parser import HTMLParser as StdHTMLParser

from selectolax.parser import HTMLParser

from ..storage import sha256
from .base import NormalizedChapter, RawPage

# tags de ruido a remover do container de leitura
_NOISE = ["script", "style", "ins", "iframe", "nav", ".ads", ".code-block", ".adsbygoogle"]
_NOISE_TAGS = {"script", "style", "iframe", "ins", "nav", "noscript", "button", "form", "svg"}
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
_EMPTY_P_RE = re.compile(r"<p>\s*</p>")
_OPEN_TAG_RE = re.compile(r"^<(?:p|em|strong|blockquote)>$")
_SPACE_BEFORE_CLOSE_RE = re.compile(r"\s+</")


def _safe_img_src(src: str) -> str:
    src = src.strip()
    lower = src.lower()
    if not src or lower.startswith(("javascript:", "data:")):
        return ""
    return src


class _SemanticHTMLSanitizer(StdHTMLParser):
    """Reconstrutor allowlist para o HTML servido/exportado pelo Oghma."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.open_tags: list[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if self.skip_depth:
            if tag in _NOISE_TAGS:
                self.skip_depth += 1
            return
        if tag in _NOISE_TAGS:
            self.skip_depth = 1
            return

        mapped = _TAG_MAP.get(tag)
        if mapped is None:
            return
        if mapped == "img":
            attrs_dict = {name.lower(): value or "" for name, value in attrs}
            src = _safe_img_src(attrs_dict.get("src", ""))
            if not src:
                return
            rendered = [f'src="{escape(src, quote=True)}"']
            alt = attrs_dict.get("alt", "").strip()
            title = attrs_dict.get("title", "").strip()
            if alt:
                rendered.append(f'alt="{escape(alt, quote=True)}"')
            if title:
                rendered.append(f'title="{escape(title, quote=True)}"')
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
        if self.skip_depth:
            if tag in _NOISE_TAGS:
                self.skip_depth -= 1
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
        if self.skip_depth:
            return
        text = _SPACE_RE.sub(" ", data)
        if not text.strip():
            return
        if self.open_tags:
            if self.parts and _OPEN_TAG_RE.match(self.parts[-1]):
                text = text.lstrip()
            escaped = escape(text, quote=False)
            self.parts.append(escaped)
        else:
            escaped = escape(text.strip(), quote=False)
            self.parts.append(f"<p>{escaped}</p>")

    def close(self) -> None:
        super().close()
        while self.open_tags:
            self.parts.append(f"</{self.open_tags.pop()}>")

    def html(self) -> str:
        self.close()
        html = "".join(self.parts)
        html = _SPACE_BEFORE_CLOSE_RE.sub("</", html)
        return _EMPTY_P_RE.sub("", html).strip()


def semantic_html(fragment: str) -> str:
    """Remove wrappers/estilos e preserva apenas tags semanticas permitidas."""
    sanitizer = _SemanticHTMLSanitizer()
    sanitizer.feed(fragment)
    return sanitizer.html()


def clean_content(html: bytes, content_selector: str) -> tuple[str, str]:
    """Retorna (html_limpo, texto)."""
    tree = HTMLParser(html)
    node = tree.css_first(content_selector) or tree.body or tree.root
    if node is None:
        return "", ""
    for sel in _NOISE:
        for bad in node.css(sel):
            bad.decompose()
    inner = semantic_html(node.html or "")
    text = node.text(separator="\n", strip=True)
    return inner, text


def normalize(raw: RawPage, content_selector: str, title: str = "") -> NormalizedChapter:
    inner, text = clean_content(raw.html, content_selector)
    words = len(text.split())
    return NormalizedChapter(
        title=title,
        html=inner,
        text_hash=sha256(text),
        word_count=words,
    )
