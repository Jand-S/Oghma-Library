from oghma.translation.memory import (
    MemoryChapter,
    TranslationMemoryTerm,
    detect_memory_conflicts,
    extract_memory_terms,
    glossary_for_novel,
    load_memory_terms,
    save_memory_terms,
    suggest_memory_conflict_resolutions,
    update_memory_from_chapters,
    upsert_manual_memory_term,
)


def test_extract_memory_terms_detects_known_xianxia_terms():
    terms = extract_memory_terms(
        "novel",
        [
            MemoryChapter("c1", 1, "<p>The Gu Master used primeval essence.</p>"),
            MemoryChapter("c2", 2, "<p>Foundation Establishment was distant.</p>"),
        ],
    )

    by_source = {term.source: term for term in terms}

    assert by_source["Gu Master"].target == "Mestre Gu"
    assert by_source["primeval essence"].target == "essencia primeva"
    assert by_source["Foundation Establishment"].status == "locked_auto"


def test_extract_memory_terms_promotes_repeated_proper_nouns():
    terms = extract_memory_terms(
        "novel",
        [
            MemoryChapter("c1", 1, "<p>Fang Yuan entered the village.</p>"),
            MemoryChapter("c2", 2, "<p>Fang Yuan smiled.</p>"),
        ],
    )

    proper = next(term for term in terms if term.source == "Fang Yuan")

    assert proper.target == "Fang Yuan"
    assert proper.status == "approved_auto"
    assert proper.category == "proper_noun"


def test_update_memory_from_chapters_persists_enforced_glossary(tmp_path):
    path = tmp_path / "memory.json"

    glossary = update_memory_from_chapters(
        "novel",
        [MemoryChapter("c1", 1, "<p>The Gu Master met Fang Yuan.</p>")],
        path,
    )

    assert any(term.source == "Gu Master" and term.target == "Mestre Gu" for term in glossary)
    assert len(load_memory_terms(path)) >= 1
    assert glossary_for_novel("novel", path)[0].is_enforced


def test_upsert_manual_memory_term_overrides_auto_term(tmp_path):
    path = tmp_path / "memory.json"
    update_memory_from_chapters(
        "novel",
        [MemoryChapter("c1", 1, "<p>The Gu Master appeared.</p>")],
        path,
    )

    term = upsert_manual_memory_term(
        novel_id="novel",
        source="Gu Master",
        target="Cultivador Gu",
        path=path,
    )

    assert term.status == "locked"
    assert term.target == "Cultivador Gu"
    assert glossary_for_novel("novel", path)[0].target == "Cultivador Gu"


def test_detect_memory_conflicts_finds_same_source_with_different_targets(tmp_path):
    path = tmp_path / "memory.json"
    save_memory_terms(
        [
            TranslationMemoryTerm("novel", "Gu Master", "Mestre Gu", confidence=0.8),
            TranslationMemoryTerm("novel", "gu master", "Cultivador Gu", confidence=1.0),
        ],
        path,
    )

    conflicts = detect_memory_conflicts("novel", path)

    assert any(item.conflict_type == "same_source_different_target" for item in conflicts)
    assert conflicts[0].severity == "high"


def test_detect_memory_conflicts_finds_same_target_for_different_sources(tmp_path):
    path = tmp_path / "memory.json"
    save_memory_terms(
        [
            TranslationMemoryTerm("novel", "Gu Master", "Mestre Gu", confidence=0.9),
            TranslationMemoryTerm("novel", "Gu Cultivator", "Mestre Gu", confidence=0.7),
        ],
        path,
    )

    conflicts = detect_memory_conflicts("novel", path)

    assert any(item.conflict_type == "same_target_different_source" for item in conflicts)


def test_detect_memory_conflicts_finds_near_duplicate_sources(tmp_path):
    path = tmp_path / "memory.json"
    save_memory_terms(
        [
            TranslationMemoryTerm("novel", "Flower Wine Monk", "Monge do Vinho das Flores", confidence=0.9),
            TranslationMemoryTerm("novel", "Flower-Wine Monk", "Monge Flower Wine", confidence=0.7),
        ],
        path,
    )

    conflicts = detect_memory_conflicts("novel", path)

    assert any(item.conflict_type == "near_duplicate_source" for item in conflicts)


def test_suggest_memory_conflict_resolutions_prefers_locked_terms(tmp_path):
    path = tmp_path / "memory.json"
    save_memory_terms(
        [
            TranslationMemoryTerm("novel", "Gu Master", "Mestre Gu", status="candidate", confidence=0.6),
            TranslationMemoryTerm("novel", "gu master", "Cultivador Gu", status="locked", confidence=1.0),
        ],
        path,
    )

    suggestions = suggest_memory_conflict_resolutions("novel", path)

    assert suggestions[0].action == "lock_source_target"
    assert suggestions[0].suggested_target == "Cultivador Gu"
    assert suggestions[0].confidence >= 1.0


def test_suggest_memory_conflict_resolutions_keeps_ambiguous_collisions_review_only(tmp_path):
    path = tmp_path / "memory.json"
    save_memory_terms(
        [
            TranslationMemoryTerm("novel", "Gu Master", "Mestre Gu", confidence=0.9),
            TranslationMemoryTerm("novel", "Gu Cultivator", "Mestre Gu", confidence=0.7),
        ],
        path,
    )

    suggestions = suggest_memory_conflict_resolutions("novel", path)

    assert suggestions[0].action == "review_only"
    assert suggestions[0].confidence < 0.5
