#!/usr/bin/env python3
"""Profile avatars: 24 protagonists and antagonists of well-known novels, in the same flat style.

Each one keeps what makes the character recognizable (hair, eyes, a signature prop) and has its
own fixed background and a pose/expression with some emotion. Fan art for personal use; the
original archetypes (`archetypes.py`) are kept for a public release.

    python3 scripts/avatars/characters.py               # writes public/avatars/personagens/*.svg
    python3 scripts/avatars/characters.py --sheet out.svg [--start N --count N --cols N]
"""
from __future__ import annotations

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "avatars" / "personagens"

INK = "#1F1B24"
WHITE = "#FFFFFF"
SKIN = {
    "fair": ("#F8DCC6", "#E9C1A4"),
    "light": ("#F1C9A8", "#DDAA86"),
    "tan": ("#D9A07A", "#C0855F"),
    "pale": ("#E9E6EF", "#D2CDDB"),
    "ghoul": ("#D8DCCB", "#BCC2AC"),
    "bone": ("#EEE6D3", "#D4C9B0"),
}


# ---------- Shared parts ----------

def rect_bg(color: str) -> str:
    return f'<rect width="120" height="120" fill="{color}"/>'


def body(color: str, collar: str | None = None, v: bool = False, wide: bool = False) -> str:
    left, right = (4, 116) if wide else (10, 110)
    out = f'<path d="M{left} 124 C{left} 99 30 88 60 88 C90 88 {right} 99 {right} 124 Z" fill="{color}"/>'
    if collar and v:
        out += f'<path d="M45 89 L60 110 L75 89 C70 88 65 88 60 88 C55 88 50 88 45 89 Z" fill="{collar}"/>'
    elif collar:
        out += f'<path d="M40 91 C46 98 74 98 80 91 C74 88 67 87 60 87 C53 87 46 88 40 91 Z" fill="{collar}"/>'
    return out


def neck(skin: str) -> str:
    return f'<path d="M51 72 L69 72 L70 92 C64 96 56 96 50 92 Z" fill="{SKIN[skin][1]}"/>'


def head(skin: str, ears: str = "round") -> str:
    tone, shade = SKIN[skin]
    out = ""
    if ears == "round":
        out += f'<ellipse cx="37.5" cy="59" rx="4.5" ry="6" fill="{shade}"/><ellipse cx="82.5" cy="59" rx="4.5" ry="6" fill="{shade}"/>'
    elif ears == "elf":
        out += f'<path d="M40 56 L24 44 L37 66 Z" fill="{shade}"/><path d="M80 56 L96 44 L83 66 Z" fill="{shade}"/>'
    # Anime face: rounder cheeks, softly pointed chin.
    out += f'<path d="M38 52 C38 36 47 29 60 29 C73 29 82 36 82 52 L82 60 C82 72 72 83 60 86 C48 83 38 72 38 60 Z" fill="{tone}"/>'
    return out


def eye(cx: float, cy: float, iris: str, style: str, skin: str = "light", side: int = 1) -> str:
    """One eye. `side` is -1 for the viewer's left eye, 1 for the right (slants mirror)."""
    lash = f'stroke="{INK}" stroke-width="2.2" stroke-linecap="round" fill="none"'
    if style == "happy":
        return f'<path d="M{cx - 4} {cy + 1} Q{cx} {cy - 3.5} {cx + 4} {cy + 1}" {lash}/>'
    if style == "closed":
        return f'<path d="M{cx - 4} {cy - 0.5} Q{cx} {cy + 3} {cx + 4} {cy - 0.5}" {lash}/>'
    if style == "wide":  # tiny pupils in big whites (manic)
        return (f'<ellipse cx="{cx}" cy="{cy}" rx="4.8" ry="5.4" fill="{WHITE}"/>'
                f'<circle cx="{cx}" cy="{cy}" r="1.9" fill="{iris}"/><circle cx="{cx}" cy="{cy}" r="0.9" fill="{INK}"/>'
                f'<ellipse cx="{cx}" cy="{cy}" rx="4.8" ry="5.4" fill="none" stroke="{INK}" stroke-width="1.4"/>')
    if style == "skull":
        return (f'<ellipse cx="{cx}" cy="{cy}" rx="5.4" ry="5" fill="#1A0D12"/>'
                f'<circle cx="{cx}" cy="{cy}" r="4.5" fill="{iris}" opacity="0.28"/>'
                f'<circle cx="{cx}" cy="{cy}" r="1.9" fill="{iris}"/>')
    ry = 3.0 if style in ("sharp", "glow-sharp") else 4.3
    out = ""
    if style.startswith("glow"):
        out += f'<ellipse cx="{cx}" cy="{cy}" rx="7.5" ry="6.5" fill="{iris}" opacity="0.32"/>'
    out += f'<ellipse cx="{cx}" cy="{cy}" rx="3.4" ry="{ry}" fill="{iris}"/>'
    out += f'<ellipse cx="{cx}" cy="{cy + 0.4}" rx="1.5" ry="{ry * 0.55}" fill="{INK}" opacity="0.55"/>'
    out += f'<circle cx="{cx - 1.1 * side}" cy="{cy - ry * 0.4}" r="1.1" fill="{WHITE}"/>'
    if style == "slit":
        out += f'<ellipse cx="{cx}" cy="{cy}" rx="0.7" ry="{ry * 0.85}" fill="{INK}"/>'
    if style == "half":  # half-lidded
        tone = SKIN[skin][0]
        out += f'<path d="M{cx - 5} {cy - 6} L{cx + 5} {cy - 6} L{cx + 5} {cy - 0.6} Q{cx} {cy + 0.6} {cx - 5} {cy - 0.6} Z" fill="{tone}"/>'
        out += f'<path d="M{cx - 4.4} {cy - 0.4} Q{cx} {cy + 0.8} {cx + 4.4} {cy - 0.6}" {lash}/>'
        return out
    if style in ("sharp", "glow-sharp"):
        # Upper lid slants down toward the nose: a determined or cold look.
        inner, outer = cx - 4.4 * side, cx + 4.4 * side
        out += f'<path d="M{outer} {cy - 3.4} L{inner} {cy - 1.6}" {lash}/>'
    else:
        out += f'<path d="M{cx - 4.4} {cy - 3.1} Q{cx} {cy - 5.6} {cx + 4.6} {cy - 3.4}" {lash}/>'
    return out


def eyes(iris: str, style: str = "normal", y: float = 59, skin: str = "light", right: str | None = None) -> str:
    return eye(51, y, iris, style, skin, -1) + eye(69, y, iris, right or style, skin, 1)


def brows(color: str, mood: str = "calm", y: float = 50) -> str:
    stroke = f'stroke="{color}" stroke-width="2.4" stroke-linecap="round" fill="none"'
    if mood == "angry":
        return f'<path d="M45 {y - 2} L55 {y + 1.5}" {stroke}/><path d="M75 {y - 2} L65 {y + 1.5}" {stroke}/>'
    if mood == "worried":
        return f'<path d="M45 {y + 1} L55 {y - 2}" {stroke}/><path d="M75 {y + 1} L65 {y - 2}" {stroke}/>'
    if mood == "raised":
        return f'<path d="M45 {y - 3} Q50 {y - 7} 55 {y - 3.5}" {stroke}/><path d="M65 {y - 3.5} Q70 {y - 7} 75 {y - 3}" {stroke}/>'
    if mood == "smug":
        return f'<path d="M45 {y} Q50 {y - 2.5} 55 {y}" {stroke}/><path d="M65 {y - 1.5} Q70 {y - 4} 75 {y - 2.5}" {stroke}/>'
    return f'<path d="M45 {y} Q50 {y - 2} 55 {y}" {stroke}/><path d="M65 {y} Q70 {y - 2} 75 {y}" {stroke}/>'


def mouth(style: str = "smile", y: float = 72) -> str:
    line = f'stroke="{INK}" stroke-width="1.9" stroke-linecap="round" fill="none"'
    if style == "smile":
        return f'<path d="M55 {y} Q60 {y + 4} 65 {y}" {line}/>'
    if style == "soft":
        return f'<path d="M57 {y} Q60 {y + 2.4} 63 {y}" {line} opacity="0.8"/>'
    if style == "smirk":
        return f'<path d="M55 {y + 1} Q60 {y + 2.5} 66 {y - 1.5}" {line}/>'
    if style == "flat":
        return f'<path d="M56.5 {y + 0.5} L63.5 {y + 0.5}" {line} opacity="0.8"/>'
    if style == "frown":
        return f'<path d="M55.5 {y + 2} Q60 {y - 1} 64.5 {y + 2}" {line}/>'
    if style == "fang":
        return (f'<path d="M54.5 {y} Q60 {y + 4.5} 65.5 {y}" {line}/>'
                f'<path d="M62 {y + 1.8} L63.6 {y + 1.2} L62.9 {y + 4} Z" fill="{WHITE}"/>')
    if style == "grin":
        return (f'<path d="M53 {y - 1} Q60 {y + 9} 67 {y - 1} Z" fill="{INK}"/>'
                f'<path d="M54.2 {y - 0.2} L65.8 {y - 0.2} L65 {y + 2} L55 {y + 2} Z" fill="{WHITE}"/>')
    if style == "shout":
        return (f'<ellipse cx="60" cy="{y + 2}" rx="5.2" ry="5.6" fill="{INK}"/>'
                f'<ellipse cx="60" cy="{y + 5.2}" rx="3.6" ry="2.2" fill="#E2677A"/>')
    if style == "maniac":
        return (f'<path d="M50 {y - 2} Q60 {y + 16} 70 {y - 2} Q60 {y + 2} 50 {y - 2} Z" fill="{INK}"/>'
                f'<path d="M51.6 {y - 0.6} L68.4 {y - 0.6} L67.6 {y + 1.4} L52.4 {y + 1.4} Z" fill="{WHITE}"/>'
                f'<path d="M58 {y + 7} Q61 {y + 20} 64 {y + 13} Q63 {y + 7} 58 {y + 7} Z" fill="#E2677A"/>')
    return ""


def blush(y: float = 66) -> str:
    return (f'<ellipse cx="45.5" cy="{y}" rx="4" ry="2.2" fill="#F26B7A" opacity="0.35"/>'
            f'<ellipse cx="74.5" cy="{y}" rx="4" ry="2.2" fill="#F26B7A" opacity="0.35"/>')


def tilt(deg: float, *parts: str) -> str:
    """The head turns around the neck: what makes a bust feel alive."""
    return f'<g transform="rotate({deg} 60 84)">{"".join(parts)}</g>'


def svg(parts: list[str], title: str) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="{title}">'
            f"<title>{title}</title>{''.join(parts)}</svg>\n")


def long_back(c: str, length: float = 104, width: float = 30) -> str:
    return (f'<path d="M{60 - width} 58 C{60 - width - 2} 34 46 23 60 23 C74 23 {60 + width + 2} 34 {60 + width} 58 '
            f'L{60 + width + 3} {length} C{60 + width - 8} {length + 4} {60 - width + 8} {length + 4} {60 - width - 3} {length} Z" fill="{c}"/>')


def curtains(c: str) -> str:
    return (f'<path d="M37 64 C35 36 46 25 60 25 C74 25 85 36 83 64 C81 51 77 43 70 40 C66 38.5 62.5 39.5 60 42 '
            f'C57.5 39.5 54 38.5 50 40 C43 43 39 51 37 64 Z" fill="{c}"/>')


def bangs(c: str, low: float = 0) -> str:
    y = 51 + low
    return (f'<path d="M37 60 C35 35 46 25 60 25 C74 25 85 35 83 60 C81 54 79 {y} 76 {y - 2} L72 {y + 2} L69 {y - 4} L64 {y + 1} '
            f'L60 {y - 5} L56 {y + 1} L51 {y - 4} L48 {y + 2} L44 {y - 2} C41 {y} 39 54 37 60 Z" fill="{c}"/>')


def spiky_top(c: str, low: float = 0) -> str:
    y = 52 + low
    return (f'<path d="M35 {y + 2} L32 38 L41 41 L39 26 L49 34 L52 19 L60 31 L68 18 L71 33 L81 25 L80 41 L89 37 L85 {y + 2} '
            f'C79 46 74 44 70 47 L66 41 L62 48 L57 42 L52 48 L48 43 L43 49 C40 49 37 51 35 {y + 2} Z" fill="{c}"/>')


def witch_hat(color: str, band: str, tip: float = 78, brim: float = 40) -> str:
    return (f'<path d="M12 {brim + 2} C30 {brim - 6} 90 {brim - 6} 108 {brim + 2} C96 {brim + 9} 24 {brim + 9} 12 {brim + 2} Z" fill="{color}"/>'
            f'<path d="M36 {brim} C40 {brim - 18} 50 {brim - 34} {tip} {brim - 40} C{tip - 8} {brim - 26} 80 {brim - 12} 84 {brim} Z" fill="{color}"/>'
            f'<path d="M37 {brim - 4} C50 {brim - 7} 70 {brim - 7} 83 {brim - 4} L84 {brim} C70 {brim - 3} 50 {brim - 3} 36 {brim} Z" fill="{band}"/>')


# ---------- Characters ----------

def sung_jinwoo() -> str:
    hair = "#16141C"
    aura = "".join(f'<path d="M{x} 120 C{x - 6} {y + 30} {x + 8} {y + 14} {x + 2} {y}" stroke="#7B5CFF" stroke-width="{w}" stroke-linecap="round" fill="none" opacity="0.55"/>'
                   for x, y, w in ((22, 30, 6), (36, 18, 4), (88, 22, 5), (100, 34, 6), (62, 6, 3)))
    return svg([
        rect_bg("#121733"), aura,
        body("#17171E", wide=True),
        '<path d="M30 92 L46 86 L52 112 Z" fill="#2B2B36"/><path d="M90 92 L74 86 L68 112 Z" fill="#2B2B36"/>',
        neck("light"),
        tilt(-5, head("light"),
             f'<path d="M36 56 C33 34 45 24 60 24 C76 24 87 34 84 56 C80 46 74 40 68 38 L70 50 L62 41 L58 52 L54 41 L48 50 C42 46 38 50 36 56 Z" fill="{hair}"/>',
             eyes("#9D86FF", "glow-sharp", 60), brows(hair, "angry", 51), mouth("smirk", 73)),
    ], "Sung Jinwoo")


def subaru() -> str:
    hair = "#1C1A22"
    return svg([
        rect_bg("#F2A33A"), '<circle cx="60" cy="60" r="44" fill="#F7BE62"/>',
        body("#24242C"), '<path d="M14 112 C20 98 30 92 42 90 L44 96 C34 98 24 104 18 116 Z" fill="#F28C28"/>',
        '<path d="M106 112 C100 98 90 92 78 90 L76 96 C86 98 96 104 102 116 Z" fill="#F28C28"/>',
        '<rect x="58.6" y="92" width="2.8" height="28" fill="#F2C94C"/>',
        neck("light"),
        tilt(6, head("light"), spiky_top(hair, -2),
             eyes("#3B3B48", "wide", 59), brows(hair, "angry", 50), mouth("grin", 72)),
    ], "Natsuki Subaru")


def emilia() -> str:
    hair = "#E4E6F0"
    snow = "".join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#FFFFFF" opacity="0.7"/>' for x, y, r in ((16, 20, 2), (100, 16, 1.6), (106, 70, 2.2), (14, 76, 1.4), (90, 40, 1.2)))
    return svg([
        rect_bg("#B6A2F0"), snow,
        long_back(hair, 112, 31),
        body("#F4F1FA", "#8C63D9", v=True), neck("fair"),
        tilt(5, head("fair", "elf"), curtains(hair),
             f'<path d="M80 52 C88 62 88 84 82 100 C80 90 78 74 74 62 Z" fill="{hair}"/>',
             '<circle cx="35" cy="44" r="5.5" fill="#FFFFFF"/><circle cx="31" cy="40" r="3.6" fill="#FFFFFF"/>'
             '<circle cx="39" cy="40" r="3.6" fill="#FFFFFF"/><circle cx="35" cy="44" r="2" fill="#F2D15C"/>',
             '<path d="M29 48 L24 58 L32 52 Z" fill="#8C63D9"/>',
             eyes("#8C63D9", "normal", 59, "fair"), brows("#BFC3D2", "calm", 51), mouth("smile", 73), blush(67)),
    ], "Emilia")


def rem() -> str:
    hair = "#5E8FE6"
    return svg([
        rect_bg("#F6B6C8"), '<circle cx="96" cy="24" r="14" fill="#F9CDD9"/>',
        body("#1E1E2A", "#FFFFFF"),
        '<path d="M50 92 C54 98 66 98 70 92 L66 104 L54 104 Z" fill="#FFFFFF"/>',
        neck("fair"),
        tilt(-6, head("fair"),
             f'<path d="M35 66 C30 36 44 24 60 24 C76 24 90 36 85 66 C82 54 80 48 76 44 L76 70 L70 44 C64 46 56 46 48 42 C42 46 38 54 35 66 Z" fill="{hair}"/>',
             f'<path d="M64 41 C72 43 78 50 79 64 C74 56 70 50 62 46 Z" fill="{hair}"/>',
             '<path d="M40 30 C48 22 72 22 80 30 L78 34 C70 28 50 28 42 34 Z" fill="#FFFFFF"/>',
             '<path d="M54 26 L60 21 L66 26 L60 29 Z" fill="#1E1E2A"/>',
             '<path d="M41 40 L46 36 L48 42 L43 45 Z" fill="#FFFFFF"/>',
             eye(51, 59, "#3E78E0", "happy", "fair", -1), eye(69, 59, "#3E78E0", "normal", "fair", 1),
             mouth("smile", 73), blush(67)),
    ], "Rem")


def kirito() -> str:
    hair = "#15141B"
    grid = "".join(f'<rect x="{x}" y="{y}" width="6" height="6" fill="#2B8C9A" opacity="0.35"/>' for x, y in ((10, 14), (18, 22), (98, 18), (104, 30), (12, 60), (102, 70), (92, 10)))
    return svg([
        rect_bg("#0F2A33"), grid,
        '<path d="M86 6 L96 10 L58 104 L52 100 Z" fill="#26262E"/><path d="M84 4 L98 6 L95 12 L82 10 Z" fill="#6B6F7A"/>',
        '<path d="M98 16 L106 22 L74 106 L68 102 Z" fill="#7FB3D9"/><path d="M96 14 L109 19 L105 25 L93 20 Z" fill="#C9CED8"/>',
        body("#1A1A22", "#2E2E38"), '<path d="M44 92 L60 118 L76 92 L72 90 L60 108 L48 90 Z" fill="#3A3A46"/>',
        neck("light"),
        tilt(-4, head("light"),
             f'<path d="M36 58 C33 34 45 24 60 24 C75 24 87 34 84 58 C82 48 78 44 74 42 L72 52 L66 44 L62 54 L58 44 L52 52 L50 43 C44 46 39 50 36 58 Z" fill="{hair}"/>',
             eyes("#2E2E3A", "sharp", 60), brows(hair, "angry", 51), mouth("flat", 73)),
    ], "Kirito")


def asuna() -> str:
    hair = "#D9783A"
    return svg([
        rect_bg("#C42F3A"), '<path d="M0 120 L70 0 L92 0 L22 120 Z" fill="#D9434E"/>',
        long_back(hair, 114, 32),
        body("#F4F1EE", "#C42F3A", v=True),
        '<path d="M45 89 L60 110 L75 89 L73 88 L60 104 L47 88 Z" fill="#F4F1EE"/>',
        neck("fair"),
        tilt(5, head("fair"), curtains(hair),
             '<path d="M38 36 C46 26 74 26 82 36 C74 32 46 32 38 36 Z" fill="#B85F28"/>',
             '<path d="M40 34 C48 28 72 28 80 34" stroke="#F2A16A" stroke-width="2" fill="none" stroke-dasharray="3 2"/>',
             eyes("#8A5530", "normal", 59, "fair"), brows("#A85A28", "calm", 51), mouth("smile", 73), blush(67)),
    ], "Asuna")


def ainz() -> str:
    return svg([
        rect_bg("#160A0F"), '<circle cx="60" cy="56" r="46" fill="#5E1420" opacity="0.6"/>',
        '<circle cx="60" cy="56" r="30" fill="#8A1C2C" opacity="0.4"/>',
        body("#2A1838", wide=True),
        '<path d="M14 120 L10 84 L40 96 L44 120 Z" fill="#D9A93A"/><path d="M106 120 L110 84 L80 96 L76 120 Z" fill="#D9A93A"/>',
        '<path d="M22 70 L40 92 L30 96 Z" fill="#D9A93A"/><path d="M98 70 L80 92 L90 96 Z" fill="#D9A93A"/>',
        '<circle cx="60" cy="106" r="6" fill="#C8293F"/><circle cx="58" cy="104" r="2" fill="#FF8A8A"/>',
        '<rect x="54" y="74" width="12" height="18" rx="3" fill="#D4C9B0"/>',
        '<path d="M36 54 C36 34 46 24 60 24 C74 24 84 34 84 54 C84 64 78 70 74 72 L72 82 L48 82 L46 72 C42 70 36 64 36 54 Z" fill="#EEE6D3"/>',
        eye(50, 56, "#FF3B3B", "skull"), eye(70, 56, "#FF3B3B", "skull"),
        '<path d="M60 63 L57 69 L63 69 Z" fill="#1A0D12"/>',
        '<path d="M50 75 L70 75" stroke="#1A0D12" stroke-width="1.6"/>'
        + "".join(f'<path d="M{x} 73 L{x} 79" stroke="#1A0D12" stroke-width="1.2"/>' for x in (53, 57, 61, 65, 69)),
    ], "Ainz Ooal Gown")


def albedo() -> str:
    hair = "#1A1720"
    return svg([
        rect_bg("#2C1842"),
        '<path d="M60 84 C40 60 14 54 2 70 C14 70 22 76 24 86 C12 84 6 92 6 100 C20 92 36 96 60 96 Z" fill="#0F0C16"/>',
        '<path d="M60 84 C80 60 106 54 118 70 C106 70 98 76 96 86 C108 84 114 92 114 100 C100 92 84 96 60 96 Z" fill="#0F0C16"/>',
        long_back(hair, 112, 30),
        body("#F4F1FA", "#D9A93A", v=True), neck("fair"),
        tilt(-6, head("fair"), curtains(hair),
             '<path d="M40 40 C30 34 26 40 30 48 C32 44 36 44 38 48 Z" fill="#EEE6D3"/>',
             '<path d="M80 40 C90 34 94 40 90 48 C88 44 84 44 82 48 Z" fill="#EEE6D3"/>',
             eyes("#E8B23A", "slit", 59, "fair"), brows("#1A1720", "smug", 51), mouth("smirk", 73), blush(67)),
    ], "Albedo")


def kim_dokja() -> str:
    hair = "#1C1A24"
    stars = "".join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#FFFFFF" opacity="0.85"/>' for x, y, r in ((18, 18, 1.4), (30, 34, 1), (96, 14, 1.6), (104, 40, 1.1), (86, 26, 0.9), (14, 60, 1.2)))
    return svg([
        rect_bg("#101A36"), stars,
        '<path d="M18 18 L30 34 L14 60" stroke="#8FB3FF" stroke-width="0.8" fill="none" opacity="0.6"/>',
        '<path d="M96 14 L86 26 L104 40" stroke="#8FB3FF" stroke-width="0.8" fill="none" opacity="0.6"/>',
        body("#ECECF2", "#1C1A24", v=True),
        '<rect x="66" y="98" width="12" height="20" rx="2.5" fill="#22222C"/><rect x="67.5" y="100" width="9" height="15" rx="1.5" fill="#6FB3FF"/>',
        neck("light"),
        tilt(4, head("light"),
             f'<path d="M36 58 C34 34 46 25 61 25 C76 25 87 34 84 58 C82 50 79 46 74 44 C68 42 62 46 56 42 C50 44 46 46 43 50 C40 52 38 55 36 58 Z" fill="{hair}"/>',
             eyes("#3B3F55", "half", 60, "light"), brows(hair, "worried", 51), mouth("smile", 73)),
    ], "Kim Dokja")


def klein_moretti() -> str:
    hair = "#2B221E"
    fog = "".join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#A9AEBF" opacity="0.45"/>' for x, y, r in ((10, 100, 22), (110, 96, 24), (20, 30, 14), (102, 28, 12)))
    return svg([
        rect_bg("#6E7387"), fog,
        body("#1C1C22", "#F2F0EA", v=True), '<path d="M56 92 L60 100 L64 92 Z" fill="#7A1E2C"/>',
        neck("light"),
        tilt(-3, head("light"),
             f'<path d="M37 56 C36 42 44 36 60 36 C76 36 84 42 83 56 C78 48 70 46 60 46 C50 46 42 48 37 56 Z" fill="{hair}"/>',
             '<path d="M30 40 C40 36 80 36 90 40 C86 44 34 44 30 40 Z" fill="#141418"/>',
             '<rect x="40" y="6" width="40" height="34" rx="3" fill="#141418"/><rect x="40" y="30" width="40" height="5" fill="#3A3A46"/>',
             eyes("#5A3E2E", "normal", 60), brows(hair, "smug", 51), mouth("smirk", 73)),
    ], "Klein Moretti")


def naofumi() -> str:
    hair = "#221E1C"
    return svg([
        rect_bg("#2E6A48"), '<path d="M0 0 L40 0 L0 50 Z M120 0 L80 0 L120 50 Z" fill="#3B8058"/>',
        body("#3E7D4E", "#2A5A38"),
        neck("light"),
        tilt(3, head("light"),
             f'<path d="M36 56 C33 34 45 25 60 25 C75 25 87 34 84 56 C80 48 75 44 70 43 L68 50 L63 43 L59 51 L55 43 L50 50 C44 47 39 50 36 56 Z" fill="{hair}"/>',
             eyes("#3F9E5A", "sharp", 60), brows(hair, "angry", 51), mouth("frown", 73)),
        '<path d="M14 92 C14 82 22 78 34 78 C46 78 52 84 52 94 C52 108 40 118 32 120 C22 116 14 106 14 92 Z" fill="#9AA6A0"/>',
        '<path d="M18 92 C18 85 24 82 33 82 C42 82 48 86 48 94 C48 104 40 112 33 115 C25 112 18 104 18 92 Z" fill="#6E7A74"/>',
        '<circle cx="33" cy="94" r="5" fill="#3CCB7A"/><circle cx="31.5" cy="92.5" r="1.6" fill="#B8F5D2"/>',
    ], "Naofumi Iwatani")


def raphtalia() -> str:
    hair = "#6B3822"
    return svg([
        rect_bg("#D85E3A"), '<circle cx="60" cy="58" r="40" fill="#E57A55"/>',
        '<path d="M92 10 L100 14 L72 96 L66 92 Z" fill="#2A2A30"/><rect x="88" y="6" width="16" height="4" rx="2" transform="rotate(20 96 8)" fill="#C9A24A"/>',
        long_back(hair, 112, 30),
        body("#F4F1EE", "#B3243F", v=True), neck("fair"),
        tilt(-5, head("fair"),
             f'<path d="M38 34 C30 18 44 12 50 24 Z" fill="{hair}"/><path d="M41 30 C38 22 44 19 47 25 Z" fill="#3E2014"/>',
             f'<path d="M82 34 C90 18 76 12 70 24 Z" fill="{hair}"/><path d="M79 30 C82 22 76 19 73 25 Z" fill="#3E2014"/>',
             bangs(hair), eyes("#C8323A", "sharp", 60, "fair"), brows(hair, "angry", 51), mouth("smile", 73)),
    ], "Raphtalia")


def holo() -> str:
    hair = "#9A5A30"
    wheat = "".join(f'<path d="M{x} 120 L{x + 4} 70" stroke="#C9962C" stroke-width="2"/><ellipse cx="{x + 4}" cy="66" rx="2.4" ry="6" fill="#C9962C"/>' for x in (8, 18, 98, 108))
    return svg([
        rect_bg("#E9B94B"), wheat,
        long_back(hair, 114, 32),
        body("#7A2A24", "#D9C29A"),
        '<path d="M56 92 C56 100 64 100 64 92" stroke="#6E4A2A" stroke-width="1.6" fill="none"/><rect x="56" y="99" width="8" height="9" rx="2" fill="#B8864A"/>',
        neck("light"),
        tilt(7, head("light"),
             f'<path d="M34 40 L28 12 L48 28 Z" fill="{hair}"/><path d="M33 34 L31 18 L42 28 Z" fill="#F4EDE2"/>',
             f'<path d="M86 40 L92 12 L72 28 Z" fill="{hair}"/><path d="M87 34 L89 18 L78 28 Z" fill="#F4EDE2"/>',
             curtains(hair),
             eyes("#D64B2A", "normal", 59), brows("#7A4422", "smug", 51), mouth("fang", 72), blush(67)),
    ], "Holo")


def megumin() -> str:
    burst = '<path d="M60 4 L68 34 L98 16 L80 44 L116 50 L82 62 L104 92 L70 76 L60 110 L50 76 L16 92 L38 62 L4 50 L40 44 L22 16 L52 34 Z" fill="#FFD34A"/>'
    hair = "#3A2420"
    return svg([
        rect_bg("#F07A2A"), burst, '<circle cx="60" cy="56" r="18" fill="#FFF1B8"/>',
        body("#2A1E22", "#8A1F2E"),
        '<path d="M14 120 C18 100 30 92 44 90 L40 120 Z M106 120 C102 100 90 92 76 90 L80 120 Z" fill="#8A1F2E"/>',
        neck("fair"),
        tilt(-8, head("fair"),
             f'<path d="M36 64 C33 40 44 30 60 30 C76 30 87 40 84 64 C81 54 78 50 74 48 L71 54 L66 47 L61 53 L56 47 L51 54 L48 48 C42 51 38 56 36 64 Z" fill="{hair}"/>',
             eye(51, 60, "#E0303A", "normal", "fair", -1),
             '<path d="M62 54 C66 52 74 52 77 55 L76 64 C72 66 66 66 63 63 Z" fill="#1A1418"/>',
             '<path d="M36 50 L63 56 M77 55 L86 52" stroke="#1A1418" stroke-width="1.6"/>',
             brows(hair, "angry", 51), mouth("shout", 71),
             witch_hat("#1A1418", "#D9A93A", tip=84, brim=38)),
    ], "Megumin")


def roxy() -> str:
    hair = "#3E5FBF"
    return svg([
        rect_bg("#7FA9E8"), '<circle cx="60" cy="60" r="42" fill="#9DBEF0"/>',
        body("#6E4A2A", "#F4F1EA"),
        f'<path d="M36 64 C30 80 34 100 30 116 L40 116 C42 100 42 84 42 70 Z" fill="{hair}"/>',
        f'<path d="M84 64 C90 80 86 100 90 116 L80 116 C78 100 78 84 78 70 Z" fill="{hair}"/>',
        '<circle cx="33" cy="114" r="3" fill="#F4F1EA"/><circle cx="87" cy="114" r="3" fill="#F4F1EA"/>',
        neck("fair"),
        tilt(4, head("fair"), bangs(hair),
             eyes("#3E5FBF", "half", 60, "fair"), brows("#2E4A9A", "calm", 51), mouth("soft", 73), blush(67),
             witch_hat("#6E4A2A", "#3E5FBF", tip=86, brim=40)),
    ], "Roxy Migurdia")


def ayanokouji() -> str:
    hair = "#8C6A4A"
    return svg([
        rect_bg("#D7DAE2"), '<path d="M0 82 L120 70 L120 74 L0 86 Z" fill="#B3243F" opacity="0.6"/>',
        body("#B3243F", "#F4F4F6", v=True), '<path d="M57.5 92 L62.5 92 L61.5 112 L58.5 112 Z" fill="#22222C"/>',
        neck("light"),
        tilt(0, head("light"),
             f'<path d="M36 58 C33 34 45 25 60 25 C75 25 87 34 84 58 C82 48 78 44 73 42 L71 49 L65 42 L61 50 L57 42 L52 48 L49 42 C43 45 38 50 36 58 Z" fill="{hair}"/>',
             eyes("#6A4E3A", "half", 60), brows("#6E5034", "calm", 51), mouth("flat", 73)),
    ], "Kiyotaka Ayanokouji")


def horikita() -> str:
    hair = "#16141C"
    return svg([
        rect_bg("#5A6478"), '<path d="M0 0 L120 0 L120 30 C80 20 40 40 0 30 Z" fill="#4A5366"/>',
        long_back(hair, 112, 30),
        body("#B3243F", "#F4F4F6", v=True), '<path d="M57 92 L63 92 L60 100 Z" fill="#22222C"/>',
        neck("fair"),
        tilt(-3, head("fair"), curtains(hair),
             f'<path d="M38 50 C32 66 34 84 30 98 C36 98 40 86 40 70 Z" fill="{hair}"/>',
             '<path d="M36 62 C34 66 38 70 36 74 C34 78 38 82 36 86" stroke="#2E2A36" stroke-width="2" fill="none"/>',
             eyes("#4A4E5E", "sharp", 60, "fair"), brows(hair, "calm", 51), mouth("flat", 73)),
    ], "Suzune Horikita")


def elaina() -> str:
    hair = "#D2D2DC"
    clouds = '<ellipse cx="22" cy="96" rx="22" ry="10" fill="#FFFFFF" opacity="0.8"/><ellipse cx="102" cy="88" rx="20" ry="9" fill="#FFFFFF" opacity="0.8"/>'
    return svg([
        rect_bg("#6DB6F2"), clouds,
        long_back(hair, 112, 30),
        body("#1C1C26", "#F4F1EA"),
        '<path d="M60 96 L62.2 100.5 L67 101 L63.4 104 L64.4 108.8 L60 106.3 L55.6 108.8 L56.6 104 L53 101 L57.8 100.5 Z" fill="#E8C14A"/>',
        neck("fair"),
        tilt(6, head("fair"), curtains(hair),
             eyes("#3F6FD6", "normal", 60, "fair"), brows("#A9A9B6", "smug", 51), mouth("smile", 73), blush(67),
             witch_hat("#1C1C26", "#F4F1EA", tip=90, brim=40)),
    ], "Elaina")


def violet() -> str:
    hair = "#E9C46A"
    return svg([
        rect_bg("#4E6D9E"),
        '<rect x="80" y="12" width="28" height="20" rx="2" fill="#F4EEDD" transform="rotate(12 94 22)"/>',
        '<path d="M80 12 L94 24 L108 12" stroke="#C9B48A" stroke-width="1.4" fill="none" transform="rotate(12 94 22)"/>',
        body("#22305A", "#F4F1EA"),
        '<circle cx="60" cy="94" r="4.6" fill="#2FA36B"/><circle cx="58.6" cy="92.6" r="1.4" fill="#B8F5D2"/>',
        neck("fair"),
        tilt(-4, head("fair"),
             f'<circle cx="60" cy="22" r="11" fill="{hair}"/>',
             curtains(hair),
             # Red ribbon tied around the bun.
             '<path d="M51 22 C56 25 64 25 69 22 L69 27 C64 30 56 30 51 27 Z" fill="#C8293F"/>',
             f'<path d="M38 56 C36 66 38 74 36 82 L41 80 C42 72 41 64 41 58 Z" fill="{hair}"/>',
             f'<path d="M82 56 C84 66 82 74 84 82 L79 80 C78 72 79 64 79 58 Z" fill="{hair}"/>',
             eyes("#3B7FD9", "normal", 60, "fair"), brows("#C9A44A", "worried", 51), mouth("soft", 73)),
    ], "Violet Evergarden")


def mai() -> str:
    hair = "#15131C"
    return svg([
        rect_bg("#4A3A72"), '<rect y="86" width="120" height="34" fill="#E26B9A" opacity="0.35"/>',
        long_back(hair, 114, 31),
        body("#15131C", "#F4F4F6"),
        '<path d="M55 90 L60 93 L65 90 L65 96 L60 93 L55 96 Z" fill="#15131C"/>',
        neck("fair"),
        tilt(5,
             '<path d="M44 34 C38 14 40 2 46 2 C52 4 52 20 50 34 Z" fill="#15131C"/><path d="M45.5 30 C41 16 43 7 46 7 C49 9 49 20 48 30 Z" fill="#F4F4F6"/>',
             '<path d="M76 34 C82 14 80 2 74 2 C68 4 68 20 70 34 Z" fill="#15131C"/><path d="M74.5 30 C79 16 77 7 74 7 C71 9 71 20 72 30 Z" fill="#F4F4F6"/>',
             head("fair"), curtains(hair),
             eyes("#7A6BD9", "normal", 60, "fair"), brows(hair, "smug", 51), mouth("smirk", 73), blush(67)),
    ], "Mai Sakurajima")


def wei_wuxian() -> str:
    hair = "#16141C"
    return svg([
        rect_bg("#8E1F2B"), '<path d="M-10 40 C20 20 40 50 70 30 C90 18 110 30 130 20 L130 0 L-10 0 Z" fill="#7A1824"/>',
        f'<path d="M80 30 C100 36 104 60 96 80 C94 66 90 52 80 44 Z" fill="{hair}"/>',
        '<path d="M80 30 L92 22 L88 34 Z" fill="#E03A44"/><path d="M90 30 C98 40 100 48 96 56" stroke="#E03A44" stroke-width="2.4" fill="none"/>',
        body("#16141C", "#C8293F", v=True),
        '<rect x="24" y="96" width="62" height="4.5" rx="2.2" fill="#16141C" transform="rotate(-24 55 98)"/>',
        '<path d="M30 112 C26 118 30 124 34 120 C32 116 34 114 30 112 Z" fill="#E03A44"/>',
        neck("light"),
        tilt(7, head("light"), bangs(hair),
             eye(51, 60, "#5A5A6E", "normal", "light", -1), eye(69, 60, "#5A5A6E", "happy", "light", 1),
             brows(hair, "smug", 51), mouth("grin", 72)),
    ], "Wei Wuxian")


def shadow() -> str:
    return svg([
        rect_bg("#120E1E"), '<path d="M0 100 L120 20 L120 30 L0 110 Z" fill="#6C3FD9" opacity="0.55"/>',
        body("#0B0910", "#3A2A5E", wide=True),
        '<path d="M28 70 C24 36 40 16 60 16 C80 16 96 36 92 70 L96 100 L24 100 Z" fill="#0B0910"/>',
        '<path d="M28 70 C24 36 40 16 60 16 C80 16 96 36 92 70" stroke="#7B4DFF" stroke-width="1.6" fill="none" opacity="0.8"/>',
        '<path d="M38 60 C38 40 47 32 60 32 C73 32 82 40 82 60" stroke="#7B4DFF" stroke-width="1.2" fill="none" opacity="0.6"/>',
        tilt(-5,
             '<path d="M40 56 C40 40 48 34 60 34 C72 34 80 40 80 56 L80 66 C80 76 72 82 60 84 C48 82 40 76 40 66 Z" fill="#1A1626"/>',
             eyes("#B58CFF", "glow-sharp", 56),
             '<path d="M40 64 L80 64 L80 68 C78 78 70 84 60 84 C50 84 42 78 40 68 Z" fill="#0B0910"/>'),
    ], "Shadow")


def betelgeuse() -> str:
    hair = "#3E6E2E"
    hands = "".join(f'<path d="M{x} 120 L{x - 2} {y} L{x + 2} {y - 8} L{x + 5} {y} L{x + 6} 120 Z" fill="#2E4A22" opacity="0.7"/>' for x, y in ((10, 60), (22, 72), (98, 66), (108, 56)))
    return svg([
        rect_bg("#5E8F3A"), hands,
        body("#15131C", "#2E2A36"),
        neck("ghoul"),
        tilt(14, head("ghoul"),
             f'<path d="M34 66 C30 34 44 24 60 24 C76 24 90 34 86 66 C84 56 82 50 80 46 L40 46 C38 50 36 56 34 66 Z" fill="{hair}"/>',
             f'<path d="M38 46 L82 46 L82 49 L38 49 Z" fill="#2E5420"/>',
             eyes("#4ED15A", "wide", 59), brows("#2E5420", "raised", 52), mouth("maniac", 71)),
    ], "Betelgeuse")


def sunny() -> str:
    hair = "#121016"
    return svg([
        rect_bg("#20222A"),
        '<path d="M26 120 C20 80 28 40 50 28 C70 18 92 32 96 60 C100 90 92 110 96 120 Z" fill="#111217"/>',
        body("#17181E", "#2E3038"),
        '<path d="M16 104 L34 92 L40 106 L22 114 Z M104 104 L86 92 L80 106 L98 114 Z" fill="#3A3D48"/>',
        neck("pale"),
        tilt(-4, head("pale"),
             f'<path d="M35 60 C30 34 44 23 60 23 C78 23 90 34 85 60 C83 50 80 46 76 44 L75 53 L69 45 L64 54 L59 44 L54 53 L50 44 L46 52 C41 50 37 54 35 60 Z" fill="{hair}"/>',
             eyes("#1A1A20", "sharp", 60, "pale"), brows(hair, "smug", 51), mouth("smirk", 73)),
    ], "Sunless")


CHARACTERS = {
    "sung-jinwoo": sung_jinwoo,
    "emilia": emilia,
    "subaru": subaru,
    "rem": rem,
    "kirito": kirito,
    "asuna": asuna,
    "ainz": ainz,
    "albedo": albedo,
    "kim-dokja": kim_dokja,
    "holo": holo,
    "klein-moretti": klein_moretti,
    "megumin": megumin,
    "naofumi": naofumi,
    "raphtalia": raphtalia,
    "ayanokouji": ayanokouji,
    "horikita": horikita,
    "wei-wuxian": wei_wuxian,
    "roxy": roxy,
    "shadow": shadow,
    "elaina": elaina,
    "betelgeuse": betelgeuse,
    "violet": violet,
    "sunny": sunny,
    "mai": mai,
}


def sheet(path: Path, start: int = 0, count: int = 24, cols: int = 6) -> None:
    items = list(CHARACTERS.items())[start:start + count]
    rows = (len(items) + cols - 1) // cols
    cells = []
    for offset, (name, make) in enumerate(items):
        x, y = (offset % cols) * 130 + 5, (offset // cols) * 130 + 5
        inner = make().split(">", 1)[1].rsplit("</svg>", 1)[0]
        clip = f"c{offset}"
        cells.append(f'<clipPath id="{clip}"><circle cx="{x + 60}" cy="{y + 60}" r="60"/></clipPath>'
                     f'<g clip-path="url(#{clip})"><g transform="translate({x} {y})">{inner}</g></g>')
    w, h = cols * 130, rows * 130
    path.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w * 2}" height="{h * 2}">'
                    f'<rect width="{w}" height="{h}" fill="#19191b"/>{"".join(cells)}</svg>')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sheet", type=Path)
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--count", type=int, default=24)
    parser.add_argument("--cols", type=int, default=6)
    args = parser.parse_args()
    if args.sheet:
        sheet(args.sheet, args.start, args.count, args.cols)
        return
    OUT.mkdir(parents=True, exist_ok=True)
    for name, make in CHARACTERS.items():
        (OUT / f"{name}.svg").write_text(make())
    print(f"{len(CHARACTERS)} avatars em {OUT}")


if __name__ == "__main__":
    main()
