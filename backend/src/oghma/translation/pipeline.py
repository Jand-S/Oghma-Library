"""Unattended translation pipeline orchestration."""
from __future__ import annotations

from time import perf_counter

from .contracts import TranslationContext, TranslationRunResult
from .pricing import estimate_costs
from .providers.base import TranslationProvider
from .qa import DeterministicQA, has_fatal_issues, has_high_issues, source_integrity_issues
from .segmenter import render_translated_html, segment_html


class TranslationFatalError(RuntimeError):
    pass


class TranslationPipeline:
    def __init__(self, provider: TranslationProvider, qa: DeterministicQA | None = None) -> None:
        self.provider = provider
        self.qa = qa or DeterministicQA()

    async def translate_html(self, html: str, context: TranslationContext) -> TranslationRunResult:
        self._drain_provider_usage()
        self._drain_provider_calls()
        started_at = perf_counter()
        source_segments = segment_html(html)
        if not source_segments:
            raise TranslationFatalError("chapter has no translatable segments")
        source_issues = source_integrity_issues(source_segments)

        translated_segments = await self.provider.translate_segments(source_segments, context)
        issues = self.qa.evaluate(source_segments, translated_segments, context.glossary_terms)

        repair_attempts = 0
        while has_high_issues(issues) and repair_attempts < context.max_repair_attempts:
            repair_attempts += 1
            translated_segments = await self.provider.repair_segments(
                source_segments,
                translated_segments,
                issues,
                context,
            )
            issues = self.qa.evaluate(source_segments, translated_segments, context.glossary_terms)

        if has_fatal_issues(issues):
            usage = self._drain_provider_usage()
            provider_calls = self._drain_provider_calls()
            return TranslationRunResult(
                status="failed",
                translated_html="",
                segments=translated_segments,
                issues=issues,
                repair_attempts=repair_attempts,
                usage=usage,
                provider_calls=provider_calls,
                cost_estimates=estimate_costs(usage),
                duration_seconds=perf_counter() - started_at,
            )

        issues = [*issues, *source_issues]
        status = "draft_with_warnings" if issues else "approved_auto"
        usage = self._drain_provider_usage()
        provider_calls = self._drain_provider_calls()
        return TranslationRunResult(
            status=status,
            translated_html=render_translated_html(source_segments, translated_segments),
            segments=translated_segments,
            issues=issues,
            repair_attempts=repair_attempts,
            usage=usage,
            provider_calls=provider_calls,
            cost_estimates=estimate_costs(usage),
            duration_seconds=perf_counter() - started_at,
        )

    def _drain_provider_usage(self):
        drain = getattr(self.provider, "drain_usage_events", None)
        if callable(drain):
            return drain()
        return []

    def _drain_provider_calls(self):
        drain = getattr(self.provider, "drain_call_events", None)
        if callable(drain):
            return drain()
        return []
