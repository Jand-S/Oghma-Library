"""Token-free post-translation edits."""
from __future__ import annotations

import re
import hashlib
from dataclasses import dataclass
from dataclasses import asdict
from datetime import datetime, timezone
from html import escape
from html.parser import HTMLParser
from pathlib import Path

from .coverage import TranslationChapterRecord, load_coverage_records, save_coverage_records


@dataclass(frozen=True)
class ReplacementTerm:
    source: str
    target: str
    case_sensitive: bool = False


@dataclass(frozen=True)
class PostEditApplyResult:
    scanned_count: int
    changed_count: int
    skipped_count: int
    changed_paths: list[str]


class _TextReplacementParser(HTMLParser):
    def __init__(self, terms: list[ReplacementTerm]) -> None:
        super().__init__(convert_charrefs=True)
        self.terms = [term for term in terms if term.source]
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
        text = data
        for term in sorted(self.terms, key=lambda item: len(item.source), reverse=True):
            flags = 0 if term.case_sensitive else re.IGNORECASE
            text = re.sub(rf"(?<!\w){re.escape(term.source)}(?!\w)", term.target, text, flags=flags)
        self.parts.append(escape(text, quote=False))

    def html(self) -> str:
        return "".join(self.parts)


def apply_safe_replacements(html: str, terms: list[ReplacementTerm]) -> str:
    parser = _TextReplacementParser(terms)
    parser.feed(html)
    parser.close()
    return parser.html()


def apply_replacements_to_coverage(
    *,
    novel_id: str,
    target_language: str,
    terms: list[ReplacementTerm],
    coverage_index_path: Path | None = None,
) -> PostEditApplyResult:
    records = load_coverage_records(coverage_index_path)
    next_records: list[TranslationChapterRecord] = []
    scanned = 0
    changed = 0
    skipped = 0
    changed_paths: list[str] = []
    for record in records:
        if record.novel_id != novel_id or record.target_language != target_language or not record.translated_path:
            next_records.append(record)
            continue
        scanned += 1
        path = Path(record.translated_path)
        if not path.exists() or not path.is_file():
            skipped += 1
            next_records.append(record)
            continue
        original = path.read_text(encoding="utf-8")
        updated = apply_safe_replacements(original, terms)
        if updated == original:
            next_records.append(record)
            continue
        path.write_text(updated, encoding="utf-8")
        changed += 1
        changed_paths.append(str(path))
        next_records.append(
            TranslationChapterRecord(
                **{
                    **asdict(record),
                    "translated_hash": _sha256(updated),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
            )
        )
    if changed:
        save_coverage_records(next_records, coverage_index_path)
    return PostEditApplyResult(
        scanned_count=scanned,
        changed_count=changed,
        skipped_count=skipped,
        changed_paths=changed_paths,
    )


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
