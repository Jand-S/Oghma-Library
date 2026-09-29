import pytest

from oghma.translation.auto_select import (
    CandidateChapter,
    build_automatic_selection_plan,
    choose_editorial_winner,
    choose_trial_winner,
    grade_automatic_trials_pairwise,
    run_automatic_model_trials,
    select_sample_chapters,
)
from oghma.translation.providers import FakeTranslationProvider


def _chapter(number: int, words: int = 100) -> CandidateChapter:
    return CandidateChapter(
        id=f"novel#{number}",
        number=float(number),
        html="<p>" + ("word " * words) + "</p>",
        word_count=words,
    )


def test_select_sample_chapters_spreads_across_range_and_keeps_order():
    chapters = [_chapter(index, words=100 + index) for index in range(1, 101)]

    sample = select_sample_chapters(chapters, max_samples=4)

    assert [item.number for item in sample] == [1, 26, 51, 100]


def test_select_sample_chapters_includes_dense_when_it_fits():
    chapters = [_chapter(index, words=100) for index in range(1, 9)]
    chapters[2] = _chapter(3, words=10_000)

    sample = select_sample_chapters(chapters, max_samples=5)

    assert 3 in [item.number for item in sample]


def test_build_automatic_selection_plan_limits_models_and_estimates_sample_cost(fresh_pricing_catalog):
    chapters = [_chapter(index, words=200 + index) for index in range(1, 20)]

    plan = build_automatic_selection_plan(
        chapters,
        candidate_models=[
            "google/gemini-3-flash-preview",
            "gpt-5.4-mini",
            "gpt-4.1-mini",
            "deepseek/deepseek-v4-pro",
            "deepseek/deepseek-v4-flash",
        ],
        max_samples=3,
        max_models=2,
        usd_brl_rate=5.5,
    )

    assert len(plan.sample_chapters) == 3
    assert plan.candidate_models == ["google/gemini-3-flash-preview", "gpt-5.4-mini"]
    assert len(plan.recommendations) == 2
    assert plan.estimated_sample_usd == round(sum(item.estimated_usd for item in plan.recommendations), 6)
    assert plan.estimated_sample_brl == round(plan.estimated_sample_usd * 5.5, 6)


@pytest.mark.asyncio
async def test_run_automatic_model_trials_scores_and_selects_winner():
    chapters = [
        CandidateChapter(id="chapter-1", number=1, html="<p>Gu Master walked into the cave.</p>", word_count=8),
        CandidateChapter(id="chapter-2", number=2, html="<p>The primeval essence shimmered.</p>", word_count=5),
    ]

    def provider_for_model(model: str):
        if model == "bad-model":
            return FakeTranslationProvider(prefix="")
        return FakeTranslationProvider(prefix="[pt-BR] ")

    trials = await run_automatic_model_trials(
        chapters,
        candidate_models=["bad-model", "good-model"],
        provider_for_model=provider_for_model,
        max_samples=2,
    )

    winner = choose_trial_winner(trials)

    assert [trial.model for trial in trials] == ["good-model", "bad-model"]
    assert winner is not None
    assert winner.model == "good-model"
    assert winner.average_score > trials[1].average_score
    assert all(result.status != "failed" for result in winner.sample_results)


class _FakeGrader:
    async def request_structured(self, **kwargs):
        payload = kwargs["input_payload"]
        winner = "A" if "melhor" in payload["translation_a_ptbr"] else "B"
        return {
            "winner": winner,
            "confidence": 0.9,
            "scores_a": _scores(95 if winner == "A" else 70),
            "scores_b": _scores(95 if winner == "B" else 70),
            "critical_issues_a": [],
            "critical_issues_b": [],
            "rationale": "fake grader",
        }

    def drain_usage_events(self):
        return []

    def drain_call_events(self):
        return []


def _scores(value: int):
    return {
        "fidelity": value,
        "fluency_ptbr": value,
        "voice_and_tone": value,
        "cultural_nuance": value,
        "terminology": value,
        "completeness": value,
    }


@pytest.mark.asyncio
async def test_pairwise_editorial_grader_can_choose_winner():
    chapters = [
        CandidateChapter(id="chapter-1", number=1, html="<p>The elder spoke.</p>", word_count=4),
    ]

    def provider_for_model(model: str):
        prefix = "[pt-BR] melhor " if model == "editorial-model" else "[pt-BR] "
        return FakeTranslationProvider(prefix=prefix)

    trials = await run_automatic_model_trials(
        chapters,
        candidate_models=["metric-model", "editorial-model"],
        provider_for_model=provider_for_model,
        max_samples=1,
    )
    grades = await grade_automatic_trials_pairwise(
        chapters,
        trials,
        grader_models=["fake-grader"],
        grader_factory=lambda _: _FakeGrader(),
    )
    winner = choose_editorial_winner(trials, grades)

    assert grades[0]["status"] == "succeeded"
    assert winner is not None
    assert winner.model == "editorial-model"
