"""Estado da publicacao (`publish_state.json`): versao/hash de cada bundle e catalogo atual.

Este arquivo e a memoria do que esta no B2. Perde-lo em silencio faria a proxima
publicacao reconstruir tudo como v1 e regravar o index.json so com a fonte atual,
por isso a leitura falha alto e a gravacao e atomica.
"""
from __future__ import annotations

import contextlib
import fcntl
import json
import os
import tempfile
import time
from pathlib import Path


class StateError(RuntimeError):
    """O publish_state.json existe mas nao pode ser lido: nao publique por cima."""


def load_state(path: str) -> dict:
    p = Path(path)
    if not p.exists():
        return {"novels": {}, "sites": {}}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise StateError(f"publish_state ilegivel em {path}: {exc}. Restaure um backup antes de publicar.") from exc
    if not isinstance(data, dict):
        raise StateError(f"publish_state em {path} nao e um objeto JSON.")
    data.setdefault("novels", {})
    data.setdefault("sites", {})
    return data


def save_state(path: str, state: dict) -> None:
    """Grava num temporario do mesmo diretorio e troca de uma vez (os.replace)."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{p.name}.", suffix=".tmp", dir=str(p.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(state, fh, ensure_ascii=False, indent=2)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, p)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp)
        raise


class LockTimeout(TimeoutError):
    """Outra publicacao segurou a trava por mais tempo que o permitido."""


@contextlib.contextmanager
def publish_lock(path: str, timeout: float = 3600.0, poll: float = 2.0, log=print):
    """Trava unica de publicacao (fcntl.flock) entre API, script diario e rodizio."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    fh = open(p, "a+")
    started = time.monotonic()
    warned = False
    try:
        while True:
            try:
                fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if not warned:
                    log(f"[publish] outra publicacao em andamento, esperando a trava {p}")
                    warned = True
                if time.monotonic() - started >= timeout:
                    raise LockTimeout(f"trava de publicacao ocupada por mais de {int(timeout)} s: {p}")
                time.sleep(poll)
        yield
    finally:
        with contextlib.suppress(OSError):
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
        fh.close()
