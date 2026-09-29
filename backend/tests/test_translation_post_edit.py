from oghma.translation.coverage import TranslationChapterRecord, load_coverage_records, save_coverage_records
from oghma.translation.post_edit import ReplacementTerm, apply_replacements_to_coverage, apply_safe_replacements


def test_apply_safe_replacements_changes_text_only():
    html = '<p title="Mestre Gu">Mestre Gu viu outro Mestre Gu.</p><img alt="Mestre Gu">'

    updated = apply_safe_replacements(
        html,
        [ReplacementTerm(source="Mestre Gu", target="Cultivador Gu")],
    )

    assert 'title="Mestre Gu"' in updated
    assert 'alt="Mestre Gu"' in updated
    assert "Cultivador Gu viu outro Cultivador Gu" in updated


def test_apply_safe_replacements_uses_word_boundaries():
    html = "<p>Dao and Daoshi are different.</p>"

    updated = apply_safe_replacements(
        html,
        [ReplacementTerm(source="Dao", target="Tao")],
    )

    assert "Tao and Daoshi" in updated


def test_apply_replacements_to_coverage_updates_translated_files_and_hash(tmp_path):
    output = tmp_path / "chapter-1.html"
    output.write_text("<p>Mestre Gu caminhou.</p>", encoding="utf-8")
    coverage = tmp_path / "coverage.json"
    save_coverage_records(
        [
            TranslationChapterRecord(
                novel_id="novel",
                chapter_number=1,
                target_language="pt-BR",
                translated_path=str(output),
                translated_hash="old",
            )
        ],
        coverage,
    )

    result = apply_replacements_to_coverage(
        novel_id="novel",
        target_language="pt-BR",
        terms=[ReplacementTerm("Mestre Gu", "Cultivador Gu")],
        coverage_index_path=coverage,
    )
    records = load_coverage_records(coverage)

    assert result.scanned_count == 1
    assert result.changed_count == 1
    assert "Cultivador Gu" in output.read_text(encoding="utf-8")
    assert records[0].translated_hash != "old"
