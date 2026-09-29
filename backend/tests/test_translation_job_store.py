from dataclasses import replace

from oghma.models import TranslationJobRow
from oghma.translation.job_store import _apply_payload_to_row, _job_from_row
from oghma.translation.jobs import TranslationJobStats, create_translation_job, translation_job_payload


def test_translation_job_row_mapping_preserves_dynamic_stats(tmp_path):
    job = create_translation_job(
        novel_id="novel",
        chapter_from=1,
        chapter_to=3,
        selected_model="gpt-4.1-mini",
        provider="openai",
        path=tmp_path / "jobs.json",
    )
    job = replace(
        job,
        stats=TranslationJobStats(
            selected_count=3,
            translated_count=2,
            actual_cost_usd=0.12,
            estimated_remaining_cost_usd=0.06,
            average_seconds_per_chapter=12.5,
            eta_seconds=12.5,
            retry_count=1,
            repair_count=2,
            effective_worker_count=2,
            telemetry_reason="Retries detectados; workers efetivos: 2.",
            progress_percent=66.667,
        ),
    )
    row = TranslationJobRow(id=job.id)

    _apply_payload_to_row(row, translation_job_payload(job))
    restored = _job_from_row(row)

    assert restored.id == job.id
    assert restored.stats.actual_cost_usd == 0.12
    assert restored.stats.estimated_remaining_cost_usd == 0.06
    assert restored.stats.retry_count == 1
    assert restored.stats.repair_count == 2
    assert restored.stats.effective_worker_count == 2
    assert restored.stats.telemetry_reason.startswith("Retries")

