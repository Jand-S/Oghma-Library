from oghma.translation.sanitizer import clean_translation_html, repair_common_mojibake


def test_repair_common_mojibake_repairs_single_level_utf8_damage():
    damaged = "\u00e2\u20ac\u0153Gu Master\u00e2\u20ac\u2122s path\u00e2\u20ac\u009d \u00e2\u20ac\u201c Qing Mao"

    assert repair_common_mojibake(damaged) == "\u201cGu Master\u2019s path\u201d \u2013 Qing Mao"


def test_repair_common_mojibake_preserves_unrelated_unicode_chunks():
    damaged = "\u9f8d \u00e2\u20ac\u0153awakens\u00e2\u20ac\u009d"

    assert repair_common_mojibake(damaged) == "\u9f8d \u201cawakens\u201d"


def test_clean_translation_html_repairs_text_before_parsing():
    damaged = "<p>He said \u00e2\u20ac\u0153hello\u00e2\u20ac\u009d.</p>"

    assert clean_translation_html(damaged) == "<p>He said \u201chello\u201d.</p>"
