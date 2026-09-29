import pytest

from oghma.translation.coverage import CoverageRange, TranslationCoverage
from oghma.translation.jobs import (
    create_translation_job,
    get_translation_job,
    load_translation_jobs,
    update_translation_job_status,
)


def test_create_translation_job_persists_initial_snapshot(tmp_path):
    path = tmp_path / "jobs-index.json"
    coverage = TranslationCoverage(
        selected_count=10,
        translated_count=4,
        missing_count=6,
        stale_count=1,
        unknown_count=0,
        coverage_percent=40,
        ranges=[CoverageRange(1, 4, 4)],
        stale_ranges=[CoverageRange(9, 9, 1, "stale")],
        unknown_ranges=[],
        estimated_savings_usd=0.12,
        estimated_savings_brl=0.66,
    )

    job = create_translation_job(
        novel_id="novel",
        chapter_from=1,
        chapter_to=10,
        selected_model="google/gemini-3-flash-preview",
        provider="openrouter",
        worker_count=3,
        coverage=coverage,
        estimated_cost_usd=0.5,
        estimated_cost_brl=2.75,
        max_cost_usd=0.75,
        path=path,
    )

    loaded = load_translation_jobs(path)
    assert len(loaded) == 1
    assert loaded[0].id == job.id
    assert loaded[0].status == "queued"
    assert loaded[0].stats.reusable_count == 4
    assert loaded[0].stats.missing_count == 6
    assert loaded[0].stats.estimated_savings_brl == 0.66
    assert loaded[0].stats.estimated_cost_usd == 0.5
    assert loaded[0].max_cost_usd == 0.75
    assert loaded[0].stats.coverage_ranges == [CoverageRange(1, 4, 4)]


def test_update_translation_job_status_sets_timestamps(tmp_path):
    path = tmp_path / "jobs-index.json"
    job = create_translation_job(
        novel_id="novel",
        chapter_from=1,
        chapter_to=2,
        selected_model="gpt-4.1-mini",
        provider="openai",
        path=path,
    )

    running = update_translation_job_status(job.id, "translating", path=path)
    done = update_translation_job_status(job.id, "done", path=path)

    assert running.started_at is not None
    assert done.finished_at is not None
    assert get_translation_job(job.id, path).status == "done"


def test_update_translation_job_status_rejects_unknown_status(tmp_path):
    path = tmp_path / "jobs-index.json"
    job = create_translation_job(
        novel_id="novel",
        chapter_from=1,
        chapter_to=2,
        selected_model="gpt-4.1-mini",
        provider="openai",
        path=path,
    )

    with pytest.raises(ValueError):
        update_translation_job_status(job.id, "wat", path=path)
