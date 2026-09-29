import json

import pytest

from oghma.translation.eval_runner import (
    build_plan,
    estimate_plan_usd,
    execute_manifest,
    load_manifest,
)


def _write_manifest(tmp_path, *, provider="fake", models=None):
    chapter = tmp_path / "chapter.html"
    chapter.write_text("<p>Foundation Establishment.</p>", encoding="utf-8")
    glossary = tmp_path / "glossary.json"
    glossary.write_text(
        json.dumps(
            [
                {
                    "source": "Foundation Establishment",
                    "target": "Estabelecimento de Fundacao",
                    "status": "locked",
                }
            ]
        ),
        encoding="utf-8",
    )
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "name": "smoke",
                "provider": provider,
                "models": models or ["fake"],
                "repetitions": 2,
                "cases": [
                    {
                        "id": "chapter-001",
                        "input": "chapter.html",
                        "glossary": "glossary.json",
                        "tags": ["xianxia"],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    return manifest


def test_eval_manifest_builds_reproducible_plan(tmp_path):
    manifest = load_manifest(_write_manifest(tmp_path))

    plan = build_plan(manifest)

    assert [(run.model, run.repetition, run.case.id) for run in plan] == [
        ("fake", 1, "chapter-001"),
        ("fake", 2, "chapter-001"),
    ]
    assert estimate_plan_usd(manifest, plan) == 0.0


def test_eval_estimate_requires_known_openai_pricing(tmp_path):
    manifest = load_manifest(
        _write_manifest(tmp_path, provider="openai", models=["unknown-model"])
    )

    assert estimate_plan_usd(manifest, build_plan(manifest)) is None


def test_eval_estimate_supports_openrouter_pricing(tmp_path, fresh_pricing_catalog):
    manifest = load_manifest(
        _write_manifest(
            tmp_path,
            provider="openrouter",
            models=["deepseek/deepseek-v4-flash"],
        )
    )

    estimate = estimate_plan_usd(manifest, build_plan(manifest))

    assert estimate is not None
    assert estimate > 0


@pytest.mark.asyncio
async def test_eval_runner_writes_isolated_fake_results(tmp_path):
    manifest = load_manifest(_write_manifest(tmp_path))

    output = await execute_manifest(manifest, tmp_path / "output")

    summary = json.loads((output / "summary.json").read_text(encoding="utf-8"))
    assert summary["run_count"] == 2
    assert summary["succeeded"] == 2
    assert (output / "summary.csv").exists()
    sidecars = list(output.glob("fake/r*/chapter-001.html.json"))
    assert len(sidecars) == 2
    payload = json.loads(sidecars[0].read_text(encoding="utf-8"))
    assert payload["schema_version"] == 2
    assert payload["configuration"]["model"] == "fake"
