"""Local translation runner for HTML files."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path

from .contracts import GlossaryTerm, TranslationContext, TranslationRunResult
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


def _sidecar(result: TranslationRunResult, input_path: Path, output_path: Path) -> dict:
    return {
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
                "total_tokens": item.total_tokens,
            }
            for item in result.usage
        ],
        "usage_totals": {
            "input_tokens": sum(item.input_tokens for item in result.usage),
            "cached_input_tokens": sum(item.cached_input_tokens for item in result.usage),
            "output_tokens": sum(item.output_tokens for item in result.usage),
            "total_tokens": sum(item.total_tokens for item in result.usage),
        },
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
    pipeline = TranslationPipeline(_provider(args))
    html = input_path.read_text(encoding="utf-8-sig")
    if not args.no_clean:
        html = clean_translation_html(html)
    result = await pipeline.translate_html(html, context)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sidecar_path = _sidecar_path(output_path)
    if result.translated_html:
        output_path.write_text(result.translated_html, encoding="utf-8")
    sidecar_path.write_text(
        json.dumps(_sidecar(result, input_path, output_path), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"status: {result.status}")
    print(f"segments: {len(result.segments)}")
    print(f"issues: {len(result.issues)}")
    for estimate in result.cost_estimates:
        print(f"cost_{estimate.currency.lower()}: {estimate.total}")
    if result.translated_html:
        print(f"html: {output_path}")
    print(f"sidecar: {sidecar_path}")
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
