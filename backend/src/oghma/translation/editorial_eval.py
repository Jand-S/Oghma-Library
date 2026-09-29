"""Deterministic and model-based editorial translation evaluation."""
from __future__ import annotations

import re
from dataclasses import dataclass
from itertools import combinations
from pathlib import Path
from typing import Any

from .contracts import GlossaryTerm
from .qa import scripts_in_text
from .segmenter import html_text

_WORD_RE = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ']+")
_ENGLISH_MARKERS = {
    "the", "and", "was", "were", "with", "from", "his", "her", "their",
    "they", "that", "this", "had", "have", "into", "while", "when", "which",
    "who", "would", "could", "should", "there", "then", "than", "upon", "only",
}


@dataclass(frozen=True)
class TranslationCandidate:
    case_id: str
    model: str
    source_path: Path
    translation_path: Path
    sidecar_path: Path
    glossary_terms: tuple[dict[str, str], ...] = ()


def candidate_pairs(candidates: list[TranslationCandidate]) -> list[tuple[TranslationCandidate, TranslationCandidate]]:
    grouped: dict[str, list[TranslationCandidate]] = {}
    for candidate in candidates:
        grouped.setdefault(candidate.case_id, []).append(candidate)
    pairs: list[tuple[TranslationCandidate, TranslationCandidate]] = []
    for case_id in sorted(grouped):
        ordered = sorted(grouped[case_id], key=lambda item: item.model)
        pairs.extend(combinations(ordered, 2))
    return pairs


def deterministic_metrics(
    source_html: str,
    translated_html: str,
    glossary: list[GlossaryTerm] | None = None,
) -> dict[str, float | int]:
    source = html_text(source_html)
    target = html_text(translated_html)
    source_words = _words(source)
    target_words = _words(target)
    target_lower = [word.lower() for word in target_words]
    english_markers = sum(word in _ENGLISH_MARKERS for word in target_lower)
    residual_ngrams = _residual_source_ngrams(source_words, target)
    unexpected_scripts = scripts_in_text(target) - scripts_in_text(source)
    enforced = [term for term in glossary or [] if term.is_enforced and term.source.lower() in source.lower()]
    matched = sum(term.target.lower() in target.lower() for term in enforced)
    return {
        "source_words": len(source_words),
        "target_words": len(target_words),
        "length_ratio": round(len(target_words) / max(1, len(source_words)), 6),
        "english_marker_count": english_markers,
        "english_marker_rate": round(english_markers / max(1, len(target_words)), 6),
        "residual_source_ngram_count": residual_ngrams,
        "unexpected_script_count": len(unexpected_scripts),
        "glossary_applicable": len(enforced),
        "glossary_matched": matched,
        "glossary_accuracy": round(matched / max(1, len(enforced)), 6) if enforced else 1.0,
    }


def pairwise_instructions() -> str:
    return "\n".join(
        [
            "You are a strict bilingual literary translation evaluator.",
            "Compare two anonymous English to Brazilian Portuguese translations of the same novel chapter.",
            "Judge fidelity to the supplied English source, natural pt-BR prose, preservation of voice and tone,",
            "cultural and philosophical nuance, terminology consistency, and absence of omissions or inventions.",
            "Do not prefer verbosity. Do not infer or restore unavailable Chinese source text.",
            "Treat supplied required terminology as authoritative when it is present.",
            "Ignore the labels A and B as indicators of quality.",
            "Use the full 0-100 range and return only the requested JSON.",
        ]
    )


def pairwise_response_format() -> dict[str, Any]:
    score_properties = {
        "fidelity": {"type": "integer", "minimum": 0, "maximum": 100},
        "fluency_ptbr": {"type": "integer", "minimum": 0, "maximum": 100},
        "voice_and_tone": {"type": "integer", "minimum": 0, "maximum": 100},
        "cultural_nuance": {"type": "integer", "minimum": 0, "maximum": 100},
        "terminology": {"type": "integer", "minimum": 0, "maximum": 100},
        "completeness": {"type": "integer", "minimum": 0, "maximum": 100},
    }
    score_schema = {
        "type": "object",
        "properties": score_properties,
        "required": list(score_properties),
        "additionalProperties": False,
    }
    return {
        "type": "json_schema",
        "name": "pairwise_translation_grade",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "winner": {"type": "string", "enum": ["A", "B", "tie"]},
                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                "scores_a": score_schema,
                "scores_b": score_schema,
                "critical_issues_a": {"type": "array", "items": {"type": "string"}},
                "critical_issues_b": {"type": "array", "items": {"type": "string"}},
                "rationale": {"type": "string"},
            },
            "required": [
                "winner", "confidence", "scores_a", "scores_b",
                "critical_issues_a", "critical_issues_b", "rationale",
            ],
            "additionalProperties": False,
        },
    }


def _words(text: str) -> list[str]:
    return _WORD_RE.findall(text)


def _residual_source_ngrams(source_words: list[str], target_text: str, size: int = 5) -> int:
    target = " ".join(word.lower() for word in _words(target_text))
    source = [word.lower() for word in source_words]
    phrases = {
        " ".join(source[index:index + size])
        for index in range(max(0, len(source) - size + 1))
    }
    return sum(phrase in target for phrase in phrases)
