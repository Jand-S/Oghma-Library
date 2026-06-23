from __future__ import annotations

from typing import Protocol

from ..contracts import (
    TranslationContext,
    TranslationIssue,
    TranslationSegment,
    TranslatedSegment,
)


class TranslationProvider(Protocol):
    id: str

    async def translate_segments(
        self,
        segments: list[TranslationSegment],
        context: TranslationContext,
    ) -> list[TranslatedSegment]:
        ...

    async def repair_segments(
        self,
        source_segments: list[TranslationSegment],
        translated_segments: list[TranslatedSegment],
        issues: list[TranslationIssue],
        context: TranslationContext,
    ) -> list[TranslatedSegment]:
        ...
