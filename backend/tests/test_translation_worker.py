import asyncio
import json

import pytest

from oghma.translation.contracts import ProviderCall, TokenUsage
from oghma.translation.coverage import load_coverage_records
from oghma.translation.jobs import create_translation_job, get_translation_job
from oghma.translation.providers import FakeTranslationProvider
from oghma.translation.selection_history import load_selection_records
from oghma.translation.worker import TranslationWorkChapter, execute_translation_job


class CostlyFakeProvider(FakeTranslationProvider):
    def __init__(self) -> None:
        super().__init__()
        self._drain_count = 0

    def drain_usage_events(self):
        self._drain_count += 1
        if self._drain_count == 1:
            return []
        return [
            TokenUsage(
                provider="openai",
                model="gpt-4.1-mini",
                operation="translate",
                input_tokens=500_000,
                output_tokens=500_000,
                total_tokens=1_000_000,
            )
        ]

    def drain_call_events(self):
        return []


class SlowTrackingFakeProvider(FakeTranslationProvider):
    active = 0
    max_active = 0

    async def translate_segments(self, segments, context):
        type(self).active += 1
        type(self).max_active = max(type(self).max_active, type(self).active)
        await asyncio.sleep(0.01)
        try:
            return await super().translate_segments(segments, context)
        finally:
            type(self).active -= 1


class RetryingFakeProvider(SlowTrackingFakeProvider):
    def drain_call_events(self):
        return [
            ProviderCall(
                provider="openai",
                model="gpt-4.1-mini",
                operation="translate",
                attempt=2,
                duration_seconds=0.01,
                status="succeeded",
            )
        ]


@pytest.mark.asyncio
async def test_execute_translation_job_writes_outputs_coverage_and_progress(tmp_path):
    jobs_path = tmp_path / "jobs.json"
    coverage_path = tmp_path / "coverage.json"
    selection_history_path = tmp_path / "selection-history.json"
    output_root = tmp_path / "outputs"
    job = create_translation_job(
        novel_id="novel",
        chapter_from=1,
        chapter_to=2,
        selected_model="fake",
        provider="fake",
        path=jobs_path,
    )
    chapters = [
        TranslationWorkChapter("novel#1", 1, "<p>Foundation Establishment.</p>", "h1"),
        TranslationWorkChapter("novel#2", 2, "<p>Gu Master.</p>", "h2"),
    ]

    result = await execute_translation_job(
        job,
        chapters,
        lambda _: FakeTranslationProvider(),
        output_root=output_root,
        jobs_index_path=jobs_path,
        coverage_index_path=coverage_path,
        memory_index_path=tmp_path / "memory.json",
    )

    assert result.status == "done"
    persisted = get_translation_job(job.id, jobs_path)
    assert persisted is not None
    assert persisted.stats.translated_count == 2
    assert persisted.stats.progress_percent == 100
    assert (output_root / "novel" / "pt-BR" / "chapter-1.html").exists()
    assert (output_root / "novel" / "pt-BR" / "chapter-2.html.json").exists()
    coverage = load_coverage_records(coverage_path)
    assert [(item.chapter_number, item.origin, item.provider) for item in coverage] == [
        (1, "job", "fake"),
        (2, "job", "fake"),
    ]


@pytest.mark.asyncio
async def test_execute_translation_job_uses_worker_count_for_parallel_batches(tmp_path):
    SlowTrackingFakeProvider.active = 0
    SlowTrackingFakeProvider.max_active = 0
    jobs_path = tmp_path / "jobs.json"
    job = create_translation_job(
        novel_id="novel",
        chapter_from=1,
        chapter_to=4,
        selected_model="fake",
        provider="fake",
        worker_count=2,
        path=jobs_path,
    )
    chapters = [
        TranslationWorkChapter(f"novel#{index}", index, f"<p>Chapter {index}.</p>", f"h{index}")
        for index in range(1, 5)
    ]

    result = await execute_translation_job(
        job,
        chapters,
        lambda _: SlowTrackingFakeProvider(),
        output_root=tmp_path / "outputs",
        jobs_index_path=jobs_path,
        coverage_index_path=tmp_path / "coverage.json",
        memory_index_path=tmp_path / "memory.json",
    )

    assert result.status == "done"
    assert result.stats.translated_count == 4
    assert SlowTrackingFakeProvider.max_active == 2


@pytest.mark.asyncio
async def test_execute_translation_job_updates_dynamic_telemetry(tmp_path, fresh_pricing_catalog):
    jobs_path = tmp_path / "jobs.json"
    job = create_translation_job(
        novel_id="novel",
        chapter_from=1,
        chapter_to=2,
        selected_model="gpt-4.1-mini",
        provider="openai",
        estimated_cost_usd=2.0,
        path=jobs_path,
    )

    result = await execute_translation_job(
        job,
        [
            TranslationWorkChapter("novel#1", 1, "<p>Gu Master.</p>", "h1"),
            TranslationWorkChapter("novel#2", 2, "<p>Gu Master.</p>", "h2"),
        ],
        lambda _: CostlyFakeProvider(),
        output_root=tmp_path / "outputs",
        jobs_index_path=jobs_path,
        coverage_index_path=tmp_path / "coverage.json",
        memory_index_path=tmp_path / "memory.json",
    )

    assert result.status == "done"
    assert result.stats.average_seconds_per_chapter > 0
    assert result.stats.average_cost_usd_per_chapter > 0
    assert result.stats.average_input_tokens_per_chapter > 0
    assert result.stats.average_output_tokens_per_chapter > 0
    assert result.stats.output_input_ratio > 0
    assert result.stats.cost_per_minute_usd > 0
    assert result.stats.provider_stability_percent == 100
    assert result.stats.estimated_remaining_cost_usd == 0
    assert result.stats.eta_seconds == 0
    assert "Estimativa" in result.stats.telemetry_reason or "Custo" in result.stats.telemetry_reason


@pytest.mark.asyncio
async def test_execute_translation_job_reduces_effective_workers_after_retries(tmp_path):
    SlowTrackingFakeProvider.active = 0
    SlowTrackingFakeProvider.max_active = 0
    jobs_path = tmp_path / "jobs.json"
    job = create_translation_job(
        novel_id="novel",
        chapter_from=1,
        chapter_to=5,
        selected_model="fake",
        provider="fake",
        worker_count=3,
        path=jobs_path,
    )

    result = await execute_translation_job(
        job,
        [
            TranslationWorkChapter(f"novel#{index}", index, f"<p>Chapter {index}.</p>", f"h{index}")
            for index in range(1, 6)
        ],
        lambda _: RetryingFakeProvider(),
        output_root=tmp_path / "outputs",
        jobs_index_path=jobs_path,
        coverage_index_path=tmp_path / "coverage.json",
        memory_index_path=tmp_path / "memory.json",
    )

    assert result.status == "done"
    assert result.stats.retry_count >= 5
    assert result.stats.effective_worker_count < 3
    assert "Retries" in result.stats.telemetry_reason


@pytest.mark.asyncio
async def test_execute_translation_job_fails_without_chapters(tmp_path):
    jobs_path = tmp_path / "jobs.json"
    job = create_translation_job(
        novel_id="novel",
        chapter_from=1,
        chapter_to=2,
        selected_model="fake",
        provider="fake",
        path=jobs_path,
    )

    result = await execute_translation_job(
        job,
        [],
        lambda _: FakeTranslationProvider(),
        jobs_index_path=jobs_path,
        coverage_index_path=tmp_path / "coverage.json",
        memory_index_path=tmp_path / "memory.json",
    )

    assert result.status == "failed"
    assert "no downloaded chapters" in result.error


@pytest.mark.asyncio
async def test_execute_translation_job_writes_sidecar(tmp_path):
    jobs_path = tmp_path / "jobs.json"
    output_root = tmp_path / "outputs"
    job = create_translation_job(
        novel_id="novel",
        chapter_from=1,
        chapter_to=1,
        selected_model="fake",
        provider="fake",
        path=jobs_path,
    )

    await execute_translation_job(
        job,
        [TranslationWorkChapter("novel#1", 1, "<p>Gu Master.</p>", "h1")],
        lambda _: FakeTranslationProvider(),
        output_root=output_root,
        jobs_index_path=jobs_path,
        coverage_index_path=tmp_path / "coverage.json",
        memory_index_path=tmp_path / "memory.json",
    )

    payload = json.loads((output_root / "novel" / "pt-BR" / "chapter-1.html.json").read_text(encoding="utf-8"))
    assert payload["job_id"] == job.id
    assert payload["chapter_id"] == "novel#1"
    assert payload["status"] == "approved_auto"


@pytest.mark.asyncio
async def test_execute_translation_job_uses_automatic_memory_glossary(tmp_path):
    jobs_path = tmp_path / "jobs.json"
    output_root = tmp_path / "outputs"
    job = create_translation_job(
        novel_id="novel",
        chapter_from=1,
        chapter_to=1,
        selected_model="fake",
        provider="fake",
        path=jobs_path,
    )

    result = await execute_translation_job(
        job,
        [TranslationWorkChapter("novel#1", 1, "<p>The Gu Master used primeval essence.</p>", "h1")],
        lambda _: FakeTranslationProvider(),
        output_root=output_root,
        jobs_index_path=jobs_path,
        coverage_index_path=tmp_path / "coverage.json",
        memory_index_path=tmp_path / "memory.json",
    )

    html = (output_root / "novel" / "pt-BR" / "chapter-1.html").read_text(encoding="utf-8")

    assert result.status == "done"
    assert "Mestre Gu" in html
    assert "essencia primeva" in html


@pytest.mark.asyncio
async def test_execute_translation_job_stops_when_actual_cost_exceeds_budget(tmp_path, fresh_pricing_catalog):
    jobs_path = tmp_path / "jobs.json"
    job = create_translation_job(
        novel_id="novel",
        chapter_from=1,
        chapter_to=1,
        selected_model="gpt-4.1-mini",
        provider="openai",
        max_cost_usd=0.01,
        path=jobs_path,
    )

    result = await execute_translation_job(
        job,
        [TranslationWorkChapter("novel#1", 1, "<p>Gu Master.</p>", "h1")],
        lambda _: CostlyFakeProvider(),
        output_root=tmp_path / "outputs",
        jobs_index_path=jobs_path,
        coverage_index_path=tmp_path / "coverage.json",
        memory_index_path=tmp_path / "memory.json",
    )

    assert result.status == "failed"
    assert "budget" in result.error
    assert result.stats.actual_cost_usd > 0.01


@pytest.mark.asyncio
async def test_execute_translation_job_emits_live_job_and_chapter_updates(tmp_path):
    jobs_path = tmp_path / "jobs.json"
    job = create_translation_job(
        novel_id="novel",
        chapter_from=1,
        chapter_to=2,
        selected_model="gpt-4.1-mini",
        provider="fake",
        worker_count=1,
        path=jobs_path,
    )
    job_updates = []
    chapter_updates = []

    async def capture_job(updated):
        job_updates.append(updated)

    async def capture_chapter(record):
        chapter_updates.append(record)

    result = await execute_translation_job(
        job,
        [
            TranslationWorkChapter("novel#1", 1, "<p>First.</p>", "h1"),
            TranslationWorkChapter("novel#2", 2, "<p>Second.</p>", "h2"),
        ],
        lambda _: FakeTranslationProvider(),
        output_root=tmp_path / "outputs",
        jobs_index_path=jobs_path,
        coverage_index_path=tmp_path / "coverage.json",
        memory_index_path=tmp_path / "memory.json",
        on_job_update=capture_job,
        on_chapter_update=capture_chapter,
    )

    assert result.status == "done"
    assert [record.chapter_number for record in chapter_updates] == [1, 2]
    assert job_updates[0].status == "translating"
    assert job_updates[-1].status == "done"
    assert any(update.stats.translated_count == 1 for update in job_updates)


@pytest.mark.asyncio
async def test_execute_automatic_job_selects_model_before_full_translation(tmp_path):
    jobs_path = tmp_path / "jobs.json"
    coverage_path = tmp_path / "coverage.json"
    selection_history_path = tmp_path / "selection-history.json"
    output_root = tmp_path / "outputs"
    job = create_translation_job(
        novel_id="novel",
        chapter_from=1,
        chapter_to=2,
        selected_model="automatic",
        provider="fake",
        strategy="automatic",
        path=jobs_path,
    )
    chapters = [
        TranslationWorkChapter("novel#1", 1, "<p>Gu Master walked into the cave.</p>", "h1"),
        TranslationWorkChapter("novel#2", 2, "<p>The primeval essence shimmered.</p>", "h2"),
    ]

    def provider_factory(candidate_job):
        prefix = "" if candidate_job.selected_model == "google/gemini-3-flash-preview" else "[pt-BR] "
        return FakeTranslationProvider(prefix=prefix)

    result = await execute_translation_job(
        job,
        chapters,
        provider_factory,
        output_root=output_root,
        jobs_index_path=jobs_path,
        coverage_index_path=coverage_path,
        selection_history_path=selection_history_path,
        memory_index_path=tmp_path / "memory.json",
    )

    persisted = get_translation_job(job.id, jobs_path)
    selection_path = output_root / "novel" / "pt-BR" / f"job-{job.id}.automatic-selection.json"
    selection = json.loads(selection_path.read_text(encoding="utf-8"))
    records = load_selection_records(selection_history_path)

    assert result.status == "done"
    assert persisted is not None
    assert persisted.selected_model != "automatic"
    assert persisted.status == "done"
    assert selection["winner"] == persisted.selected_model
    assert len(selection["trials"]) >= 2
    assert len(records) == 1
    assert records[0].winner_model == persisted.selected_model
    assert records[0].sample_chapters == [1, 2]
    assert (output_root / "novel" / "pt-BR" / "chapter-1.html").exists()


class _FakeEditorialGrader:
    async def request_structured(self, **kwargs):
        payload = kwargs["input_payload"]
        winner = "A" if "preferido" in payload["translation_a_ptbr"] else "B"
        scores_a = _worker_scores(96 if winner == "A" else 70)
        scores_b = _worker_scores(96 if winner == "B" else 70)
        return {
            "winner": winner,
            "confidence": 0.95,
            "scores_a": scores_a,
            "scores_b": scores_b,
            "critical_issues_a": [],
            "critical_issues_b": [],
            "rationale": "fake editorial preference",
        }

    def drain_usage_events(self):
        return []

    def drain_call_events(self):
        return []


def _worker_scores(value: int):
    return {
        "fidelity": value,
        "fluency_ptbr": value,
        "voice_and_tone": value,
        "cultural_nuance": value,
        "terminology": value,
        "completeness": value,
    }


@pytest.mark.asyncio
async def test_execute_automatic_job_can_use_editorial_grader(tmp_path):
    jobs_path = tmp_path / "jobs.json"
    output_root = tmp_path / "outputs"
    job = create_translation_job(
        novel_id="novel",
        chapter_from=1,
        chapter_to=1,
        selected_model="automatic",
        provider="fake",
        strategy="automatic",
        path=jobs_path,
    )

    def provider_factory(candidate_job):
        prefix = "[pt-BR] preferido " if candidate_job.selected_model == "gpt-5.4-mini" else "[pt-BR] "
        return FakeTranslationProvider(prefix=prefix)

    result = await execute_translation_job(
        job,
        [TranslationWorkChapter("novel#1", 1, "<p>The elder spoke.</p>", "h1")],
        provider_factory,
        output_root=output_root,
        jobs_index_path=jobs_path,
        coverage_index_path=tmp_path / "coverage.json",
        selection_history_path=tmp_path / "selection-history.json",
        memory_index_path=tmp_path / "memory.json",
        editorial_grader_factory=lambda _: _FakeEditorialGrader(),
        editorial_grader_models=["fake-grader"],
    )

    persisted = get_translation_job(job.id, jobs_path)
    selection = json.loads((output_root / "novel" / "pt-BR" / f"job-{job.id}.automatic-selection.json").read_text(encoding="utf-8"))
    records = load_selection_records(tmp_path / "selection-history.json")

    assert result.status == "done"
    assert persisted is not None
    assert persisted.selected_model == "gpt-5.4-mini"
    assert selection["editorial_grade_count"] > 0
    assert records[0].editorial_grade_count > 0
