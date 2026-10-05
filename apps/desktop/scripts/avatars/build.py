#!/usr/bin/env python3
"""Builds the profile avatars the app ships from the ComfyUI renders (`renders/`).

- `renders/<id>.webp` (characters, own background) → `public/avatars/personagens/<id>.webp`
- `renders/arquetipos/<arq>-<n>.webp` (transparent) → `public/avatars/originais/<arq>-<n>.webp`
- catalog for the app → `src/core/avatarCatalog.json`
- ids the account API accepts → `backend/src/oghma/accounts/avatars.json`

Everything is resized to 256 px (the largest avatar on screen is 112 px; 2× for Retina).
Needs Pillow:  python3 -m pip install pillow  (or any venv with it)

    python3 scripts/avatars/build.py
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from PIL import Image

APP = Path(__file__).resolve().parents[2]
RENDERS = APP / "scripts" / "avatars" / "renders"
PUBLIC = APP / "public" / "avatars"
CATALOG = APP / "src" / "core" / "avatarCatalog.json"
BACKEND = APP.parents[1] / "backend" / "src" / "oghma" / "accounts" / "avatars.json"
SIZE = 256

# Display names of the characters (fan art, personal use), in the picker's order.
CHARACTERS = {
    "emilia": "Emilia",
    "rem": "Rem",
    "subaru": "Natsuki Subaru",
    "betelgeuse": "Betelgeuse",
    "megumin": "Megumin",
    "asuna": "Asuna",
    "kirito": "Kirito",
    "albedo": "Albedo",
    "holo": "Holo",
    "raphtalia": "Raphtalia",
    "naofumi": "Naofumi Iwatani",
    "roxy": "Roxy Migurdia",
    "elaina": "Elaina",
    "violet": "Violet Evergarden",
    "mai": "Mai Sakurajima",
    "kurumi": "Kurumi Tokisaki",
    "ayanokouji": "Kiyotaka Ayanokouji",
    "horikita": "Suzune Horikita",
    "wei-wuxian": "Wei Wuxian",
    "kim-dokja": "Kim Dokja",
    "klein-moretti": "Klein Moretti",
    "sung-jinwoo": "Sung Jinwoo",
}


def save_small(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        image = image.convert("RGBA")
        image.thumbnail((SIZE, SIZE), Image.LANCZOS)
        image.save(target, "WEBP", quality=88, method=6)


def main() -> None:
    manifest = json.loads((RENDERS / "arquetipos" / "manifesto.json").read_text())
    missing = [cid for cid in CHARACTERS if not (RENDERS / f"{cid}.webp").exists()]
    if missing:
        raise SystemExit(f"Renders faltando: {missing}")

    for folder in ("personagens", "originais"):
        shutil.rmtree(PUBLIC / folder, ignore_errors=True)
    for cid in CHARACTERS:
        save_small(RENDERS / f"{cid}.webp", PUBLIC / "personagens" / f"{cid}.webp")

    originals = []
    for arq in manifest["arquetipos"]:
        variants = []
        for variant in arq["variantes"]:
            save_small(RENDERS / "arquetipos" / variant["arquivo"], PUBLIC / "originais" / f"{variant['id']}.webp")
            variants.append(variant["id"])
        originals.append({"id": arq["id"], "name": arq["nome"], "genre": arq["genero"], "variants": variants})

    colors = list(manifest["cores"].keys())
    catalog = {
        "characters": [{"id": cid, "name": name} for cid, name in CHARACTERS.items()],
        "originals": originals,
        "colors": colors,
    }
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n")
    ids = list(CHARACTERS) + [variant for arq in originals for variant in arq["variants"]]
    BACKEND.write_text(json.dumps({"ids": ids, "colors": colors}, indent=2) + "\n")
    print(f"{len(CHARACTERS)} personagens, {len(ids) - len(CHARACTERS)} variantes originais, {len(colors)} cores")


if __name__ == "__main__":
    main()
