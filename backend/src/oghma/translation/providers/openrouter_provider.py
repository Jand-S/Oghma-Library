"""OpenRouter Chat Completions provider for the translation pipeline."""
from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from time import perf_counter
from typing import Any

from ..contracts import (
    ProviderCall,
    TokenUsage,
    TranslationContext,
    TranslationIssue,
    TranslationSegment,
    TranslatedSegment,
)
from .openai_provider import (
    OpenAIProviderError,
    _context_payload,
    _is_retryable_status,
    _load_provider_env,
    _parse_segments_response,
    _parse_usage,
    _repair_instructions,
    _repair_segment_payload,
    _response_text,
    _status_code,
    _translation_response_format,
    _translator_instructions,
)

_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions"


@dataclass(frozen=True)
class OpenRouterProvider:
    api_key: str
    model: str
    repair_model: str | None = None
    reasoning_effort: str = "medium"
    timeout_seconds: float = 120.0
    max_retries: int = 2
    retry_base_seconds: float = 0.5
    referer: str | None = None
    app_title: str = "Oghma Library"
    client: Any | None = None

    id: str = field(default="openrouter", init=False)
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
    ) -> "OpenRouterProvider":
        env = _load_provider_env()
        api_key = env.get("OGHMA_OPENROUTER_API_KEY") or env.get("OPENROUTER_API_KEY")
        if not api_key:
            raise OpenAIProviderError("Missing OGHMA_OPENROUTER_API_KEY or OPENROUTER_API_KEY")
        return cls(
            api_key=api_key,
            model=model or env.get("OGHMA_TRANSLATION_MODEL", "deepseek/deepseek-v4-flash"),
            repair_model=repair_model or env.get("OGHMA_TRANSLATION_REPAIR_MODEL"),
            reasoning_effort=reasoning_effort or env.get("OGHMA_TRANSLATION_REASONING", "medium"),
            timeout_seconds=timeout_seconds,
            max_retries=max_retries if max_retries is not None else int(env.get("OGHMA_TRANSLATION_REQUEST_RETRIES", "2")),
            referer=env.get("OGHMA_OPENROUTER_REFERER"),
            app_title=env.get("OGHMA_OPENROUTER_TITLE", "Oghma Library"),
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
                "segments": [
                    {
                        "key": segment.key,
                        "kind": segment.kind,
                        "source_html": segment.source_html,
                        "source_text": segment.source_text,
                    }
                    for segment in segments
                ],
                "context": _context_payload(context),
            },
        )
        data = await self._post(payload, model=self.model, operation="translate")
        self._record_usage(data, model=self.model, operation="translate")
        return _parse_segments_response(_as_responses_shape(data))

    async def repair_segments(
        self,
        source_segments: list[TranslationSegment],
        translated_segments: list[TranslatedSegment],
        issues: list[TranslationIssue],
        context: TranslationContext,
    ) -> list[TranslatedSegment]:
        issue_keys = {issue.segment_key for issue in issues}
        request_model = self.repair_model or self.model
        payload = self._payload(
            model=request_model,
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
        data = await self._post(payload, model=request_model, operation="repair")
        self._record_usage(data, model=request_model, operation="repair")
        repaired = {segment.key: segment for segment in _parse_segments_response(_as_responses_shape(data))}
        return [repaired.get(segment.key, segment) for segment in translated_segments]

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
        payload = self._payload(
            model=request_model,
            instructions=instructions,
            user_payload=input_payload,
            response_format=response_format,
        )
        data = await self._post(payload, model=request_model, operation=operation)
        self._record_usage(data, model=request_model, operation=operation)
        try:
            parsed = json.loads(_response_text(_as_responses_shape(data)))
        except json.JSONDecodeError as exc:
            raise OpenAIProviderError("OpenRouter structured response did not contain valid JSON") from exc
        if not isinstance(parsed, dict):
            raise OpenAIProviderError("OpenRouter structured response must be a JSON object")
        return parsed

    def drain_usage_events(self) -> list[TokenUsage]:
        events = list(self._usage_events)
        self._usage_events.clear()
        return events

    def drain_call_events(self) -> list[ProviderCall]:
        events = list(self._call_events)
        self._call_events.clear()
        return events

    def _payload(
        self,
        *,
        model: str,
        instructions: str,
        user_payload: dict[str, Any],
        response_format: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "model": model,
            "messages": [
                {"role": "system", "content": instructions},
                {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
            ],
            "response_format": _openrouter_response_format(response_format or _translation_response_format()),
            "provider": {"require_parameters": True},
        }

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
            except ModuleNotFoundError:
                return await asyncio.to_thread(self._post_with_urllib, payload)
            client = httpx.AsyncClient()
            close_client = True

        try:
            response = await client.post(
                _CHAT_COMPLETIONS_URL,
                headers=self._headers(),
                json=payload,
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            return response.json()
        finally:
            if close_client:
                await client.aclose()  # type: ignore[attr-defined]

    def _post_with_urllib(self, payload: dict[str, Any]) -> dict[str, Any]:
        import urllib.error
        import urllib.request

        data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            _CHAT_COMPLETIONS_URL,
            data=data,
            headers=self._headers(),
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise OpenAIProviderError(
                f"OpenRouter request failed with HTTP {exc.code}: {body}",
                status_code=exc.code,
            ) from exc

    def _headers(self) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "X-OpenRouter-Title": self.app_title,
        }
        if self.referer:
            headers["HTTP-Referer"] = self.referer
        return headers

    def _record_usage(self, data: dict[str, Any], *, model: str, operation: str) -> None:
        usage = _parse_usage(data, provider=self.id, model=model, operation=operation)
        if usage is not None:
            self._usage_events.append(usage)


def _openrouter_response_format(format_payload: dict[str, Any]) -> dict[str, Any]:
    if format_payload.get("type") != "json_schema":
        return format_payload
    return {
        "type": "json_schema",
        "json_schema": {
            "name": format_payload["name"],
            "strict": format_payload.get("strict", True),
            "schema": format_payload["schema"],
        },
    }


def _as_responses_shape(data: dict[str, Any]) -> dict[str, Any]:
    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            message = first.get("message")
            if isinstance(message, dict) and isinstance(message.get("content"), str):
                return {"output_text": message["content"], "usage": data.get("usage", {})}
    return data
