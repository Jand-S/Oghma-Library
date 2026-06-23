"""Translation subsystem for long-form novel translation."""

from .contracts import (
    GlossaryTerm,
    TranslationContext,
    TranslationIssue,
    TranslationRunResult,
    TranslationSegment,
    TranslatedSegment,
)
from .pipeline import TranslationFatalError, TranslationPipeline
from .segmenter import render_translated_html, segment_html

__all__ = [
    "GlossaryTerm",
    "TranslationContext",
    "TranslationFatalError",
    "TranslationIssue",
    "TranslationPipeline",
    "TranslationRunResult",
    "TranslationSegment",
    "TranslatedSegment",
    "render_translated_html",
    "segment_html",
]
