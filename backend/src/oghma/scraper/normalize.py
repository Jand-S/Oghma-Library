"""Normalizacao de capitulo: tira lixo e devolve conteudo semantico + hash."""
from __future__ import annotations

import re
from html import escape, unescape
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


# ---------------------------------------------------------------- validacao de capitulo

# Textos que alguns sites devolvem com HTTP 200 no lugar do capitulo (carregador de SPA,
# limite de requisicoes, desafio anti-bot). So contam quando o capitulo e curto.
_PLACEHOLDER_RE = re.compile(
    r"^(?:\s*(?:loading|carregando)\s*(?:\.{3}|…)?\s*)+$"
    r"|rate limit exceeded|too many requests|just a moment|checking your browser"
    r"|enable javascript|attention required",
    re.IGNORECASE,
)
_PLACEHOLDER_MAX_WORDS = 40


def chapter_problem(html: str) -> str | None:
    """Motivo para recusar um capitulo normalizado, ou None se ele tem conteudo.

    `empty`: sem texto e sem imagem. `placeholder`: texto curto que e um carregador ou
    aviso do site, nao o capitulo. Paginas so de ilustracao sao aceitas.
    """
    tree = HTMLParser(html or "")
    text = tree.text(separator=" ", strip=True) if tree.root is not None else ""
    has_image = tree.css_first("img[src]") is not None
    if not text.strip():
        return None if has_image else "empty"
    if len(text.split()) <= _PLACEHOLDER_MAX_WORDS and _PLACEHOLDER_RE.search(text.strip()):
        return "placeholder"
    return None


# ---------------------------------------------------------------- sinopse

_DESC_BLOCK_TAGS = re.compile(r"</?(?:p|div|h[1-6]|li|ul|ol|blockquote|center|section|article)\b[^>]*>", re.I)
_DESC_BR = re.compile(r"<br\s*/?>", re.I)
_DESC_HR = re.compile(r"<hr\b[^>]*>", re.I)
_DESC_TAG = re.compile(r"<[^>]+>")
# Linha que e propaganda, aviso ou credito, nao sinopse.
_DESC_JUNK_LINE = re.compile(
    r"https?://|www\.|discord|patreon|ko-?fi|catarse|picpay|\bpix\b|apoi[ae]|doa[çc][ãa]o|doe\b"
    r"|an[úu]ncio|publicidade|adblock|leia (?:tamb[ée]m|mais|em)|clique|siga-nos|siga a gente"
    r"|^(?:tradu[çc][ãa]o|tradutor(?:a)?|revis[ãa]o|revisor(?:a)?|editor(?:a)?|raws?|fonte|status"
    r"|scan|grupo)\s*:"
    r"|sem autoriza[çc][ãa]o pr[ée]via|solicitar a remo[çc][ãa]o|direitos legais sobre a obra"
    r"|entrar em contato|entre em contato|^aviso\b",
    re.IGNORECASE,
)
_DESC_PREFIX = re.compile(r"^\s*(?:sinopse|synopsis|resumo)\s*[:\-–]\s*", re.I)
# Rodape que alguns sites colam no fim da sinopse (aviso legal do agregador, creditos).
# Funciona tambem em texto ja salvo sem tags, onde o <hr> se perdeu.
_DESC_FOOTER = re.compile(
    r"\bAVISO(?![a-zà-ÿ])|Esta (?:novel|obra|hist[óo]ria) foi traduzida pel[ao]|Se voc[êe] possui os direitos"
)
_DESC_FOOTER_MIN_HEAD = 40
_DESC_INLINE_SPACE = re.compile(r"[ \t ]+")
_DESC_MAX_CHARS = 4000


def clean_description(value: str | None) -> str | None:
    """Sinopse em texto puro: paragrafos separados por linha em branco, sem HTML, sem
    entidades e sem os blocos de aviso, credito e propaganda que os sites anexam."""
    if not value:
        return None
    text = value
    is_html = bool(_DESC_TAG.search(text))
    # Tudo depois da primeira linha horizontal e rodape do site, desde que sobre texto antes.
    head = _DESC_HR.split(text, maxsplit=1)[0]
    if _DESC_TAG.sub("", unescape(head)).strip():
        text = head
    footer = _DESC_FOOTER.search(text)
    if footer and len(_DESC_TAG.sub("", text[: footer.start()]).strip()) >= _DESC_FOOTER_MIN_HEAD:
        text = text[: footer.start()]
    text = _DESC_BR.sub("\n", text)
    text = _DESC_BLOCK_TAGS.sub("\n\n", text)
    text = _DESC_TAG.sub("", text)
    text = unescape(text)
    paragraphs: list[str] = []
    for block in re.split(r"\n\s*\n", text):
        lines = [_DESC_INLINE_SPACE.sub(" ", line).strip() for line in block.splitlines()]
        lines = [line for line in lines if line and not _DESC_JUNK_LINE.search(line)]
        if lines:
            # Em HTML a quebra dentro de um bloco e so formatacao do codigo-fonte; em texto
            # puro e uma quebra que o autor escreveu e fica.
            paragraphs.append(" ".join(lines) if is_html else "\n".join(lines))
    if paragraphs:
        paragraphs[0] = _DESC_PREFIX.sub("", paragraphs[0], count=1).strip() or paragraphs[0]
    out = "\n\n".join(p for p in paragraphs if p)
    if len(out) > _DESC_MAX_CHARS:
        out = out[:_DESC_MAX_CHARS].rsplit(" ", 1)[0] + "…"
    return out or None
