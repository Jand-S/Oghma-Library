"""DTOs de saida da API, ja no formato camelCase que o desktop espera.

A traducao 'DTO real -> tipo da UI' fica concentrada aqui + no httpBackendClient
do desktop, para a UI (appUi.tsx) nao precisar mudar.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


def to_camel(s: str) -> str:
    head, *tail = s.split("_")
    return head + "".join(w.capitalize() for w in tail)


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class SourceOut(ApiModel):
    id: str
    name: str
    base_url: str
    count: int = 0
    status: str = "online"
    enabled: bool = True
    mode: str = "static_html"
    last_sync: str = ""
    delay_ms: int = 0


class NovelOut(ApiModel):
    id: str
    title: str
    author: str = ""
    source_id: str
    source_name: str = ""
    tags: list[str] = []
    tag_keys: list[str] = []
    status: str = "ongoing"
    chapters: int = 0
    language: str = "pt-BR"
    updated_at: str = ""
    description: str = ""
    cover_url: str | None = None  # backend real manda URL; UI passa a aceitar imagem


class ChapterOut(ApiModel):
    id: str
    novel_id: str
    number: float
    title: str
    downloaded: bool = False
    word_count: int = 0


class ChapterPage(ApiModel):
    items: list[ChapterOut]
    page: int
    page_size: int
    total: int


class CrawlRunOut(ApiModel):
    id: int
    source_id: str
    status: str
    stats: dict = {}
    error: str = ""
    started_at: str = ""
    finished_at: str = ""


class TagOut(ApiModel):
    key: str
    label: str
    category: str
    aliases: list[str] = []
    count: int = 0
    review_status: str = "curated"


class TagCatalogOut(ApiModel):
    taxonomy_version: int
    items: list[TagOut] = []


class BootstrapOut(ApiModel):
    sources: list[SourceOut] = []
    novels: list[NovelOut] = []
    queue: list = []
    library: list = []


class TranslationEstimateRequest(ApiModel):
    novel_id: str
    chapter_from: float
    chapter_to: float
    mode: str = "balanced"
    models: list[str] | None = None
    usd_brl_rate: float | None = None
    source_chars: int | None = None


class TranslationModelRecommendationOut(ApiModel):
    model: str
    estimated_usd: float
    estimated_brl: float | None = None
    estimated_duration_seconds: float | None = None
    quality_score: float | None = None
    gate_pass_rate: float | None = None
    recommendation_score: float
    experimental: bool = False
    price_timestamp: str
    notes: list[str] = []


class TranslationEstimateOut(ApiModel):
    novel_id: str
    chapter_from: float
    chapter_to: float
    chapter_count: int
    source_chars: int
    estimated_input_tokens: int
    estimated_output_tokens: int
    mode: str
    recommendations: list[TranslationModelRecommendationOut]


class TranslationCoverageRangeOut(ApiModel):
    start: float
    end: float
    count: int
    freshness: str = "fresh"


class TranslationCoverageOut(ApiModel):
    novel_id: str
    chapter_from: float
    chapter_to: float
    target_language: str
    selected_count: int
    translated_count: int
    missing_count: int
    stale_count: int
    unknown_count: int
    coverage_percent: float
    ranges: list[TranslationCoverageRangeOut] = []
    stale_ranges: list[TranslationCoverageRangeOut] = []
    unknown_ranges: list[TranslationCoverageRangeOut] = []
    estimated_savings_usd: float
    estimated_savings_brl: float | None = None


class TranslationJobCreateRequest(ApiModel):
    novel_id: str
    chapter_from: float
    chapter_to: float
    target_language: str = "pt-BR"
    mode: str = "balanced"
    strategy: str = "manual"
    selected_model: str
    provider: str = ""
    worker_count: int = 1
    reuse_existing: bool = True
    max_cost_usd: float | None = None
    usd_brl_rate: float | None = None
    source_chars: int | None = None


class TranslationJobStatsOut(ApiModel):
    selected_count: int = 0
    translated_count: int = 0
    reusable_count: int = 0
    missing_count: int = 0
    stale_count: int = 0
    unknown_count: int = 0
    estimated_savings_usd: float = 0.0
    estimated_savings_brl: float | None = None
    estimated_cost_usd: float = 0.0
    estimated_cost_brl: float | None = None
    actual_cost_usd: float = 0.0
    actual_cost_brl: float | None = None
    estimated_remaining_cost_usd: float = 0.0
    estimated_remaining_cost_brl: float | None = None
    average_cost_usd_per_chapter: float = 0.0
    average_input_tokens_per_chapter: float = 0.0
    average_output_tokens_per_chapter: float = 0.0
    output_input_ratio: float = 0.0
    average_seconds_per_chapter: float = 0.0
    cost_per_minute_usd: float = 0.0
    elapsed_seconds: float = 0.0
    eta_seconds: float | None = None
    retry_count: int = 0
    repair_count: int = 0
    failed_count: int = 0
    rate_limit_count: int = 0
    retry_rate_percent: float = 0.0
    repair_rate_percent: float = 0.0
    provider_stability_percent: float = 100.0
    effective_worker_count: int = 1
    telemetry_reason: str = ""
    progress_percent: float = 0.0
    coverage_ranges: list[TranslationCoverageRangeOut] = []


class TranslationJobOut(ApiModel):
    id: str
    novel_id: str
    chapter_from: float
    chapter_to: float
    target_language: str
    mode: str
    strategy: str
    status: str
    selected_model: str
    provider: str
    worker_count: int
    reuse_existing: bool
    max_cost_usd: float | None = None
    stats: TranslationJobStatsOut
    error: str = ""
    created_at: str
    updated_at: str
    started_at: str | None = None
    finished_at: str | None = None


class TranslationAutomaticPlanRequest(ApiModel):
    novel_id: str
    chapter_from: float
    chapter_to: float
    mode: str = "balanced"
    candidate_models: list[str] | None = None
    grader_models: list[str] | None = None
    max_samples: int = 4
    max_models: int = 4
    usd_brl_rate: float | None = None


class TranslationAutomaticSampleOut(ApiModel):
    id: str
    number: float
    reason: str
    source_chars: int
    word_count: int = 0


class TranslationAutomaticPlanOut(ApiModel):
    novel_id: str
    chapter_from: float
    chapter_to: float
    mode: str
    sample_chapters: list[TranslationAutomaticSampleOut]
    candidate_models: list[str]
    estimated_sample_usd: float
    estimated_sample_brl: float | None = None
    estimated_editorial_grader_usd: float = 0.0
    estimated_editorial_grader_brl: float | None = None
    recommendations: list[TranslationModelRecommendationOut]


class TranslationSelectionTrialOut(ApiModel):
    model: str
    provider: str
    average_score: float
    total_cost_usd: float
    total_duration_seconds: float
    failure_count: int


class TranslationSelectionRecordOut(ApiModel):
    id: str
    job_id: str
    novel_id: str
    chapter_from: float
    chapter_to: float
    target_language: str
    mode: str
    winner_model: str
    winner_provider: str
    editorial_grade_count: int = 0
    editorial_cost_usd: float = 0.0
    sample_chapters: list[float] = []
    trials: list[TranslationSelectionTrialOut] = []
    created_at: str


class TranslationMemoryTermOut(ApiModel):
    novel_id: str
    source: str
    target: str
    status: str
    category: str = ""
    occurrences: int = 0
    first_chapter: float | None = None
    last_chapter: float | None = None
    confidence: float = 0.0
    notes: str = ""
    updated_at: str = ""


class TranslationMemoryConflictOut(ApiModel):
    novel_id: str
    conflict_type: str
    severity: str
    source: str
    target: str
    related_source: str
    related_target: str
    message: str


class TranslationMemoryConflictSuggestionOut(ApiModel):
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


class TranslationMemoryTermUpsertRequest(ApiModel):
    novel_id: str
    source: str
    target: str
    target_language: str = "pt-BR"
    status: str = "locked"
    category: str = "manual"
    notes: str = "user locked term"
    apply_existing: bool = False


class TranslationPostEditResultOut(ApiModel):
    scanned_count: int
    changed_count: int
    skipped_count: int
    changed_paths: list[str] = []


class TranslationMemoryTermUpsertOut(ApiModel):
    term: TranslationMemoryTermOut
    post_edit: TranslationPostEditResultOut | None = None


class TranslationMemoryConflictResolveRequest(ApiModel):
    novel_id: str
    source: str
    target: str
    target_language: str = "pt-BR"
    apply_existing: bool = False


class TranslationMemoryConflictResolveOut(ApiModel):
    term: TranslationMemoryTermOut
    post_edit: TranslationPostEditResultOut | None = None
    remaining_conflict_count: int = 0


class TranslationPricingSnapshotOut(ApiModel):
    provider: str
    model: str
    input_usd_per_1m: float
    cached_input_usd_per_1m: float
    output_usd_per_1m: float
    source_url: str
    fetched_at: str
    expires_at: str


class TranslationPricingRefreshOut(ApiModel):
    provider: str
    updated_count: int
    snapshots: list[TranslationPricingSnapshotOut] = []
