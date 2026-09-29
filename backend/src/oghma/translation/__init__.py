"""Translation subsystem for long-form novel translation."""

from .contracts import (
    GlossaryTerm,
    ProviderCall,
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
    "ProviderCall",
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
