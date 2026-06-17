"""Fetcher HTTP com rate-limit por dominio e retry/backoff."""
from __future__ import annotations

import asyncio
import time
from urllib.parse import urlsplit

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from ..config import get_settings
from .base import RawPage


class HttpFetcher:
    def __init__(self, rate_limit_seconds: float | None = None, headers: dict[str, str] | None = None) -> None:
        s = get_settings()
        self.rate_limit_seconds = rate_limit_seconds or s.default_rate_limit_seconds
        self._last: dict[str, float] = {}
        self._lock = asyncio.Lock()
        client_headers = {
            "User-Agent": s.user_agent,
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.6",
        }
        if headers:
            client_headers.update(headers)
        self._client = httpx.AsyncClient(
            headers=client_headers,
            timeout=s.request_timeout_seconds,
            follow_redirects=True,
            http2=True,
        )

    async def _throttle(self, host: str) -> None:
        async with self._lock:
            now = time.monotonic()
            wait = self._last.get(host, 0) + self.rate_limit_seconds - now
            if wait > 0:
                await asyncio.sleep(wait)
            self._last[host] = time.monotonic()

    @retry(
        reraise=True,
        stop=stop_after_attempt(4),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        retry=retry_if_exception_type((httpx.TransportError, httpx.HTTPStatusError)),
    )
    async def get(self, url: str) -> RawPage:
        host = urlsplit(url).netloc
        await self._throttle(host)
        resp = await self._client.get(url)
        if resp.status_code in (429, 500, 502, 503, 504):
            resp.raise_for_status()
        resp.raise_for_status()
        return RawPage(
            url=str(resp.url),
            html=resp.content,
            etag=resp.headers.get("ETag"),
            last_modified=resp.headers.get("Last-Modified"),
            content_type=resp.headers.get("Content-Type"),
        )

    async def get_json(self, url: str, params: dict | None = None) -> object:
        host = urlsplit(url).netloc
        await self._throttle(host)
        resp = await self._client.get(url, params=params)
        resp.raise_for_status()
        return resp.json()

    async def aclose(self) -> None:
        await self._client.aclose()
