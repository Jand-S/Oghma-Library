"""Token cost estimation for translation runs."""
from __future__ import annotations

import os
import json
import urllib.request
import re
from html.parser import HTMLParser
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ..config import get_settings
from .contracts import CostEstimate, TokenUsage
from .json_index import mutate_json_index, read_json_index, write_json_index


@dataclass(frozen=True)
class ModelPricing:
    input_usd_per_1m: float
    cached_input_usd_per_1m: float
    output_usd_per_1m: float


@dataclass(frozen=True)
class PricingSnapshot:
    provider: str
    model: str
    input_usd_per_1m: float
    cached_input_usd_per_1m: float
    output_usd_per_1m: float
    source_url: str
    fetched_at: str
    expires_at: str

    def to_model_pricing(self) -> ModelPricing:
        return ModelPricing(
            input_usd_per_1m=self.input_usd_per_1m,
            cached_input_usd_per_1m=self.cached_input_usd_per_1m,
            output_usd_per_1m=self.output_usd_per_1m,
        )


OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
OPENAI_PRICING_URL = "https://developers.openai.com/api/docs/pricing"
DEEPSEEK_PRICING_URL = "https://api-docs.deepseek.com/quick_start/pricing-details-usd/"
GEMINI_PRICING_URL = "https://ai.google.dev/gemini-api/docs/pricing?hl=en"
DIRECT_PRICING_URLS = {
    "openai": OPENAI_PRICING_URL,
    "deepseek": DEEPSEEK_PRICING_URL,
    "gemini": GEMINI_PRICING_URL,
}


def default_pricing_index_path() -> Path:
    raw = os.getenv("OGHMA_TRANSLATION_PRICING_INDEX")
    if raw:
        return Path(raw)
    return Path(get_settings().storage_root) / "translations" / "pricing-snapshot.json"


def load_pricing_snapshots(path: Path | None = None) -> list[PricingSnapshot]:
    index_path = path or default_pricing_index_path()
    if not index_path.exists():
        return []
    raw = read_json_index(index_path)
    return _pricing_snapshots_from_raw(raw)


def _pricing_snapshots_from_raw(raw: object) -> list[PricingSnapshot]:
    raw_items = raw.get("snapshots", []) if isinstance(raw, dict) else raw
    if not isinstance(raw_items, list):
        raise ValueError("translation pricing index must be a list or an object with snapshots[]")
    return [_snapshot_from_payload(item) for item in raw_items if isinstance(item, dict)]


def save_pricing_snapshots(snapshots: list[PricingSnapshot], path: Path | None = None) -> None:
    index_path = path or default_pricing_index_path()
    payload = {
        "schema_version": 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "snapshots": [asdict(item) for item in sorted(snapshots, key=lambda item: (item.provider, item.model))],
    }
    write_json_index(index_path, payload)


def refresh_openrouter_pricing_snapshot(path: Path | None = None, *, ttl_hours: int = 24) -> list[PricingSnapshot]:
    request = urllib.request.Request(
        OPENROUTER_MODELS_URL,
        headers={
            "Accept": "application/json",
            "User-Agent": "Oghma-Library/translation-pricing",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=ttl_hours)
    snapshots = _openrouter_snapshots(payload, fetched_at=now.isoformat(), expires_at=expires_at.isoformat())
    _replace_provider_snapshots("openrouter", snapshots, path)
    return snapshots


def refresh_direct_pricing_snapshot(
    provider: str,
    path: Path | None = None,
    *,
    ttl_hours: int = 24,
) -> list[PricingSnapshot]:
    source_url = DIRECT_PRICING_URLS.get(provider)
    if source_url is None:
        raise ValueError(f"unsupported direct pricing provider: {provider}")
    request = urllib.request.Request(
        source_url,
        headers={
            "Accept": "text/html",
            "User-Agent": "Oghma-Library/translation-pricing",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        html = response.read().decode("utf-8")
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=ttl_hours)
    snapshots = parse_direct_pricing_html(
        provider,
        html,
        fetched_at=now.isoformat(),
        expires_at=expires_at.isoformat(),
    )
    if not snapshots:
        raise ValueError(f"official {provider} pricing page returned no recognized models")
    _replace_provider_snapshots(provider, snapshots, path)
    return snapshots


def _replace_provider_snapshots(
    provider: str,
    snapshots: list[PricingSnapshot],
    path: Path | None,
) -> None:
    index_path = path or default_pricing_index_path()

    def mutate(raw: object) -> object:
        existing = {
            (item.provider, item.model): item
            for item in _pricing_snapshots_from_raw(raw)
            if item.provider != provider
        }
        for snapshot in snapshots:
            existing[(snapshot.provider, snapshot.model)] = snapshot
        merged = sorted(existing.values(), key=lambda item: (item.provider, item.model))
        return {
            "schema_version": 1,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "snapshots": [asdict(item) for item in merged],
        }

    mutate_json_index(index_path, mutate)


def parse_direct_pricing_html(
    provider: str,
    html: str,
    *,
    fetched_at: str,
    expires_at: str,
) -> list[PricingSnapshot]:
    text = _normalized_html_text(html)
    if provider == "openai":
        return _parse_openai_pricing(text, fetched_at=fetched_at, expires_at=expires_at)
    if provider == "deepseek":
        return _parse_deepseek_pricing(text, fetched_at=fetched_at, expires_at=expires_at)
    if provider == "gemini":
        return _parse_gemini_pricing(html, fetched_at=fetched_at, expires_at=expires_at)
    raise ValueError(f"unsupported direct pricing provider: {provider}")


def pricing_for_model(
    model: str,
    path: Path | None = None,
    *,
    provider: str | None = None,
    allow_expired: bool = False,
) -> ModelPricing | None:
    snapshot = pricing_snapshot_for_model(
        model,
        path,
        provider=provider,
        allow_expired=allow_expired,
    )
    return snapshot.to_model_pricing() if snapshot else None


def pricing_snapshot_for_model(
    model: str,
    path: Path | None = None,
    *,
    provider: str | None = None,
    allow_expired: bool = False,
) -> PricingSnapshot | None:
    now = datetime.now(timezone.utc)
    aliases = _pricing_model_aliases(model)
    allowed_providers = {provider} if provider else set()
    if provider in {"openai", "gemini", "deepseek"}:
        allowed_providers.add("openrouter")
    matches = [
        snapshot
        for snapshot in load_pricing_snapshots(path)
        if snapshot.model in aliases
        and (not allowed_providers or snapshot.provider in allowed_providers)
    ]
    matches.sort(
        key=lambda item: (
            _datetime_or_min(item.expires_at) >= now,
            item.model == model,
            item.provider == provider if provider else True,
            _datetime_or_min(item.fetched_at),
        ),
        reverse=True,
    )
    for snapshot in matches:
        try:
            expires_at = datetime.fromisoformat(snapshot.expires_at)
        except ValueError:
            expires_at = now
        if allow_expired or expires_at >= now:
            return snapshot
    return None


def estimate_costs(
    usage: list[TokenUsage],
    *,
    usd_brl_rate: float | None = None,
) -> list[CostEstimate]:
    usd = estimate_usd(usage)
    estimates = [usd]
    rate = usd_brl_rate if usd_brl_rate is not None else _env_float("OGHMA_USD_BRL_RATE")
    if rate:
        estimates.append(
            CostEstimate(
                currency="BRL",
                total=round(usd.total * rate, 6),
                details={"usd_brl_rate": rate},
            )
        )
    return estimates


def estimate_usd(usage: list[TokenUsage]) -> CostEstimate:
    total = 0.0
    uncached_input_tokens = 0
    cached_input_tokens = 0
    output_tokens = 0

    for item in usage:
        pricing = pricing_for_model(item.model, provider=item.provider, allow_expired=True)
        if pricing is None:
            continue
        cached = min(item.cached_input_tokens, item.input_tokens)
        uncached = max(0, item.input_tokens - cached)
        uncached_input_tokens += uncached
        cached_input_tokens += cached
        output_tokens += item.output_tokens
        total += (uncached / 1_000_000) * pricing.input_usd_per_1m
        total += (cached / 1_000_000) * pricing.cached_input_usd_per_1m
        total += (item.output_tokens / 1_000_000) * pricing.output_usd_per_1m

    return CostEstimate(
        currency="USD",
        total=round(total, 6),
        details={
            "uncached_input_tokens": float(uncached_input_tokens),
            "cached_input_tokens": float(cached_input_tokens),
            "output_tokens": float(output_tokens),
        },
    )


def _openrouter_snapshots(payload: dict, *, fetched_at: str, expires_at: str) -> list[PricingSnapshot]:
    data = payload.get("data", [])
    if not isinstance(data, list):
        return []
    snapshots: list[PricingSnapshot] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        model = str(item.get("id", ""))
        pricing = item.get("pricing", {})
        if not model or not isinstance(pricing, dict):
            continue
        prompt = _price_per_token_to_1m(pricing.get("prompt"))
        completion = _price_per_token_to_1m(pricing.get("completion"))
        cached = _price_per_token_to_1m(pricing.get("prompt_cache_read")) or prompt
        if prompt is None or completion is None:
            continue
        snapshots.append(
            PricingSnapshot(
                provider="openrouter",
                model=model,
                input_usd_per_1m=prompt,
                cached_input_usd_per_1m=cached,
                output_usd_per_1m=completion,
                source_url=OPENROUTER_MODELS_URL,
                fetched_at=fetched_at,
                expires_at=expires_at,
            )
        )
    return snapshots


def _price_per_token_to_1m(value: object) -> float | None:
    if value is None:
        return None
    try:
        return round(float(value) * 1_000_000, 9)
    except (TypeError, ValueError):
        return None


def _snapshot_from_payload(payload: dict) -> PricingSnapshot:
    return PricingSnapshot(
        provider=str(payload.get("provider", "")),
        model=str(payload["model"]),
        input_usd_per_1m=float(payload.get("input_usd_per_1m", 0.0)),
        cached_input_usd_per_1m=float(payload.get("cached_input_usd_per_1m", 0.0)),
        output_usd_per_1m=float(payload.get("output_usd_per_1m", 0.0)),
        source_url=str(payload.get("source_url", "")),
        fetched_at=str(payload.get("fetched_at", "")),
        expires_at=str(payload.get("expires_at", "")),
    )


def _parse_openai_pricing(
    text: str,
    *,
    fetched_at: str,
    expires_at: str,
) -> list[PricingSnapshot]:
    pattern = re.compile(
        r"\b(gpt-[a-z0-9][a-z0-9._-]*)\s+\$([0-9.]+)\s+(?:\$([0-9.]+)|-)\s+\$([0-9.]+)",
        re.IGNORECASE,
    )
    snapshots: dict[str, PricingSnapshot] = {}
    for match in pattern.finditer(text):
        model, input_price, cached_price, output_price = match.groups()
        if model in snapshots:
            continue
        input_value = float(input_price)
        snapshots[model] = PricingSnapshot(
            provider="openai",
            model=model,
            input_usd_per_1m=input_value,
            cached_input_usd_per_1m=float(cached_price) if cached_price else input_value,
            output_usd_per_1m=float(output_price),
            source_url=OPENAI_PRICING_URL,
            fetched_at=fetched_at,
            expires_at=expires_at,
        )
    return list(snapshots.values())


def _parse_deepseek_pricing(
    text: str,
    *,
    fetched_at: str,
    expires_at: str,
) -> list[PricingSnapshot]:
    pattern = re.compile(
        r"\b(deepseek-(?:chat|reasoner))\b[^$]{0,160}"
        r"\$([0-9.]+)\s+\$([0-9.]+)\s+\$([0-9.]+)",
        re.IGNORECASE,
    )
    snapshots: list[PricingSnapshot] = []
    for model, cached_price, input_price, output_price in pattern.findall(text):
        snapshots.append(
            PricingSnapshot(
                provider="deepseek",
                model=model,
                input_usd_per_1m=float(input_price),
                cached_input_usd_per_1m=float(cached_price),
                output_usd_per_1m=float(output_price),
                source_url=DEEPSEEK_PRICING_URL,
                fetched_at=fetched_at,
                expires_at=expires_at,
            )
        )
    return snapshots


def _parse_gemini_pricing(
    html: str,
    *,
    fetched_at: str,
    expires_at: str,
) -> list[PricingSnapshot]:
    model_starts = list(
        re.finditer(
            r'<h2[^>]+id="(gemini-[^"]+)"[^>]*>.*?</h2>\s*'
            r'.*?<code[^>]*>(gemini-[^<]+)</code>',
            html,
            re.IGNORECASE | re.DOTALL,
        )
    )
    snapshots: list[PricingSnapshot] = []
    for index, match in enumerate(model_starts):
        model = match.group(2).strip()
        end = model_starts[index + 1].start() if index + 1 < len(model_starts) else len(html)
        block = html[match.end():end]
        table_match = re.search(
            r'<h3[^>]*>\s*Standard\s*</h3>\s*<table[^>]*>(.*?)</table>',
            block,
            re.IGNORECASE | re.DOTALL,
        )
        if table_match is None:
            continue
        prices = _gemini_standard_table_prices(table_match.group(1))
        if not {"input", "output"}.issubset(prices):
            continue
        snapshots.append(
            PricingSnapshot(
                provider="gemini",
                model=model,
                input_usd_per_1m=prices["input"],
                cached_input_usd_per_1m=prices.get("cached", prices["input"]),
                output_usd_per_1m=prices["output"],
                source_url=GEMINI_PRICING_URL,
                fetched_at=fetched_at,
                expires_at=expires_at,
            )
        )
    return snapshots


def _gemini_standard_table_prices(table_html: str) -> dict[str, float]:
    prices: dict[str, float] = {}
    for row_html in re.findall(r"<tr[^>]*>(.*?)</tr>", table_html, re.IGNORECASE | re.DOTALL):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row_html, re.IGNORECASE | re.DOTALL)
        if len(cells) < 2:
            continue
        label = _normalized_html_text(cells[0]).lower()
        paid_value = _normalized_html_text(cells[-1])
        price_match = re.search(r"\$([0-9.]+)", paid_value)
        if price_match is None:
            continue
        value = float(price_match.group(1))
        if label.startswith("input price"):
            prices["input"] = value
        elif label.startswith("output price"):
            prices["output"] = value
        elif label.startswith("context caching price"):
            prices["cached"] = value
    return prices


class _PricingTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.parts.append(data.strip())

    def handle_endtag(self, tag: str) -> None:
        if tag in {"td", "th", "tr", "p", "h1", "h2", "h3", "li", "div"}:
            self.parts.append(" ")


def _normalized_html_text(html: str) -> str:
    parser = _PricingTextExtractor()
    parser.feed(html)
    return re.sub(r"\s+", " ", " ".join(parser.parts))


def _env_float(name: str) -> float | None:
    raw = os.getenv(name)
    if not raw:
        return None
    try:
        return float(raw.replace(",", "."))
    except ValueError:
        return None


def _datetime_or_min(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _pricing_model_aliases(model: str) -> set[str]:
    aliases = {model}
    if "/" not in model:
        if model.startswith("gpt-"):
            aliases.add(f"openai/{model}")
        elif model.startswith("gemini-"):
            aliases.add(f"google/{model}")
        elif model.startswith("deepseek-"):
            aliases.add(f"deepseek/{model}")
    return aliases
