"""Automatic per-novel translation memory and glossary index."""
from __future__ import annotations

import os
import re
from difflib import SequenceMatcher
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from ..config import get_settings
from .contracts import GlossaryTerm
from .json_index import mutate_json_index, read_json_index, write_json_index
from .segmenter import html_text


KNOWN_TERMS: dict[str, tuple[str, str, str]] = {
    "Gu Master": ("Mestre Gu", "rank_title", "locked_auto"),
    "primeval essence": ("essencia primeva", "cultivation", "locked_auto"),
    "Foundation Establishment": ("Estabelecimento de Fundacao", "cultivation", "locked_auto"),
    "Qi Condensation": ("Condensacao de Qi", "cultivation", "locked_auto"),
    "Golden Core": ("Nucleo Dourado", "cultivation", "locked_auto"),
    "Nascent Soul": ("Alma Nascente", "cultivation", "locked_auto"),
    "Dao": ("Dao", "philosophy", "locked_auto"),
    "Tao": ("Tao", "philosophy", "locked_auto"),
    "Yin": ("Yin", "philosophy", "locked_auto"),
    "Yang": ("Yang", "philosophy", "locked_auto"),
}

_CAPITALIZED_PHRASE_RE = re.compile(r"\b(?:[A-Z][a-zA-Z']+)(?:\s+(?:[A-Z][a-zA-Z']+)){1,4}\b")
_STOP_PHRASES = {
    "Chapter",
    "The",
    "A",
    "An",
    "He",
    "She",
    "They",
    "I",
}


@dataclass(frozen=True)
class MemoryChapter:
    id: str
    number: float
    html: str


@dataclass(frozen=True)
class TranslationMemoryTerm:
    novel_id: str
    source: str
    target: str
    status: str = "candidate"
    category: str = ""
    occurrences: int = 0
    first_chapter: float | None = None
    last_chapter: float | None = None
    confidence: float = 0.0
    notes: str = ""
    updated_at: str = ""

    def to_glossary_term(self) -> GlossaryTerm:
        return GlossaryTerm(
            source=self.source,
            target=self.target,
            status=self.status,
            category=self.category,
            notes=self.notes,
        )


@dataclass(frozen=True)
class MemoryConflict:
    novel_id: str
    conflict_type: str
    severity: str
    source: str
    target: str
    related_source: str
    related_target: str
    message: str


@dataclass(frozen=True)
class MemoryConflictSuggestion:
    novel_id: str
    conflict_type: str
    severity: str
    source: str
    current_target: str
    suggested_target: str
    related_source: str
    related_target: str
    confidence: float
    action: str
    reason: str


def default_memory_index_path() -> Path:
    raw = os.getenv("OGHMA_TRANSLATION_MEMORY_INDEX")
    if raw:
        return Path(raw)
    return Path(get_settings().storage_root) / "translations" / "memory-index.json"


def load_memory_terms(path: Path | None = None) -> list[TranslationMemoryTerm]:
    index_path = path or default_memory_index_path()
    if not index_path.exists():
        return []
    raw = read_json_index(index_path)
    return _memory_terms_from_raw(raw)


def _memory_terms_from_raw(raw: object) -> list[TranslationMemoryTerm]:
    raw_terms = raw.get("terms", []) if isinstance(raw, dict) else raw
    if not isinstance(raw_terms, list):
        raise ValueError("translation memory index must be a list or an object with terms[]")
    return [_term_from_payload(item) for item in raw_terms if isinstance(item, dict)]


def save_memory_terms(terms: list[TranslationMemoryTerm], path: Path | None = None) -> None:
    index_path = path or default_memory_index_path()
    payload = {
        "schema_version": 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "terms": [asdict(item) for item in sorted(terms, key=lambda item: (item.novel_id, item.source.lower()))],
    }
    write_json_index(index_path, payload)


def upsert_memory_terms(new_terms: list[TranslationMemoryTerm], path: Path | None = None) -> list[TranslationMemoryTerm]:
    index_path = path or default_memory_index_path()
    terms: list[TranslationMemoryTerm] = []

    def mutate(raw: object) -> object:
        nonlocal terms
        existing = {
            (item.novel_id, item.source.lower()): item
            for item in _memory_terms_from_raw(raw)
        }
        for term in new_terms:
            key = (term.novel_id, term.source.lower())
            current = existing.get(key)
            existing[key] = _merge_term(current, term) if current else term
        terms = list(existing.values())
        return {
            "schema_version": 1,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "terms": [
                asdict(item)
                for item in sorted(terms, key=lambda item: (item.novel_id, item.source.lower()))
            ],
        }

    mutate_json_index(index_path, mutate)
    return terms


def upsert_manual_memory_term(
    *,
    novel_id: str,
    source: str,
    target: str,
    status: str = "locked",
    category: str = "manual",
    notes: str = "user locked term",
    path: Path | None = None,
) -> TranslationMemoryTerm:
    now = datetime.now(timezone.utc).isoformat()
    term = TranslationMemoryTerm(
        novel_id=novel_id,
        source=source,
        target=target,
        status=status,
        category=category,
        occurrences=0,
        confidence=1.0,
        notes=notes,
        updated_at=now,
    )
    upsert_memory_terms([term], path)
    return next(
        item
        for item in load_memory_terms(path)
        if item.novel_id == novel_id and item.source.lower() == source.lower()
    )


def glossary_for_novel(novel_id: str, path: Path | None = None) -> list[GlossaryTerm]:
    return [
        term.to_glossary_term()
        for term in load_memory_terms(path)
        if term.novel_id == novel_id and term.to_glossary_term().is_enforced
    ]


def detect_memory_conflicts(novel_id: str, path: Path | None = None) -> list[MemoryConflict]:
    terms = [item for item in load_memory_terms(path) if item.novel_id == novel_id]
    return detect_memory_conflicts_from_terms(novel_id, terms)


def detect_memory_conflicts_from_terms(novel_id: str, terms: list[TranslationMemoryTerm]) -> list[MemoryConflict]:
    conflicts: list[MemoryConflict] = []

    by_source: dict[str, list[TranslationMemoryTerm]] = {}
    by_target: dict[str, list[TranslationMemoryTerm]] = {}
    by_normalized_source: dict[str, list[TranslationMemoryTerm]] = {}
    for term in terms:
        by_source.setdefault(term.source.lower(), []).append(term)
        by_target.setdefault(term.target.lower(), []).append(term)
        by_normalized_source.setdefault(_normalize_for_conflict(term.source), []).append(term)

    for group in by_source.values():
        targets = {item.target.lower() for item in group}
        if len(targets) > 1:
            first, *rest = sorted(group, key=lambda item: item.updated_at, reverse=True)
            for related in rest:
                conflicts.append(
                    MemoryConflict(
                        novel_id=novel_id,
                        conflict_type="same_source_different_target",
                        severity="high",
                        source=first.source,
                        target=first.target,
                        related_source=related.source,
                        related_target=related.target,
                        message="Mesmo termo original aparece com traducoes diferentes.",
                    )
                )

    for group in by_target.values():
        sources = {item.source.lower() for item in group}
        if len(sources) > 1:
            ordered = sorted(group, key=lambda item: (-item.confidence, item.source.lower()))
            first = ordered[0]
            for related in ordered[1:]:
                conflicts.append(
                    MemoryConflict(
                        novel_id=novel_id,
                        conflict_type="same_target_different_source",
                        severity="medium",
                        source=first.source,
                        target=first.target,
                        related_source=related.source,
                        related_target=related.target,
                        message="Termos originais diferentes compartilham a mesma traducao.",
                    )
                )

    for group in by_normalized_source.values():
        sources = {item.source.lower() for item in group}
        if len(sources) > 1:
            ordered = sorted(group, key=lambda item: (-item.confidence, item.source.lower()))
            first = ordered[0]
            for related in ordered[1:]:
                conflicts.append(
                    MemoryConflict(
                        novel_id=novel_id,
                        conflict_type="near_duplicate_source",
                        severity="low",
                        source=first.source,
                        target=first.target,
                        related_source=related.source,
                        related_target=related.target,
                        message="Termos parecem ser variantes do mesmo original.",
                    )
                )

    for index, term in enumerate(terms):
        normalized_source = _normalize_for_conflict(term.source)
        if len(normalized_source) < 8:
            continue
        for related in terms[index + 1 :]:
            if term.source.lower() == related.source.lower():
                continue
            normalized_related = _normalize_for_conflict(related.source)
            if len(normalized_related) < 8 or normalized_source == normalized_related:
                continue
            ratio = SequenceMatcher(None, normalized_source, normalized_related).ratio()
            if ratio < 0.88:
                continue
            conflicts.append(
                MemoryConflict(
                    novel_id=novel_id,
                    conflict_type="near_duplicate_source",
                    severity="low",
                    source=term.source,
                    target=term.target,
                    related_source=related.source,
                    related_target=related.target,
                    message="Termos originais sao muito parecidos e podem precisar de unificacao.",
                )
            )

    return _dedupe_conflicts(conflicts)


def suggest_memory_conflict_resolutions(novel_id: str, path: Path | None = None) -> list[MemoryConflictSuggestion]:
    terms = [item for item in load_memory_terms(path) if item.novel_id == novel_id]
    return suggest_memory_conflict_resolutions_from_terms(novel_id, terms)


def suggest_memory_conflict_resolutions_from_terms(
    novel_id: str,
    terms: list[TranslationMemoryTerm],
) -> list[MemoryConflictSuggestion]:
    term_lookup: dict[tuple[str, str], TranslationMemoryTerm] = {
        (item.source.lower(), item.target.lower()): item for item in terms
    }
    suggestions: list[MemoryConflictSuggestion] = []
    for conflict in detect_memory_conflicts_from_terms(novel_id, terms):
        left = term_lookup.get((conflict.source.lower(), conflict.target.lower()))
        right = term_lookup.get((conflict.related_source.lower(), conflict.related_target.lower()))
        if conflict.conflict_type == "same_source_different_target" and left and right:
            chosen = _best_memory_term([left, right])
            suggestions.append(
                MemoryConflictSuggestion(
                    novel_id=novel_id,
                    conflict_type=conflict.conflict_type,
                    severity=conflict.severity,
                    source=chosen.source,
                    current_target=conflict.target,
                    suggested_target=chosen.target,
                    related_source=conflict.related_source,
                    related_target=conflict.related_target,
                    confidence=max(0.75, chosen.confidence),
                    action="lock_source_target",
                    reason="Escolhe a traducao com maior status manual/locked, confianca e ocorrencias.",
                )
            )
            continue
        if conflict.conflict_type == "near_duplicate_source" and left and right:
            chosen = _best_memory_term([left, right])
            other = right if chosen is left else left
            suggestions.append(
                MemoryConflictSuggestion(
                    novel_id=novel_id,
                    conflict_type=conflict.conflict_type,
                    severity=conflict.severity,
                    source=other.source,
                    current_target=other.target,
                    suggested_target=chosen.target,
                    related_source=chosen.source,
                    related_target=chosen.target,
                    confidence=0.62 if chosen.target.lower() != other.target.lower() else 0.82,
                    action="lock_variant_target",
                    reason="Termos parecem variantes; a sugestao alinha a variante ao termo mais confiavel.",
                )
            )
            continue
        suggestions.append(
            MemoryConflictSuggestion(
                novel_id=novel_id,
                conflict_type=conflict.conflict_type,
                severity=conflict.severity,
                source=conflict.source,
                current_target=conflict.target,
                suggested_target=conflict.target,
                related_source=conflict.related_source,
                related_target=conflict.related_target,
                confidence=0.35,
                action="review_only",
                reason="Conflito sem resolucao deterministica segura; precisa apenas ficar visivel.",
            )
        )
    return suggestions


def update_memory_from_chapters(
    novel_id: str,
    chapters: list[MemoryChapter],
    path: Path | None = None,
) -> list[GlossaryTerm]:
    extracted = extract_memory_terms(novel_id, chapters)
    upsert_memory_terms(extracted, path)
    return glossary_for_novel(novel_id, path)


def extract_memory_terms(novel_id: str, chapters: list[MemoryChapter]) -> list[TranslationMemoryTerm]:
    now = datetime.now(timezone.utc).isoformat()
    known = _extract_known_terms(novel_id, chapters, now)
    proper = _extract_proper_terms(novel_id, chapters, now, known_sources={item.source.lower() for item in known})
    return [*known, *proper]


def _extract_known_terms(novel_id: str, chapters: list[MemoryChapter], now: str) -> list[TranslationMemoryTerm]:
    terms: list[TranslationMemoryTerm] = []
    for source, (target, category, status) in KNOWN_TERMS.items():
        matches = [
            chapter.number
            for chapter in chapters
            if re.search(rf"(?<!\w){re.escape(source)}(?!\w)", html_text(chapter.html), flags=re.IGNORECASE)
        ]
        if not matches:
            continue
        terms.append(
            TranslationMemoryTerm(
                novel_id=novel_id,
                source=source,
                target=target,
                status=status,
                category=category,
                occurrences=len(matches),
                first_chapter=min(matches),
                last_chapter=max(matches),
                confidence=0.98,
                notes="auto known-term extraction",
                updated_at=now,
            )
        )
    return terms


def _extract_proper_terms(
    novel_id: str,
    chapters: list[MemoryChapter],
    now: str,
    *,
    known_sources: set[str],
) -> list[TranslationMemoryTerm]:
    occurrences: Counter[str] = Counter()
    first_seen: dict[str, float] = {}
    last_seen: dict[str, float] = {}
    for chapter in chapters:
        text = html_text(chapter.html)
        seen_in_chapter: set[str] = set()
        for match in _CAPITALIZED_PHRASE_RE.findall(text):
            term = re.sub(r"\s+", " ", match).strip()
            if not _use_proper_term(term, known_sources):
                continue
            seen_in_chapter.add(term)
        for term in seen_in_chapter:
            occurrences[term] += 1
            first_seen[term] = min(first_seen.get(term, chapter.number), chapter.number)
            last_seen[term] = max(last_seen.get(term, chapter.number), chapter.number)
    terms: list[TranslationMemoryTerm] = []
    for source, count in occurrences.items():
        if count < 2:
            continue
        terms.append(
            TranslationMemoryTerm(
                novel_id=novel_id,
                source=source,
                target=source,
                status="approved_auto",
                category="proper_noun",
                occurrences=count,
                first_chapter=first_seen[source],
                last_chapter=last_seen[source],
                confidence=0.7,
                notes="auto repeated proper-noun extraction",
                updated_at=now,
            )
        )
    return terms


def _use_proper_term(term: str, known_sources: set[str]) -> bool:
    if term.lower() in known_sources:
        return False
    words = term.split()
    if words[0] in _STOP_PHRASES:
        return False
    if any(len(word) <= 1 for word in words):
        return False
    return True


def _normalize_for_conflict(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()
    return re.sub(r"\s+", " ", normalized)


def _best_memory_term(terms: list[TranslationMemoryTerm]) -> TranslationMemoryTerm:
    status_rank = {"candidate": 0, "approved_auto": 1, "approved": 2, "locked_auto": 3, "locked": 4}
    return sorted(
        terms,
        key=lambda item: (
            status_rank.get(item.status, 0),
            item.confidence,
            item.occurrences,
            item.updated_at,
        ),
        reverse=True,
    )[0]


def _dedupe_conflicts(conflicts: list[MemoryConflict]) -> list[MemoryConflict]:
    seen: set[tuple[str, str, str, str, str]] = set()
    deduped: list[MemoryConflict] = []
    severity_rank = {"high": 0, "medium": 1, "low": 2}
    for conflict in sorted(
        conflicts,
        key=lambda item: (
            severity_rank.get(item.severity, 9),
            item.conflict_type,
            item.source.lower(),
            item.related_source.lower(),
        ),
    ):
        pair = tuple(sorted([conflict.source.lower(), conflict.related_source.lower()]))
        key = (conflict.conflict_type, pair[0], conflict.target.lower(), pair[1], conflict.related_target.lower())
        if key in seen:
            continue
        seen.add(key)
        deduped.append(conflict)
    return deduped


def _merge_term(current: TranslationMemoryTerm | None, new: TranslationMemoryTerm) -> TranslationMemoryTerm:
    if current is None:
        return new
    status_rank = {"candidate": 0, "approved_auto": 1, "approved": 2, "locked_auto": 3, "locked": 4}
    status = current.status if status_rank.get(current.status, 0) >= status_rank.get(new.status, 0) else new.status
    return TranslationMemoryTerm(
        novel_id=current.novel_id,
        source=current.source,
        target=current.target if status_rank.get(current.status, 0) >= status_rank.get(new.status, 0) else new.target,
        status=status,
        category=current.category or new.category,
        occurrences=current.occurrences + new.occurrences,
        first_chapter=_min_optional(current.first_chapter, new.first_chapter),
        last_chapter=_max_optional(current.last_chapter, new.last_chapter),
        confidence=max(current.confidence, new.confidence),
        notes=current.notes or new.notes,
        updated_at=new.updated_at,
    )


def _term_from_payload(payload: dict) -> TranslationMemoryTerm:
    return TranslationMemoryTerm(
        novel_id=str(payload["novel_id"]),
        source=str(payload["source"]),
        target=str(payload.get("target", payload["source"])),
        status=str(payload.get("status", "candidate")),
        category=str(payload.get("category", "")),
        occurrences=int(payload.get("occurrences", 0)),
        first_chapter=_optional_float(payload.get("first_chapter")),
        last_chapter=_optional_float(payload.get("last_chapter")),
        confidence=float(payload.get("confidence", 0.0)),
        notes=str(payload.get("notes", "")),
        updated_at=str(payload.get("updated_at", "")),
    )


def translation_memory_term_from_payload(payload: dict) -> TranslationMemoryTerm:
    return _term_from_payload(payload)


def translation_memory_term_payload(term: TranslationMemoryTerm) -> dict[str, object]:
    return asdict(term)


def _optional_float(value: object) -> float | None:
    if value is None:
        return None
    return float(value)


def _min_optional(left: float | None, right: float | None) -> float | None:
    values = [item for item in (left, right) if item is not None]
    return min(values) if values else None


def _max_optional(left: float | None, right: float | None) -> float | None:
    values = [item for item in (left, right) if item is not None]
    return max(values) if values else None
