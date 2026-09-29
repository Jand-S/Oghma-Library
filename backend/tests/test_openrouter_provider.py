import pytest

from oghma.translation import GlossaryTerm, TranslationContext, TranslationSegment, TranslatedSegment
from oghma.translation.providers.openrouter_provider import OpenRouterProvider


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
async def test_openrouter_provider_builds_chat_completion_payload_for_translation():
    client = FakeClient(
        {
            "choices": [
                {
                    "message": {
                        "content": (
                            '{"segments":[{"key":"p0001","translated_html":"<p>Estabelecimento de Fundacao.</p>",'
                            '"notes":[]}]}'
                        )
                    }
                }
            ],
            "usage": {"prompt_tokens": 100, "completion_tokens": 40, "total_tokens": 140},
        }
    )
    provider = OpenRouterProvider(
        api_key="test-key",
        model="deepseek/deepseek-v4-flash",
        client=client,
        referer="https://example.test",
    )
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
    assert request["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert request["headers"]["Authorization"] == "Bearer test-key"
    assert request["headers"]["HTTP-Referer"] == "https://example.test"
    assert request["headers"]["X-OpenRouter-Title"] == "Oghma Library"
    assert request["json"]["model"] == "deepseek/deepseek-v4-flash"
    assert request["json"]["provider"] == {"require_parameters": True}
    assert request["json"]["response_format"]["type"] == "json_schema"
    assert request["json"]["response_format"]["json_schema"]["strict"] is True
    assert "Foundation Establishment" in request["json"]["messages"][1]["content"]
    assert result == [
        TranslatedSegment(
            key="p0001",
            translated_html="<p>Estabelecimento de Fundacao.</p>",
            notes=[],
        )
    ]
    usage = provider.drain_usage_events()
    assert usage[0].provider == "openrouter"
    assert usage[0].model == "deepseek/deepseek-v4-flash"
    assert usage[0].input_tokens == 100


@pytest.mark.asyncio
async def test_openrouter_provider_supports_generic_structured_requests():
    client = FakeClient({"choices": [{"message": {"content": '{"winner":"A"}'}}]})
    provider = OpenRouterProvider(
        api_key="test-key",
        model="google/gemini-3-flash-preview",
        client=client,
    )
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
    assert client.requests[0]["json"]["response_format"]["json_schema"]["name"] == "grade"
