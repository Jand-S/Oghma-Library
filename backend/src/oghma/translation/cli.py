"""Local translation runner for HTML files."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from .contracts import GlossaryTerm, TranslationContext, TranslationRunResult
from .coverage import TranslationChapterRecord, upsert_coverage_record
from .pipeline import TranslationPipeline
from .providers import FakeTranslationProvider, OpenAIProvider
from .sanitizer import clean_translation_html


def _load_glossary(path: Path | None) -> list[GlossaryTerm]:
    if path is None:
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("glossary must be a JSON array")
    terms: list[GlossaryTerm] = []
    for item in data:
        if not isinstance(item, dict):
            raise ValueError("each glossary item must be an object")
        terms.append(
            GlossaryTerm(
                source=str(item["source"]),
                target=str(item["target"]),
                status=str(item.get("status", "locked")),
                category=str(item.get("category", "")),
                notes=str(item.get("notes", "")),
            )
        )
    return terms


def _style_guide(args: argparse.Namespace) -> str:
    if args.style_guide_file:
        return Path(args.style_guide_file).read_text(encoding="utf-8")
    return args.style_guide or ""


def _default_output_path(input_path: Path, target_language: str) -> Path:
    safe_lang = target_language.replace("/", "-")
    return Path.cwd() / "translation-workspace" / "output" / f"{input_path.stem}.{safe_lang}.html"


def _sidecar_path(output_path: Path) -> Path:
    return output_path.with_suffix(output_path.suffix + ".json")


def _provider(args: argparse.Namespace):
    if args.provider == "fake":
        return FakeTranslationProvider()
    return OpenAIProvider.from_env(
        model=args.model,
        repair_model=args.repair_model,
        reasoning_effort=args.reasoning,
    )


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _sidecar(
    result: TranslationRunResult,
    input_path: Path,
    output_path: Path,
    *,
    metadata: dict[str, Any] | None = None,
) -> dict:
    return {
        "schema_version": 2,
        **(metadata or {}),
        "input_path": str(input_path),
        "output_path": str(output_path),
        "status": result.status,
        "approved_auto": result.approved_auto,
        "repair_attempts": result.repair_attempts,
        "segment_count": len(result.segments),
        "issue_count": len(result.issues),
        "usage": [
            {
                "provider": item.provider,
                "model": item.model,
                "operation": item.operation,
                "input_tokens": item.input_tokens,
                "cached_input_tokens": item.cached_input_tokens,
                "output_tokens": item.output_tokens,
                "reasoning_tokens": item.reasoning_tokens,
                "total_tokens": item.total_tokens,
            }
            for item in result.usage
        ],
        "usage_totals": {
            "input_tokens": sum(item.input_tokens for item in result.usage),
            "cached_input_tokens": sum(item.cached_input_tokens for item in result.usage),
            "output_tokens": sum(item.output_tokens for item in result.usage),
            "reasoning_tokens": sum(item.reasoning_tokens for item in result.usage),
            "total_tokens": sum(item.total_tokens for item in result.usage),
        },
        "duration_seconds": round(result.duration_seconds, 6),
        "provider_calls": [
            {
                "provider": item.provider,
                "model": item.model,
                "operation": item.operation,
                "attempt": item.attempt,
                "duration_seconds": round(item.duration_seconds, 6),
                "status": item.status,
                "http_status": item.http_status,
                "error_type": item.error_type,
            }
            for item in result.provider_calls
        ],
        "cost_estimates": [
            {
                "currency": estimate.currency,
                "total": estimate.total,
                "details": estimate.details,
            }
            for estimate in result.cost_estimates
        ],
        "issues": [
            {
                "segment_key": issue.segment_key,
                "severity": issue.severity,
                "issue_type": issue.issue_type,
                "message": issue.message,
                "expected": issue.expected,
                "actual": issue.actual,
            }
            for issue in result.issues
        ],
    }


async def _translate_file(args: argparse.Namespace) -> int:
    input_path = Path(args.input).resolve()
    if not input_path.exists():
        raise FileNotFoundError(input_path)

    output_path = Path(args.output).resolve() if args.output else _default_output_path(input_path, args.target_language)
    context = TranslationContext(
        source_language=args.source_language,
        target_language=args.target_language,
        style_guide=_style_guide(args),
        glossary_terms=_load_glossary(Path(args.glossary).resolve() if args.glossary else None),
        max_repair_attempts=args.max_repair_attempts,
    )
    provider = _provider(args)
    pipeline = TranslationPipeline(provider)
    html = input_path.read_text(encoding="utf-8-sig")
    if not args.no_clean:
        html = clean_translation_html(html)
    source_hash = _sha256_text(html)
    started_at = datetime.now(timezone.utc)
    result = await pipeline.translate_html(html, context)
    completed_at = datetime.now(timezone.utc)
    translated_hash = _sha256_text(result.translated_html) if result.translated_html else None

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sidecar_path = _sidecar_path(output_path)
    if result.translated_html:
        output_path.write_text(result.translated_html, encoding="utf-8")
    sidecar_path.write_text(
        json.dumps(
            _sidecar(
                result,
                input_path,
                output_path,
                metadata={
                    "run_id": str(uuid4()),
                    "started_at": started_at.isoformat(),
                    "completed_at": completed_at.isoformat(),
                    "source_hash": source_hash,
                    "translated_hash": translated_hash,
                    "configuration": {
                        "provider": getattr(provider, "id", args.provider),
                        "model": getattr(provider, "model", "fake"),
                        "repair_model": getattr(provider, "repair_model", None),
                        "reasoning_effort": getattr(provider, "reasoning_effort", None),
                        "max_request_retries": getattr(provider, "max_retries", 0),
                        "max_repair_attempts": context.max_repair_attempts,
                        "source_language": context.source_language,
                        "target_language": context.target_language,
                        "style_guide_hash": _sha256_text(context.style_guide),
                        "glossary_hash": _sha256_text(
                            json.dumps(
                                [term.__dict__ for term in context.glossary_terms],
                                ensure_ascii=False,
                                sort_keys=True,
                            )
                        ),
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
                },
            ),
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    if args.novel_id and args.chapter_number is not None and result.status != "failed" and result.translated_html:
        upsert_coverage_record(
            TranslationChapterRecord(
                novel_id=args.novel_id,
                chapter_id=args.chapter_id or f"{args.novel_id}#{args.chapter_number:g}",
                chapter_number=float(args.chapter_number),
                target_language=context.target_language,
                status=result.status,
                translated_path=str(output_path),
                sidecar_path=str(sidecar_path),
                source_hash=source_hash,
                translated_hash=translated_hash,
                model=getattr(provider, "model", "fake"),
                provider=getattr(provider, "id", args.provider),
                public_reusable=not args.private_translation,
                origin="cli",
                updated_at=completed_at.isoformat(),
            ),
            Path(args.coverage_index).resolve() if args.coverage_index else None,
        )

    print(f"status: {result.status}")
    print(f"segments: {len(result.segments)}")
    print(f"issues: {len(result.issues)}")
    for estimate in result.cost_estimates:
        print(f"cost_{estimate.currency.lower()}: {estimate.total}")
    if result.translated_html:
        print(f"html: {output_path}")
    print(f"sidecar: {sidecar_path}")
    if args.novel_id and args.chapter_number is not None and result.status != "failed" and result.translated_html:
        print("coverage: updated")
    return 0 if result.status != "failed" else 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Translate a local chapter HTML file.")
    parser.add_argument("input", help="Path to the cleaned chapter HTML file.")
    parser.add_argument("--output", help="Output translated HTML path.")
    parser.add_argument("--provider", choices=["openai", "fake"], default="openai")
    parser.add_argument("--source-language", default="en")
    parser.add_argument("--target-language", default="pt-BR")
    parser.add_argument("--style-guide", default="")
    parser.add_argument("--style-guide-file")
    parser.add_argument("--glossary", help="JSON array with source/target glossary terms.")
    parser.add_argument("--no-clean", action="store_true", help="Translate input as-is without HTML cleanup.")
    parser.add_argument("--model", default=None)
    parser.add_argument("--repair-model", default=None)
    parser.add_argument("--reasoning", default=None)
    parser.add_argument("--novel-id", help="Register the output as reusable coverage for this novel id.")
    parser.add_argument("--chapter-id", default="", help="Optional source chapter id for coverage registration.")
    parser.add_argument("--chapter-number", type=float, help="Register the output as this chapter number.")
    parser.add_argument("--coverage-index", help="Override the translation coverage index path.")
    parser.add_argument("--private-translation", action="store_true", help="Register coverage as not publicly reusable.")
    parser.add_argument(
        "--max-repair-attempts",
        type=int,
        default=int(os.getenv("OGHMA_TRANSLATION_MAX_REPAIR_ATTEMPTS", "2")),
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_translate_file(args)))


if __name__ == "__main__":
    main()
