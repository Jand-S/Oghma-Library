"""Limite simples por chave numa janela deslizante (memória do processo; um worker só)."""
from __future__ import annotations

import time
from collections import defaultdict, deque


class SlidingWindow:
    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        hits = self.hits[key]
        while hits and now - hits[0] > self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            return False
        hits.append(now)
        if len(self.hits) > 50_000:  # não cresce sem fim com IPs de passagem
            for stale in [k for k, v in self.hits.items() if not v or now - v[-1] > self.window][:10_000]:
                del self.hits[stale]
        return True
