"""OpenAI Responses API provider for the translation pipeline."""
from __future__ import annotations

import json
import os
import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from time import perf_counter
from typing import Any, Protocol

from ..contracts import (
    GlossaryTerm,
    ProviderCall,
    TokenUsage,
    TranslationContext,
    TranslationIssue,
    TranslationSegment,
    TranslatedSegment,
)

_RESPONSES_URL = "https://api.openai.com/v1/responses"


class OpenAIProviderError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class _ResponseLike(Protocol):
    def raise_for_status(self) -> None:
        ...

    def json(self) -> dict[str, Any]:
        ...


class _AsyncClientLike(Protocol):
    async def post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        json: dict[str, Any],
        timeout: float,
    ) -> _ResponseLike:
        ...


@dataclass(frozen=True)
class OpenAIProvider:
    api_key: str
    model: str = "gpt-5.5"
    repair_model: str | None = None
    reasoning_effort: str = "medium"
    timeout_seconds: float = 120.0
    max_retries: int = 2
    retry_base_seconds: float = 0.5
    client: _AsyncClientLike | None = None

    id: str = field(default="openai", init=False)
    _usage_events: list[TokenUsage] = field(default_factory=list, init=False, repr=False)
    _call_events: list[ProviderCall] = field(default_factory=list, init=False, repr=False)

    @classmethod
    def from_env(
        cls,
        *,
        model: str | None = None,
        repair_model: str | None = None,
        reasoning_effort: str | None = None,
        timeout_seconds: float = 120.0,
        max_retries: int | None = None,
    ) -> "OpenAIProvider":
        env = _load_provider_env()
        api_key = env.get("OGHMA_OPENAI_API_KEY") or env.get("OPENAI_API_KEY")
        if not api_key:
            raise OpenAIProviderError("Missing OGHMA_OPENAI_API_KEY or OPENAI_API_KEY")
        return cls(
            api_key=api_key,
            model=model or env.get("OGHMA_TRANSLATION_MODEL", "gpt-5.5"),
            repair_model=repair_model or env.get("OGHMA_TRANSLATION_REPAIR_MODEL"),
            reasoning_effort=reasoning_effort or env.get("OGHMA_TRANSLATION_REASONING", "medium"),
            timeout_seconds=timeout_seconds,
            max_retries=max_retries if max_retries is not None else int(env.get("OGHMA_TRANSLATION_REQUEST_RETRIES", "2")),
        )

    async def translate_segments(
        self,
        segments: list[TranslationSegment],
        context: TranslationContext,
    ) -> list[TranslatedSegment]:
        payload = self._payload(
            model=self.model,
            instructions=_translator_instructions(context),
            user_payload={
                "task": "translate_segments",
                "segments": [_segment_payload(segment) for segment in segments],
                "context": _context_payload(context),
            },
        )
        data = await self._post(payload, model=self.model, operation="translate")
        self._record_usage(data, model=self.model, operation="translate")
        return _parse_segments_response(data)

    async def repair_segments(
        self,
        source_segments: list[TranslationSegment],
        translated_segments: list[TranslatedSegment],
        issues: list[TranslationIssue],
        context: TranslationContext,
    ) -> list[TranslatedSegment]:
        issue_keys = {issue.segment_key for issue in issues}
        payload = self._payload(
            model=self.repair_model or self.model,
            instructions=_repair_instructions(context),
            user_payload={
                "task": "repair_segments",
                "segments": [
                    _repair_segment_payload(source, translated_segments, issues)
                    for source in source_segments
                    if source.key in issue_keys
                ],
                "context": _context_payload(context),
            },
        )
        data = await self._post(
            payload,
            model=self.repair_model or self.model,
            operation="repair",
        )
        self._record_usage(data, model=self.repair_model or self.model, operation="repair")
        repaired = {segment.key: segment for segment in _parse_segments_response(data)}
        return [repaired.get(segment.key, segment) for segment in translated_segments]

    def drain_usage_events(self) -> list[TokenUsage]:
        events = list(self._usage_events)
        self._usage_events.clear()
        return events

    def drain_call_events(self) -> list[ProviderCall]:
        events = list(self._call_events)
        self._call_events.clear()
        return events

    async def request_structured(
        self,
        *,
        operation: str,
        instructions: str,
        input_payload: dict[str, Any],
        response_format: dict[str, Any],
        model: str | None = None,
    ) -> dict[str, Any]:
        request_model = model or self.model
        payload: dict[str, Any] = {
            "model": request_model,
            "instructions": instructions,
            "input": json.dumps(input_payload, ensure_ascii=False),
            "text": {"format": response_format},
            "store": False,
        }
        if _supports_reasoning(request_model):
            payload["reasoning"] = {"effort": self.reasoning_effort}
        data = await self._post(payload, model=request_model, operation=operation)
        self._record_usage(data, model=request_model, operation=operation)
        try:
            parsed = json.loads(_response_text(data))
        except json.JSONDecodeError as exc:
            raise OpenAIProviderError("OpenAI structured response did not contain valid JSON") from exc
        if not isinstance(parsed, dict):
            raise OpenAIProviderError("OpenAI structured response must be a JSON object")
        return parsed

    def _payload(self, *, model: str, instructions: str, user_payload: dict[str, Any]) -> dict[str, Any]:
        payload = {
            "model": model,
            "instructions": instructions,
            "input": json.dumps(user_payload, ensure_ascii=False),
            "text": {"format": _translation_response_format()},
            "store": False,
        }
        if _supports_reasoning(model):
            payload["reasoning"] = {"effort": self.reasoning_effort}
        return payload

    async def _post(self, payload: dict[str, Any], *, model: str, operation: str) -> dict[str, Any]:
        for attempt in range(1, self.max_retries + 2):
            started_at = perf_counter()
            try:
                data = await self._post_once(payload)
            except Exception as exc:
                status_code = _status_code(exc)
                self._call_events.append(
                    ProviderCall(
                        provider=self.id,
                        model=model,
                        operation=operation,
                        attempt=attempt,
                        duration_seconds=perf_counter() - started_at,
                        status="failed",
                        http_status=status_code,
                        error_type=type(exc).__name__,
                    )
                )
                if attempt > self.max_retries or not _is_retryable_status(status_code):
                    raise
                await asyncio.sleep(self.retry_base_seconds * (2 ** (attempt - 1)))
                continue

            self._call_events.append(
                ProviderCall(
                    provider=self.id,
                    model=model,
                    operation=operation,
                    attempt=attempt,
                    duration_seconds=perf_counter() - started_at,
                    status="succeeded",
                )
            )
            return data
        raise AssertionError("request retry loop exited unexpectedly")

    async def _post_once(self, payload: dict[str, Any]) -> dict[str, Any]:
        client = self.client
        close_client = False
        if client is None:
            try:
                import httpx
            except ModuleNotFoundError as exc:
                return await asyncio.to_thread(self._post_with_urllib, payload)
            client = httpx.AsyncClient()
            close_client = True

        try:
            response = await client.post(
                _RESPONSES_URL,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            return response.json()
        finally:
            if close_client:
                await client.aclose()  # type: ignore[attr-defined]

    def _record_usage(self, data: dict[str, Any], *, model: str, operation: str) -> None:
        usage = _parse_usage(data, provider=self.id, model=model, operation=operation)
        if usage is not None:
            self._usage_events.append(usage)

    def _post_with_urllib(self, payload: dict[str, Any]) -> dict[str, Any]:
        import urllib.error
        import urllib.request

        data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            _RESPONSES_URL,
            data=data,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise OpenAIProviderError(
                f"OpenAI request failed with HTTP {exc.code}: {body}",
                status_code=exc.code,
            ) from exc


def _translator_instructions(context: TranslationContext) -> str:
    return "\n".join(
        [
            "You are a literary translator for long-form web novels.",
            f"Translate from {context.source_language} to {context.target_language}.",
            "Preserve every segment key exactly.",
            "Return only JSON matching the requested schema.",
            "Preserve the semantic HTML structure in each translated_html field.",
            "Allowed tags are p, blockquote, em, strong, img, and hr.",
            "Do not translate image attributes.",
            "Use locked and approved glossary terms exactly.",
            "Write natural Brazilian Portuguese, preserving meaning and tone.",
            "Do not invent missing Chinese source context; record uncertainty in notes.",
            f"Style guide: {context.style_guide or 'No additional style guide.'}",
        ]
    )


def _load_provider_env() -> dict[str, str]:
    env = dict(os.environ)
    for path in _dotenv_candidates():
        env.update(_read_dotenv(path))
    return env


def _dotenv_candidates() -> list[Path]:
    backend_root = Path(__file__).resolve().parents[4]
    return [
        backend_root / ".env",
        Path.cwd() / ".env",
        Path.cwd() / "backend" / ".env",
    ]


def _read_dotenv(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}

    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def _repair_instructions(context: TranslationContext) -> str:
    return "\n".join(
        [
            "You are repairing specific segments from a literary translation.",
            f"Target language: {context.target_language}.",
            "Fix only the reported issues.",
            "Preserve segment keys and semantic HTML structure exactly.",
            "Use locked and approved glossary terms exactly.",
            "Return only repaired segments as JSON matching the requested schema.",
            f"Style guide: {context.style_guide or 'No additional style guide.'}",
        ]
    )


def _context_payload(context: TranslationContext) -> dict[str, Any]:
    return {
        "source_language": context.source_language,
        "target_language": context.target_language,
        "style_guide": context.style_guide,
        "glossary_terms": [_glossary_payload(term) for term in context.glossary_terms if term.is_enforced],
    }


def _glossary_payload(term: GlossaryTerm) -> dict[str, str]:
    return {
        "source": term.source,
        "target": term.target,
        "status": term.status,
        "category": term.category,
        "notes": term.notes,
    }


def _segment_payload(segment: TranslationSegment) -> dict[str, str]:
    return {
        "key": segment.key,
        "kind": segment.kind,
        "source_html": segment.source_html,
        "source_text": segment.source_text,
    }


def _repair_segment_payload(
    source: TranslationSegment,
    translated_segments: list[TranslatedSegment],
    issues: list[TranslationIssue],
) -> dict[str, Any]:
    translated_by_key = {segment.key: segment for segment in translated_segments}
    translated = translated_by_key.get(source.key)
    return {
        **_segment_payload(source),
        "current_translated_html": translated.translated_html if translated else "",
        "issues": [
            {
                "severity": issue.severity,
                "issue_type": issue.issue_type,
                "message": issue.message,
                "expected": issue.expected,
                "actual": issue.actual,
            }
            for issue in issues
            if issue.segment_key == source.key
        ],
    }


def _translation_response_format() -> dict[str, Any]:
    return {
        "type": "json_schema",
        "name": "translated_segments",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "segments": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "key": {"type": "string"},
                            "translated_html": {"type": "string"},
                            "notes": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                        },
                        "required": ["key", "translated_html", "notes"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["segments"],
            "additionalProperties": False,
        },
    }


def _parse_segments_response(data: dict[str, Any]) -> list[TranslatedSegment]:
    text = _response_text(data)
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise OpenAIProviderError("OpenAI response did not contain valid JSON") from exc

    raw_segments = payload.get("segments")
    if not isinstance(raw_segments, list):
        raise OpenAIProviderError("OpenAI response JSON is missing segments[]")

    segments: list[TranslatedSegment] = []
    for raw in raw_segments:
        if not isinstance(raw, dict):
            raise OpenAIProviderError("OpenAI response segment is not an object")
        key = raw.get("key")
        translated_html = raw.get("translated_html")
        notes = raw.get("notes", [])
        if not isinstance(key, str) or not isinstance(translated_html, str):
            raise OpenAIProviderError("OpenAI response segment has invalid key or translated_html")
        if not isinstance(notes, list) or not all(isinstance(note, str) for note in notes):
            raise OpenAIProviderError("OpenAI response segment has invalid notes")
        segments.append(TranslatedSegment(key=key, translated_html=translated_html, notes=notes))
    return segments


def _parse_usage(
    data: dict[str, Any],
    *,
    provider: str,
    model: str,
    operation: str,
) -> TokenUsage | None:
    raw = data.get("usage")
    if not isinstance(raw, dict):
        return None
    input_tokens = _int_value(raw, "input_tokens", "prompt_tokens")
    output_tokens = _int_value(raw, "output_tokens", "completion_tokens")
    total_tokens = _int_value(raw, "total_tokens")
    cached_input_tokens = 0
    input_details = raw.get("input_tokens_details") or raw.get("prompt_tokens_details")
    if isinstance(input_details, dict):
        cached_input_tokens = _int_value(input_details, "cached_tokens", "cached_input_tokens")
    reasoning_tokens = 0
    output_details = raw.get("output_tokens_details") or raw.get("completion_tokens_details")
    if isinstance(output_details, dict):
        reasoning_tokens = _int_value(output_details, "reasoning_tokens")
    return TokenUsage(
        provider=provider,
        model=model,
        operation=operation,
        input_tokens=input_tokens,
        cached_input_tokens=cached_input_tokens,
        output_tokens=output_tokens,
        reasoning_tokens=reasoning_tokens,
        total_tokens=total_tokens or input_tokens + output_tokens,
    )


def _status_code(exc: Exception) -> int | None:
    direct = getattr(exc, "status_code", None)
    if isinstance(direct, int):
        return direct
    response = getattr(exc, "response", None)
    response_status = getattr(response, "status_code", None)
    return response_status if isinstance(response_status, int) else None


def _is_retryable_status(status_code: int | None) -> bool:
    return status_code is None or status_code in {408, 409, 429} or status_code >= 500


def _supports_reasoning(model: str) -> bool:
    return model.startswith(("gpt-5", "o1", "o3", "o4"))


def _int_value(data: dict[str, Any], *keys: str) -> int:
    for key in keys:
        value = data.get(key)
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
    return 0


def _response_text(data: dict[str, Any]) -> str:
    output_text = data.get("output_text")
    if isinstance(output_text, str):
        return output_text

    parts: list[str] = []
    for item in data.get("output", []):
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []):
            if not isinstance(content, dict):
                continue
            if content.get("type") in {"output_text", "text"} and isinstance(content.get("text"), str):
                parts.append(content["text"])
    if parts:
        return "".join(parts)
    raise OpenAIProviderError("OpenAI response did not contain output text")
