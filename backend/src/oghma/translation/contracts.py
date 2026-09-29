"""Internal contracts for the translation pipeline.

These dataclasses are intentionally provider-neutral. API DTOs and database
models can map to them later without tying the pipeline to FastAPI or SQLAlchemy.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class GlossaryTerm:
    source: str
    target: str
    status: str = "locked"
    category: str = ""
    notes: str = ""

    @property
    def is_enforced(self) -> bool:
        return self.status in {"approved", "locked", "approved_auto", "locked_auto"}


@dataclass(frozen=True)
class TranslationSegment:
    key: str
    kind: str
    source_html: str
    source_text: str
    source_hash: str


@dataclass(frozen=True)
class TranslatedSegment:
    key: str
    translated_html: str
    notes: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class TranslationIssue:
    segment_key: str
    severity: str
    issue_type: str
    message: str
    expected: str | None = None
    actual: str | None = None

    @property
    def is_high(self) -> bool:
        return self.severity == "high"


@dataclass(frozen=True)
class TokenUsage:
    provider: str
    model: str
    operation: str
    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    total_tokens: int = 0


@dataclass(frozen=True)
class ProviderCall:
    provider: str
    model: str
    operation: str
    attempt: int
    duration_seconds: float
    status: str
    http_status: int | None = None
    error_type: str | None = None


@dataclass(frozen=True)
class CostEstimate:
    currency: str
    total: float
    details: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class TranslationContext:
    source_language: str = "en"
    target_language: str = "pt-BR"
    style_guide: str = ""
    glossary_terms: list[GlossaryTerm] = field(default_factory=list)
    max_repair_attempts: int = 2


@dataclass(frozen=True)
class TranslationRunResult:
    status: str
    translated_html: str
    segments: list[TranslatedSegment]
    issues: list[TranslationIssue]
    repair_attempts: int = 0
    usage: list[TokenUsage] = field(default_factory=list)
    provider_calls: list[ProviderCall] = field(default_factory=list)
    cost_estimates: list[CostEstimate] = field(default_factory=list)
    duration_seconds: float = 0.0

    @property
    def approved_auto(self) -> bool:
        return self.status == "approved_auto"
