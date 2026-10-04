#!/usr/bin/env python3
"""Generates the 24 profile avatars of the Oghma account (`public/avatars/<id>.svg`).

Original genre archetypes in one flat style: a front-facing bust built from simple shapes,
solid colors, no outlines and no gradients. The background is NOT drawn here: the app paints
the circle in the color the reader picked (`Avatar` in `src/ui`). Everything sits in a
120×120 box and reads well inside a circle of radius 60.

    python3 scripts/avatars/archetypes.py            # writes public/avatars/*.svg
    python3 scripts/avatars/archetypes.py --sheet out.svg   # contact sheet for review
"""
from __future__ import annotations

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "avatars"

# Skin tones (light → deep) and the shade used for necks and ears.
SKIN = {
    "s1": ("#F7D9C0", "#E8BE9E"),
    "s2": ("#EDBB92", "#D9A077"),
    "s3": ("#CF9467", "#B97B50"),
    "s4": ("#99623F", "#7F4F31"),
    "s5": ("#5E3B28", "#4C2F20"),
    "pale": ("#E6E2EC", "#CFC9D9"),
}
INK = "#1F1B24"

# Same ids and order as the backend (`oghma/accounts/profile.py`).
COLORS = {
    "coral": "#FF6B5E",
    "tangerina": "#FF9F43",
    "ambar": "#F5BE3C",
    "lima": "#9ACD4F",
    "menta": "#3CCB95",
    "turquesa": "#22B8C2",
    "celeste": "#4A9EFF",
    "anil": "#5B67F0",
    "lavanda": "#9B7BFF",
    "orquidea": "#CF63E0",
    "rosa": "#FF6FA4",
    "grafite": "#5A616D",
}


# ---------- Shared parts ----------

def body(color: str, collar: str | None = None, v: bool = False) -> str:
    """Shoulders: a wide rounded bust at the bottom; `collar` draws a V or a band in another color."""
    out = f'<path d="M10 124 C10 99 31 88 60 88 C89 88 110 99 110 124 Z" fill="{color}"/>'
    if collar and v:
        out += f'<path d="M45 89 L60 110 L75 89 C70 88 65 88 60 88 C55 88 50 88 45 89 Z" fill="{collar}"/>'
    elif collar:
        out += f'<path d="M40 91 C46 98 74 98 80 91 C74 88 67 87 60 87 C53 87 46 88 40 91 Z" fill="{collar}"/>'
    return out


def neck(skin: str) -> str:
    return f'<path d="M51 70 L69 70 L70 92 C64 96 56 96 50 92 Z" fill="{SKIN[skin][1]}"/>'


def head(skin: str, ears: str = "round") -> str:
    tone, shade = SKIN[skin]
    out = ""
    if ears == "round":
        out += f'<ellipse cx="37.5" cy="58" rx="4.5" ry="6" fill="{shade}"/><ellipse cx="82.5" cy="58" rx="4.5" ry="6" fill="{shade}"/>'
    elif ears == "elf":
        out += f'<path d="M40 54 L22 40 L37 64 Z" fill="{shade}"/><path d="M80 54 L98 40 L83 64 Z" fill="{shade}"/>'
    out += f'<path d="M38 52 C38 36 47 29 60 29 C73 29 82 36 82 52 L82 60 C82 74 72 82 60 82 C48 82 38 74 38 60 Z" fill="{tone}"/>'
    return out


def face(eyes: str = INK, mouth: bool = True, blush: bool = False, eye_y: float = 58, style: str = "dot") -> str:
    out = ""
    if style == "dot":
        out += f'<ellipse cx="51" cy="{eye_y}" rx="2.6" ry="3.2" fill="{eyes}"/><ellipse cx="69" cy="{eye_y}" rx="2.6" ry="3.2" fill="{eyes}"/>'
    elif style == "calm":  # closed, content
        out += (f'<path d="M47.5 {eye_y} Q51 {eye_y + 3} 54.5 {eye_y}" stroke="{eyes}" stroke-width="2.2" fill="none" stroke-linecap="round"/>'
                f'<path d="M65.5 {eye_y} Q69 {eye_y + 3} 72.5 {eye_y}" stroke="{eyes}" stroke-width="2.2" fill="none" stroke-linecap="round"/>')
    elif style == "sharp":  # narrow, determined
        out += (f'<path d="M47 {eye_y - 1} L55 {eye_y + 0.5} L54 {eye_y + 2.5} L48 {eye_y + 2} Z" fill="{eyes}"/>'
                f'<path d="M73 {eye_y - 1} L65 {eye_y + 0.5} L66 {eye_y + 2.5} L72 {eye_y + 2} Z" fill="{eyes}"/>')
    if blush:
        out += f'<ellipse cx="46" cy="{eye_y + 7}" rx="3.6" ry="2" fill="#F27A7A" opacity="0.35"/><ellipse cx="74" cy="{eye_y + 7}" rx="3.6" ry="2" fill="#F27A7A" opacity="0.35"/>'
    if mouth:
        out += f'<path d="M56.5 {eye_y + 12} Q60 {eye_y + 14.5} 63.5 {eye_y + 12}" stroke="{INK}" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.75"/>'
    return out


def svg(parts: list[str], title: str) -> str:
    inner = "".join(parts)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="{title}">'
            f"<title>{title}</title>{inner}</svg>\n")


# ---------- Hair ----------

def hair_short_back(c: str) -> str:
    return f'<path d="M36 56 C34 34 46 24 60 24 C74 24 86 34 84 56 L80 48 L40 48 Z" fill="{c}"/>'


def hair_short_front(c: str, part: str = "side") -> str:
    if part == "side":
        return f'<path d="M37 50 C37 33 48 25 61 25 C74 25 84 33 83 49 C76 42 66 39 56 40 C49 41 42 44 37 50 Z" fill="{c}"/>'
    if part == "spiky":
        return (f'<path d="M36 52 L34 38 L42 42 L42 28 L50 36 L54 22 L60 33 L67 21 L70 35 L79 27 L78 42 L87 37 L84 52 '
                f'C76 44 68 41 60 41 C52 41 44 44 36 52 Z" fill="{c}"/>')
    if part == "messy":
        return (f'<path d="M36 52 C33 38 42 26 54 25 L58 20 L62 25 C77 24 88 36 84 52 L79 45 L76 50 L71 43 L66 48 '
                f'L61 42 L55 48 L50 43 L45 50 L41 45 Z" fill="{c}"/>')
    return ""


def hair_long_back(c: str, length: float = 104, width: float = 30) -> str:
    return (f'<path d="M{60 - width} 58 C{60 - width - 2} 34 46 23 60 23 C74 23 {60 + width + 2} 34 {60 + width} 58 '
            f'L{60 + width + 3} {length} C{60 + width - 8} {length + 4} {60 - width + 8} {length + 4} {60 - width - 3} {length} Z" fill="{c}"/>')


def hair_long_front(c: str, style: str = "center") -> str:
    if style == "center":
        # Curtains parted in the middle: a soft arch over the forehead, no point.
        return (f'<path d="M37 62 C35 36 46 25 60 25 C74 25 85 36 83 62 C81 51 77 43 70 40 C66 38.5 62.5 39.5 60 42 '
                f'C57.5 39.5 54 38.5 50 40 C43 43 39 51 37 62 Z" fill="{c}"/>')
    if style == "bangs":
        return (f'<path d="M37 58 C35 35 46 25 60 25 C74 25 85 35 83 58 C81 52 79 49 76 47 L72 51 L69 45 L64 50 '
                f'L60 44 L56 50 L51 45 L48 51 L44 47 C41 49 39 52 37 58 Z" fill="{c}"/>')
    if style == "side":
        return f'<path d="M37 62 C34 36 46 25 61 25 C75 25 85 35 83 54 C76 44 64 40 52 42 C45 45 40 52 37 62 Z" fill="{c}"/>'
    return ""


# ---------- Archetypes ----------

def cultivador() -> str:
    skin, hair = "s2", "#23202B"
    return svg([
        hair_long_back(hair, 96, 27),
        body("#F2EFE6", "#2F8F6B", v=True), neck(skin), head(skin), face(style="calm"),
        hair_long_front(hair, "center"),
        f'<ellipse cx="60" cy="22" rx="9" ry="7" fill="{hair}"/>',
        '<rect x="44" y="20" width="32" height="3.5" rx="1.75" fill="#E2B44C"/>',
        '<circle cx="77" cy="21.75" r="3" fill="#2F8F6B"/>',
    ], "Cultivador")


def mestra_seita() -> str:
    skin, hair = "s1", "#D9DCE6"
    return svg([
        hair_long_back(hair, 112, 31),
        body("#8E79D6", "#F4F1FA", v=True), neck(skin), head(skin), face(style="calm", blush=True),
        hair_long_front(hair, "center"),
        '<path d="M50 27 L54 18 L60 25 L66 18 L70 27 C66 25 54 25 50 27 Z" fill="#E2B44C"/>',
        '<circle cx="60" cy="22" r="2.4" fill="#7FD6E8"/>',
    ], "Mestra de seita")


def mago_reencarnado() -> str:
    skin, hair = "s3", "#6B3F25"
    return svg([
        body("#2E4FA8", "#E2B44C"), neck(skin), head(skin), face(),
        hair_short_front(hair, "messy"),
        '<path d="M30 40 C40 36 80 36 90 40 C84 44 36 44 30 40 Z" fill="#22377A"/>',
        '<path d="M38 39 C44 26 52 10 74 2 C68 14 74 26 82 39 Z" fill="#2E4FA8"/>',
        '<path d="M62 22 L64 26.5 L69 27 L65.2 30 L66.5 34.8 L62 32 L57.5 34.8 L58.8 30 L55 27 L60 26.5 Z" fill="#F5D46B"/>',
    ], "Mago reencarnado")


def vila_otome() -> str:
    skin, hair = "s1", "#EDC75F"
    curls = "".join(
        f'<ellipse cx="{x}" cy="{y}" rx="7.5" ry="6" fill="{hair}"/><ellipse cx="{x}" cy="{y}" rx="4" ry="2.6" fill="#D7A93D"/>'
        for x in (29, 91) for y in (66, 79, 92)
    )
    return svg([
        hair_long_back(hair, 70, 28), curls,
        body("#B3243F", "#1F1B24"), neck(skin), head(skin), face(style="sharp", eyes="#7A1E33", mouth=False),
        '<path d="M56.5 70 Q60 68.5 63.5 70" stroke="#1F1B24" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.75"/>',
        hair_long_front(hair, "side"),
        '<path d="M48 26 L51 19 L55 24 L60 17 L65 24 L69 19 L72 26 C64 24 56 24 48 26 Z" fill="#E7E9F0"/>',
        '<circle cx="60" cy="21.5" r="1.8" fill="#D6334F"/>',
    ], "Vilã de otome")


def regressor() -> str:
    skin, hair = "s2", "#2B2733"
    return svg([
        body("#4B5260", "#2C313B"),
        '<path d="M8 112 C10 96 20 88 36 88 L42 102 C30 104 18 108 8 112 Z" fill="#8F98A8"/>',
        '<path d="M112 112 C110 96 100 88 84 88 L78 102 C90 104 102 108 112 112 Z" fill="#8F98A8"/>',
        neck(skin), head(skin), face(style="sharp", mouth=False),
        '<path d="M57 69 L63 69" stroke="#1F1B24" stroke-width="1.8" stroke-linecap="round" opacity="0.7"/>',
        '<path d="M72 48 L76 66" stroke="#C26A5A" stroke-width="1.8" stroke-linecap="round"/>',
        hair_short_front(hair, "spiky"),
    ], "Regressor")


def cacadora() -> str:
    skin, hair = "s4", "#1F1B24"
    return svg([
        f'<path d="M78 32 C96 34 100 58 92 84 C88 70 84 54 76 44 Z" fill="{hair}"/>',
        body("#22262E", "#3A404C"),
        '<path d="M40 92 L46 112 L52 92 Z" fill="#4A9EFF"/>',
        neck(skin), head(skin), face(style="sharp"),
        hair_long_front(hair, "side"),
        '<rect x="80" y="54" width="5" height="11" rx="2.5" fill="#4A9EFF"/>',
    ], "Caçadora de masmorras")


def detetive() -> str:
    skin, hair = "s1", "#7A4B2E"
    return svg([
        f'<path d="M34 54 C34 38 46 30 60 30 C74 30 86 38 86 54 L88 78 C80 82 72 80 70 74 L50 74 C48 80 40 82 32 78 Z" fill="{hair}"/>',
        body("#9C7A54", "#E9E2D3", v=True), neck(skin), head(skin), face(blush=True),
        f'<path d="M38 52 C40 40 50 36 60 36 C70 36 80 40 82 52 C74 46 46 46 38 52 Z" fill="{hair}"/>',
        '<path d="M32 40 C34 26 46 18 60 18 C74 18 86 26 88 40 Z" fill="#8A6A44"/>',
        '<path d="M28 41 C40 36 80 36 92 41 C88 45 32 45 28 41 Z" fill="#6E5234"/>',
        '<rect x="34" y="34" width="52" height="4" fill="#3F3326"/>',
        '<circle cx="69" cy="58" r="6" fill="none" stroke="#E2B44C" stroke-width="1.8"/>',
    ], "Detetive")


def alquimista() -> str:
    skin, hair = "s3", "#C8C9CE"
    return svg([
        body("#3E7D5A", "#7A5433"),
        '<path d="M44 96 L76 96 L80 124 L40 124 Z" fill="#8C6239"/>',
        neck(skin), head(skin), face(),
        hair_short_front(hair, "messy"),
        '<rect x="38" y="38" width="44" height="5" rx="2.5" fill="#4A3424"/>',
        '<circle cx="50" cy="40" r="6.5" fill="#4A3424"/><circle cx="50" cy="40" r="4.2" fill="#7FD6E8"/>',
        '<circle cx="70" cy="40" r="6.5" fill="#4A3424"/><circle cx="70" cy="40" r="4.2" fill="#7FD6E8"/>',
    ], "Alquimista")


def princesa_guerreira() -> str:
    skin, hair = "s2", "#B5402C"
    return svg([
        hair_long_back(hair, 110, 31),
        body("#C9CED8", "#B5402C"),
        '<path d="M10 112 C12 98 22 90 38 89 L44 100 C32 102 20 106 10 112 Z" fill="#E2B44C"/>',
        '<path d="M110 112 C108 98 98 90 82 89 L76 100 C88 102 100 106 110 112 Z" fill="#E2B44C"/>',
        neck(skin), head(skin), face(style="sharp"),
        hair_long_front(hair, "center"),
        '<path d="M48 28 L52 20 L56 26 L60 18 L64 26 L68 20 L72 28 C64 26 56 26 48 28 Z" fill="#E2B44C"/>',
    ], "Princesa guerreira")


def necromante() -> str:
    skin = "pale"
    return svg([
        '<path d="M26 70 C24 36 40 16 60 16 C80 16 96 36 94 70 L100 110 L20 110 Z" fill="#3B2A55"/>',
        body("#2A1E3D", "#7DE0A6"), neck(skin), head(skin),
        '<path d="M34 60 C33 36 44 24 60 24 C76 24 87 36 86 60 C80 46 72 40 60 40 C48 40 40 46 34 60 Z" fill="#2A1E3D"/>',
        face(eyes="#7DE0A6", mouth=False, eye_y=60),
        '<ellipse cx="51" cy="60" rx="5" ry="4" fill="#7DE0A6" opacity="0.25"/><ellipse cx="69" cy="60" rx="5" ry="4" fill="#7DE0A6" opacity="0.25"/>',
    ], "Necromante")


def estudante_academia() -> str:
    skin, hair = "s1", "#F29BB8"
    return svg([
        f'<path d="M30 40 C16 46 14 70 22 92 C26 80 30 64 38 52 Z" fill="{hair}"/>',
        f'<path d="M90 40 C104 46 106 70 98 92 C94 80 90 64 82 52 Z" fill="{hair}"/>',
        '<circle cx="34" cy="40" r="4.5" fill="#FFFFFF"/><circle cx="86" cy="40" r="4.5" fill="#FFFFFF"/>',
        body("#24305E", "#F4F1FA", v=True),
        '<path d="M56 94 L64 94 L62 112 L60 115 L58 112 Z" fill="#D6334F"/>',
        neck(skin), head(skin), face(blush=True),
        hair_long_front(hair, "bangs"),
    ], "Estudante da academia")


def espadachim() -> str:
    skin, hair = "s2", "#23202B"
    return svg([
        f'<path d="M80 50 C92 60 94 84 88 100 C84 86 80 72 74 62 Z" fill="{hair}"/>',
        body("#5C6B73", "#E9E2D3", v=True), neck(skin), head(skin), face(style="calm"),
        hair_short_front(hair, "side"),
        '<path d="M60 10 L104 40 C90 46 30 46 16 40 Z" fill="#C9A86A"/>',
        '<path d="M16 40 C30 46 90 46 104 40 L104 43 C90 49 30 49 16 43 Z" fill="#A88A52"/>',
        '<rect x="44" y="47" width="32" height="3" rx="1.5" fill="#B5402C"/>',
    ], "Espadachim errante")


def rainha_demonio() -> str:
    skin, hair = "s3", "#4B2C6E"
    return svg([
        hair_long_back(hair, 112, 32),
        body("#1F1B24", "#B3243F", v=True), neck(skin), head(skin), face(eyes="#D6334F", style="sharp"),
        hair_long_front(hair, "center"),
        '<path d="M42 34 C34 26 30 14 34 4 C38 16 44 24 50 28 Z" fill="#2B2733"/>',
        '<path d="M78 34 C86 26 90 14 86 4 C82 16 76 24 70 28 Z" fill="#2B2733"/>',
    ], "Rainha demônio")


def ferreiro_anao() -> str:
    skin, beard = "s2", "#C8642E"
    return svg([
        body("#6E4A2E", "#4A3424"), neck(skin), head(skin), face(eye_y=55, mouth=False),
        f'<path d="M38 60 C40 64 44 66 48 66 L72 66 C76 66 80 64 82 60 C84 80 76 100 60 104 C44 100 36 80 38 60 Z" fill="{beard}"/>',
        '<path d="M52 70 C56 73 64 73 68 70" stroke="#9E4A1F" stroke-width="2" fill="none" stroke-linecap="round"/>',
        f'<path d="M44 52 C48 50 54 50 56 52" stroke="{beard}" stroke-width="3" stroke-linecap="round"/>',
        f'<path d="M64 52 C66 50 72 50 76 52" stroke="{beard}" stroke-width="3" stroke-linecap="round"/>',
        '<path d="M36 46 C36 30 46 24 60 24 C74 24 84 30 84 46 Z" fill="#3E6E8C"/>',
        '<rect x="34" y="42" width="52" height="6" rx="3" fill="#2E5470"/>',
    ], "Ferreiro anão")


def elfa_arqueira() -> str:
    skin, hair = "s1", "#EDD38A"
    return svg([
        '<path d="M28 62 C26 34 42 18 60 18 C78 18 94 34 92 62 L98 112 L22 112 Z" fill="#2F6B4A"/>',
        hair_long_back(hair, 106, 28),
        body("#3E8A5E", "#8C6239"), neck(skin), head(skin, ears="elf"), face(eyes="#2F6B4A", blush=True),
        hair_long_front(hair, "center"),
        '<path d="M34 50 C32 30 44 20 60 20 C76 20 88 30 86 50 C80 34 70 28 60 28 C50 28 40 34 34 50 Z" fill="#2F6B4A"/>',
    ], "Elfa arqueira")


def hacker_vrmmo() -> str:
    skin, hair = "s4", "#1F1B24"
    return svg([
        '<path d="M24 76 C22 44 38 24 60 24 C82 24 98 44 96 76 L100 110 L20 110 Z" fill="#3A404C"/>',
        body("#4A515F", "#22B8C2"), neck(skin), head(skin),
        hair_short_front(hair, "side"),
        '<path d="M32 58 C30 38 44 30 60 30 C76 30 90 38 88 58 C80 44 70 40 60 40 C50 40 40 44 32 58 Z" fill="#3A404C"/>',
        '<rect x="38" y="51" width="44" height="12" rx="6" fill="#1F2430"/>',
        '<rect x="41" y="54" width="38" height="6" rx="3" fill="#22D3DE"/>',
        '<path d="M56.5 70 Q60 72.5 63.5 70" stroke="#1F1B24" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.75"/>',
    ], "Hacker de VRMMO")


def sacerdotisa() -> str:
    skin, hair = "s3", "#2B2733"
    return svg([
        '<path d="M26 66 C24 36 40 18 60 18 C80 18 96 36 94 66 L100 112 L20 112 Z" fill="#F4F1FA"/>',
        hair_long_back(hair, 104, 26),
        body("#F4F1FA", "#E2B44C"), neck(skin), head(skin), face(style="calm", blush=True),
        hair_long_front(hair, "center"),
        '<path d="M34 46 C32 28 44 20 60 20 C76 20 88 28 86 46 C80 32 70 27 60 27 C50 27 40 32 34 46 Z" fill="#F4F1FA"/>',
        '<path d="M60 22 L63 28 L60 34 L57 28 Z" fill="#E2B44C"/>',
    ], "Sacerdotisa")


def cavaleiro_negro() -> str:
    return svg([
        body("#2B2F38", "#4B5260"),
        '<path d="M8 112 C10 96 20 88 36 88 L42 102 C30 104 18 108 8 112 Z" fill="#4B5260"/>',
        '<path d="M112 112 C110 96 100 88 84 88 L78 102 C90 104 102 108 112 112 Z" fill="#4B5260"/>',
        '<path d="M60 4 C70 10 72 20 68 28 L60 26 Z" fill="#B3243F"/>',
        '<path d="M36 54 C36 34 46 24 60 24 C74 24 84 34 84 54 L82 78 C76 86 68 90 60 90 C52 90 44 86 38 78 Z" fill="#3A404C"/>',
        '<path d="M58 24 L62 24 L62 90 L58 90 Z" fill="#2B2F38"/>',
        '<rect x="42" y="54" width="36" height="5" rx="2.5" fill="#14121A"/>',
        '<rect x="56" y="62" width="8" height="16" rx="2" fill="#14121A" opacity="0.6"/>',
    ], "Cavaleiro negro")


def bruxa() -> str:
    skin, hair = "s2", "#3F8F6B"
    return svg([
        f'<path d="M32 50 C24 70 30 90 26 104 C38 100 40 84 42 70 Z" fill="{hair}"/>',
        f'<path d="M88 50 C96 70 90 90 94 104 C82 100 80 84 78 70 Z" fill="{hair}"/>',
        body("#4B2C6E", "#2B2733"), neck(skin), head(skin), face(blush=True),
        hair_long_front(hair, "side"),
        '<path d="M14 44 C30 36 90 36 106 44 C96 50 24 50 14 44 Z" fill="#2B2733"/>',
        '<path d="M38 41 C42 24 50 10 76 2 C70 12 76 26 82 41 Z" fill="#2B2733"/>',
        '<rect x="39" y="33" width="42" height="5" fill="#9B7BFF"/>',
    ], "Bruxa")


def samurai() -> str:
    skin, hair = "s3", "#23202B"
    return svg([
        body("#2E3A5C", "#E9E2D3", v=True),
        '<path d="M45 89 L60 110 L52 89 Z" fill="#B5402C"/>',
        neck(skin), head(skin), face(style="sharp"),
        f'<path d="M37 52 C37 34 48 27 60 27 C72 27 83 34 83 52 C80 46 76 42 72 40 L48 40 C44 42 40 46 37 52 Z" fill="{hair}"/>',
        f'<path d="M54 30 L66 30 L64 14 C64 12 56 12 56 14 Z" fill="{hair}"/>',
        '<rect x="54" y="22" width="12" height="3" rx="1.5" fill="#E9E2D3"/>',
    ], "Samurai")


def kunoichi() -> str:
    skin, hair = "s2", "#23202B"
    return svg([
        f'<path d="M80 40 C96 46 98 70 90 92 C86 76 82 62 74 52 Z" fill="{hair}"/>',
        body("#2B2F38", "#4B5260"), neck(skin), head(skin), face(style="sharp", mouth=False, eye_y=56),
        '<path d="M38 64 L82 64 L82 66 C80 76 72 82 60 82 C48 82 40 76 38 66 Z" fill="#3A404C"/>',
        hair_long_front(hair, "bangs"),
        '<rect x="36" y="42" width="48" height="6" rx="2" fill="#B3243F"/>',
        '<path d="M84 44 L98 40 L94 48 Z" fill="#B3243F"/>',
    ], "Kunoichi")


def monge() -> str:
    skin = "s5"
    beads = "".join(f'<circle cx="{x}" cy="{y}" r="3" fill="#7A4B2E"/>' for x, y in ((44, 96), (50, 102), (56, 105), (64, 105), (70, 102), (76, 96)))
    return svg([
        body("#E57F2E", "#B85E1C"),
        '<path d="M30 124 C40 104 52 94 76 90 L84 92 C64 98 50 108 44 124 Z" fill="#C9661F"/>',
        beads,
        neck(skin), head(skin), face(style="calm"),
        '<circle cx="60" cy="38" r="1.6" fill="#E2B44C"/><circle cx="55" cy="38" r="1.6" fill="#E2B44C"/><circle cx="65" cy="38" r="1.6" fill="#E2B44C"/>',
    ], "Monge")


def vampira() -> str:
    skin, hair = "pale", "#1F1B24"
    return svg([
        hair_long_back(hair, 110, 30),
        body("#1F1B24", "#B3243F"),
        '<path d="M22 100 C26 84 34 76 42 74 L46 92 Z" fill="#B3243F"/>',
        '<path d="M98 100 C94 84 86 76 78 74 L74 92 Z" fill="#B3243F"/>',
        neck(skin), head(skin), face(eyes="#C8293F", style="sharp", mouth=False),
        '<path d="M56.5 70 Q60 72.5 63.5 70" stroke="#8A1C2C" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
        '<path d="M58 71 L59 74 L60 71.5 Z" fill="#FFFFFF"/>',
        hair_long_front(hair, "center"),
    ], "Vampira")


def piloto_estelar() -> str:
    skin, hair = "s4", "#4A2F25"
    return svg([
        body("#E8EAEF", "#FF9F43"),
        '<rect x="40" y="96" width="14" height="8" rx="2" fill="#4A9EFF"/>',
        neck(skin), head(skin), face(),
        hair_short_front(hair, "side"),
        '<path d="M32 58 C30 34 44 22 60 22 C76 22 90 34 88 58 L84 58 C82 40 72 32 60 32 C48 32 38 40 36 58 Z" fill="#C9CED8"/>',
        '<rect x="80" y="52" width="9" height="14" rx="4.5" fill="#FF9F43"/>',
        '<path d="M84 66 C84 74 78 78 70 78" stroke="#5A616D" stroke-width="2" fill="none" stroke-linecap="round"/>',
        '<circle cx="69" cy="78" r="2.4" fill="#5A616D"/>',
    ], "Piloto estelar")


AVATARS = {
    "cultivador": cultivador,
    "mestra-seita": mestra_seita,
    "mago-reencarnado": mago_reencarnado,
    "vila-otome": vila_otome,
    "regressor": regressor,
    "cacadora": cacadora,
    "detetive": detetive,
    "alquimista": alquimista,
    "princesa-guerreira": princesa_guerreira,
    "necromante": necromante,
    "estudante-academia": estudante_academia,
    "espadachim": espadachim,
    "rainha-demonio": rainha_demonio,
    "ferreiro-anao": ferreiro_anao,
    "elfa-arqueira": elfa_arqueira,
    "hacker-vrmmo": hacker_vrmmo,
    "sacerdotisa": sacerdotisa,
    "cavaleiro-negro": cavaleiro_negro,
    "bruxa": bruxa,
    "samurai": samurai,
    "kunoichi": kunoichi,
    "monge": monge,
    "vampira": vampira,
    "piloto-estelar": piloto_estelar,
}


def sheet(path: Path, start: int = 0, count: int = 24, cols: int = 6) -> None:
    """Grid on the colored circles, for reviewing the set."""
    colors = list(COLORS.values())
    cells = []
    items = list(AVATARS.items())[start:start + count]
    rows = (len(items) + cols - 1) // cols
    for offset, (name, make) in enumerate(items):
        index = start + offset
        x, y = (offset % cols) * 130 + 5, (offset // cols) * 130 + 5
        inner = make().split(">", 1)[1].rsplit("</svg>", 1)[0]
        clip = f"c{index}"
        cells.append(
            f'<clipPath id="{clip}"><circle cx="{x + 60}" cy="{y + 60}" r="60"/></clipPath>'
            f'<circle cx="{x + 60}" cy="{y + 60}" r="60" fill="{colors[index % len(colors)]}"/>'
            f'<g clip-path="url(#{clip})"><g transform="translate({x} {y})">{inner}</g></g>'
        )
    w, h = cols * 130, rows * 130
    path.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w * 2}" height="{h * 2}">'
        f'<rect width="{w}" height="{h}" fill="#19191b"/>{"".join(cells)}</svg>'
    )


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
    for name, make in AVATARS.items():
        (OUT / f"{name}.svg").write_text(make())
    print(f"{len(AVATARS)} avatars em {OUT}")


if __name__ == "__main__":
    main()
