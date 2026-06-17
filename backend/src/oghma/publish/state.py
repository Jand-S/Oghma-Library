from __future__ import annotations

import json
from pathlib import Path


def load_state(path: str) -> dict:
    p = Path(path)
    if p.exists():
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            data.setdefault("novels", {})
            data.setdefault("sites", {})
            return data
        except Exception:
            pass
    return {"novels": {}, "sites": {}}


def save_state(path: str, state: dict) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
