import json

from oghma.translation.coverage import (
    SourceChapterRef,
    TranslationChapterRecord,
    build_coverage,
    load_coverage_records,
    save_coverage_records,
    upsert_coverage_record,
)


def test_translation_coverage_groups_reusable_ranges_and_freshness():
    source = [
        SourceChapterRef("c1", 1, content_hash="h1"),
        SourceChapterRef("c2", 2, content_hash="h2"),
        SourceChapterRef("c3", 3, content_hash="h3"),
        SourceChapterRef("c4", 4, content_hash="h4"),
        SourceChapterRef("c5", 5, content_hash=None),
    ]
    records = [
        TranslationChapterRecord("novel", 1, source_hash="h1"),
        TranslationChapterRecord("novel", 2, source_hash="h2"),
        TranslationChapterRecord("novel", 4, source_hash="old"),
        TranslationChapterRecord("novel", 5, source_hash=None),
        TranslationChapterRecord("other", 3, source_hash="h3"),
    ]

    coverage = build_coverage(source, records, novel_id="novel")

    assert coverage.selected_count == 5
    assert coverage.translated_count == 4
    assert coverage.missing_count == 1
    assert coverage.stale_count == 1
    assert coverage.unknown_count == 1
    assert coverage.coverage_percent == 80
    assert [(item.start, item.end, item.count) for item in coverage.ranges] == [(1, 2, 2)]
    assert [(item.start, item.end, item.count, item.freshness) for item in coverage.stale_ranges] == [
        (4, 4, 1, "stale")
    ]
    assert [(item.start, item.end, item.count, item.freshness) for item in coverage.unknown_ranges] == [
        (5, 5, 1, "unknown")
    ]


def test_translation_coverage_ignores_non_reusable_records():
    source = [SourceChapterRef("c1", 1, content_hash="h1")]
    records = [
        TranslationChapterRecord("novel", 1, source_hash="h1", status="failed"),
        TranslationChapterRecord("novel", 1, source_hash="h1", public_reusable=False),
    ]

    coverage = build_coverage(source, records, novel_id="novel")

    assert coverage.translated_count == 0
    assert coverage.missing_count == 1


def test_translation_coverage_estimates_savings_for_fresh_and_unknown_sources(fresh_pricing_catalog):
    source = [
        SourceChapterRef("c1", 1, content_hash="h1"),
        SourceChapterRef("c2", 2, content_hash=None),
        SourceChapterRef("c3", 3, content_hash="h3"),
    ]
    records = [
        TranslationChapterRecord("novel", 1, source_hash="h1"),
        TranslationChapterRecord("novel", 2, source_hash=None),
        TranslationChapterRecord("novel", 3, source_hash="old"),
    ]

    coverage = build_coverage(
        source,
        records,
        novel_id="novel",
        usd_brl_rate=5.5,
        source_html_by_number={
            1: "<p>" + ("Gu Master " * 200) + "</p>",
            2: "<p>" + ("primeval essence " * 200) + "</p>",
            3: "<p>" + ("stale source " * 200) + "</p>",
        },
    )

    assert coverage.estimated_savings_usd > 0
    assert coverage.estimated_savings_brl == round(coverage.estimated_savings_usd * 5.5, 6)


def test_load_coverage_records_supports_object_index(tmp_path):
    path = tmp_path / "coverage-index.json"
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "chapters": [
                    {
                        "novel_id": "novel",
                        "chapter_number": 7,
                        "target_language": "pt-BR",
                        "source_hash": "abc",
                        "model": "google/gemini-3-flash-preview",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    records = load_coverage_records(path)

    assert len(records) == 1
    assert records[0].novel_id == "novel"
    assert records[0].chapter_number == 7
    assert records[0].model == "google/gemini-3-flash-preview"


def test_save_coverage_records_writes_object_index(tmp_path):
    path = tmp_path / "coverage-index.json"

    save_coverage_records(
        [
            TranslationChapterRecord("novel-b", 2, source_hash="b"),
            TranslationChapterRecord("novel-a", 1, source_hash="a"),
        ],
        path,
    )

    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["schema_version"] == 1
    assert payload["updated_at"]
    assert [item["novel_id"] for item in payload["chapters"]] == ["novel-a", "novel-b"]


def test_upsert_coverage_record_replaces_same_novel_language_and_chapter(tmp_path):
    path = tmp_path / "coverage-index.json"
    save_coverage_records(
        [
            TranslationChapterRecord("novel", 1, source_hash="old", translated_path="old.html"),
            TranslationChapterRecord("novel", 2, source_hash="keep", translated_path="keep.html"),
        ],
        path,
    )

    upsert_coverage_record(
        TranslationChapterRecord("novel", 1, source_hash="new", translated_path="new.html"),
        path,
    )

    records = load_coverage_records(path)
    assert len(records) == 2
    by_number = {record.chapter_number: record for record in records}
    assert by_number[1].source_hash == "new"
    assert by_number[1].translated_path == "new.html"
    assert by_number[1].updated_at
    assert by_number[2].source_hash == "keep"
