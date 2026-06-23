"""Deterministic fake provider for tests and offline pipeline work."""
from __future__ import annotations

from html import escape
from html.parser import HTMLParser

from ..contracts import (
    GlossaryTerm,
    TranslationContext,
    TranslationIssue,
    TranslationSegment,
    TranslatedSegment,
)


class _TextRewriter(HTMLParser):
    def __init__(self, glossary_terms: list[GlossaryTerm], prefix: str) -> None:
        super().__init__(convert_charrefs=True)
        self.glossary_terms = glossary_terms
        self.prefix = prefix
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        rendered_attrs = "".join(
            f' {name}="{escape(value or "", quote=True)}"'
            for name, value in attrs
            if value is not None
        )
        self.parts.append(f"<{tag}{rendered_attrs}>")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        self.parts.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if not data.strip():
            self.parts.append(data)
            return
        text = data
        terms = sorted(self.glossary_terms, key=lambda term: len(term.source), reverse=True)
        for term in terms:
            if term.is_enforced:
                text = text.replace(term.source, term.target)
        if self.prefix and not text.lstrip().startswith(self.prefix):
            text = f"{self.prefix}{text}"
        self.parts.append(escape(text, quote=False))

    def html(self) -> str:
        return "".join(self.parts)


def _rewrite_html(html: str, glossary_terms: list[GlossaryTerm], prefix: str = "[pt-BR] ") -> str:
    parser = _TextRewriter(glossary_terms, prefix)
    parser.feed(html)
    parser.close()
    return parser.html()


class FakeTranslationProvider:
    id = "fake"

    def __init__(self, *, apply_glossary_on_translate: bool = True, prefix: str = "[pt-BR] ") -> None:
        self.apply_glossary_on_translate = apply_glossary_on_translate
        self.prefix = prefix

    async def translate_segments(
        self,
        segments: list[TranslationSegment],
        context: TranslationContext,
    ) -> list[TranslatedSegment]:
        glossary = context.glossary_terms if self.apply_glossary_on_translate else []
        return [
            TranslatedSegment(
                key=segment.key,
                translated_html=_rewrite_html(segment.source_html, glossary, self.prefix),
            )
            for segment in segments
        ]

    async def repair_segments(
        self,
        source_segments: list[TranslationSegment],
        translated_segments: list[TranslatedSegment],
        issues: list[TranslationIssue],
        context: TranslationContext,
    ) -> list[TranslatedSegment]:
        issue_keys = {issue.segment_key for issue in issues}
        source_by_key = {segment.key: segment for segment in source_segments}
        repaired: list[TranslatedSegment] = []
        for translated in translated_segments:
            if translated.key not in issue_keys:
                repaired.append(translated)
                continue
            source = source_by_key.get(translated.key)
            if source is None:
                repaired.append(translated)
                continue
            repaired.append(
                TranslatedSegment(
                    key=translated.key,
                    translated_html=_rewrite_html(source.source_html, context.glossary_terms, self.prefix),
                    notes=[*translated.notes, "fake_repair"],
                )
            )
        return repaired
