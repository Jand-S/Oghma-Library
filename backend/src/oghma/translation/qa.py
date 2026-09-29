"""Deterministic QA checks for translated segments."""
from __future__ import annotations

import re

from .contracts import GlossaryTerm, TranslatedSegment, TranslationIssue, TranslationSegment
from .segmenter import html_structure, html_text

FATAL_ISSUE_TYPES = {
    "missing_segment",
    "empty_translation",
    "structure_mismatch",
    "forbidden_tag",
}

SCRIPT_RANGES = {
    "hebrew": ("\u0590", "\u05ff"),
    "arabic": ("\u0600", "\u06ff"),
    "cyrillic": ("\u0400", "\u04ff"),
    "greek": ("\u0370", "\u03ff"),
}

MOJIBAKE_MARKERS = ("Ã", "Â", "â€œ", "â€", "â€™", "â€“", "â€”", "ï¿½")


def has_high_issues(issues: list[TranslationIssue]) -> bool:
    return any(issue.is_high for issue in issues)


def has_fatal_issues(issues: list[TranslationIssue]) -> bool:
    return any(issue.issue_type in FATAL_ISSUE_TYPES for issue in issues)


def _contains_term(text: str, term: str) -> bool:
    return re.search(rf"(?<!\w){re.escape(term.lower())}(?!\w)", text) is not None


def scripts_in_text(text: str) -> set[str]:
    return {
        name
        for name, (start, end) in SCRIPT_RANGES.items()
        if any(start <= character <= end for character in text)
    }


def source_integrity_issues(source_segments: list[TranslationSegment]) -> list[TranslationIssue]:
    issues: list[TranslationIssue] = []
    for source in source_segments:
        text = source.source_text.strip()
        quote_balance = text.count('"') % 2 or text.count("“") != text.count("”")
        if quote_balance:
            issues.append(
                TranslationIssue(
                    segment_key=source.key,
                    severity="medium",
                    issue_type="source_unbalanced_quotes",
                    message="Source segment has unbalanced quotation marks.",
                    actual=text,
                )
            )
        if source.kind == "p" and len(text) >= 80 and text[-1:].isalnum():
            issues.append(
                TranslationIssue(
                    segment_key=source.key,
                    severity="medium",
                    issue_type="source_truncated_sentence",
                    message="Source paragraph appears to end abruptly.",
                    actual=text,
                )
            )
    return issues


class DeterministicQA:
    def evaluate(
        self,
        source_segments: list[TranslationSegment],
        translated_segments: list[TranslatedSegment],
        glossary_terms: list[GlossaryTerm],
    ) -> list[TranslationIssue]:
        issues: list[TranslationIssue] = []
        translated_by_key = {segment.key: segment for segment in translated_segments}

        for source in source_segments:
            translated = translated_by_key.get(source.key)
            if translated is None:
                issues.append(
                    TranslationIssue(
                        segment_key=source.key,
                        severity="high",
                        issue_type="missing_segment",
                        message="Provider did not return this segment.",
                    )
                )
                continue

            issues.extend(self._validate_structure(source, translated))
            issues.extend(self._validate_scripts(source, translated))
            issues.extend(self._validate_encoding(translated))
            issues.extend(self._validate_glossary(source, translated, glossary_terms))

        return issues

    def _validate_scripts(
        self,
        source: TranslationSegment,
        translated: TranslatedSegment,
    ) -> list[TranslationIssue]:
        translated_text = html_text(translated.translated_html)
        unexpected = scripts_in_text(translated_text) - scripts_in_text(source.source_text)
        if not unexpected:
            return []
        return [
            TranslationIssue(
                segment_key=source.key,
                severity="high",
                issue_type="unexpected_script",
                message="Translated segment contains a writing system absent from the source.",
                expected="No unexpected scripts",
                actual=", ".join(sorted(unexpected)),
            )
        ]

    def _validate_encoding(self, translated: TranslatedSegment) -> list[TranslationIssue]:
        translated_text = html_text(translated.translated_html)
        markers = [marker for marker in MOJIBAKE_MARKERS if marker in translated_text]
        if not markers:
            return []
        return [
            TranslationIssue(
                segment_key=translated.key,
                severity="high",
                issue_type="mojibake",
                message="Translated segment appears to contain broken character encoding.",
                expected="Valid UTF-8 text",
                actual=", ".join(markers),
            )
        ]

    def _validate_structure(
        self,
        source: TranslationSegment,
        translated: TranslatedSegment,
    ) -> list[TranslationIssue]:
        issues: list[TranslationIssue] = []
        source_signature, _ = html_structure(source.source_html)
        translated_signature, forbidden = html_structure(translated.translated_html)
        if forbidden:
            issues.append(
                TranslationIssue(
                    segment_key=source.key,
                    severity="high",
                    issue_type="forbidden_tag",
                    message="Translated segment contains forbidden HTML tags.",
                    actual=", ".join(sorted(set(forbidden))),
                )
            )
        if source_signature != translated_signature:
            issues.append(
                TranslationIssue(
                    segment_key=source.key,
                    severity="high",
                    issue_type="structure_mismatch",
                    message="Translated segment changed the semantic HTML structure.",
                    expected=" ".join(source_signature),
                    actual=" ".join(translated_signature),
                )
            )
        if source.source_text and not html_text(translated.translated_html).strip():
            issues.append(
                TranslationIssue(
                    segment_key=source.key,
                    severity="high",
                    issue_type="empty_translation",
                    message="Translated text is empty.",
                )
            )
        return issues

    def _validate_glossary(
        self,
        source: TranslationSegment,
        translated: TranslatedSegment,
        glossary_terms: list[GlossaryTerm],
    ) -> list[TranslationIssue]:
        issues: list[TranslationIssue] = []
        source_text = source.source_text.lower()
        translated_text = html_text(translated.translated_html).lower()
        for term in glossary_terms:
            if not term.is_enforced:
                continue
            if not _contains_term(source_text, term.source):
                continue
            if _contains_term(translated_text, term.target):
                continue
            issues.append(
                TranslationIssue(
                    segment_key=source.key,
                    severity="high",
                    issue_type="glossary_mismatch",
                    message=f"Locked glossary term was not used: {term.source}",
                    expected=term.target,
                    actual=html_text(translated.translated_html),
                )
            )
        return issues
