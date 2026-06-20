from oghma.taxonomy import canonical_tag_keys, normalize_tag_key, build_tag_items


def test_aliases_collapse_to_canonical_keys():
    assert normalize_tag_key("Action") == "genre.action"
    assert normalize_tag_key("Acao") == "genre.action"
    assert normalize_tag_key("Ação") == "genre.action"
    assert normalize_tag_key("Sci-fi") == "genre.sci_fi"
    assert normalize_tag_key("Ficcao Cientifica") == "genre.sci_fi"


def test_canonical_tag_keys_deduplicates_equivalent_aliases():
    assert canonical_tag_keys(["Action", "Acao", "Fantasy"]) == [
        "genre.action",
        "genre.fantasy",
    ]


def test_unknown_tags_are_kept_as_raw_keys():
    assert canonical_tag_keys(["Celestial Tax Accountants"]) == [
        "raw.celestial.tax.accountants",
    ]


def test_build_tag_items_keeps_unknown_labels():
    items = build_tag_items(
        {"raw.celestial.tax.accountants": 2},
        {"raw.celestial.tax.accountants": {"Celestial Tax Accountants"}},
    )
    unknown = next(item for item in items if item["key"] == "raw.celestial.tax.accountants")

    assert unknown["label"] == "Celestial Tax Accountants"
    assert unknown["category"] == "theme"
    assert unknown["reviewStatus"] == "unknown"
