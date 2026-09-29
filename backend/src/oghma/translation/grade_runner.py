"""Blind pairwise editorial grading for an evaluation session."""
from __future__ import annotations

import argparse
import asyncio
import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from .editorial_eval import (
    TranslationCandidate,
    candidate_pairs,
    deterministic_metrics,
    pairwise_instructions,
    pairwise_response_format,
)
from .pricing import estimate_usd, pricing_for_model
from .providers import OpenAIProvider
from .segmenter import html_text


def load_candidates(session_root: Path) -> list[TranslationCandidate]:
    summary = json.loads((session_root / "summary.json").read_text(encoding="utf-8"))
    candidates: list[TranslationCandidate] = []
    for run in summary.get("runs", []):
        if run.get("execution_status") != "succeeded" or not run.get("sidecar"):
            continue
        sidecar_path = Path(run["sidecar"])
        sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
        output_path = Path(sidecar["output_path"])
        source_path = Path(sidecar["input_path"])
        if output_path.exists() and source_path.exists():
            candidates.append(
                TranslationCandidate(
                    case_id=str(run["eval_case"]),
                    model=str(run["model"]),
                    source_path=source_path,
                    translation_path=output_path,
                    sidecar_path=sidecar_path,
                    glossary_terms=tuple(sidecar.get("configuration", {}).get("glossary_terms", [])),
                )
            )
    return candidates


def estimate_grading_usd(
    pairs: list[tuple[TranslationCandidate, TranslationCandidate]],
    graders: list[str],
) -> float | None:
    total = 0.0
    for left, right in pairs:
        chars = len(left.source_path.read_text(encoding="utf-8-sig"))
        chars += len(left.translation_path.read_text(encoding="utf-8"))
        chars += len(right.translation_path.read_text(encoding="utf-8"))
        input_tokens = chars // 4 + 900
        for grader in graders:
            pricing = pricing_for_model(grader)
            if pricing is None:
                return None
            total += input_tokens / 1_000_000 * pricing.input_usd_per_1m
            total += 1_200 / 1_000_000 * pricing.output_usd_per_1m
    return round(total * 1.2, 6)


async def grade_session(
    session_root: Path,
    graders: list[str],
    *,
    reasoning_effort: str = "low",
) -> Path:
    candidates = load_candidates(session_root)
    pairs = candidate_pairs(candidates)
    grade_id = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid4().hex[:8]}"
    output_root = session_root / "grading" / grade_id
    output_root.mkdir(parents=True, exist_ok=False)
    results: list[dict[str, Any]] = []

    total_calls = len(pairs) * len(graders)
    call_index = 0
    for pair_index, (left, right) in enumerate(pairs, start=1):
        source = html_text(left.source_path.read_text(encoding="utf-8-sig"))
        translations = {
            left.model: html_text(left.translation_path.read_text(encoding="utf-8")),
            right.model: html_text(right.translation_path.read_text(encoding="utf-8")),
        }
        for grader_index, grader_model in enumerate(graders):
            call_index += 1
            model_a, model_b = (
                (left.model, right.model)
                if grader_index % 2 == 0
                else (right.model, left.model)
            )
            print(
                f"grade {call_index}/{total_calls}: {left.case_id} pair {pair_index} judge {grader_model}",
                flush=True,
            )
            provider = OpenAIProvider.from_env(
                model=grader_model,
                reasoning_effort=reasoning_effort,
            )
            started_at = datetime.now(timezone.utc)
            try:
                grade = await provider.request_structured(
                    operation="editorial_pairwise_grade",
                    instructions=pairwise_instructions(),
                    input_payload={
                        "source_english": source,
                        "required_terminology": list(left.glossary_terms or right.glossary_terms),
                        "translation_a_ptbr": translations[model_a],
                        "translation_b_ptbr": translations[model_b],
                    },
                    response_format=pairwise_response_format(),
                )
                usage = provider.drain_usage_events()
                calls = provider.drain_call_events()
                winner_label = grade["winner"]
                winner_model = model_a if winner_label == "A" else model_b if winner_label == "B" else "tie"
                result = {
                    "case_id": left.case_id,
                    "grader": grader_model,
                    "model_a": model_a,
                    "model_b": model_b,
                    "winner": winner_model,
                    "confidence": grade["confidence"],
                    "scores": {
                        model_a: grade["scores_a"],
                        model_b: grade["scores_b"],
                    },
                    "critical_issues": {
                        model_a: grade["critical_issues_a"],
                        model_b: grade["critical_issues_b"],
                    },
                    "rationale": grade["rationale"],
                    "duration_seconds": round(
                        (datetime.now(timezone.utc) - started_at).total_seconds(), 6
                    ),
                    "usage": [item.__dict__ for item in usage],
                    "provider_calls": [item.__dict__ for item in calls],
                    "cost_usd": estimate_usd(usage).total,
                    "status": "succeeded",
                }
            except Exception as exc:
                result = {
                    "case_id": left.case_id,
                    "grader": grader_model,
                    "model_a": model_a,
                    "model_b": model_b,
                    "status": "failed",
                    "error_type": type(exc).__name__,
                    "duration_seconds": round(
                        (datetime.now(timezone.utc) - started_at).total_seconds(), 6
                    ),
                }
            results.append(result)
            print(f"result: {result['status']}", flush=True)

    deterministic = _deterministic_results(candidates)
    ranking = aggregate_ranking(results)
    payload = {
        "schema_version": 1,
        "grade_id": grade_id,
        "session_root": str(session_root),
        "graders": graders,
        "reasoning_effort": reasoning_effort,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "pair_count": len(pairs),
        "grade_count": len(results),
        "total_cost_usd": round(sum(item.get("cost_usd", 0.0) for item in results), 6),
        "ranking": ranking,
        "deterministic": deterministic,
        "grades": results,
    }
    (output_root / "grades.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    _write_ranking_csv(output_root / "ranking.csv", ranking)
    return output_root


def aggregate_ranking(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    stats: dict[str, dict[str, Any]] = {}
    for result in results:
        if result.get("status") != "succeeded":
            continue
        for model, scores in result["scores"].items():
            item = stats.setdefault(model, {"model": model, "wins": 0, "ties": 0, "losses": 0, "scores": []})
            item["scores"].append(sum(scores.values()) / len(scores))
        winner = result["winner"]
        for model in (result["model_a"], result["model_b"]):
            if winner == "tie":
                stats[model]["ties"] += 1
            elif model == winner:
                stats[model]["wins"] += 1
            else:
                stats[model]["losses"] += 1
    ranking: list[dict[str, Any]] = []
    for item in stats.values():
        scores = item.pop("scores")
        item["mean_editorial_score"] = round(sum(scores) / max(1, len(scores)), 3)
        item["points"] = item["wins"] + item["ties"] * 0.5
        ranking.append(item)
    return sorted(ranking, key=lambda item: (item["points"], item["mean_editorial_score"]), reverse=True)


def _deterministic_results(candidates: list[TranslationCandidate]) -> list[dict[str, Any]]:
    return [
        {
            "case_id": candidate.case_id,
            "model": candidate.model,
            **deterministic_metrics(
                candidate.source_path.read_text(encoding="utf-8-sig"),
                candidate.translation_path.read_text(encoding="utf-8"),
            ),
        }
        for candidate in candidates
    ]


def _write_ranking_csv(path: Path, ranking: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["model", "wins", "ties", "losses", "points", "mean_editorial_score"],
        )
        writer.writeheader()
        writer.writerows(ranking)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Blind pairwise grading for a translation eval session.")
    parser.add_argument("session", help="Evaluation session directory containing summary.json.")
    parser.add_argument("--graders", default="gpt-5.4,gpt-5.4-mini")
    parser.add_argument("--reasoning", default="low")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--max-estimated-usd", type=float)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    session_root = Path(args.session).resolve()
    graders = [item.strip() for item in args.graders.split(",") if item.strip()]
    candidates = load_candidates(session_root)
    pairs = candidate_pairs(candidates)
    estimate = estimate_grading_usd(pairs, graders)
    print(f"candidates: {len(candidates)}")
    print(f"pairs: {len(pairs)}")
    print(f"graders: {','.join(graders)}")
    print(f"calls: {len(pairs) * len(graders)}")
    print(f"estimated_usd: {estimate if estimate is not None else 'unknown'}")
    if not args.execute:
        print("dry_run: true (use --execute to grade)")
        return
    if estimate is None:
        raise SystemExit("Cannot execute: grader pricing is unknown.")
    if args.max_estimated_usd is None:
        raise SystemExit("Cannot execute without --max-estimated-usd.")
    if estimate > args.max_estimated_usd:
        raise SystemExit(
            f"Estimated cost ${estimate:.6f} exceeds budget ${args.max_estimated_usd:.6f}."
        )
    output = asyncio.run(
        grade_session(session_root, graders, reasoning_effort=args.reasoning)
    )
    print(f"output: {output}")


if __name__ == "__main__":
    main()
