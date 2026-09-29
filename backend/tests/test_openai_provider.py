import pytest

from oghma.translation import GlossaryTerm, TranslationContext, TranslationIssue, TranslationSegment, TranslatedSegment
from oghma.translation.pricing import estimate_costs
from oghma.translation.providers.openai_provider import (
    OpenAIProvider,
    OpenAIProviderError,
    _parse_usage,
    _read_dotenv,
)


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class FakeClient:
    def __init__(self, payload):
        self.payload = payload
        self.requests = []

    async def post(self, url, *, headers, json, timeout):
        self.requests.append(
            {
                "url": url,
                "headers": headers,
                "json": json,
                "timeout": timeout,
            }
        )
        return FakeResponse(self.payload)


@pytest.mark.asyncio
async def test_openai_provider_builds_responses_payload_for_translation():
    client = FakeClient(
        {
            "output_text": (
                '{"segments":[{"key":"p0001","translated_html":"<p>Estabelecimento de Fundacao.</p>",'
                '"notes":[]}]}'
            )
        }
    )
    provider = OpenAIProvider(api_key="test-key", model="gpt-5-test", client=client)
    context = TranslationContext(
        glossary_terms=[
            GlossaryTerm(source="Foundation Establishment", target="Estabelecimento de Fundacao")
        ]
    )
    source = [
        TranslationSegment(
            key="p0001",
            kind="p",
            source_html="<p>Foundation Establishment.</p>",
            source_text="Foundation Establishment.",
            source_hash="hash",
        )
    ]

    result = await provider.translate_segments(source, context)

    request = client.requests[0]
    assert request["url"] == "https://api.openai.com/v1/responses"
    assert request["headers"]["Authorization"] == "Bearer test-key"
    assert request["json"]["model"] == "gpt-5-test"
    assert request["json"]["reasoning"] == {"effort": "medium"}
    assert request["json"]["store"] is False
    assert request["json"]["text"]["format"]["type"] == "json_schema"
    assert request["json"]["text"]["format"]["strict"] is True
    assert "Foundation Establishment" in request["json"]["input"]
    assert result == [
        TranslatedSegment(
            key="p0001",
            translated_html="<p>Estabelecimento de Fundacao.</p>",
            notes=[],
        )
    ]


@pytest.mark.asyncio
async def test_openai_provider_omits_reasoning_for_non_reasoning_model():
    client = FakeClient({"output_text": '{"segments":[]}'})
    provider = OpenAIProvider(api_key="test-key", model="gpt-4.1-mini", client=client)

    await provider.translate_segments([], TranslationContext())

    assert "reasoning" not in client.requests[0]["json"]


@pytest.mark.asyncio
async def test_openai_provider_supports_generic_structured_requests():
    client = FakeClient({"output_text": '{"winner":"A"}'})
    provider = OpenAIProvider(api_key="test-key", model="gpt-5-test", client=client)
    response_format = {
        "type": "json_schema",
        "name": "grade",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {"winner": {"type": "string"}},
            "required": ["winner"],
            "additionalProperties": False,
        },
    }

    result = await provider.request_structured(
        operation="editorial_grade",
        instructions="Compare both translations.",
        input_payload={"translation_a": "A", "translation_b": "B"},
        response_format=response_format,
    )

    assert result == {"winner": "A"}
    assert client.requests[0]["json"]["text"]["format"]["name"] == "grade"


@pytest.mark.asyncio
async def test_openai_provider_repairs_only_issued_segments_and_merges_results():
    client = FakeClient(
        {
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": (
                                '{"segments":[{"key":"p0002","translated_html":"<p>Corrigido.</p>",'
                                '"notes":["fixed"]}]}'
                            ),
                        }
                    ],
                }
            ]
        }
    )
    provider = OpenAIProvider(api_key="test-key", model="gpt-test", repair_model="gpt-repair", client=client)
    source = [
        TranslationSegment("p0001", "p", "<p>Fine.</p>", "Fine.", "hash1"),
        TranslationSegment("p0002", "p", "<p>Foundation Establishment.</p>", "Foundation Establishment.", "hash2"),
    ]
    current = [
        TranslatedSegment("p0001", "<p>Ok.</p>"),
        TranslatedSegment("p0002", "<p>Foundation Establishment.</p>"),
    ]
    issues = [
        TranslationIssue(
            segment_key="p0002",
            severity="high",
            issue_type="glossary_mismatch",
            message="Use locked term.",
            expected="Estabelecimento de Fundacao",
        )
    ]

    result = await provider.repair_segments(source, current, issues, TranslationContext())

    assert client.requests[0]["json"]["model"] == "gpt-repair"
    assert "p0001" not in client.requests[0]["json"]["input"]
    assert "p0002" in client.requests[0]["json"]["input"]
    assert result == [
        TranslatedSegment("p0001", "<p>Ok.</p>"),
        TranslatedSegment("p0002", "<p>Corrigido.</p>", ["fixed"]),
    ]


@pytest.mark.asyncio
async def test_openai_provider_rejects_invalid_json_response():
    client = FakeClient({"output_text": "not json"})
    provider = OpenAIProvider(api_key="test-key", client=client)

    with pytest.raises(OpenAIProviderError):
        await provider.translate_segments([], TranslationContext())


def test_read_dotenv_supports_provider_settings(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "# local secrets",
                "OGHMA_OPENAI_API_KEY='test-key'",
                'OGHMA_TRANSLATION_MODEL="gpt-test"',
                "OGHMA_TRANSLATION_REASONING=high",
            ]
        ),
        encoding="utf-8",
    )

    values = _read_dotenv(env_file)

    assert values["OGHMA_OPENAI_API_KEY"] == "test-key"
    assert values["OGHMA_TRANSLATION_MODEL"] == "gpt-test"
    assert values["OGHMA_TRANSLATION_REASONING"] == "high"


def test_parse_usage_and_estimate_costs(fresh_pricing_catalog):
    usage = _parse_usage(
        {
            "usage": {
                "input_tokens": 1000,
                "output_tokens": 500,
                "total_tokens": 1500,
                "input_tokens_details": {"cached_tokens": 200},
                "output_tokens_details": {"reasoning_tokens": 125},
            }
        },
        provider="openai",
        model="gpt-5.5",
        operation="translate",
    )

    assert usage is not None
    assert usage.input_tokens == 1000
    assert usage.cached_input_tokens == 200
    assert usage.output_tokens == 500
    assert usage.reasoning_tokens == 125

    costs = estimate_costs([usage], usd_brl_rate=5.0)

    assert costs[0].currency == "USD"
    assert costs[0].total == 0.0191
    assert costs[1].currency == "BRL"
    assert costs[1].total == 0.0955


class RetryableError(RuntimeError):
    def __init__(self, status_code):
        self.status_code = status_code


class RetryClient:
    def __init__(self, payload):
        self.payload = payload
        self.calls = 0

    async def post(self, url, *, headers, json, timeout):
        self.calls += 1
        if self.calls == 1:
            raise RetryableError(429)
        return FakeResponse(self.payload)


@pytest.mark.asyncio
async def test_openai_provider_records_retry_attempts():
    client = RetryClient({"output_text": '{"segments":[]}'})
    provider = OpenAIProvider(
        api_key="test-key",
        model="gpt-test",
        client=client,
        max_retries=1,
        retry_base_seconds=0,
    )

    await provider.translate_segments([], TranslationContext())

    events = provider.drain_call_events()
    assert [(event.attempt, event.status, event.http_status) for event in events] == [
        (1, "failed", 429),
        (2, "succeeded", None),
    ]
