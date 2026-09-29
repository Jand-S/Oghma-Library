"""Reproducible translation model evaluation runner."""
from __future__ import annotations

import argparse
import asyncio
import csv
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from .cli import _load_glossary, _sha256_text, _sidecar
from .contracts import TranslationContext
from .pipeline import TranslationPipeline
from .pricing import pricing_for_model
from .providers import FakeTranslationProvider, OpenAIProvider, OpenRouterProvider
from .sanitizer import clean_translation_html


@dataclass(frozen=True)
class EvalCase:
    id: str
    input_path: Path
    glossary_path: Path | None = None
    style_guide_path: Path | None = None
    tags: tuple[str, ...] = ()


@dataclass(frozen=True)
class EvalRun:
    case: EvalCase
    model: str
    repetition: int


@dataclass(frozen=True)
class EvalManifest:
    name: str
    provider: str
    models: tuple[str, ...]
    cases: tuple[EvalCase, ...]
    repetitions: int = 1
    source_language: str = "en"
    target_language: str = "pt-BR"
    reasoning_effort: str = "medium"
    repair_model: str | None = None
    max_repair_attempts: int = 2


def load_manifest(path: Path) -> EvalManifest:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("eval manifest must be a JSON object")
    root = path.parent
    provider = str(raw.get("provider", "fake"))
    if provider not in {"fake", "openai", "openrouter"}:
        raise ValueError("provider must be fake, openai, or openrouter")

    raw_models = raw.get("models")
    if not isinstance(raw_models, list) or not raw_models:
        raise ValueError("manifest models must be a non-empty array")
    models = tuple(str(model) for model in raw_models)

    raw_cases = raw.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("manifest cases must be a non-empty array")
    cases: list[EvalCase] = []
    for item in raw_cases:
        if not isinstance(item, dict) or not item.get("id") or not item.get("input"):
            raise ValueError("each case requires id and input")
        input_path = _resolve(root, str(item["input"]))
        if not input_path.exists():
            raise FileNotFoundError(input_path)
        tags = item.get("tags", [])
        if not isinstance(tags, list):
            raise ValueError("case tags must be an array")
        cases.append(
            EvalCase(
                id=str(item["id"]),
                input_path=input_path,
                glossary_path=_optional_path(root, item.get("glossary")),
                style_guide_path=_optional_path(root, item.get("style_guide")),
                tags=tuple(str(tag) for tag in tags),
            )
        )

    repetitions = int(raw.get("repetitions", 1))
    if repetitions < 1:
        raise ValueError("repetitions must be at least 1")
    return EvalManifest(
        name=str(raw.get("name", path.stem)),
        provider=provider,
        models=models,
        cases=tuple(cases),
        repetitions=repetitions,
        source_language=str(raw.get("source_language", "en")),
        target_language=str(raw.get("target_language", "pt-BR")),
        reasoning_effort=str(raw.get("reasoning_effort", "medium")),
        repair_model=str(raw["repair_model"]) if raw.get("repair_model") else None,
        max_repair_attempts=int(raw.get("max_repair_attempts", 2)),
    )


def build_plan(manifest: EvalManifest) -> list[EvalRun]:
    return [
        EvalRun(case=case, model=model, repetition=repetition)
        for model in manifest.models
        for repetition in range(1, manifest.repetitions + 1)
        for case in manifest.cases
    ]


def estimate_plan_usd(manifest: EvalManifest, plan: list[EvalRun]) -> float | None:
    if manifest.provider == "fake":
        return 0.0
    total = 0.0
    for run in plan:
        pricing = pricing_for_model(run.model)
        if pricing is None:
            return None
        source = run.case.input_path.read_text(encoding="utf-8-sig")
        estimated_source_tokens = max(1, len(source) // 4)
        estimated_input = estimated_source_tokens + 1_200
        estimated_output = int(estimated_source_tokens * 1.2)
        base = estimated_input / 1_000_000 * pricing.input_usd_per_1m
        base += estimated_output / 1_000_000 * pricing.output_usd_per_1m
        total += base * 1.25
    return round(total, 6)


async def execute_manifest(
    manifest: EvalManifest,
    output_root: Path,
    *,
    max_runs: int | None = None,
) -> Path:
    session_id = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid4().hex[:8]}"
    session_root = output_root / manifest.name / session_id
    session_root.mkdir(parents=True, exist_ok=False)
    plan = build_plan(manifest)
    if max_runs is not None:
        plan = plan[:max_runs]

    rows: list[dict[str, Any]] = []
    for index, run in enumerate(plan, start=1):
        print(
            f"run {index}/{len(plan)}: {run.model} {run.case.id} r{run.repetition:02d}",
            flush=True,
        )
        row = await _execute_run(manifest, run, session_root)
        rows.append(row)
        print(f"result: {row['execution_status']}", flush=True)

    summary = {
        "schema_version": 1,
        "session_id": session_id,
        "manifest": manifest.name,
        "provider": manifest.provider,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "run_count": len(rows),
        "succeeded": sum(row["execution_status"] == "succeeded" for row in rows),
        "failed": sum(row["execution_status"] == "failed" for row in rows),
        "runs": rows,
    }
    (session_root / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    _write_csv(session_root / "summary.csv", rows)
    return session_root


async def _execute_run(manifest: EvalManifest, run: EvalRun, session_root: Path) -> dict[str, Any]:
    safe_model = run.model.replace("/", "-")
    run_root = session_root / safe_model / f"r{run.repetition:02d}"
    run_root.mkdir(parents=True, exist_ok=True)
    output_path = run_root / f"{run.case.id}.html"
    sidecar_path = output_path.with_suffix(".html.json")
    raw_html = run.case.input_path.read_text(encoding="utf-8-sig")
    html = clean_translation_html(raw_html)
    style_guide = (
        run.case.style_guide_path.read_text(encoding="utf-8")
        if run.case.style_guide_path
        else ""
    )
    context = TranslationContext(
        source_language=manifest.source_language,
        target_language=manifest.target_language,
        style_guide=style_guide,
        glossary_terms=_load_glossary(run.case.glossary_path),
        max_repair_attempts=manifest.max_repair_attempts,
    )
    provider = _make_provider(manifest, run.model)
    started_at = datetime.now(timezone.utc)
    try:
        result = await TranslationPipeline(provider).translate_html(html, context)
    except Exception as exc:
        completed_at = datetime.now(timezone.utc)
        drain_calls = getattr(provider, "drain_call_events", None)
        provider_calls = drain_calls() if callable(drain_calls) else []
        drain_usage = getattr(provider, "drain_usage_events", None)
        usage = drain_usage() if callable(drain_usage) else []
        failure = {
            "schema_version": 1,
            "eval_case": run.case.id,
            "model": run.model,
            "repetition": run.repetition,
            "execution_status": "failed",
            "error_type": type(exc).__name__,
            "started_at": started_at.isoformat(),
            "completed_at": completed_at.isoformat(),
            "duration_seconds": round((completed_at - started_at).total_seconds(), 6),
            "provider_calls": [
                {
                    "attempt": item.attempt,
                    "operation": item.operation,
                    "duration_seconds": round(item.duration_seconds, 6),
                    "status": item.status,
                    "http_status": item.http_status,
                    "error_type": item.error_type,
                }
                for item in provider_calls
            ],
            "usage": [
                {
                    "operation": item.operation,
                    "input_tokens": item.input_tokens,
                    "cached_input_tokens": item.cached_input_tokens,
                    "output_tokens": item.output_tokens,
                    "reasoning_tokens": item.reasoning_tokens,
                }
                for item in usage
            ],
        }
        sidecar_path.write_text(json.dumps(failure, ensure_ascii=False, indent=2), encoding="utf-8")
        return failure

    completed_at = datetime.now(timezone.utc)
    if result.translated_html:
        output_path.write_text(result.translated_html, encoding="utf-8")
    metadata = {
        "eval_case": run.case.id,
        "eval_tags": list(run.case.tags),
        "repetition": run.repetition,
        "execution_status": "succeeded",
        "started_at": started_at.isoformat(),
        "completed_at": completed_at.isoformat(),
        "source_hash": _sha256_text(html),
        "translated_hash": _sha256_text(result.translated_html) if result.translated_html else None,
        "configuration": {
            "provider": manifest.provider,
            "model": run.model,
            "repair_model": manifest.repair_model,
            "reasoning_effort": manifest.reasoning_effort,
            "max_repair_attempts": manifest.max_repair_attempts,
            "source_language": manifest.source_language,
            "target_language": manifest.target_language,
            "style_guide_hash": _sha256_text(style_guide),
            "glossary_terms": [
                {
                    "source": term.source,
                    "target": term.target,
                    "status": term.status,
                    "category": term.category,
                }
                for term in context.glossary_terms
                if term.is_enforced
            ],
        },
    }
    payload = _sidecar(result, run.case.input_path, output_path, metadata=metadata)
    sidecar_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    usd = next((cost.total for cost in result.cost_estimates if cost.currency == "USD"), 0.0)
    return {
        "eval_case": run.case.id,
        "model": run.model,
        "repetition": run.repetition,
        "execution_status": "succeeded",
        "translation_status": result.status,
        "duration_seconds": round(result.duration_seconds, 6),
        "input_tokens": sum(item.input_tokens for item in result.usage),
        "cached_input_tokens": sum(item.cached_input_tokens for item in result.usage),
        "output_tokens": sum(item.output_tokens for item in result.usage),
        "reasoning_tokens": sum(item.reasoning_tokens for item in result.usage),
        "repair_attempts": result.repair_attempts,
        "issue_count": len(result.issues),
        "cost_usd": usd,
        "sidecar": str(sidecar_path),
    }


def _make_provider(manifest: EvalManifest, model: str):
    if manifest.provider == "fake":
        return FakeTranslationProvider()
    if manifest.provider == "openrouter":
        return OpenRouterProvider.from_env(
            model=model,
            repair_model=manifest.repair_model,
            reasoning_effort=manifest.reasoning_effort,
        )
    return OpenAIProvider.from_env(model=model, repair_model=manifest.repair_model, reasoning_effort=manifest.reasoning_effort)


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fieldnames = sorted({key for row in rows for key in row})
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def _resolve(root: Path, value: str) -> Path:
    path = Path(value)
    return (root / path).resolve() if not path.is_absolute() else path.resolve()


def _optional_path(root: Path, value: object) -> Path | None:
    if not value:
        return None
    path = _resolve(root, str(value))
    if not path.exists():
        raise FileNotFoundError(path)
    return path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a reproducible translation model evaluation matrix.")
    parser.add_argument("manifest", help="Path to the evaluation manifest JSON.")
    parser.add_argument("--output-root", default="translation-workspace/evals")
    parser.add_argument("--execute", action="store_true", help="Execute requests; otherwise only print the plan.")
    parser.add_argument("--max-estimated-usd", type=float)
    parser.add_argument("--max-runs", type=int)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    manifest = load_manifest(Path(args.manifest).resolve())
    plan = build_plan(manifest)
    if args.max_runs is not None:
        plan = plan[: args.max_runs]
    estimate = estimate_plan_usd(manifest, plan)
    print(f"manifest: {manifest.name}")
    print(f"provider: {manifest.provider}")
    print(f"runs: {len(plan)}")
    print(f"estimated_usd: {estimate if estimate is not None else 'unknown'}")
    if not args.execute:
        print("dry_run: true (use --execute to run)")
        return
    if manifest.provider in {"openai", "openrouter"}:
        if estimate is None:
            raise SystemExit("Cannot execute: one or more models have no local pricing data.")
        if args.max_estimated_usd is None:
            raise SystemExit(f"Cannot execute {manifest.provider} eval without --max-estimated-usd.")
        if estimate > args.max_estimated_usd:
            raise SystemExit(
                f"Estimated cost ${estimate:.6f} exceeds budget ${args.max_estimated_usd:.6f}."
            )
    output = asyncio.run(
        execute_manifest(
            manifest,
            Path(args.output_root).resolve(),
            max_runs=args.max_runs,
        )
    )
    print(f"output: {output}")


if __name__ == "__main__":
    main()
