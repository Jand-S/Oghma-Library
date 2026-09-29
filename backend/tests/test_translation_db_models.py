from oghma.models import Base


def test_translation_tables_are_registered_in_metadata():
    expected = {
        "translation_job",
        "translation_chapter",
        "translation_memory_term",
        "translation_selection_history",
        "translation_pricing_snapshot",
    }

    assert expected.issubset(set(Base.metadata.tables))

